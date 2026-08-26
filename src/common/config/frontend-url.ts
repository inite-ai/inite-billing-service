import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const logger = new Logger('FrontendUrl');
const LOCAL_DEFAULT = 'http://localhost:3001';

let warned = false;

/**
 * The public base URL of the billing frontend — checkout return links, referral
 * links, unsubscribe links and every URL in an outbound email hang off it.
 *
 * Callers used to inline their own fallback, which drifted: most defaulted to
 * `https://billing.inite.ai`, the affiliate service to `https://app.inite.ai`.
 * A deployment that never set FRONTEND_URL therefore emailed its users links to
 * somebody else's domain, and a fork of this repo would do the same — quietly,
 * because a wrong-but-valid URL never errors.
 *
 * The default is now local and obviously wrong outside development, and it says
 * so once in the log.
 */
export function resolveFrontendUrl(config: ConfigService): string {
  const configured = config.get<string>('FRONTEND_URL');
  if (configured) return configured.replace(/\/+$/, '');

  if (!warned) {
    warned = true;
    logger.warn(
      `FRONTEND_URL is not set — falling back to ${LOCAL_DEFAULT}. ` +
        'Checkout redirects, referral links and email links will point there.',
    );
  }
  return LOCAL_DEFAULT;
}

/** Reset the once-only warning. Test helper. */
export function resetFrontendUrlWarning(): void {
  warned = false;
}
