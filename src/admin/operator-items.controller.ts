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

export class ListOperatorItemsDto {
  @IsOptional()
  @IsIn(['open', 'resolved'])
  status?: string;
}

export class ResolveOperatorItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note: string;
}

/** Questions about money only a person can answer. Resolving records the answer; it moves nothing. */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/operator-items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class OperatorItemsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Questions about money waiting for a person' })
  async list(@Query() query: ListOperatorItemsDto) {
    return this.prisma.operatorItem.findMany({
      where: { status: query.status ?? 'open' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Record how an item was settled' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveOperatorItemDto,
    @User() user: any,
  ) {
    const row = await this.prisma.operatorItem.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Item not found');
    const done = await this.prisma.operatorItem.updateMany({
      where: { id, status: 'open' },
      data: {
        status: 'resolved',
        note: dto.note,
        resolvedBy: String(user?.userId ?? user?.sub ?? ''),
        resolvedAt: new Date(),
      },
    });
    if (done.count === 0) throw new ConflictException(`Already ${row.status}`);
    return this.prisma.operatorItem.findUnique({ where: { id } });
  }
}
