/**
 * URL Parser สำหรับลิงก์ Shopee / Lazada
 * ทำหน้าที่: ตรวจแพลตฟอร์ม -> ดึง productId -> จับคู่กับ Early Catalog
 */

const PLATFORMS = {
  shopee: {
    label: 'Shopee',
    hostSuffixes: ['shopee.co.th', 'shope.ee', 'shopee.sg', 'shopee.vn', 'shopee.my', 'shopee.co.id'],
    color: '#EE4D2D',
  },
  lazada: {
    label: 'Lazada',
    hostSuffixes: ['lazada.co.th', 'lazada.com', 'lazada.co.th', 'lazada.co.id', 'lazada.com.my', 'lazada.sg', 'lzd.co.th'],
    color: '#F37021',
  },
};

function matchHost(hostname, suffixes) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return suffixes.some((s) => host === s || host.endsWith('.' + s));
}

/**
 * @param {string} raw input จากผู้ใช้ อาจมีช่องว่าง / ไม่มี https
 * @returns {{ok:true, platform:'shopee'|'lazada', url:string, productId:string|null, label:string, color:string}
 *          |{ok:false, reason:string}}
 */
export function parseProductUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'empty' };
  }
  let candidate = raw.trim();
  // ผู้ใช้ไทยมักวางลิงก์ไร้ scheme
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid-protocol' };
  }

  let platform = null;
  for (const [key, def] of Object.entries(PLATFORMS)) {
    if (matchHost(parsed.hostname, def.hostSuffixes)) {
      platform = key;
      break;
    }
  }
  if (!platform) return { ok: false, reason: 'unsupported-host' };

  const def = PLATFORMS[platform];
  const productId = platform === 'shopee' ? extractShopeeId(parsed) : extractLazadaId(parsed);

  // normalize เป็น https
  parsed.protocol = 'https:';

  return {
    ok: true,
    platform,
    url: parsed.toString(),
    productId,
    label: def.label,
    color: def.color,
  };
}

/** รูปแบบที่พบจริง: /product/<shopId>/<itemId> หรือ /products/<shopId>.<itemId> หรือ /product/<itemId> */
function extractShopeeId(parsed) {
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[0] === 'product' || parts[0] === 'products') {
    if (parts[1] && parts[2]) return parts[2];
    if (parts[1]) {
      const m = parts[1].match(/(\d{5,})/);
      if (m) return m[1];
    }
  }
  // shope.ee short link ไม่เปิดเผย itemId -> ใช้ ref จาก query ถ้ามี
  const q = parsed.searchParams.get('sp_atk') || parsed.searchParams.get('itemId');
  if (q) return q;
  return null;
}

/** รูปแบบที่พบจริง: <slug>-i<itemId>.html หรือ i<itemId> ใน query/path */
function extractLazadaId(parsed) {
  const last = parsed.pathname.split('/').filter(Boolean).pop();
  if (last) {
    const m = last.match(/-i(\d+)(?:\.html)?$/i) || last.match(/^i(\d+)$/i);
    if (m) return m[1];
  }
  const q = parsed.searchParams.get('itemId') || parsed.searchParams.get('i');
  return q ? String(q).replace(/\D/g, '') || null : null;
}

export { PLATFORMS };