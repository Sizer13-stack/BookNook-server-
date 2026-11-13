import "dotenv/config";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db(process.env.DB_NAME || "booknook").collection("books");
const books = await col.find({ "addedBy.email": "admin@booknook.app" }).toArray();

for (const b of books) {
  try {
    const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(b.title)}&author=${encodeURIComponent(b.author)}&limit=5&fields=title,cover_i`;
    const res = await fetch(url);
    const data = await res.json();
    const hit = (data.docs || []).find((d) => d.cover_i);
    if (!hit) { console.log("No cover found:", b.title); continue; }
    const image = `https://covers.openlibrary.org/b/id/${hit.cover_i}-L.jpg`;
    await col.updateOne({ _id: b._id }, { $set: { image } });
    console.log("Updated:", b.title);
  } catch (e) {
    console.log("Failed:", b.title, e.message);
  }
}
await client.close();
console.log("Done");
