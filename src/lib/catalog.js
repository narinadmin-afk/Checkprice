/**
 * Early Catalog: อ่าน data/catalog.json แล้วให้บริการ query / เปรียบเทียบราคา
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(HERE, '../../data/catalog.json');

const raw = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

export const CURRENCY = raw.currency || 'THB';
export const DISCLAIMER = raw.disclaimer || '';
export const CATEGORIES = raw.categories;
export const CATALOG_UPDATED = raw.updated;

const byId = new Map(raw.products.map((p) => [p.id, p]));
const byShopeeProductId = new Map();
const byLazadaProductId = new Map();
for (const p of raw.products) {
  if (p.shopeeProductId) byShopeeProductId.set(String(p.shopeeProductId), p);
  if (p.lazadaProductId) byLazadaProductId.set(String(p.lazadaProductId), p);
}

export function categoryOf(slug) {
  return CATEGORIES.find((c) => c.slug === slug) || null;
}

/** สรุปราคาทั้ง 2 ฝั่ง + แพลตฟอร์มที่ถูกกว่า */
export function compare(p) {
  const s = p.shopeePrice;
  const l = p.lazadaPrice;
  const diff = Math.abs(s - l);
  const cheaper = s === l ? 'tie' : s < l ? 'shopee' : 'lazada';
  const base = Math.max(s, l);
  const savePercent = base > 0 ? Math.round((diff / base) * 1000) / 10 : 0;
  return {
    shopeePrice: s,
    lazadaPrice: l,
    diff,
    cheaper,
    savePercent,
    lowest: Math.min(s, l),
    highest: Math.max(s, l),
  };
}

/** คืน product พร้อม object เปรียบเทียบ และชื่อหมวดภาษาไทย */
export function decorate(p, live = {}) {
  const livePrices = live[p.id] || {};
  const out = {
    ...p,
    shopeePrice: livePrices.shopee ?? p.shopeePrice,
    lazadaPrice: livePrices.lazada ?? p.lazadaPrice,
  };
  out.compare = compare(out);
  const cat = categoryOf(p.category);
  out.categoryName = cat ? cat.name : 'ไม่ระบุหมวดหมู่';
  out.categoryIcon = cat ? cat.icon : '🏷️';
  out.live = Boolean(livePrices.shopee || livePrices.lazada);
  return out;
}

export function findById(id) {
  return byId.get(id) || null;
}

export function findByPlatformProductId(platform, productId) {
  if (!productId) return null;
  return platform === 'shopee'
    ? byShopeeProductId.get(String(productId)) || null
    : byLazadaProductId.get(String(productId)) || null;
}

/**
 * @param {{category?:string, q?:string, sort?:string, platform?:string}} opts
 */
export function query({ category, q, sort } = {}, live = {}) {
  let list = raw.products.slice();
  if (category && category !== 'all') list = list.filter((p) => p.category === category);
  if (q) {
    const needle = q.trim().toLowerCase();
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.spec || '').toLowerCase().includes(needle) ||
        p.id.includes(needle),
    );
  }
  const decorated = list.map((p) => decorate(p, live));

  switch (sort) {
    case 'price-asc':
      decorated.sort((a, b) => a.compare.lowest - b.compare.lowest);
      break;
    case 'price-desc':
      decorated.sort((a, b) => b.compare.lowest - a.compare.lowest);
      break;
    case 'diff':
      decorated.sort((a, b) => b.compare.savePercent - a.compare.savePercent);
      break;
    case 'name':
      decorated.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      break;
    default:
      decorated.sort((a, b) => b.compare.savePercent - a.compare.savePercent);
  }
  return decorated;
}

/** สินค้าแนะนำ: ถ้ารู้ตัวสินค้าให้เน้นหมวดเดียวกัน */
export function recommend({ category, excludeId, limit = 4 } = {}) {
  let pool = raw.products.filter((p) => p.id !== excludeId);
  if (category) {
    const same = pool.filter((p) => p.category === category);
    if (same.length) pool = same;
  }
  const sorted = pool
    .map((p) => ({ p, diff: Math.abs(p.shopeePrice - p.lazadaPrice) }))
    .sort((a, b) => b.diff - a.diff)
    .map((x) => x.p);
  return sorted.slice(0, limit);
}

export { raw as catalogRaw };