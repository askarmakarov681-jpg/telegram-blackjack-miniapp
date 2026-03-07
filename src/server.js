
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/", express.static(path.join(__dirname, "..", "public")));

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
