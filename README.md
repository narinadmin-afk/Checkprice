# PriceHub TH 🛒 — เว็บเปรียบเทียบราคา Shopee × Lazada พร้อม Affiliate อัตโนมัติ

วางลิงก์สินค้า Shopee หร Lazada ระบบจะแปลงลิงก์เป็น **affiliate link ที่ผูก SubID** ให้ทันที
แล้วแสดงผลเทียบราคาทั้งสองแพลตฟอร์ม พร้อมปุ่ม "สั่งซื้อที่ Shopee" / "สั่งซื้อที่ Lazada"
ที่ก่อนถึงหน้าร้านค้าจะเดินผ่าน `/go/...` ของเราก่อน เพื่อบันทึกคลิก

## แนวทางการทำงานของระบบ (Workflow)

```
ผู้ใช้วางลิงก์
   │
   ▼
POST /api/convert
   │  1) URL Parser        → รู้ว่าเป็น shopee/lazada + ดึง productId
   │  2) Catalog match     → เจอบทความเทียบราคา (24 สินค้า / 8 หมวด) หรือยังไม่มี
   │  3) generateSubIds    → [pricehub, <category-slug>, <product-ref>]  (สูงสุด 5 ช่อง)
   │  4) URL Converter     → Shopee: GraphQL generateShortLink (เซ็น SHA256)
   │                         Lazada: เทมเพลต affiliate / API ของคุณเอง
   │  5) cache 24 ชม.      → ไม่ยิง API ซ้ำ ประหยัดโควตา
   ▼
หน้าผลลัพธ์: กรอบเทียบราคา + ปุ่มสั่งซื้อทั้งสองฝั่ง (ชี้ไป /go/...)
   │
   ▼
GET /go/:platform/:id  → นับคลิก → 302 ไปยัง affiliate URL
```

สถานะจะบอกผู้ใช้ตรง ๆ ว่าลิงก์ตอนนี้เป็นโหมดไหน
`graphql` / `template` / `api` / `passthrough` (ยังไม่ได้ตั้งค่า — ยังไม่มีคอมมิชชัน)

## รันอย่างรวดเร็ว

```bash
npm install
npm start            # หรือ npm run dev (reload เมื่อไฟล์เปลี่ยน)
npm test             # 16 unit + 12 integration tests
```

เปิด http://localhost:4173 (หรือพอร์ตที่ `PORT` กำหนด — ถ้าตั้ง `PORT=0` จะเลือกพอร์ตว่างอัตโนมัติ)

## เปิดโหมด Affiliate จริง

คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่า (ห้าม commit `.env`):

```bash
SHOPEE_APP_ID=...            # ขอได้ที่ https://affiliate.shopee.co.th/open_api
SHOPEE_SECRET=...
AFFILIATE_SLOT_1=pricehub    # slot แรกของ SubID

LAZADA_AFFILIATE_TEMPLATE=https://your-network.co/th/aff/lazada?u={url}&subid1={subid1}&subid2={subid2}
PRICE_API_URL=               # (ทางเลือก) endpoint ราคาสด: POST {url} -> {price}
```

ค่าจะถูกอ่านเฉพาะฝั่งเซิร์ฟเวอร์เท่านั้น — หน้าเว็บไม่มีทางเห็น `SECRET` และมี unit test ยืนยันว่า
`/api/*` ไม่เคยส่งค่าออก

### SubID ที่ใช้จริง

| ช่อง | ตัวอย่าง | ที่มา |
|---|---|---|
| 1 | `pricehub` | `AFFILIATE_SLOT_1` / `SITE_NAME` |
| 2 | `electronics` | หมวดหมู่สินค้า (หาจาก catalog หรือผู้ใช้เลือกเอง) |
| 3 | `airpods-pro-2` | ref สินค้าในระบบ (ถ้าไม่รู้จักใช้ itemId ของร้านค้า) |

## API

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/bootstrap` | แคตตาล็อก + หมวดหมู่ + สถานะระบบ + สถิติคลิก |
| GET | `/api/products?category=&q=&sort=` | กรอง/ค้นหา/เรียงสินค้า |
| GET | `/api/products/:id` | รายละเอียดสินค้า 1 รายการ |
| POST | `/api/convert` `{url, category?, ref?}` | แปลงลิงก์เป็น affiliate + คืนข้อมูลเทียบราคา |
| GET | `/go/:platform/:id` | นับคลิกแล้ว 302 ไปหน้าร้านค้า |
| GET | `/api/stats` | สถิติการคลิก + สถานะ |
| GET | `/c/:slug` | ลิงก์หมวดหมู่สำหรับ SEO |

ตัวอย่าง

```bash
curl -X POST localhost:4173/api/convert \
  -H 'content-type: application/json' \
  -d '{"url":"https://shopee.co.th/product/1000001/220000001"}'
```

## โครงสร้าง

```
src/
  server.js              # Express: static + API + /go redirect
  lib/urls.js            # ตรวจแพลตฟอร์ม, ดึง productId จาก Shopee/Lazada
  lib/catalog.js         # Early Catalog + เปรียบเทียบราคา
  lib/prices.js          # ราคาสด (fail-soft)
  lib/env.js             # โหลด .env แบบไม่ใช้ dependency
  affiliate/shopee.js    # GraphQL generateShortLink + SHA256 signature
  affiliate/lazada.js    # template / API ของคุณเอง / passthrough
  affiliate/index.js     # cache, SubID, click log, รายงานสถานะ
data/catalog.json        # 24 สินค้าตัวอย่าง 8 หมวดหมู่
public/                  # index.html, styles.css, app.js (ไม่ใช้ framework)
test/                    # 16 unit + 12 integration tests
```

## ข้อจำกัดที่ต้องรู้ก่อนใช้จริง

1. **ราคา** — ยังเป็น *Early Catalog* (ข้อมูลตัวอย่าง) การขึ้นราคาจริงตั้ง `PRICE_API_URL`
   ให้บริการข้างนอกเสริม เพราะหน้าสินค้า Shopee/Lazada กันบอท ไม่ควร scrape ตรง ๆ
2. **Shopee Affiliate** — โค้ดพร้อมยิงจริงที่ `open-api.affiliate.shopee.co.th/graphql`
   แต่ต้องมี `SHOPEE_APP_ID/SECRET` และบัญชีต้องได้สิทธิ์เปิด Open API
   (สเปกการเซ็นชื่อ `SHA256(AppId + Timestamp + Payload + Secret)` มาจากเอกสารสาธารณะ
   — **ขออนุมัติแล้วให้ทดสอบกับเอกสารในบัญชีจริงอีกครั้งหนึ่ง**)
3. **Lazada** — ยังไม่มี endpoint สร้างลิงก์affiliate ที่เปิดเผยต่อสาธารณะ
   จึงรองรับเทมเพลตจาก affiliate network ที่คุณได้รับอนุญาต หร endpoint ของตัวเอง
   ถ้าไม่ตั้งค่า ระบบจะชี้ลิงก์ตรงและแจ้งเตือนผู้ใช้ตรง ๆ (ไม่แกล้งทำว่าเป็น affiliate link)
4. **สถิติคลิก** เก็บในหน่วยความจำ (ล่าสุด 500 รายการ) — รีเซ็ตเมื่อ restart
   ถ้าต้องการถาวรให้ย้ายไป D1/Postgres แล้วค่อย deploy

## แผนต่อไป

- ดึงราคาสดผ่าน `PRICE_API_URL` + cache ต่อสินค้า
- เก็บคลิกแบบถาวร + dashboard รายวัน
- หน้า `/c/:slug` แบบ SEO แยกตามหมวด (มี route รองรับแล้ว)