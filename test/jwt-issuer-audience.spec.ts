import { buildJwtOptions } from '../src/auth/strategies/jwt.strategy';

/**
 * Without an issuer pin, any token the configured JWKS can verify is accepted,
 * whoever issued it. The pin is forwarded to jsonwebtoken.verify and is
 * mandatory in production — where, until this, nothing was pinned at all.
 *
 * Audience deliberately stays optional: the identity provider does not put an
 * `aud` claim on user access tokens (it carries `client_id`), and jsonwebtoken
 * rejects a token with no `aud` once an audience is configured. Requiring it
 * would have locked out every real user while tightening nothing.
 */
describe('buildJwtOptions issuer/audience pinning', () => {
  const cfg = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as any;

  it('omits issuer/audience when unset outside production', () => {
    const opts = buildJwtOptions(cfg({ JWT_SECRET: 's', NODE_ENV: 'test' })) as any;
    expect(opts.issuer).toBeUndefined();
    expect(opts.audience).toBeUndefined();
  });

  it('refuses to start in production without an issuer', () => {
    expect(() =>
      buildJwtOptions(
        cfg({ NODE_ENV: 'production', AUTH_SERVICE_URL: 'https://auth.example.com' }),
      ),
    ).toThrow(/JWT_ISSUER/);
  });

  it('does not require an audience in production', () => {
    // Enforcing `aud` against a provider that omits it rejects every token.
    const opts = buildJwtOptions(
      cfg({
        NODE_ENV: 'production',
        AUTH_SERVICE_URL: 'https://auth.example.com',
        JWT_ISSUER: 'https://auth-api.example.com',
      }),
    ) as any;
    expect(opts.issuer).toBe('https://auth-api.example.com');
    expect(opts.audience).toBeUndefined();
  });

  it('accepts an issuer that is not the JWKS host', () => {
    // The provider signs `iss: auth-api.*` while publishing keys at `auth.*`;
    // assuming they match would have pinned the wrong value.
    const opts = buildJwtOptions(
      cfg({
        NODE_ENV: 'production',
        AUTH_SERVICE_URL: 'https://auth.example.com',
        JWT_ISSUER: 'https://auth-api.example.com',
      }),
    ) as any;
    expect(opts.issuer).not.toBe('https://auth.example.com');
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
    expect(() =>
      buildJwtOptions(cfg({ NODE_ENV: 'production', JWT_ISSUER: 'https://auth-api.example.com' })),
    ).toThrow(/AUTH_SERVICE_URL/);
  });

  it('does not fall back to any hardcoded provider', () => {
    let opts: any;
    expect(() => {
      opts = buildJwtOptions(
        cfg({
          NODE_ENV: 'production',
          AUTH_SERVICE_URL: 'https://auth.acme.example',
          JWT_ISSUER: 'https://auth-api.acme.example',
        }),
      );
    }).not.toThrow();
    expect(opts.algorithms).toEqual(['RS256']);
  });

  it('still allows the dev HS256 path without an auth service', () => {
    const opts = buildJwtOptions(cfg({ JWT_SECRET: 's', NODE_ENV: 'development' })) as any;
    expect(opts.algorithms).toEqual(['HS256']);
  });
});
