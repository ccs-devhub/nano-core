/**
    .___   /\                    .___                    .__
  __| _/___)/     ____  ____   __| _/____   _______ __ __|  |   ____   ______
 / __ |\__  \   _/ ___\/  _ \ / __ |/ __ \  \_  __ \  |  \  | _/ __ \ /  ___/
/ /_/ | / __ \_ \  \__(  <_> ) /_/ \  ___/   |  | \/  |  /  |_\  ___/ \___ \
\____ |(____  /  \___  >____/\____ |\___  >  |__|  |____/|____/\___  >____  >
     \/     \/       \/           \/    \/                         \/     \/

eslint.config.mjs
- [x] Enforces custom code guidelines:
      • camelCase for functions and methods
      • snake_case for variables and parameters
      • UPPER_SNAKE_CASE for constants
      • PascalCase for classes and type-like constructs
      • kebab-case for filenames (with explicit exceptions)
- [x] Enforces strict TypeScript discipline:
- [x] Enforces modern JavaScript and TypeScript best practices:
- [x] Enforces optional chaining safety:
      • Encourages optional chaining usage
      • Prevents unsafe optional chaining patterns
- [x] Enforces deterministic import architecture:
      • Deterministic import ordering
      • Semantic grouping of imports (node, framework, plugins, tooling, etc...)
      • Automatic spacing between import groups
      • Enforces newline after imports
      • Prevents duplicate imports
- [x] Enforces architectural boundaries:
      • Disallows deep relative imports (../../ and beyond)
      • Encourages use of "@" alias for internal modules
- [x] Enforces whitespace, formatting, and structural consistency:
- [x] Enforces filename conventions via Unicorn:
      • kebab-case filenames
      • Explicit allow-list for index, config, and ESLint config files
- [x] ESLint-only stylistic enforcement:
      • No external formatter (Prettier is intentionally excluded)
      • All formatting rules are ESLint-native and autofixable where possible
- [x] Test environment awareness:
      • Vitest globals enabled for test files
      • Relaxed rules for magic numbers and JSDoc in tests

Maintainer(s): Cristian D. Moreno – Kyonax
Cyber Code Syndicate (CCS) – 2025
*/
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import { defineConfig } from 'eslint/config';

import import_plugin from 'eslint-plugin-import';
import jsdoc_plugin from 'eslint-plugin-jsdoc';
import prefer_optional_chaining from 'eslint-plugin-prefer-optional-chaining';
import simple_import_sort from 'eslint-plugin-simple-import-sort';
import unicorn_plugin from 'eslint-plugin-unicorn';

import tseslint from 'typescript-eslint';

import globals from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constant Variables
const INDENTATION_SPACES = 2;

export default defineConfig([
  {
    ignores: ['dist/**', 'node_modules/**', '.cache/**'],
  },
  {
    files: ['**/*.{js,ts,mjs,cjs,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      jsdoc: jsdoc_plugin,
      unicorn: unicorn_plugin,
      'prefer-optional-chaining': prefer_optional_chaining,
      'simple-import-sort': simple_import_sort,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      import_plugin.flatConfigs.recommended,
    ],
    settings: {
      'import/resolver': {
        alias: {
          map: [
            ['@', path.resolve(__dirname, 'src')],
            ['@/misc', path.resolve(__dirname, 'src/lib/misc')],
            ['@/constants', path.resolve(__dirname, 'src/lib/constants')],
            ['@/commands', path.resolve(__dirname, 'src/lib/commands')],
            ['@/events', path.resolve(__dirname, 'src/lib/events')],
            ['@/snippets', path.resolve(__dirname, 'src/lib/snippets')],
          ],
          extensions: ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'],
        },
        typescript: {
          project: path.resolve(__dirname, 'tsconfig.json'),
        },
        node: {
          extensions: ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'],
        },
      },
    },
    rules: {
      'no-console': 'error',
      'no-dupe-else-if': 'warn',
      'no-import-assign': 'warn',
      'no-setter-return': 'warn',
      'consistent-return': 'error',
      'no-param-reassign': 'error',
      'no-shadow': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'warn',
      'prefer-optional-chaining/prefer-optional-chaining': 'warn',
      'no-unsafe-optional-chaining': 'error',
      'no-magic-numbers': ['warn', { ignore: [0, 1, -1] }],
      'no-empty': 'error',
      'no-multi-spaces': 'error',
      'no-irregular-whitespace': 'error',
      'no-nested-ternary': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      curly: ['error', 'all'],
      'brace-style': ['error', '1tbs', { allowSingleLine: false }],
      'arrow-body-style': ['error', 'always'],
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'object-shorthand': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'block-spacing': ['error', 'always'],
      'newline-per-chained-call': ['error', { ignoreChainWithDepth: 2 }],
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^node:'],
            ['^@eslint/', '^eslint($|/)'],
            ['^eslint-plugin-'],
            ['^typescript-eslint'],
            ['^[a-zA-Z]'],
            ['^@/'],
            ['^\\u0000'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$'],
            ['^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
            ['^.+\\.s?css$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'padding-line-between-statements': [
        'error',
        { blankLine: 'never', prev: 'expression', next: 'return' },
      ],
      semi: ['error', 'always'],
      'keyword-spacing': ['error', { before: true, after: true }],
      'space-in-parens': ['error', 'never'],
      'object-curly-spacing': ['warn', 'always'],
      'comma-spacing': ['error', { before: false, after: true }],
      'eol-last': ['warn', 'always'],
      quotes: ['warn', 'single', { avoidEscape: true }],
      'max-len': ['warn', { code: 80 }],
      indent: ['warn', INDENTATION_SPACES, { SwitchCase: 1 }],
      'comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'never',
          exports: 'always-multiline',
          functions: 'never',
        },
      ],
      'import/no-unresolved': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '../*',
            '../../*',
            '../../../*',
            '../../../../*',
            '../../../../**/*',
          ],
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['snake_case'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        { selector: ['function', 'method'], format: ['camelCase'] },
        { selector: 'variable', format: ['snake_case'] },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: null,
          leadingUnderscore: 'require',
          filter: {
            regex: '^_+[a-zA-Z0-9]+$',
            match: true,
          },
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['snake_case'],
          leadingUnderscore: 'allow',
          filter: {
            regex: '_+[a-z]+(_[a-z]+)*$',
            match: true,
          },
        },
        {
          selector: 'variable',
          modifiers: ['const'],
          format: ['UPPER_CASE'],
          leadingUnderscore: 'allow',
          filter: {
            regex: '_+[a-z]+(_[a-z]+)*$',
            match: false,
          },
        },
        { selector: 'parameter', format: ['snake_case'] },
        { selector: 'class', format: ['PascalCase'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: ['property', 'typeProperty', 'objectLiteralProperty'],
          format: null,
        },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: false,
          allowTypedFunctionExpressions: false,
          allowHigherOrderFunctions: false,
        },
      ],
      '@typescript-eslint/typedef': [
        'error',
        {
          arrowParameter: true,
          memberVariableDeclaration: true,
          parameter: true,
          propertyDeclaration: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      'unicorn/filename-case': [
        'error',
        {
          cases: { kebabCase: true },
          ignore: [
            'index$',
            'index\\..*$',
            'config$',
            'config\\..*$',
            'eslint$',
            'eslint\\..*$',
            '[a-zA-Z0-9]+$',
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{js,ts}', '**/*.spec.{js,ts}', 'tests/**'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      'no-magic-numbers': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/check-types': 'off',
      'jsdoc/valid-types': 'off',
    },
  },
]);
