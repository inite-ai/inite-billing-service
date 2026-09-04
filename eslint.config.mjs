import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

/**
 * Flat config. ESLint 9 reads only this shape, and the eslintrc fallback it
 * still honours is gone in 10 — migrating now rather than the next time a
 * security advisory forces the upgrade.
 *
 * Same rules as the `.eslintrc.js` it replaces, including the deliberate ones:
 * `no-explicit-any` stays off for the backend, where Prisma transaction clients
 * and provider payloads are genuinely untyped at the boundary, and `_`-prefixed
 * names are the way to drop an argument.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'mcp/dist/**',
      'node_modules/**',
      'coverage/**',
      'eslint.config.mjs',
      'frontend/**',
    ],
  },
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        // Separate tsconfig: the build config excludes test/, but lint must cover it
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
