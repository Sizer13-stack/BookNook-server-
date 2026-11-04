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

// 1. All books (public). ?limit=6 returns the newest first
app.get("/books", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 0, 100);
  const filter = req.query.email ? { "addedBy.email": req.query.email } : {};
  let cursor = req.db.collection("books").find(filter).sort({ createdAt: -1 });
  if (limit) cursor = cursor.limit(limit);
  res.json(await cursor.toArray());
});

// 2. One book
app.get("/books/:id", async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid book id" });
  const book = await req.db.collection("books").findOne({ _id: new ObjectId(req.params.id) });
  if (!book) return res.status(404).json({ message: "Book not found" });
  res.json(book);
});

function cleanBook(b) {
  const copies = Number(b.totalCopies);
  if (!b.title?.trim() || !b.author?.trim() || !b.description?.trim() || !b.image)
    return { error: "Please fill in every field" };
  if (!CATEGORIES.includes(b.category)) return { error: "Choose a valid category" };
  if (!Number.isInteger(copies) || copies < 1) return { error: "Total copies must be at least 1" };
  return { data: { title: b.title.trim(), author: b.author.trim(), category: b.category, image: b.image, description: b.description.trim(), totalCopies: copies } };
}

// 3. Add a book
app.post("/books", verifyToken, async (req, res) => {
  const { data, error } = cleanBook(req.body);
  if (error) return res.status(400).json({ message: error });
  const doc = { ...data, availableCopies: data.totalCopies, addedBy: req.user, createdAt: new Date() };
  const result = await req.db.collection("books").insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});


if (!process.env.VERCEL) app.listen(process.env.PORT || 5000, () => console.log("BookNook API running"));
export default app;
