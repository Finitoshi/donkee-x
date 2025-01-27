import { MongoClient } from 'mongodb';
import 'dotenv/config';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db('donkeeBot');
    console.log('Connected to MongoDB Atlas with Search enabled');
  }
  return db;
}
