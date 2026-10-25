import { ProxyAgent } from 'undici';

/** Preserve targeting filters while removing sticky-session parameters. */
export const rotatingProxyUsername = (username: string): string => {
  const [login, parameters = ''] = username.split('__');
  const retained = parameters.split(';').filter((value) =>
    value && !value.startsWith('sessid.') && !value.startsWith('sessttl.'));
  return retained.length ? `${login}__${retained.join(';')}` : login!;
};

/** Credentials stay in proxy CONNECT authentication, never in Apple headers. */
export const createAppleProxy = (url: string, username: string, password: string): ProxyAgent =>
  new ProxyAgent({
    uri: url,
    token: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  });
