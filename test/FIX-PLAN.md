# E2E Test Fixes Required

## Проблема
Тесты падают с ошибкой `Foreign key constraint violated: orders_price_id_fkey` потому что:
1. Products/Prices создаются в `beforeAll`
2. Но `afterAll` удаляет их в конце всех тестов
3. А в `beforeEach` некоторых тестов создаются orders, которые ссылаются на уже удаленные prices

## Решение
Создавать product/price в `beforeEach` с уникальными кодами для тестов, которые создают orders:
- `payment-flow.e2e-spec.ts`
- `orders.e2e-spec.ts`
- `affiliates.e2e-spec.ts`
- `catalog.e2e-spec.ts`

## Тесты которые уже работают (7/29):
- ✅ webhooks.e2e-spec.ts (4 теста)
- ✅ checkout.e2e-spec.ts (некоторые)
- ✅ affiliates.e2e-spec.ts (некоторые)
