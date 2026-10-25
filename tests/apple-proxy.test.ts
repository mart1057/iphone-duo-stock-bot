import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { expect, it } from 'vitest';
import { createAppleProxy } from '../src/apple/apple.proxy.js';

it('tunnels Apple requests through the proxy without exposing proxy auth to the target', async () => {
  const server = createServer();
  const sockets = new Set<Socket>();
  let authorization: string | undefined;
  let destination: string | undefined;
  let targetRequest = '';
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('connect', (request, socket) => {
    authorization = request.headers['proxy-authorization'];
    destination = request.url;
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // Serve the target response inside the tunnel, without any external network.
    socket.once('data', (data) => {
      targetRequest = data.toString();
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const agent = createAppleProxy(`http://127.0.0.1:${address.port}`, 'login', 'p@ss:word');
  try {
    const response = await fetch('http://apple.invalid/pickup', {
      ...{ dispatcher: agent }, signal: AbortSignal.timeout(3000),
    });
    expect(await response.json()).toEqual({});
    expect(destination).toBe('apple.invalid:80');
    expect(authorization).toBe(`Basic ${Buffer.from('login:p@ss:word').toString('base64')}`);
    expect(targetRequest).toContain('GET /pickup');
    expect(targetRequest.toLowerCase()).not.toContain('proxy-authorization');
    expect(targetRequest).not.toContain('p@ss:word');
  } finally {
    await agent.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
