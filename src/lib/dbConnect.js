// lib/dbConnect.js
import mongoose from 'mongoose';
import logger from './logger'; // centralized logging (winston/pino)

// Cache the connection in global scope (important for Next.js hot reload)
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export default async function dbConnect() {
  if (cached.conn) {
    return cached.conn; // Return existing connection if already open
  }

  if (!cached.promise) {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI is missing in environment variables');
    }

    const options = {
      maxPoolSize: 20, // higher pool size for concurrent requests
      minPoolSize: 5,
      serverSelectionTimeoutMS: 10000, // fail fast if cannot connect
      socketTimeoutMS: 45000,
      family: 4, // force IPv4
      autoIndex: false, // disable in prod, create indexes manually
    };

    cached.promise = mongoose
      .connect(mongoUri, options)
      .then((mongoose) => {
        logger.info('MongoDB connected successfully to Atlas');
        return mongoose;
      })
      .catch((err) => {
        logger.error('MongoDB connection error', { error: err });
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    throw err;
  }

  return cached.conn;
}
