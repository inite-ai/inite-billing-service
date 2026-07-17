/**
 * Serializers for the AI SDK v6 UI Message Stream protocol (SSE).
 * The client (useChat + DefaultChatTransport) requires the
 * `x-vercel-ai-ui-message-stream: v1` response header and a final
 * `data: [DONE]` terminator — without it the client hangs in `streaming`.
 */
export const sse = (part: Record<string, unknown>): string =>
  `data: ${JSON.stringify(part)}\n\n`;

export const sseDone = (): string => 'data: [DONE]\n\n';

export const UI_MESSAGE_STREAM_HEADER = 'x-vercel-ai-ui-message-stream';
export const UI_MESSAGE_STREAM_VERSION = 'v1';
