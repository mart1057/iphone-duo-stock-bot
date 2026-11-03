const TZ = process.env.TZ ?? 'Asia/Bangkok';

/// 17/09/2026 23:30:15
export const formatThaiDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(',', '');

/// 23:30:15
export const formatClock = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

/// 26/10 10:15 - compact form for list rows.
export const formatShortDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(',', '');

/// Hour of day (0-23) in the bot's timezone.
export const hourOfDay = (date: Date): number =>
  Number.parseInt(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(date),
    10,
  ) % 24;

/// "26/10 20:25 น." - the friendly form shown to people in chat.
export const formatFriendly = (date: Date): string => `${formatShortDateTime(date)} น.`;

// -- Calendar dates ("YYYY-MM-DD", in the bot's timezone) --------------------

/// Today's calendar date in the bot's timezone, e.g. "2026-10-27".
export const dateKey = (date: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/// A Postgres DATE comes back as midnight UTC - read it as a plain date.
export const dbDateKey = (date: Date): string => date.toISOString().slice(0, 10);

/// The key as a DATE value for Prisma (midnight UTC).
export const keyToDbDate = (key: string): Date => new Date(`${key}T00:00:00Z`);

export const addDays = (key: string, days: number): string => {
  const date = keyToDbDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dbDateKey(date);
};

/// "2026-12-31" -> "31/12/2026"
export const formatDateKey = (key: string): string => {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
};

/**
 * What an admin types for an expiry date:
 *   "31/12/2026", "31-12-2026", "31.12.2569" (Buddhist year), "2026-12-31",
 *   "30" / "30 วัน" (that many days from today).
 * Returns null when it is not a real date.
 */
export const parseDateInput = (input: string, today: string = dateKey()): string | null => {
  const text = input.trim();
  const days = /^\+?(\d{1,4})\s*(?:วัน|d|days?)?$/i.exec(text);
  if (days) return addDays(today, Number.parseInt(days[1]!, 10));

  let day: number;
  let month: number;
  let year: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const thai = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (thai) [day, month, year] = [Number(thai[1]), Number(thai[2]), Number(thai[3])];
  else return null;
  if (year > 2400) year -= 543;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return dbDateKey(date);
};
