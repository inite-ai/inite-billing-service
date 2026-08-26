import { BadRequestException } from '@nestjs/common';
import { csvCell, toCsv } from '../src/common/helpers/csv';
import { AdminExportService, EXPORT_MAX_ROWS } from '../src/admin/services/admin-export.service';

describe('csv rendering', () => {
  it('quotes a value containing the delimiter so it stays one column', () => {
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
  });

  it('doubles an embedded quote', () => {
    expect(csvCell('the "pro" plan')).toBe('"the ""pro"" plan"');
  });

  it('quotes a value with a newline instead of breaking the row', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('defuses a cell a spreadsheet would execute', () => {
    // A failure reason or an external reference is attacker-shaped input that
    // ends up in a file an operator opens in Excel.
    expect(csvCell('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100");
    expect(csvCell('@user')).toBe("'@user");
  });

  it('renders an empty cell for a missing value rather than the word undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('writes dates in a sortable, unambiguous form', () => {
    expect(csvCell(new Date('2026-08-14T09:30:00.000Z'))).toBe('2026-08-14T09:30:00.000Z');
  });

  it('starts the file with a BOM so Excel reads UTF-8 as UTF-8', () => {
    const csv = toCsv(['name'], [['Подписка «Про»']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Подписка «Про»');
  });

  it('terminates rows with CRLF per RFC 4180', () => {
    expect(toCsv(['a', 'b'], [[1, 2]])).toBe('﻿a,b\r\n1,2\r\n');
  });
});

describe('AdminExportService', () => {
  const build = (count: number, items: any[] = []) => {
    const prisma = {
      order: {
        count: jest.fn().mockResolvedValue(count),
        findMany: jest.fn().mockResolvedValue(items),
      },
    } as any;
    const users = { getCustomers: jest.fn(), countCustomers: jest.fn() } as any;
    return { service: new AdminExportService(prisma, users), prisma };
  };

  it('refuses an oversized export instead of shipping a truncated file', async () => {
    const { service } = build(EXPORT_MAX_ROWS + 1);
    await expect(service.toCsvFile('orders', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exports the filtered set, not everything', async () => {
    const { service, prisma } = build(1, [
      {
        id: 'ord-1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        userId: 'user-1',
        price: { product: { name: 'Pro' } },
        amount: '49.0000',
        currency: 'USD',
        mode: 'SUBSCRIPTION',
        status: 'paid',
        externalId: null,
      },
    ]);

    const { csv, rows, filename } = await service.toCsvFile('orders', {
      status: 'paid',
      search: 'pi_3Ox',
      sortBy: 'amount',
      sortOrder: 'asc',
    });

    expect(prisma.order.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'paid', OR: expect.any(Array) }),
    });
    expect(prisma.order.findMany.mock.calls[0][0].orderBy).toEqual([
      { amount: 'asc' },
      { id: 'asc' },
    ]);
    expect(rows).toBe(1);
    expect(filename).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain(
      'ord-1,2026-08-01T00:00:00.000Z,user-1,Pro,49.0000,USD,SUBSCRIPTION,paid',
    );
  });

  it('produces a header-only file when nothing matches', async () => {
    const { service } = build(0);
    const { csv, rows } = await service.toCsvFile('orders', { status: 'refunded' });
    expect(rows).toBe(0);
    expect(csv).toBe('﻿id,created_at,user_id,product,amount,currency,mode,status,external_id\r\n');
  });

  it('rejects a resource it does not know', async () => {
    const { service } = build(0);
    await expect(service.toCsvFile('secrets' as any, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
