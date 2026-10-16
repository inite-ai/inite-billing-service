# Changelog

## [1.4.0](https://github.com/inite-ai/inite-billing-service/compare/inite-billing-service-v1.3.0...inite-billing-service-v1.4.0) (2026-10-16)


### Features

* **adapters:** PIX in reais through Hodle ([#184](https://github.com/inite-ai/inite-billing-service/issues/184)) ([220fc40](https://github.com/inite-ai/inite-billing-service/commit/220fc40bf38917bd3bc29309536942168fd8f22d))
* **auth:** sign in silently when INITE already knows the person ([#172](https://github.com/inite-ai/inite-billing-service/issues/172)) ([ede2598](https://github.com/inite-ai/inite-billing-service/commit/ede25984b885ee7deb0eb65aafaa24a620b41e26))
* **catalog:** products sold per item — one price, the key names the unit ([#220](https://github.com/inite-ai/inite-billing-service/issues/220)) ([160a0ee](https://github.com/inite-ai/inite-billing-service/commit/160a0ee10ccad603f2f7c8a237e7caea564bb5e3))
* **catalog:** public price list in the Ledger look, priced in one currency ([#169](https://github.com/inite-ai/inite-billing-service/issues/169)) ([781f3c1](https://github.com/inite-ai/inite-billing-service/commit/781f3c10de2b7f6ee43fde546824c410c9f9417f))
* **checkout:** the hosted checkout page opens in the buyer's language ([#192](https://github.com/inite-ai/inite-billing-service/issues/192)) ([beb54f3](https://github.com/inite-ai/inite-billing-service/commit/beb54f3e3fdf9db43b3a76a7ed69c5e6aa20e6ff))
* **checkout:** the store's checkout link pays without a billing sign-in ([#202](https://github.com/inite-ai/inite-billing-service/issues/202)) ([a5bcceb](https://github.com/inite-ai/inite-billing-service/commit/a5bccebaf7b17adcfb0d8cc7dc29a36b20fc996b))
* **checkout:** token and network icons for crypto and payment methods ([#167](https://github.com/inite-ai/inite-billing-service/issues/167)) ([1b80157](https://github.com/inite-ai/inite-billing-service/commit/1b80157eea2a353b0f1d8fdd57f72e8826cb0d8a))
* **crypto:** convert prices in any currency into stablecoins ([#161](https://github.com/inite-ai/inite-billing-service/issues/161)) ([6805481](https://github.com/inite-ai/inite-billing-service/commit/68054819d9b4372693d14d625c50d8b52ad53a73))
* **crypto:** make stablecoin payments actually settle ([#160](https://github.com/inite-ai/inite-billing-service/issues/160)) ([50944d5](https://github.com/inite-ai/inite-billing-service/commit/50944d5e1ae91d0b7b37ed489828d6819783643e))
* **crypto:** seven EVM networks from one 0x wallet ([#166](https://github.com/inite-ai/inite-billing-service/issues/166)) ([94cbc04](https://github.com/inite-ai/inite-billing-service/commit/94cbc0480f060a4776a867e598c7bf9205a21431))
* **crypto:** x402 — agents pay checkout sessions with signed USDC on Base ([#207](https://github.com/inite-ai/inite-billing-service/issues/207)) ([70747c9](https://github.com/inite-ai/inite-billing-service/commit/70747c9aedbd5de8c42e685410acbf7288705648))
* **crypto:** x402 relayer key made by billing, set up from the admin — nothing in env ([#210](https://github.com/inite-ai/inite-billing-service/issues/210)) ([012a35b](https://github.com/inite-ai/inite-billing-service/commit/012a35bb28d017a750e5d93dd6807a979225e43f))
* **docker:** release images for linux/arm64 ([#227](https://github.com/inite-ai/inite-billing-service/issues/227)) ([65e356f](https://github.com/inite-ai/inite-billing-service/commit/65e356f89d693e79938975fe4a2ad3403f707679))
* **frontend:** a privacy policy for the hosted service, at /privacy ([#230](https://github.com/inite-ai/inite-billing-service/issues/230)) ([125981f](https://github.com/inite-ai/inite-billing-service/commit/125981fd8e3a5c57808158d7aeda1462a83e25d4))
* **frontend:** Ledger across the cabinet and the admin; cabinet UX fixes ([#170](https://github.com/inite-ai/inite-billing-service/issues/170)) ([c133043](https://github.com/inite-ai/inite-billing-service/commit/c133043b835e51aadf725091f7d48fa6d146a62f))
* **frontend:** sign-in, callback, checkout and unsubscribe in the Ledger look ([#168](https://github.com/inite-ai/inite-billing-service/issues/168)) ([daf1b4b](https://github.com/inite-ai/inite-billing-service/commit/daf1b4bb1de2fa4798b9dd3a6d8c3e4c88e9a787))
* **hodle:** one secret per webhook; accepted Pix contestations refund ([#189](https://github.com/inite-ai/inite-billing-service/issues/189)) ([3204f47](https://github.com/inite-ai/inite-billing-service/commit/3204f4764acbb72b52c1a201ebce4109da84a075))
* **i18n:** the INITE sign-in opens in the checkout's language ([#195](https://github.com/inite-ai/inite-billing-service/issues/195)) ([7fa29c1](https://github.com/inite-ai/inite-billing-service/commit/7fa29c1bc49f8ac226c1081041401f1e8c38a85e))
* **lava:** charge ticked currencies by card, converted to USD ([#190](https://github.com/inite-ai/inite-billing-service/issues/190)) ([c0b2083](https://github.com/inite-ai/inite-billing-service/commit/c0b2083cea715c06aa1356c03306c5b4c6259ddc))
* **lava:** settle without a webhook; pay in a window over the checkout ([#163](https://github.com/inite-ai/inite-billing-service/issues/163)) ([5657a74](https://github.com/inite-ai/inite-billing-service/commit/5657a7400b0a3e1bcd576929d1e11fcd53783a4a))
* **mcp:** a person's client can sign in to billing — OAuth discovery, billing:account, no charging tool ([#225](https://github.com/inite-ai/inite-billing-service/issues/225)) ([255ed3b](https://github.com/inite-ai/inite-billing-service/commit/255ed3ba8f71480f002a6efa20d29af3a5a5b1ad))
* **mcp:** admin view of the gateway, docs for both MCP surfaces ([#159](https://github.com/inite-ai/inite-billing-service/issues/159)) ([952552d](https://github.com/inite-ai/inite-billing-service/commit/952552da1b491e3571bc4819dcfcf2b5d77ddd37))
* **mcp:** bill other people's MCP servers through this one ([#157](https://github.com/inite-ai/inite-billing-service/issues/157)) ([9b53861](https://github.com/inite-ai/inite-billing-service/commit/9b538619b9f8f7f5ffe9f2813fab031d3a805bba))
* **mcp:** speak MCP, over HTTP and over stdio, from one set of tools ([#145](https://github.com/inite-ai/inite-billing-service/issues/145)) ([cc10344](https://github.com/inite-ai/inite-billing-service/commit/cc10344f404e624b46f557404ea368122c8b70d6))
* **orders:** a store that signs its users in itself moves its guest orders to them ([#206](https://github.com/inite-ai/inite-billing-service/issues/206)) ([4449ef1](https://github.com/inite-ai/inite-billing-service/commit/4449ef1f3a1bb1879bfb2c82bf532c447ab7d5cb))
* **orders:** signing in with a confirmed email takes over that email's guest purchases ([#204](https://github.com/inite-ai/inite-billing-service/issues/204)) ([e5fcc1a](https://github.com/inite-ai/inite-billing-service/commit/e5fcc1a770fdd65145c16681bb3e80a8592ade22))
* **promo:** scope a code by product, not only by service ([cb02e13](https://github.com/inite-ai/inite-billing-service/commit/cb02e1357244bef54b4bea74b8060ff28f5bb331))
* **promo:** scope a code by product, not only by service ([f82238d](https://github.com/inite-ai/inite-billing-service/commit/f82238d108a445dd26932121ce96a0478cd6e4fd))
* **wallet:** agents with their own wallet, owned by their key ([#217](https://github.com/inite-ai/inite-billing-service/issues/217)) ([0f84bae](https://github.com/inite-ai/inite-billing-service/commit/0f84bae37d52f4fec9cef7cafa662aa8e72f3a22))
* **wallet:** AI agents pay from the person's wallet, within limits ([#213](https://github.com/inite-ai/inite-billing-service/issues/213)) ([dbec7bf](https://github.com/inite-ai/inite-billing-service/commit/dbec7bf97d9c0925a4a4057de9cfd9707fe3ac4b))
* **wallet:** INITE wallet — a person's USDC on Base under their passkey ([#212](https://github.com/inite-ai/inite-billing-service/issues/212)) ([0ed0c8d](https://github.com/inite-ai/inite-billing-service/commit/0ed0c8dbbc764b48f5d7c6bbb3ac92697f51b024))
* **wallet:** INITE-kept keys for agents, the wallet over MCP for agents on their own, a top-up page and the wallet as a chat card ([#218](https://github.com/inite-ai/inite-billing-service/issues/218)) ([2d78d7c](https://github.com/inite-ai/inite-billing-service/commit/2d78d7ce1883fd4d824418d380ec89d94852d91e))
* **wallet:** sites charge the wallet in one step (pay-from-wallet) ([#215](https://github.com/inite-ai/inite-billing-service/issues/215)) ([99a6e64](https://github.com/inite-ai/inite-billing-service/commit/99a6e64fc15313edabef0a96a84d46bff7c4db81))
* **wallet:** top up an INITE wallet by card, paid out of INITE's treasury ([#223](https://github.com/inite-ai/inite-billing-service/issues/223)) ([25a33ec](https://github.com/inite-ai/inite-billing-service/commit/25a33ec918f2674b580313744cdb153c58d33f6f))


### Bug Fixes

* **auth:** pinning the audience no longer locks MCP clients and agents out ([#229](https://github.com/inite-ai/inite-billing-service/issues/229)) ([0efd641](https://github.com/inite-ai/inite-billing-service/commit/0efd64187418634fef8078166c83bb7ca9cc014d))
* **catalog:** signed-in customers see the catalog inside the cabinet ([#171](https://github.com/inite-ai/inite-billing-service/issues/171)) ([2ea4f91](https://github.com/inite-ai/inite-billing-service/commit/2ea4f91eb8002acbf4bca7dc45ab20927d36c6cf))
* **checkout:** a sign-in finished in another tab returns to the checkout ([#196](https://github.com/inite-ai/inite-billing-service/issues/196)) ([087a447](https://github.com/inite-ai/inite-billing-service/commit/087a44755717ab386a937a9ce72876201d057e66))
* **checkout:** a subscription product's yearly price can be paid once ([#216](https://github.com/inite-ai/inite-billing-service/issues/216)) ([8f3b4c7](https://github.com/inite-ai/inite-billing-service/commit/8f3b4c7f868d2bb37d0271f17b4ce34955182c68))
* **checkout:** DID accounts are not guests; re-sign-in once when the order belongs to another account ([#197](https://github.com/inite-ai/inite-billing-service/issues/197)) ([3981ae7](https://github.com/inite-ai/inite-billing-service/commit/3981ae7566952e7acda9e04dacbf3141698ab75e))
* **checkout:** localized product names, same-shop same-currency offers, currency-aware default rail ([#203](https://github.com/inite-ai/inite-billing-service/issues/203)) ([e7ba081](https://github.com/inite-ai/inite-billing-service/commit/e7ba08169113607f7cb304702ea5b0cf51afed16))
* **checkout:** record payment provider failures when starting a payment ([#193](https://github.com/inite-ai/inite-billing-service/issues/193)) ([fc5834c](https://github.com/inite-ai/inite-billing-service/commit/fc5834c5f21a6ba8753bd396a352378442ebf90e))
* **checkout:** say that rouble card payments need a Russian card ([#165](https://github.com/inite-ai/inite-billing-service/issues/165)) ([05c5249](https://github.com/inite-ai/inite-billing-service/commit/05c524982989562422aa87e26913f730935697d9))
* **checkout:** the link token leaves the address bar after hydration ([#205](https://github.com/inite-ai/inite-billing-service/issues/205)) ([f4777cd](https://github.com/inite-ai/inite-billing-service/commit/f4777cd2791d47f9f8f3ff21f038431c365635c1))
* **deploy:** route /mcp to the backend ([#158](https://github.com/inite-ai/inite-billing-service/issues/158)) ([b048bd7](https://github.com/inite-ai/inite-billing-service/commit/b048bd7f58cfe7a097a2ba9753589b1102b73744))
* **deps:** take multer off the vulnerable range ([2e3f446](https://github.com/inite-ai/inite-billing-service/commit/2e3f446577bd3448db2130949e5df3b068f21ab7))
* **dto:** a customer id is a DID, not a UUID — OAuth users can be granted, adjusted and charged ([#226](https://github.com/inite-ai/inite-billing-service/issues/226)) ([def86ad](https://github.com/inite-ai/inite-billing-service/commit/def86adbba82cf7d21f9a4b881de19c41be86530))
* **frontend:** a lost session signs in back to the page that asked ([#201](https://github.com/inite-ai/inite-billing-service/issues/201)) ([6e2b4de](https://github.com/inite-ai/inite-billing-service/commit/6e2b4dec05cd75254738300e018e69d81692b163))
* **fund:** the top-up page looks like the checkout — wallet as the receipt, ways to fund as options ([#222](https://github.com/inite-ai/inite-billing-service/issues/222)) ([3391080](https://github.com/inite-ai/inite-billing-service/commit/3391080df6ed04ff60a59f36f0e9aeb1afff4834))
* **hodle:** record-only events are not settled; registration test passes unsigned ([#188](https://github.com/inite-ai/inite-billing-service/issues/188)) ([1c57cab](https://github.com/inite-ai/inite-billing-service/commit/1c57cab13c951e9fe6d0030495b7e21eec25e0fe))
* **lava:** make lava.top payments actually complete ([#162](https://github.com/inite-ai/inite-billing-service/issues/162)) ([3c5a231](https://github.com/inite-ai/inite-billing-service/commit/3c5a231534e9d3b2d44f3a8d7b9df2f8f4bb0aa2))
* **lava:** show lava.top's refusal instead of an internal error ([#164](https://github.com/inite-ai/inite-billing-service/issues/164)) ([925af36](https://github.com/inite-ai/inite-billing-service/commit/925af36a317201e9c0461bd4344b57a7bd8b639d))
* **mcp:** tool annotations carry the title the directory lists ([#228](https://github.com/inite-ai/inite-billing-service/issues/228)) ([a23b4cc](https://github.com/inite-ai/inite-billing-service/commit/a23b4ccccb6053361d7ba3c573ca34099a3f8afa))
* **orchestrator:** a one-time order for a priced period expires at its end ([#191](https://github.com/inite-ai/inite-billing-service/issues/191)) ([b2f2254](https://github.com/inite-ai/inite-billing-service/commit/b2f225420dbbf72c80e31b99e6a93e94828c0bd9))
* **recommendations:** cast popularity product ids to uuid ([#199](https://github.com/inite-ai/inite-billing-service/issues/199)) ([9e2547d](https://github.com/inite-ai/inite-billing-service/commit/9e2547d9b672e9d18ecab034bb94854596f076f5))
* **security:** private keys are sealed at rest — relayer and agent wallet keys ([#232](https://github.com/inite-ai/inite-billing-service/issues/232)) ([28ef358](https://github.com/inite-ai/inite-billing-service/commit/28ef35800856635d4b8c39975aa274aee4001aca))
* **treasury:** card top-up payouts exactly once ([#224](https://github.com/inite-ai/inite-billing-service/issues/224)) ([98b959d](https://github.com/inite-ai/inite-billing-service/commit/98b959d04d4e177c741a541fe6f590cd80980b83))

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
