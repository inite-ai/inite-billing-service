# Changelog

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
