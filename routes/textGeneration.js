const express = require("express");
const { HfInference } = require("@huggingface/inference");
const db = require("../config/db");
const authenticate = require("../middleware/authenticate");
require("dotenv").config();

const router = express.Router();
const hf = new HfInference(process.env.HF_API_KEY);

// Fungsi untuk mendapatkan atau membuat session baru
async function getOrCreateSession(sessionId, firstPrompt, userId) {
    return new Promise((resolve, reject) => {
        if (!sessionId) {
            // Jika sessionId tidak ada, buat session baru
            const query = "INSERT INTO sessions (name, user_id) VALUES (?, ?)";
            db.query(query, [firstPrompt, userId], (err, results) => {
                if (err) return reject(err);
                resolve(results.insertId);
            });
        } else {
            // Jika sessionId ada, pastikan session tersebut milik user yang benar
            const query = "SELECT id FROM sessions WHERE id = ? AND user_id = ?";
            db.query(query, [sessionId, userId], (err, results) => {
                if (err || results.length === 0) return reject(new Error("Invalid sessionId"));
                resolve(sessionId);
            });
        }
    });
}

// Endpoint untuk generate text dan menyimpan ke database
router.post("/", authenticate, async (req, res) => {
    try {
        const { sessionId, prompt } = req.body;
        const userId = req.user?.id;

        if (!prompt) {
            return res.status(400).json({ error: "Prompt is required" });
        }

        // Panggil Hugging Face API untuk generate text
        const response = await hf.chatCompletion({
            model: "mistralai/Mistral-7B-Instruct-v0.2",
            messages: [{ role: "user", content: prompt }],
            provider: "hf-inference",
            max_tokens: 500
        });

        const result = response.choices[0].message.content;

        // Pastikan session ada atau buat baru
        const newSessionId = await getOrCreateSession(sessionId, prompt, userId);

        // Simpan ke database
        db.query(
            "INSERT INTO text_generations (user_id, session_id, prompt, result) VALUES (?, ?, ?, ?)",
            [userId, newSessionId, prompt, result],
            (err, resultQuery) => {
                if (err) {
                    return res.status(500).json({ error: "Failed to save data to database", details: err.sqlMessage });
                }
                res.json({ id: resultQuery.insertId, sessionId: newSessionId, prompt, result });
            }
        );
    } catch (error) {
        res.status(500).json({ error: "Error generating text", details: error.message });
    }
});

// Endpoint untuk mendapatkan history text generation berdasarkan session
router.get("/session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    db.query(
        "SELECT id, prompt, result FROM text_generations WHERE session_id = ? AND user_id = ? ORDER BY id DESC",
        [sessionId, userId],
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: "Failed to fetch text history", details: err.message });
            }
            res.status(200).json({ texts: results });
        }
    );
});

// Endpoint untuk rename session
router.put("/rename-session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    db.query(
        "UPDATE sessions SET name = ? WHERE id = ? AND user_id = ?",
        [name, sessionId, userId],
        (err) => {
            if (err) {
                return res.status(500).json({ error: "Failed to update session name", details: err.message });
            }
            res.json({ message: "Session renamed successfully" });
        }
    );
});

// Endpoint untuk delete session dan text generations yang terkait
router.delete("/delete-session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    db.query(
        "DELETE FROM sessions WHERE id = ? AND user_id = ?",
        [sessionId, userId],
        (err) => {
            if (err) return res.status(500).json({ error: "Failed to delete session", details: err.message });

            db.query(
                "DELETE FROM text_generations WHERE session_id = ? AND user_id = ?",
                [sessionId, userId],
                (err) => {
                    if (err) return res.status(500).json({ error: "Failed to delete text generations", details: err.message });
                    res.json({ message: "Session and related texts deleted successfully" });
                }
            );
        }
    );
});

// Endpoint untuk update prompt dan regenerate text
router.put("/update/:id", authenticate, async (req, res) => {
    const { id } = req.params;
    const { prompt } = req.body;
    const userId = req.user.id;

    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required and must be a valid string." });
    }

    try {
        // Panggil Hugging Face API untuk generate text baru
        const response = await hf.chatCompletion({
            model: "mistralai/Mistral-7B-Instruct-v0.2",
            messages: [{ role: "user", content: prompt }],
            provider: "hf-inference",
            max_tokens: 500
        });

        if (!response || !response.choices || response.choices.length === 0) {
            throw new Error("Failed to generate text from Hugging Face API.");
        }

        const newResult = response.choices[0].message.content;

        // Update database dengan prompt dan teks baru
        db.query(
            "UPDATE text_generations SET prompt = ?, result = ? WHERE id = ? AND user_id = ?",
            [prompt, newResult, id, userId],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: "Failed to update prompt and text", details: err.message });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: "Text not found or not authorized to edit" });
                }

                res.json({ message: "Prompt and text updated successfully", newResult });
            }
        );
    } catch (error) {
        res.status(500).json({ error: "Error generating text", details: error.message });
    }
});

// Endpoint untuk delete specific generated text
router.delete("/:id", authenticate, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Cari session_id dari teks yang akan dihapus
    db.query(
        "SELECT session_id FROM text_generations WHERE id = ? AND user_id = ?",
        [id, userId],
        (err, result) => {
            if (err) return res.status(500).json({ error: "Database error", details: err.message });
            if (result.length === 0) return res.status(404).json({ error: "Text not found" });

            const sessionId = result[0].session_id;

            // Hapus teks dari database
            db.query(
                "DELETE FROM text_generations WHERE id = ? AND user_id = ?",
                [id, userId],
                (err) => {
                    if (err) return res.status(500).json({ error: "Failed to delete text", details: err.message });

                    // Cek apakah masih ada teks dalam sesi ini
                    db.query(
                        "SELECT COUNT(*) AS count FROM text_generations WHERE session_id = ?",
                        [sessionId],
                        (err, countResult) => {
                            if (err) return res.status(500).json({ error: "Database error", details: err.message });

                            if (countResult[0].count === 0) {
                                // Jika tidak ada teks yang tersisa, hapus sesi
                                db.query(
                                    "DELETE FROM sessions WHERE id = ?",
                                    [sessionId],
                                    (err) => {
                                        if (err) return res.status(500).json({ error: "Failed to delete session", details: err.message });
                                        res.json({ message: "Text and session deleted successfully" });
                                    }
                                );
                            } else {
                                res.json({ message: "Text deleted successfully" });
                            }
                        }
                    );
                }
            );
        }
    );
});

// Endpoint untuk mendapatkan semua session yang memiliki text generations
router.get("/text-sessions", authenticate, (req, res) => {
    const userId = req.user.id;
    db.query(
        `SELECT s.id, s.name, s.created_at 
         FROM sessions s
         WHERE s.user_id = ? 
         AND EXISTS (SELECT 1 FROM text_generations tg WHERE tg.session_id = s.id)
         ORDER BY s.created_at DESC`,
        [userId],
        (err, results) => {
            if (err) {
                return res.status(500).json({ error: "Failed to fetch sessions with text generations", details: err.message });
            }
            res.status(200).json(results);
        }
    );
});

module.exports = router;