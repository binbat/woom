import js from '@eslint/js'
import ts from 'typescript-eslint'

import stylisticJs from '@stylistic/eslint-plugin-js'

export default ts.config(
  {
    ignores: [
      'static/'
    ]
  },
  js.configs.recommended,
  {
    // js options
    plugins: {
      '@stylistic/js': stylisticJs
    },
    rules: {
      '@stylistic/js/semi': ['warn', 'never'],
      'comma-dangle': ['warn', 'only-multiline'],
      '@stylistic/js/quotes': ['warn', 'single', { 'avoidEscape': true }],
      '@stylistic/js/indent': ['warn', 2, { 'SwitchCase': 1 }],
      '@stylistic/js/jsx-quotes': ['warn', 'prefer-double']
    }
  },
  ...ts.configs.recommended,
  {
    // ts options
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          'args': 'all',
          'argsIgnorePattern': '^_',
          'caughtErrors': 'all',
          'caughtErrorsIgnorePattern': '^_',
          'destructuredArrayIgnorePattern': '^_',
          'varsIgnorePattern': '^_',
          'ignoreRestSiblings': true
        }
      ]
    }
  }
)
