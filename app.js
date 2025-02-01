const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

require("dotenv").config();
const db = require("./config/db");
const authRoutes = require("./routes/auth");
const textGenerationRoutes = require("./routes/textGeneration");
const textToImageRoutes = require("./routes/textToImage");

const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(bodyParser.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/text-generation", textGenerationRoutes);
app.use("/api/text-to-image", textToImageRoutes);

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
