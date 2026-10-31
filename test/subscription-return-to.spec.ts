import { allowedOriginsOf, validReturnTo } from '../src/subscription-lifecycle/return-to';

/** The customer page's link back may only lead to the service's own origins. */
describe('portal return_to', () => {
  const origins = allowedOriginsOf({
    allowedOrigins: ['https://rent.inite.ai', 'http://insecure.example', 'nonsense', 42],
  });

  it('keeps only https origins from the service metadata', () => {
    expect(origins).toEqual(['https://rent.inite.ai']);
    expect(allowedOriginsOf(null)).toEqual([]);
    expect(allowedOriginsOf({ allowedOrigins: 'https://rent.inite.ai' })).toEqual([]);
  });

  it('accepts an address on an allowed origin', () => {
    expect(validReturnTo('https://rent.inite.ai/acme/billing?x=1', origins)).toBe(
      'https://rent.inite.ai/acme/billing?x=1',
    );
  });

  it('refuses everything else', () => {
    for (const bad of [
      'https://evil.example/',
      'https://rent.inite.ai.evil.example/',
      'http://rent.inite.ai/',
      'https://user:pw@rent.inite.ai/',
      '//rent.inite.ai/',
      '/subscriptions',
      'javascript:alert(1)',
      '',
      undefined,
      `https://rent.inite.ai/${'a'.repeat(2001)}`,
    ]) {
      expect(validReturnTo(bad, origins)).toBeNull();
    }
    expect(validReturnTo('https://rent.inite.ai/', [])).toBeNull();
  });
});
