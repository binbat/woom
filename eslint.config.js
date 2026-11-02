import js from '@eslint/js'
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

export default defineConfigWithVueTs(
  {
    ignores: [
      'static/',
      'target/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
    ],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    // service worker runs in a worker scope, not a browser window
    files: ['webapp/public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        location: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // single-word names (join, prepare, layout, ...) mirror the old React files
      'vue/multi-word-component-names': 'off',
    },
  }
)
