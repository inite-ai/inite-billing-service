/**
 * BullMQ connection options from REDIS_URL.
 *
 * Every other Redis client in billing hands REDIS_URL to ioredis whole, which
 * reads credentials, database index and TLS from it. BullMQ takes an options
 * object, and building it from host + port alone silently dropped the rest:
 * against a Redis with `requirepass` every queue failed with NOAUTH while the
 * locks, checkout and metering clients — same URL — worked.
 */
export interface BullConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

export function bullConnectionFromUrl(raw: string | undefined): BullConnection {
  const url = new URL(raw || 'redis://localhost:6379');
  const conn: BullConnection = {
    host: url.hostname,
    port: Number(url.port) || 6379,
  };
  if (url.username) conn.username = decodeURIComponent(url.username);
  if (url.password) conn.password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, '');
  if (/^\d+$/.test(db)) conn.db = Number(db);
  if (url.protocol === 'rediss:') conn.tls = {};
  return conn;
}
