import { ValidationPipe } from '@nestjs/common';

/**
 * Validation for endpoints external product modules call directly.
 *
 * The global pipe runs `forbidNonWhitelisted`, which turns any unrecognised
 * field into a 400. That is the right default for our own admin UI, where both
 * sides ship together — but these routes are a published contract other
 * services already call, and backwards compatibility is mandatory. A caller
 * sending a field we do not know about must keep working.
 *
 * So: same validation and the same stripping of unknown fields (`whitelist`),
 * without the rejection. Known fields are still bounded and coerced.
 */
export const publicApiValidation = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  });
