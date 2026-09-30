// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Standing rule: configuration is read only through AppConfigService.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration through AppConfigService (src/config) instead.',
        },
      ],
    },
  },
  {
    // Services must query through DbContext (the request's actor transaction),
    // never the base PrismaService, which carries no actor identity.
    files: ['src/**/*.ts'],
    ignores: [
      'src/prisma/**',
      'src/database/**',
      'src/health/**',
      'src/auth/auth.service.ts',
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/prisma/prisma.service'],
              message:
                'Inject DbContext and use db.client (the request actor transaction) instead of PrismaService.',
            },
          ],
        },
      ],
    },
  },
  {
    // The config module is the single place allowed to read process.env.
    files: ['src/config/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Imported verbatim from the standalone DB/ project (structural merge).
    // TODO(pii hardening): type the extension payloads instead of `any`, and
    // read PII_ENCRYPTION_KEY through AppConfigService (validated at startup)
    // instead of process.env; then delete this override and the matching
    // .prettierignore entry.
    files: ['src/lib/crypto/**/*.ts'],
    rules: {
      'no-restricted-properties': 'off',
      'prettier/prettier': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  {
    // Tests use jest mocks and partial fakes heavily.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
