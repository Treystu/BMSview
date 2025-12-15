import js from '@eslint/js';
import react from 'eslint-plugin-react';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist', 'node_modules', '.netlify', 'coverage'],
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.jest,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            react,
        },
        rules: {
            ...react.configs.recommended.rules,
            ...react.configs['jsx-runtime'].rules,
            'react/prop-types': 'off', // specific to this project's needs
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        // JS/CJS: lint for correctness/style, but don't apply TS rules.
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
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
        },
    },
    {
        // Jest tests need jest globals (and Node globals for require/module/etc.)
        files: ['tests/**/*.{js,cjs}'],
        languageOptions: {
            ecmaVersion: 'latest',
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
    },
    // Netlify Functions backend is CommonJS (.cjs). Many Jest tests are also written in CJS.
    // Allow require/module.exports and a few legacy pragmas in those zones.
    {
        files: ['netlify/functions/**/*.cjs', 'netlify/functions/**/*.js', 'tests/**/*.{cjs,js}'],
        rules: {
            // No TS rules in JS/CJS zones.
        },
    },
    {
        // Turn off unused-var noise in backend CJS and test files.
        files: ['netlify/functions/**/*.{cjs,js}', 'tests/**/*.{cjs,js}'],
        rules: {
            'no-unused-vars': 'off',
        },
    },
);
