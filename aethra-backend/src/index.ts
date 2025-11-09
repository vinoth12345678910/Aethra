import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import routes from "./routes";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/api", routes);

app.get("/", (req, res) => res.json({ name: "AETHRA Backend API", status: "ok" }));

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "";

if (!MONGO_URI) {
  console.error("MONGO_URI missing in .env - exiting.");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`AETHRA backend running: http://localhost:${PORT}/api`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
