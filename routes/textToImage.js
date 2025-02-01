const express = require("express");
const fetch = require("node-fetch");
const db = require("../config/db");
const authenticate = require("../middleware/authenticate");

const router = express.Router();

// Helper function untuk membuat atau mendapatkan session
async function getOrCreateSession(sessionId, firstPrompt, userId) {
    return new Promise((resolve, reject) => {
        if (!sessionId) {
            // Create new session if sessionId is not provided
            const query = "INSERT INTO sessions (name, user_id) VALUES (?, ?)";
            db.query(query, [firstPrompt, userId], (err, results) => {
                if (err) return reject(err);
                resolve(results.insertId);
            });
        } else {
            // Check if session exists for the user
            const query = "SELECT id FROM sessions WHERE id = ? AND user_id = ?";
            db.query(query, [sessionId, userId], (err, results) => {
                if (err || results.length === 0) return reject(new Error("Invalid sessionId"));
                resolve(sessionId);
            });
        }
    });
}

// Endpoint untuk menghasilkan gambar berdasarkan prompt
router.post("/", authenticate, async (req, res) => {
    const { sessionId, prompt } = req.body;
    const userId = req.user?.id;

    // Validasi input
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required and must be a valid string." });
    }

    try {
        // Panggil API Hugging Face untuk menghasilkan gambar
        const response = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.HF_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: prompt }),
        });

        if (!response.ok) {
            const errorMessage = await response.text();
            throw new Error(`Hugging Face API responded with ${response.status}: ${errorMessage}`);
        }

        const imageBlob = await response.blob();
        const imageUrl = `data:image/png;base64,${Buffer.from(await imageBlob.arrayBuffer()).toString("base64")}`;

        // Pastikan session ada atau buat baru
        const newSessionId = await getOrCreateSession(sessionId, prompt, userId);

        // Simpan gambar ke database
        db.query(
            "INSERT INTO image_generations (user_id, session_id, prompt, image_url) VALUES (?, ?, ?, ?)",
            [userId, newSessionId, prompt, imageUrl],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: "Failed to save data to database", details: err.sqlMessage });
                }
                res.json({ id: result.insertId, sessionId: newSessionId, prompt, imageUrl });
            }
        );
    } catch (error) {
        // Tangani error dengan baik
        res.status(500).json({ error: "Error generating image", details: error.message });
    }
});

// Endpoint: Get all sessions for the user
router.get("/image-sessions", authenticate, (req, res) => {
    const userId = req.user.id;

    db.query(
        `SELECT s.id, s.name, s.created_at 
         FROM sessions s
         WHERE s.user_id = ? 
         AND EXISTS (SELECT 1 FROM image_generations ig WHERE ig.session_id = s.id)
         ORDER BY s.created_at DESC`,
        [userId],
        (err, results) => {
            if (err) {
                console.error("Database Error:", err);
                return res.status(500).json({ error: "Database error", details: err.message });
            }
            res.status(200).json(results);
        }
    );
});

// Endpoint: Get session details by session ID
router.get("/session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Query untuk mendapatkan semua gambar dalam sesi
    const imagesQuery =
        "SELECT id, prompt, image_url FROM image_generations WHERE session_id = ? AND user_id = ? ORDER BY id DESC";

    db.query(imagesQuery, [sessionId, userId], (err, imageResults) => {
        if (err) {
            return res.status(500).json({ error: "Failed to fetch images", details: err.message });
        }
        res.status(200).json({ images: imageResults });
    });
});

// Endpoint: Rename Session
router.put("/rename-session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const { name } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required and must be a valid string." });
    }

    db.query(
        "UPDATE sessions SET name = ? WHERE id = ? AND user_id = ?",
        [name, sessionId, userId],
        (err, results) => {
            if (err) return res.status(500).json({ error: "Failed to update session name", details: err.message });
            res.json({ message: "Session renamed successfully" });
        }
    );
});

// Endpoint: Delete Session
router.delete("/delete-session/:sessionId", authenticate, (req, res) => {
    const { sessionId } = req.params;
    const userId = req.user.id;

    db.query(
        "DELETE FROM sessions WHERE id = ? AND user_id = ?",
        [sessionId, userId],
        (err, results) => {
            if (err) return res.status(500).json({ error: "Failed to delete session", details: err.message });
            
            // Hapus gambar terkait
            db.query(
                "DELETE FROM image_generations WHERE session_id = ? AND user_id = ?",
                [sessionId, userId],
                (err) => {
                    if (err) return res.status(500).json({ error: "Failed to delete related images", details: err.message });
                    res.json({ message: "Session and related images deleted successfully" });
                }
            );
        }
    );
});

// Endpoint: Update prompt and regenerate image
router.put("/update/:id", authenticate, async (req, res) => {
    const { id } = req.params;
    const { prompt } = req.body;
    const userId = req.user.id;

    // Validasi input
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required and must be a valid string." });
    }

    try {
        // Panggil API Hugging Face
        const response = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.HF_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ inputs: prompt }),
        });

        if (!response.ok) {
            const errorMessage = await response.text();
            throw new Error(`Hugging Face API responded with ${response.status}: ${errorMessage}`);
        }

        const buffer = await response.buffer();
        const imageUrl = `data:image/png;base64,${buffer.toString("base64")}`;

        // Update database
        db.query(
            "UPDATE image_generations SET prompt = ?, image_url = ? WHERE id = ? AND user_id = ?",
            [prompt, imageUrl, id, userId],
            (err, result) => {
                if (err) {
                    return res.status(500).json({ error: "Failed to update prompt and image", details: err.message });
                }

                if (result.affectedRows === 0) {
                    return res.status(404).json({ error: "Image not found or not authorized to edit" });
                }

                res.json({ message: "Prompt and image updated successfully", imageUrl });
            }
        );
    } catch (error) {
        res.status(500).json({ error: "Error generating image", details: error.message });
    }
});

// Endpoint: Delete image generation
router.delete("/:id", authenticate, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Cari session_id dari gambar yang akan dihapus
    db.query(
        "SELECT session_id FROM image_generations WHERE id = ? AND user_id = ?",
        [id, userId],
        (err, result) => {
            if (err) return res.status(500).json({ error: "Database error", details: err.message });
            if (result.length === 0) return res.status(404).json({ error: "Image not found" });

            const sessionId = result[0].session_id;

            // Hapus gambar dari database
            db.query(
                "DELETE FROM image_generations WHERE id = ? AND user_id = ?",
                [id, userId],
                (err) => {
                    if (err) return res.status(500).json({ error: "Failed to delete image", details: err.message });

                    // Cek apakah masih ada gambar dalam sesi ini
                    db.query(
                        "SELECT COUNT(*) AS count FROM image_generations WHERE session_id = ?",
                        [sessionId],
                        (err, countResult) => {
                            if (err) return res.status(500).json({ error: "Database error", details: err.message });

                            if (countResult[0].count === 0) {
                                // Jika tidak ada gambar yang tersisa, hapus sesi
                                db.query(
                                    "DELETE FROM sessions WHERE id = ?",
                                    [sessionId],
                                    (err) => {
                                        if (err) return res.status(500).json({ error: "Failed to delete session", details: err.message });
                                        res.json({ message: "Image and session deleted successfully" });
                                    }
                                );
                            } else {
                                res.json({ message: "Image deleted successfully" });
                            }
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;