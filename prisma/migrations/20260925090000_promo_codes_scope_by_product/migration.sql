-- A promo code could be scoped to a service and to nothing finer.
--
-- `validatePromoCode` checked `price.product.serviceId !== promoCode.serviceId`
-- and stopped there, so every product a service sells shared one coupon space.
-- For inite.ai that is a $29 Atlas listing and a $149 monthly plan behind the
-- same service id: a code cut for the listing took half off the plan, and the
-- only place that could tell them apart was the caller's own code — which is
-- not a gate, because the checkout API is reachable with any buyer's token.
--
-- Product codes rather than ids: a person minting a coupon knows
-- `inite-atlas-premium`, and a uuid in an admin form is a transcription error
-- waiting to happen. Empty means every product of the service, which is what
-- every existing row means today.
ALTER TABLE "billing"."promo_codes"
  ADD COLUMN "product_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
