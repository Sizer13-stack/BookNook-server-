import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json());

// Cached connection (works locally and on serverless hosts)
let dbPromise;
const getDb = () =>
  (dbPromise ??= (async () => {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || "booknook");
    await db.collection("borrows").createIndex({ bookId: 1, userEmail: 1 }, { unique: true });
    return db;
  })());

app.use(async (req, res, next) => {
  try { req.db = await getDb(); next(); }
  catch { dbPromise = null; res.status(500).json({ message: "Could not reach the database" }); }
});

// JWT issued by BetterAuth (jwt plugin), verified against the client app's JWKS
const jwks = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));
async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Please log in to continue" });
  try {
    const { payload } = await jwtVerify(header.slice(7), jwks);
    req.user = { email: payload.email, name: payload.name };
    next();
  } catch {
    res.status(401).json({ message: "Your session has expired. Please log in again" });
  }
}

const validId = (id) => ObjectId.isValid(id);
const CATEGORIES = ["Fiction", "Science", "History", "Kids", "Others"];

app.get("/", (_req, res) => res.json({ message: "BookNook API is running" }));


if (!process.env.VERCEL) app.listen(process.env.PORT || 5000, () => console.log("BookNook API running"));
export default app;
