/**
 * Lazada Affiliate
 * สถานะเอกสาร ณ ต.ค. 2026: Lazada ยังไม่เปิด endpoint สร้าง affiliate link ต่อสาธารณะ
 * จึงรองรับ 2 ทางเลือกที่ตั้งค่าได้:
 *   A) LAZADA_AFFILIATE_TEMPLATE — เทมเพลตจาก affiliate network ที่ได้รับอนุญาต เช่น
 *      https://network.co.th/aff/lazada?u={url}&subid1={subid1}&subid2={subid2}
 *   B) LAZADA_AFFILIATE_API_URL  — endpoint ของคุณเองรับ POST {url, sub_ids} -> { link }
 *   ไม่มีทั้งคู่ -> passthrough ไปหน้าสินค้าโดยตรง (ยังไม่มี commission) พร้อมบอกผู้ใช้ตรง ๆ
 */

export function lazadaStatus(env = process.env) {
  if (env.LAZADA_AFFILIATE_API_URL) return { mode: 'api', configured: true };
  if (env.LAZADA_AFFILIATE_TEMPLATE) return { mode: 'template', configured: true };
  return { mode: 'passthrough', configured: false };
}

/** เติมค่าลงในเทมเพลตอย่างปลอดภัย (encodeURIComponent ทุกค่า) */
export function applyTemplate(template, { url, subIds = [] }) {
  const map = {
    url: url,
    urlencode: encodeURIComponent(url),
    subid1: subIds[0] || '',
    subid2: subIds[1] || '',
    subid3: subIds[2] || '',
    subid4: subIds[3] || '',
    subid5: subIds[4] || '',
    subid: subIds.filter(Boolean).join('_'),
  };
  return template
    .replace(/\{(urlencode|url|subid\d?|subid)\}/gi, (whole, key) => {
      const k = key.toLowerCase();
      const v = map[k] ?? '';
      return k === 'url' || k === 'urlencode' ? encodeURIComponent(v) : encodeURIComponent(v);
    })
    .replace(/\{rawurl\}/g, url);
}

async function viaApi(env, url, subIds) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(env.LAZADA_AFFILIATE_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.LAZADA_AFFILIATE_API_KEY
          ? { authorization: `Bearer ${env.LAZADA_AFFILIATE_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({ url, sub_ids: subIds }),
      signal: ctl.signal,
    });
    if (!res.ok) throw Object.assign(new Error(`LAZADA_HTTP_${res.status}`), { code: 'LAZADA_HTTP_ERROR' });
    const data = await res.json();
    const link = data.link || data.affiliate_url || data.short_link;
    if (!link) throw Object.assign(new Error('LAZADA_NO_LINK'), { code: 'LAZADA_NO_LINK' });
    return link;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{link:string, mode:string}>}
 */
export async function generateLazadaLink({ url, subIds = [], env = process.env }) {
  const status = lazadaStatus(env);
  if (status.mode === 'api') {
    return { link: await viaApi(env, url, subIds), mode: 'api' };
  }
  if (status.mode === 'template') {
    return { link: applyTemplate(env.LAZADA_AFFILIATE_TEMPLATE, { url, subIds }), mode: 'template' };
  }
  return { link: url, mode: 'passthrough' };
}

export { applyTemplate as applyLazadaTemplate };