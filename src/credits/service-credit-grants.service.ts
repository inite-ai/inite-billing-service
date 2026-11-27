import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import {
  CREDITS_GRANTED,
  CREDITS_REVOKED,
  creditGrantedPayload,
  creditRevokedPayload,
} from './credit-events';

export const GRANTS_PAGE_DEFAULT = 100;
export const GRANTS_PAGE_MAX = 500;

/** One grant or revoke, in the shape its outbox event has. */
export interface ServiceCreditEvent {
  type: typeof CREDITS_GRANTED | typeof CREDITS_REVOKED;
  /** The ledger row: the grant for a grant, the reversal for a revoke. */
  ledgerId: string;
  /** When the ledger row was written; ISO. */
  timestamp: string;
  /** The event's `data`, built by the same function the outbox uses. */
  data: Record<string, unknown>;
}

export interface ServiceCreditEventsPage {
  items: ServiceCreditEvent[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

interface Row {
  id: string;
  type: string;
  user_id: string;
  amount: number;
  order_id: string | null;
  metadata: unknown;
  key: string;
  grant_id: string | null;
  grant_amount: number | null;
  grant_metadata: unknown;
}

/**
 * A position in the list: the exact `created_at` (microseconds, as text from
 * Postgres) and the row id. A JavaScript Date keeps milliseconds only, so a
 * cursor made from one would sit just before the row it came from, and the
 * next page would start with that row again.
 */
interface Position {
  at: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PG_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(p: Position): string {
  return Buffer.from(`${p.at}|${p.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Position {
  const raw = cursor.length <= 200 ? Buffer.from(cursor, 'base64url').toString('utf8') : '';
  const [at, id, extra] = raw.split('|');
  if (extra !== undefined || !at || !id || !PG_TIME.test(at) || !UUID.test(id)) {
    throw new BadRequestException('cursor is not one this endpoint gave');
  }
  return { at, id };
}

/**
 * The grants and revokes of one service's credits, oldest first, for that
 * service to reconcile its own ledger against: an event that never reached
 * it, or reached it wrong, shows up here.
 *
 * A service reads only its own: the balance's `service_id` is the one the
 * service token resolved to, and nothing in the request can name another.
 */
@Injectable()
export class ServiceCreditGrantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    serviceId: string,
    query: { since: Date; cursor?: Position; limit?: number },
  ): Promise<ServiceCreditEventsPage> {
    const limit = Math.min(Math.max(query.limit ?? GRANTS_PAGE_DEFAULT, 1), GRANTS_PAGE_MAX);
    const after = query.cursor
      ? Prisma.sql`AND (u.created_at, u.id) > (${query.cursor.at}::timestamptz, ${query.cursor.id}::uuid)`
      : Prisma.empty;

    // Exactly the rows that emitted an event: a grant with a source
    // (recordGrant), a reversal of a known grant (revokeGrant). The reversal
    // reads its grant on the same balance for the amount and the company.
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT u.id::text AS id, u.type, u.user_id, u.amount, u.order_id::text AS order_id,
             u.metadata,
             to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS key,
             g.id::text AS grant_id, g.amount AS grant_amount, g.metadata AS grant_metadata
        FROM billing.credit_usages u
        JOIN billing.credit_balances b ON b.id = u.credit_balance_id
        LEFT JOIN billing.credit_usages g
          ON u.type = 'purchase_reversal'
         AND g.credit_balance_id = u.credit_balance_id
         AND g.type = 'grant'
         AND g.id::text = u.metadata ->> 'grantId'
       WHERE b.service_id = ${serviceId}::uuid
         AND u.created_at >= ${query.since}
         AND (
              (u.type = 'grant' AND u.metadata ->> 'source' IS NOT NULL)
           OR (u.type = 'purchase_reversal' AND u.metadata ->> 'grantId' IS NOT NULL)
         )
         ${after}
       ORDER BY u.created_at, u.id
       LIMIT ${limit + 1}
    `);

    const page = rows.slice(0, limit);
    const items: ServiceCreditEvent[] = [];
    for (const row of page) {
      const item = this.toEvent(row);
      if (item) items.push(item);
    }
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor({ at: last.key, id: last.id }) : null,
    };
  }

  private toEvent(row: Row): ServiceCreditEvent | null {
    const base = { ledgerId: row.id, timestamp: row.key };
    if (row.type === 'grant') {
      const data = creditGrantedPayload({
        id: row.id,
        userId: row.user_id,
        orderId: row.order_id,
        amount: row.amount,
        metadata: row.metadata,
      });
      return data ? { type: CREDITS_GRANTED, ...base, data } : null;
    }
    // A reversal whose grant is gone, or one without an order, emitted nothing.
    if (!row.grant_id || row.grant_amount === null || !row.order_id) return null;
    return {
      type: CREDITS_REVOKED,
      ...base,
      data: creditRevokedPayload({
        grant: { id: row.grant_id, amount: row.grant_amount, metadata: row.grant_metadata },
        userId: row.user_id,
        orderId: row.order_id,
      }),
    };
  }
}
