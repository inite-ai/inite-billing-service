#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * INITE billing, over stdio.
 *
 * This is a bridge, not a second implementation. The tools live on the billing
 * service and are served over HTTP at `/mcp`; this process speaks stdio to a
 * local client (Claude Desktop, Cursor, an agent framework) and forwards to
 * that endpoint. Nothing about the tools is described twice, so nothing can
 * drift out of step with the API — add a tool to the service and it appears
 * here on the next call.
 *
 * Configuration is two environment variables:
 *
 *   INITE_API_KEY   a service key, or INITE_JWT for a user token
 *   INITE_BILLING_URL  defaults to https://billing.inite.ai
 */

const DEFAULT_URL = 'https://billing.inite.ai';

interface Config {
  endpoint: URL;
  headers: Record<string, string>;
}

function readConfig(env: NodeJS.ProcessEnv): Config {
  const base = (env.INITE_BILLING_URL || DEFAULT_URL).replace(/\/+$/, '');

  const apiKey = env.INITE_API_KEY?.trim();
  const jwt = env.INITE_JWT?.trim();
  if (!apiKey && !jwt) {
    throw new Error(
      'Set INITE_API_KEY (a service key) or INITE_JWT (a user token). ' +
        'Without one of them the billing service has no idea who is asking.',
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`${base}/mcp`);
  } catch {
    throw new Error(`INITE_BILLING_URL is not a URL: ${base}`);
  }
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost') {
    throw new Error(
      `Refusing to send credentials over ${endpoint.protocol}//${endpoint.hostname}. Use https.`,
    );
  }

  return {
    endpoint,
    headers: apiKey ? { 'x-api-key': apiKey } : { Authorization: `Bearer ${jwt}` },
  };
}

async function main(): Promise<void> {
  const config = readConfig(process.env);

  const upstream = new Client(
    { name: 'inite-billing-mcp-bridge', version: '1.0.0' },
    { capabilities: {} },
  );

  // Fail here, loudly, rather than starting a stdio server that answers every
  // tool call with an error. A client that connects successfully and then finds
  // nothing works is far harder to diagnose than a process that refuses to
  // start and says why.
  await upstream.connect(
    new StreamableHTTPClientTransport(config.endpoint, {
      requestInit: { headers: config.headers },
    }),
  );

  const remoteInfo = upstream.getServerVersion();
  const server = new Server(
    {
      name: remoteInfo?.name ?? 'inite-billing',
      version: remoteInfo?.version ?? '1.0.0',
    },
    {
      capabilities: { tools: {} },
      instructions: upstream.getInstructions(),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = await upstream.listTools();
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return upstream.callTool({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
    });
  });

  // If the far end goes away there is nothing left to bridge; exiting lets the
  // client restart us with a fresh connection instead of holding a dead one.
  upstream.onclose = () => {
    process.stderr.write('inite-billing-mcp: upstream connection closed\n');
    process.exit(1);
  };

  await server.connect(new StdioServerTransport());
  process.stderr.write(`inite-billing-mcp: bridging ${config.endpoint.href}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`inite-billing-mcp: ${message}\n`);
  process.exit(1);
});
