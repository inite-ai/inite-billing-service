import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  billingMcpMetadataUrl,
  McpChallengeFilter,
  McpMetadataController,
  McpResourceGuard,
} from '../src/mcp/mcp-resource';

/**
 * Billing's MCP endpoint as an OAuth protected resource: what makes a client
 * (Claude's connector) able to sign a person in, and what keeps a token for
 * some other resource out.
 */
const config = { get: (k: string) => ({ JWT_ISSUER: 'https://auth-api.inite.ai' })[k] } as any;
const RESOURCE = 'https://billing.inite.ai/mcp';

const ctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

describe('McpResourceGuard', () => {
  const guard = new McpResourceGuard(config);

  it('lets in a token issued for this endpoint with billing:account', () => {
    expect(
      guard.canActivate(
        ctx({ userId: 'did:key:a', audience: [RESOURCE], scopes: ['billing:account'] }),
      ),
    ).toBe(true);
  });

  it('asks a token for this endpoint without the scope to step up', () => {
    expect(() =>
      guard.canActivate(ctx({ userId: 'did:key:a', audience: [RESOURCE], scopes: [] })),
    ).toThrow(ForbiddenException);
  });

  it('refuses a token a person gave another resource', () => {
    expect(() =>
      guard.canActivate(
        ctx({ userId: 'did:key:a', audience: ['https://brain.inite.ai/mcp'], scopes: [] }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('leaves first-party tokens and service keys as they were', () => {
    expect(guard.canActivate(ctx({ userId: 'did:key:a', audience: ['inite-billing-web'] }))).toBe(
      true,
    );
    expect(guard.canActivate(ctx({ userId: 'did:key:a' }))).toBe(true);
    expect(guard.canActivate(ctx({ userId: null, isService: true }))).toBe(true);
  });
});

describe('McpChallengeFilter', () => {
  const run = (exception: any) => {
    const headers: Record<string, string> = {};
    let status = 0;
    const res: any = {
      status: (s: number) => ((status = s), res),
      setHeader: (k: string, v: string) => ((headers[k] = v), res),
      json: () => res,
    };
    new McpChallengeFilter(config).catch(exception, {
      switchToHttp: () => ({ getResponse: () => res }),
    } as any);
    return { status, challenge: headers['WWW-Authenticate'] };
  };

  it('points a 401 at the resource metadata and names the scope', () => {
    expect(run(new UnauthorizedException())).toEqual({
      status: 401,
      challenge: `Bearer resource_metadata="${billingMcpMetadataUrl(config)}", scope="billing:account"`,
    });
  });

  it('marks a missing scope as insufficient_scope, so the client re-asks', () => {
    const guard = new McpResourceGuard(config);
    let thrown: unknown;
    try {
      guard.canActivate(ctx({ userId: 'u', audience: [RESOURCE], scopes: [] }));
    } catch (e) {
      thrown = e;
    }
    const out = run(thrown);
    expect(out.status).toBe(403);
    expect(out.challenge).toContain('error="insufficient_scope"');
  });
});

describe('McpMetadataController', () => {
  it('names this endpoint as the resource and INITE Auth as its server', () => {
    let body: any;
    const res: any = { set: () => res, json: (b: unknown) => ((body = b), res) };
    new McpMetadataController(config).metadata(res);
    expect(body).toMatchObject({
      resource: RESOURCE,
      authorization_servers: ['https://auth-api.inite.ai'],
      scopes_supported: ['billing:account'],
    });
    expect(billingMcpMetadataUrl(config)).toBe(
      'https://billing.inite.ai/.well-known/oauth-protected-resource/mcp',
    );
  });
});
