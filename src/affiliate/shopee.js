/**
 * Shopee Affiliate Open API (GraphQL)
 * Endpoint จริงของไทย: https://open-api.affiliate.shopee.co.th/graphql
 * Mutation: generateShortLink(input: { originUrl, subIds }) -> { shortLink }
 *
 * การยืนยันตัวตน (สเปกที่เผยแพร่ต่อสาธารณะ ควรยืนยันอีกครั้งกับเอกสารในบัญชี Affiliate):
 *   Signature = SHA256(AppId + Timestamp + Payload + Secret)   Payload = ตัว string ของ body ที่ส่งจริง
 *   Authorization: SHA256 Credential={appId}, Timestamp={unixSeconds}, Signature={hex}
 *
 * ค่า AppId/Secret ห้ามหลุดออกนอกเซิร์ฟเวอร์นี้เด็ดขาด
 */
import { createHash } from 'node:crypto';

const DEFAULT_ENDPOINT = 'https://open-api.affiliate.shopee.co.th/graphql';

export function isShopeeConfigured(env = process.env) {
  return Boolean(env.SHOPEE_APP_ID && env.SHOPEE_SECRET);
}

export function shopeeEndpoint(env = process.env) {
  return env.SHOPEE_GRAPHQL_URL || DEFAULT_ENDPOINT;
}

/** สร้างลายเซ็น SHA256 ตามข้อกำหนดของ Shopee Affiliate API */
export function signPayload(appId, secret, timestamp, body) {
  return createHash('sha256')
    .update(appId + timestamp + body + secret, 'utf8')
    .digest('hex');
}

/** ประกอบ GraphQL query ที่ escape ปลอดภัย */
export function buildMutation(originUrl, subIds = []) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const subs = subIds.filter(Boolean).slice(0, 5);
  const subPart = subs.length
    ? `, subIds: [${subs.map((s) => `"${esc(s)}"`).join(', ')}]`
    : '';
  return `mutation { generateShortLink(input: { originUrl: "${esc(originUrl)}"${subPart} }) { shortLink } }`;
}

/**
 * แปลงลิงก์สินค้าธรรมดา -> ลิงก์ Affiliate (shope.ee)
 * @returns {Promise<string>}
 * @throws {Error} เมื่อ credential ผิด / endpoint ตอบไม่สำเร็จ
 */
export async function generateShopeeLink({ url, subIds = [] }, env = process.env) {
  if (!isShopeeConfigured(env)) {
    const err = new Error('SHOPEE_NOT_CONFIGURED');
    err.code = 'SHOPEE_NOT_CONFIGURED';
    throw err;
  }
  const appId = env.SHOPEE_APP_ID;
  const secret = env.SHOPEE_SECRET;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ query: buildMutation(url, subIds) });
  const signature = signPayload(appId, secret, timestamp, body);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(shopeeEndpoint(env), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body,
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`SHOPEE_HTTP_${res.status}: ${text.slice(0, 200)}`);
      err.code = 'SHOPEE_HTTP_ERROR';
      throw err;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error('SHOPEE_BAD_RESPONSE');
      err.code = 'SHOPEE_BAD_RESPONSE';
      throw err;
    }
    if (json.errors?.length) {
      const err = new Error(`SHOPEE_GRAPHQL: ${json.errors[0].message}`);
      err.code = 'SHOPEE_GRAPHQL_ERROR';
      throw err;
    }
    const link = json.data?.generateShortLink?.shortLink;
    if (!link) {
      const err = new Error('SHOPEE_NO_LINK');
      err.code = 'SHOPEE_NO_LINK';
      throw err;
    }
    return link;
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('SHOPEE_TIMEOUT');
      err.code = 'SHOPEE_TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}