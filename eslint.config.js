// Static checks (run with `npm run lint`, and in CI). TypeScript's own checks run separately (`npm run typecheck`);
// ESLint adds the rules the compiler does not have: correctness patterns from typescript-eslint, React's rules
// of hooks, and a few project rules. Formatting is not linted.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Hooks must be called in the same order on every render; a violation is always a bug.
      'react-hooks/rules-of-hooks': 'error',
      // Missing effect dependencies are reported; deliberate omissions carry an eslint-disable comment with a reason.
      'react-hooks/exhaustive-deps': 'warn',
      // Unused names are errors, except arguments and destructured values starting with "_" (kept for their position).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // `any` is allowed where a value crosses an untyped boundary (worker messages, parsed files), but flagged.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Short-circuit expressions such as `ok ? resolve() : reject()` are used as statements on purpose.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
  // Tests build invalid and partial values on purpose.
  { files: ['**/*.test.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  // Scripts and servers print their results.
  { files: ['scripts/**', 'apps/ssr/server.mjs', 'packages/server/**', 'packages/mock/src/cli.ts'], rules: { 'no-console': 'off' } },
);
