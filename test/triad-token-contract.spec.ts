import * as http from 'node:http';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { sign, type SignOptions } from 'jsonwebtoken';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { McpResourceGuard } from '../src/mcp/mcp-resource';

/**
 * INITE Triad token contract — conformance of billing's verifier against
 * tokens shaped EXACTLY as INITE Auth mints them.
 *
 * Claim shapes are copied from inite-auth-service:
 *   - user flows (authorization_code / refresh / device_code):
 *     src/oauth/oauth-token-issuer.service.ts → buildAccessToken
 *   - an agent on its own (client_credentials, self-registered with its key):
 *     src/oauth/oauth-m2m.service.ts → issueClientCredentialsToken
 * and signed the way Auth signs them: jsonwebtoken (via @nestjs/jwt), RS256,
 * `kid` in the header, keys served at /.well-known/jwks.json. The JWT
 * strategy runs for real against a stub JWKS. The contract:
 * inite-ecosystem/docs/triad-compatibility.md.
 */

const ISSUER = 'https://auth-api.triad.test';
const BILLING = 'https://billing.triad.test';
const KID = 'auth-rs256-key-1';
const USER_DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const AGENT_DID = 'did:web:auth-api.triad.test:agents:dcr_0123456789abcdef0123456789abcdef';

/** buildAccessToken in the auth-service, RBAC token claims on. */
function userAccessClaims(scope: string): Record<string, unknown> {
  return {
    sub: USER_DID,
    client_id: 'inite-billing',
    userId: '5f0c7a8e-3b7e-4d0a-9c55-2d3f1f6b9e10',
    email: 'ana@example.com',
    email_verified: true,
    name: 'Ana',
    picture: null,
    roles: ['user'],
    org: 'co_acme',
    org_id: '9a1b2c3d-0000-4000-8000-000000000001',
    scope,
  };
}

type Outcome = { user?: Record<string, any>; failed?: unknown; error?: unknown };

describe('Triad token contract — billing verifier', () => {
  let server: http.Server;
  let authUrl: string;
  let privateKey: KeyObject;

  function mint(
    claims: Record<string, unknown>,
    opts: { aud: string; iss?: string; expiresIn?: SignOptions['expiresIn'] },
  ): string {
    return sign(claims, privateKey, {
      algorithm: 'RS256',
      keyid: KID,
      issuer: opts.iss ?? ISSUER,
      audience: opts.aud,
      expiresIn: opts.expiresIn ?? '10m',
    });
  }

  function strategy(env: Record<string, string> = {}): JwtStrategy {
    const map: Record<string, string> = {
      NODE_ENV: 'production',
      AUTH_SERVICE_URL: authUrl,
      JWT_ISSUER: ISSUER,
      FRONTEND_URL: BILLING,
      ...env,
    };
    return new JwtStrategy({ get: (k: string) => map[k] } as any);
  }

  /** Run passport's authenticate() for real and report what it decided. */
  function authenticate(s: JwtStrategy, token: string): Promise<Outcome> {
    return new Promise((resolve) => {
      const p = s as any;
      p.success = (user: Record<string, any>) => resolve({ user });
      p.fail = (failed: unknown) => resolve({ failed: failed ?? true });
      p.error = (error: unknown) => resolve({ error });
      p.authenticate({ headers: { authorization: `Bearer ${token}` }, cookies: {} }, {});
    });
  }

  const mcpGuard = (user: unknown, env: Record<string, string> = {}) =>
    new McpResourceGuard({
      get: (k: string) => ({ FRONTEND_URL: BILLING, ...env })[k],
    } as any).canActivate({ switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any);

  beforeAll(async () => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    const jwk = { ...pair.publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: KID };
    server = http.createServer((req, res) => {
      if (req.url === '/.well-known/jwks.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    authUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  describe('accepted, with the right user and scope', () => {
    it('a first-party token (aud = the billing frontend client id)', async () => {
      const out = await authenticate(
        strategy(),
        mint(userAccessClaims('openid profile email'), { aud: 'inite-billing' }),
      );
      expect(out.user).toMatchObject({
        userId: USER_DID,
        email: 'ana@example.com',
        emailVerified: true,
        audience: ['inite-billing'],
        scopes: ['openid', 'profile', 'email'],
      });
    });

    it('an MCP connector token (aud = <billing>/mcp, billing:account) passes the strategy and the MCP guard', async () => {
      const out = await authenticate(
        strategy(),
        mint(userAccessClaims('billing:account'), { aud: `${BILLING}/mcp` }),
      );
      expect(out.user).toMatchObject({ userId: USER_DID, scopes: ['billing:account'] });
      expect(mcpGuard(out.user)).toBe(true);
    });

    it('with JWT_AUDIENCE pinned, the MCP and wallet resources are still accepted', async () => {
      const s = strategy({ JWT_AUDIENCE: 'inite-billing' });
      for (const aud of [
        'inite-billing',
        `${BILLING}/mcp`,
        `${BILLING}/mcp/wallet`,
        `${BILLING}/v1/agent-wallet`,
      ]) {
        const out = await authenticate(s, mint(userAccessClaims('billing:account'), { aud }));
        expect(out.user?.userId).toBe(USER_DID);
      }
    });

    it('an agent on its own (client_credentials, did:web sub, aud = agent wallet API)', async () => {
      const token = mint(
        {
          sub: AGENT_DID,
          client_id: 'dcr_0123456789abcdef0123456789abcdef',
          scopes: [],
          scope: '',
        },
        { aud: `${BILLING}/v1/agent-wallet`, expiresIn: '5m' },
      );
      const out = await authenticate(strategy({ JWT_AUDIENCE: 'inite-billing' }), token);
      expect(out.user).toMatchObject({
        userId: AGENT_DID,
        audience: [`${BILLING}/v1/agent-wallet`],
      });
      expect(out.user?.actor).toBeUndefined();
    });

    it('an issuer configured with a trailing slash matches the signed iss', async () => {
      const out = await authenticate(
        strategy({ JWT_ISSUER: `${ISSUER}/` }),
        mint(userAccessClaims('openid'), { aud: 'inite-billing' }),
      );
      expect(out.user?.userId).toBe(USER_DID);
    });

    it('an issuer migration: old and new issuer both accepted from a list', async () => {
      const s = strategy({ JWT_ISSUER: `${ISSUER},https://auth.old.test` });
      const fresh = await authenticate(
        s,
        mint(userAccessClaims('openid'), { aud: 'inite-billing' }),
      );
      const old = await authenticate(
        s,
        mint(userAccessClaims('openid'), { aud: 'inite-billing', iss: 'https://auth.old.test' }),
      );
      expect(fresh.user).toBeDefined();
      expect(old.user).toBeDefined();
    });
  });

  describe('rejected', () => {
    it('a wrong issuer', async () => {
      const out = await authenticate(
        strategy(),
        mint(userAccessClaims('openid'), { aud: 'inite-billing', iss: 'https://evil.test' }),
      );
      expect(out.user).toBeUndefined();
    });

    it('the JWKS host instead of the real issuer', async () => {
      const out = await authenticate(
        strategy({ JWT_ISSUER: 'https://auth.triad.test' }),
        mint(userAccessClaims('openid'), { aud: 'inite-billing' }),
      );
      expect(out.user).toBeUndefined();
    });

    it("with JWT_AUDIENCE pinned, a token for another service (brain's MCP)", async () => {
      const out = await authenticate(
        strategy({ JWT_AUDIENCE: 'inite-billing' }),
        mint(userAccessClaims('brain:read billing:account'), {
          aud: 'https://brain.triad.test/mcp',
        }),
      );
      expect(out.user).toBeUndefined();
    });

    it("unpinned, the MCP guard still refuses a token for another service's resource", async () => {
      const out = await authenticate(
        strategy(),
        mint(userAccessClaims('billing:account'), { aud: 'https://brain.triad.test/mcp' }),
      );
      expect(out.user).toBeDefined();
      expect(() => mcpGuard(out.user)).toThrow(/not issued for INITE billing/);
    });

    it('an expired token', async () => {
      const out = await authenticate(
        strategy(),
        mint(userAccessClaims('openid'), { aud: 'inite-billing', expiresIn: -10 }),
      );
      expect(out.user).toBeUndefined();
    });
  });
});
