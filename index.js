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

// 4. Update a book (owner only)
app.patch("/books/:id", verifyToken, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid book id" });
  const books = req.db.collection("books");
  const book = await books.findOne({ _id: new ObjectId(req.params.id) });
  if (!book) return res.status(404).json({ message: "Book not found" });
  if (book.addedBy.email !== req.user.email) return res.status(403).json({ message: "You can only edit your own books" });
  const { data, error } = cleanBook(req.body);
  if (error) return res.status(400).json({ message: error });
  const available = Math.max(0, book.availableCopies + (data.totalCopies - book.totalCopies));
  await books.updateOne({ _id: book._id }, { $set: { ...data, availableCopies: available } });
  res.json({ message: "Book updated" });
});

// 5. Delete a book (owner only)
app.delete("/books/:id", verifyToken, async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid book id" });
  const books = req.db.collection("books");
  const book = await books.findOne({ _id: new ObjectId(req.params.id) });
  if (!book) return res.status(404).json({ message: "Book not found" });
  if (book.addedBy.email !== req.user.email) return res.status(403).json({ message: "You can only delete your own books" });
  await books.deleteOne({ _id: book._id });
  await req.db.collection("borrows").deleteMany({ bookId: String(book._id) });
  res.json({ message: "Book deleted" });
});

// 6. Borrow a book (7 days)
app.post("/borrows", verifyToken, async (req, res) => {
  const { bookId } = req.body;
  if (!validId(bookId)) return res.status(400).json({ message: "Invalid book id" });
  const books = req.db.collection("books");
  const book = await books.findOne({ _id: new ObjectId(bookId) });
  if (!book) return res.status(404).json({ message: "Book not found" });

  const borrowDate = new Date();
  const returnDate = new Date(borrowDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const borrow = { bookId, bookTitle: book.title, bookImage: book.image, userEmail: req.user.email, borrowDate, returnDate };
  try {
    await req.db.collection("borrows").insertOne(borrow); // unique index blocks double borrow
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: "You have already borrowed this book" });
    throw e;
  }
  const updated = await books.updateOne({ _id: book._id, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } });
  if (!updated.modifiedCount) {
    await req.db.collection("borrows").deleteOne({ bookId, userEmail: req.user.email });
    return res.status(409).json({ message: "No copies of this book are available right now" });
  }
  res.status(201).json({ message: "Book borrowed" });
});


if (!process.env.VERCEL) app.listen(process.env.PORT || 5000, () => console.log("BookNook API running"));
export default app;
