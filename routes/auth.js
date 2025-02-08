const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const nodemailer = require("nodemailer");

const router = express.Router();

// Register User
router.post("/register", (req, res) => {
    const { name, email, password } = req.body;
    console.log("Register request received:", req.body);

    bcrypt.hash(password, 10, (err, hashedPassword) => {
        if (err) {
            console.error("Error hashing password:", err);
            return res.status(500).json({ error: "Error hashing password" });
        }

        const sql = "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";
        db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name, email, hashedPassword], (error, results) => {
            if (error) {
                if (error.code === "ER_DUP_ENTRY") {
                    return res.status(400).json({ message: "Email sudah digunakan" });
                }
                console.error("Database error:", error);
                return res.status(500).json({ error: "Terjadi kesalahan, coba lagi nanti" });
            }
            res.json({ message: "User registered successfully" });
        });        
    });
});

// Login User
router.post("/login", (req, res) => {
    const { email, password } = req.body;
    console.log("Login request received:", req.body);

    const sql = "SELECT * FROM users WHERE email = ?";
    db.query(sql, [email], (error, results) => {
        if (error) {
            console.error("Database error on login:", error);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            console.log("User not found:", email);
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const user = results[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) {
                console.error("Error comparing password:", err);
                return res.status(500).json({ error: "Error checking password" });
            }

            if (!isMatch) {
                console.log("Invalid password for:", email);
                return res.status(401).json({ message: "Invalid credentials" });
            }

            const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
            console.log("User logged in:", email);
            res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
        });
    });
});

// Forgot Password - Send Reset Email
router.post("/forgot-password", (req, res) => {
    const { email } = req.body;
    console.log("Forgot password request received:", email);

    const sql = "SELECT * FROM users WHERE email = ?";
    db.query(sql, [email], (error, results) => {
        if (error) {
            console.error("Database error on forgot-password:", error);
            return res.status(500).json({ error: "Database error" });
        }

        if (results.length === 0) {
            console.log("Email not found:", email);
            return res.status(404).json({ message: "Email not found" });
        }

        const resetToken = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "15m" });

        const updateSql = "UPDATE users SET reset_token = ? WHERE email = ?";
        db.query(updateSql, [resetToken, email], (updateError, updateResults) => {
            if (updateError) {
                console.error("Database error updating reset token:", updateError);
                return res.status(500).json({ error: "Database error" });
            }

            console.log("Reset token generated for:", email);

            const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: "Reset Password",
                text: `Click this link to reset your password: http://localhost:5173/reset-password/${resetToken}`,
            };

            transporter.sendMail(mailOptions, (mailErr, info) => {
                if (mailErr) {
                    console.error("Error sending email:", mailErr);
                    return res.status(500).json({ error: "Error sending email" });
                }

                console.log("Reset email sent to:", email);
                res.json({ message: "Reset link sent to email" });
            });
        });
    });
});

// Reset Password
router.post("/reset-password", (req, res) => {
    const { token, newPassword } = req.body;
    console.log("Reset password request received:", token);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("Token decoded:", decoded);

        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            if (err) {
                console.error("Error hashing new password:", err);
                return res.status(500).json({ error: "Error hashing password" });
            }

            const sql = "UPDATE users SET password = ?, reset_token = NULL WHERE email = ?";
            db.query(sql, [hashedPassword, decoded.email], (error, results) => {
                if (error) {
                    console.error("Database error on reset-password:", error);
                    return res.status(500).json({ error: "Database error" });
                }

                console.log("Password reset successful for:", decoded.email);
                res.json({ message: "Password reset successful!" });
            });
        });
    } catch (error) {
        console.error("Invalid or expired token:", error);
        res.status(400).json({ message: "Invalid or expired token" });
    }
});

module.exports = router;
