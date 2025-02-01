const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
    // Ambil token dari header Authorization
    const token = req.headers.authorization?.split(" ")[1];
    
    // Jika token tidak ada, kembalikan respons 401 Unauthorized
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    // Verifikasi token menggunakan JWT_SECRET dari environment variable
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        // Jika terjadi error (misalnya token invalid atau expired), kembalikan respons 401
        if (err) return res.status(401).json({ error: "Invalid or expired token" });

        // Pastikan payload token memiliki userId
        if (!decoded.userId) {
            console.error("Token payload missing userId");
            return res.status(401).json({ error: "Invalid token payload: Missing userId" });
        }

        // Tambahkan userId ke request object untuk digunakan di middleware atau controller selanjutnya
        req.user = { id: decoded.userId };
        
        // Debugging: Log userId yang berhasil diautentikasi
        console.log("Authenticated User ID:", req.user.id);
        
        // Lanjutkan ke middleware atau controller selanjutnya
        next();
    });
};

module.exports = authenticate;