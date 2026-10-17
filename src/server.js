/**
 * PriceHub TH — เว็บเปรียบเทียบราคาสินค้า Shopee x Lazada
 * หน้าที่: เสิร์ฟ UI + API (catalog, compare, affiliate convert) + redirect /go สำหรับนับคลิก
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';
import { CATEGORIES, CURRENCY, DISCLAIMER, CATALOG_UPDATED, query, decorate, findById, findByPlatformProductId, recommend, categoryOf } from './lib/catalog.js';
import { priceSource, fetchLivePrices, livePriceEnabled } from './lib/prices.js';
import { convert, affiliateStatus, recordClick, clickStats, resolveRedirect } from './affiliate/index.js';
import { parseProductUrl } from './lib/urls.js';

loadEnv();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '../public');
const PORT = Number(process.env.PORT || 4173);
const SITE_NAME = process.env.SITE_NAME || 'PriceHub TH';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/** ราคาสด (fail-soft ทุกกรณี) */
async function liveFor(list) {
  if (!livePriceEnabled()) return {};
  try {
    return await fetchLivePrices(list);
  } catch {
    return {};
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, site: SITE_NAME, time: new Date().toISOString() });
});

/** หมวดหมู่ + สถานะระบบ ใช้โหลดครั้งแรกตอนเปิดเว็บ */
app.get('/api/bootstrap', async (_req, res) => {
  const live = await liveFor(query({}));
  res.json({
    site: SITE_NAME,
    currency: CURRENCY,
    disclaimer: DISCLAIMER,
    updated: CATALOG_UPDATED,
    categories: CATEGORIES,
    priceSource: priceSource(),
    status: affiliateStatus(),
    stats: clickStats(),
    products: query({ sort: 'diff' }, live),
  });
});

/** รายการสินค้าตามตัวกรอง */
app.get('/api/products', async (req, res) => {
  const { category = 'all', q = '', sort = 'diff' } = req.query;
  const base = query({ category, q, sort });
  const live = await liveFor(base);
  res.json({
    total: base.length,
    categories: CATEGORIES,
    currency: CURRENCY,
    products: query({ category, q, sort }, live),
  });
});

/** รายชื่อหมวดหมู่สำหรับ UI */
app.get('/api/categories', (_req, res) => {
  res.json({ categories: CATEGORIES, currency: CURRENCY });
});

app.get('/api/products/:id', async (req, res) => {
  const p = findById(req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'not-found' });
  const live = await liveFor([p]);
  res.json({ ok: true, currency: CURRENCY, product: decorate(p, live) });
});

/**
 * หัวใจของระบบ: วางลิงก์ Shopee/Lazada -> แปลงเป็นลิงก์ affiliate พร้อม SubID
 * Body: { url, category?, ref? }
 */
app.post('/api/convert', async (req, res) => {
  try {
    const { url = '', category, ref } = req.body || {};
    const parsedValid = parseProductUrl(url);
    if (!parsedValid.ok) {
      const messages = {
        empty: 'กรุณาวางลิงก์สินค้า',
        'invalid-url': 'ลิงก์ไม่ถูกต้อง',
        'unsupported-host': 'รองรับเฉพาะลิงก์ Shopee และ Lazada เท่านั้น',
        'invalid-protocol': 'ต้องเป็นลิงก์ http/https',
      };
      return res.status(400).json({ ok: false, error: parsedValid.reason, message: messages[parsedValid.reason] });
    }

    // คาดเดาหมวดหมู่จาก catalog ก่อน เพื่อใส่ SubID ให้แม่นยำ
    const matched = findByPlatformProductId(parsedValid.platform, parsedValid.productId);
    const result = await convert({
      url,
      category: category || matched?.category || 'uncategorized',
      ref: ref || matched?.id,
    });

    // ถ้าจับคู่กับ Early Catalog ได้ -> ส่งข้อมูลเปรียบเทียบทั้งสองฝั่งกลับไปด้วย
    if (matched) {
      const live = await liveFor([matched]);
      result.product = decorate(matched, live);
      result.matched = true;
    } else {
      result.matched = false;
      result.suggestions = recommend({ limit: 4 }).map((p) => decorate(p));
    }
    res.json(result);
  } catch (e) {
    console.error('[convert]', e);
    res.status(500).json({ ok: false, error: 'server-error' });
  }
});

/**
 * ปลายทางที่ปุ่ม "สั่งซื้อที่ ..." ชี้เข้ามา: นับคลิกแล้ว 302 ไปลิงก์ affiliate
 * รูปแบบ: /go/:platform/:id
 */
app.get('/go/:platform/:id', (req, res) => {
  const { platform, id } = req.params;
  const target = resolveRedirect(id);
  if (!target || !['shopee', 'lazada'].includes(platform)) {
    return res.redirect(302, '/?error=link-expired');
  }
  const state = req.query.state;
  recordClick({ platform, productId: id, category: state || null, mode: target.mode || 'cached' });
  res.set('referrer-policy', 'no-referrer');
  res.redirect(302, target.url);
});

/** สถิติคลิก (สำหรับแดชบอร์ดเล็ก ๆ ด้านล่างหน้าเว็บ) */
app.get('/api/stats', (_req, res) => {
  res.json({ ok: true, stats: clickStats(), status: affiliateStatus(), priceSource: priceSource() });
});

/** หน้าหมวดหมู่ที่รองรับ SEO ปลายทาง ถ้าไม่พบ category ก็คืนหน้าแรก */
app.get('/c/:slug', (req, res) => {
  if (!categoryOf(req.params.slug)) return res.redirect(302, '/');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ ok: false, error: 'server-error' });
});

const server = app.listen(PORT, () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PORT;
  const url = `http://localhost:${port}`;
  console.log(`\n  ${SITE_NAME} → ${url}`);
  console.log(
    `  ราคา: ${priceSource().mode} | Shopee API: ${affiliateStatus().shopee.configured ? 'พร้อม' : 'ยังไม่ตั้งค่า'}`,
  );
  if (!livePriceEnabled()) console.log('  (ตั้งค่า PRICE_API_URL ในไฟล์ .env เพื่อขึ้นราคาจริง)');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[error] พอร์ต ${PORT} ถูกใช้งานแล้ว — เปลี่ยนด้วย PORT=xxxx npm start`);
    process.exit(1);
  }
  throw err;
});