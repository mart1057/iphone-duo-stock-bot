import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { formatMembershipPrice, membershipSettings, parseMembershipPrice } from '../notification/membership.settings.js';
import { telegramCommandService } from '../notification/telegram.commands.js';
import { telegramRecipients, type Subscriber } from '../notification/telegram.recipients.js';
import { addDays, dateKey, dbDateKey, parseDateInput } from '../utils/datetime.js';
import { logger } from '../utils/logger.js';
import { adminPage } from './admin.page.js';
import { isMuted } from '../notification/alert.filter.js';
import { TelegramAlertPreferences } from '../notification/telegram.preferences.js';
import { ModelPauseStore } from '../stock/model.pause.js';
import { modelsOf } from '../notification/telegram.menus.js';
import { restockHistoryRepository } from '../stock/restock.history.js';
import { currentStockRepository } from '../stock/stock.current.js';
import { buildForecast, buildRestockStats, parseRestockFilters, type RestockFilters, restockStatsRepository } from '../stock/restock.stats.js';

const DAY_MS = 86_400_000;

// Fresh stores per request: their caches are per process, and this UI may run
// beside the bot, so a long-lived cache here would go stale.
const pausedModels = async (): Promise<ReadonlyMap<string, Date>> => new ModelPauseStore().list();

const stockOverview = async () => {
  const [skus, paused] = await Promise.all([restockHistoryRepository.listSkus(), pausedModels()]);
  const models = modelsOf(skus);
  const stocks = await Promise.all(models.map((model) => currentStockRepository.forModel(model)));
  return {
    models: stocks.map((stock) => ({
      model: stock.model,
      paused: paused.has(stock.model),
      pausedAt: paused.get(stock.model)?.toISOString() ?? null,
      lastCheckedAt: stock.lastCheckedAt?.toISOString() ?? null,
      skus: stock.skus,
    })),
  };
};

const restockOverview = async (days: number, filters: RestockFilters = {}) => {
  const now = new Date();
  const events = await restockStatsRepository.restocksSince(new Date(now.getTime() - days * DAY_MS));
  return { ...buildRestockStats(events, days, now, filters), retentionDays: env.RESTOCK_HISTORY_RETENTION_DAYS };
};

const forecastOverview = async () => {
  const now = new Date();
  const [skus, events, observedDays, inStock, paused, chats] = await Promise.all([
    restockHistoryRepository.listSkus(),
    restockStatsRepository.restocksSince(new Date(now.getTime() - env.RESTOCK_HISTORY_RETENTION_DAYS * DAY_MS)),
    restockStatsRepository.observedDays(now),
    restockStatsRepository.inStockVariantIds(),
    pausedModels(),
    telegramRecipients.all(),
  ]);
  const mutes = await new TelegramAlertPreferences().getMutesFor(chats);
  const watchers = new Map<string, number>();
  for (const sku of skus) {
    let count = 0;
    for (const chat of chats) if (!isMuted(mutes.get(chat)!, sku)) count++;
    watchers.set(sku.variantId, count);
  }
  return {
    observedDays,
    chatCount: chats.length,
    items: buildForecast({ skus, events, observedDays, watchers, inStock, pausedModels: new Set(paused.keys()), now }),
  };
};

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_BODY = 16 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const authorized = (req: IncomingMessage): boolean => {
  if (!env.ADMIN_PASSWORD) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const [user = '', ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return safeEqual(user, 'admin') && safeEqual(rest.join(':'), env.ADMIN_PASSWORD);
};

const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  // Requiring JSON forces a CORS preflight, so other sites cannot post here.
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'ต้องส่งเป็น application/json');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'ข้อมูลใหญ่เกินไป');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'JSON ไม่ถูกต้อง');
  }
};

const memberView = (s: Subscriber, today: string) => {
  const expiresOn = s.expiresOn ? dbDateKey(s.expiresOn) : null;
  const daysLeft = expiresOn
    ? Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    : null;
  return {
    chatId: s.chatId,
    name: s.name,
    username: s.username,
    joinedAt: s.joinedAt.toISOString(),
    approved: s.approved !== false,
    approvedAt: (s as Subscriber & { approvedAt?: Date | null }).approvedAt?.toISOString() ?? null,
    expiresOn,
    daysLeft,
  };
};

const overview = async () => {
  const today = dateKey();
  const [members, pending, price] = await Promise.all([
    telegramRecipients.subscribers(),
    telegramRecipients.pending(),
    membershipSettings.price(),
  ]);
  return {
    today,
    expiryCheckHour: env.MEMBER_EXPIRY_CHECK_HOUR,
    adminCount: env.telegramChatIds.length,
    priceSatang: price,
    priceLabel: price === null ? null : formatMembershipPrice(price),
    members: members.map((m) => memberView(m, today)),
    pending: pending.map((m) => memberView(m, today)),
  };
};

const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://admin.local');
  const method = req.method ?? 'GET';

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    });
    res.end(adminPage);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/overview') {
    json(res, 200, await overview());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/stock') {
    json(res, 200, await stockOverview());
    return;
  }

  if (method === 'GET' && url.pathname === '/api/restocks') {
    const requested = Number.parseInt(url.searchParams.get('days') ?? '30', 10);
    const days = Math.min(env.RESTOCK_HISTORY_RETENTION_DAYS, Number.isFinite(requested) && requested > 0 ? requested : 30);
    let filters: RestockFilters;
    try { filters = parseRestockFilters(url.searchParams); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'ตัวกรองไม่ถูกต้อง'); }
    if (filters.from && filters.to) {
      const today = dateKey();
      const earliest = dateKey(new Date(Date.now() - env.RESTOCK_HISTORY_RETENTION_DAYS * DAY_MS));
      if (filters.from > today || filters.to < earliest) throw new HttpError(400, `เลือกช่วงวันที่ที่ทับซ้อนกับข้อมูล ${earliest} ถึง ${today}`);
    }
    json(res, 200, await restockOverview(filters.from ? env.RESTOCK_HISTORY_RETENTION_DAYS : days, filters));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/forecast') {
    json(res, 200, await forecastOverview());
    return;
  }

  if (method === 'PUT' && url.pathname === '/api/price') {
    const body = await readJson(req);
    const satang = parseMembershipPrice(String(body.price ?? ''));
    if (satang === null) throw new HttpError(400, 'ราคาไม่ถูกต้อง ใช้ตัวเลข เช่น 199 หรือ 199.50');
    await membershipSettings.setPrice(satang);
    logger.info(`Membership price set from admin UI: ${satang} satang`);
    json(res, 200, { ok: true, message: `💰 ตั้งราคาเป็น ${formatMembershipPrice(satang)} แล้ว` });
    return;
  }

  const match = /^\/api\/members\/([^/]+)(?:\/(approve|reject|expiry))?$/.exec(url.pathname);
  if (match) {
    const chatId = decodeURIComponent(match[1]!);
    if (!/^-?\d{1,20}$/.test(chatId)) throw new HttpError(400, 'chat id ไม่ถูกต้อง');
    if (telegramRecipients.isAdmin(chatId)) throw new HttpError(400, 'จัดการแชทแอดมินจากหน้านี้ไม่ได้');
    const action = match[2];

    if (method === 'POST' && action === 'approve') {
      await readJson(req);
      const result = await telegramCommandService.approveMember(chatId);
      json(res, result.ok ? 200 : 409, { ok: result.ok, message: result.text });
      return;
    }
    if (method === 'POST' && action === 'reject') {
      await readJson(req);
      const message = await telegramCommandService.rejectMember(chatId);
      json(res, 200, { ok: true, message });
      return;
    }
    if (method === 'PUT' && action === 'expiry') {
      const body = await readJson(req);
      let key: string | null;
      const today = dateKey();
      if (body.never === true) key = null;
      else if (typeof body.days === 'number' && Number.isInteger(body.days) && body.days > 0 && body.days <= 3650) {
        // Extend from the current expiry when it is still in the future, else from today.
        const person = await telegramRecipients.find(chatId);
        const current = person?.expiresOn ? dbDateKey(person.expiresOn) : null;
        key = addDays(body.extend === true && current && current >= today ? current : today, body.days);
      } else {
        key = parseDateInput(String(body.date ?? ''), today);
        if (!key) throw new HttpError(400, 'วันที่ไม่ถูกต้อง');
      }
      if (key && key < today) throw new HttpError(400, 'วันที่ผ่านมาแล้ว');
      const message = await telegramCommandService.setMemberExpiry(chatId, key);
      json(res, 200, { ok: true, message });
      return;
    }
    if (method === 'DELETE' && !action) {
      const removed = await telegramCommandService.removeMember(chatId);
      json(res, removed ? 200 : 404, { ok: removed, message: removed ? '🚪 นำออกแล้ว' : 'คนนี้ถูกนำออกไปแล้ว' });
      return;
    }
  }

  throw new HttpError(404, 'ไม่พบหน้า');
};

export const startAdminServer = (): Server | null => {
  if (env.ADMIN_PORT === 0) return null;
  if (!env.ADMIN_PASSWORD && !LOOPBACK.has(env.ADMIN_HOST)) {
    logger.warn(`Admin UI not started: set ADMIN_PASSWORD to listen on ${env.ADMIN_HOST}`);
    return null;
  }

  const server = createServer((req, res) => {
    if (!authorized(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Stock Bot Admin", charset="UTF-8"' });
      res.end('Unauthorized');
      return;
    }
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        json(res, error.status, { ok: false, message: error.message });
        return;
      }
      logger.error('Admin UI request failed', error);
      json(res, 500, { ok: false, message: 'ระบบมีปัญหา ลองใหม่อีกครั้ง' });
    });
  });

  server.on('error', (error) => logger.warn(`Admin UI could not listen on ${env.ADMIN_HOST}:${env.ADMIN_PORT}`, error));
  server.listen(env.ADMIN_PORT, env.ADMIN_HOST, () => {
    logger.info(`Admin UI on http://${env.ADMIN_HOST === '0.0.0.0' ? 'localhost' : env.ADMIN_HOST}:${env.ADMIN_PORT}`);
  });
  return server;
};
