// src/models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const { Schema } = mongoose;

// Role constants
export const USER_ROLES = {
  USER: 'user',
  ADMIN: 'admin',
};

const profileSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    locale: {
      type: String,
      enum: ['en', 'hi', 'bn'],
      default: 'en',
    },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email address'],
      index: true,
    },
    mobile: {
      type: String,
      unique: true,
      sparse: true, // allows multiple null values
      trim: true,
      match: [/^\+?[0-9]{10,15}$/, 'Invalid mobile number'],
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    roles: {
      type: [String],
      enum: Object.values(USER_ROLES),
      default: [USER_ROLES.USER],
      index: true,
    },
    profile: profileSchema,
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Pre-save middleware for password hashing
userSchema.pre('save', async function preSave(next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, saltRounds);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Instance method → compare raw password
userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Static method → find by email/mobile
userSchema.statics.findByLogin = function findByLogin(identifier, withPassword = false) {
  const query = /^\S+@\S+\.\S+$/.test(identifier)
    ? this.findOne({ email: identifier.toLowerCase().trim() })
    : this.findOne({ mobile: identifier.trim() });

  if (withPassword) query.select('+passwordHash');
  return query;
};

// Compound index for optimized queries
userSchema.index({ email: 1, roles: 1 });
userSchema.index({ mobile: 1, roles: 1 });

// Prevent model recompilation in dev
const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
