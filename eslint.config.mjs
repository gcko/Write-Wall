import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
        ...globals.es2024,
      },
      ecmaVersion: 'latest',
      sourceType: 'script',
      parserOptions: {
        ecmaFeatures: {
          impliedStrict: true,
        },
        project: ['./tsconfig.json'],
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginPrettierRecommended,
  {
    ignores: [
      '.github/*',
      '.husky/*',
      '.idea/*',
      'dist/*',
      'node_modules/*',
      '*.cjs',
      'eslint.config.mjs',
      'webpack/*',
    ],
  },
  {
    rules: {
      'consistent-return': ['off'],

      'no-param-reassign': [
        'error',
        {
          ignorePropertyModificationsFor: ['consoleElement'],
        },
      ],

      'no-console': [
        'warn',
        {
          allow: ['info', 'warn', 'error'],
        },
      ],

      'prettier/prettier': [
        'error',
        {
          semi: true,
          endOfLine: 'auto',
          tabWidth: 2,
          printWidth: 100,
          singleQuote: true,
          trailingComma: 'all',
          bracketSameLine: true,
          usePrettierrc: false,
        },
      ],
    },
  },
);
