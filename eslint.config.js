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
      '@stylistic/js/comma-spacing': ['warn', {'before': false, 'after': true}],
      '@stylistic/js/semi': ['warn', 'never'],
      '@stylistic/js/space-in-parens': ['warn', 'never'],
      '@stylistic/js/space-before-blocks': ['warn', { 'functions': 'always', 'keywords': 'always', 'classes': 'always' }],
      '@stylistic/js/space-infix-ops': ['warn', { 'int32Hint': false }],
      '@stylistic/js/space-unary-ops': ['warn'],
      '@stylistic/js/switch-colon-spacing': ['warn'],
      '@stylistic/js/no-multi-spaces': ['warn'],
      '@stylistic/js/no-multiple-empty-lines': ['warn'],
      '@stylistic/js/no-trailing-spaces': ['warn'],
      '@stylistic/js/no-whitespace-before-property': ['warn'],
      '@stylistic/js/new-parens': ['warn', 'always'],
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
