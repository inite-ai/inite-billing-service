import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User } from '../auth/decorators/user.decorator';
import { PrismaService } from '../common/services/prisma.service';

const STATES = ['open', 'resolved', 'refunded'];

export class ListUnappliedDto {
  @IsOptional()
  @IsIn(STATES)
  status?: string;
}

export class ResolveUnappliedDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}

/** Money that paid no order: what came, why it was not applied, what was done. */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/unapplied-payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UnappliedPaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Settled payments that no order could take' })
  async list(@Query() query: ListUnappliedDto) {
    return this.prisma.unappliedPayment.findMany({
      where: { status: query.status ?? 'open' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Records what a person did about it. Moves no money and grants nothing. */
  @Post(':id/resolve')
  @ApiOperation({ summary: 'Record how an unapplied payment was settled by hand' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveUnappliedDto,
    @User() user: any,
  ) {
    const row = await this.prisma.unappliedPayment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Unapplied payment not found');
    const done = await this.prisma.unappliedPayment.updateMany({
      where: { id, status: 'open' },
      data: {
        status: 'resolved',
        note: dto.note,
        resolvedBy: String(user?.userId ?? user?.sub ?? ''),
        resolvedAt: new Date(),
      },
    });
    if (done.count === 0) throw new ConflictException(`Already ${row.status}`);
    return this.prisma.unappliedPayment.findUnique({ where: { id } });
  }
}
