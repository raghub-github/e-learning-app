// src/app/api/pdfs/[id]/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import Pdf from '@/models/Pdf';
import logger from '@/lib/logger';
import { requireRole } from '@/lib/rbac';
import { getUserFromRequest } from '@/lib/auth';

const EDGE_CACHE_SECONDS = parseInt(process.env.PDF_DETAIL_CACHE_SECONDS || '120', 10);

// Utility: safe ObjectId check
import mongoose from 'mongoose';
const isValidObjectId = id => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/pdfs/[id]
 * - Supports both Mongo ObjectId and seoSlug
 */
export async function GET(req, { params }) {
  const { id } = params;

  try {
    await dbConnect();

    let query = {};
    if (isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { seoSlug: id };
    }

    const projection = {
      title_en: 1,
      title_hi: 1,
      title_bn: 1,
      description: 1,
      tags: 1,
      category: 1,
      language: 1,
      seoSlug: 1,
      r2Key: 1,
      downloads: 1,
      createdAt: 1,
      updatedAt: 1,
      price: 1,
      isPaid: 1,
      pages: 1,
      fileSize: 1,
      metaTitle: 1,
      metaDescription: 1,
    };

    const pdf = await Pdf.findOne(query, projection).lean();

    if (!pdf) {
      return NextResponse.json({ success: false, error: 'PDF not found' }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, pdf },
      {
        headers: {
          'Cache-Control': `s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${Math.floor(
            EDGE_CACHE_SECONDS / 2
          )}`,
        },
      }
    );
  } catch (err) {
    logger?.error?.('GET /api/pdfs/[id] error', { message: err.message, stack: err.stack });
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PUT /api/pdfs/[id]
 * - Admin only
 * - Update metadata (tags, desc, category, price, etc.)
 */
export async function PUT(req, { params }) {
  const { id } = params;

  try {
    await dbConnect();

    // Auth check
    const user = await getUserFromRequest(req);
    requireRole(user, 'admin');

    const body = await req.json();

    const updateFields = {
      title_en: body.title_en,
      title_hi: body.title_hi,
      title_bn: body.title_bn,
      description: body.description,
      tags: body.tags,
      category: body.category,
      language: body.language,
      price: body.price,
      isPaid: body.isPaid,
      metaTitle: body.metaTitle,
      metaDescription: body.metaDescription,
    };

    let query = {};
    if (isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { seoSlug: id };
    }

    const updated = await Pdf.findOneAndUpdate(query, updateFields, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) {
      return NextResponse.json({ success: false, error: 'PDF not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, pdf: updated });
  } catch (err) {
    logger?.error?.('PUT /api/pdfs/[id] error', { message: err.message, stack: err.stack });
    const status = err.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json(
      { success: false, error: status === 403 ? 'Forbidden' : 'Internal Server Error' },
      { status }
    );
  }
}

/**
 * DELETE /api/pdfs/[id]
 * - Admin only
 */
export async function DELETE(req, { params }) {
  const { id } = params;

  try {
    await dbConnect();

    // Auth check
    const user = await getUserFromRequest(req);
    requireRole(user, 'admin');

    let query = {};
    if (isValidObjectId(id)) {
      query = { _id: id };
    } else {
      query = { seoSlug: id };
    }

    const deleted = await Pdf.findOneAndDelete(query).lean();

    if (!deleted) {
      return NextResponse.json({ success: false, error: 'PDF not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'PDF deleted' });
  } catch (err) {
    logger?.error?.('DELETE /api/pdfs/[id] error', { message: err.message, stack: err.stack });
    const status = err.name === 'ForbiddenError' ? 403 : 500;
    return NextResponse.json(
      { success: false, error: status === 403 ? 'Forbidden' : 'Internal Server Error' },
      { status }
    );
  }
}
