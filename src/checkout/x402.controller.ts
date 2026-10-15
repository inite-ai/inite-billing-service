import { Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CHECKOUT_LINK_HEADER } from './checkout-link';
import { X402Reply, X402Service } from './x402.service';
import { X402_HEADERS } from '../adapters/crypto/x402/protocol';

/**
 * Pay a checkout session over x402. The URL comes with the session
 * (`x402Url`); the link token in it is what opens the order, as the checkout
 * page's link does.
 *
 * Without a payment header: 402 with the terms. With one: the payment is
 * checked and settled, 200 with the settlement. Once the order is paid: 200,
 * status "paid".
 */
@ApiTags('Checkout')
@Controller('v1/x402')
export class X402Controller {
  constructor(private readonly x402: X402Service) {}

  @Get('sessions/:id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay a checkout session with x402 (USDC on Base)' })
  async pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('t') queryToken: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const headerToken = headers[CHECKOUT_LINK_HEADER];
    const token = queryToken ?? (Array.isArray(headerToken) ? headerToken[0] : headerToken);
    const resource = `${res.req.protocol}://${res.req.get('host')}/v1/x402/sessions/${id}`;
    send(res, await this.x402.handle(id, token, headers, resource));
  }

  /** The same, for clients that send the payment with POST. */
  @Post('sessions/:id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pay a checkout session with x402 (USDC on Base)' })
  payPost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('t') queryToken: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    return this.pay(id, queryToken, headers, res);
  }
}

function send(res: Response, reply: X402Reply): void {
  res.status(reply.status);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader(
    'Access-Control-Expose-Headers',
    [X402_HEADERS.required, X402_HEADERS.response, X402_HEADERS.v1Response].join(', '),
  );
  for (const [name, value] of Object.entries(reply.headers)) res.setHeader(name, value);
  res.json(reply.body);
}
