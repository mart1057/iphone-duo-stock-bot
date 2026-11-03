// Single-file admin page served at "/". Plain JS, no build step.
// NOTE: no backticks or dollar-brace inside — this whole page is one template literal.
export const adminPage = String.raw`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock Bot Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f4f3ef; --surface:#ffffff; --surface-2:#f9f8f5; --line:#e4e1d9; --ink:#1c1b18; --ink-2:#5f5b52; --ink-3:#8d887c;
  --accent:#1f6f4a; --accent-soft:#e3f1e9; --warn:#a15c07; --warn-soft:#fbefd9; --danger:#b42318; --danger-soft:#fde7e4;
  --info:#2453a6; --info-soft:#e4ecfa; --shadow:0 1px 2px rgba(28,27,24,.06),0 4px 16px rgba(28,27,24,.04);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#141412; --surface:#1d1c19; --surface-2:#23221f; --line:#33312c; --ink:#f0eee8; --ink-2:#b5b0a4; --ink-3:#868176;
  --accent:#5cc58f; --accent-soft:#1d3a2b; --warn:#f0b04a; --warn-soft:#3b2d14; --danger:#f2786b; --danger-soft:#3f1d19;
  --info:#82a9ee; --info-soft:#1b2a44; --shadow:none; color-scheme:dark;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 "IBM Plex Sans Thai",system-ui,sans-serif}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px}
.wrap{max-width:1180px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}
h1{font-size:26px;line-height:1.2;margin:0;font-weight:700;letter-spacing:-.01em}
.sub{color:var(--ink-2);margin-top:4px;font-size:14px}
h2{font-size:16px;margin:0;font-weight:600}
button{font:inherit;cursor:pointer;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:7px 12px;font-size:14px;font-weight:500;transition:background .15s,border-color .15s}
button:hover{background:var(--surface-2);border-color:var(--ink-3)}
button:disabled{opacity:.5;cursor:default}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
button.primary:hover{filter:brightness(1.07)}
button.danger{color:var(--danger)}
button.danger:hover{background:var(--danger-soft);border-color:var(--danger)}
button.ghost{border-color:transparent;background:transparent}
button.sm{padding:4px 9px;font-size:13px}
input{font:inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:7px 11px;font-size:14px}
input:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow);min-width:0}
.kpi .label{color:var(--ink-2);font-size:13px}
.kpi .value{font-size:30px;font-weight:700;line-height:1.15;margin-top:4px;font-variant-numeric:tabular-nums}
.kpi .hint{color:var(--ink-3);font-size:12.5px;margin-top:2px}
.kpi.warn .value{color:var(--warn)} .kpi.pend .value{color:var(--info)}
.kpi .price-row{display:flex;gap:6px;align-items:center;margin-top:6px}
.kpi .price-row input{width:100%;min-width:0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);margin-bottom:16px}
.card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.card-b{padding:14px 16px}
.timeline{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--surface-2);gap:2px}
.timeline span{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px;font-size:13px;color:var(--ink-2)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.legend b{color:var(--ink);font-variant-numeric:tabular-nums;margin-left:4px}
.pending{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
.pcard{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--surface-2);display:flex;flex-direction:column;gap:8px}
.pcard .row{display:flex;gap:6px;flex-wrap:wrap}
.who{font-weight:600}
.who small{display:block;font-weight:400;color:var(--ink-3)}
.tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.chips{display:flex;gap:4px;flex-wrap:wrap}
.chip{border-radius:999px;padding:4px 11px;font-size:13px}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.chip .n{opacity:.65;margin-left:4px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse}
th{font-size:12.5px;font-weight:500;color:var(--ink-3);text-align:left;padding:10px 16px;border-bottom:1px solid var(--line);white-space:nowrap}
th.sortable{cursor:pointer;user-select:none} th.sortable:hover{color:var(--ink)}
td{padding:11px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}
.badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12.5px;font-weight:500;white-space:nowrap}
.b-ok{background:var(--accent-soft);color:var(--accent)} .b-warn{background:var(--warn-soft);color:var(--warn)}
.b-bad{background:var(--danger-soft);color:var(--danger)} .b-inf{background:var(--info-soft);color:var(--info)}
.b-mute{background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line)}
.num{font-variant-numeric:tabular-nums}
.acts{display:flex;gap:4px;justify-content:flex-end;flex-wrap:wrap}
.empty{padding:36px 16px;text-align:center;color:var(--ink-3)}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--surface);padding:10px 16px;border-radius:10px;font-size:14px;opacity:0;pointer-events:none;transition:.2s;max-width:calc(100% - 32px);z-index:9}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.toast.err{background:var(--danger);color:#fff}
dialog{border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:0;width:min(420px,calc(100% - 32px));box-shadow:0 20px 60px rgba(0,0,0,.25)}
dialog::backdrop{background:rgba(20,20,18,.45)}
dialog .dh{padding:16px 18px 4px;font-weight:600;font-size:16px}
dialog .db{padding:8px 18px 16px;color:var(--ink-2);font-size:14px}
dialog .df{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--line)}
.presets{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.field{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.field label{font-size:13px;color:var(--ink-2)}
.check{display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13.5px;color:var(--ink-2)}
@media (max-width:960px){.kpis{grid-template-columns:repeat(2,1fr)} .kpi.price{grid-column:span 2}}
@media (max-width:720px){
  thead{display:none} table,tbody,tr,td{display:block;width:100%}
  tr{border-bottom:1px solid var(--line);padding:10px 0} tr:last-child{border-bottom:0}
  td{border:0;padding:3px 16px} td[data-k]::before{content:attr(data-k);color:var(--ink-3);font-size:12.5px;display:inline-block;width:96px}
  .acts{justify-content:flex-start;padding-top:6px}
  .kpi .value{font-size:26px}
}
nav.tabs{display:flex;gap:2px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:3px;overflow-x:auto;max-width:100%}
nav.tabs a{padding:6px 13px;border-radius:7px;color:var(--ink-2);text-decoration:none;font-size:14px;font-weight:500;white-space:nowrap}
nav.tabs a:hover{color:var(--ink);background:var(--surface-2)}
nav.tabs a[aria-current="page"]{background:var(--ink);color:var(--surface)}
.head-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vsub{margin:-8px 0 16px}
.view[hidden]{display:none}
.kpis.k4{grid-template-columns:repeat(4,1fr)}
.kpi .value.sm{font-size:19px;line-height:1.35;margin-top:6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.grid2 > .card{margin-bottom:0}
.cols{display:flex;align-items:flex-end;gap:2px;height:140px;padding-top:8px}
.cols .c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;min-width:0}
.cols .c span{display:block;background:var(--accent);border-radius:3px 3px 0 0;min-height:1px;opacity:.9}
.cols .c span.zero{background:var(--line);opacity:1}
.cols .c:hover span{opacity:1;filter:brightness(1.1)}
.xlab{display:flex;gap:2px;margin-top:6px;font-size:11.5px;color:var(--ink-3)}
.xlab span{flex:1;text-align:center;min-width:0;white-space:nowrap}
.hbars{display:flex;flex-direction:column;gap:7px}
.hbar{display:grid;grid-template-columns:minmax(90px,38%) 1fr 34px;gap:10px;align-items:center;font-size:13.5px}
.hbar .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
.hbar .track{height:10px;background:var(--surface-2);border-radius:5px;overflow:hidden}
.hbar .track span{display:block;height:100%;background:var(--accent);border-radius:5px}
.hbar .n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
select{font:inherit;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:6px 10px;font-size:14px}
.models{display:flex;flex-direction:column;gap:16px}
.skus{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.sku{border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--surface-2);display:flex;flex-direction:column;gap:6px;min-width:0}
.sku.on{border-color:var(--accent);background:var(--accent-soft)}
.sku .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.sku .nm{font-weight:600}
.sku .stores{font-size:13px;color:var(--ink-2)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}
.meter{display:flex;align-items:center;gap:8px;min-width:120px}
.meter .track{flex:1;height:8px;background:var(--surface-2);border:1px solid var(--line);border-radius:4px;overflow:hidden}
.meter .track span{display:block;height:100%;background:var(--accent)}
.meter b{font-variant-numeric:tabular-nums;font-size:13px;min-width:36px;text-align:right}
.note{font-size:13px;color:var(--ink-3);padding:12px 16px;border-top:1px solid var(--line)}
.tscroll{overflow-x:auto}
@media (max-width:960px){.kpis.k4{grid-template-columns:repeat(2,1fr)} .grid2{grid-template-columns:1fr}}
@media (max-width:720px){.tscroll{overflow:visible} td[data-k] .meter{display:inline-flex;width:calc(100% - 100px);vertical-align:middle}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1 id="title">สมาชิกบอทแจ้งสต็อก</h1>
    </div>
    <div class="head-r">
      <nav class="tabs" aria-label="เมนู">
        <a href="#members" data-view="members">👥 สมาชิก</a>
        <a href="#restocks" data-view="restocks">📈 สถิติของเข้า</a>
        <a href="#stock" data-view="stock">📦 ของที่มีตอนนี้</a>
        <a href="#forecast" data-view="forecast">🔮 คาดการณ์</a>
      </nav>
      <button id="refresh" type="button">↻ รีเฟรช</button>
    </div>
  </header>

<main class="view" id="v-members">
  <div class="sub vsub" id="sub">กำลังโหลด…</div>

  <section class="kpis" aria-label="สรุป">
    <div class="kpi"><div class="label">สมาชิกที่ใช้งาน</div><div class="value" id="k-active">–</div><div class="hint" id="k-active-h">&nbsp;</div></div>
    <div class="kpi pend"><div class="label">รออนุมัติ</div><div class="value" id="k-pending">–</div><div class="hint">กดอนุมัติด้านล่าง</div></div>
    <div class="kpi warn"><div class="label">หมดอายุภายใน 7 วัน</div><div class="value" id="k-soon">–</div><div class="hint" id="k-soon-h">&nbsp;</div></div>
    <div class="kpi"><div class="label">ไม่มีวันหมดอายุ</div><div class="value" id="k-never">–</div><div class="hint" id="k-admin">&nbsp;</div></div>
    <div class="kpi price"><div class="label">ราคาสมาชิก / รอบ</div>
      <form class="price-row" id="price-form"><input id="price" inputmode="decimal" placeholder="เช่น 199" aria-label="ราคาสมาชิก (บาท)"><button class="sm" type="submit">บันทึก</button></form>
      <div class="hint" id="k-price">&nbsp;</div>
    </div>
  </section>

  <section class="card">
    <div class="card-h"><h2>วันหมดอายุของสมาชิก</h2><span class="sub" id="tl-note" style="margin:0"></span></div>
    <div class="card-b"><div class="timeline" id="timeline"></div><div class="legend" id="legend"></div></div>
  </section>

  <section class="card" id="pending-card" hidden>
    <div class="card-h"><h2>⏳ คำขอเข้าร่วม</h2><span class="badge b-inf" id="pending-n"></span></div>
    <div class="card-b"><div class="pending" id="pending"></div></div>
  </section>

  <section class="card">
    <div class="card-h">
      <h2>รายชื่อสมาชิก</h2>
      <div class="tools">
        <div class="chips" id="chips" role="group" aria-label="กรอง"></div>
        <input id="q" type="search" placeholder="ค้นหาชื่อ / @username / chat id" style="width:240px;max-width:100%">
      </div>
    </div>
    <table>
      <thead><tr>
        <th>สมาชิก</th><th class="sortable" data-sort="joined">เข้าร่วม</th><th class="sortable" data-sort="expiry">หมดอายุ ↕</th><th>สถานะ</th><th style="text-align:right">จัดการ</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>ไม่มีสมาชิกที่ตรงเงื่อนไข</div>
  </section>
</main>

<main class="view" id="v-restocks" hidden>
  <div class="tools vsub" style="justify-content:space-between">
    <div class="sub" id="rs-sub" style="margin:0">กำลังโหลด…</div>
    <div class="chips" id="rs-days" role="group" aria-label="ช่วงเวลา"></div>
  </div>
  <section class="kpis k4">
    <div class="kpi"><div class="label">ของเข้า (ครั้ง × สาขา)</div><div class="value" id="rs-events">–</div><div class="hint" id="rs-drops">&nbsp;</div></div>
    <div class="kpi"><div class="label">แบบที่เคยเข้า</div><div class="value" id="rs-variants">–</div><div class="hint" id="rs-stores">&nbsp;</div></div>
    <div class="kpi"><div class="label">อยู่ได้นาน (ค่ากลาง)</div><div class="value sm" id="rs-life">–</div><div class="hint">นับจากเจอของจนหมด</div></div>
    <div class="kpi"><div class="label">เข้าล่าสุด</div><div class="value sm" id="rs-last">–</div><div class="hint" id="rs-last-h">&nbsp;</div></div>
  </section>
  <section class="card">
    <div class="card-h"><h2>ของเข้ารายวัน</h2><span class="sub" style="margin:0" id="rs-day-note"></span></div>
    <div class="card-b"><div class="cols" id="rs-byday"></div><div class="xlab" id="rs-byday-x"></div></div>
  </section>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>ช่วงเวลาที่เข้า (ชั่วโมง)</h2></div>
      <div class="card-b"><div class="cols" id="rs-byhour"></div><div class="xlab" id="rs-byhour-x"></div></div></section>
    <section class="card"><div class="card-h"><h2>วันในสัปดาห์</h2></div>
      <div class="card-b"><div class="hbars" id="rs-byweek"></div></div></section>
  </div>
  <div class="grid2">
    <section class="card"><div class="card-h"><h2>แบบที่เข้าบ่อย</h2></div>
      <div class="card-b"><div class="hbars" id="rs-byvariant"></div></div></section>
    <section class="card"><div class="card-h"><h2>แยกตามสาขา</h2></div>
      <div class="card-b"><div class="hbars" id="rs-bystore"></div></div></section>
  </div>
  <section class="card">
    <div class="card-h"><h2>ของเข้าล่าสุด</h2></div>
    <div class="tscroll"><table>
      <thead><tr><th>เวลาเจอของ</th><th>แบบ</th><th>สาขา</th><th>ผล</th></tr></thead>
      <tbody id="rs-recent"></tbody>
    </table></div>
    <div class="empty" id="rs-empty" hidden>ช่วงนี้ยังไม่มีของเข้า</div>
    <div class="note">เวลาที่แสดงคือเวลาที่บอทเจอของ · นับ 1 ครั้งต่อ 1 สาขา · หลายสาขาเข้าภายใน 1 ชม. นับเป็น 1 รอบ</div>
  </section>
</main>

<main class="view" id="v-stock" hidden>
  <div class="tools vsub" style="justify-content:space-between">
    <div class="sub" id="st-sub" style="margin:0">กำลังโหลด…</div>
    <label class="check" style="margin:0"><input type="checkbox" id="st-only"> แสดงเฉพาะแบบที่มีของ</label>
  </div>
  <section class="kpis k4">
    <div class="kpi"><div class="label">แบบที่มีของตอนนี้</div><div class="value" id="st-on">–</div><div class="hint" id="st-on-h">&nbsp;</div></div>
    <div class="kpi"><div class="label">สาขาที่มีของ</div><div class="value" id="st-stores">–</div><div class="hint" id="st-stores-h">&nbsp;</div></div>
    <div class="kpi warn"><div class="label">เช็คไม่ได้ชั่วคราว</div><div class="value" id="st-unk">–</div><div class="hint">Apple ไม่ตอบ / ถูกจำกัด</div></div>
    <div class="kpi"><div class="label">เช็คล่าสุด</div><div class="value sm" id="st-last">–</div><div class="hint" id="st-paused">&nbsp;</div></div>
  </section>
  <div class="models" id="st-models"></div>
</main>

<main class="view" id="v-forecast" hidden>
  <div class="tools vsub" style="justify-content:space-between">
    <div class="sub" id="fc-sub" style="margin:0">กำลังโหลด…</div>
    <div class="tools">
      <select id="fc-model" aria-label="รุ่น"></select>
      <select id="fc-sort" aria-label="เรียงตาม">
        <option value="watchers">เรียง: คนรอมากสุด</option>
        <option value="chance">เรียง: โอกาสเข้าสูงสุด</option>
        <option value="next">เรียง: คาดว่าเข้าเร็วสุด</option>
      </select>
    </div>
  </div>
  <section class="kpis k4">
    <div class="kpi"><div class="label">คนรับแจ้งเตือน</div><div class="value" id="fc-chats">–</div><div class="hint">รวมแอดมิน</div></div>
    <div class="kpi"><div class="label">แบบที่คนรอมากสุด</div><div class="value sm" id="fc-top">–</div><div class="hint" id="fc-top-h">&nbsp;</div></div>
    <div class="kpi"><div class="label">น่าจะเข้าเร็วสุด</div><div class="value sm" id="fc-soon">–</div><div class="hint" id="fc-soon-h">&nbsp;</div></div>
    <div class="kpi"><div class="label">ข้อมูลที่ใช้คาดการณ์</div><div class="value sm" id="fc-days">–</div><div class="hint">ยิ่งนาน ยิ่งแม่น</div></div>
  </section>
  <section class="card">
    <div class="card-h"><h2>คาดการณ์รายแบบ</h2><span class="sub" style="margin:0">คนรอ = แชทที่ไม่ได้ปิดเตือนแบบนี้</span></div>
    <div class="tscroll"><table>
      <thead><tr><th>แบบ</th><th>คนรอ</th><th>เข้าแล้ว</th><th>รอบเฉลี่ย</th><th>คาดว่าเข้าครั้งถัดไป</th><th>มักเข้า</th><th>โอกาสใน 7 วัน</th><th>ความมั่นใจ</th></tr></thead>
      <tbody id="fc-rows"></tbody>
    </table></div>
    <div class="empty" id="fc-empty" hidden>ยังไม่มีข้อมูลรุ่น</div>
    <div class="note">คาดการณ์จากประวัติของเข้าเท่านั้น (Apple ไม่ได้ประกาศรอบส่งของ) · “คาดว่าเข้า” = รอบล่าสุด + ระยะห่างค่ากลางระหว่างรอบ ต้องมีอย่างน้อย 3 รอบ · “โอกาสใน 7 วัน” คิดจากความถี่เฉลี่ยของรอบที่ผ่านมา</div>
  </section>
</main>
</div>

<dialog id="dlg-expiry">
  <form method="dialog">
    <div class="dh">ตั้งวันหมดอายุ</div>
    <div class="db">
      <div id="ex-who" class="who"></div>
      <div id="ex-cur" style="margin-top:2px"></div>
      <div class="presets" id="presets"></div>
      <label class="check"><input type="checkbox" id="ex-extend" checked> ต่อจากวันหมดอายุเดิม (ถ้ายังไม่หมด)</label>
      <div class="field"><label for="ex-date">หรือเลือกวันที่</label><input type="date" id="ex-date"></div>
      <div style="margin-top:10px;font-size:13px;color:var(--ink-3)">บอทจะส่งข้อความแจ้งสมาชิกใน Telegram</div>
    </div>
    <div class="df">
      <button type="button" class="ghost" id="ex-never">♾️ ไม่มีกำหนด</button>
      <span style="flex:1"></span>
      <button value="cancel">ยกเลิก</button>
      <button type="button" class="primary" id="ex-save">บันทึกวันที่</button>
    </div>
  </form>
</dialog>

<dialog id="dlg-confirm">
  <form method="dialog">
    <div class="dh" id="cf-title"></div>
    <div class="db" id="cf-body"></div>
    <div class="df"><button value="cancel">ยกเลิก</button><button value="ok" class="danger" id="cf-ok">ยืนยัน</button></div>
  </form>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(function(){
  var state = { data:null, filter:'all', q:'', sort:'expiry', dir:1, target:null };
  var $ = function(id){ return document.getElementById(id); };
  var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  var fmtKey = function(k){ if(!k) return ''; var p = k.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  var fmtIso = function(iso){ if(!iso) return '–'; var d = new Date(iso); return d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit',timeZone:'Asia/Bangkok'}); };
  var nameOf = function(m){ return m.name || (m.username ? '@' + m.username : m.chatId); };

  var toastTimer;
  function toast(msg, err){
    var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.className = 'toast' + (err ? ' err' : ''); }, 3200);
  }

  function api(method, path, body){
    var opt = { method: method, headers: {} };
    if (method !== 'GET') { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body || {}); }
    return fetch(path, opt).then(function(r){
      return r.json().catch(function(){ return { ok:false, message:'HTTP ' + r.status }; }).then(function(j){
        if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function bucket(m){
    if (m.daysLeft == null) return 'never';
    if (m.daysLeft <= 1) return 'd1';
    if (m.daysLeft <= 7) return 'd7';
    if (m.daysLeft <= 30) return 'd30';
    return 'later';
  }
  var BUCKETS = [
    { k:'d1', label:'วันนี้–พรุ่งนี้', color:'var(--danger)' },
    { k:'d7', label:'2–7 วัน', color:'var(--warn)' },
    { k:'d30', label:'8–30 วัน', color:'var(--info)' },
    { k:'later', label:'มากกว่า 30 วัน', color:'var(--accent)' },
    { k:'never', label:'ไม่มีกำหนด', color:'var(--ink-3)' }
  ];

  function statusBadge(m){
    var b = bucket(m);
    if (b === 'never') return '<span class="badge b-mute">♾️ ไม่มีกำหนด</span>';
    if (m.daysLeft <= 0) return '<span class="badge b-bad">หมดอายุวันนี้</span>';
    if (b === 'd1') return '<span class="badge b-bad">เหลือ 1 วัน</span>';
    if (b === 'd7') return '<span class="badge b-warn">เหลือ ' + m.daysLeft + ' วัน</span>';
    return '<span class="badge b-ok">เหลือ ' + m.daysLeft + ' วัน</span>';
  }

  function render(){
    var d = state.data; if (!d) return;
    var members = d.members, pending = d.pending;
    var now = new Date();
    $('sub').textContent = 'วันนี้ ' + fmtKey(d.today) + ' · ระบบนำสมาชิกที่หมดอายุออกเวลา ' + String(d.expiryCheckHour).padStart(2,'0') + ':00 น. · อัปเดต ' + now.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});

    var counts = { d1:0, d7:0, d30:0, later:0, never:0 };
    members.forEach(function(m){ counts[bucket(m)]++; });
    var monthAgo = Date.now() - 30*86400000;
    var newCount = members.filter(function(m){ return Date.parse(m.approvedAt || m.joinedAt) >= monthAgo; }).length;

    $('k-active').textContent = members.length;
    $('k-active-h').textContent = newCount ? ('+' + newCount + ' คนใน 30 วันล่าสุด') : 'ไม่มีสมาชิกใหม่ใน 30 วัน';
    $('k-pending').textContent = pending.length;
    $('k-soon').textContent = counts.d1 + counts.d7;
    $('k-soon-h').textContent = counts.d1 ? (counts.d1 + ' คนหมดวันนี้–พรุ่งนี้') : 'ยังไม่มีใครใกล้หมด';
    $('k-never').textContent = counts.never;
    $('k-admin').textContent = 'แอดมิน ' + d.adminCount + ' แชท (ไม่นับรวม)';
    $('k-price').textContent = d.priceLabel ? ('ตอนนี้ ' + d.priceLabel) : 'ยังไม่ได้ตั้งราคา';
    if (document.activeElement !== $('price')) $('price').value = d.priceSatang == null ? '' : (d.priceSatang/100).toFixed(2).replace(/\.00$/,'');

    var total = members.length || 1;
    $('timeline').innerHTML = members.length ? BUCKETS.filter(function(b){ return counts[b.k]; }).map(function(b){
      return '<span title="' + b.label + ': ' + counts[b.k] + '" style="width:' + (counts[b.k]/total*100) + '%;background:' + b.color + '"></span>';
    }).join('') : '';
    $('legend').innerHTML = BUCKETS.map(function(b){ return '<span><i style="background:' + b.color + '"></i>' + b.label + '<b>' + counts[b.k] + '</b></span>'; }).join('');
    $('tl-note').textContent = members.length ? '' : 'ยังไม่มีสมาชิก';

    $('pending-card').hidden = pending.length === 0;
    $('pending-n').textContent = pending.length + ' คำขอ';
    $('pending').innerHTML = pending.map(function(m){
      return '<div class="pcard"><div class="who">' + esc(nameOf(m)) + '<small>' + (m.username ? '@' + esc(m.username) + ' · ' : '') + '<span class="mono">' + esc(m.chatId) + '</span> · ขอเมื่อ ' + fmtIso(m.joinedAt) + '</small></div>' +
        '<div class="row"><button class="primary sm" data-act="approve" data-id="' + esc(m.chatId) + '">✅ อนุมัติ</button><button class="danger sm" data-act="reject" data-id="' + esc(m.chatId) + '">ปฏิเสธ</button></div></div>';
    }).join('');

    var filters = [
      { k:'all', label:'ทั้งหมด', n:members.length },
      { k:'soon', label:'ใกล้หมด (≤7 วัน)', n:counts.d1 + counts.d7 },
      { k:'never', label:'ไม่มีกำหนด', n:counts.never }
    ];
    $('chips').innerHTML = filters.map(function(f){ return '<button class="chip" type="button" data-filter="' + f.k + '" aria-pressed="' + (state.filter === f.k) + '">' + f.label + '<span class="n">' + f.n + '</span></button>'; }).join('');

    var q = state.q.trim().toLowerCase().replace(/^@/,'');
    var list = members.filter(function(m){
      var b = bucket(m);
      if (state.filter === 'soon' && b !== 'd1' && b !== 'd7') return false;
      if (state.filter === 'never' && b !== 'never') return false;
      if (!q) return true;
      return [m.name, m.username, m.chatId].some(function(v){ return v && String(v).toLowerCase().indexOf(q) >= 0; });
    });
    list.sort(function(a, b){
      if (state.sort === 'joined') return (Date.parse(a.approvedAt || a.joinedAt) - Date.parse(b.approvedAt || b.joinedAt)) * state.dir;
      var x = a.daysLeft == null ? 1e9 : a.daysLeft, y = b.daysLeft == null ? 1e9 : b.daysLeft;
      return (x - y) * state.dir;
    });

    $('empty').hidden = list.length > 0;
    $('empty').textContent = members.length ? 'ไม่มีสมาชิกที่ตรงเงื่อนไข' : 'ยังไม่มีสมาชิก — ส่งลิงก์เชิญจากบอทด้วย /invite';
    $('rows').innerHTML = list.map(function(m){
      var id = esc(m.chatId);
      return '<tr>' +
        '<td><div class="who">' + esc(nameOf(m)) + '<small>' + (m.username && m.name ? '@' + esc(m.username) + ' · ' : '') + '<span class="mono">' + id + '</span></small></div></td>' +
        '<td data-k="เข้าร่วม" class="num">' + fmtIso(m.approvedAt || m.joinedAt) + '</td>' +
        '<td data-k="หมดอายุ" class="num">' + (m.expiresOn ? fmtKey(m.expiresOn) : '–') + '</td>' +
        '<td data-k="สถานะ">' + statusBadge(m) + '</td>' +
        '<td><div class="acts">' +
          '<button class="sm" data-act="plus30" data-id="' + id + '" title="ต่ออายุ 30 วัน">+30 วัน</button>' +
          '<button class="sm" data-act="expiry" data-id="' + id + '">📅 ตั้งวันที่</button>' +
          '<button class="sm danger" data-act="remove" data-id="' + id + '">นำออก</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function load(){
    return api('GET', '/api/overview').then(function(d){ state.data = d; render(); });
  }

  function find(id){
    var d = state.data; if (!d) return null;
    return d.members.concat(d.pending).filter(function(m){ return m.chatId === id; })[0] || null;
  }

  function run(promise){
    return promise.then(function(r){ toast(r.message || 'เรียบร้อย'); return load(); })
      .catch(function(e){ toast(e.message, true); load(); });
  }

  function confirmBox(title, body, okLabel){
    return new Promise(function(resolve){
      var dlg = $('dlg-confirm');
      $('cf-title').textContent = title; $('cf-body').textContent = body; $('cf-ok').textContent = okLabel || 'ยืนยัน';
      dlg.onclose = function(){ resolve(dlg.returnValue === 'ok'); };
      dlg.returnValue = ''; dlg.showModal();
    });
  }

  function openExpiry(m){
    state.target = m.chatId;
    $('ex-who').textContent = nameOf(m);
    $('ex-cur').textContent = m.expiresOn ? ('หมดอายุปัจจุบัน: ' + fmtKey(m.expiresOn)) : 'ปัจจุบัน: ไม่มีวันหมดอายุ';
    $('ex-date').min = state.data.today;
    $('ex-date').value = m.expiresOn || '';
    $('presets').innerHTML = [[7,'7 วัน'],[30,'30 วัน'],[90,'90 วัน'],[180,'6 เดือน'],[365,'1 ปี']].map(function(p){
      return '<button type="button" class="sm" data-days="' + p[0] + '">+' + p[1] + '</button>';
    }).join('');
    $('dlg-expiry').showModal();
  }

  function setExpiry(body){
    var id = state.target; $('dlg-expiry').close();
    return run(api('PUT', '/api/members/' + encodeURIComponent(id) + '/expiry', body));
  }

  document.addEventListener('click', function(ev){
    var el = ev.target.closest('button'); if (!el) return;
    if (el.dataset.filter) { state.filter = el.dataset.filter; render(); return; }
    if (el.dataset.days) { setExpiry({ days: Number(el.dataset.days), extend: $('ex-extend').checked }); return; }
    var act = el.dataset.act, id = el.dataset.id; if (!act) return;
    var m = find(id); if (!m) return;
    var who = nameOf(m);
    if (act === 'approve') run(api('POST', '/api/members/' + encodeURIComponent(id) + '/approve'));
    else if (act === 'reject') confirmBox('ปฏิเสธคำขอของ ' + who + '?', 'บอทจะแจ้งว่าคำขอไม่ได้รับอนุมัติ', 'ปฏิเสธ').then(function(ok){ if (ok) run(api('POST', '/api/members/' + encodeURIComponent(id) + '/reject')); });
    else if (act === 'remove') confirmBox('นำ ' + who + ' ออก?', 'สมาชิกจะไม่ได้รับการแจ้งเตือนอีก และการตั้งค่าตัวกรองจะถูกล้าง ต้องส่งลิงก์เชิญใหม่ถ้าจะให้กลับมา', 'นำออก').then(function(ok){ if (ok) run(api('DELETE', '/api/members/' + encodeURIComponent(id))); });
    else if (act === 'plus30') { state.target = id; run(api('PUT', '/api/members/' + encodeURIComponent(id) + '/expiry', { days:30, extend:true })); }
    else if (act === 'expiry') openExpiry(m);
  });

  $('ex-save').addEventListener('click', function(){
    var v = $('ex-date').value; if (!v) { toast('เลือกวันที่ก่อน', true); return; }
    setExpiry({ date: v });
  });
  $('ex-never').addEventListener('click', function(){ setExpiry({ never:true }); });
  $('refresh').addEventListener('click', function(){ refreshCurrent(); });
  $('q').addEventListener('input', function(e){ state.q = e.target.value; render(); });
  document.querySelectorAll('th.sortable').forEach(function(th){
    th.addEventListener('click', function(){
      var k = th.dataset.sort; if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
      render();
    });
  });
  $('price-form').addEventListener('submit', function(e){
    e.preventDefault();
    run(api('PUT', '/api/price', { price: $('price').value }).then(function(r){ $('price').blur(); return r; }));
  });

  // ---------- shared helpers for the stats views ----------
  var WEEK = ['จันทร์','อังคาร','พุธ','พฤหัสฯ','ศุกร์','เสาร์','อาทิตย์'];
  var CONF = { high:['b-ok','สูง'], medium:['b-inf','กลาง'], low:['b-warn','ต่ำ'], none:['b-mute','ไม่มีข้อมูล'] };
  var pad2 = function(n){ return String(n).padStart(2,'0'); };
  var shortStore = function(n){ return String(n).replace(/^Apple\s+/i, ''); };
  function fmtDT(iso){ if(!iso) return '–'; var d = new Date(iso); return d.toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}) + ' น.'; }
  function fmtDur(ms){
    if (ms == null) return '–';
    var m = Math.floor(ms/60000); if (m < 1) return 'ไม่ถึง 1 นาที'; if (m < 60) return m + ' นาที';
    var h = Math.floor(m/60); if (h < 24) return h + ' ชม.' + (m%60 ? ' ' + (m%60) + ' นาที' : '');
    var d = Math.floor(h/24); return d + ' วัน' + (h%24 ? ' ' + (h%24) + ' ชม.' : '');
  }
  function ago(iso){ return iso ? fmtDur(Date.now() - Date.parse(iso)) + 'ที่แล้ว' : ''; }
  function skuName(m){ return esc(m.model) + ' · ' + esc(m.colorTh) + ' · ' + esc(m.storage); }
  function hbars(el, items, emptyText){
    var max = Math.max.apply(null, items.map(function(i){ return i.n; }).concat([1]));
    el.innerHTML = items.length ? items.map(function(i){
      return '<div class="hbar" title="' + esc(i.t) + ': ' + i.n + '"><span class="t">' + esc(i.t) + '</span><span class="track"><span style="width:' + (i.n/max*100) + '%"></span></span><span class="n">' + i.n + '</span></div>';
    }).join('') : '<div class="sub" style="margin:0">' + (emptyText || 'ยังไม่มีข้อมูล') + '</div>';
  }
  function cols(el, xel, items, labelEvery){
    var max = Math.max.apply(null, items.map(function(i){ return i.n; }).concat([1]));
    el.innerHTML = items.map(function(i){
      return '<div class="c" title="' + esc(i.tip) + ': ' + i.n + ' ครั้ง"><span class="' + (i.n ? '' : 'zero') + '" style="height:' + (i.n ? Math.max(3, i.n/max*100) : 1) + '%"></span></div>';
    }).join('');
    xel.innerHTML = items.map(function(i, k){ return '<span>' + (k % labelEvery === 0 ? esc(i.label) : '') + '</span>'; }).join('');
  }

  // ---------- restock statistics ----------
  var rs = { days: 30, data: null };
  function loadRestocks(){ return api('GET', '/api/restocks?days=' + rs.days).then(function(d){ rs.data = d; renderRestocks(); }); }
  function renderRestocks(){
    var d = rs.data; if (!d) return;
    var opts = [7,30,90,180].filter(function(n){ return n <= d.retentionDays; });
    if (opts.indexOf(d.retentionDays) < 0) opts.push(d.retentionDays);
    $('rs-days').innerHTML = opts.map(function(n){ return '<button class="chip" type="button" data-rsdays="' + n + '" aria-pressed="' + (rs.days === n) + '">' + (n >= 30 && n % 30 === 0 ? (n/30) + ' เดือน' : n + ' วัน') + '</button>'; }).join('');
    $('rs-sub').textContent = 'ย้อนหลัง ' + d.days + ' วัน · เก็บประวัติสูงสุด ' + d.retentionDays + ' วัน';
    var t = d.totals;
    $('rs-events').textContent = t.events;
    $('rs-drops').textContent = t.drops + ' รอบ';
    $('rs-variants').textContent = t.variants;
    $('rs-stores').textContent = 'จาก ' + t.stores + ' สาขา';
    $('rs-life').textContent = fmtDur(t.medianInStockMs);
    $('rs-last').textContent = t.lastAt ? fmtDT(t.lastAt) : 'ยังไม่มี';
    $('rs-last-h').textContent = t.lastAt ? ago(t.lastAt) : ' ';
    var dayItems = d.byDay.map(function(x){ var p = x.date.split('-'); return { n:x.count, label: Number(p[2]) + '/' + Number(p[1]), tip: fmtKey(x.date) }; });
    cols($('rs-byday'), $('rs-byday-x'), dayItems, Math.max(1, Math.ceil(dayItems.length / 10)));
    $('rs-day-note').textContent = d.days > 90 ? 'แสดง 90 วันล่าสุด' : '';
    cols($('rs-byhour'), $('rs-byhour-x'), d.byHour.map(function(n, h){ return { n:n, label: pad2(h), tip: pad2(h) + ':00–' + pad2((h+1)%24) + ':00' }; }), 3);
    hbars($('rs-byweek'), d.byWeekday.map(function(n, i){ return { t: WEEK[i], n: n }; }));
    hbars($('rs-byvariant'), d.byVariant.slice(0, 10).map(function(v){ return { t: v.model + ' · ' + v.colorTh + ' · ' + v.storage, n: v.count }; }), 'ช่วงนี้ยังไม่มีของเข้า');
    hbars($('rs-bystore'), d.byStore.map(function(s){ return { t: shortStore(s.store), n: s.count }; }), 'ช่วงนี้ยังไม่มีของเข้า');
    $('rs-empty').hidden = d.recent.length > 0;
    $('rs-recent').innerHTML = d.recent.slice(0, 20).map(function(e){
      var res = e.soldOutAt ? '<span class="badge b-mute">หมดใน ' + fmtDur(Date.parse(e.soldOutAt) - Date.parse(e.at)) + '</span>'
        : e.stillAvailable ? '<span class="badge b-ok">🟢 ยังมีของ</span>' : '<span class="badge b-mute">ไม่ทราบเวลาหมด</span>';
      return '<tr><td data-k="เวลา" class="num">' + fmtDT(e.at) + '</td><td data-k="แบบ">' + skuName(e) + '</td><td data-k="สาขา">' + esc(shortStore(e.storeName)) + '</td><td data-k="ผล">' + res + '</td></tr>';
    }).join('');
  }

  // ---------- current stock ----------
  var st = { data: null, only: false };
  function loadStock(){ return api('GET', '/api/stock').then(function(d){ st.data = d; renderStock(); }); }
  function renderStock(){
    var d = st.data; if (!d) return;
    var all = [], stores = {}, last = null, paused = [];
    d.models.forEach(function(m){
      if (m.paused) { paused.push(m.model); return; }
      if (m.lastCheckedAt && (!last || m.lastCheckedAt > last)) last = m.lastCheckedAt;
      m.skus.forEach(function(s){ all.push(s); s.availableAt.forEach(function(n){ stores[n] = 1; }); });
    });
    var on = all.filter(function(s){ return s.availableAt.length; }).length;
    var unk = all.filter(function(s){ return !s.availableAt.length && s.unknown; }).length;
    var storeNames = Object.keys(stores).map(shortStore);
    $('st-sub').textContent = 'ข้อมูลจากการเช็คล่าสุดของบอท (ไม่ได้ถาม Apple ใหม่) · รีเฟรชอัตโนมัติทุก 30 วินาที';
    $('st-on').textContent = on;
    $('st-on-h').textContent = 'จาก ' + all.length + ' แบบที่เช็คอยู่';
    $('st-stores').textContent = storeNames.length;
    $('st-stores-h').textContent = storeNames.join(', ') || 'ยังไม่มีสาขาไหนมีของ';
    $('st-unk').textContent = unk;
    $('st-last').textContent = last ? fmtDT(last) : '–';
    $('st-paused').textContent = paused.length ? '⏸️ หยุดเช็ค: ' + paused.join(', ') : (last ? ago(last) : ' ');
    $('st-models').innerHTML = d.models.length ? d.models.map(function(m){
      var skus = m.skus.filter(function(s){ return !st.only || s.availableAt.length; });
      var count = m.skus.filter(function(s){ return s.availableAt.length; }).length;
      var head = '<div class="card-h"><h2>📱 ' + esc(m.model) + '</h2><div class="tools">' +
        (m.paused ? '<span class="badge b-warn">⏸️ หยุดเช็คชั่วคราว</span>' : '<span class="badge ' + (count ? 'b-ok' : 'b-mute') + '">มีของ ' + count + ' / ' + m.skus.length + ' แบบ</span>') +
        '<span class="sub" style="margin:0">เช็ค ' + fmtDT(m.lastCheckedAt) + '</span></div></div>';
      var body;
      if (m.paused) body = '<div class="empty">ไม่มีการเช็คหรือแจ้งเตือนรุ่นนี้ จนกว่าจะเริ่มเช็คใหม่ (/models ในบอท)</div>';
      else if (!m.skus.length) body = '<div class="empty">ยังไม่มีข้อมูล รอบอทเช็คครั้งแรก</div>';
      else if (!skus.length) body = '<div class="empty">😢 รุ่นนี้ยังไม่มีของ</div>';
      else body = '<div class="card-b"><div class="skus">' + skus.map(function(s){
        var state = s.availableAt.length ? ['on','var(--accent)','มีของ'] : s.unknown ? ['','var(--warn)','เช็คไม่ได้'] : ['','var(--danger)','หมด'];
        return '<div class="sku ' + state[0] + '"><div class="top"><span class="nm">' + esc(s.colorTh) + ' · ' + esc(s.storage) + '</span><span style="font-size:13px;white-space:nowrap"><i class="dot" style="background:' + state[1] + '"></i>' + state[2] + '</span></div>' +
          (s.availableAt.length ? '<div class="stores">📍 ' + s.availableAt.map(function(n){ return esc(shortStore(n)); }).join(', ') + '</div>' : '') + '</div>';
      }).join('') + '</div></div>';
      return '<section class="card" style="margin:0">' + head + body + '</section>';
    }).join('') : '<section class="card"><div class="empty">ยังไม่มีข้อมูลรุ่น รอบอทเช็คครั้งแรก</div></section>';
  }

  // ---------- forecast ----------
  var fc = { data: null, model: '', sort: 'watchers' };
  function loadForecast(){ return api('GET', '/api/forecast').then(function(d){ fc.data = d; renderForecast(); }); }
  function renderForecast(){
    var d = fc.data; if (!d) return;
    var models = []; d.items.forEach(function(i){ if (models.indexOf(i.model) < 0) models.push(i.model); });
    $('fc-model').innerHTML = '<option value="">ทุกรุ่น</option>' + models.map(function(m){ return '<option' + (fc.model === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    var obs = Math.round(d.observedDays);
    $('fc-sub').textContent = 'คาดการณ์จากประวัติ ' + obs + ' วัน · คนรอคิดจากตัวกรองการแจ้งเตือนของแต่ละคน';
    $('fc-chats').textContent = d.chatCount;
    $('fc-days').textContent = obs + ' วัน';
    var live = d.items.filter(function(i){ return !i.paused; });
    var top = live.slice().sort(function(a, b){ return b.watchers - a.watchers; })[0];
    $('fc-top').innerHTML = top && top.watchers ? esc(top.colorTh) + ' · ' + esc(top.storage) : '–';
    $('fc-top-h').textContent = top && top.watchers ? top.model + ' · รอ ' + top.watchers + ' คน' : 'ยังไม่มีคนรอ';
    var soon = live.filter(function(i){ return !i.inStock && i.drops > 0; }).sort(function(a, b){ return b.chance7d - a.chance7d; })[0];
    $('fc-soon').innerHTML = soon ? esc(soon.colorTh) + ' · ' + esc(soon.storage) : '–';
    $('fc-soon-h').textContent = soon ? soon.model + ' · โอกาส 7 วัน ~' + Math.round(soon.chance7d*100) + '%' : 'ยังมีประวัติไม่พอ';
    var list = d.items.filter(function(i){ return !fc.model || i.model === fc.model; });
    var maxW = Math.max.apply(null, list.map(function(i){ return i.watchers; }).concat([1]));
    list.sort(function(a, b){
      if (fc.sort === 'chance') return b.chance7d - a.chance7d || b.watchers - a.watchers;
      if (fc.sort === 'next') { var x = a.nextAt ? Date.parse(a.nextAt) : 9e15, y = b.nextAt ? Date.parse(b.nextAt) : 9e15; return x - y || b.watchers - a.watchers; }
      return b.watchers - a.watchers || b.chance7d - a.chance7d;
    });
    $('fc-empty').hidden = list.length > 0;
    var small = function(t){ return '<div class="sub" style="margin:0;font-size:12px">' + t + '</div>'; };
    $('fc-rows').innerHTML = list.map(function(i){
      var conf = CONF[i.confidence] || CONF.none, next;
      if (i.paused) next = '<span class="badge b-warn">⏸️ หยุดเช็ค</span>';
      else if (i.inStock) next = '<span class="badge b-ok">🟢 มีของตอนนี้</span>';
      else if (i.nextAt) next = '<span class="num">' + fmtDT(i.nextAt) + '</span>' + (i.overdue ? small('เลยรอบปกติมาแล้ว') : '');
      else next = '<span class="sub" style="margin:0">ข้อมูลยังไม่พอ</span>';
      var when = i.typicalHour != null ? pad2(i.typicalHour) + ':00 น.' + (i.typicalWeekday != null ? ' · ' + WEEK[i.typicalWeekday] : '') : '–';
      var pct = Math.round(i.chance7d*100);
      return '<tr>' +
        '<td><div class="who">' + esc(i.colorTh) + ' · ' + esc(i.storage) + '<small>' + esc(i.model) + '</small></div></td>' +
        '<td data-k="คนรอ"><div class="meter"><span class="track"><span style="width:' + (i.watchers/maxW*100) + '%"></span></span><b>' + i.watchers + '</b></div></td>' +
        '<td data-k="เข้าแล้ว" class="num">' + i.drops + ' รอบ' + (i.lastDropAt ? small('ล่าสุด ' + fmtDT(i.lastDropAt)) : '') + '</td>' +
        '<td data-k="รอบเฉลี่ย" class="num">' + (i.typicalIntervalMs ? 'ทุก ' + fmtDur(i.typicalIntervalMs) : '–') + '</td>' +
        '<td data-k="ครั้งถัดไป">' + next + '</td>' +
        '<td data-k="มักเข้า">' + when + (i.medianInStockMs != null ? small('อยู่ได้ ~' + fmtDur(i.medianInStockMs)) : '') + '</td>' +
        '<td data-k="โอกาส 7 วัน"><div class="meter"><span class="track"><span style="width:' + pct + '%"></span></span><b>' + pct + '%</b></div></td>' +
        '<td data-k="ความมั่นใจ"><span class="badge ' + conf[0] + '">' + conf[1] + '</span></td></tr>';
    }).join('');
  }

  // ---------- router ----------
  var VIEWS = {
    members:  { title:'สมาชิกบอทแจ้งสต็อก', load: function(){ return load(); } },
    restocks: { title:'สถิติของเข้า', load: loadRestocks },
    stock:    { title:'ของที่มีตอนนี้', load: loadStock },
    forecast: { title:'คาดการณ์รุ่นที่ต้องการ', load: loadForecast }
  };
  var current = 'members';
  function refreshCurrent(){
    $('refresh').disabled = true;
    return Promise.resolve().then(VIEWS[current].load)
      .catch(function(e){ toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, true); })
      .finally(function(){ $('refresh').disabled = false; });
  }
  function route(){
    var v = (location.hash || '#members').slice(1); if (!VIEWS[v]) v = 'members';
    current = v;
    Object.keys(VIEWS).forEach(function(k){ $('v-' + k).hidden = k !== v; });
    document.querySelectorAll('nav.tabs a').forEach(function(a){ if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $('title').textContent = VIEWS[v].title;
    document.title = VIEWS[v].title + ' · Stock Bot';
    refreshCurrent();
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-rsdays]'); if (!b) return;
    rs.days = Number(b.dataset.rsdays); loadRestocks().catch(function(e){ toast(e.message, true); });
  });
  $('st-only').addEventListener('change', function(e){ st.only = e.target.checked; renderStock(); });
  $('fc-model').addEventListener('change', function(e){ fc.model = e.target.value; renderForecast(); });
  $('fc-sort').addEventListener('change', function(e){ fc.sort = e.target.value; renderForecast(); });

  route();
  setInterval(function(){ if (!document.hidden && !document.querySelector('dialog[open]')) refreshCurrent(); }, 30000);
})();
</script>
</body>
</html>`;
