export interface Service {
  id: string
  code: string
  name: string
  apiKey: string
  isActive: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  code: string
  name: string
  serviceId?: string
  moduleScope: string
  type: 'subscription' | 'one_time' | 'usage'
  isActive: boolean
  metadata?: Record<string, unknown>
  prices?: Price[]
  service?: Service
}

export interface Price {
  id: string
  productId: string
  code: string
  currency: string
  amount: string
  interval?: string
  trialDays?: number
  graceDays?: number
  isActive: boolean
  product?: Product
}

export interface Order {
  id: string
  userId: string
  priceId: string
  mode: 'PAYMENT' | 'SUBSCRIPTION'
  status: 'created' | 'open' | 'paid' | 'failed' | 'refunded' | 'expired'
  amount: string
  currency: string
  externalId?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  price?: Price
  paymentIntents?: PaymentIntent[]
}

export interface PaymentIntent {
  id: string
  orderId: string
  rail: string
  status: string
  checkoutUrl?: string
  method?: string
  amount: string
  currency: string
  expiresAt?: string
  createdAt: string
}

export interface Subscription {
  id: string
  userId: string
  priceId: string
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'ended'
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
  price?: Price
}

export interface Entitlement {
  id: string
  userId: string
  key: string
  status: 'active' | 'revoked' | 'expired'
  value?: Record<string, unknown>
  source: 'subscription' | 'order' | 'admin'
  startsAt?: string
  expiresAt?: string
  createdAt: string
}

export interface Affiliate {
  id: string
  userId: string
  referralCode: string
  status: 'active' | 'inactive' | 'suspended'
  commissionRate: string
  totalEarned: string
  totalPaid: string
  referralUrl: string
  createdAt: string
}

export interface Referral {
  id: string
  referredUserId: string
  firstOrderPaid: boolean
  firstOrderId?: string
  createdAt: string
}

export interface Commission {
  id: string
  orderId: string
  level: number
  amount: string
  commissionRate: string
  currency: string
  status: 'pending' | 'earned' | 'paid' | 'voided'
  earnedAt?: string
  createdAt: string
}

export interface Payout {
  id: string
  periodStart: string
  periodEnd: string
  totalAmount: string
  currency: string
  status: 'pending' | 'processing' | 'paid' | 'failed'
  payoutDate?: string
  createdAt: string
}

export interface AffiliateStats {
  totalReferrals: number
  totalCommissions: string
  pendingCommissions: string
  paidCommissions: string
  upcomingPayout?: Payout
}

export interface QualificationCriteria {
  minDirectReferrals?: number
  minActiveReferrals?: number
  minPersonalOrders?: number
  minMonthlyVolume?: number
  personalPurchaseRequired?: boolean
}

export interface ReferralLevel {
  id: string
  serviceId: string
  level: number
  commissionRate: string
  name: string
  isActive: boolean
  qualificationCriteria?: QualificationCriteria
  service?: Service
}

export interface AffiliateTreeNode extends Affiliate {
  totalReferrals: number
  children: AffiliateTreeNode[]
}

export interface PromoCode {
  id: string
  code: string
  name: string
  description?: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  serviceId?: string
  minPurchaseAmount?: string
  maxDiscountAmount?: string
  validFrom: string
  validUntil?: string
  isActive: boolean
  maxUsageCount?: number
  currentUsageCount: number
  maxUsagePerUser?: number
  stackWithReferral: boolean
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface AdminStats {
  totalOrders: number
  paidOrders: number
  totalRevenue: string
  activeSubscriptions: number
  totalAffiliates: number
  totalCommissions: string
}

export interface PaymentProvider {
  id: string
  code: string
  name: string
  isActive: boolean
  supportedModes: string[]
  currencies: string[]
  countries: string[]
  webhookUrl?: string
  config?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreditBalance {
  id: string
  userId: string
  serviceId?: string
  balance: number
  totalGranted: number
  totalUsed: number
  resetsAt?: string
  createdAt: string
  updatedAt: string
  service?: Service
}

export interface CreditUsage {
  id: string
  creditBalanceId: string
  userId: string
  amount: number
  type: 'grant' | 'consume' | 'reset' | 'refund' | 'admin_adjust'
  description?: string
  orderId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface WebhookEvent {
  id: string
  rail: string
  webhookId: string
  eventType: string
  entityId: string
  payload: Record<string, unknown>
  receivedAt: string
  processedAt?: string
  status: string
  attempts: number
  lastError?: string
}
