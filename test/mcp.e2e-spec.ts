import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../src/auth/guards/jwt-or-service.guard';
import { MockJwtAuthGuard, MockJwtOrServiceGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

/**
 * The MCP endpoint, spoken to the way a client actually speaks to it.
 *
 * Unit tests cover what the tools do; this covers that the thing on the wire is
 * MCP — a handshake that negotiates a protocol version, a tool list a client
 * can render, and a call that comes back as tool content. Those are the parts
 * that break silently when a transport option or an SDK version changes, and
 * no amount of testing the handlers would notice.
 */
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  // Streamable HTTP requires the client to accept both.
  Accept: 'application/json, text/event-stream',
};

describe('MCP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const rpc = (method: string, params?: Record<string, unknown>, id: number | string = 1) => ({
    jsonrpc: '2.0',
    id,
    method,
    ...(params ? { params } : {}),
  });

  /**
   * The transport answers either JSON or a single SSE event depending on what
   * it decides; both carry the same JSON-RPC message.
   */
  const parseBody = (res: request.Response): any => {
    const text = res.text ?? '';
    if (res.headers['content-type']?.includes('text/event-stream')) {
      const line = text.split('\n').find((l) => l.startsWith('data:'));
      return line ? JSON.parse(line.slice(5).trim()) : null;
    }
    return res.body && Object.keys(res.body).length ? res.body : JSON.parse(text || '{}');
  };

  const post = (payload: unknown) =>
    request(app.getHttpServer())
      .post('/mcp')
      .set(MCP_HEADERS)
      .send(payload as any);

  const initialize = () =>
    post(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1.0.0' },
      }),
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(JwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('completes the handshake and names itself', async () => {
    const res = await initialize();
    const body = parseBody(res);

    expect(res.status).toBe(200);
    expect(body.result.protocolVersion).toBeTruthy();
    expect(body.result.serverInfo.name).toBe('inite-billing');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it('lists tools with schemas a client can render', async () => {
    await initialize();
    const res = await post(rpc('tools/list', {}, 2));
    const body = parseBody(res);

    const names = body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      [
        'check_entitlement',
        'consume_credits',
        'create_checkout_session',
        'get_credit_balance',
        'list_catalog',
        'list_entitlements',
        'list_subscriptions',
      ].sort(),
    );

    const check = body.result.tools.find((t: any) => t.name === 'check_entitlement');
    expect(check.description).toBeTruthy();
    expect(check.inputSchema.type).toBe('object');
    expect(check.inputSchema.properties.key).toBeDefined();
    expect(check.inputSchema.required).toContain('key');
    expect(check.annotations.readOnlyHint).toBe(true);
  });

  it('marks the charging tool as not read-only', async () => {
    await initialize();
    const body = parseBody(await post(rpc('tools/list', {}, 3)));

    const consume = body.result.tools.find((t: any) => t.name === 'consume_credits');
    expect(consume.annotations.readOnlyHint).toBe(false);
  });

  it('answers a call with tool content', async () => {
    await initialize();
    const res = await post(
      rpc('tools/call', { name: 'check_entitlement', arguments: { key: 'access.pro' } }, 4),
    );
    const body = parseBody(res);

    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].type).toBe('text');
    const answer = JSON.parse(body.result.content[0].text);
    expect(answer).toMatchObject({
      granted: false,
      key: 'access.pro',
      user_id: MockJwtAuthGuard.testUserId,
    });
  });

  it('rejects a call whose arguments do not fit the schema', async () => {
    await initialize();
    const body = parseBody(
      await post(rpc('tools/call', { name: 'check_entitlement', arguments: {} }, 5)),
    );

    // The SDK validates against the declared schema before the handler runs.
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  it('reports an unknown tool without failing the connection', async () => {
    await initialize();
    const body = parseBody(
      await post(rpc('tools/call', { name: 'drop_database', arguments: {} }, 6)),
    );

    expect(body.error || body.result?.isError).toBeTruthy();
  });

  it('refuses anything but POST, since it keeps no session', async () => {
    const res = await request(app.getHttpServer()).get('/mcp').set(MCP_HEADERS);

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
