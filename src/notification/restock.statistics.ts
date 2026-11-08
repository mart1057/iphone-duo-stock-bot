import type { Menu } from './telegram.menus.js';

export interface RestockHour { day: string; hour: number; minute?: number; count: number }
export const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const home = { text: '⬅️ สถิติเติมของ', callback_data: 'rs' };
export const statisticsHome = (days: number): Menu => ({
  text: `📊 สถิติการเติมของ · แอดมิน\n\nเลือกดูรายวัน รายสัปดาห์ หรือรวมตามวันในสัปดาห์\n📅 ประวัติที่เก็บไว้สูงสุด ${days} วัน\n⏰ เวลาไทย · เวลาที่บอตตรวจพบ`,
  keyboard: [
    [{ text: '📅 รายวัน', callback_data: 'rsd:0' }, { text: '🗓 รายสัปดาห์', callback_data: 'rsw:0' }],
    [{ text: '🎯 เลือกวันในสัปดาห์', callback_data: 'rsdays' }],
    [{ text: '✏️ กำหนดช่วงวันที่', callback_data: 'rsrange' }],
    [{ text: '🏠 เมนูหลัก', callback_data: 'm' }],
  ],
});
export const weekdayPicker = (): Menu => ({
  text: '🎯 สถิติแยกตามวัน\n\nเช่น วันพุธ = รวมทุกวันพุธในประวัติที่เก็บไว้\nแสดงช่วงชั่วโมงที่พบการเติมของ',
  keyboard: [...WEEKDAYS.map((day, index) => [{ text: `ทุกวัน${day}`, callback_data: `rst:${index}` }]), [home]],
});
const dateLabel = (key: string): string => key.split('-').reverse().join('/');
const shiftDay = (key: string, days: number): string => new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86400_000).toISOString().slice(0, 10);
export const bangkokDay = (date: Date): string => new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const rangeDates = (text: string): { from: string; to: string } | null => {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, from = '', to = ''] = match;
  for (const key of [from, to]) {
    const date = new Date(`${key}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) return null;
  }
  return from <= to ? { from, to } : null;
};
export const statisticsReport = (
  rows: readonly RestockHour[], mode: 'day' | 'week' | 'weekday' | 'range',
  from: string, to: string, page = 0, weekday?: number,
): Menu => {
  const filtered = mode === 'weekday' ? rows.filter((row) => new Date(`${row.day}T00:00:00Z`).getUTCDay() === weekday) : rows;
  const buckets = new Map<string, number>();
  const hours = new Map<number, number>();
  for (const row of filtered) {
    const dayOfWeek = new Date(`${row.day}T00:00:00Z`).getUTCDay();
    const key = mode === 'week' ? shiftDay(row.day, -((dayOfWeek + 6) % 7)) : row.day;
    buckets.set(key, (buckets.get(key) ?? 0) + row.count);
    hours.set(row.hour, (hours.get(row.hour) ?? 0) + row.count);
  }
  // Paginate time records rather than entire days: busy days still fit in Telegram.
  const timeCounts = new Map<string, { day: string; hour: number; minute: number; count: number }>();
  for (const row of filtered) {
    const minute = row.minute ?? 0;
    const key = `${row.day}:${row.hour}:${minute}`;
    const current = timeCounts.get(key);
    timeCounts.set(key, { day: row.day, hour: row.hour, minute, count: (current?.count ?? 0) + row.count });
  }
  const times = [...timeCounts.values()].sort((a, b) => b.day.localeCompare(a.day) || a.hour - b.hour || a.minute - b.minute);
  const pages = Math.max(1, Math.ceil(times.length / 7));
  const current = Math.max(0, Math.min(Number.isSafeInteger(page) ? page : 0, pages - 1));
  const total = filtered.reduce((sum, row) => sum + row.count, 0);
  const title = mode === 'weekday' ? `ทุกวัน${WEEKDAYS[weekday ?? 0]}` : mode === 'week' ? 'รายสัปดาห์ (จันทร์–อาทิตย์)' : mode === 'range' ? 'ช่วงวันที่กำหนด' : 'รายวัน';
  const lines = [`📊 สถิติเติมของ · ${title}`, `📅 ${dateLabel(from)} – ${dateLabel(to)}`, '', `รวม ${total.toLocaleString('th-TH')} ครั้ง · พบใน ${new Set(filtered.map((r) => r.day)).size} วัน`, ''];
  if (!total) lines.push('ยังไม่พบการเติมของในเงื่อนไขนี้');
  else {
    lines.push('📋 วันและเวลาที่พบการเติมของ');
    let previousKey = '';
    for (const row of times.slice(current * 7, current * 7 + 7)) {
      const weekday = new Date(`${row.day}T00:00:00Z`).getUTCDay();
      const key = mode === 'week' ? shiftDay(row.day, -((weekday + 6) % 7)) : row.day;
      if (key !== previousKey) {
        lines.push(`• ${dateLabel(key)}${mode === 'week' ? `–${dateLabel(shiftDay(key, 6))}` : ''}: ${buckets.get(key)} ครั้ง`);
        previousKey = key;
      }
      const clock = `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`;
      lines.push(`  ${mode === 'week' ? `${dateLabel(row.day)} ` : ''}วัน${WEEKDAYS[weekday]} ${clock} น. · ${row.count} ครั้ง`);
    }
    lines.push('', '⏰ ช่วงเวลาที่พบมากที่สุด (รวมทั้งช่วง)');
    for (const [hour, count] of [...hours].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5)) {
      lines.push(`• ${String(hour).padStart(2, '0')}:00–${String(hour).padStart(2, '0')}:59 · ${count} ครั้ง (${Math.round(count / total * 100)}%)`);
    }
  }
  lines.push('', 'ℹ️ 1 ครั้ง = 1 สี/ความจุใน 1 สาขาที่บอตพบว่ากลับมามีของ', 'เวลาไทย · ข้อมูลเท่าที่เก็บไว้ ไม่ใช่เวลาที่ร้านเติมจริง');
  if (mode === 'week') lines.push('สัปดาห์แรก/ล่าสุดอาจมีข้อมูลไม่ครบ');
  const prefix = mode === 'week' ? 'rsw' : mode === 'weekday' ? `rst:${weekday}` : mode === 'range' ? 'rsr' : 'rsd';
  return { text: lines.join('\n'), keyboard: [
    ...(pages > 1 ? [[
      ...(current > 0 ? [{ text: '⬅️ ก่อนหน้า', callback_data: `${prefix}:${current - 1}` }] : []),
      { text: `${current + 1}/${pages}`, callback_data: 'x' },
      ...(current + 1 < pages ? [{ text: 'ถัดไป ➡️', callback_data: `${prefix}:${current + 1}` }] : []),
    ]] : []), [home],
  ] };
};
