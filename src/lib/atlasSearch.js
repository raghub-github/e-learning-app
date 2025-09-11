// src/lib/atlasSearch.js
/**
 * Build MongoDB Atlas Search aggregation pipeline for PDFs
 *
 * @param {Object} options
 * @param {string} options.q - search query
 * @param {string} [options.language] - filter by language
 * @param {string} [options.category] - filter by category
 * @param {string[]} [options.locations] - filter by locations
 * @param {string} [options.sort="score"] - sort order (score|downloads|latest)
 * @param {number} [options.page=1] - current page
 * @param {number} [options.limit=10] - items per page
 * @returns {Array} MongoDB aggregation pipeline
 */
export function buildPdfSearchPipeline({
  q,
  language,
  category,
  locations,
  sort = 'score',
  page = 1,
  limit = 10,
}) {
  const must = [];
  const should = [];

  // --- Search query across multiple fields ---
  if (q) {
    should.push({
      text: {
        query: q,
        path: [
          'title_en',
          'title_hi',
          'title_bn',
          'keywords.en',
          'keywords.hi',
          'keywords.bn',
          'tags',
          'category',
        ],
        fuzzy: {
          maxEdits: 2, // fuzzy matching for typos
          prefixLength: 2,
        },
      },
    });
  }

  // --- Language filter ---
  if (language) {
    must.push({
      equals: {
        path: 'language',
        value: language,
      },
    });
  }

  // --- Category filter ---
  if (category) {
    must.push({
      equals: {
        path: 'category',
        value: category,
      },
    });
  }

  // --- Locations filter ---
  if (locations?.length) {
    must.push({
      in: {
        path: 'locations',
        value: locations,
      },
    });
  }

  // --- Base pipeline ---
  const pipeline = [
    {
      $search: {
        index: 'pdf_search_index', // must match your Atlas Search index name
        compound: {
          should: should.length ? should : undefined,
          must: must.length ? must : undefined,
        },
        highlight: {
          path: ['title_en', 'title_hi', 'title_bn', 'keywords.en', 'tags'],
        },
      },
    },
    {
      $addFields: {
        score: { $meta: 'searchScore' },
        highlights: { $meta: 'searchHighlights' },
      },
    },
    {
      $project: {
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
        score: 1,
        highlights: 1,
      },
    },
  ];

  // --- Sorting ---
  if (sort === 'downloads') {
    pipeline.push({ $sort: { downloads: -1, createdAt: -1 } });
  } else if (sort === 'latest') {
    pipeline.push({ $sort: { createdAt: -1 } });
  } else {
    pipeline.push({ $sort: { score: -1, downloads: -1, createdAt: -1 } });
  }

  // --- Pagination ---
  const skip = (page - 1) * limit;
  pipeline.push({
    $facet: {
      results: [{ $skip: skip }, { $limit: limit }],
      totalCount: [{ $count: 'count' }],
    },
  });

  return pipeline;
}
