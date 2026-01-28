import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist', 'node_modules', '.netlify', 'coverage', '*.config.js', '*.config.ts'],
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
    },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2020,
            },
            parserOptions: {
                project: ['./tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            // React rules
            ...react.configs.recommended.rules,
            ...react.configs['jsx-runtime'].rules,
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],

            // TypeScript rules
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],
            '@typescript-eslint/no-unsafe-any': 'warn',
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/prefer-nullish-coalescing': 'error',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/prefer-as-const': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/prefer-includes': 'error',
            '@typescript-eslint/prefer-string-starts-ends-with': 'error',
            '@typescript-eslint/no-magic-numbers': [
                'warn',
                {
                    ignore: [0, 1, -1, 2],
                    ignoreArrayIndexes: true,
                    ignoreDefaultValues: true,
                    ignoreEnums: true,
                },
            ],

            // React specific rules
            'react/prop-types': 'off', // We use TypeScript
            'react/jsx-props-no-spreading': 'warn',
            'react/jsx-boolean-value': ['error', 'never'],
            'react/jsx-curly-brace-presence': ['error', 'never'],
            'react/self-closing-comp': 'error',
            'react/jsx-pascal-case': 'error',
            'react/jsx-no-useless-fragment': 'warn',
            'react/jsx-fragments': ['error', 'syntax'],

            // General rules
            'no-console': 'off', // We use structured logging
            'no-debugger': 'error',
            'no-alert': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'prefer-template': 'error',
            'no-nested-ternary': 'warn',
            'no-unneeded-ternary': 'error',
            'object-shorthand': 'error',
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'curly': ['error', 'all'],

            // Security rules
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-script-url': 'error',

            // Performance rules
            'no-loop-func': 'error',
            'no-await-in-loop': 'warn',
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        // Test files - relaxed rules
        files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                ...globals.jest,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-magic-numbers': 'off',
            'no-console': 'off',
        },
    },
    {
        // JS/CJS files
        files: ['**/*.{js,jsx,cjs,mjs}'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                ignoreRestSiblings: true
            }],
        },
    },
    {
        // Netlify Functions
        files: ['netlify/functions/**/*.{cjs,js,ts}'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },
    {
        // Config files
        files: ['**/*.config.{js,ts}', '**/vite.config.{js,ts}'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-console': 'off',
        },
    },
);
