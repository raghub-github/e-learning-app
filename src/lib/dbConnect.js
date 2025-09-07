// src/lib/dbConnect.js
import mongoose from 'mongoose';
import logger from './logger'; // ensure this exports a default logger (pino/winston wrapper)

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGO_URI) {
  throw new Error('Missing MONGODB_URI environment variable');
}

/**
 * Mongoose connection options
 * - autoIndex: enabled in non-production for convenience (create indexes via code in dev)
 * - maxPoolSize/minPoolSize: tune according to expected concurrency and Mongo tier
 */
const options = {
  maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '20', 10),
  minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '5', 10),
  serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '10000', 10),
  socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS || '45000', 10),
  family: 4,
  // Mongoose 6+ uses new parser/topology by default, but explicit flags are harmless
  useNewUrlParser: true,
  useUnifiedTopology: true,
  autoIndex: process.env.NODE_ENV !== 'production', // disable in production by default
};

// Use a unique global key to cache the connection across Hot Module Reloads
let cached = global._mongo;
if (!cached) {
  cached = global._mongo = { conn: null, promise: null };
}

/**
 * connectWithRetry - tries to connect up to `retries` times with exponential backoff
 * @param {number} retries
 * @param {number} initialDelayMs
 */
async function connectWithRetry(retries = 3, initialDelayMs = 1000) {
  let lastErr = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      logger.info('Attempting MongoDB connection', { attempt: i + 1 });
      const mongooseInstance = await mongoose.connect(MONGO_URI, options);
      logger.info('MongoDB connected successfully', {
        host: mongooseInstance.connection.host,
        name: mongooseInstance.connection.name,
      });
      return mongooseInstance;
    } catch (err) {
      lastErr = err;
      logger.error('MongoDB connection attempt failed', {
        attempt: i + 1,
        message: err.message,
      });
      const backoff = initialDelayMs * Math.pow(2, i);
      // wait before next attempt (skip wait on last failure)
      if (i < retries - 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(res => setTimeout(res, backoff));
      }
    }
  }
  // If we are here, all retries failed
  throw lastErr;
}

/**
 * dbConnect - main exported function used throughout the app
 * Caches the connection in global to avoid re-connecting on HMR in development.
 */
export default async function dbConnect() {
  if (cached.conn) {
    // Already connected — return the existing connection
    return cached.conn;
  }

  if (!cached.promise) {
    // Kick off connection attempt and store the promise
    cached.promise = connectWithRetry(
      parseInt(process.env.MONGO_CONNECT_RETRIES || '3', 10),
      parseInt(process.env.MONGO_INITIAL_RETRY_DELAY_MS || '1000', 10)
    ).then(mongooseInstance => {
      // store the actual connection object (MongoDB driver's Connection)
      return mongooseInstance.connection;
    });
  }

  try {
    cached.conn = await cached.promise;
    logger.info('MongoDB connection ready', { readyState: cached.conn.readyState });
    return cached.conn;
  } catch (err) {
    // Reset promise so future calls can retry
    cached.promise = null;
    logger.error('MongoDB connection failed permanently', { error: err.message });
    throw err;
  }
}
