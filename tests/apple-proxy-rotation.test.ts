import { afterEach, expect, it, vi } from 'vitest';

const diagnostic = vi.hoisted(() => vi.fn());
vi.mock('../src/notification/proxy-log.js', () => ({ logProxyToDiscord: diagnostic }));

const prepare = async (statuses: number[]) => {
  diagnostic.mockClear();
  vi.resetModules();
  vi.stubEnv('DISCORD_PROXY_LOG_ENABLED', 'false');
  vi.stubEnv('DISCORD_WEBHOOK_URL', '');
  vi.stubEnv('APPLE_PROXY_URL', 'http://gw.dataimpulse.com:823');
  vi.stubEnv('DATAIMPULSE_USERNAME', 'test-login');
  vi.stubEnv('DATAIMPULSE_PASSWORD', 'test-password');
  const fetchMock = vi.fn();
  for (const status of statuses) fetchMock.mockResolvedValueOnce(
    new Response(status === 200 ? 'catalogue' : '', { status }));
  vi.stubGlobal('fetch', fetchMock);
  const { AppleClient } = await import('../src/apple/apple.client.js');
  return { client: new AppleClient(), fetchMock };
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('uses a fresh proxy tunnel for every request without an extra IP probe', async () => {
  const { client, fetchMock } = await prepare([200, 200, 200]);
  for (let i = 0; i < 3; i++) expect(await client.getProductPageHtml()).toBe('catalogue');
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(new Set(fetchMock.mock.calls.map((call) => call[1].dispatcher)).size).toBe(3);
  expect(fetchMock.mock.calls.every((call) => call[0].includes('apple.com'))).toBe(true);
});

it('does not retry 541 and passes it to the cooldown guard', async () => {
  const { client, fetchMock } = await prepare([541]);
  await expect(client.getProductPageHtml()).rejects.toMatchObject({ status: 541, retryable: false });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const logs = diagnostic.mock.calls.map((call) => call[0]).join('\n');
  expect(logs).toContain('HTTP 541');
  expect(logs).toContain('ไม่ลองซ้ำทันที');
});

it.each([403, 429, 503])('does not rotate or retry HTTP %s', async (status) => {
  const { client, fetchMock } = await prepare([status]);
  await expect(client.getProductPageHtml()).rejects.toMatchObject({ status });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
