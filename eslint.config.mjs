import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2025,
        ...globals.node,
      },
      ecmaVersion: 'latest',
      sourceType: 'script',
    },
    rules: {
      'array-bracket-spacing': [
        'error',
        'always',
        {
          singleValue: true,
        },
      ],

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
          allow: ['warn', 'error'],
        },
      ],

      'prettier/prettier': [
        'error',
        {
          trailingComma: 'es5',
          tabWidth: 2,
          semi: true,
          singleQuote: true,
        },
      ],
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  eslintPluginPrettierRecommended,
  {
    ignores: ['dist/*', 'node_modules/*', 'husky/*', 'github/*'],
  }
);
