// @ts-check
import js from '@eslint/js';
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
  { ignores: ['**/node_modules/**', '**/dist/**', '**/drizzle/**', '**/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
