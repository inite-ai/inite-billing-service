import * as http from 'node:http';

// The loopback upstream is not public, so the SSRF guard is told it is; the
// pinned POST itself is real and connects to it.
jest.mock('../src/workers/ssrf-guard', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue({ ok: true, addresses: ['127.0.0.1'] }),
}));

import { McpProxyController } from '../src/mcp/mcp-proxy.controller';
import { McpProxyService } from '../src/mcp/mcp-proxy.service';

/**
 * The gateway carries a client's MCP request to the operator's server. In
 * the 2026-07-28 protocol the method and tool name ride in headers too
 * (`Mcp-Method`, `Mcp-Name`), next to `MCP-Protocol-Version`, and a
 * conformant server refuses a request whose headers are missing or disagree
 * with the body (-32020). The gateway forwarded only Content-Type, Accept and
 * the operator's own headers, so every modern request died at the upstream.
 *
 * The upstream here applies the rule the way the @inite/mcp core does, and
 * the request goes through the controller, the service and the real pinned
 * POST, for both protocol versions.
 */
describe('MCP gateway forwards the MCP request headers', () => {
  let upstream: http.Server;
  let url = '';
  let seen: http.IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push(req.headers);
        const body = JSON.parse(raw || '{}');
        if (body.method === 'probe/html') {
          res.writeHead(200, { 'content-type': 'text/html' });
          return void res.end('{"jsonrpc":"2.0","id":9,"result":{}}');
        }
        const version = req.headers['mcp-protocol-version'];
        const reply = (payload: unknown, status = 200) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (version === '2026-07-28') {
          const method = req.headers['mcp-method'];
          if (!method)
            return reply(
              {
                jsonrpc: '2.0',
                id: body.id,
                error: { code: -32020, message: 'Mcp-Method header is missing' },
              },
              400,
            );
          if (method !== body.method)
            return reply(
              {
                jsonrpc: '2.0',
                id: body.id,
                error: { code: -32020, message: 'Mcp-Method does not match the body' },
              },
              400,
            );
          if (body.method === 'tools/call' && req.headers['mcp-name'] !== body.params?.name)
            return reply(
              {
                jsonrpc: '2.0',
                id: body.id,
                error: { code: -32020, message: 'Mcp-Name does not match the body' },
              },
              400,
            );
        }
        reply({ jsonrpc: '2.0', id: body.id, result: { ok: true, version: version ?? null } });
      });
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => upstream.close(() => r()));
  });

  beforeEach(() => {
    seen = [];
  });

  const controller = () => {
    const prisma: any = {
      mcpServer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'srv-1',
          serviceId: 'svc-a',
          slug: 'weather',
          upstreamUrl: url,
          upstreamHeaders: { 'X-Operator-Key': 'dummy-operator-key' },
          isActive: true,
          // Free, so the test is about transport and not about money.
          pricingMode: 'free',
          creditsPerCall: 0,
        }),
      },
      mcpCall: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new McpProxyService(prisma, {} as any, {} as any, {} as any);
    return new McpProxyController(service);
  };

  async function post(body: any, headers: Record<string, string>) {
    const out: { status?: number; body?: string; type?: string } = {};
    const res: any = {
      status: (s: number) => ((out.status = s), res),
      type: (t: string) => ((out.type = t), res),
      setHeader: (k: string, v: string) => (
        k.toLowerCase() === 'content-type' && (out.type = v),
        res
      ),
      set: () => res,
      json: (b: unknown) => ((out.body = JSON.stringify(b)), res),
      send: (b: string) => ((out.body = b), res),
    };
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req: any = { method: 'POST', body, headers: lower };
    await controller().handle('weather', { userId: 'user-1', roles: [] } as any, req, res);
    return { status: out.status, type: out.type, json: JSON.parse(out.body ?? '{}') };
  }

  const call = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'forecast', arguments: {} },
  };

  it('2025-11-25: initialize and tools/list pass through', async () => {
    for (const body of [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]) {
      const out = await post(body, {
        'MCP-Protocol-Version': '2025-11-25',
        Accept: 'application/json, text/event-stream',
      });
      expect(out.status).toBe(200);
      expect(out.json.result).toBeDefined();
    }
    expect(seen.every((h) => h['mcp-protocol-version'] === '2025-11-25')).toBe(true);
  });

  it('2026-07-28: tools/list, tools/call and server/discover reach the upstream with their headers', async () => {
    const list = await post(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/list' },
    );
    expect(list.json.error).toBeUndefined();
    expect(list.json.result).toEqual({ ok: true, version: '2026-07-28' });

    const tool = await post(call, {
      'MCP-Protocol-Version': '2026-07-28',
      'Mcp-Method': 'tools/call',
      'Mcp-Name': 'forecast',
    });
    expect(tool.json.error).toBeUndefined();
    expect(seen[1]['mcp-name']).toBe('forecast');

    const discover = await post(
      { jsonrpc: '2.0', id: 4, method: 'server/discover' },
      { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' },
    );
    expect(discover.json.error).toBeUndefined();
  });

  it('carries only mcp-* headers from the client: never its credentials or cookies', async () => {
    await post(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list',
        Authorization: 'Bearer dummy-client-token',
        Cookie: 'session=dummy',
        'X-Api-Key': 'dummy-client-key',
      },
    );
    const h = seen[0];
    expect(h['authorization']).toBeUndefined();
    expect(h['cookie']).toBeUndefined();
    expect(h['x-api-key']).toBeUndefined();
    expect(h['x-operator-key']).toBe('dummy-operator-key');
    expect(h['content-type']).toBe('application/json');
  });

  it('never serves what the upstream calls HTML as HTML', async () => {
    const out = await post({ jsonrpc: '2.0', id: 9, method: 'probe/html' }, {});
    expect(out.type).toBe('application/json; charset=utf-8');
    const sse = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {});
    expect(sse.type).toBe('application/json; charset=utf-8');
  });
});
