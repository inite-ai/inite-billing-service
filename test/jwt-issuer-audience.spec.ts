import { buildJwtOptions } from '../src/auth/strategies/jwt.strategy';

/**
 * Without an issuer/audience pin, a token the identity provider minted for a
 * DIFFERENT audience (another service on the same JWKS) would be accepted here.
 * These pins are opt-in via env and forwarded to jsonwebtoken.verify.
 */
describe('buildJwtOptions issuer/audience pinning', () => {
  const cfg = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as any;

  it('omits issuer/audience when unset (backward compatible)', () => {
    const opts = buildJwtOptions(cfg({ JWT_SECRET: 's', NODE_ENV: 'test' })) as any;
    expect(opts.issuer).toBeUndefined();
    expect(opts.audience).toBeUndefined();
  });

  it('pins issuer and audience when configured (HS256 path)', () => {
    const opts = buildJwtOptions(
      cfg({
        JWT_SECRET: 's',
        NODE_ENV: 'test',
        JWT_ISSUER: 'https://auth.inite.ai',
        JWT_AUDIENCE: 'inite-billing',
      }),
    ) as any;
    expect(opts.issuer).toBe('https://auth.inite.ai');
    expect(opts.audience).toBe('inite-billing');
    expect(opts.algorithms).toEqual(['HS256']);
  });

  it('pins issuer and audience on the production JWKS path too', () => {
    const opts = buildJwtOptions(
      cfg({
        NODE_ENV: 'production',
        AUTH_SERVICE_URL: 'https://auth.example.com',
        JWT_ISSUER: 'https://auth.example.com',
        JWT_AUDIENCE: 'billing',
      }),
    ) as any;
    expect(opts.issuer).toBe('https://auth.example.com');
    expect(opts.audience).toBe('billing');
    expect(opts.algorithms).toEqual(['RS256']);
    expect(typeof opts.secretOrKeyProvider).toBe('function');
  });
});

/**
 * The JWKS endpoint used to default to the INITE identity provider, so a
 * deployment that never set AUTH_SERVICE_URL validated its own users' tokens
 * against someone else's signing keys — and nothing in the logs said so.
 */
describe('buildJwtOptions JWKS issuer requirement', () => {
  const cfg = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as any;

  it('fails loudly in production when AUTH_SERVICE_URL is missing', () => {
    expect(() => buildJwtOptions(cfg({ NODE_ENV: 'production' }))).toThrow(/AUTH_SERVICE_URL/);
  });

  it('does not fall back to any hardcoded provider', () => {
    let opts: any;
    expect(() => {
      opts = buildJwtOptions(
        cfg({ NODE_ENV: 'production', AUTH_SERVICE_URL: 'https://auth.acme.example' }),
      );
    }).not.toThrow();
    expect(opts.algorithms).toEqual(['RS256']);
  });

  it('still allows the dev HS256 path without an auth service', () => {
    const opts = buildJwtOptions(cfg({ JWT_SECRET: 's', NODE_ENV: 'development' })) as any;
    expect(opts.algorithms).toEqual(['HS256']);
  });
});
