/**
 * Unit tests: URL parsing, SubID binding, provider templates, catalog comparison, secret hygiene
 * Run with: npm test (node --test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { parseProductUrl } from '../src/lib/urls.js';
import { generateSubIds, affiliateStatus } from '../src/affiliate/index.js';
import { applyTemplate, lazadaStatus } from '../src/affiliate/lazada.js';
import { buildMutation, signPayload, isShopeeConfigured } from '../src/affiliate/shopee.js';
import {
  query,
  decorate,
  findByPlatformProductId,
  categoryOf,
  compare,
  CATEGORIES,
  CURRENCY,
} from '../src/lib/catalog.js';

test('parseProductUrl: detects shopee.co.th item id', () => {
  const r = parseProductUrl('https://shopee.co.th/product/1000001/220000001');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'shopee');
  assert.equal(r.productId, '220000001');
});

test('parseProductUrl: accepts input without scheme', () => {
  const r = parseProductUrl('shopee.co.th/product/1/2');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'shopee');
});

test('parseProductUrl: detects lazada item id (-i<id>.html)', () => {
  const r = parseProductUrl('https://www.lazada.co.th/products/wireless-earbuds-pro2-i1000001.html');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'lazada');
  assert.equal(r.productId, '1000001');
});

test('parseProductUrl: rejects unsupported host / empty / garbage', () => {
  assert.equal(parseProductUrl('https://example.com/a').ok, false);
  assert.equal(parseProductUrl('').ok, false);
  assert.equal(parseProductUrl('not a url').ok, false);
});

test('generateSubIds: exactly 3 slots, all safe characters', () => {
  const s = generateSubIds({ siteName: 'PriceHub TH', category: 'electronics!', productId: 'AirPods Pro' });
  assert.equal(s.length, 3);
  assert.ok(s[0].includes('pricehub'));
  assert.ok(s.every((x) => /^[-a-z0-9_]+$/.test(x)));
});

test('buildMutation: escapes quotes and includes subIds', () => {
  const q = buildMutation('https://a.com/x"y', ['gas', 'cat-1']);
  assert.ok(q.includes('generateShortLink'));
  assert.ok(q.includes('\\"'));
  assert.ok(q.includes('"gas"'));
});

test('signPayload: SHA256(appId + timestamp + body + secret)', () => {
  const expected = createHash('sha256').update('1100{}sec', 'utf8').digest('hex');
  assert.equal(signPayload('1', 'sec', '100', '{}'), expected);
});

test('lazadaStatus: passthrough when nothing configured', () => {
  assert.equal(lazadaStatus({}).mode, 'passthrough');
  assert.equal(lazadaStatus({}).configured, false);
  assert.equal(lazadaStatus({ LAZADA_AFFILIATE_TEMPLATE: 'x' }).configured, true);
  assert.equal(lazadaStatus({ LAZADA_AFFILIATE_API_URL: 'https://x' }).mode, 'api');
});

test('applyTemplate: encodes {url} and fills subids', () => {
  const out = applyTemplate('https://n.co/l?u={url}&s={subid1}&t={subid2}', {
    url: 'https://www.lazada.co.th/products/a-b-i1.html',
    subIds: ['pricehub', 'home'],
  });
  assert.ok(out.includes('i1.html'));
  assert.ok(out.includes('pricehub'));
  assert.ok(!out.includes('{url}'));
  assert.ok(out.includes('home'));
});

test('isShopeeConfigured: needs both credential halves', () => {
  assert.equal(isShopeeConfigured({}), false);
  assert.equal(isShopeeConfigured({ SHOPEE_APP_ID: '1' }), false);
  assert.equal(isShopeeConfigured({ SHOPEE_APP_ID: '1', SHOPEE_SECRET: 'x' }), true);
});

test('affiliateStatus: never leaks the secret', () => {
  const s = affiliateStatus({ SHOPEE_APP_ID: '1', SHOPEE_SECRET: 'topsecretvalue' });
  assert.equal(s.shopee.configured, true);
  assert.ok(!JSON.stringify(s).includes('topsecretvalue'));
});

test('catalog: >= 20 products, every one has paired prices and a valid category', () => {
  const all = query({});
  assert.ok(all.length >= 20);
  for (const p of all) {
    assert.ok(p.shopeePrice > 0, p.id);
    assert.ok(p.lazadaPrice > 0, p.id);
    assert.ok(categoryOf(p.category), `missing category for ${p.id}`);
    assert.ok(['shopee', 'lazada', 'tie'].includes(p.compare.cheaper));
    assert.equal(CURRENCY, 'THB');
  }
});

test('catalog: category slugs are unique and referenced by products', () => {
  const slugs = new Set(CATEGORIES.map((c) => c.slug));
  assert.equal(slugs.size, CATEGORIES.length);
  assert.equal(CATEGORIES.length, 8);
});

test('catalog: reverse lookup by platform product id', () => {
  const s = findByPlatformProductId('shopee', '220000001');
  assert.equal(s?.id, 'airpods-pro-2');
  const l = findByPlatformProductId('lazada', '1000001');
  assert.equal(l?.id, 'airpods-pro-2');
});

test('compare: picks the cheaper platform and computes the gap', () => {
  const c = compare({ shopeePrice: 100, lazadaPrice: 90 });
  assert.equal(c.cheaper, 'lazada');
  assert.equal(c.diff, 10);
  assert.equal(c.savePercent, 10);
  assert.equal(compare({ shopeePrice: 50, lazadaPrice: 50 }).cheaper, 'tie');
});

test('decorate: attaches Thai category name and icon', () => {
  const base = query({ category: 'home' })[0];
  assert.ok(base);
  const p = decorate(base);
  assert.equal(p.categoryName, 'บ้านและอุปกรณ์ไฟฟ้า');
  assert.equal(p.categoryIcon, '🏠');
});