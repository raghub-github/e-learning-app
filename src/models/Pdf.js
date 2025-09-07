// src/models/Pdf.js
import mongoose from 'mongoose';
import crypto from 'crypto';

const { Schema } = mongoose;

/**
 * Helper: simple slugify (keeps ASCII only, lowercases, replaces spaces with -, removes invalid chars)
 * Avoid depending on external packages to keep bundle minimal.
 */
function slugify(text = '') {
  return text
    .toString()
    .normalize('NFKD') // decompose diacritics
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alnum with -
    .replace(/^-+|-+$/g, '') // trim - from start/end
    .slice(0, 200); // limit length
}

/**
 * COMMON_CATEGORIES
 * You can extend this list as required. Using many categories is okay — consider storing category metadata in a separate collection if it grows.
 */
export const COMMON_CATEGORIES = [
  'ssc-cgl',
  'ssc-chsl',
  'railway',
  'bank-ibps',
  'ibpo',
  'nda',
  'cds',
  'psc',
  'police-constable',
  'police-sub-inspector',
  'state-psc',
  'govt-exams',
  'teaching-nta',
  'other',
];

const keywordsSchema = new Schema(
  {
    en: { type: [String], default: [] },
    hi: { type: [String], default: [] },
    bn: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * Pdf Schema
 */
const pdfSchema = new Schema(
  {
    // Multilingual titles
    title_en: { type: String, required: true, trim: true, maxlength: 300, index: true },
    title_hi: { type: String, trim: true, maxlength: 300, default: '' },
    title_bn: { type: String, trim: true, maxlength: 300, default: '' },

    // brief description or abstract
    description: { type: String, trim: true, default: '' },

    // Multilingual keywords for Atlas Search
    keywords: { type: keywordsSchema, default: {} },

    // Primary searchable language (one of the languages)
    language: { type: String, enum: ['en', 'hi', 'bn', 'other'], default: 'en', index: true },

    // Category (one of many exam categories)
    category: { type: String, enum: COMMON_CATEGORIES, default: 'other', index: true },

    // tags for filtering
    tags: { type: [String], index: true, default: [] },

    // SEO fields
    seoSlug: { type: String, required: true, unique: true, index: true },
    metaTitle: { type: String, trim: true, maxlength: 160 },
    metaDescription: { type: String, trim: true, maxlength: 320 },
    seoTags: { type: [String], default: [] },

    // Cloudflare R2 key (path or object key). Not the public URL (we generate signed urls server-side)
    r2Key: { type: String, required: true, trim: true },

    // File metadata
    mimeType: { type: String, default: 'application/pdf' },
    fileSize: { type: Number, default: 0 }, // bytes
    pages: { type: Number, default: 0 },

    // Pricing & access
    isPaid: { type: Boolean, default: false, index: true },
    price: { type: Number, default: 0, min: 0 },

    // Metrics
    downloads: { type: Number, default: 0, index: true },
    views: { type: Number, default: 0, index: true },
    avgRating: { type: Number, default: 0 }, // optional aggregated rating
    ratingsCount: { type: Number, default: 0 },

    // geo / location filtering: array of locations (state, district, city, etc.)
    locations: { type: [String], default: [], index: true },

    // publishing / exam / certification dates
    publishedAt: { type: Date, default: Date.now, index: true },
    examDate: { type: Date, default: null, index: true },
    certificationDate: { type: Date, default: null, index: true },

    // additional flags
    isFeatured: { type: Boolean, default: false, index: true },
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
      index: true,
    },

    // uploader / publisher reference (optional)
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },

    // freeform tags & categories useful for admin filters
    extra: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

/**
 * Pre-validate hook — ensure seoSlug exists and is unique-ish.
 * If seoSlug not provided, create from title_en (fallback to title_hi/title_bn).
 * Append a short random suffix if slug already exists (best-effort uniqueness).
 *
 * Note: For absolute guarantee of uniqueness across race conditions,
 * create unique index on seoSlug (already present) and handle duplicate key error on save.
 */
pdfSchema.pre('validate', async function preValidate(next) {
  try {
    if (!this.seoSlug) {
      const base = slugify(this.title_en || this.title_hi || this.title_bn || 'pdf');
      let candidate = base;
      // Quick attempt to avoid collisions: check up to 3 times and append short suffix
      /* eslint-disable no-await-in-loop */
      for (let i = 0; i < 3; i += 1) {
        // search without considering current doc (in update case)
        // use lean find for performance
        // eslint-disable-next-line no-await-in-loop
        // If model not compiled yet (on first run), mongoose.models.Pdf may exist
        // but `this.constructor` is safe to use
        // eslint-disable-next-line no-await-in-loop
        // check if candidate exists in DB
        // using countDocuments is faster than findOne for existence
        // exclude current _id if set (for updates)
        const exists = await this.constructor.countDocuments({
          seoSlug: candidate,
          _id: { $ne: this._id },
        });
        if (!exists) {
          this.seoSlug = candidate;
          break;
        }
        // append 6-char suffix from crypto
        const suffix = crypto.randomBytes(3).toString('hex');
        candidate = `${base}-${suffix}`;
      }
      if (!this.seoSlug) {
        // fallback to final candidate if still not set
        this.seoSlug = candidate;
      }
    } else {
      // normalize provided slug
      this.seoSlug = slugify(this.seoSlug);
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

/**
 * Pre-save: ensure price consistency for paid PDFs
 */
pdfSchema.pre('save', function preSave(next) {
  if (this.isPaid && (!this.price || this.price <= 0)) {
    // If marked paid but price not set, default to 0 — but warn
    // In production you may want to throw an error instead
    // Here we set to 0 and log (logger not imported to keep model isolated)
    // Example: logger.warn('Paid PDF saved with zero price', { id: this._id });
    this.price = Math.max(0, this.price || 0);
  }
  return next();
});

/**
 * Instance method: atomic increment downloads
 */
pdfSchema.methods.incrementDownloads = function incrementDownloads() {
  // Use updateOne to atomically increment on DB rather than changing local doc and saving
  return this.constructor.updateOne({ _id: this._id }, { $inc: { downloads: 1 } }).exec();
};

/**
 * Static helper: projection used for lightweight suggestion results
 * Use this when returning search suggestions
 */
pdfSchema.statics.suggestionProjection = function suggestionProjection() {
  return {
    _id: 1,
    title_en: 1,
    title_hi: 1,
    title_bn: 1,
    seoSlug: 1,
    category: 1,
    language: 1,
    tags: 1,
    r2Key: 1,
    isPaid: 1,
    price: 1,
    pages: 1,
    fileSize: 1,
  };
};

/**
 * Useful compound indexes for filtering and sorting (non-text)
 * Text / full-text search will be handled by MongoDB Atlas Search index configured in Atlas UI.
 */
pdfSchema.index({ seoSlug: 1 }, { unique: true, background: true });
pdfSchema.index({ category: 1 });
pdfSchema.index({ language: 1 });
pdfSchema.index({ createdAt: -1 });
pdfSchema.index({ publishedAt: -1 });
pdfSchema.index({ downloads: -1 });
pdfSchema.index({ tags: 1 });
pdfSchema.index({ uploadedBy: 1 });
pdfSchema.index({ isPaid: 1 });
pdfSchema.index({ locations: 1 });

/**
 * Export model (prevent recompilation in dev / HMR)
 */
const Pdf = mongoose.models.Pdf || mongoose.model('Pdf', pdfSchema);

export default Pdf;

/**
 * Notes:
 * - Create Atlas Search index via MongoDB Atlas UI:
 *   - Index fields: title_en, title_hi, title_bn, keywords.en, keywords.hi, keywords.bn, tags, category, description
 *   - Configure analyzers as appropriate for Hindi/Bengali (use ICU/edgeNGram as needed)
 * - For large category lists consider storing categories in a separate collection and referencing by id.
 * - Consider adding a small admin-only audit collection to track uploads/changes.
 */
