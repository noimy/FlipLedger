/**
 * FlipLedger — eBay API Proxy
 * Vercel serverless function that relays requests to eBay's API.
 * This exists purely to get around CORS — the browser can't call eBay
 * directly, so it calls this endpoint instead, which calls eBay server-side.
 */

export default async function handler(req, res) {
  // Allow requests from anywhere (your own frontend)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, fromDate, toDate } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing eBay token' });
  }

  try {
    const from = new Date(fromDate).toISOString();
    const to   = new Date(toDate + 'T23:59:59').toISOString();

    // Paginate through all orders
    let allOrders = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const url = `https://api.ebay.com/sell/fulfillment/v1/order?` +
        `filter=creationdate:[${from}..${to}]` +
        `&limit=${limit}&offset=${offset}`;

      const ebayRes = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json',
        }
      });

      if (!ebayRes.ok) {
        const errBody = await ebayRes.json().catch(() => ({}));
        const errMsg  = errBody?.errors?.[0]?.message
                     || errBody?.error_description
                     || `eBay returned HTTP ${ebayRes.status}`;

        // Token expired — tell the frontend clearly
        if (ebayRes.status === 401) {
          return res.status(401).json({ error: 'Token expired or invalid. Generate a new one at developer.ebay.com.' });
        }

        return res.status(ebayRes.status).json({ error: errMsg });
      }

      const data = await ebayRes.json();
      const page = data.orders || [];
      allOrders  = allOrders.concat(page);

      // Stop if we got fewer than the limit (last page)
      if (page.length < limit) break;
      offset += limit;

      // Safety cap — no more than 1000 orders per sync
      if (allOrders.length >= 1000) break;
    }

    // Normalise each order into the shape FlipLedger expects
    const orders = allOrders.map(o => {
      const lineItem  = o.lineItems?.[0] || {};
      const pricing   = o.pricingSummary || {};

      const title    = lineItem.title || 'eBay Item';
      const sold     = parseFloat(pricing.total?.value             || lineItem.lineItemCost?.value || 0);
      const shipping = parseFloat(pricing.deliveryCost?.value      || 0);
      const salestax = parseFloat(pricing.tax?.value               || 0);
      const txfee    = parseFloat(o.totalMarketplaceFee?.value     || 0);
      const date     = (o.creationDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const orderId  = o.orderId || '';
      const buyer    = o.buyer?.username || '';

      return {
        orderId,
        title,
        date,
        platform : 'eBay',
        sold,
        cogs     : 0,        // user fills this in
        shipping,
        salestax,
        txfee,
        adfee    : 0,
        otherfee : 0,
        notes    : orderId ? `eBay Order: ${orderId}` : '',
        buyer,
        photos   : []
      };
    });

    return res.status(200).json({ orders, total: orders.length });

  } catch (err) {
    console.error('eBay proxy error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
