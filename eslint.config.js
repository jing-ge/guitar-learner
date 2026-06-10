// 最小化 ESLint 配置：只为捕获 React Hooks 依赖错误。
// 不做格式化、不做风格审查 —— 保持 lint 价值密度。
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'native/**',
      'scripts/**',
      'public/**',
      '.review/**',
      '.omc/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
