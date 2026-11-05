import "dotenv/config";
import { MongoClient } from "mongodb";
const books = [
 ["The Midnight Library","Matt Haig","Fiction",5],["Dune","Frank Herbert","Fiction",4],["To Kill a Mockingbird","Harper Lee","Fiction",3],
 ["A Brief History of Time","Stephen Hawking","Science",4],["Cosmos","Carl Sagan","Science",3],["The Selfish Gene","Richard Dawkins","Science",2],
 ["Sapiens","Yuval Noah Harari","History",5],["Guns, Germs, and Steel","Jared Diamond","History",3],["The Silk Roads","Peter Frankopan","History",2],
 ["Charlotte's Web","E. B. White","Kids",6],["Matilda","Roald Dahl","Kids",4],["The Gruffalo","Julia Donaldson","Kids",5],
 ["Atomic Habits","James Clear","Others",6],["Deep Work","Cal Newport","Others",3],["The Alchemist","Paulo Coelho","Others",4],
];
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db(process.env.DB_NAME || "booknook").collection("books");
const now = Date.now();
await col.insertMany(books.map(([title,author,category,n],i)=>({
  title,author,category,totalCopies:n,availableCopies:n,
  image:`https://picsum.photos/seed/booknook${i}/400/560`,
  description:`${title} by ${author} is a popular ${category.toLowerCase()} read from the BookNook shelves. Borrow it for a week and enjoy.`,
  addedBy:{name:"BookNook Admin",email:"admin@booknook.app"},
  createdAt:new Date(now - i*3600000),
})));
console.log("Seeded",books.length,"books"); await client.close();
