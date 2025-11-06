# Contributing to BMSview

Thank you for your interest in contributing to BMSview! This document provides guidelines for both human contributors and AI coding agents.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [For GitHub Copilot Coding Agent](#for-github-copilot-coding-agent)
- [Pull Request Process](#pull-request-process)
- [Testing Guidelines](#testing-guidelines)
- [Coding Standards](#coding-standards)

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the project
- Show empathy towards other contributors

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn
- MongoDB instance (local or cloud)
- Google Gemini API key

### Setup

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/BMSview.git
   cd BMSview
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create `.env.local` with required environment variables:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   MONGODB_URI=your_mongodb_connection_string
   MONGODB_DB_NAME=bmsview
   ```

5. Start development server:
   ```bash
   npm run dev
   ```

## Development Workflow

### For Human Contributors

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Follow the coding standards below
   - Write or update tests as needed
   - Update documentation if changing APIs

3. **Test your changes**:
   ```bash
   npm test              # Run tests
   npm run build         # Verify build works
   npm run lint:fix      # Fix linting issues
   ```

4. **Commit your changes**:
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```
   
   Use conventional commit messages:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Adding tests
   - `refactor:` - Code refactoring
   - `chore:` - Maintenance tasks

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** on GitHub

## For GitHub Copilot Coding Agent

### Configuration

This repository is configured with comprehensive instructions for AI coding agents:

- **Primary Instructions**: `.github/copilot-instructions.md`
- **Configuration**: `.copilot/config.json`
- **Additional Context**: `CODEBASE_PATTERNS_AND_BEST_PRACTICES.md`

### Creating Issues for Copilot

When creating issues for GitHub Copilot to work on, follow these guidelines:

#### ✅ Good Issue Example

```
Title: Fix duplicate analysis detection for identical BMS screenshots

Description:
Currently, when a user uploads the same BMS screenshot twice, they don't receive
a duplicate warning. The SHA-256 hash comparison should flag identical images.

Acceptance Criteria:
- Upload same screenshot twice
- Second upload shows isDuplicate flag
- User sees clear warning message

Files to Modify:
- netlify/functions/utils/analysis-pipeline.cjs
- services/geminiService.ts
- components/AnalysisResult.tsx

Testing:
1. Upload test.png
2. Upload test.png again
3. Verify duplicate detected and warning shown
```

#### ❌ Bad Issue Example

```
Title: Fix the duplicate thing

Description:
Duplicates don't work correctly. Please fix.
```

### Ideal Tasks for Copilot

- **Bug fixes** with clear reproduction steps
- **Unit test additions** for existing functionality
- **Documentation updates** (README, API docs, comments)
- **Code refactoring** (extract functions, rename variables)
- **Feature additions** with well-defined, scoped requirements
- **Dependency updates** with compatibility verification
- **Linting fixes** and code style improvements

### Tasks Requiring Human Review

- **Architecture changes** - Major structural refactoring
- **Security-critical code** - Authentication, authorization, encryption
- **Performance optimization** - Requires profiling and benchmarking
- **Breaking changes** - API modifications affecting consumers
- **Complex business logic** - Domain-specific rules requiring expertise

### Working with Copilot PRs

1. **Review thoroughly** - Treat AI PRs like human PRs
2. **Provide feedback** - Use `@copilot` mentions to request changes
3. **Iterate** - Ask for clarifications or improvements
4. **Test locally** - Always verify changes work as expected

## Pull Request Process

1. **PR Title**: Use conventional commit format
   - Example: `feat: add solar efficiency correlation analysis`

2. **PR Description**: Include:
   - What changed and why
   - Link to related issue(s)
   - Testing performed
   - Screenshots for UI changes
   - Breaking changes (if any)

3. **Review Checklist**:
   - [ ] Code builds without errors
   - [ ] All tests pass
   - [ ] Linting passes (or ESLint issues documented)
   - [ ] Documentation updated
   - [ ] No sensitive data or secrets committed
   - [ ] Changes are minimal and focused

4. **Approval**: At least one maintainer approval required

5. **Merge**: Squash and merge to keep clean history

## Testing Guidelines

### Running Tests

```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Generate coverage report
```

### Writing Tests

- Place tests in `tests/` directory
- Use `.test.js` extension
- Mock external dependencies (MongoDB, Gemini API)
- Test both success and error cases
- Keep tests fast (mock slow operations)

Example test structure:

```javascript
describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });

  test('should do expected behavior', () => {
    // Arrange
    const input = { ... };
    
    // Act
    const result = functionToTest(input);
    
    // Assert
    expect(result).toBe(expected);
  });
});
```

## Coding Standards

### Frontend (React/TypeScript)

- **Components**: PascalCase, functional components with hooks
- **Files**: `.tsx` for components, `.ts` for utilities
- **State**: Use Context API with reducers (see `state/appState.tsx`)
- **Styling**: Tailwind CSS classes
- **Imports**: Use path aliases (`components/*`, `services/*`, etc.)

### Backend (Netlify Functions)

- **Files**: `.cjs` extension for CommonJS modules
- **Logging**: Use `createLogger()` from `utils/logger.cjs`
- **Errors**: Use `errorResponse()` from `utils/errors.cjs`
- **MongoDB**: Use `getCollection()` helper, never create raw clients
- **Structure**: `exports.handler = async (event, context) => { ... }`

### General

- **No console.log**: Use structured logging
- **No secrets**: Use environment variables
- **No require() in frontend**: ES modules only
- **Document complex logic**: Add comments for non-obvious code
- **TypeScript**: Use strict typing, avoid `any`

### File Organization

```
BMSview/
├── components/           # React UI components
├── services/            # API clients and data services
├── hooks/               # Custom React hooks
├── utils/               # Shared utility functions
├── types/               # TypeScript type definitions
├── state/               # State management (Context API)
├── netlify/functions/   # Serverless backend functions
└── tests/               # Test files
```

## Documentation

### What to Document

- Public APIs and interfaces
- Complex algorithms or business logic
- Non-obvious code patterns
- Breaking changes
- Environment variables and configuration

### Where to Document

- **Code comments**: For implementation details
- **README.md**: Project overview and setup
- **API docs**: For public interfaces
- **This file**: Contributing guidelines
- **.github/copilot-instructions.md**: AI coding agent guidance

## Questions or Problems?

- **Issues**: Search existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Check README.md and SOLAR_INTEGRATION_GUIDE.md
- **Copilot Instructions**: See `.github/copilot-instructions.md`

## License

By contributing to BMSview, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for contributing to BMSview! 🔋⚡
