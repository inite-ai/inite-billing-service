-- Data fix for promo-funded subscriptions stuck with currentPeriodEnd in the
-- past. Pre-dates the expiry-cron landing; once the cron is live this script
-- is no longer needed.
--
-- Selects only subs where:
--   * status is currently active or trialing
--   * currentPeriodEnd has already passed
--   * providerSubscriptionId is NULL (no provider can ever auto-renew)
--   * the original order paid through rail = 'PROMO'
--
-- For each match:
--   1. Subscription.status -> 'ended'
--   2. Entitlements whose value->>'subscription_id' = sub.id and source = 'subscription' and status = 'active' -> 'revoked'
--
-- Run in a transaction so you can ROLLBACK if the selection is wrong.

BEGIN;

-- Step 1: Preview what will be touched. Inspect this first.
SELECT s.id AS subscription_id,
       s.user_id,
       s.status,
       s.current_period_end,
       s.rail,
       s.provider_subscription_id,
       pr.code AS price_code,
       p.code AS product_code
FROM billing.subscriptions s
JOIN billing.prices pr ON pr.id = s.price_id
JOIN billing.products p ON p.id = pr.product_id
WHERE s.status IN ('active', 'trialing')
  AND s.current_period_end < now()
  AND s.provider_subscription_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM billing.orders o
    JOIN billing.payment_intents pi ON pi.order_id = o.id
    WHERE o.user_id = s.user_id
      AND o.price_id = s.price_id
      AND pi.rail = 'PROMO'
      AND pi.status = 'paid'
  );

-- Step 2: Apply — only run after the preview above is the intended set.
WITH targets AS (
  SELECT s.id
  FROM billing.subscriptions s
  WHERE s.status IN ('active', 'trialing')
    AND s.current_period_end < now()
    AND s.provider_subscription_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM billing.orders o
      JOIN billing.payment_intents pi ON pi.order_id = o.id
      WHERE o.user_id = s.user_id
        AND o.price_id = s.price_id
        AND pi.rail = 'PROMO'
        AND pi.status = 'paid'
    )
)
UPDATE billing.subscriptions
SET status = 'ended',
    updated_at = now()
WHERE id IN (SELECT id FROM targets);

WITH targets AS (
  SELECT s.id
  FROM billing.subscriptions s
  WHERE s.status = 'ended'
    AND s.current_period_end < now()
    AND s.provider_subscription_id IS NULL
)
UPDATE billing.entitlements e
SET status = 'revoked',
    updated_at = now()
WHERE e.source = 'subscription'
  AND e.status = 'active'
  AND (e.value->>'subscription_id') IN (SELECT id::text FROM targets);

-- Inspect counts before commit
SELECT COUNT(*) AS subs_ended FROM billing.subscriptions
WHERE status = 'ended' AND updated_at > now() - interval '1 minute';

SELECT COUNT(*) AS entitlements_revoked FROM billing.entitlements
WHERE status = 'revoked' AND updated_at > now() - interval '1 minute';

-- If the counts look right:
-- COMMIT;
-- Otherwise:
-- ROLLBACK;
