// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Invariant from docs/04 and docs/05: the egress gate is the ONLY module allowed to import the
 * model-provider SDK. Everything else that wants a model call goes through `@class-pulse/ai`'s
 * egress API. A test in packages/ai/src/egress/egress.test.ts enforces the same thing by scanning
 * the tree, so the rule holds even when lint is skipped.
 */
const providerImportRule = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'openai', message: 'Only packages/ai/src/egress may import the provider SDK (docs/04).' },
        { name: '@anthropic-ai/sdk', message: 'Only packages/ai/src/egress may import the provider SDK (docs/04).' },
      ],
      patterns: [
        { group: ['openai/*'], message: 'Only packages/ai/src/egress may import the provider SDK (docs/04).' },
      ],
    },
  ],
};

export default tseslint.config(
  // Generated output, not source. ESLint 9 flat config does not read .gitignore, so anything
  // ignored there that lint would otherwise walk has to be repeated here — in particular the
  // Playwright HTML report, whose bundled vendor JS is ~4000 errors of pure noise and was
  // burying the provider-import rule below.
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/drizzle/**',
      '**/data/**',
      '**/eval-reports/**',
      '.pglite/**',
      'coverage/**',
      'e2e/report/**',
      'e2e/results/**',
      'e2e/screenshots/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Plain ESM run directly by Node (the e2e launcher). typescript-eslint switches `no-undef`
  // off for .ts because the compiler already checks it; .mjs gets no such treatment.
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      ...providerImportRule,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/ai/src/egress/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
