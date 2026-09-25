import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { CreditsService } from '../credits/credits.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { CheckoutService } from '../checkout/checkout.service';
import { assertPublicUrl } from '../workers/ssrf-guard';
import { postToPinnedAddress } from '../workers/pinned-post';
import { McpCaller } from './mcp-tools.service';

/** A proxied answer is a whole HTTP response to hand back unchanged. */
export interface ProxiedResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Discovery is free. Charging for it breaks every client that connects. */
const FREE_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'resources/list',
  'prompts/list',
]);

const UPSTREAM_TIMEOUT_MS = 30_000;
/** An MCP response is JSON; a megabyte is already a generous tool result. */
const MAX_UPSTREAM_BODY = 1024 * 1024;

@Injectable()
export class McpProxyService {
  private readonly logger = new Logger(McpProxyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly entitlements: EntitlementsService,
    private readonly checkout: CheckoutService,
  ) {}

  /**
   * Answer one call to a proxied server.
   *
   * The order is deliberate. Authorisation happens before the upstream is
   * touched, so a caller who cannot pay never costs the operator a request.
   * The charge happens after the upstream answered, so a customer is not billed
   * for a server that was down. Between those two a burst of concurrent calls
   * can each pass the check and only some of them find credits left — and the
   * ones that do not have already been answered. That direction is chosen: the
   * customer got what they asked for and we failed to collect a few credits,
   * which is better than collecting for work that never happened.
   */
  async handle(
    slug: string,
    caller: McpCaller,
    payload: any,
    rawBody: string,
  ): Promise<ProxiedResponse> {
    const server = await this.prisma.mcpServer.findFirst({
      where: { slug, isActive: true },
    });
    if (!server) {
      // Same answer for "no such server" and "switched off": which slugs exist
      // is not something an unauthenticated prober gets to enumerate.
      throw new NotFoundException(`No MCP server at ${slug}`);
    }

    const method = typeof payload?.method === 'string' ? payload.method : 'unknown';
    const toolName =
      method === 'tools/call' && typeof payload?.params?.name === 'string'
        ? payload.params.name
        : null;
    const started = Date.now();

    if (this.isFree(method, server)) {
      const response = await this.forward(server, rawBody);
      await this.record(server.id, caller.userId, method, toolName, {
        outcome: response.status < 400 ? 'free' : 'upstream_error',
        latencyMs: Date.now() - started,
      });
      return response;
    }

    const denial = await this.authorize(server, caller, payload?.id ?? null);
    if (denial) {
      await this.record(server.id, caller.userId, method, toolName, {
        outcome: 'denied',
        detail: denial.reason,
        latencyMs: Date.now() - started,
      });
      return denial.response;
    }

    const response = await this.forward(server, rawBody);
    if (response.status >= 400) {
      await this.record(server.id, caller.userId, method, toolName, {
        outcome: 'upstream_error',
        detail: `upstream ${response.status}`,
        latencyMs: Date.now() - started,
      });
      return response;
    }

    const charged = await this.charge(server, caller);
    await this.record(server.id, caller.userId, method, toolName, {
      outcome: charged.ok ? 'ok' : 'unpaid',
      creditsCharged: charged.credits,
      detail: charged.ok ? undefined : charged.reason,
      latencyMs: Date.now() - started,
    });

    return response;
  }

  private isFree(method: string, server: { pricingMode: string }): boolean {
    return server.pricingMode === 'free' || FREE_METHODS.has(method);
  }

  /**
   * May this caller make a billable call?
   *
   * A refusal is a JSON-RPC *result* carrying `isError` and, where the operator
   * named a price, a URL to buy at. An agent can read that and do something —
   * show the link, call the checkout tool, ask its user. A JSON-RPC error would
   * only end the turn.
   */
  private async authorize(
    server: any,
    caller: McpCaller,
    requestId: unknown,
  ): Promise<{ reason: string; response: ProxiedResponse } | null> {
    if (server.pricingMode === 'entitlement') {
      const held = await this.entitlements.getUserEntitlementsByUserId(caller.userId);
      const granted = held.some(
        (e) => e.key === server.requiredEntitlement && e.status === 'active',
      );
      if (granted) return null;
      return {
        reason: `missing entitlement ${server.requiredEntitlement}`,
        response: await this.denial(
          server,
          caller,
          requestId,
          `This server requires "${server.requiredEntitlement}", which this account does not currently hold.`,
        ),
      };
    }

    // per_call: the balance has to cover the next call before we make it.
    const cost = await this.costOf(server);
    if (cost <= 0) return null;

    const balance = await this.credits.getBalance(caller.userId, server.serviceId);
    if (balance.balance >= cost) return null;

    return {
      reason: `insufficient credits (${balance.balance} < ${cost})`,
      response: await this.denial(
        server,
        caller,
        requestId,
        `This call costs ${cost} credit(s) and the account has ${balance.balance}.`,
      ),
    };
  }

  private async costOf(server: any): Promise<number> {
    if (server.featureCode) {
      // The feature owns the rate; one call is one unit. Quotas and soft caps
      // that already exist for that feature apply without anything new here.
      const feature = await this.prisma.meteredFeature.findUnique({
        where: { code: server.featureCode },
      });
      return feature ? Math.ceil(Number(feature.creditsPerUnit)) : 0;
    }
    return server.creditsPerCall ?? 0;
  }

  /** A refusal the agent can act on, with somewhere to pay when there is one. */
  private async denial(
    server: any,
    caller: McpCaller,
    requestId: unknown,
    explanation: string,
  ): Promise<ProxiedResponse> {
    let checkoutUrl: string | null = null;
    if (server.priceCode) {
      try {
        const session = await this.checkout.createSession(
          caller.userId,
          { priceCode: server.priceCode, mode: 'PAYMENT' } as any,
          undefined,
          undefined,
          server.serviceId,
        );
        checkoutUrl = session.checkoutUrl;
      } catch (error: any) {
        // A catalogue misconfiguration must not turn a clean "you need to pay"
        // into a 500 the agent cannot interpret.
        this.logger.warn(
          `Could not open a checkout for ${server.slug} (price ${server.priceCode}): ${error.message}`,
        );
      }
    }

    const text = checkoutUrl
      ? `${explanation}\n\nTop up here, then call again: ${checkoutUrl}`
      : explanation;

    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId ?? null,
        result: {
          content: [{ type: 'text', text }],
          isError: true,
          ...(checkoutUrl ? { structuredContent: { payment_required: true, checkoutUrl } } : {}),
        },
      }),
    };
  }

  private async charge(
    server: any,
    caller: McpCaller,
  ): Promise<{ ok: boolean; credits: number; reason?: string }> {
    const result = await this.credits.consume({
      userId: caller.userId,
      serviceId: server.serviceId,
      ...(server.featureCode
        ? { featureCode: server.featureCode, units: 1 }
        : { amount: server.creditsPerCall ?? 0 }),
      description: `MCP call to ${server.name}`,
      metadata: { via: 'mcp-gateway', mcpServerId: server.id, slug: server.slug },
    });

    if (!result.success) {
      // The upstream already answered, so this is revenue lost rather than a
      // customer wronged. It is logged as `unpaid` so an operator can see it.
      this.logger.warn(
        `Unpaid MCP call to ${server.slug} for ${caller.userId}: ${result.error ?? 'charge failed'}`,
      );
      return { ok: false, credits: 0, reason: result.error };
    }

    return { ok: true, credits: result.creditsCharged ?? server.creditsPerCall ?? 0 };
  }

  /**
   * Send the request on to the operator's own server.
   *
   * The URL belongs to whoever registered the server, which makes it
   * attacker-controlled input: it goes through the same guard and address
   * pinning the outbox publisher uses, so a hostname cannot resolve public for
   * the check and to the metadata service for the connection.
   */
  private async forward(server: any, rawBody: string): Promise<ProxiedResponse> {
    const guard = await assertPublicUrl(server.upstreamUrl);
    if (!guard.ok) {
      this.logger.error(
        `Refusing to forward to ${server.slug}: upstream ${server.upstreamUrl} is ${guard.reason}`,
      );
      return this.upstreamFailure('This server is misconfigured and cannot be reached.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.operatorHeaders(server.upstreamHeaders),
    };

    try {
      const result = await postToPinnedAddress({
        url: server.upstreamUrl,
        addresses: guard.addresses ?? [],
        headers,
        body: rawBody,
        timeoutMs: UPSTREAM_TIMEOUT_MS,
        captureBody: { maxBytes: MAX_UPSTREAM_BODY },
      });

      return {
        status: result.status,
        contentType: result.contentType || 'application/json',
        body: result.body ?? '',
      };
    } catch (error: any) {
      this.logger.warn(`Upstream ${server.slug} failed: ${error.message}`);
      return this.upstreamFailure('The server behind this endpoint did not answer.');
    }
  }

  /** Header values are operator-supplied; only strings are forwarded. */
  private operatorHeaders(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(key)) out[key] = value;
    }
    return out;
  }

  private upstreamFailure(text: string): ProxiedResponse {
    return {
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: text },
      }),
    };
  }

  /**
   * The call log is the operator's revenue report and the customer's receipt,
   * so it is written for every outcome — including the ones nobody paid for.
   * Never allowed to fail the call it describes.
   */
  private async record(
    mcpServerId: string,
    userId: string,
    method: string,
    toolName: string | null,
    fields: { outcome: string; creditsCharged?: number; latencyMs?: number; detail?: string },
  ): Promise<void> {
    try {
      await this.prisma.mcpCall.create({
        data: {
          mcpServerId,
          userId,
          method,
          toolName,
          outcome: fields.outcome,
          creditsCharged: fields.creditsCharged ?? 0,
          latencyMs: fields.latencyMs ?? null,
          detail: fields.detail ?? null,
        },
      });
    } catch (error: any) {
      this.logger.error(`Could not record MCP call for ${mcpServerId}: ${error.message}`);
    }
  }
}
