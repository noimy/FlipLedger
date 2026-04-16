const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_TOKEN_LEN = 4096;
const limiter = new Map();

function toFiniteNumber(value, fallback = 0, min = 0, max = 9_999_999) {
  const n = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampText(value, max = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);
}

function toIsoDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function toYmd(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function getAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return configured;
}

function applyCors(req, res) {
  const allowedOrigins = getAllowedOrigins();
  const reqOrigin = req.headers.origin;
  const allowAny = allowedOrigins.length === 0;
  const allowOrigin = allowAny
    ? '*'
    : (reqOrigin && allowedOrigins.includes(reqOrigin) ? reqOrigin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getClientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return fwd || real || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
  const now = Date.now();
  const key = getClientIp(req);
  const hit = limiter.get(key);
  if (!hit || now > hit.resetAt) {
    limiter.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  hit.count += 1;
  if (hit.count > RATE_LIMIT_MAX_REQUESTS) return false;
  return true;
}

function normalizeOrder(o) {
  const lineItem = o?.lineItems?.[0] || {};
  const pricing = o?.pricingSummary || {};
  const orderId = clampText(o?.orderId, 120);
  const title = clampText(lineItem?.title || 'eBay Item', 220);
  const sold = toFiniteNumber(pricing?.total?.value ?? lineItem?.lineItemCost?.value, 0);
  const shipping = toFiniteNumber(pricing?.deliveryCost?.value, 0);
  const salestax = toFiniteNumber(pricing?.tax?.value, 0);
  const txfee = toFiniteNumber(o?.totalMarketplaceFee?.value, 0);
  const date = toYmd(o?.creationDate);
  const buyer = clampText(o?.buyer?.username || '', 120);

  return {
    orderId,
    title,
    date,
    platform: 'eBay',
    sold,
    cogs: 0,
    shipping,
    salestax,
    txfee,
    adfee: 0,
    otherfee: 0,
    notes: orderId ? `eBay Order: ${orderId}` : '',
    buyer,
    photos: [],
  };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRateLimit(req)) return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });

  const token = clampText(req.body?.token, MAX_TOKEN_LEN);
  const fromDate = String(req.body?.fromDate || '').trim();
  const toDate = String(req.body?.toDate || '').trim();

  if (!token) return res.status(400).json({ error: 'Missing eBay token' });
  if (token.length < 20) return res.status(400).json({ error: 'Invalid eBay token' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ error: 'Invalid date range format. Use YYYY-MM-DD.' });
  }

  const from = toIsoDate(fromDate);
  const to = toIsoDate(`${toDate}T23:59:59`);
  if (!from || !to) return res.status(400).json({ error: 'Invalid date range' });
  if (new Date(from) > new Date(to)) return res.status(400).json({ error: 'From date must be before to date' });

  try {
    let allOrders = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?filter=creationdate:[${from}..${to}]&limit=${limit}&offset=${offset}`;
      const ebayRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          Accept: 'application/json',
        },
      });

      if (!ebayRes.ok) {
        const errBody = await ebayRes.json().catch(() => ({}));
        const errMsg = errBody?.errors?.[0]?.message
          || errBody?.error_description
          || `eBay returned HTTP ${ebayRes.status}`;
        if (ebayRes.status === 401) {
          return res.status(401).json({ error: 'Token expired or invalid. Generate a new one at developer.ebay.com.' });
        }
        return res.status(ebayRes.status).json({ error: clampText(errMsg, 300) });
      }

      const data = await ebayRes.json();
      const page = Array.isArray(data?.orders) ? data.orders : [];
      allOrders = allOrders.concat(page);
      if (page.length < limit || allOrders.length >= 1000) break;
      offset += limit;
    }

    const seen = new Set();
    const orders = [];
    for (const rawOrder of allOrders) {
      const order = normalizeOrder(rawOrder);
      const dedupeKey = order.orderId || `${order.date}|${order.title}|${order.sold}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      orders.push(order);
    }

    return res.status(200).json({ orders, total: orders.length });
  } catch (err) {
    console.error('eBay proxy error:', err);
    return res.status(500).json({ error: 'Server error: ' + (err?.message || 'Unknown error') });
  }
}
