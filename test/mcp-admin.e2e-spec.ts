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
 * The admin's view of the MCP gateway, against a real database: the grouped
 * queries that fold calls onto servers are exactly the part a mocked Prisma
 * would happily pass while the SQL is wrong.
 */
describe('MCP gateway admin E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let serverId: string;
  let serviceId: string;

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

    const service = await prisma.service.create({
      data: {
        code: `mcp-admin-${Date.now()}`,
        name: 'MCP operator',
        apiKey: `sk_mcp_${Date.now()}`,
      },
    });
    serviceId = service.id;

    const server = await prisma.mcpServer.create({
      data: {
        serviceId,
        slug: `admin-e2e-${Date.now()}`,
        name: 'Weather',
        upstreamUrl: 'https://tools.example.com/mcp',
        upstreamHeaders: { Authorization: 'Bearer operator-secret' },
        pricingMode: 'per_call',
        creditsPerCall: 2,
      },
    });
    serverId = server.id;

    await prisma.mcpCall.createMany({
      data: [
        {
          mcpServerId: serverId,
          userId: 'u1',
          method: 'tools/call',
          toolName: 'forecast',
          outcome: 'ok',
          creditsCharged: 2,
        },
        {
          mcpServerId: serverId,
          userId: 'u1',
          method: 'tools/call',
          toolName: 'forecast',
          outcome: 'ok',
          creditsCharged: 2,
        },
        {
          mcpServerId: serverId,
          userId: 'u2',
          method: 'tools/call',
          toolName: 'forecast',
          outcome: 'denied',
        },
        { mcpServerId: serverId, userId: 'u2', method: 'tools/list', outcome: 'free' },
      ],
    });
  });

  afterEach(() => {
    MockJwtAuthGuard.testUserRoles = ['user'];
  });

  afterAll(async () => {
    await prisma.mcpServer.deleteMany({ where: { serviceId } });
    await prisma.service.delete({ where: { id: serviceId } });
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('is closed to anyone who is not an admin', async () => {
    MockJwtAuthGuard.testUserRoles = ['user'];
    const res = await request(app.getHttpServer()).get('/v1/admin/mcp/servers');
    expect(res.status).toBe(403);
  });

  it('shows every server with its calls and credits, and none of its secrets', async () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
    const res = await request(app.getHttpServer()).get('/v1/admin/mcp/servers?days=30');

    expect(res.status).toBe(200);
    const server = res.body.servers.find((s: any) => s.id === serverId);
    expect(server).toMatchObject({
      calls: { ok: 2, denied: 1, free: 1 },
      creditsCharged: 4,
      upstreamHeaderKeys: ['Authorization'],
      service: { id: serviceId },
    });
    expect(JSON.stringify(res.body)).not.toContain('operator-secret');
  });

  it('shows the latest calls for one server', async () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
    const res = await request(app.getHttpServer()).get(`/v1/admin/mcp/servers/${serverId}/usage`);

    expect(res.status).toBe(200);
    expect(res.body.recent).toHaveLength(4);
    expect(res.body.creditsCharged).toBe(4);
  });

  it('switches a server off in its operator’s name', async () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
    const res = await request(app.getHttpServer())
      .patch(`/v1/admin/mcp/servers/${serverId}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    const stored = await prisma.mcpServer.findUnique({ where: { id: serverId } });
    expect(stored?.upstreamHeaders).toEqual({ Authorization: 'Bearer operator-secret' });
  });

  it('refuses to register a server for a service that does not exist', async () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
    const res = await request(app.getHttpServer()).post('/v1/admin/mcp/servers').send({
      serviceId: '00000000-0000-4000-8000-000000000000',
      slug: 'ghost-server',
      name: 'Ghost',
      upstreamUrl: 'https://tools.example.com/mcp',
      creditsPerCall: 1,
    });

    expect(res.status).toBe(404);
  });

  it('is a 404 for a server that does not exist', async () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
    const res = await request(app.getHttpServer())
      .patch('/v1/admin/mcp/servers/00000000-0000-4000-8000-000000000000')
      .send({ isActive: false });

    expect(res.status).toBe(404);
  });
});
