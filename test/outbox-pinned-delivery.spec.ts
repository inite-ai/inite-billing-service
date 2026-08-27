import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { createPinnedLookup, postToPinnedAddress } from '../src/workers/pinned-post';

/**
 * The SSRF guard resolved the host and approved its addresses, and then the
 * HTTP client resolved the same name again. A record with a one-second TTL can
 * answer the check with a public address and the connection with the cloud
 * metadata IP, which is the whole of the attack. These pin the second lookup
 * to the address that was approved.
 */
describe('createPinnedLookup', () => {
  it('answers with the vetted address whatever hostname is asked for', (done) => {
    const lookup = createPinnedLookup('93.184.216.34') as any;
    lookup('rebinding.example.com', {}, (err: unknown, address: string, family: number) => {
      expect(err).toBeNull();
      expect(address).toBe('93.184.216.34');
      expect(family).toBe(4);
      done();
    });
  });

  it('answers in the array shape when Node asks for all addresses', (done) => {
    const lookup = createPinnedLookup('2606:2800:220:1:248:1893:25c8:1946') as any;
    lookup('example.com', { all: true }, (err: unknown, addresses: unknown) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]);
      done();
    });
  });

  it('refuses anything that is not an IP literal', () => {
    // A hostname here would reintroduce the resolution this exists to remove.
    expect(() => createPinnedLookup('example.com')).toThrow(/not an IP literal/);
  });
});

describe('postToPinnedAddress', () => {
  let server: Server;
  let port: number;
  let seen: { host?: string; body: string; headers: Record<string, unknown> } | null = null;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            seen = { host: req.headers.host, body, headers: req.headers };
            if (req.url === '/moved') {
              res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
              res.end();
              return;
            }
            res.writeHead(200);
            res.end('ok');
          });
        });
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          resolve();
        });
      }),
  );

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('connects to the pinned address while still addressing the host by name', async () => {
    const res = await postToPinnedAddress({
      url: `http://webhooks.example.com:${port}/events`,
      addresses: ['127.0.0.1'],
      headers: { 'Content-Type': 'application/json', 'x-event-type': 'billing.order.paid' },
      body: '{"hello":"world"}',
      timeoutMs: 2000,
    });

    expect(res).toMatchObject({ status: 200, ok: true });
    // The Host header — and with it TLS SNI on an https target — stays the
    // hostname, so pinning does not turn into an unverified connection.
    expect(seen?.host).toBe(`webhooks.example.com:${port}`);
    expect(seen?.body).toBe('{"hello":"world"}');
    expect(seen?.headers['x-event-type']).toBe('billing.order.paid');
  });

  it('does not follow a redirect into a private target', async () => {
    const res = await postToPinnedAddress({
      url: `http://webhooks.example.com:${port}/moved`,
      addresses: ['127.0.0.1'],
      headers: {},
      body: '{}',
      timeoutMs: 2000,
    });

    expect(res.status).toBe(302);
    expect(res.ok).toBe(false);
  });

  it('gives up rather than hanging when the target never answers', async () => {
    const silent = createServer(() => {
      /* accept the connection and say nothing */
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const silentPort = (silent.address() as AddressInfo).port;

    try {
      await expect(
        postToPinnedAddress({
          url: `http://webhooks.example.com:${silentPort}/events`,
          addresses: ['127.0.0.1'],
          headers: {},
          body: '{}',
          timeoutMs: 150,
        }),
      ).rejects.toThrow(/timed out/);
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});

describe('postToPinnedAddress failover', () => {
  it('tries the next vetted address when the first will not connect', async () => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    // 192.0.2.1 is TEST-NET-1 and answers nothing; a host with several A
    // records should still be delivered to, exactly as a resolver would.
    const res = await postToPinnedAddress({
      url: `http://webhooks.example.com:${port}/events`,
      addresses: ['192.0.2.1', '127.0.0.1'],
      headers: {},
      body: '{}',
      timeoutMs: 400,
    });

    expect(res.ok).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
