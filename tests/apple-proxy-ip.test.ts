import { expect, it } from 'vitest';
import { rotatingProxyUsername } from '../src/apple/apple.proxy.js';

it('removes sticky settings while preserving country filters', () => {
  expect(rotatingProxyUsername('login')).toBe('login');
  expect(rotatingProxyUsername('login__sessid.abc;cr.th;sessttl.60')).toBe('login__cr.th');
  expect(rotatingProxyUsername('login__sessid.abc')).toBe('login');
});
