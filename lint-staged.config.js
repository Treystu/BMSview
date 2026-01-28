module.exports = {
  // TypeScript and JavaScript files
  '*.{ts,tsx,js,jsx}': [
    'eslint --fix',
    'prettier --write',
    'bash -c "npm run type-check"',
  ],

  // Style files
  '*.{css,scss,less}': [
    'prettier --write',
  ],

  // JSON files
  '*.json': [
    'prettier --write',
  ],

  // Markdown files
  '*.md': [
    'prettier --write',
    'markdownlint --fix',
  ],

  // YAML files
  '*.{yml,yaml}': [
    'prettier --write',
  ],

  // Package files
  'package*.json': [
    'npm audit --audit-level=moderate',
  ],

  // Test files - run tests for changed test files
  '*.test.{ts,tsx,js,jsx}': [
    'npm run test:file --',
  ],
};