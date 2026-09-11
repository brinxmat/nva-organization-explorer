import js from '@eslint/js';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';

const MAX_FUNCTION_LINES = 60;
const MAX_NESTING_DEPTH = 3;

const strictness = {
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
  'no-implicit-coercion': 'error',
  'no-param-reassign': 'error',
  'no-shadow': 'error',
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
  'no-console': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-throw-literal': 'error',
  'prefer-template': 'error',
  'prefer-arrow-callback': 'error',
  'object-shorthand': 'error',
  'max-depth': ['error', MAX_NESTING_DEPTH],
  'max-lines-per-function': ['error', { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }],
  'no-restricted-syntax': [
    'error',
    { selector: 'ForInStatement', message: 'Use Object.entries or Object.keys with array methods.' },
    { selector: 'WithStatement', message: 'with is not allowed.' },
  ],
};

export default [
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, jsonld: 'readonly', d3: 'readonly' },
    },
    rules: {
      ...strictness,
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/tag-lines': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
    },
  },
  {
    files: ['test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...strictness,
      'max-lines-per-function': 'off',
      'jsdoc/require-jsdoc': 'off',
    },
  },
];
