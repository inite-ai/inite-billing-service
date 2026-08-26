import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * Flat config, because Next 16 removed `next lint` and with it the only thing
 * that was linting this app. There was no config file at all, so `npm run lint`
 * has been failing outright — loudly, at least, rather than passing on nothing.
 *
 * The rules are Next's own two presets. Nothing is relaxed here except the
 * generated Prisma-shaped API payloads the admin screens read, which are `any`
 * at the boundary and would otherwise need a type per endpoint before this
 * config could land at all — those are warnings, so they stay visible.
 */
export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_`-prefixed names and rest-sibling omissions (`const { code: _code,
      // ...rest }`) are the deliberate way to drop a field; they are not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
]
