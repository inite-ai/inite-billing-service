import { UnauthorizedException } from '@nestjs/common';
import {
  gatewayMetadataUrl,
  gatewayResource,
  McpGatewayChallengeFilter,
  McpGatewayMetadataController,
  McpGatewayResourceGuard,
} from '../src/mcp/mcp-gateway-resource';

/**
 * The billed gateway /mcp/s/<slug> (family MCP plan S5): it used to bill any
 * INITE user token. Now only a token issued for this gateway (or billing's
 * /mcp with billing:account), a first-party client token, or a service key.
 */
const config = { get: (k: string) => ({ JWT_ISSUER: 'https://auth-api.inite.ai' })[k] } as any;
const SLUG = 'weather';
const GATEWAY = 'https://billing.inite.ai/mcp/s/weather';

const ctx = (user: unknown, slug = SLUG) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user, params: { slug } }) }) }) as any;

describe('McpGatewayResourceGuard', () => {
  const guard = new McpGatewayResourceGuard(config);

  it('names the gateway resource per slug', () => {
    expect(gatewayResource(config, SLUG)).toBe(GATEWAY);
    expect(gatewayMetadataUrl(config, SLUG)).toBe(
      'https://billing.inite.ai/.well-known/oauth-protected-resource/mcp/s/weather',
    );
  });

  it('accepts a token issued for this gateway', () => {
    expect(guard.canActivate(ctx({ userId: 'u', audience: [GATEWAY], scopes: [] }))).toBe(true);
  });

  it("refuses a token issued for another slug's gateway", () => {
    expect(() =>
      guard.canActivate(
        ctx({ userId: 'u', audience: ['https://billing.inite.ai/mcp/s/other'], scopes: [] }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a token a person gave another resource', () => {
    expect(() =>
      guard.canActivate(ctx({ userId: 'u', audience: ['https://brain.inite.ai/mcp'], scopes: [] })),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a dynamically registered client token that names no resource', () => {
    expect(() =>
      guard.canActivate(ctx({ userId: 'u', audience: ['dcr_0123abcd'], scopes: [] })),
    ).toThrow(UnauthorizedException);
  });

  it("accepts billing's own /mcp token only with billing:account", () => {
    expect(
      guard.canActivate(
        ctx({
          userId: 'u',
          audience: ['https://billing.inite.ai/mcp'],
          scopes: ['billing:account'],
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx({ userId: 'u', audience: ['https://billing.inite.ai/mcp'], scopes: [] }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('leaves first-party client tokens and service keys as they were', () => {
    expect(guard.canActivate(ctx({ userId: 'u', audience: ['inite-billing-web'] }))).toBe(true);
    expect(guard.canActivate(ctx({ userId: null, isService: true }))).toBe(true);
  });
});

describe('McpGatewayChallengeFilter', () => {
  it("points the 401 at this slug's resource metadata", () => {
    const headers: Record<string, string> = {};
    let status = 0;
    const res: any = {
      status: (s: number) => ((status = s), res),
      setHeader: (k: string, v: string) => ((headers[k] = v), res),
      json: () => res,
    };
    new McpGatewayChallengeFilter(config).catch(new UnauthorizedException(), {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ params: { slug: SLUG } }),
      }),
    } as any);
    expect(status).toBe(401);
    expect(headers['WWW-Authenticate']).toBe(
      'Bearer resource_metadata="https://billing.inite.ai/.well-known/oauth-protected-resource/mcp/s/weather"',
    );
  });
});

describe('McpGatewayMetadataController', () => {
  it('names the gateway as the resource and INITE Auth as its server', () => {
    let body: any;
    const res: any = { set: () => res, status: () => res, json: (b: unknown) => ((body = b), res) };
    new McpGatewayMetadataController(config).metadata(SLUG, res);
    expect(body).toMatchObject({
      resource: GATEWAY,
      authorization_servers: ['https://auth-api.inite.ai'],
    });
  });
});
