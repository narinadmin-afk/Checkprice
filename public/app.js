/**
 * PriceHub TH — front-end
 * หน้าที่: โหลด catalog, แสดงตามหมวดหมู่, รับลิงก์ผู้ใช้ -> เรียก /api/convert
 *          และยิงปุ่ม "สั่งซื้อที่ ..." ผ่าน /go/... เพื่อให้นับคลิกได้จริง
 */

const $ = (sel, root = document) => root.querySelector(sel);
const fmt = (n) =>
  new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(n);

const state = {
  site: 'PriceHub TH',
  currency: 'THB',
  products: [],
  categories: [],
  status: null,
  priceSource: null,
  category: 'all',
  sort: 'diff',
  q: '',
};

/* ---------------- boot ---------------- */
async function boot() {
  try {
    const res = await fetch('/api/bootstrap');
    const data = await res.json();
    state.site = data.site;
    state.currency = data.currency;
    state.categories = data.categories;
    state.products = data.products;
    state.status = data.status;
    state.priceSource = data.priceSource;
    serverStats = data.stats;

    renderChips();
    renderCatalog();
    renderStatus();
    renderStats();
    $('#disclaimer').textContent = data.disclaimer || '';
    document.title = `${data.site} — เทียบราคา Shopee x Lazada`;
  } catch (e) {
    toast('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ', true);
  }
}

let serverStats = { byPlatform: { shopee: 0, lazada: 0 }, total: 0, recent: [] };

/* ---------------- status / stats ---------------- */
function renderStatus() {
  const s = state.status;
  const ps = state.priceSource;
  $('#statPrice').textContent = ps ? ps.label : '—';

  const setBadge = (el, conf, label) => {
    el.textContent = label;
    el.className = 'v ' + (conf ? 'ok' : 'warn');
  };
  setBadge($('#statShopee'), s.shopee.configured, s.shopee.configured ? 'เชื่อมต่อแล้ว (GraphQL)' : 'ยังไม่ได้ตั้งค่า');
  setBadge($('#statLazada'), s.lazada.configured, s.lazada.configured ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้ตั้งค่า');

  const ready = s.shopee.configured && s.lazada.configured;
  const top = $('#topStatus');
  top.classList.toggle('ok', ready);
  top.innerHTML = `<span class="dot"></span> ${
    ready ? 'Affiliate พร้อมใช้งาน' : 'โหมดสาธิต — ยังไม่ได้ใส่กุญแจ affiliate'
  }`;
  $('#hintText').textContent = s.shopee.configured
    ? 'ระบบจะสร้างลิงก์ affiliate พร้อม SubID ให้ทันที'
    : 'ใส่ SHOPEE_APP_ID / SHOPEE_SECRET ใน .env เพื่อเปิดโหมดลิงก์ affiliate จริง';
}

function renderStats() {
  const b = serverStats.byPlatform || { shopee: 0, lazada: 0 };
  $('#statClicks').textContent = serverStats.total ?? 0;
  $('#clickShopee').textContent = b.shopee;
  $('#clickLazada').textContent = b.lazada;
  $('#clickTotal').textContent = serverStats.total ?? 0;

  const recent = serverStats.recent || [];
  const wrap = $('#recentClicks');
  if (!recent.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const ul = $('#recentClicks ul');
  ul.innerHTML = recent
    .map(
      (c) => `<li>
        <span class="badge plat-${c.platform}">${c.platform === 'shopee' ? 'Shopee' : 'Lazada'}</span>
        <span>${c.productId || '-'}</span>
        <span class="t">${new Date(c.at).toLocaleString('th-TH')}</span>
      </li>`,
    )
    .join('');
}

async function refreshStats() {
  try {
    const r = await fetch('/api/stats');
    const d = await r.json();
    serverStats = d.stats;
    state.status = d.status;
    renderStats();
    renderStatus();
  } catch { /* เงียบไว้ ไม่ให้รบกวน UX */ }
}

/* ---------------- catalog ---------------- */
function renderChips() {
  const el = $('#catChips');
  const all = [{ slug: 'all', name: 'ทั้งหมด', icon: '🛒' }, ...state.categories];
  el.innerHTML = all
    .map(
      (c) =>
        `<button class="chip ${c.slug === state.category ? 'active' : ''}" data-cat="${c.slug}" role="tab">
          <span>${c.icon}</span>${c.name}
        </button>`,
    )
    .join('');
}

function priceRow(side, product) {
  const isShopee = side === 'shopee';
  const price = isShopee ? product.compare.shopeePrice : product.compare.lazadaPrice;
  const best = product.compare.cheaper === side;
  return `<div class="row ${best ? 'best' : ''}">
      <span class="who"><i class="${isShopee ? 's' : 'l'}"></i>${isShopee ? 'Shopee' : 'Lazada'}</span>
      <span class="amt">${fmt(price)}</span>
    </div>`;
}

function cardHTML(p) {
  const c = p.compare;
  const diffText =
    c.cheaper === 'tie'
      ? `ราคาเท่ากันพอดี ทั้งสองแพลตฟอร์ม`
      : `${c.cheaper === 'shopee' ? 'Shopee' : 'Lazada'} ถูกกว่า ${fmt(c.diff)} (${c.savePercent}%)`;
  return `<article class="card" data-id="${p.id}">
    <div class="card-top">
      <div class="thumb">${p.icon}</div>
      <div>
        <span class="tag">${p.categoryIcon} ${p.categoryName}</span>
        <p class="cname">${p.name}</p>
        <p class="cspec">${p.spec || ''}</p>
      </div>
    </div>
    <div class="rows">
      ${priceRow('shopee', p)}
      ${priceRow('lazada', p)}
    </div>
    <div class="diff ${c.cheaper === 'tie' ? 'flat' : ''}">${diffText}</div>
    <div class="card-actions">
      <button class="btn-order shopee" data-order="shopee" data-id="${p.id}">สั่งซื้อที่ Shopee</button>
      <button class="btn-order lazada" data-order="lazada" data-id="${p.id}">สั่งซื้อที่ Lazada</button>
    </div>
  </article>`;
}

function renderCatalog(list = state.products) {
  const grid = $('#grid');
  const shown = list.filter((p) => (state.category === 'all' ? true : p.category === state.category));
  const sorted = sortList(shown);
  grid.innerHTML = sorted.map(cardHTML).join('');
  $('#empty').hidden = sorted.length > 0;
}

function sortList(list) {
  const l = list.slice();
  switch (state.sort) {
    case 'price-asc': l.sort((a, b) => a.compare.lowest - b.compare.lowest); break;
    case 'price-desc': l.sort((a, b) => b.compare.lowest - a.compare.lowest); break;
    case 'name': l.sort((a, b) => a.name.localeCompare(b.name, 'th')); break;
    default: l.sort((a, b) => b.compare.savePercent - a.compare.savePercent);
  }
  return l;
}

/* ---------------- ปุ่มสั่งซื้อ (ผ่าน affiliate) ---------------- */
async function order(platform, product, btn) {
  const url = platform === 'shopee' ? product.shopeeUrl : product.lazadaUrl;
  const label = platform === 'shopee' ? 'Shopee' : 'Lazada';

  // เปิดหน้าต่างไว้ก่อนในจังหวะที่ผู้ใช้ยังกดอยู่ (กัน popup blocker)
  const win = window.open('about:blank', '_blank');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> กำลังสร้างลิงก์…`;
  }

  try {
    const r = await convertUrl(url, { category: product.category, ref: product.id });
    if (!r.ok) throw new Error(r.message || r.error || 'convert-failed');
    go(win, r.goPath);
    toast(`เปิดลิงก์ affiliate ไปที่ ${label} แล้ว (SubID: ${r.subIds.join(' / ')})`);
    refreshStats();
  } catch (e) {
    if (win) win.close();
    toast('สร้างลิงก์ affiliate ไม่สำเร็จ: ' + (e.message || 'ระบบขัดข้อง'), true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

async function convertUrl(url, extra = {}) {
  const res = await fetch('/api/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, ...extra }),
  });
  return res.json();
}

function go(win, path) {
  if (win && !win.closed) win.location = path;
  else window.location.href = path;
}

/* ---------------- แผงผลลัพธ์ ---------------- */
function modeBadge(r) {
  const map = {
    graphql: ['mode-graphql', 'สร้างลิงก์ด้วย Shopee Affiliate API'],
    template: ['mode-template', 'ใช้ affiliate template'],
    api: ['mode-api', 'เรียก affiliate API ของคุณ'],
    passthrough: ['mode-passthrough', 'ยังไม่ได้ตั้งค่า affiliate — ชี้ตรงไปหน้าสินค้า'],
  };
  const [cls, text] = map[r.mode] || ['mode-passthrough', r.mode];
  const cached = r.fromCache ? ' · ใช้ลิงก์เดิมจาก cache' : '';
  return `<span class="badge ${cls}">${text}${cached}</span>`;
}

function platformBadge(r) {
  return `<span class="badge plat-${r.platform}">${r.platformLabel}</span>`;
}

function sideHTML(p, side, win) {
  const isShopee = side === 'shopee';
  const price = isShopee ? p.compare.shopeePrice : p.compare.lazadaPrice;
  const isWin = p.compare.cheaper === side;
  return `<div class="side ${isWin ? 'win' : ''}">
    ${isWin ? '<span class="win-flag">ถูกกว่า</span>' : ''}
    <span class="plat ${isShopee ? 's' : 'l'}">${isShopee ? '🛒 Shopee' : '🏷️ Lazada'}</span>
    <div class="price">${fmt(price)}</div>
    <div class="meta">${isShopee ? 'ค่าส่ง/โค้ดลด อาจต่างกันตามร้านค้า' : 'ราคา ณ ขณะที่ดึงข้อมูล'}</div>
  </div>`;
}

function renderResult(r) {
  const box = $('#result');
  box.hidden = false;

  const head = `
    <div class="res-head">
      <div style="flex:1;min-width:240px">
        <div class="res-title">ผลการเปรียบเทียบจากลิงก์ของคุณ</div>
        <div style="margin-top:7px;display:flex;gap:7px;flex-wrap:wrap">
          ${platformBadge(r)} ${modeBadge(r)}
        </div>
        <div class="subid">SubID: ${r.subIds.join(' / ')}</div>
        ${
          r.warnings?.length
            ? `<div class="warn">⚠️ ${r.warnings.join('<br />')}${
                r.platform === 'shopee' ? ' <br/>ขอ API ได้ที่ <code>affiliate.shopee.co.th/open_api</code>' : ''
              }</div>`
            : ''
        }
      </div>
    </div>`;

  if (r.matched && r.product) {
    const p = r.product;
    const c = p.compare;
    const verdict =
      c.cheaper === 'tie'
        ? `ทั้งสองแพลตฟอร์มราคาเท่ากันที่ <b>${fmt(c.lowest)}</b>`
        : `<b>${c.cheaper === 'shopee' ? 'Shopee' : 'Lazada'}</b> ถูกกว่า <b>${fmt(c.diff)}</b> (ประมาณ ${c.savePercent}%)`;
    box.innerHTML = `${head}
      <div class="picked-title">${p.icon} ${p.name} · <span class="tag">${p.categoryIcon} ${p.categoryName}</span></div>
      <div class="verdict">${verdict}</div>
      <div class="compare">
        ${sideHTML(p, 'shopee')}
        ${sideHTML(p, 'lazada')}
      </div>
      <div class="res-actions">
        <button class="btn-order shopee" data-res-order="shopee">สั่งซื้อที่ Shopee</button>
        <button class="btn-order lazada" data-res-order="lazada">สั่งซื้อที่ Lazada</button>
        <button class="btn-ghost" data-goto="${p.category}">ดูสินค้าในหมวด${p.categoryName}</button>
      </div>`;
    box.querySelector('[data-res-order="shopee"]').onclick = (e) => order('shopee', p, e.currentTarget);
    box.querySelector('[data-res-order="lazada"]').onclick = (e) => order('lazada', p, e.currentTarget);
    box.querySelector('[data-goto]').onclick = (e) => {
      setCategory(e.currentTarget.dataset.goto);
      $('#catalog').scrollIntoView({ behavior: 'smooth' });
    };
  } else {
    const cats = state.categories
      .map((c) => `<button class="chip ${r.categoryPicked === c.slug ? 'active' : ''}" data-pick="${c.slug}">${c.icon} ${c.name}</button>`)
      .join('');
    const suggestions = (r.suggestions || [])
      .map((p) => {
        const cheaper = p.compare.cheaper === 'tie' ? 'ราคาเท่ากัน' : `${p.compare.cheaper === 'shopee' ? 'Shopee' : 'Lazada'} ถูกกว่า ${fmt(p.compare.diff)}`;
        return `<div class="row">
          <span class="who">${p.icon} ${p.name}</span>
          <span class="amt" style="font-size:13px;color:#0f7b4f">${cheaper}</span>
        </div>`;
      })
      .join('');

    box.innerHTML = `${head}
      <div class="verdict">ไม่พบสินค้านี้ใน Early Catalog จึงยังเทียบราคาให้ไม่ได้ แต่สร้างลิงก์ affiliate ให้พร้อมใช้งานแล้ว</div>
      <div class="picked-title">เลือกหมวดหมู่เพื่อผูก SubID ให้แม่นยำขึ้น</div>
      <div class="cat-pick">${cats}</div>
      <div class="res-actions">
        <button class="btn-order ${r.platform}" data-res-single>สั่งซื้อที่ ${r.platformLabel}</button>
        <button class="btn-ghost" onclick="location.href='/#catalog'">ดูสินค้าทั้งหมด</button>
      </div>
      <div class="picked-title" style="padding-top:6px">สินค้าแนะนำที่ให้ส่วนต่างราคาสูงสุด</div>
      <div style="padding:0 22px 8px;display:flex;flex-direction:column;gap:7px">${suggestions}</div>`;

    box.querySelector('[data-res-single]').onclick = (e) => {
      const pseudo = {
        id: r.productId,
        category: r.categoryPicked || 'uncategorized',
        shopeeUrl: r.platform === 'shopee' ? r.originalUrl : null,
        lazadaUrl: r.platform === 'lazada' ? r.originalUrl : null,
      };
      order(r.platform, pseudo, e.currentTarget);
    };
    box.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.onclick = async () => {
        const slug = btn.dataset.pick;
        const result = await convertUrl(r.originalUrl, { category: slug });
        renderResult({ ...result, categoryPicked: slug });
        toast(`ผูก SubID หมวด ${slug} แล้ว`);
      };
    });
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------- events ---------------- */
function setCategory(slug) {
  state.category = slug;
  renderChips();
  renderCatalog();
}

function bind() {
  $('#convertForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#convertBtn');
    const url = $('#urlInput').value.trim();
    if (!url) return toast('กรุณาวางลิงก์สินค้าก่อน', true);

    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> กำลังแปลงลิงก์…`;
    try {
      const r = await convertUrl(url);
      if (!r.ok) return toast(r.message || 'ลิงก์ไม่ถูกต้อง รองรับเฉพาะ Shopee และ Lazada เท่านั้น', true);
      renderResult(r);
      refreshStats();
    } catch {
      toast('แปลงลิงก์ไม่สำเร็จ กรุณาลองใหม่', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'เทียบราคาเลย';
    }
  });

  // วางลิงก์แล้ว auto-convert
  $('#urlInput').addEventListener('paste', () => {
    setTimeout(() => $('#convertForm').requestSubmit(), 60);
  });

  $('#catChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) setCategory(chip.dataset.cat);
  });

  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-order]');
    if (!btn) return;
    const p = state.products.find((x) => x.id === btn.dataset.id);
    if (p) order(btn.dataset.order, p, btn);
  });

  $('#searchInput').addEventListener('input', (e) => {
    state.q = e.target.value.trim().toLowerCase();
    const list = state.products.filter(
      (p) =>
        (!state.q || p.name.toLowerCase().includes(state.q) || (p.spec || '').toLowerCase().includes(state.q)) &&
        (state.category === 'all' || p.category === state.category),
    );
    $('#grid').innerHTML = sortList(list).map(cardHTML).join('');
    $('#empty').hidden = list.length > 0;
  });

  $('#sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderCatalog();
  });
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

bind();
boot();
setInterval(refreshStats, 15000);