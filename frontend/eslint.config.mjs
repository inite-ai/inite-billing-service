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
      // Off deliberately. It arrived with an eslint-config-next bump and fires
      // 32 times on one shape: an effect that loads data and puts it in state,
      // which is how every screen in this app fetches. The rule is aimed at the
      // React Compiler's stricter model; satisfying it means moving every admin
      // page onto Suspense or an external store. That is a rewrite of the data
      // layer, not a lint fix, and there is no defect behind it — so it is a
      // decision to take on its own terms rather than smuggle into a dependency
      // upgrade. Everything else the new rules found was real and is fixed:
      // impure `Date.now()` in render, a ref written during render, computed
      // dependency lists, and an internal navigation done as a full page load.
      'react-hooks/set-state-in-effect': 'off',
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
