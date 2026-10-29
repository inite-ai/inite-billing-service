import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../common/services/prisma.service';
import { CharityDto } from './commitments.dto';
import { publicRef } from './commitment-view';

const sum = (rows: Array<{ credit: Decimal; debit: Decimal }>, side: 'credit' | 'debit') =>
  rows.reduce((s, r) => s.plus(r[side]), new Decimal(0));

/**
 * Charities, the forfeits they are owed and the batches that hand them over.
 * The public view is aggregate: what each charity was given and when, with a
 * short reference per forfeit — never a person, never a commitment id.
 */
@Injectable()
export class CharitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async totals(code: string) {
    const [payable, paid] = await Promise.all([
      this.prisma.commitmentLedgerEntry.findMany({
        where: { account: `charity_payable:${code}` },
        select: { credit: true, debit: true },
      }),
      this.prisma.commitmentLedgerEntry.findMany({
        where: { account: `charity_paid:${code}` },
        select: { credit: true, debit: true },
      }),
    ]);
    const forfeited = sum(payable, 'credit');
    const paidOut = sum(paid, 'credit');
    return {
      forfeited: forfeited.toFixed(2),
      paidOut: paidOut.toFixed(2),
      owed: forfeited.minus(paidOut).toFixed(2),
      currency: 'USD',
    };
  }

  private view(c: { code: string; name: string; url: string | null; description: unknown }) {
    return { code: c.code, name: c.name, url: c.url, description: c.description ?? {} };
  }

  async listPublic() {
    const charities = await this.prisma.charity.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return {
      charities: await Promise.all(
        charities.map(async (c) => ({ ...this.view(c), totals: await this.totals(c.code) })),
      ),
    };
  }

  async ledgerPublic(code: string) {
    const charity = await this.prisma.charity.findUnique({ where: { code } });
    if (!charity) throw new NotFoundException('No such charity');
    const [forfeits, payouts] = await Promise.all([
      this.prisma.commitment.findMany({
        where: { charityId: charity.id, status: 'forfeited' },
        select: { id: true, settledAt: true, stakeAmount: true },
        orderBy: { settledAt: 'desc' },
        take: 500,
      }),
      this.prisma.charityPayout.findMany({
        where: { charityId: charity.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    return {
      charity: { ...this.view(charity), totals: await this.totals(code) },
      forfeits: forfeits.map((f) => ({
        at: f.settledAt?.toISOString() ?? null,
        amount: f.stakeAmount.toFixed(2),
        ref: publicRef(f.id),
      })),
      payouts: payouts.map((p) => ({
        at: (p.sentAt ?? p.createdAt).toISOString(),
        amount: p.amount.toFixed(2),
        status: p.status,
        reference: p.reference,
        periodFrom: p.periodFrom?.toISOString() ?? null,
        periodTo: p.periodTo.toISOString(),
      })),
    };
  }

  // ── Admin ──

  listAdmin() {
    return this.prisma.charity.findMany({ orderBy: { name: 'asc' } });
  }

  upsert(dto: CharityDto) {
    const data = {
      name: dto.name,
      url: dto.url ?? null,
      description: dto.description ?? {},
      payoutMethod: dto.payoutMethod ?? null,
      isActive: dto.isActive ?? true,
    };
    return this.prisma.charity.upsert({
      where: { code: dto.code },
      create: { code: dto.code, ...data },
      update: data,
    });
  }

  /**
   * A batch for one charity: every forfeit not yet handed over, settled up to
   * `periodTo`, linked to the batch and booked Dr payable / Cr paid. INITE
   * then sends the money by hand and records the reference.
   */
  async createPayout(charityCode: string, periodTo: Date, createdBy: string) {
    return this.prisma.$transaction(async (tx) => {
      const charity = await tx.charity.findUnique({ where: { code: charityCode } });
      if (!charity) throw new NotFoundException('No such charity');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`charity:${charity.id}`}))`;
      const rows = await tx.commitment.findMany({
        where: {
          charityId: charity.id,
          status: 'forfeited',
          charityPayoutId: null,
          settledAt: { lte: periodTo },
        },
        select: { id: true, stakeAmount: true, settledAt: true, currency: true },
      });
      if (rows.length === 0) throw new BadRequestException('Nothing to hand over for this period');
      const amount = rows.reduce((s, r) => s.plus(r.stakeAmount), new Decimal(0));
      const from = rows.reduce(
        (min, r) => (r.settledAt && (!min || r.settledAt < min) ? r.settledAt : min),
        null as Date | null,
      );
      const payout = await tx.charityPayout.create({
        data: {
          charityId: charity.id,
          amount,
          currency: 'USD',
          periodFrom: from,
          periodTo,
          createdBy,
        },
      });
      await tx.commitment.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { charityPayoutId: payout.id },
      });
      await tx.commitmentLedgerEntry.createMany({
        data: [
          {
            payoutId: payout.id,
            account: `charity_payable:${charity.code}`,
            debit: amount,
            credit: 0,
            currency: 'USD',
          },
          {
            payoutId: payout.id,
            account: `charity_paid:${charity.code}`,
            debit: 0,
            credit: amount,
            currency: 'USD',
          },
        ],
      });
      return { ...payout, commitments: rows.length };
    });
  }

  async markPayoutSent(id: string, reference: string) {
    const payout = await this.prisma.charityPayout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('No such payout');
    return this.prisma.charityPayout.update({
      where: { id },
      data: { status: 'sent', reference, sentAt: new Date() },
    });
  }
}
