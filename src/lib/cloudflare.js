// src/lib/cloudflare.js
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from './logger';

const R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const R2_ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID; // from R2 dashboard

if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_ACCOUNT_ID) {
  throw new Error('Missing Cloudflare R2 environment variables');
}

/**
 * Create an S3 client for Cloudflare R2
 */
const s3Client = new S3Client({
  region: 'auto', // Cloudflare R2 uses "auto" region
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Generate a signed download URL
 * @param {string} r2Key - Object key in R2 bucket
 * @param {number} expiresIn - Expiration in seconds (default 300s = 5 minutes)
 */
export async function getDownloadSignedUrl(r2Key, expiresIn = 300) {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger?.error?.('Error generating R2 download signed URL', { r2Key, error: err });
    throw err;
  }
}

/**
 * Generate a signed upload URL
 * @param {string} r2Key - Object key in R2 bucket
 * @param {number} expiresIn - Expiration in seconds (default 300s = 5 minutes)
 * @param {string} contentType - Expected MIME type (e.g., "application/pdf")
 */
export async function getUploadSignedUrl(r2Key, expiresIn = 300, contentType = 'application/pdf') {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
      ContentType: contentType,
    });
    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (err) {
    logger?.error?.('Error generating R2 upload signed URL', { r2Key, error: err });
    throw err;
  }
}

export default {
  getDownloadSignedUrl,
  getUploadSignedUrl,
};
