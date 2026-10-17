/**
 * ราคาสด (Live price)
 * ไม่มี PRICE_API_URL -> คืน {} เพื่อใช้ราคาจาก Early Catalog
 * มี -> เรียก POST {url} แบบ parallel โดยมี timeout และ fail-soft ทุกกรณี
 */

const TIMEOUT_MS = 6000;

export function livePriceEnabled(env = process.env) {
  return Boolean(env.PRICE_API_URL);
}

export function priceSource(env = process.env) {
  return livePriceEnabled(env)
    ? { mode: 'live', label: 'ราคาสดจาก API ที่ตั้งค่าไว้' }
    : { mode: 'catalog', label: 'ราคาจาก Early Catalog (ตั้งค่า PRICE_API_URL เพื่อขึ้นราคาจริง)' };
}

async function fetchOne(apiUrl, apiKey, url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ url }),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = Number(data.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return price;
  } catch {
    return null; // fail-soft: 退回 Early Catalog
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Array<{id:string, shopeeUrl:string, lazadaUrl:string}>} products
 * @returns {Promise<Record<string,{shopee?:number,lazada?:number}>>}
 */
export async function fetchLivePrices(products, env = process.env) {
  if (!livePriceEnabled(env) || !products.length) return {};
  const api = env.PRICE_API_URL;
  const key = env.PRICE_API_KEY || '';
  const jobs = [];
  for (const p of products) {
    jobs.push(
      fetchOne(api, key, p.shopeeUrl).then((v) => [p.id, 'shopee', v]),
      fetchOne(api, key, p.lazadaUrl).then((v) => [p.id, 'lazada', v]),
    );
  }
  const results = await Promise.all(jobs);
  const out = {};
  for (const [id, side, value] of results) {
    if (value == null) continue;
    (out[id] ||= {})[side] = value;
  }
  return out;
}