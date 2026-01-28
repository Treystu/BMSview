module.exports = {
  // Basic formatting
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,

  // JSX specific
  jsxSingleQuote: false,
  jsxBracketSameLine: false,

  // Other rules
  quoteProps: 'as-needed',
  bracketSpacing: true,
  arrowParens: 'avoid',
  endOfLine: 'lf',

  // Plugin configurations
  organizeImportsSkipDestructiveCodeActions: true,

  // File-specific overrides
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 120,
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'preserve',
      },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
  ],
};