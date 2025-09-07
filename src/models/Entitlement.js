// src/models/Entitlement.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Entitlement kinds → what resources can be protected.
 * Extendable if in future we add subscriptions, bundles, etc.
 */
export const ENTITLEMENT_KIND = {
  PDF: 'pdf',
  COURSE: 'course',
  QUIZ: 'quiz',
  EXAM_UPDATE: 'exam-update',
};

const entitlementSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: Object.values(ENTITLEMENT_KIND),
      required: true,
      index: true,
    },
    refId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true, // points to Pdf._id, Course._id, Quiz._id, or ExamUpdate._id
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Expiry logic (subscriptions, limited-time access, trials, etc.)
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    // Metadata for audits & attribution
    source: {
      type: String,
      enum: ['purchase', 'admin-grant', 'promo', 'trial'],
      default: 'purchase',
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null, // links entitlement to payment order
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  }
);

/**
 * Virtual: Check if entitlement is expired
 */
entitlementSchema.virtual('isExpired').get(function isExpired() {
  return this.expiresAt ? new Date() > this.expiresAt : false;
});

/**
 * Static: Grant entitlement
 * @param {ObjectId} userId
 * @param {String} kind
 * @param {ObjectId} refId
 * @param {Object} options
 */
entitlementSchema.statics.grant = async function grant(userId, kind, refId, options = {}) {
  const { expiresAt = null, source = 'purchase', order = null } = options;

  return this.create({
    user: userId,
    kind,
    refId,
    expiresAt,
    source,
    order,
    active: true,
  });
};

/**
 * Static: Revoke entitlement
 */
entitlementSchema.statics.revoke = async function revoke(userId, kind, refId) {
  return this.updateOne({ user: userId, kind, refId }, { $set: { active: false } });
};

/**
 * Static: Check if user has entitlement
 */
entitlementSchema.statics.hasAccess = async function hasAccess(userId, kind, refId) {
  const entitlement = await this.findOne({
    user: userId,
    kind,
    refId,
    active: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });

  return Boolean(entitlement);
};

// Compound indexes → ensures uniqueness & efficient queries
entitlementSchema.index(
  { user: 1, kind: 1, refId: 1 },
  { unique: true } // a user can't have duplicate entitlement for the same resource
);
entitlementSchema.index({ kind: 1, active: 1, expiresAt: 1 });

const Entitlement = mongoose.models.Entitlement || mongoose.model('Entitlement', entitlementSchema);

export default Entitlement;
