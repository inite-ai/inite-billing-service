# Changelog

## [1.3.0](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.2.0...inite-billing-service-v1.3.0) (2026-08-29)


### Features

* **admin:** make the admin a place to work — sorting, bulk, export, triage ([#127](https://github.com/inite-ai/inite-billing-service/issues/127)) ([d3d9f98](https://github.com/inite-ai/inite-billing-service/commit/d3d9f98e8f83a9915fd037c8eee914a556c66915))


### Bug Fixes

* **admin:** give the UI the states and semantics it was missing ([#125](https://github.com/inite-ai/inite-billing-service/issues/125)) ([91905fb](https://github.com/inite-ai/inite-billing-service/commit/91905fb2af7ccb2900a1ce05c756be92d7bbc196))
* **admin:** UX pass — stop the admin lying, let the operator find records, make destructive actions name their target ([#126](https://github.com/inite-ai/inite-billing-service/issues/126)) ([e713898](https://github.com/inite-ai/inite-billing-service/commit/e713898a7657e0a23d7694ecc01a5c0d8f12e0ff))
* **api:** validate every request body, and stop defaulting to INITE infrastructure ([#123](https://github.com/inite-ai/inite-billing-service/issues/123)) ([983031e](https://github.com/inite-ai/inite-billing-service/commit/983031e2c27c0b74c21c59f791c9af8f67f8ef28))
* **billing:** P1 — affiliate ledger integrity and the last cross-tenant reads ([#131](https://github.com/inite-ai/inite-billing-service/issues/131)) ([2c69750](https://github.com/inite-ai/inite-billing-service/commit/2c69750c0237a9fcfd00fa34e3b4ec061323cbd6))
* **billing:** P1 — lost webhooks, unrouted subscription events, unpinned issuer, cross-service reads ([#130](https://github.com/inite-ai/inite-billing-service/issues/130)) ([ed3f852](https://github.com/inite-ai/inite-billing-service/commit/ed3f852ff6a440a1b771f3813e0bf0996ef71601))
* **billing:** P2 — secrets, unenforced scopes, half-atomic writes, decimal money ([#133](https://github.com/inite-ai/inite-billing-service/issues/133)) ([573729e](https://github.com/inite-ai/inite-billing-service/commit/573729e999e7ff273a8ba1207d4b00bdec4603c6))
* **billing:** three P0 defects in the money path ([#129](https://github.com/inite-ai/inite-billing-service/issues/129)) ([9e79c7c](https://github.com/inite-ai/inite-billing-service/commit/9e79c7cffeeb1432dd7e64c55bdb35b8c3cdfb25))
* **build:** keep the compiled entrypoint at dist/main.js ([#119](https://github.com/inite-ai/inite-billing-service/issues/119)) ([5aea854](https://github.com/inite-ai/inite-billing-service/commit/5aea854f999bd2be817e3a32ecfaf2bfea3c12aa))
* **ci:** publish release image for component-prefixed tags ([#116](https://github.com/inite-ai/inite-billing-service/issues/116)) ([4842eca](https://github.com/inite-ai/inite-billing-service/commit/4842ecae77b8d3b459205c3a19cd8f0203cd40ee))
* **deploy:** pin the self-hosted jobs to the sfo runner ([#128](https://github.com/inite-ai/inite-billing-service/issues/128)) ([3f53241](https://github.com/inite-ai/inite-billing-service/commit/3f532417a423bbff3f60e10fbdad3c0b459200eb))
* **ops:** stop the deploy from guessing what production is running ([#132](https://github.com/inite-ai/inite-billing-service/issues/132)) ([dc7a2c4](https://github.com/inite-ai/inite-billing-service/commit/dc7a2c43e3a3864e453b7817ef22ffff5ace61a8))
* **test:** restore the e2e suite, gate CI on it, and close the gaps it was hiding ([#122](https://github.com/inite-ai/inite-billing-service/issues/122)) ([f1b15f1](https://github.com/inite-ai/inite-billing-service/commit/f1b15f1f7b4f58110fb1e2b66d54bf2f04833147))

## [1.2.0](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.1.3...inite-billing-service-v1.2.0) (2026-08-08)


### Features

* **connectors:** canonical rail identity + capability contract + auto-discovery registry ([#72](https://github.com/inite-ai/inite-billing-service/issues/72)) ([b7847f8](https://github.com/inite-ai/inite-billing-service/commit/b7847f8219df6ffd2e81cc6d91a0551097a415e4))
* **frontend:** MDX blog at /blog ([#61](https://github.com/inite-ai/inite-billing-service/issues/61)) ([c787b58](https://github.com/inite-ai/inite-billing-service/commit/c787b58d99753ea7f3ae108c2296caed15a4f3d6))
* **frontend:** MDX docs site at /docs (auth's pattern, Ledger theme) ([#58](https://github.com/inite-ai/inite-billing-service/issues/58)) ([a67f14f](https://github.com/inite-ai/inite-billing-service/commit/a67f14f709ff129c86019877a37c365f14134b56))
* **frontend:** SEO / OpenGraph / AEO / AI-visibility for the landing ([#57](https://github.com/inite-ai/inite-billing-service/issues/57)) ([566e444](https://github.com/inite-ai/inite-billing-service/commit/566e444caa60ba2ce55143cb286256d9ee173549))
* **frontend:** SOTA landing redesign + native RU/EN copy ([#56](https://github.com/inite-ai/inite-billing-service/issues/56)) ([ef1130b](https://github.com/inite-ai/inite-billing-service/commit/ef1130b162a0de1d3863170be3fac7782b18b0c0))


### Bug Fixes

* **admin:** validate promo-code & referral-level bodies with DTOs (P1) ([#102](https://github.com/inite-ai/inite-billing-service/issues/102)) ([8d16f9c](https://github.com/inite-ai/inite-billing-service/commit/8d16f9cc03475d40ae09179d8bb76ff36868eade))
* **affiliates:** reconcile payouts to prevent double-pay and lost balances ([#70](https://github.com/inite-ai/inite-billing-service/issues/70)) ([408a2d9](https://github.com/inite-ai/inite-billing-service/commit/408a2d91daf6f53442a77c73469e0c3813100830))
* AI-first landing rewrite + correct stale docs ([#53](https://github.com/inite-ai/inite-billing-service/issues/53)) ([88ab085](https://github.com/inite-ai/inite-billing-service/commit/88ab085a107cca5de4d57f37b189c146f08b2b4b))
* **apple-iap:** verify App Store notification JWS (CRITICAL — was presence-check only) ([#92](https://github.com/inite-ai/inite-billing-service/issues/92)) ([e0bcac7](https://github.com/inite-ai/inite-billing-service/commit/e0bcac731e5b2e400e3f51f5e10c2a2bd59e77d4))
* **auth:** pin JWT issuer and audience, opt-in (P2) ([#105](https://github.com/inite-ai/inite-billing-service/issues/105)) ([475ba51](https://github.com/inite-ai/inite-billing-service/commit/475ba51700d48462d3f679336bec7aa0d7a7b188))
* **billing:** wire refunds & cancellations to the provider (was DB-only) ([#73](https://github.com/inite-ai/inite-billing-service/issues/73)) ([5654e16](https://github.com/inite-ai/inite-billing-service/commit/5654e1667d92acadafc3be6a92a243758675785b))
* **checkout:** back idempotency with Redis (survives restart / multi-instance) ([#77](https://github.com/inite-ai/inite-billing-service/issues/77)) ([1650c17](https://github.com/inite-ai/inite-billing-service/commit/1650c17de6c548187df33345e9c920f8e1f04595))
* **checkout:** enforce one live payment intent per order at the DB level ([#91](https://github.com/inite-ai/inite-billing-service/issues/91)) ([f8ad686](https://github.com/inite-ai/inite-billing-service/commit/f8ad686f5ce4bbec70ee95daa9332f8f430775fc))
* **checkout:** reuse a live payment intent instead of double-charging ([#75](https://github.com/inite-ai/inite-billing-service/issues/75)) ([6cde841](https://github.com/inite-ai/inite-billing-service/commit/6cde8417ac979917d425567c355d4eceb8ac56d5))
* **credits:** grant/reset/refund inside the payment transaction ([#71](https://github.com/inite-ai/inite-billing-service/issues/71)) ([6a19b4c](https://github.com/inite-ai/inite-billing-service/commit/6a19b4ce602dfcb1dff5ac497db0cb8b5cbdb0b4))
* **credits:** row-lock the flat consume path (double-spend guard) ([#93](https://github.com/inite-ai/inite-billing-service/issues/93)) ([951affb](https://github.com/inite-ai/inite-billing-service/commit/951affb7138a87a297b72fabd74d471b97b58b5c))
* **credits:** scope service-to-service consume/adjust to the caller's own service (IDOR) ([#94](https://github.com/inite-ai/inite-billing-service/issues/94)) ([f91fa67](https://github.com/inite-ai/inite-billing-service/commit/f91fa672d37a8e258d435d76ea6ed64b7ecc8a59))
* **crypto:** resolve the invoice and validate the transfer before settling (HIGH) ([#96](https://github.com/inite-ai/inite-billing-service/issues/96)) ([856a623](https://github.com/inite-ai/inite-billing-service/commit/856a6236a08eed00a879401b89cbc625d02b6d49))
* **docker:** copy next.config.mjs (renamed from .js for MDX ESM config) ([#60](https://github.com/inite-ai/inite-billing-service/issues/60)) ([3e4eb9b](https://github.com/inite-ai/inite-billing-service/commit/3e4eb9b437a731712d7d72e3ab3a1b37af2022ef))
* **entitlements:** scope service-to-service reads to the caller's service (IDOR) ([#90](https://github.com/inite-ai/inite-billing-service/issues/90)) ([0c51cd1](https://github.com/inite-ai/inite-billing-service/commit/0c51cd1b96e88363e9bf9ffd9614f0cb0fee49c8))
* **frontend:** point landing docs links to /docs, add /blog links ([#63](https://github.com/inite-ai/inite-billing-service/issues/63)) ([ce59847](https://github.com/inite-ai/inite-billing-service/commit/ce59847d9d5f1ebfe0ac6d96df41ba3a0667dd67))
* **google-play:** verify one-time products instead of failing open to paid (HIGH) ([#95](https://github.com/inite-ai/inite-billing-service/issues/95)) ([6775c08](https://github.com/inite-ai/inite-billing-service/commit/6775c08663a20fab805b95393998523a571e2757))
* **orchestrator:** make webhook-driven renewals idempotent (P1) ([#101](https://github.com/inite-ai/inite-billing-service/issues/101)) ([22c3b58](https://github.com/inite-ai/inite-billing-service/commit/22c3b587c0003128b66464fc9b2c3367d0be8e1a))
* **outbox:** add producer so billing.* events are actually delivered ([#66](https://github.com/inite-ai/inite-billing-service/issues/66)) ([d328c87](https://github.com/inite-ai/inite-billing-service/commit/d328c87bb6bc4b6d40140649a48b4aec58ccb80e))
* **outbox:** sign deliveries (HMAC) + harden SSRF guard (P1) ([#100](https://github.com/inite-ai/inite-billing-service/issues/100)) ([7739a15](https://github.com/inite-ai/inite-billing-service/commit/7739a15d4c63e5d3937871948a3b53e7cf8572a9))
* **outreach:** derive test-email CTA from FRONTEND_URL (was hardcoded) ([#111](https://github.com/inite-ai/inite-billing-service/issues/111)) ([94c0c68](https://github.com/inite-ai/inite-billing-service/commit/94c0c6815424794a6e8cb5aa6f0818b7b7e91ffd))
* **schedulers:** distributed lock around cron sweeps (P2) ([#108](https://github.com/inite-ai/inite-billing-service/issues/108)) ([9a4f2c3](https://github.com/inite-ai/inite-billing-service/commit/9a4f2c369e01d7eb137dc970b484a4455866f6b4))
* **subscriptions:** compute period end in UTC with month-end clamp ([#103](https://github.com/inite-ai/inite-billing-service/issues/103)) ([a0c9566](https://github.com/inite-ai/inite-billing-service/commit/a0c9566ab7313b33bdf7f989251af7b316f5ab0c))
* **subscriptions:** resolve Apple/Google subscription linkage (renewals/cancels) ([#69](https://github.com/inite-ai/inite-billing-service/issues/69)) ([e13aae4](https://github.com/inite-ai/inite-billing-service/commit/e13aae45b8c880c088d4db74f537a21a756fe221))
* **webhooks:** fail closed when a provider's verification secret is unconfigured ([#68](https://github.com/inite-ai/inite-billing-service/issues/68)) ([963a01d](https://github.com/inite-ai/inite-billing-service/commit/963a01dc9cb2c6c8b4511040aa7b40e7317fb958))
* **webhooks:** reconcile paid amount in normalized units (P1 — was a no-op) ([#99](https://github.com/inite-ai/inite-billing-service/issues/99)) ([ff1aa47](https://github.com/inite-ai/inite-billing-service/commit/ff1aa47c16174879de7701270ad94314e031517c))
* **webhooks:** verify signatures over raw request bytes, not re-serialized JSON ([#67](https://github.com/inite-ai/inite-billing-service/issues/67)) ([b912f73](https://github.com/inite-ai/inite-billing-service/commit/b912f73c103b440eaaa23d7f483093f63af93373))


### Performance Improvements

* **affiliates:** qualification out of the fulfilment tx + cycle-safe downline (P2) ([#106](https://github.com/inite-ai/inite-billing-service/issues/106)) ([d27bbcc](https://github.com/inite-ai/inite-billing-service/commit/d27bbcccd81ffda44aaf02cf346589778ac350f6))
* **funnel:** bound abandoned-checkout sweep, drop N+1 (P2) ([#107](https://github.com/inite-ai/inite-billing-service/issues/107)) ([e0d0434](https://github.com/inite-ai/inite-billing-service/commit/e0d0434fea65da1ab5b8e66e1fa12e37e116ac2c))

## [1.1.3](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.1.2...inite-billing-service-v1.1.3) (2026-07-19)


### Bug Fixes

* **security:** resolve code-scanning alerts (open-redirect, unused vars, RNG) ([#40](https://github.com/inite-ai/inite-billing-service/issues/40)) ([59b0af1](https://github.com/inite-ai/inite-billing-service/commit/59b0af12927328f742f4af850e31f7e7bd0a23b9))

## [1.1.2](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.1.1...inite-billing-service-v1.1.2) (2026-07-18)


### Bug Fixes

* **ci:** don't tag :latest from release-image (it rolled prod backwards) ([#37](https://github.com/inite-ai/inite-billing-service/issues/37)) ([9580f27](https://github.com/inite-ai/inite-billing-service/commit/9580f27966e67438e7de40b97f1375c4850ee503))
* **prisma:** stop gitignoring migrations so the image can migrate prod ([#35](https://github.com/inite-ai/inite-billing-service/issues/35)) ([bddcbf5](https://github.com/inite-ai/inite-billing-service/commit/bddcbf5cbddc77fec2fdbda02320e123df72f74d))

## [1.1.1](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.1.0...inite-billing-service-v1.1.1) (2026-07-18)


### Bug Fixes

* **deps:** resolve security advisories via npm audit fix (lockfiles) ([#27](https://github.com/inite-ai/inite-billing-service/issues/27)) ([f517c2f](https://github.com/inite-ai/inite-billing-service/commit/f517c2f9269500f202b4530b399b73b6a7c8ff24))
* **deps:** upgrade NestJS 10→11 + anthropic-sdk 0.112 (security) ([#33](https://github.com/inite-ai/inite-billing-service/issues/33)) ([33b8fb8](https://github.com/inite-ai/inite-billing-service/commit/33b8fb8688b76d6f28a9d0c5016e0bbb92dec276))

## [1.1.0](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.0.0...inite-billing-service-v1.1.0) (2026-07-18)


### Features

* AI-first buildout, org-standard repo hygiene and docs ([#2](https://github.com/inite-ai/inite-billing-service/issues/2)) ([fd94a1f](https://github.com/inite-ai/inite-billing-service/commit/fd94a1ffd95bf41fe8fbadae57e002d7fd838d9d))


### Bug Fixes

* remove API_DOMAIN, backend is on same domain via path prefix ([4d8a6b3](https://github.com/inite-ai/inite-billing-service/commit/4d8a6b339f3708d8e6102d40dbcdc380c2236a0c))

## Changelog

All notable changes to this project are documented here. Format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/). Entries are generated
by [release-please](https://github.com/googleapis/release-please) from
Conventional Commit messages.
