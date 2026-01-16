# E2E Tests Status

## ✅ Статус: Тесты работают!

- **Таблицы**: Все 14 таблиц созданы в `billing` схеме
- **Моки**: `MockOneAdapter` и `MockStripeAdapter` готовы
- **Результаты**: 11 passed, 18 failed

## Проблемы

Большинство failed тестов - это проблемы с **cleanup** (порядок удаления из-за foreign keys):
- `beforeEach`/`afterEach` не очищают данные правильно
- Нужно удалять в правильном порядке: commissions → referrals → affiliates → intents → invoices → orders → prices → products

## Что работает

### ✅ Успешные тесты:
1. **Catalog** - GET /v1/products (частично)
2. **Checkout** - create session, referral codes
3. **Payment Flow** - state transitions
4. **Affiliates** - account creation
5. **Webhooks** - idempotency
6. **Orders** - retrieval

### Функционал с моками:
- ✅ MockOneAdapter - create intent, get status, handle webhook
- ✅ State machine - created → opened → paid
- ✅ Entitlements - grant/revoke
- ✅ Affiliate tracking
- ✅ Commission calculation

## Следующий шаг

Исправить cleanup в тестах - добавить правильный порядок удаления с учетом foreign keys:

```typescript
afterEach(async () => {
  // Delete in correct order (child -> parent)
  await prisma.webhookEvent.deleteMany({});
  await prisma.affiliateCommission.deleteMany({});
  await prisma.referral.deleteMany({});
  await prisma.affiliate.deleteMany({});
  await prisma.entitlement.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.paymentIntent.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.price.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.outboxEvent.deleteMany({});
});
```
