// src/models/Payment.js
import mongoose from 'mongoose';
import crypto from 'crypto';

const { Schema } = mongoose;

/**
 * Payment statuses follow Razorpay lifecycle and internal states:
 * - created: we created a Payment document (maybe before user completes)
 * - authorized: payment authorized but not captured (if capture=false)
 * - captured: payment captured (successful)
 * - failed: payment attempt failed
 * - refunded: refunded (partial or full)
 * - disputed: in dispute chargeback etc.
 */
export const PAYMENT_STATUS = {
  CREATED: 'created',
  AUTHORIZED: 'authorized',
  CAPTURED: 'captured',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  DISPUTED: 'disputed',
};

/**
 * Payment schema stores Razorpay response metadata and a minimal payment representation.
 * Amounts are stored in smallest currency unit (e.g., paise).
 */
const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },

    // Razorpay identifiers
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String, index: true, unique: true, sparse: true },

    // Signature sent by Razorpay (for verification)
    razorpaySignature: { type: String },

    // Currency (INR default)
    currency: { type: String, default: 'INR' },

    // Amount in smallest currency unit
    amount: { type: Number, required: true, min: 0 },

    // Status
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.CREATED,
      index: true,
    },

    // Payment method metadata (card/bank/wallet/vpa)
    method: { type: String, default: null },
    card: {
      network: { type: String, default: null },
      type: { type: String, default: null },
      last4: { type: String, default: null },
      issuer: { type: String, default: null },
    },

    // Full raw response from Razorpay (store for auditing)
    raw: { type: Schema.Types.Mixed, default: {} },

    // capture flag (if true, payment is already captured)
    captured: { type: Boolean, default: false, index: true },

    // optional refund metadata
    refunded: { type: Boolean, default: false, index: true },
    refundedAt: { type: Date, default: null },

    // reconciliation flag — marks whether this payment has been reconciled with accounting
    reconciled: { type: Boolean, default: false, index: true },

    // webhook processed flag to avoid double-processing
    webhookProcessed: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } }
);

/**
 * Static: verify Razorpay signature for payment verification (server-side)
 * Razorpay signature generation: HMAC_SHA256(order_id + "|" + payment_id, secret)
 *
 * @param {String} razorpayOrderId
 * @param {String} razorpayPaymentId
 * @param {String} signature
 * @param {String} secret
 * @returns {Boolean}
 */
paymentSchema.statics.verifySignature = function verifySignature(
  razorpayOrderId,
  razorpayPaymentId,
  signature,
  secret
) {
  if (!razorpayOrderId || !razorpayPaymentId || !signature || !secret) return false;
  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return expected === signature;
};

/**
 * Instance: mark as captured
 */
paymentSchema.methods.markCaptured = async function markCaptured(rawResponse = {}) {
  this.status = PAYMENT_STATUS.CAPTURED;
  this.captured = true;
  this.raw = { ...(this.raw || {}), capture: rawResponse };
  await this.save();
  return this;
};

/**
 * Instance: mark as failed
 */
paymentSchema.methods.markFailed = async function markFailed(reason = null, rawResponse = {}) {
  this.status = PAYMENT_STATUS.FAILED;
  this.raw = { ...(this.raw || {}), failedReason: reason, ...rawResponse };
  await this.save();
  return this;
};

/**
 * Instance: mark refunded
 */
paymentSchema.methods.markRefunded = async function markRefunded(refundMeta = {}) {
  this.status = PAYMENT_STATUS.REFUNDED;
  this.refunded = true;
  this.refundedAt = new Date();
  this.raw = { ...(this.raw || {}), refund: refundMeta };
  await this.save();
  return this;
};

/**
 * Indexes
 */
paymentSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });
paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ user: 1, createdAt: -1 });

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);

export default Payment;
