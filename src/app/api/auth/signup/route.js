// src/app/api/auth/signup/route.js
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import dbConnect from '@/lib/dbConnect';
import User from '@/models/User';
import { signAccessToken, signRefreshToken } from '@/lib/jwt';
import logger from '@/lib/logger';

const SALT_ROUNDS = 12;

export async function POST(req) {
  try {
    await dbConnect();

    const body = await req.json();
    const { email, password, name, mobile } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Check if user exists
    const existing = await User.findOne({ email });
    if (existing) {
      return NextResponse.json({ error: 'Email is already registered' }, { status: 409 });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create new user
    const user = await User.create({
      email,
      passwordHash,
      name: name || '',
      mobile: mobile || null,
      roles: ['user'],
    });

    // Generate tokens
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    // Create response
    const res = NextResponse.json(
      {
        message: 'Signup successful',
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          mobile: user.mobile,
          roles: user.roles,
        },
      },
      { status: 201 }
    );

    // Set cookies (httpOnly for security)
    res.cookies.set('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 15, // 15 min
    });

    res.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    logger.info('New user registered', { userId: user._id, email });

    return res;
  } catch (err) {
    logger.error('Signup error', { error: err.message });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
