import { bullConnectionFromUrl } from '../src/common/redis-connection';

describe('bullConnectionFromUrl', () => {
  it('defaults to localhost:6379', () => {
    expect(bullConnectionFromUrl(undefined)).toEqual({ host: 'localhost', port: 6379 });
  });

  it('keeps host and port', () => {
    expect(bullConnectionFromUrl('redis://redis:6380')).toEqual({ host: 'redis', port: 6380 });
  });

  it('carries the password (requirepass) — the NOAUTH regression', () => {
    expect(bullConnectionFromUrl('redis://:s%40cret@redis:6379')).toEqual({
      host: 'redis',
      port: 6379,
      password: 's@cret',
    });
  });

  it('carries an ACL user, the database index and TLS', () => {
    expect(bullConnectionFromUrl('rediss://billing:pw@cache.example.com:6390/2')).toEqual({
      host: 'cache.example.com',
      port: 6390,
      username: 'billing',
      password: 'pw',
      db: 2,
      tls: {},
    });
  });
});
