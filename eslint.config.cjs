const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/*.d.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs['flat/recommended']
];
