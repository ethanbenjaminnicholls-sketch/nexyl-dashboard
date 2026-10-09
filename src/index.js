require("dotenv").config();
const express = require("express");
const path = require("path");
const { initDb } = require("./db");
const { startBot } = require("./bot");
const dashboard = require("./dashboard");
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(dashboard);
app.get("/health", (_req,res) => res.json({ok:true,service:"nexyl"}));
app.get("/", (_req,res) => res.sendFile(path.join(__dirname, "..", "public", "landing.html")));
async function main() {
  await initDb();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Nexyl listening on ${port}`));
  await startBot();
}
main().catch(e => { console.error("Startup failed:", e); process.exit(1); });
