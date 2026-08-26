import { ConfigService } from '@nestjs/config';
import { resetFrontendUrlWarning, resolveFrontendUrl } from '../src/common/config/frontend-url';

const cfg = (value?: string) => ({ get: () => value }) as unknown as ConfigService;

/**
 * Every caller used to inline its own fallback and they had drifted apart —
 * most to billing.inite.ai, the affiliate service to app.inite.ai. A
 * deployment that never set FRONTEND_URL emailed users links to a domain it
 * does not own, and nothing errored because a wrong URL is still a valid one.
 */
describe('resolveFrontendUrl', () => {
  beforeEach(() => resetFrontendUrlWarning());

  it('uses the configured URL', () => {
    expect(resolveFrontendUrl(cfg('https://billing.acme.example'))).toBe(
      'https://billing.acme.example',
    );
  });

  it('strips trailing slashes so callers can concatenate paths', () => {
    expect(resolveFrontendUrl(cfg('https://billing.acme.example/'))).toBe(
      'https://billing.acme.example',
    );
  });

  it('falls back to localhost rather than any deployed host', () => {
    const resolved = resolveFrontendUrl(cfg(undefined));
    expect(resolved).toBe('http://localhost:3001');
    expect(resolved).not.toMatch(/inite\.ai/);
  });
});
