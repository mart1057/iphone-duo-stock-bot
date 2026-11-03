# iPhone Duo Stock Bot 🍎📱📱

เช็ค stock **iPhone Duo** ที่ Apple Store ประเทศไทย (รับที่ร้าน) แล้วแจ้งเตือนไป **Telegram** (`@mychatchapon_duo_bot`) และ **LINE**
แยกออกมาจาก `iphone-stock-bot` (ตัวนั้นยังเช็ค iPhone 18 Pro Max ตามเดิม)

- หน้าสินค้า: https://www.apple.com/th/shop/buy-iphone/iphone-duo
- รุ่นที่ติดตาม: 256GB / 512GB / 1TB / 2TB × สตาร์ไวท์ (Star White) / ไนท์สกาย (Night Sky) = 8 รุ่น
- ถ้าอ่านหน้าเว็บ Apple ไม่ได้ จะใช้ part number สำรองใน `src/apple/apple.seed.ts`
- ฐานข้อมูลแยก: `iphone_duo_stock_bot`

## Quick start (local)

```bash
npm install
createdb iphone_duo_stock_bot        # หรือสร้างใน Postgres ตัวเดิม
npx prisma migrate deploy
npm run notify:test                  # ทดสอบส่ง Telegram + LINE
npm run dev                          # หรือ npm run build && npm start
```

Docker: `docker compose up -d --build` (Postgres ของโปรเจคนี้ map ที่พอร์ต **5433** เพื่อไม่ชนกับตัวเดิม)

---

> เอกสารด้านล่างคัดมาจากโปรเจคเดิม (iPhone 18 Pro Max) — สถาปัตยกรรมและ env เหมือนกันทุกอย่าง

# 🍎 iPhone 18 Pro Max Stock Bot — Apple Store Thailand

Bot ตรวจสอบสต็อก **iPhone 18 Pro Max** ที่ Apple Store Thailand แบบอัตโนมัติ
และแจ้งเตือนผ่าน **LINE Messaging API** เฉพาะตอนที่สินค้า **เปลี่ยนจากไม่มี → มี** เท่านั้น

---

## สารบัญ

1. [Availability mechanism ที่ใช้](#1-availability-mechanism-ที่ใช้)
2. [Requirements](#2-requirements)
3. [PostgreSQL setup](#3-postgresql-setup)
4. [LINE Messaging API setup](#4-line-messaging-api-setup)
5. [Environment variables](#5-environment-variables)
6. [Prisma migration](#6-prisma-migration)
7. [Development run](#7-development-run)
8. [Production run](#8-production-run)
9. [Docker run](#9-docker-run)
10. [วิธีเพิ่ม / แก้ product](#10-วิธีเพิ่ม--แก้-product)
11. [วิธีเปลี่ยน polling interval](#11-วิธีเปลี่ยน-polling-interval)
12. [วิธีเพิ่มสาขา](#12-วิธีเพิ่มสาขา)
13. [Architecture](#13-architecture)
14. [Tests](#14-tests)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Availability mechanism ที่ใช้

Bot ตัวนี้ **ไม่ได้เดา API** — endpoint ด้านล่างถูกตรวจสอบจาก Apple Store Thailand จริง
(ยืนยัน 2026-09-18) โดยเปิด buy flow แล้วดู network request

### แหล่งข้อมูลที่ 1 — รายการ variant (part numbers)

```
GET https://www.apple.com/th/shop/buy-iphone/iphone-18-pro
```

หน้านี้ฝัง JSON ของ buy flow ไว้ใน HTML:

```json
{"sku":"MJXQ4","partNumber":"MJXQ4ZP/A","price":{"fullPrice":52900.00},
 "category":"iphone","name":"iPhone 18 Pro Max 256GB Burgundy"}
```

Bot จะ scrape ตรงนี้ตอน startup แล้ว cache ไว้ (`APPLE_CATALOG_TTL_MINUTES`)
→ **ไม่มีการ hard-code part number** ถ้า Apple เปลี่ยน lineup bot จะตามเอง

ปัจจุบันได้ครบ **16 variants = 4 สี × 4 ความจุ** (`ZP/A` = Thailand SKU):

| Storage | Black | Silver | Glacier | Burgundy |
|---|---|---|---|---|
| 256GB | MJXN4ZP/A | MJXP4ZP/A | MJXR4ZP/A | MJXQ4ZP/A |
| 512GB | MJXT4ZP/A | MJXU4ZP/A | MJXW4ZP/A | MJXV4ZP/A |
| 1TB | MJXX4ZP/A | MJXY4ZP/A | MJY14ZP/A | MJY04ZP/A |
| 2TB | MJY24ZP/A | MJY34ZP/A | MJY54ZP/A | MJY44ZP/A |

### แหล่งข้อมูลที่ 2 — availability (endpoint หลัก)

```
GET https://www.apple.com/th/shop/retail/pickup-message
      ?parts.0=MJXN4ZP%2FA&parts.1=MJXQ4ZP%2FA&...&little=false&location=10330
```

| Parameter | ตัวอย่าง | ความหมาย |
|---|---|---|
| `parts.N` | `MJXQ4ZP/A` | part number — **ใส่ได้ 16 ตัวใน request เดียว** |
| `little` | `false` | ขอข้อมูล store แบบเต็ม |
| `location` | `10330` | รหัสไปรษณีย์ 5 หลัก (จำเป็น มิฉะนั้น `stores` จะว่าง) |

> ⚠️ **ลำดับ parameter สำคัญ** — `parts.N` ต้องมาก่อน `location`
> ถ้าสลับ Apple จะคืน `{"body":{"content":{}}}` (ว่าง)

**Response (ตัดมาจากของจริง)**

```json
{
  "head": { "status": "200" },
  "body": {
    "storesCount": "2 stores found near 10330",
    "stores": [{
      "storeNumber": "R733",
      "storeName": "Central World",
      "city": "กรุงเทพมหานคร",
      "address": { "address": "Apple Central World", "postalCode": "10330" },
      "storelatitude": 13.744892,
      "storelongitude": 100.539972,
      "partsAvailability": {
        "MJY54ZP/A": {
          "partNumber": "MJY54ZP/A",
          "pickupDisplay": "available",
          "pickupSearchQuote": "พร้อมจำหน่าย วันนี้",
          "messageTypes": { "regular": {
            "basePartNumber": "MJY54",
            "storePickupProductTitle": "iPhone 18 Pro Max 2TB สีเกลเซียร์",
            "storePickupQuote": "วันนี้ ที่ Apple Central World"
          }}
        }
      }
    }]
  }
}
```

| ต้องการ | Field |
|---|---|
| variant identifier | key ของ `partsAvailability` = part number |
| product identifier | `messageTypes.regular.basePartNumber` |
| store identifier | `stores[].storeNumber` |
| **availability** | **`stores[].partsAvailability[part].pickupDisplay`** |

ค่าที่พบจริงของ `pickupDisplay` คือ `"available"` / `"unavailable"`
**ค่าอื่นที่ไม่รู้จัก → `UNKNOWN` เสมอ ไม่ใช่ `UNAVAILABLE`**

### ข้อจำกัดที่ต้องรู้

- `pickup-message` เป็น **internal API ที่ไม่มีสัญญาสาธารณะ** — Apple เปลี่ยนได้ทุกเมื่อ
  ระบบจึง validate ด้วย Zod แบบ permissive และ degrade เป็น `UNKNOWN` เมื่อ shape เพี้ยน
- endpoint อีกตัว `/th/shop/fulfillment-messages` ที่หน้าเว็บก็ใช้ **คืน HTTP 541** จากเครือข่ายนอกไทย
  (แม้แต่ request ที่หน้า Apple ยิงเอง) จึงไม่ถูกนำมาใช้
- ไม่มี **public store-list JSON** (`/rsp-web/store-list` → 404, หน้า storelist เป็น client-rendered)
  → สาขาถูก discover จาก `pickup-message` เอง
- bot **ไม่ bypass** CAPTCHA / auth / security control ใด ๆ ยิง endpoint สาธารณะแบบเดียวกับ browser
- ปัจจุบัน 1 รอบ = **1 HTTP request** → ที่ interval 30 วินาที = **2 req/นาที** ซึ่งเบามาก
  ถ้าจะลด interval ต่ำกว่านี้ โปรดพิจารณาผลกระทบต่อ Apple ด้วย

---

## 2. Requirements

| อย่าง | เวอร์ชัน |
|---|---|
| Node.js | **≥ 20** (ใช้ global `fetch`, `AbortSignal.timeout`) |
| PostgreSQL | ≥ 14 (แนะนำ 16) |
| npm | ≥ 10 |
| Docker (ถ้าใช้) | Docker Engine + Compose v2 |

---

## 3. PostgreSQL setup

### ใช้ Postgres ที่มีอยู่แล้ว

```bash
createdb iphone_stock_bot
```

หรือ

```bash
psql "postgres://postgres:postgres@127.0.0.1:5432/postgres" -c "CREATE DATABASE iphone_stock_bot"
```

### หรือใช้ Docker เฉพาะ DB

```bash
docker compose up -d postgres
```

---

## 4. LINE Messaging API setup

> ใช้ **LINE Messaging API** เท่านั้น — ไม่ใช่ LINE Notify (ซึ่งปิดบริการแล้ว)

1. เข้า [LINE Developers Console](https://developers.line.biz/console/)
2. สร้าง **Provider** → สร้าง **Channel** ประเภท **Messaging API**
3. แท็บ **Messaging API** → **Channel access token (long-lived)** → กด **Issue**
   → ได้ค่าใส่ `LINE_CHANNEL_ACCESS_TOKEN`
4. หา **target id** สำหรับ `LINE_USER_ID`
   - **ส่งหาตัวเอง:** แท็บ **Basic settings** → **Your user ID** (ขึ้นต้นด้วย `U`)
   - **ส่งเข้ากลุ่ม:** เชิญบอทเข้ากลุ่ม แล้วอ่าน `groupId` จาก webhook event (ขึ้นต้นด้วย `C`)
   - ใส่หลายปลายทางได้โดยคั่นด้วย comma: `LINE_USER_ID=Uxxx,Cyyy`
5. เพิ่มบอทเป็นเพื่อน (สแกน QR ในแท็บ Messaging API) — ถ้าไม่ได้เป็นเพื่อน push จะถูกปฏิเสธ
6. ปิด **Auto-reply messages** / **Greeting messages** ถ้าไม่ต้องการ

**ทดสอบโดยไม่ส่งจริง:** ตั้ง `LINE_DRY_RUN=true` → bot จะ log payload แทนการยิง API

---

## 5. Environment variables

คัดลอกไฟล์ตัวอย่าง:

```bash
cp .env.example .env
```

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `NODE_ENV` | `development` | environment |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `TZ` | `Asia/Bangkok` | timezone ที่ใช้ format เวลาใน log และ LINE |
| `DATABASE_URL` | – | **จำเป็น** connection string ของ PostgreSQL |
| `LINE_CHANNEL_ACCESS_TOKEN` | – | token ของ Messaging API channel |
| `LINE_USER_ID` | – | userId / groupId ปลายทาง (คั่น comma ได้) |
| `LINE_DRY_RUN` | `false` | `true` = ไม่ส่งจริง แค่ log |
| `APPLE_BASE_URL` | `https://www.apple.com/th/` | base URL |
| `APPLE_PRODUCT_URL` | `.../shop/buy-iphone/iphone-18-pro` | หน้าที่ใช้ discover part numbers |
| `APPLE_MODEL_FILTER` | `iPhone 18 Pro Max` | ติดตามเฉพาะ variant ของรุ่นนี้ (ใช้เมื่อ `APPLE_PRODUCTS` ว่าง) |
| `APPLE_PRODUCTS` | `iPhone Duo\|<url>;iPhone 18 Pro Max\|<url>` | เฝ้าหลายรุ่น (ดูข้อ 10) |
| `APPLE_POSTAL_CODES` | `10330` | รหัสไปรษณีย์ที่ใช้ค้นสาขา (คั่น comma) |
| `APPLE_MAX_PARTS_PER_REQUEST` | `16` | จำนวน part ต่อ 1 request |
| `APPLE_CATALOG_TTL_MINUTES` | `1440` | อายุ cache ของ part number |
| `STOCK_CHECK_INTERVAL_SECONDS` | `30` | เว้นระยะระหว่างรอบ (นับจาก **จบ** รอบก่อน) |
| `STOCK_CHECK_CRON` | *(ว่าง)* | ถ้าใส่ cron expression จะใช้แทน interval |
| `RUN_ON_STARTUP` | `true` | ตรวจทันทีตอน boot |
| `REQUEST_TIMEOUT_MS` | `10000` | timeout ต่อ request |
| `MAX_RETRIES` | `3` | จำนวน retry |
| `RETRY_BASE_DELAY_MS` | `500` | ฐานของ exponential backoff (มี jitter) |
| `MAX_CONCURRENT_REQUESTS` | `3` | เพดาน concurrency ไปยัง Apple |
| `RATE_LIMIT_TRIGGER_FAILURES` | `2` | โดน Apple ปฏิเสธติดกันกี่ครั้งจึงเริ่มพัก |
| `RATE_LIMIT_COOLDOWN_BASE_SECONDS` | `120` | เวลาพักครั้งแรก |
| `RATE_LIMIT_COOLDOWN_MAX_SECONDS` | `1800` | เพดานเวลาพัก |
| `RATE_LIMIT_ALERT_ENABLED` | `true` | แจ้ง LINE ตอนเริ่มพัก / กลับมาปกติ |
| `DISTRIBUTED_LOCK_ENABLED` | `false` | เปิดเมื่อรันหลาย instance บน DB เดียวกัน |
| `LOCK_TTL_SECONDS` | `300` | อายุ lock กันค้างเมื่อ process ตาย |

> ไม่มีการ hard-code secret ใด ๆ ในโค้ด — ทุกอย่างมาจาก `.env`
> `.env` ถูก ignore โดย git แล้ว

---

## 6. Prisma migration

```bash
npm install
npm run prisma:generate
npm run prisma:migrate     # prisma migrate dev --name init
```

ใน production ใช้:

```bash
npm run prisma:deploy      # prisma migrate deploy
```

### Data model

```
Product ─┬─ ProductVariant ─┐
         │                  ├─ Stock ─┬─ StockHistory
       Store ───────────────┘         └─ NotificationLog
```

- `Stock` มี `@@unique([variantId, storeId])` กัน duplicate
- `Stock.available` = คำตอบ **ชัดเจน** ล่าสุด (UNKNOWN ไม่เขียนทับ)
- `Stock.status` = สถานะ **ที่สังเกตได้** ล่าสุด (รวม UNKNOWN)
- `StockHistory` บันทึกเฉพาะตอน **เปลี่ยน** ไม่ใช่ทุกรอบ → ตารางไม่บวม
- `JobLock` ใช้เมื่อเปิด `DISTRIBUTED_LOCK_ENABLED`

---

## 7. Development run

```bash
npm install
npm run prisma:migrate
npm run dev
```

ผลลัพธ์ที่ควรเห็น:

```
[06:42:11] INFO  Database connection ok
[06:42:11] INFO  Catalogue loaded: 16 variants colors=Black/Burgundy/Glacier/Silver storage=256GB/512GB/1TB/2TB

🍎 iPhone 18 Pro Max Stock Bot

Monitoring:
✓ Black
✓ Burgundy
✓ Glacier
✓ Silver

Storage:
✓ 256GB
✓ 512GB
✓ 1TB
✓ 2TB

Stores:
✓ Apple Store Thailand (discovered from Apple, not hard-coded)

Interval:
30 seconds

Status:
🟢 Monitoring

[06:42:11] INFO  Stock check started
[06:42:11] INFO  First run detected - baseline will be stored WITHOUT notifications
[06:42:12] INFO  Stock check finished in 1232ms checked=32 available=0 unavailable=32 unknown=0 transitions=0
```

เมื่อเจอของ:

```
[23:30:02] INFO  Status changed: UNAVAILABLE -> AVAILABLE iPhone 18 Pro Max / เบอร์กันดี (Burgundy) / 256GB / Apple Central World
[23:30:03] INFO  Sending LINE alert for 1 item(s)
[23:30:03] INFO  LINE notification sent to=Uabcd...wxyz requestId=...
```

---

## 8. Production run

```bash
npm ci
npm run prisma:generate
npm run build
npm run prisma:deploy
npm start
```

แนะนำให้รันใต้ process manager (systemd / pm2) — bot จัดการ `SIGINT`/`SIGTERM` และ shutdown อย่างสะอาดอยู่แล้ว

---

## 9. Docker run

```bash
cp .env.example .env     # ใส่ LINE token / user id
docker compose up -d
docker compose logs -f bot
```

จะได้ **PostgreSQL + Stock Bot** โดย compose จะรัน `prisma migrate deploy` ให้ก่อน start
(`DATABASE_URL` ถูก override เป็น host ภายใน network อัตโนมัติ)

หยุด:

```bash
docker compose down          # เก็บข้อมูลไว้
docker compose down -v       # ลบ volume ด้วย
```

---

## 10. วิธีเพิ่ม / แก้ product

**ไม่ต้องแก้โค้ด** — แก้ `.env`

เฝ้าหลายรุ่นพร้อมกัน: ใส่ `ชื่อรุ่น|ลิงก์หน้าซื้อ` คั่นแต่ละรุ่นด้วย `;`

```env
APPLE_PRODUCTS=iPhone Duo|https://www.apple.com/th/shop/buy-iphone/iphone-duo;iPhone 18 Pro Max|https://www.apple.com/th/shop/buy-iphone/iphone-18-pro
```

ถ้าเว้น `APPLE_PRODUCTS` ว่าง จะเฝ้ารุ่นเดียวจาก `APPLE_MODEL_FILTER` + `APPLE_PRODUCT_URL` เหมือนเดิม

| อยากตาม | ใส่ใน `APPLE_PRODUCTS` |
|---|---|
| iPhone 18 Pro Max | `iPhone 18 Pro Max\|https://www.apple.com/th/shop/buy-iphone/iphone-18-pro` |
| iPhone 18 Pro (ตัวเล็ก) | `iPhone 18 Pro\|https://www.apple.com/th/shop/buy-iphone/iphone-18-pro` (ไม่รวม Pro Max) |
| ทั้ง 18 Pro และ 18 Pro Max | ใส่ทั้งสองรายการ ใช้ลิงก์เดียวกันได้ |
| iPhone Air | `iPhone Air\|https://www.apple.com/th/shop/buy-iphone/iphone-air` |

- ชื่อรุ่นต้องตรงกับที่ Apple เขียนก่อนความจุ เช่น `iPhone 18 Pro Max 256GB Burgundy` → `iPhone 18 Pro Max`
- สี/ความจุ **ไม่ต้องกำหนดเอง** — ระบบอ่านจากหน้า Apple ทั้งหมด (อ่านใหม่ทุก `APPLE_CATALOG_TTL_MINUTES`)
- ถ้าหน้าของรุ่นหนึ่งโหลดไม่ได้ รุ่นอื่นยังตรวจต่อตามปกติ
- ยิ่งหลายรุ่น ยิ่งมี part number มาก: ทุก 16 part (`APPLE_MAX_PARTS_PER_REQUEST`) = 1 คำขอ pickup-message ต่อรอบ
  เช่น Duo 8 + Pro Max 16 = 24 part = 2 คำขอต่อรอบ
- รุ่นใหม่จะขึ้นในเมนู `/alerts` และ `/history` ของ Telegram เองหลังตรวจรอบแรก และเริ่มต้นแบบเปิดแจ้งเตือนทุกสีทุกความจุ

ถ้าอยากเพิ่ม mapping ชื่อสีภาษาไทยของรุ่นใหม่ แก้ `COLOR_EN_TO_TH` ใน
[`src/apple/apple.parser.ts`](src/apple/apple.parser.ts) (ถ้าไม่มี mapping จะ fallback เป็นชื่ออังกฤษ)

---

## 11. วิธีเปลี่ยน polling interval

อัปเดต: โหมด interval พักหลังจบรอบ 08:00–09:00 น. สุ่ม 10–15 วินาที ช่วงอื่น 30 วินาที (เวลาไทย) ค่า `STOCK_CHECK_INTERVAL_SECONDS` เดิมไม่มีผลแล้ว ส่วน cron ยังใช้ได้เมื่อกำหนดไว้

เมื่อเจอ 403/429/503/541 จะไม่ retry ในรอบนั้น และหยุดคำขอที่เหลือ ค่าเริ่มต้นพักทันทีตั้งแต่ครั้งแรก 15 นาที (900 วินาที) ก่อนลองใหม่ ตั้งผ่าน `RATE_LIMIT_TRIGGER_FAILURES=1`, `RATE_LIMIT_COOLDOWN_BASE_SECONDS=900`, `RATE_LIMIT_COOLDOWN_MAX_SECONDS=900`

ตัวอย่าง interval แบบคงที่ด้านล่างเป็นพฤติกรรมเดิม:

```env
STOCK_CHECK_INTERVAL_SECONDS=15     # ถี่ขึ้น
STOCK_CHECK_INTERVAL_SECONDS=60     # ห่างขึ้น
```

หรือใช้ cron expression (6 ฟิลด์ = มีวินาที):

```env
STOCK_CHECK_CRON=*/30 * * * * *
```

**กัน job ซ้อนกัน 2 ชั้น:**

1. **in-process guard** — tick ที่มาถึงขณะรอบก่อนยังไม่จบจะถูก **skip** (ไม่เข้าคิว)
   ทำให้กรณี "รอบใช้ 40 วิ แต่ตั้ง 30 วิ" ไม่เกิด job ซ้อน
2. **DB lock** (`DISTRIBUTED_LOCK_ENABLED=true`) — สำหรับกรณีรันหลาย instance
   ใช้ตาราง `job_locks` + TTL กัน lock ค้างถ้า process ตาย

ในโหมด interval รอบถัดไปถูกนับจาก **เวลาที่รอบก่อนจบ** จึงไม่มีทางทับกันโดยธรรมชาติ

---

## 12. วิธีเพิ่มสาขา

**ไม่ต้องทำอะไร** — สาขาถูก discover อัตโนมัติจาก response ของ Apple
(`storeNumber`, `storeName`, `address`, lat/lng) แล้ว upsert เข้าตาราง `stores` ทุกรอบ
ถ้า Apple เปิดสาขาใหม่ bot จะเห็นเองและเริ่มตามสต็อกให้ทันที

ปัจจุบัน Apple Store Thailand มี 2 สาขา:

| Code | Name |
|---|---|
| `R733` | Apple Central World |
| `R728` | Apple Iconsiam |

ถ้าอนาคตมีสาขาต่างจังหวัดที่ไม่ขึ้นจากรหัสไปรษณีย์กรุงเทพ ให้เพิ่ม seed postcode:

```env
APPLE_POSTAL_CODES=10330,50000,83000
```

ระบบจะ sweep ทุกรหัส แล้ว merge สาขาที่ซ้ำกันให้เอง (นับ request เพิ่มตามจำนวนรหัส)

---

## 13. Architecture

```
node-cron / fixed-delay loop
        │  (in-process guard + optional DB lock + adaptive cooldown)
        ▼
AppleCatalog ──── scrape buy page → 16 part numbers (cache 24 ชม.)
        │
        ▼
AppleClient.getPickupMessage(parts[16], postcode)
        │  timeout 10s · retry 3 · exponential backoff + jitter
        ▼
AppleParser ───── Zod validate → ProductStock[]  (AVAILABLE / UNAVAILABLE / UNKNOWN)
        │
        ▼
StockService ──── upsert Product/Variant/Store · โหลด baseline จาก PostgreSQL
        │
        ▼
ChangeDetector ── prev.available === false && current === AVAILABLE → transition
        │
        ▼
NotificationService ── รวมทุก transition ในรอบเดียว → 1 ข้อความ
        │
        ▼
LineNotificationService → POST /v2/bot/message/push → NotificationLog
```

```
src/
├── apple/
│   ├── apple.client.ts        HTTP client (timeout, retry, backoff)
│   ├── apple.catalog.ts       discover part numbers + cache
│   ├── apple.availability.ts  orchestrate sweep (chunk + concurrency)
│   ├── apple.parser.ts        response → ProductStock, colour mapping
│   ├── apple.store.ts         store discovery / merge
│   └── apple.types.ts         Zod schemas ของ response จริง
├── stock/
│   ├── stock.service.ts       รอบตรวจสอบเต็มรูปแบบ
│   ├── stock.repository.ts    Prisma access + cooperative lock
│   ├── stock.detector.ts      กฎ change detection (pure)
│   └── stock.types.ts         ProductStock / StockTransition
├── notification/
│   ├── line.service.ts        LINE Messaging API push
│   ├── line.flex.ts           Flex bubble / carousel / text fallback
│   └── notification.service.ts
├── scheduler/
│   ├── stock.scheduler.ts     รอบตรวจ + กัน job ซ้อน
│   └── rate-limit.guard.ts    adaptive cooldown เมื่อ Apple ปฏิเสธ
├── database/prisma.ts
├── config/env.ts              Zod-validated env
├── utils/                     logger, retry, concurrency, datetime
└── index.ts
```

### Change detection — กฎเดียวที่กัน LINE spam

```ts
previous.available === false && current === 'AVAILABLE'   // → ส่ง
```

| ลำดับ | ผลลัพธ์ |
|---|---|
| ครั้งแรก (DB ว่าง) | **ไม่ส่ง** — เก็บ baseline เงียบ ๆ |
| `false → true` | **LINE และ Telegram member ส่ง 1 ครั้ง · Telegram แอดมินและ Discord ส่ง 2 ครั้ง เว้น 3 วินาที** |
| `true → true` (ทุก 30 วิ) | ไม่ส่ง |
| `true → false` | ไม่ส่ง (บันทึกลง history) |
| `* → UNKNOWN` | ไม่ส่ง และ **ไม่เขียนทับ** `available` |
| restart แล้วของยัง available | ไม่ส่ง (baseline มาจาก PostgreSQL) |

LINE แจ้งเฉพาะตอนพบสต็อก 1 ครั้ง ไม่ส่งข้อความซ้ำหรือสถานะระบบ
Telegram member ได้แจ้งสต็อก 1 ครั้ง ส่วน Telegram แอดมิน (`TELEGRAM_CHAT_ID`) และ Discord ได้ 2 ครั้ง โดยรอ 3 วินาทีหลังส่งและบันทึกผลครั้งแรกเสร็จ
แต่ละครั้งมี retry key และประวัติการส่งแยกกัน ข้อความครั้งที่สองใช้ข้อมูลการตรวจพบเดิม
ไม่ได้เรียก Apple เพิ่มระหว่างสองข้อความ รอบตรวจถัดไปจะเริ่มหลังส่งครบ จึงเพิ่มเวลารออย่างน้อย 3 วินาที
Telegram แจ้งเตือนอัตโนมัติเฉพาะตอนพบสต็อก ไม่ส่งข้อความ rate limit หรือข้อความกลับมาตรวจตามปกติ
Discord ยังแจ้งสถานะระบบตามเดิม ส่วน `npm run notify:test` ยังคงส่งตามเดิม ไม่ถูกเพิ่มเป็นสองครั้ง

### Adaptive cooldown — กันโดนบล็อก

Bot ยิง **1 request ต่อรอบ** (16 part numbers ใน request เดียว) = **2 req/นาที** ที่ interval 30 วิ
ซึ่งเบากว่าการกด refresh หน้า Apple เองมาก (1 ครั้ง ≈ 30-60 requests)

แต่ถ้า Apple ปฏิเสธ (`403` / `429` / `503` / `541`) bot จะ **ถอยให้อัตโนมัติ** แทนที่จะยิงต่อ:

```
ปฏิเสธครั้งแรก   → พัก 15 นาที
ยังโดนอีก        → พัก 15 นาทีทุกครั้ง
ตอบปกติครั้งแรก  → กลับมาพักหลังจบรอบ: 08:00–09:00 น. สุ่ม 10–15 วินาที ช่วงอื่น 30 วินาที (เวลาไทย)
```

- ระหว่างพัก **ไม่ยิง request เลย** (tick ถูกข้าม)
- แจ้งสต็อกเข้า Telegram แอดมินและ Discord **2 รอบต่อเหตุการณ์** ห่างกัน 3 วินาที (LINE และ Telegram member ได้ 1 รอบ) ไม่แจ้งทุกรอบตรวจ
- ข้อความเตือนหน้าตาต่างจาก stock alert ชัดเจน (`⚠️ ระบบหยุดตรวจชั่วคราว`)
  เพื่อให้รู้ว่า "เงียบเพราะโดนบล็อก" ไม่ใช่ "เงียบเพราะไม่มีของ"
- error ธรรมดา (parse ผิด, เน็ตหลุด, 404) **ไม่ trigger cooldown** เพราะถอยไปก็ไม่ช่วย

### Error handling

- แยก 3 สถานะชัดเจน: `AVAILABLE` / `UNAVAILABLE` / `UNKNOWN`
- request fail → `UNKNOWN` **ไม่ใช่** `UNAVAILABLE` → ไม่มี alert ปลอมหลัง Apple ล่ม
- timeout, retry, exponential backoff + jitter, log ครบ
- รอบที่ล้มเหลวไม่ฆ่า scheduler — รอบถัดไปยังทำงานต่อ

---

## 14. Tests

```bash
npm test
```

ครอบคลุม (58 tests):

| ไฟล์ | ทดสอบอะไร |
|---|---|
| `tests/apple-parser.test.ts` | catalogue parser, colour mapping, **non-breaking space**, `pickupDisplay` → status, store parser, response จริง → `ProductStock` |
| `tests/stock-detector.test.ts` | ตาราง truth ครบ, first run, restart safety, UNKNOWN, timeline 10:00–10:06 |
| `tests/notification.test.ts` | Flex bubble/carousel, ปุ่ม "ดู Apple Store", รวมหลายรายการเป็น 1 ข้อความ, text fallback, NotificationLog |
| `tests/scheduler.test.ts` | tick ซ้อนถูก skip, รอบล้มเหลวไม่ทำให้ scheduler ตาย, cooldown หยุดยิง/แจ้งครั้งเดียว/กลับมาเอง |
| `tests/rate-limit.test.ts` | แยก error ที่เป็น rate limit, escalation 2→4→8→16 นาที, เพดาน, reset เมื่อสำเร็จ |

`tests/fixtures/pickup-message.json` คือ response **จริง** จาก Apple (ตัด field ที่ไม่ใช้ออก)

```bash
npm run typecheck   # tsc --noEmit (strict mode, ไม่มี any)
```

---

## 15. Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `No variants found for "iPhone 18 Pro Max"` | Apple เปลี่ยน URL หรือชื่อรุ่น — ตรวจ `APPLE_PRODUCT_URL` และ `APPLE_MODEL_FILTER` ว่าตรงกับชื่อบนหน้าเว็บ |
| `Apple request failed status=541` | Apple block request จาก IP/region นั้น ลองรันจากเครือข่ายในไทย — bot จะรายงานเป็น `UNKNOWN` ไม่ใช่ข้อมูลผิด |
| `Apple request failed status=429` | ยิงถี่เกินไป — bot จะพักให้เองอัตโนมัติ ถ้าเกิดบ่อยให้เพิ่ม `STOCK_CHECK_INTERVAL_SECONDS` |
| `Rate-limit cooldown active - tick skipped` | ปกติ — กำลังพักตามกลไก adaptive cooldown จะกลับมาเองเมื่อครบเวลา |
| `stores` ว่าง / `checked=0` | `location` ต้องเป็นรหัสไปรษณีย์ไทย 5 หลักที่ถูกต้อง และ `parts.N` ต้องมาก่อน `location` |
| ไม่ได้รับ LINE เลย | 1) ตรวจ `LINE_DRY_RUN` ว่าไม่ได้เป็น `true` 2) เพิ่มบอทเป็นเพื่อนแล้วหรือยัง 3) ดู error ใน `notification_logs` |
| LINE ตอบ `401` | token ผิด/หมดอายุ — ออก Channel access token ใหม่ |
| LINE ตอบ `403` | ปลายทางไม่ได้เป็นเพื่อนกับบอท หรือ `LINE_USER_ID` ผิดประเภท |
| ถูกยิงแจ้งเตือนรัวตอนเปิดครั้งแรก | ไม่ควรเกิด — first run จะเงียบเสมอ ถ้าเกิดให้ตรวจว่า DB ไม่ได้ถูก reset ระหว่าง restart |
| `Previous stock check still running - tick skipped` | ปกติ — guard ทำงานถูกต้อง ถ้าเห็นถี่มากให้เพิ่ม interval |
| `Another instance holds the stock-check lock` | มีอีก instance ทำงานอยู่ ถ้าไม่ได้ตั้งใจให้ปิด `DISTRIBUTED_LOCK_ENABLED` |
| Prisma `P1001` ต่อ DB ไม่ได้ | ตรวจ `DATABASE_URL` / Postgres รันอยู่หรือไม่ (`pg_isready`) |
| เวลาใน log ผิด timezone | ตั้ง `TZ=Asia/Bangkok` ใน `.env` และใน container |

### การล้างประวัติอัตโนมัติ

บอตลบ `notification_logs` และแถว `stock_history` ที่เป็น `UNKNOWN` ที่เก่ากว่า 72 ชั่วโมง
ส่วนแถว `stock_history` ที่เป็น `AVAILABLE` / `UNAVAILABLE` (เวลาเติมของ / ของหมด) เก็บไว้
`RESTOCK_HISTORY_RETENTION_DAYS` วัน (ค่าเริ่มต้น 180 = 6 เดือน) เพื่อใช้กับเมนู 📈 ดูสถิติของเคยเข้า (`/history`) โดยเริ่มครั้งแรกประมาณ 1 นาทีหลัง scheduler ตรวจสต็อกเริ่มทำงาน
แล้วรันซ้ำทุก 24 ชั่วโมงหลังงานล้างจบ (ขณะบอตเปิดอยู่)
แถวที่เวลาเท่ากับจุดตัดจะยังถูกเก็บไว้ และข้อมูลบางแถวอาจอยู่เกือบ 4 วันก่อนถึงรอบล้างถัดไป

งานนี้ไม่ลบ `stocks`, สินค้า หรือสาขา จึงเก็บสถานะล่าสุดสำหรับเทียบการแจ้งเตือนเดิมไว้
งานล้างแยกจากรอบตรวจสต็อก ไม่มีการส่งข้อความแจ้งเตือนจากงานล้าง
หากล้มเหลวจะ rollback และบันทึก error โดยลองใหม่ในวันถัดไป
คำสั่งลบแต่ละคำสั่งจำกัดเวลา 5 วินาทีเพื่อลดผลกระทบต่อฐานข้อมูลที่ใช้ร่วมกัน
ดูผลได้จาก log `History cleanup finished` และจำนวนแถวที่ลบ

### ดูข้อมูลใน DB

```bash
npm run prisma:studio
```

```sql
-- สถานะปัจจุบันทั้งหมด
SELECT s.code, v.color, v.storage, st.available, st.status, st.last_checked_at
FROM stocks st
JOIN product_variants v ON v.id = st.variant_id
JOIN stores s ON s.id = st.store_id
ORDER BY s.code, v.storage, v.color;

-- ประวัติการแจ้งเตือน
SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT 20;
```

---

## Disclaimer

โปรเจกต์นี้ไม่มีส่วนเกี่ยวข้องกับ Apple Inc.
ใช้ endpoint สาธารณะเดียวกับที่หน้าเว็บ Apple เรียกใช้ และ **ไม่มีการหลบเลี่ยง**
CAPTCHA, authentication หรือ security control ใด ๆ
โปรดใช้ polling interval ที่สมเหตุสมผลและเคารพข้อจำกัดของ Apple

## License

[MIT](LICENSE)

### ถามสถานะผ่าน Telegram

แอดมินพิมพ์ `/status` หรือ `สถานะ` บอตจะตอบสถานะการตรวจ (กำลังตรวจ / รอรอบถัดไป / พักจาก rate limit) พร้อมผลสต็อกและเวลาตรวจล่าสุดจากฐานข้อมูล โดยไม่สั่งตรวจ Apple เพิ่ม
รองรับ `เช็คสถานะ` และ `เช็กสถานะ` ด้วย และตอบกลับเฉพาะแชตที่ถาม

เปิดใช้งานอัตโนมัติเมื่อกำหนด Telegram token และ chat ID และ `TELEGRAM_DRY_RUN=false`
ใช้ตัวรับคำสั่งเพียงหนึ่ง instance ต่อ token และต้องไม่มี webhook ที่ใช้งานอยู่
ในกลุ่มที่เปิด privacy mode ให้ใช้ `/status` (หรือ `/status@ชื่อบอต`) แทนข้อความธรรมดา

แอดมินใช้ `/pause` (หรือ `/stop`) เพื่อหยุดตรวจรอบใหม่ (รอบที่กำลังตรวจจะทำจนจบ) และ `/resume` เพื่อเปิดตรวจอีกครั้ง โดยตรวจทันทีถ้า `RUN_ON_STARTUP=true` และยังอยู่ภายใต้ cooldown เดิม
คำสั่งมีผลกับทุกคน การรีสตาร์ตโปรเซสจะเปิดตรวจตามปกติ
(`/start` ไม่ได้ใช้เริ่มตรวจแล้ว เพราะปุ่ม Start ของ Telegram ส่ง `/start` เสมอ ตอนนี้ใช้สำหรับเข้าร่วมผ่านลิงก์เชิญ)

### หยุดเช็คบางรุ่น (แอดมิน)

`/models` (หรือปุ่ม ⏯️ ในเมนูหลักของแอดมิน) แสดงทุกรุ่นพร้อมปุ่ม ⏸️ หยุดเช็ค / ▶️ เริ่มเช็ค
- รุ่นที่หยุดจะไม่ถูกส่งไปถาม Apple เลย (ลดคำขอ) และไม่มีการแจ้งเตือนรุ่นนั้น
- เก็บในตาราง `paused_models` จึงยังหยุดอยู่แม้รีสตาร์ทบอท
- **สมาชิกจะไม่รู้เลยว่ามีรุ่นที่หยุดอยู่** — ข้อความเชิญ ข้อความต้อนรับ และเมนูหลักของสมาชิกไม่มีรายชื่อรุ่น (ข้อความพวกนี้ค้างในแชท) และปุ่มเก่าในแชทอ้างรุ่นด้วยชื่อ จึงไม่เปิดรุ่นผิด
- **สมาชิกจะไม่เห็นรุ่นที่หยุดเลย** (ไม่อยู่ใน `/stock`, เมนู, ตั้งค่าการแจ้งเตือน, ประวัติ, ข้อความต้อนรับ และไม่โผล่ในส่วน "ตอนนี้มีของที่" ของข้อความแจ้งเตือน)
- แอดมินยังเห็นรุ่นนั้นพร้อมป้าย ⏸️ และ `/status` บอกว่ารุ่นไหนหยุดอยู่
- ต่างจาก `/pause` ที่หยุดทุกรุ่นชั่วคราว (รีสตาร์ทแล้วกลับมาเช็คเอง)
- เริ่มเช็คใหม่แล้ว ถ้ารุ่นนั้นมีของอยู่ตอนนั้นแต่ตอนหยุดไม่มี จะได้แจ้งเตือนตามปกติ

### ลิงก์เชิญ: ให้คนอื่นรับแจ้งเตือนจากบอต

| ใคร | มาจาก | ทำอะไรได้ |
|---|---|---|
| แอดมิน | `TELEGRAM_CHAT_ID` ใน `.env` | ทุกอย่าง + `/status` `/pause` `/resume` `/models` `/invite` `/members` `/news` |
| สมาชิก | เปิดลิงก์เชิญ (เก็บในตาราง `telegram_subscribers`) | รับแจ้งเตือน, `/stock` `/alerts` `/history` `/leave` (ดูสถานะระบบไม่ได้) |

1. ตั้งรหัสลับใน `.env` แล้วรีสตาร์ต เช่น `TELEGRAM_INVITE_CODE=duo-ab12cd34` (8-64 ตัว: A-Z a-z 0-9 _ -)
2. แอดมินพิมพ์ `/invite` (🔗 ส่งคำเชิญ) บอตส่ง 2 ข้อความ: ลิงก์ `https://t.me/<ชื่อบอต>?start=<รหัส>` และข้อความชวนที่กด Forward ต่อให้คนอื่นได้เลย
   ดู/นำสมาชิกออกได้ที่ `/members` (👥 ดูสมาชิก)
3. คนที่เปิดลิงก์แล้วกด Start จะ**ส่งคำขอ**เท่านั้น (ยังไม่ได้รับแจ้งเตือน ใช้เมนูไม่ได้) แอดมินได้ข้อความพร้อมปุ่ม ✅ อนุมัติ / ❌ ปฏิเสธ
   อนุมัติแล้วบอตส่งข้อความต้อนรับให้ ปฏิเสธแล้วบอตแจ้งสุภาพ ๆ คำขอที่ค้างอยู่ดู/อนุมัติได้ที่ `/members` ด้วย
   (สมาชิกที่เข้ามาก่อนอัปเดตนี้ ถือว่าอนุมัติแล้ว)
4. กดอนุมัติแล้ว บอตจะถามต่อทันทีว่า**สมาชิกหมดอายุวันไหน** เลือกได้ 7 วัน / 1 เดือน / 3 เดือน / 6 เดือน / 1 ปี / ♾️ ไม่หมดอายุ
   หรือ ✏️ พิมพ์วันที่เอง (`31/12/2026`, `31/12/2569` หรือจำนวนวัน เช่น `45`) แก้ทีหลังได้ที่ปุ่ม 📅 ใน `/members`
   ถึงวันหมดอายุ ตั้งแต่ `MEMBER_EXPIRY_CHECK_HOUR` (ค่าเริ่มต้น 09:00 น.) บอตจะนำสมาชิกออก แจ้งสมาชิก
   และส่ง**รายงานสมาชิกที่หมดอายุวันนั้น**ให้แอดมิน (ถ้าวันนั้นไม่มีใครหมดอายุ จะไม่ส่งอะไร)
4. แต่ละคนเลือกรุ่น/สี/ความจุของตัวเองได้ที่ `/alerts` และเลิกรับได้ด้วย `/leave`
5. **ส่งข้อความแจ้งสมาชิก** แอดมินพิมพ์ `/news` (หรือกด 📣 ส่งข้อความถึงสมาชิก ในเมนูหลัก) แล้วพิมพ์ข้อความ (หลายบรรทัดได้)
   หรือพิมพ์รวดเดียว `/news พรุ่งนี้บอทปิดปรับปรุง 1 ชม.` บอตจะโชว์ตัวอย่างก่อน กด ✅ ส่งเลย ถึงจะส่งจริง (❌ ยกเลิก / พิมพ์ข้อความใหม่เพื่อแก้)
   สมาชิกจะได้รับเป็น `📢 ข่าวจากแอดมิน` + ข้อความ (ไม่ส่งให้คนที่รออนุมัติ และไม่ส่งซ้ำให้แอดมิน) ส่งเสร็จบอตสรุปว่าส่งถึงกี่คน ส่งไม่ถึงใครบ้าง
   ยาวได้ไม่เกิน 3,800 ตัวอักษร

- กด Start โดยไม่มีรหัส หรือรหัสผิด = บอตตอบว่าต้องใช้ลิงก์เชิญ และไม่บันทึกอะไร
- เปลี่ยน `TELEGRAM_INVITE_CODE` = ลิงก์เก่าใช้ไม่ได้ แต่คนที่เข้าแล้วยังอยู่ (นำออกได้ที่ `/members`)
- เพิ่มบอตเข้ากลุ่มได้ด้วยลิงก์เดียวกันแต่เปลี่ยน `?start=` เป็น `?startgroup=` ทั้งกลุ่มจะใช้การตั้งค่าแจ้งเตือนเดียวกัน
- ถ้าสมาชิกบล็อกบอต บอตจะลบออกจากรายชื่อเองในการแจ้งเตือนครั้งถัดไป
- ถ้าอ่านรายชื่อสมาชิกจาก DB ไม่ได้ บอตยังแจ้งเตือนแอดมินตามปกติ

### เมนู Telegram: ตั้งค่าแจ้งเตือน และประวัติเติมของ

บอตลงทะเบียนคำสั่งไว้ในปุ่ม **Menu** ของ Telegram อัตโนมัติเมื่อเริ่มทำงาน

| คำสั่ง | ทำอะไร |
|---|---|
| `/menu` (หรือ `เมนู`, `/help`) | เมนูหลักแบบปุ่มกด (แอดมินมีปุ่ม 👥 สมาชิก & ลิงก์เชิญ เพิ่ม) |
| `/stock` (หรือ `สต็อก`) | ตอบทันที: สินค้าที่มีของตอนนี้ทุกรุ่น พร้อมสาขา (จากการตรวจล่าสุด) กด 📋 ชื่อรุ่นเพื่อดูรายการหมดด้วย |
| `/alerts` (หรือ `แจ้งเตือน`) | เปิด/ปิดแจ้งเตือนตาม **รุ่น / สี / ความจุ** |
| `/history` (หรือ `สถิติ`) | 📈 ดูสถิติของเคยเข้า: เลือกรุ่น แล้วเลือกสี/ความจุ ดูย้อนหลัง 6 เดือน |

**ตั้งค่าแจ้งเตือน** เก็บแยกต่อแชต (ตาราง `telegram_alert_mutes`) และมีผลกับ Telegram เท่านั้น LINE/Discord ยังได้ครบทุกรายการ
เลือกรุ่น → แตะเปิด/ปิด **ทีละแบบ** (สี + ความจุ เช่น "ไนท์สกาย 256GB") หรือ ✅ เปิดทุกแบบ / 🔕 ปิดทุกแบบ ของรุ่นนั้น
เก็บเป็น kind `variant` ค่า `iPhone Duo::Night Sky::256GB` — ปิดไนท์สกาย 256GB ไม่กระทบสตาร์ไวท์ 256GB
(การตั้งค่าแบบเก่าที่แยกสี/ความจุ ถูก migration แปลงเป็นรายแบบให้ผลเท่าเดิม)
ข้อความแจ้งเตือนในแชตนั้นจะซ่อนรายการที่ปิดไว้ และถ้ารายการที่เพิ่งมีของถูกปิดทั้งหมด แชตนั้นจะไม่ได้รับข้อความ
ถ้าอ่านการตั้งค่าจาก DB ไม่ได้ บอตจะส่งแจ้งเตือนเต็มแทน (กันพลาดของเข้า)

**📈 สถิติของเคยเข้า** อ่านจาก `stock_history`: ทุกครั้งที่สถานะเปลี่ยนเป็น `AVAILABLE` คือการเติมของ 1 ครั้ง
แสดงจำนวนครั้งต่อสาขา, 15 รายการล่าสุดพร้อมเวลาที่ของหมด และช่วงเวลาที่เติมบ่อยสุด
เวลาคือเวลาที่บอตตรวจพบ (ตรวจเฉพาะช่วงเวลาทำงานของบอต) ข้อมูลก่อนอัปเดตนี้ที่เก่ากว่า 72 ชั่วโมงถูกลบไปแล้ว

อัปเดตนี้มีตารางใหม่ (`telegram_alert_mutes`, `telegram_subscribers`, `paused_models`) และแปลงการตั้งค่าสี/ความจุเดิมให้เป็นรายรุ่น ต้องรัน migration ก่อนรีสตาร์ต:

```bash
npm run prisma:deploy && npm run prisma:generate && npm run build
```


### DataImpulse residential proxy

คำขอ Apple ทั้งหน้า catalog และ pickup JSON รองรับ DataImpulse HTTP(S) proxy
โดยช่องแจ้งเตือนยังใช้เครือข่ายเดิม ตั้งค่าใน `.env` (ห้าม commit credentials):

```env
# คัดลอก proxy login/password จาก DataImpulse dashboard ไม่ใช่รหัสบัญชี
DATAIMPULSE_USERNAME=YOUR_PROXY_LOGIN
DATAIMPULSE_PASSWORD=YOUR_PROXY_PASSWORD
# เปิดหลังกรอก credentials ครบ: session ID ผ่าน port 823
APPLE_PROXY_URL=http://gw.dataimpulse.com:823
APPLE_PROXY_MAX_ROTATIONS=3
```

DataImpulse ระบุ HTTP rotating port เป็น 823 และ sticky ports เป็น 10000–20000:
https://docs.dataimpulse.com/proxies/protocols
ใช้ gateway/port ที่ dashboard แสดงหากแตกต่างจากตัวอย่าง
ใช้ rotating port 823 โดยไม่เติม `sessid` และเปิด tunnel ใหม่ทุกคำขอ
เพื่อให้ DataImpulse เลือก IP ขาออกต่อคำขอ (IP อาจซ้ำได้)
เมื่อเจอ 403/429/503/541 ไม่ retry ทันที และพัก 15 นาทีตามเดิม
รอบปกติพักหลังจบรอบ: 08:00–09:00 น. สุ่ม 10–15 วินาที ช่วงอื่น 30 วินาที (เวลาไทย)
หาก proxy ล้มเหลว คำขอจะรายงานข้อผิดพลาด ไม่ fallback ไป direct
ปิด proxy โดยล้าง `APPLE_PROXY_URL` แล้ว restart

เมื่อใช้ Docker ต้อง rebuild/recreate เพื่อรับ dependency, source และ environment ใหม่:

```bash
docker compose up -d --build bot
```

ยังต้องทดสอบด้วยบัญชีจริงเพื่อยืนยันว่า Apple ไทยเข้าถึงได้และวัดอัตรา 541
การรองรับ proxy ไม่ได้รับประกันว่าจะไม่ถูก Apple จำกัด


ตั้ง `DISCORD_PROXY_LOG_ENABLED=true` เพื่อแจ้งเฉพาะพร็อกซีเชื่อมต่อผิดพลาด/หมดเวลา หรือยืนยันตัวตนไม่ผ่านใน Discord (ไม่แจ้งคำขอที่สำเร็จ)
Discord แจ้งเมื่อพร็อกซีหรือ rate limit กลับมาปกติครั้งเดียวต่อการฟื้นตัว และแจ้ง rate limit ผ่าน `RATE_LIMIT_ALERT_ENABLED` ส่วน Telegram และ LINE แจ้งอัตโนมัติเฉพาะสต็อกเข้า
โหมด rotating ไม่แสดง IP จาก ipify เพราะเป็นคนละคำขอกับ Apple และอาจได้คนละ IP
จึงแสดงว่า IP ปลายทางไม่ทราบ และไม่ส่งคำขอตรวจ IP เพิ่ม
Discord log ส่งเป็นคิวเบื้องหลังสูงสุด 100 รายการ และอาจข้ามเมื่อคิวเต็ม


เปิด `STOCK_CHECK_WINDOW_ENABLED=true` (ค่าเริ่มต้น) เพื่อเช็กเฉพาะทุกวัน
05:30–22:00 เวลา Asia/Bangkok โดย 22:00 ไม่เริ่มคำขอใหม่
นอกเวลารอถึง 05:30 อัตโนมัติ และไม่โหลด catalog จาก Apple ตอนเปิดบอต
ตรวจซ้ำก่อน HTTP ทุก attempt เพื่อกัน retry ที่ข้ามเวลา 22:00
คำขอที่เริ่มก่อน 22:00 อาจจบหลังเวลาปิดได้ ส่วนคำสั่ง Telegram ยังใช้ได้
ต้องเปิด process และเครื่องให้ทำงานอยู่ จึงเริ่มรอบเช้าอัตโนมัติได้

### ตั้งราคาค่าสมาชิก Telegram

เจ้าของบอทเปิด `/menu` → **💳 ตั้งราคาค่าสมาชิก** แล้วพิมพ์ราคาเป็นบาท เช่น `199` หรือ `199.50` (ยกเลิกด้วย `/menu`)
ราคาบันทึกในฐานข้อมูลและยังอยู่หลังรีสตาร์ต ผู้ขอเข้าร่วมจะเห็นยอดปัจจุบันเมื่อกด Start ทั้งในข้อความใต้รูป QR และข้อความชำระเงินกรณีส่งรูปไม่ได้
การแก้ราคาไม่ส่งข้อความใหม่ให้คำขอเก่าอัตโนมัติ หากยังไม่ตั้งราคา บอทจะแจ้งให้สอบถามยอดจากเจ้าของก่อนชำระเงิน การอนุมัติและกำหนดวันหมดอายุยังดำเนินการโดยเจ้าของตามเดิม

หากอัปเดตฐานข้อมูลเอง ให้รัน `npx prisma migrate deploy` ก่อนเปิดบอทเวอร์ชันนี้

### ส่งข้อความ Telegram ถึงสมาชิกรายคน

เจ้าของบอทเปิด `/menu` → **💬 ส่งข้อความรายคน** → เลือกสมาชิก → พิมพ์ข้อความ → ดูตัวอย่าง → **✅ ยืนยันส่งรายคน**
ส่งถึงผู้รับที่เลือกเพียงคนเดียวในนามบอต ผู้รับจะเห็นหัวข้อ “💬 ข้อความจากเจ้าของบอท” พิมพ์ข้อความใหม่เพื่อแก้ตัวอย่างได้ ยกเลิกด้วยปุ่มยกเลิกหรือ `/menu`
รายการแบ่งหน้าละ 8 คนและแสดงเฉพาะสมาชิกที่อนุมัติแล้ว ข้อความยาวได้สูงสุด 3,800 ตัวอักษร ร่างจะถูกล้างเมื่อรีสตาร์ตบอต

### เตือนต่ออายุ Telegram ล่วงหน้า 1 วัน

บอตตรวจทุกชั่วโมงและหลังเริ่มโปรแกรม 30 วินาที ตั้งแต่ `MEMBER_EXPIRY_CHECK_HOUR` (เริ่มต้น 09:00 น. เวลาไทย) ในวันก่อนหมดอายุ จะส่งข้อความเตือน พร้อมยอดค่าสมาชิกปัจจุบันและ QR จาก `TELEGRAM_PAYMENT_QR_PATH` ให้สมาชิกโดยตรง
บันทึกการส่งแยกตามสมาชิกและวันหมดอายุไว้ในฐานข้อมูลเพื่อป้องกันส่งซ้ำหลังรีสตาร์ต หากส่งไม่สำเร็จจะลองในรอบถัดไป สมาชิกที่ไม่กำหนดวันหมดอายุจะไม่รับการเตือนนี้ หากส่ง QR ไม่สำเร็จจะส่งข้อความเตือนให้ติดต่อเจ้าของเพื่อขอ QR แทน

สมาชิกส่งรูปสลิปหรือ PDF ในแชตบอตได้ บอตส่งต่อให้แอดมินพร้อมปุ่ม **📅 ตรวจสลิป / ต่ออายุสมาชิก** แอดมินตรวจยอดแล้วกำหนดวันหมดอายุใหม่ บอตจะแจ้งวันหมดอายุใหม่ให้สมาชิก ไม่ต่ออายุจากสลิปโดยอัตโนมัติ และยังนำสมาชิกออกตามเงื่อนไขหมดอายุเดิมหากยังไม่ได้ต่ออายุ

ต้องรัน `npx prisma migrate deploy` เพื่อเพิ่มตารางบันทึกการแจ้งเตือนก่อนเปิดบอทเวอร์ชันนี้
