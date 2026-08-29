import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * Flat config, because Next 16 removed `next lint` and with it the only thing
 * that was linting this app. There was no config file at all, so `npm run lint`
 * has been failing outright — loudly, at least, rather than passing on nothing.
 *
 * The rules are Next's own two presets. `no-explicit-any` was a warning while
 * the API payloads the admin screens read were untyped; they have types now, so
 * it is an error and `npm run lint` runs with `--max-warnings 0` — a warning
 * nobody has to fix is a warning that accumulates.
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'public/**'],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // `_`-prefixed names and rest-sibling omissions (`const { code: _code,
      // ...rest }`) are the deliberate way to drop a field; they are not dead code.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
]

export default config
