/**
 * Affiliate controller: แปลงลิงก์ + cache + click log + รายงานสถานะ
 *
 * Workflow
 *   1. ผู้ใช้วางลิงก์สินค้า
 *   2. parse -> รู้ platform + productId -> จับคู่กับ Early Catalog (ถ้ามี)
 *   3. generateSubIds(slot, category, productId) -> ยิง provider ของแพลตฟอร์มนั้น
 *   4. ได้ affiliate URL เก็บลง cache เพื่อไม่ให้ยิง API ซ้ำ
 *   5. ปุ่ม "สั่งซื้อที่ ..." ชี้มาที่ /go/... ซึ่ง log การคลิกแล้ว 302 ไปยัง affiliate URL
 */
import { parseProductUrl } from '../lib/urls.js';
import { generateShopeeLink, isShopeeConfigured } from './shopee.js';
import { generateLazadaLink, lazadaStatus } from './lazada.js';

const SLOT_1 = process.env.AFFILIATE_SLOT_1 || 'pricehub';

/** subIds สูงสุด 5 ช่องตามข้อกำหนด Shopee: [slot, category, ref] */
export function generateSubIds({ siteName = 'pricehub', category, productId } = {}) {
  const safe = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .slice(0, 40);
  return [safe(siteName || SLOT_1), safe(category) || 'uncategorized', safe(productId) || 'unknown']
    .filter(Boolean)
    .slice(0, 5);
}

/** cache แบบ in-memory × 24 ชม. กันโควตาหมดเร็ว */
const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;

function cacheKey(platform, url, subIds) {
  return `${platform}|${url}|${subIds.join(',')}`;
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size > 5000) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { value, exp: Date.now() + TTL });
}

/** สถานะระบบให้ UI แสดง (ไม่มีการเปิดเผยค่า secret ออกมาเด็ดขาด) */
export function affiliateStatus(env = process.env) {
  const shopeeConfigured = isShopeeConfigured(env);
  const lazada = lazadaStatus(env);
  return {
    shopee: {
      configured: shopeeConfigured,
      mode: shopeeConfigured ? 'graphql' : 'passthrough',
      label: shopeeConfigured ? 'เชื่อมต่อ Shopee Affiliate แล้ว (GraphQL)' : 'ยังไม่ได้ใส่ SHOPEE_APP_ID / SECRET',
      action: shopeeConfigured ? null : 'ขอ API ที่ affiliate.shopee.co.th/open_api แล้วใส่ใน .env',
      endpoint: env.SHOPEE_GRAPHQL_URL || 'https://open-api.affiliate.shopee.co.th/graphql',
    },
    lazada: {
      configured: lazada.configured,
      mode: lazada.mode,
      label: lazada.mode === 'api'
        ? 'เชื่อมต่อ Lazada ผ่าน API ที่ตั้งค่าไว้'
        : lazada.mode === 'template'
          ? 'ใช้ affiliate template ที่ตั้งค่าไว้'
          : 'ยังไม่มี LAZADA_AFFILIATE_TEMPLATE/API — ลิงก์จะชี้ตรงไปหน้าสินค้า',
      action: lazada.configured ? null : 'สมัครที่ lazada.co.th/lazada-affiliate-program แล้วใส่เทมเพลตใน .env',
    },
    subIdTemplate: ['<slot-1>', '<category-slug>', '<product-ref>'],
  };
}

const clickLog = []; // เก็บล่าสุด 500 คลิกในหน่วยความจำ
const clickCounts = { shopee: 0, lazada: 0 };
const redirects = new Map(); // shortKey -> { platform, url }

export function recordClick({ platform, productId, category, mode }) {
  clickCounts[platform] = (clickCounts[platform] || 0) + 1;
  clickLog.push({
    at: new Date().toISOString(),
    platform,
    productId: productId || null,
    category: category || null,
    mode,
  });
  if (clickLog.length > 500) clickLog.shift();
  return clickLog.length;
}

export function clickStats() {
  return {
    total: clickCounts.shopee + clickCounts.lazada,
    byPlatform: { shopee: clickCounts.shopee || 0, lazada: clickCounts.lazada || 0 },
    recent: clickLog.slice(-12).reverse(),
  };
}

/** แปลง URL ผู้ใช้ -> object ที่ UI ใช้แสดงปุ่มทันที */
export async function convert({ url, category, ref }, env = process.env) {
  const parsed = parseProductUrl(url);
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason };
  }
  const siteName = env.SITE_NAME || 'pricehub';
  const subIds = generateSubIds({
    siteName,
    category: category || 'uncategorized',
    productId: ref || parsed.productId || 'unknown',
  });

  const key = cacheKey(parsed.platform, parsed.url, subIds);
  const cached = cacheGet(key);
  let entry = cached;

  if (!entry) {
    const built = await buildAffiliateLink(parsed, { subIds, env });
    entry =
      typeof built === 'string'
        ? { link: built, mode: modeOf(parsed.platform, env), error: null }
        : built;
    entry.builtAt = new Date().toISOString();
    if (entry.mode !== 'passthrough') cacheSet(key, entry);
  }

  const result = {
    ok: true,
    platform: parsed.platform,
    platformLabel: parsed.label,
    originalUrl: parsed.url,
    productId: parsed.productId,
    subIds,
    affiliateUrl: entry.link,
    mode: entry.mode,
    providerError: entry.error || null,
    fromCache: Boolean(cached),
    builtAt: entry.builtAt,
    status: affiliateStatus(env),
    warnings: [],
  };

  if (result.mode === 'passthrough') {
    result.warnings.push(
      parsed.platform === 'shopee'
        ? 'ยังไม่ได้ตั้งค่า SHOPEE_APP_ID / SHOPEE_SECRET ระบบจึงยังเชื่อมลิงก์ affiliate ไม่ได้'
        : 'ยังไม่ได้ตั้งค่า LAZADA_AFFILIATE_TEMPLATE / API ระบบจึงชี้ลิงก์ตรงไปหน้าสินค้า',
    );
    if (result.providerError) result.warnings.push(`provider: ${result.providerError}`);
  }

  const registered = registerRedirect(parsed.platform, result.affiliateUrl);
  result.goPath = `/go/${parsed.platform}/${registered}`;

  return result;
}

function modeOf(platform, env) {
  if (platform === 'shopee') return isShopeeConfigured(env) ? 'graphql' : 'passthrough';
  return lazadaStatus(env).mode;
}

async function buildAffiliateLink(parsed, { subIds, env }) {
  if (parsed.platform === 'shopee') {
    try {
      const link = await generateShopeeLink({ url: parsed.url, subIds }, env);
      return link; // string
    } catch (e) {
      // fail-soft: API ล่ม/ไม่ได้สิทธิ์ -> ไม่ให้เว็บล่ม ใช้ลิงก์เดิมพร้อมแจ้งเตือน
      return { link: parsed.url, mode: 'passthrough', error: e.code || e.message };
    }
  }
  return generateLazadaLink({ url: parsed.url, subIds, env });
}

function registerRedirect(platform, target) {
  const id = `${platform}-${hashString(target).toString(36)}`;
  redirects.set(id, { platform, url: target });
  return id;
}

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

export function resolveRedirect(id) {
  return redirects.get(id) || null;
}

export function cacheStats() {
  return { size: cache.size, redirects: redirects.size };
}