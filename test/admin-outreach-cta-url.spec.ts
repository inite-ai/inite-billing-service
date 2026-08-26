jest.mock('../src/notifications/templates', () => ({
  renderTemplate: jest.fn(() => ({ subject: 's', html: 'h', text: 't' })),
  isKnownTemplate: () => true,
}));

import { renderTemplate } from '../src/notifications/templates';
import { AdminOutreachController } from '../src/outreach/admin-outreach.controller';

/**
 * The ops test-email endpoint hardcoded https://billing.inite.ai/dashboard as
 * the CTA — wrong for any self-hosted instance. It now derives from FRONTEND_URL.
 */
describe('AdminOutreachController.testEmail CTA URL', () => {
  const build = (frontendUrl?: string) => {
    const emailService = { send: jest.fn().mockResolvedValue({ skipped: false, id: 'm1' }) };
    const config = { get: () => frontendUrl };
    const controller = new AdminOutreachController({} as any, emailService as any, config as any);
    return { controller, emailService };
  };

  beforeEach(() => (renderTemplate as jest.Mock).mockClear());

  it('uses FRONTEND_URL for the CTA link', async () => {
    const { controller } = build('https://billing.example.com');
    await controller.testEmail({ to: 'x@y.com', trigger: 'abandoned_checkout' } as any);
    expect(renderTemplate).toHaveBeenCalledWith(
      'abandoned_checkout',
      undefined,
      expect.objectContaining({ ctaUrl: 'https://billing.example.com/dashboard' }),
    );
  });

  it('strips a trailing slash on FRONTEND_URL', async () => {
    const { controller } = build('https://billing.example.com/');
    await controller.testEmail({ to: 'x@y.com', trigger: 'abandoned_checkout' } as any);
    expect(renderTemplate).toHaveBeenCalledWith(
      'abandoned_checkout',
      undefined,
      expect.objectContaining({ ctaUrl: 'https://billing.example.com/dashboard' }),
    );
  });

  it('falls back to localhost, never to a deployed host, when FRONTEND_URL is unset', async () => {
    const { controller } = build(undefined);
    await controller.testEmail({ to: 'x@y.com', trigger: 'abandoned_checkout' } as any);
    // The fallback used to be https://billing.inite.ai — a fork of this repo
    // would have emailed its users links to somebody else's installation.
    expect(renderTemplate).toHaveBeenCalledWith(
      'abandoned_checkout',
      undefined,
      expect.objectContaining({ ctaUrl: 'http://localhost:3001/dashboard' }),
    );
  });
});
