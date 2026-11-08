import { DEMO_SUBSCRIBER } from '../../src/common/demo-tenant';

/**
 * «Atlântica Group (demo)» as a billing customer: the fixtures behind the
 * family demo's billing dashboard (Ana, Bruno and Carla all see these).
 *
 * Atlântica is a made-up property and hospitality group in São Paulo with an
 * office in Lisbon. It pays INITE for three products: the Solutions Portal
 * (its client portal and WhatsApp desk), Food Pro for its restaurants, and a
 * Club team seat billed from Lisbon in euros; it bought one credit pack.
 *
 * Every row has a fixed id, so the seed upserts and never duplicates, and
 * belongs to `org:<DEMO_ORG_ID>`, so a demo session reads it and nothing
 * else does. The catalogue rows (services, products, prices) are inactive and
 * marked `demo: true`: never listed in the catalogue, never sold (checkout
 * refuses an inactive product), no webhook URL to deliver to. Dates are
 * relative to the run, so a re-run keeps the demo current.
 *
 * Amounts are strings (Decimal(19,4) in the schema), credits integers.
 */

const DAY = 86_400_000;

/** `a7a71c00-de00-4000-8<kk>-<nnnnnnnnnnnn>`: the demo tenant's id space. */
export function demoId(kind: number, n: number): string {
  const k = kind.toString(16).padStart(3, '0');
  return `a7a71c00-de00-4000-8${k}-${n.toString(16).padStart(12, '0')}`;
}

export const KIND = {
  service: 0x101,
  product: 0x102,
  price: 0x103,
  subscription: 0x104,
  order: 0x105,
  invoice: 0x106,
  entitlement: 0x107,
  balance: 0x108,
  usage: 0x109,
} as const;

/** The marker every demo catalogue row and fixture carries in `metadata`. */
export const DEMO_MARK = { demo: true, tenant: 'atlantica' } as const;

export interface DemoService {
  id: string;
  code: string;
  name: string;
  displayName: string;
}
export interface DemoProduct {
  id: string;
  code: string;
  name: string;
  serviceCode: string;
  moduleScope: string;
  type: 'subscription' | 'one_time';
  metadata: Record<string, unknown>;
}
export interface DemoPrice {
  id: string;
  code: string;
  productCode: string;
  currency: string;
  amount: string;
  interval: 'month' | 'none';
  trialDays: number;
}
export interface DemoSubscription {
  id: string;
  priceCode: string;
  status: 'active' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
}
export interface DemoOrder {
  id: string;
  priceCode: string;
  mode: 'SUBSCRIPTION' | 'PAYMENT';
  status: 'paid' | 'refunded';
  amount: string;
  currency: string;
  createdAt: Date;
  invoiceId: string;
  invoiceStatus: 'paid' | 'refunded';
  note: string;
}
export interface DemoEntitlement {
  id: string;
  key: string;
  subscriptionId: string;
  startsAt: Date;
  expiresAt: Date;
}
export interface DemoBalance {
  id: string;
  serviceCode: string;
  balance: number;
  totalGranted: number;
  totalUsed: number;
  resetsAt: Date;
}
export interface DemoUsage {
  id: string;
  balanceId: string;
  amount: number;
  type: 'grant' | 'consume';
  description: string;
  featureCode: string | null;
  units: number | null;
  orderId: string | null;
  createdAt: Date;
}
export interface DemoFixtures {
  subscriber: string;
  services: DemoService[];
  products: DemoProduct[];
  prices: DemoPrice[];
  subscriptions: DemoSubscription[];
  orders: DemoOrder[];
  entitlements: DemoEntitlement[];
  balances: DemoBalance[];
  usages: DemoUsage[];
}

const SERVICES: DemoService[] = [
  {
    id: demoId(KIND.service, 1),
    code: 'demo-atlantica-solutions',
    name: 'INITE Solutions (demo)',
    displayName: 'INITE Solutions',
  },
  {
    id: demoId(KIND.service, 2),
    code: 'demo-atlantica-food',
    name: 'INITE Food (demo)',
    displayName: 'INITE Food',
  },
  {
    id: demoId(KIND.service, 3),
    code: 'demo-atlantica-club',
    name: 'INITE Club (demo)',
    displayName: 'INITE Club',
  },
];

const PRODUCTS: DemoProduct[] = [
  {
    id: demoId(KIND.product, 1),
    code: 'demo-atlantica-portal',
    name: 'Portal',
    serviceCode: 'demo-atlantica-solutions',
    moduleScope: 'solutions',
    type: 'subscription',
    metadata: {
      ...DEMO_MARK,
      description: 'Client portal, WhatsApp desk and lead briefs for a sales team',
      features: ['Client portal', 'WhatsApp desk', 'Lead briefs', '2 000 credits a month'],
      entitlements: ['solutions.portal'],
      creditsPerPeriod: 2000,
      i18n: {
        ru: { description: 'Кабинет клиента, WhatsApp и сводки по заявкам для отдела продаж' },
        pt: {
          description:
            'Portal do cliente, central de WhatsApp e resumos de leads para a equipe de vendas',
        },
        es: {
          description:
            'Portal del cliente, central de WhatsApp y resúmenes de leads para el equipo de ventas',
        },
      },
    },
  },
  {
    id: demoId(KIND.product, 2),
    code: 'demo-atlantica-food-pro',
    name: 'Food Pro',
    serviceCode: 'demo-atlantica-food',
    moduleScope: 'food',
    type: 'subscription',
    metadata: {
      ...DEMO_MARK,
      description: 'Menus, orders and the kitchen screen for up to five restaurants',
      features: ['Five restaurants', 'Online menu', 'Kitchen screen'],
      entitlements: ['food.pro'],
      i18n: {
        ru: { description: 'Меню, заказы и экран кухни для пяти ресторанов' },
        pt: { description: 'Cardápios, pedidos e a tela da cozinha para até cinco restaurantes' },
        es: { description: 'Menús, pedidos y la pantalla de cocina para hasta cinco restaurantes' },
      },
    },
  },
  {
    id: demoId(KIND.product, 3),
    code: 'demo-atlantica-club-team',
    name: 'Club Team',
    serviceCode: 'demo-atlantica-club',
    moduleScope: 'club',
    type: 'subscription',
    metadata: {
      ...DEMO_MARK,
      description: 'Three seats in the INITE Club expert network',
      features: ['Three seats', 'Expert questions'],
      entitlements: ['club.team'],
      i18n: {
        ru: { description: 'Три места в сети экспертов INITE Club' },
        pt: { description: 'Três lugares na rede de especialistas INITE Club' },
        es: { description: 'Tres plazas en la red de expertos INITE Club' },
      },
    },
  },
  {
    id: demoId(KIND.product, 4),
    code: 'demo-atlantica-credits-5000',
    name: 'Credit pack 5 000',
    serviceCode: 'demo-atlantica-solutions',
    moduleScope: 'solutions',
    type: 'one_time',
    metadata: {
      ...DEMO_MARK,
      description: '5 000 Solutions credits',
      credits: 5000,
      i18n: {
        ru: { name: 'Пакет 5 000 кредитов', description: '5 000 кредитов Solutions' },
        pt: { name: 'Pacote de 5 000 créditos', description: '5 000 créditos do Solutions' },
        es: { name: 'Paquete de 5 000 créditos', description: '5 000 créditos de Solutions' },
      },
    },
  },
];

const PRICES: DemoPrice[] = [
  {
    id: demoId(KIND.price, 1),
    code: 'demo-atlantica-portal-monthly',
    productCode: 'demo-atlantica-portal',
    currency: 'BRL',
    amount: '1490.0000',
    interval: 'month',
    trialDays: 0,
  },
  {
    id: demoId(KIND.price, 2),
    code: 'demo-atlantica-food-pro-monthly',
    productCode: 'demo-atlantica-food-pro',
    currency: 'BRL',
    amount: '349.0000',
    interval: 'month',
    trialDays: 14,
  },
  {
    id: demoId(KIND.price, 3),
    code: 'demo-atlantica-club-team-monthly',
    productCode: 'demo-atlantica-club-team',
    currency: 'EUR',
    amount: '49.0000',
    interval: 'month',
    trialDays: 0,
  },
  {
    id: demoId(KIND.price, 4),
    code: 'demo-atlantica-credits-5000',
    productCode: 'demo-atlantica-credits-5000',
    currency: 'BRL',
    amount: '290.0000',
    interval: 'none',
    trialDays: 0,
  },
];

/** What the usage ledger shows: Solutions credits spent on these, over the period. */
const USAGE_PLAN: Array<{
  featureCode: string;
  description: string;
  units: number;
  credits: number;
}> = [
  {
    featureCode: 'whatsapp.reply',
    description: 'WhatsApp replies, Jardins office',
    units: 140,
    credits: 280,
  },
  {
    featureCode: 'lead.brief',
    description: 'Lead briefs for the sales team',
    units: 18,
    credits: 360,
  },
  {
    featureCode: 'whatsapp.reply',
    description: 'WhatsApp replies, Lisbon office',
    units: 95,
    credits: 190,
  },
  { featureCode: 'call.summary', description: 'Call summaries', units: 22, credits: 330 },
  {
    featureCode: 'whatsapp.reply',
    description: 'WhatsApp replies, Jardins office',
    units: 210,
    credits: 420,
  },
  {
    featureCode: 'lead.brief',
    description: 'Lead briefs for the sales team',
    units: 25,
    credits: 500,
  },
  { featureCode: 'portal.report', description: 'Monthly owner reports', units: 12, credits: 240 },
  { featureCode: 'call.summary', description: 'Call summaries', units: 30, credits: 450 },
  {
    featureCode: 'whatsapp.reply',
    description: 'WhatsApp replies, Lisbon office',
    units: 160,
    credits: 320,
  },
  {
    featureCode: 'lead.brief',
    description: 'Lead briefs for the sales team',
    units: 19,
    credits: 380,
  },
  {
    featureCode: 'whatsapp.reply',
    description: 'WhatsApp replies, Jardins office',
    units: 205,
    credits: 410,
  },
];

function price(code: string): DemoPrice {
  const p = PRICES.find((x) => x.code === code);
  if (!p) throw new Error(`unknown demo price ${code}`);
  return p;
}

/** The demo tenant's billing, as of `now`. Pure: the same `now` gives the same rows. */
export function buildDemoFixtures(now: Date = new Date()): DemoFixtures {
  const t = now.getTime();
  const at = (days: number) => new Date(t + days * DAY);

  const portal = demoId(KIND.subscription, 1);
  const food = demoId(KIND.subscription, 2);
  const club = demoId(KIND.subscription, 3);

  const subscriptions: DemoSubscription[] = [
    {
      id: portal,
      priceCode: 'demo-atlantica-portal-monthly',
      status: 'active',
      currentPeriodStart: at(-12),
      currentPeriodEnd: at(18),
      cancelAtPeriodEnd: false,
      createdAt: at(-72),
    },
    {
      id: food,
      priceCode: 'demo-atlantica-food-pro-monthly',
      status: 'trialing',
      currentPeriodStart: at(-4),
      currentPeriodEnd: at(10),
      cancelAtPeriodEnd: false,
      createdAt: at(-4),
    },
    {
      id: club,
      priceCode: 'demo-atlantica-club-team-monthly',
      status: 'active',
      currentPeriodStart: at(-5),
      currentPeriodEnd: at(25),
      cancelAtPeriodEnd: true,
      createdAt: at(-35),
    },
  ];

  const order = (
    n: number,
    priceCode: string,
    daysAgo: number,
    note: string,
    status: 'paid' | 'refunded' = 'paid',
  ): DemoOrder => {
    const p = price(priceCode);
    return {
      id: demoId(KIND.order, n),
      priceCode,
      mode: p.interval === 'month' ? 'SUBSCRIPTION' : 'PAYMENT',
      status,
      amount: p.amount,
      currency: p.currency,
      createdAt: at(-daysAgo),
      invoiceId: demoId(KIND.invoice, n),
      invoiceStatus: status,
      note,
    };
  };

  const orders: DemoOrder[] = [
    order(1, 'demo-atlantica-portal-monthly', 72, 'Portal, first month'),
    order(2, 'demo-atlantica-portal-monthly', 42, 'Portal, second month'),
    order(3, 'demo-atlantica-portal-monthly', 12, 'Portal, third month'),
    order(4, 'demo-atlantica-credits-5000', 30, 'Credit pack for the sales season'),
    order(5, 'demo-atlantica-club-team-monthly', 35, 'Club Team, first month'),
    order(6, 'demo-atlantica-club-team-monthly', 5, 'Club Team, second month'),
    order(7, 'demo-atlantica-credits-5000', 29, 'Credit pack bought twice, refunded', 'refunded'),
  ];

  const entitlements: DemoEntitlement[] = [
    {
      id: demoId(KIND.entitlement, 1),
      key: 'solutions.portal',
      subscriptionId: portal,
      startsAt: at(-72),
      expiresAt: at(18),
    },
    {
      id: demoId(KIND.entitlement, 2),
      key: 'food.pro',
      subscriptionId: food,
      startsAt: at(-4),
      expiresAt: at(10),
    },
    {
      id: demoId(KIND.entitlement, 3),
      key: 'club.team',
      subscriptionId: club,
      startsAt: at(-35),
      expiresAt: at(25),
    },
  ];

  const balanceId = demoId(KIND.balance, 1);
  const usages: DemoUsage[] = [
    {
      id: demoId(KIND.usage, 1),
      balanceId,
      amount: 5000,
      type: 'grant',
      description: 'Credit pack 5 000',
      featureCode: null,
      units: null,
      orderId: demoId(KIND.order, 4),
      createdAt: at(-30),
    },
    {
      id: demoId(KIND.usage, 2),
      balanceId,
      amount: 2000,
      type: 'grant',
      description: 'Portal, credits of the period',
      featureCode: null,
      units: null,
      orderId: demoId(KIND.order, 3),
      createdAt: at(-12),
    },
    ...USAGE_PLAN.map((u, i) => ({
      id: demoId(KIND.usage, 3 + i),
      balanceId,
      amount: -u.credits,
      type: 'consume' as const,
      description: u.description,
      featureCode: u.featureCode,
      units: u.units,
      orderId: null,
      // Spread over the last eleven days, oldest first.
      createdAt: new Date(t - (USAGE_PLAN.length - i) * DAY + 9 * 3_600_000),
    })),
  ];

  const granted = usages.filter((u) => u.type === 'grant').reduce((s, u) => s + u.amount, 0);
  const used = usages.filter((u) => u.type === 'consume').reduce((s, u) => s - u.amount, 0);

  const balances: DemoBalance[] = [
    {
      id: balanceId,
      serviceCode: 'demo-atlantica-solutions',
      balance: granted - used,
      totalGranted: granted,
      totalUsed: used,
      resetsAt: at(18),
    },
  ];

  return {
    subscriber: DEMO_SUBSCRIBER,
    services: SERVICES,
    products: PRODUCTS,
    prices: PRICES,
    subscriptions,
    orders,
    entitlements,
    balances,
    usages,
  };
}
