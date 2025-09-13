// src/app/api/search/route.js
import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { buildPdfSearchPipeline } from '@/lib/atlasSearch';

export const revalidate = 60; // cache responses for 60s at CDN layer

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const q = searchParams.get('q') || '';
    const language = searchParams.get('language') || null;
    const category = searchParams.get('category') || null;
    const sort = searchParams.get('sort') || 'score';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const locationsParam = searchParams.get('locations');
    const locations = locationsParam ? locationsParam.split(',').map(l => l.trim()) : [];

    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const collection = db.collection('pdfs');

    // Build Atlas Search pipeline
    const pipeline = buildPdfSearchPipeline({
      q,
      language,
      category,
      locations,
      sort,
      page,
      limit,
    });

    const aggResult = await collection.aggregate(pipeline).toArray();
    const results = aggResult[0]?.results || [];
    const total = aggResult[0]?.totalCount?.[0]?.count || 0;

    const responseData = {
      success: true,
      results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    // Send Edge-optimized SEO response
    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=30', // Edge cache 60s
      },
    });
  } catch (error) {
    console.error('Search API Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
