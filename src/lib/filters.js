// src/lib/filters.js
/**
 * src/lib/filters.js
 *
 * Helpers to parse query params into safe MongoDB filters and list options.
 * - parseQueryParams: accepts URLSearchParams or plain object
 * - buildMongoFilters: returns a Mongo filter object for PDFs
 * - buildListOptions: returns { skip, limit, sort } based on page/limit/sort params
 * - buildPdfFiltersAndOptions: convenience wrapper that returns both
 *
 * Usage:
 *  const { filters, options } = buildPdfFiltersAndOptions(req.nextUrl.searchParams);
 *  const docs = await Pdf.find(filters).sort(options.sort).skip(options.skip).limit(options.limit);
 *
 * Important: This builder does NOT create Atlas $search pipelines. If `q` (full text)
 * is present the API should use atlasSearch.buildPdfSearchPipeline(...) instead.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 12; // reasonable default; client may pass viewport-sized limit
const MAX_LIMIT = 200;

/**
 * Allowed sort keys and their Mongo representation.
 * Keys exposed to clients map to Mongo sort object.
 */
const SORT_MAP = {
  score: { score: -1, downloads: -1, createdAt: -1 },
  downloads: { downloads: -1, createdAt: -1 },
  latest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { price: 1 },
  price_desc: { price: -1 },
};

/**
 * Safe string sanitizer: trim & remove suspicious control characters.
 */
function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  // Remove ASCII control characters except newline/tab, trim whitespace
  return val.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Parse integer with fallback
 */
function parseInteger(val, fallback = undefined) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Parse boolean-ish values (1/0, true/false, yes/no)
 */
function parseBoolean(val, fallback = undefined) {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
}

/**
 * Parse a comma-separated list into array of trimmed strings (unique)
 */
function parseList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(v => sanitizeString(v)).filter(Boolean);
  return String(val)
    .split(',')
    .map(v => sanitizeString(v))
    .filter(Boolean);
}

/**
 * Parse date value. Supports:
 * - ISO dates: 2023-01-01 or 2023-01-01T00:00:00Z
 * - Relative durations: last7d, last30d, last1y
 * - Unix timestamps (ms)
 */
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();

  // relative formats like last7d, last30d, last1y
  const rel = s.match(/^last(\d+)([dhmy])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const now = new Date();
    switch (unit) {
      case 'd':
        return new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      case 'h':
        return new Date(now.getTime() - n * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() - n * 30 * 24 * 60 * 60 * 1000);
      case 'y':
        return new Date(now.getTime() - n * 365 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  // try ISO or numeric
  const asNum = Number(s);
  if (!Number.isNaN(asNum) && s.length >= 10) {
    // treat as timestamp (ms)
    const d = new Date(asNum);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build Mongo filters for PDFs based on parsed opts
 *
 * Supported filters (from query params):
 * - language (string)
 * - category (string)
 * - tags (comma separated)
 * - locations (comma separated)
 * - isPaid (boolean) -> if false => free, if true => paid
 * - minDownloads (int)
 * - dateFrom / dateTo (ISO or relative)
 * - examDateFrom / examDateTo (ISO or relative)
 * - level (beginner|intermediate|advanced)
 * - keywords (string) -> used as regex search on title/description (only as fallback)
 *
 * NOTE: If a full-text `q` is present, prefer using Atlas Search; this builder is for filter-only queries.
 *
 * @param {Object} opts
 * @returns {Object} Mongo filter
 */
export function buildMongoFilters(opts = {}) {
  const filters = {};

  const {
    language,
    category,
    tags,
    locations,
    isPaid,
    minDownloads,
    dateFrom,
    dateTo,
    examDateFrom,
    examDateTo,
    level,
    keywords,
  } = opts;

  if (language) {
    filters.language = sanitizeString(language);
  }

  if (category) {
    filters.category = sanitizeString(category);
  }

  if (Array.isArray(tags) && tags.length) {
    // match any of the tags
    filters.tags = { $in: tags.map(sanitizeString) };
  } else if (typeof tags === 'string' && tags.trim()) {
    const arr = parseList(tags);
    if (arr.length) filters.tags = { $in: arr };
  }

  if (Array.isArray(locations) && locations.length) {
    filters.locations = { $in: locations.map(sanitizeString) };
  } else if (typeof locations === 'string' && locations.trim()) {
    const arr = parseList(locations);
    if (arr.length) filters.locations = { $in: arr };
  }

  if (typeof isPaid !== 'undefined' && isPaid !== null) {
    // if isPaid === false => free PDFs (isPaid: false)
    filters.isPaid = Boolean(isPaid);
  }

  const minD = parseInteger(minDownloads, null);
  if (minD !== null) {
    filters.downloads = { $gte: minD };
  }

  // published/publishedAt date range
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (from || to) {
    filters.publishedAt = {};
    if (from) filters.publishedAt.$gte = from;
    if (to) filters.publishedAt.$lte = to;
    // remove empty object if both absent
    if (Object.keys(filters.publishedAt).length === 0) delete filters.publishedAt;
  }

  // examDate range
  const eFrom = parseDate(examDateFrom);
  const eTo = parseDate(examDateTo);
  if (eFrom || eTo) {
    filters.examDate = {};
    if (eFrom) filters.examDate.$gte = eFrom;
    if (eTo) filters.examDate.$lte = eTo;
    if (Object.keys(filters.examDate).length === 0) delete filters.examDate;
  }

  if (level) {
    filters.level = sanitizeString(level);
  }

  // keywords fallback: simple case-insensitive partial match on title_en/description
  if (keywords && typeof keywords === 'string' && keywords.trim().length > 0) {
    const kw = sanitizeString(keywords);
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); // escape & case-insensitive
    filters.$or = [
      { title_en: re },
      { title_hi: re },
      { title_bn: re },
      { description: re },
      { tags: { $in: [kw] } },
    ];
  }

  return filters;
}

/**
 * Build list options: skip, limit, sort
 *
 * Supported params:
 * - page (1-based)
 * - limit (items per page)
 * - sort (one of SORT_MAP keys)
 *
 * @param {Object} opts
 * @returns {{ skip: number, limit: number, sort: Object }}
 */
export function buildListOptions(opts = {}) {
  let { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT, sort = 'score' } = opts || {};
  page = parseInteger(page, DEFAULT_PAGE);
  limit = parseInteger(limit, DEFAULT_LIMIT);
  if (limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;
  if (page <= 0) page = DEFAULT_PAGE;

  const skip = (page - 1) * limit;

  const sortKey = typeof sort === 'string' && SORT_MAP[sort] ? sort : 'score';
  const sortObj = SORT_MAP[sortKey] || SORT_MAP.score;

  return { skip, limit, sort: sortObj, page };
}

/**
 * Convenience wrapper that accepts URLSearchParams or plain object and returns
 * { filters, options, meta } where meta includes original normalized params.
 *
 * @param {URLSearchParams|Object} query
 * @returns {{ filters: Object, options: Object, meta: Object }}
 */
export function buildPdfFiltersAndOptions(query = {}) {
  const params =
    typeof query.get === 'function'
      ? // URLSearchParams
        {
          q: query.get('q') || '',
          language: query.get('language') || undefined,
          category: query.get('category') || undefined,
          tags: query.get('tags') || undefined,
          locations: query.get('locations') || undefined,
          isPaid: query.has('isPaid') ? parseBoolean(query.get('isPaid')) : undefined,
          minDownloads: query.get('minDownloads') || undefined,
          dateFrom: query.get('dateFrom') || undefined,
          dateTo: query.get('dateTo') || undefined,
          examDateFrom: query.get('examDateFrom') || undefined,
          examDateTo: query.get('examDateTo') || undefined,
          level: query.get('level') || undefined,
          keywords: query.get('keywords') || undefined,
          page: query.get('page') || undefined,
          limit: query.get('limit') || undefined,
          sort: query.get('sort') || undefined,
        }
      : // plain object
        {
          q: query.q || '',
          language: query.language,
          category: query.category,
          tags: query.tags,
          locations: query.locations,
          isPaid: typeof query.isPaid !== 'undefined' ? parseBoolean(query.isPaid) : undefined,
          minDownloads: query.minDownloads,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          examDateFrom: query.examDateFrom,
          examDateTo: query.examDateTo,
          level: query.level,
          keywords: query.keywords,
          page: query.page,
          limit: query.limit,
          sort: query.sort,
        };

  // parse lists into arrays if provided as comma-separated strings
  if (typeof params.tags === 'string' && params.tags.trim()) {
    params.tags = parseList(params.tags);
  }
  if (typeof params.locations === 'string' && params.locations.trim()) {
    params.locations = parseList(params.locations);
  }

  const filters = buildMongoFilters(params);
  const options = buildListOptions({ page: params.page, limit: params.limit, sort: params.sort });

  const meta = {
    q: params.q,
    page: options.page,
    limit: options.limit,
    sort: params.sort || 'score',
  };

  return { filters, options, meta };
}

export default {
  parseList,
  parseDate,
  buildMongoFilters,
  buildListOptions,
  buildPdfFiltersAndOptions,
};
