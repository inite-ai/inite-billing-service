import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { cookies } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function apiCall(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `access_token=${token}`,
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });

  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-5-20250514'),
    system: `You are an AI assistant for INITE Billing Service. You help users manage their subscriptions, orders, referrals, and billing.
You have access to tools to look up real data. Always use tools to get current data before answering.
Be concise and helpful. Respond in the user's language.
Never expose sensitive data like API keys or internal IDs unless specifically asked by an admin.`,
    messages,
    tools: {
      getOrders: tool({
        description: 'Get user orders with optional status filter',
        inputSchema: z.object({ status: z.string().optional() }),
        execute: async ({ status }) => {
          const params = status ? `?status=${status}` : '';
          return apiCall(`/v1/orders/me${params}`, token);
        },
      }),
      getSubscriptions: tool({
        description: 'Get user subscriptions',
        inputSchema: z.object({}),
        execute: async () => apiCall('/v1/subscriptions/me', token),
      }),
      getEntitlements: tool({
        description: 'Get user entitlements/access',
        inputSchema: z.object({}),
        execute: async () => {
          const payload = JSON.parse(atob(token.split('.')[1]));
          return apiCall(`/v1/entitlements/${payload.sub}`, token);
        },
      }),
      getCatalog: tool({
        description: 'Get available products and prices',
        inputSchema: z.object({ serviceId: z.string().optional() }),
        execute: async ({ serviceId }) => {
          const params = serviceId ? `?serviceId=${serviceId}` : '';
          return apiCall(`/v1/catalog/products${params}`, token);
        },
      }),
      getReferralStats: tool({
        description: 'Get user referral/affiliate stats',
        inputSchema: z.object({}),
        execute: async () => apiCall('/v1/affiliates/me/stats', token),
      }),
      getAdminStats: tool({
        description: 'Get admin dashboard statistics (admin only)',
        inputSchema: z.object({}),
        execute: async () => apiCall('/v1/admin/stats', token),
      }),
      getAdminOrders: tool({
        description: 'Search orders as admin (admin only)',
        inputSchema: z.object({
          status: z.string().optional(),
          userId: z.string().optional(),
          page: z.number().optional(),
        }),
        execute: async ({ status, userId, page }) => {
          const params = new URLSearchParams();
          if (status) params.set('status', status);
          if (userId) params.set('userId', userId);
          if (page) params.set('page', String(page));
          return apiCall(`/v1/admin/orders?${params}`, token);
        },
      }),
      getFunnelMetrics: tool({
        description: 'Get conversion funnel metrics (admin only)',
        inputSchema: z.object({
          serviceId: z.string().optional(),
          days: z.number().optional().describe('Number of days to look back'),
        }),
        execute: async ({ serviceId, days }) => {
          const params = new URLSearchParams();
          if (serviceId) params.set('serviceId', serviceId);
          if (days) {
            const from = new Date(Date.now() - days * 86400000).toISOString();
            params.set('from', from);
          }
          return apiCall(`/v1/admin/funnel/metrics?${params}`, token);
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
