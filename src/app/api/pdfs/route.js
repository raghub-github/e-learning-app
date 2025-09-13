// src/app/api/pdfs/route.js
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import Pdf from '@/models/Pdf';
import logger from '@/lib/logger';
import { buildPdfFiltersAndOptions } from '@/lib/filters';
import { buildPdfSearchPipeline } from '@/lib/atlasSearch';

/**
 * GET /api/pdfs
 *
 * Query parameters:
 *  - q (optional) : full-text query — triggers Atlas Search pipeline
 *  - language, category, tags, locations, isPaid, minDownloads, dateFrom, dateTo, etc. (see filters)
 *  - page (1-based), limit
 *  - sort (score|downloads|latest|oldest|price_asc|price_desc)
 *
 * Behavior:
 *  - If q is present and non-empty => use Atlas Search aggregation pipeline
 *  - Otherwise => use standard Mongo filters (fast index-based queries)
 *
 * Response:
 *  { success: true, results: [...], total, page, limit, totalPages }
 */

// Edge caching (free & SEO-friendly). Adjust seconds as needed.
const EDGE_CACHE_SECONDS = parseInt(process.env.SEARCH_CACHE_SECONDS || '60', 10);

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  // Parse 'q' early to decide search vs filters
  const q = (searchParams.get('q') || '').trim();

  // Build filters & options from query params (safe parsing)
  const { filters, options, meta } = buildPdfFiltersAndOptions(searchParams);
  const { skip, limit, sort, page } = options;

  try {
    await dbConnect();

    // If q present -> use Atlas Search aggregation pipeline
    if (q) {
      // Ensure pipeline receives q and filters; buildPdfSearchPipeline supports language/category/locations
      const language = searchParams.get('language') || undefined;
      const category = searchParams.get('category') || undefined;
      const locationsParam = searchParams.get('locations');
      const locations = locationsParam
        ? locationsParam
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [];

      const sortParam = searchParams.get('sort') || 'score';

      // Use the pipeline builder (this returns a pipeline that already facets count & results)
      const pipeline = buildPdfSearchPipeline({
        q,
        language,
        category,
        locations,
        sort: sortParam,
        page,
        limit,
      });

      // Run aggregation on the Pdf collection
      const agg = await Pdf.aggregate(pipeline).allowDiskUse(false).exec();
      const agg0 = agg[0] || { results: [], totalCount: [] };

      const results = agg0.results || [];
      const total = (agg0.totalCount && agg0.totalCount[0] && agg0.totalCount[0].count) || 0;

      // Response
      const body = {
        success: true,
        results,
        total,
        page,
        limit,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
      };

      // Edge cache header (CDN)
      return NextResponse.json(body, {
        headers: {
          'Cache-Control': `s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${Math.floor(EDGE_CACHE_SECONDS / 2)}`,
        },
      });
    }

    // No q -> filter-only fast query using Mongo indexes
    // Build find cursor with projection aligning with search projection
    const projection = {
      title_en: 1,
      title_hi: 1,
      title_bn: 1,
      category: 1,
      tags: 1,
      language: 1,
      seoSlug: 1,
      downloads: 1,
      createdAt: 1,
      r2Key: 1,
      price: 1,
      isPaid: 1,
      pages: 1,
      fileSize: 1,
      metaTitle: 1,
      metaDescription: 1,
    };

    const query = Pdf.find(filters, projection).sort(sort).skip(skip).limit(limit);

    // Optionally optimize for counts: use estimatedDocumentCount if no filters (fast but approximate)
    let total = 0;
    if (Object.keys(filters).length === 0) {
      // No filters - use estimated count (fast)
      try {
        total = await Pdf.estimatedDocumentCount();
      } catch (err) {
        // fallback to countDocuments
        total = await Pdf.countDocuments();
      }
    } else {
      total = await Pdf.countDocuments(filters);
    }

    const results = await query.lean().exec();

    const body = {
      success: true,
      results,
      total,
      page,
      limit,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
    };

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': `s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${Math.floor(EDGE_CACHE_SECONDS / 2)}`,
      },
    });
  } catch (err) {
    logger?.error?.('GET /api/pdfs error', { message: err?.message, stack: err?.stack });
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
