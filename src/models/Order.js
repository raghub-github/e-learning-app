// src/models/Order.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Order statuses represent order lifecycle.
 * - created: order created on our side (and usually created on Razorpay)
 * - pending: awaiting payment (customer has not completed)
 * - paid: payment succeeded (one or more payments captured)
 * - cancelled: order cancelled before payment
 * - failed: payment attempted but failed
 * - refunded: refunded fully (could also keep track per Payment)
 */
export const ORDER_STATUS = {
  CREATED: 'created',
  PENDING: 'pending',
  PAID: 'paid',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

/**
 * Order schema represents a purchase intent. One Order may map to one Razorpay order.
 * Amount values are stored in the smallest currency unit (e.g., paise for INR).
 */
const orderItemSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['pdf', 'course', 'quiz', 'exam-update', 'bundle'],
      required: true,
    },
    refId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    title: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 }, // in smallest currency unit
    quantity: { type: Number, required: true, default: 1, min: 1 },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Items purchased in this order (supports bundles)
    items: { type: [orderItemSchema], required: true },

    // Total amount computed as sum(unitPrice * quantity) — in smallest currency unit
    amount: { type: Number, required: true, min: 0, index: true },

    currency: { type: String, default: 'INR', required: true },

    // Our receipt / id (human-friendly)
    receipt: { type: String, index: true },

    // Razorpay order id (when created on Razorpay)
    razorpayOrderId: { type: String, index: true, unique: true, sparse: true },

    // Link payments (Payment documents) — an order can have multiple payment attempts
    payments: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],

    // Order lifecycle status
    status: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.CREATED,
      index: true,
    },

    // TTL for unpaid orders (optional) — e.g., expire unpaid after X days
    expiresAt: { type: Date, default: null, index: true },

    // Capture: indicates whether the payment should be auto-captured by Razorpay
    paymentCapture: { type: Boolean, default: true },

    // Arbitrary notes: useful to store invoice ids, coupon codes etc.
    notes: { type: Schema.Types.Mixed, default: {} },

    // meta/debug data from Razorpay when creating the order
    razorpayMeta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
  }
);

/**
 * Pre-save: ensure amount consistency based on items
 */
orderSchema.pre('validate', function preValidate(next) {
  try {
    if (!Array.isArray(this.items) || this.items.length === 0) {
      return next(new Error('Order must include at least one item'));
    }
    // compute expected amount if not provided or inconsistent
    const computed = this.items.reduce((acc, it) => acc + it.unitPrice * (it.quantity || 1), 0);
    if (!this.amount || this.amount !== computed) {
      this.amount = computed;
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

/**
 * Instance method: mark order paid
 * - attaches paymentId(s) if provided
 * - sets status to PAID
 */
orderSchema.methods.markPaid = async function markPaid({ paymentId = null } = {}) {
  if (paymentId) {
    this.payments = this.payments || [];
    if (!this.payments.includes(paymentId)) {
      this.payments.push(paymentId);
    }
  }
  this.status = ORDER_STATUS.PAID;
  await this.save();
  return this;
};

/**
 * Instance method: mark order cancelled
 */
orderSchema.methods.markCancelled = async function markCancelled(reason = null) {
  this.status = ORDER_STATUS.CANCELLED;
  if (reason) this.notes = { ...(this.notes || {}), cancelledReason: reason };
  await this.save();
  return this;
};

/**
 * Instance method: mark order failed
 */
orderSchema.methods.markFailed = async function markFailed(reason = null) {
  this.status = ORDER_STATUS.FAILED;
  if (reason) this.notes = { ...(this.notes || {}), failedReason: reason };
  await this.save();
  return this;
};

/**
 * Virtual: isPaid
 */
orderSchema.virtual('isPaid').get(function isPaid() {
  return this.status === ORDER_STATUS.PAID;
});

/**
 * Indexes for common queries
 */
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

// Prevent re-compilation in dev
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

export default Order;
