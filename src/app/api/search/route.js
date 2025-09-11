// src/app/api/search/route.js
import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb'; // your MongoDB connection
import { buildPdfSearchPipeline } from '@/lib/atlasSearch';

export async function GET(req) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(req.url);

    const q = searchParams.get('q') || '';
    const language = searchParams.get('language') || null;
    const category = searchParams.get('category') || null;
    const sort = searchParams.get('sort') || 'score';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    // Parse locations as array (comma-separated)
    const locationsParam = searchParams.get('locations');
    const locations = locationsParam ? locationsParam.split(',').map(l => l.trim()) : [];

    // MongoDB client
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    const collection = db.collection('pdfs'); // make sure this matches your schema

    // Build pipeline
    const pipeline = buildPdfSearchPipeline({
      q,
      language,
      category,
      locations,
      sort,
      page,
      limit,
    });

    // Run aggregation
    const aggResult = await collection.aggregate(pipeline).toArray();

    const results = aggResult[0]?.results || [];
    const total = aggResult[0]?.totalCount?.[0]?.count || 0;

    return NextResponse.json({
      success: true,
      results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Search API Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
