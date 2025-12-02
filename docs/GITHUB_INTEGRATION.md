# GitHub Integration for AI Feedback System

## Overview

The AI Feedback System now includes GitHub repository integration, enabling Gemini to:
1. Search existing issues to prevent duplicates
2. Verify code implementations before making suggestions
3. Discover repository structure and files

This enhancement addresses Issue #268: "Enhance AI Feedback System: GitHub Issue Search, Duplicate Prevention, and Codebase Context for Gemini"

## Features

### 1. Issue Search & Duplicate Prevention

**Tool:** `searchGitHubIssues`

**Purpose:** Search the BMSview GitHub repository for existing issues before creating new ones.

**Parameters:**
- `query` (required): Search keywords extracted from issue title/description
- `state`: Filter by issue state - `'open'`, `'closed'`, or `'all'` (default: `'all'`)
- `labels`: Array of label filters (e.g., `["ai-generated", "bug"]`)
- `per_page`: Results per page (max 100, default 30)

**Example Usage:**
```javascript
// In Gemini function calling
const results = await searchGitHubIssues({
  query: "solar API integration timeout",
  state: "all",
  per_page: 10
});

// Returns:
{
  total_count: 3,
  items: [
    {
      number: 42,
      title: "Fix Solar API timeout error",
      state: "open",
      html_url: "https://github.com/Treystu/BMSview/issues/42",
      created_at: "2024-11-15T10:30:00Z",
      updated_at: "2024-12-01T14:20:00Z",
      labels: ["bug", "solar"],
      body: "Solar API times out after 30 seconds..." // Truncated to 500 chars
    },
    // ... more results
  ]
}
```

**Security:**
- Requires `GITHUB_TOKEN` environment variable
- Rate limit aware (respects GitHub API limits)
- Graceful degradation if search fails

### 2. Code File Access

**Tool:** `getCodebaseFile`

**Purpose:** Fetch file contents from the repository to verify current implementation.

**Parameters:**
- `path` (required): File path in repository (e.g., `"netlify/functions/analyze.cjs"`)
- `ref`: Git reference - branch, tag, or commit SHA (default: `"main"`)

**Example Usage:**
```javascript
// Verify current implementation before suggesting changes
const file = await getCodebaseFile({
  path: "netlify/functions/utils/gemini-tools.cjs"
});

// Returns:
{
  path: "netlify/functions/utils/gemini-tools.cjs",
  name: "gemini-tools.cjs",
  size: 45000,
  truncated: false,
  content: "// @ts-nocheck\n/**\n * Gemini Function Calling...",
  sha: "abc123def456...",
  url: "https://github.com/Treystu/BMSview/blob/main/..."
}
```

**Security Features:**

**Path Allowlist:**
Only these paths and their descendants can be accessed:
- `netlify/functions` - Serverless functions
- `components` - React components
- `services` - API service clients
- `state` - State management
- `hooks` - Custom React hooks
- `utils` - Utility modules
- `docs` - Documentation
- `types.ts`, `App.tsx`, `admin.tsx`, `index.tsx` - Core files
- `vite.config.ts`, `tsconfig.json`, `package.json` - Config files
- `README.md`, `ARCHITECTURE.md` - Documentation

**Blocked Paths:**
These paths are explicitly blocked for security:
- `node_modules` - Dependencies
- `.git` - Git repository metadata
- `.env*` - Environment variables
- `coverage` - Test coverage reports
- `dist` - Build output
- `.netlify` - Netlify internal files

**Additional Security:**
- Directory traversal protection (blocks `..` and `./`)
- File size limit: 15KB (larger files are truncated with warning)
- Comprehensive logging of all access attempts

### 3. Directory Listing

**Tool:** `listDirectory`

**Purpose:** Discover files and subdirectories in a repository path.

**Parameters:**
- `path` (required): Directory path (e.g., `"netlify/functions"`)
- `ref`: Git reference (default: `"main"`)

**Example Usage:**
```javascript
// Discover all utility modules
const listing = await listDirectory({
  path: "netlify/functions/utils"
});

// Returns:
{
  path: "netlify/functions/utils",
  items: [
    {
      name: "gemini-tools.cjs",
      path: "netlify/functions/utils/gemini-tools.cjs",
      type: "file",
      size: 45000,
      sha: "abc123...",
      url: "https://github.com/Treystu/BMSview/blob/main/..."
    },
    {
      name: "mongodb.cjs",
      path: "netlify/functions/utils/mongodb.cjs",
      type: "file",
      size: 12000,
      sha: "def456...",
      url: "https://github.com/Treystu/BMSview/blob/main/..."
    },
    // ... more files
  ]
}
```

**Security:** Same allowlist/blocklist restrictions as `getCodebaseFile`.

## Duplicate Prevention Workflow

When creating a GitHub issue from AI feedback, the system now:

### Step 1: Search for Similar Issues

```javascript
const similarIssues = await findSimilarIssues(feedbackTitle);
```

The search:
- Removes emojis from the title for better matching
- Searches both open and closed issues (`state: 'all'`)
- Returns top 10 most relevant results

### Step 2: Check for Exact Duplicates

```javascript
const duplicateCheck = checkForExactDuplicate(feedbackTitle, similarIssues.items);
```

**Duplicate Detection Rules:**

1. **Exact Title Match:**
   - Case-insensitive comparison
   - Ignores emoji prefixes
   - **Result:** Blocked (409 Conflict)

2. **High Similarity (>90%) with Open Issues:**
   - Word-based similarity calculation
   - Only considers open issues
   - **Result:** Blocked (409 Conflict)

3. **Similar Closed Issues:**
   - Not considered duplicates
   - **Result:** Allowed, but referenced in new issue

**Example Duplicate Response:**
```json
{
  "statusCode": 409,
  "error": "Duplicate issue detected",
  "reason": "Exact title match",
  "duplicateIssue": {
    "number": 42,
    "title": "Fix Solar API timeout error",
    "url": "https://github.com/Treystu/BMSview/issues/42",
    "state": "open"
  },
  "suggestion": "Review the existing issue instead of creating a duplicate.",
  "feedbackId": "feedback-123"
}
```

### Step 3: Create Issue with References

If no duplicate is found, the issue is created with:
- Original AI feedback content
- **Related Issues section** listing similar issues found
- Audit metadata (duplicate check performed, similar issues count)

**Example Issue Body:**
```markdown
## AI-Generated Feedback

**Type:** optimization
**Category:** performance
**Priority:** HIGH

### Description
Optimize database queries for better performance...

### Rationale
Current queries are slow under high load...

---

### Related Issues

The AI identified these potentially related issues:

- 🟢 #40: [Database performance improvements](https://github.com/...)
- 🔴 #35: [Query optimization ideas](https://github.com/...)
- 🟢 #28: [Add database indexes](https://github.com/...)

---

*This issue was automatically generated from AI feedback on 12/2/2024*
*Feedback ID: feedback-abc123*
```

## Gemini Workflow Best Practices

### Before Creating GitHub Issues

**CRITICAL: Always follow this workflow:**

```javascript
// 1. Search for existing issues
const existingIssues = await searchGitHubIssues({
  query: "solar API timeout",
  state: "all"
});

// 2. If suggesting code changes, verify current implementation
const currentCode = await getCodebaseFile({
  path: "netlify/functions/solar-estimate.ts"
});

// 3. Optionally, discover related files
const relatedFiles = await listDirectory({
  path: "netlify/functions"
});

// 4. Only then create issue or provide feedback
// - Reference similar issues found
// - Include accurate code context
// - Provide implementation-aware recommendations
```

### When to Use Each Tool

**Use `searchGitHubIssues` when:**
- Before creating any GitHub issue
- Researching past solutions
- Finding related work or discussions
- Understanding current project priorities

**Use `getCodebaseFile` when:**
- Suggesting code changes
- Verifying feature existence
- Understanding current implementation
- Providing code-aware recommendations

**Use `listDirectory` when:**
- Exploring repository structure
- Finding related components
- Discovering available utilities
- Planning architectural changes

## Configuration

### Environment Variables

**Required:**
```bash
GITHUB_TOKEN=ghp_your_personal_access_token_here
```

**Optional (defaults shown):**
```bash
GITHUB_REPO_OWNER=Treystu
GITHUB_REPO_NAME=BMSview
```

### GitHub Token Requirements

The `GITHUB_TOKEN` must have these scopes:
- `repo` (full repository access) - for issue search and content access
  - OR `public_repo` (for public repositories only)

**To create a token:**
1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select scopes: `repo` or `public_repo`
4. Copy token and add to Netlify environment variables

## Error Handling

### Rate Limiting

GitHub API has rate limits (5000 requests/hour for authenticated requests).

**Error Response:**
```json
{
  "error": true,
  "message": "GitHub API rate limit exceeded. Resets at 2024-12-02T15:30:00Z"
}
```

**Handling:**
- Tools return graceful errors
- Issue creation proceeds with warning note
- Retry after reset time

### Path Validation Errors

**Error Response:**
```json
{
  "error": true,
  "message": "Access to 'node_modules' is not allowed",
  "path": "node_modules/package/index.js",
  "suggestion": "File path is not in the allowed list."
}
```

**Common Causes:**
- Attempting to access blocked path (.env, .git, node_modules)
- Directory traversal attempt (using `..`)
- Path not in allowlist

### File Not Found

**Error Response:**
```json
{
  "error": true,
  "message": "File not found: netlify/functions/nonexistent.cjs",
  "path": "netlify/functions/nonexistent.cjs",
  "suggestion": "File does not exist. Use listDirectory to discover available files."
}
```

### Large File Truncation

**Warning Response:**
```json
{
  "path": "netlify/functions/large-file.cjs",
  "size": 25000,
  "truncated": true,
  "truncatedAt": 15360,
  "content": "// Truncated content...",
  "message": "File size (25000 bytes) exceeds limit (15360 bytes). Content has been truncated."
}
```

## Audit Trail

All GitHub API operations are logged with structured logging:

### Search Operations
```json
{
  "level": "info",
  "message": "Searching GitHub issues",
  "owner": "Treystu",
  "repo": "BMSview",
  "query": "repo:Treystu/BMSview solar API state:all",
  "per_page": 30
}
```

### File Access
```json
{
  "level": "info",
  "message": "Fetching file from GitHub",
  "owner": "Treystu",
  "repo": "BMSview",
  "path": "netlify/functions/analyze.cjs",
  "ref": "main"
}
```

### Security Violations
```json
{
  "level": "warn",
  "message": "Directory traversal attempt blocked",
  "path": "netlify/../.env",
  "normalizedPath": "netlify/../.env"
}
```

### Duplicate Detection
```json
{
  "level": "warn",
  "message": "Duplicate issue detected",
  "feedbackId": "feedback-123",
  "duplicateIssueNumber": 42,
  "reason": "Exact title match"
}
```

## Testing

### Unit Tests

**Path Validation Tests:** `tests/github-api.test.js`
- ✅ 24 tests passing
- Valid path handling
- Directory traversal protection
- Blocked path enforcement
- Allowlist validation
- Input sanitization
- Logging verification

**Duplicate Detection Tests:** `tests/duplicate-detection.test.js`
- Exact match detection
- Similarity scoring
- Open vs closed issue handling
- Multiple issue scenarios

### Integration Testing

**Prerequisites:**
```bash
export GITHUB_TOKEN=your_test_token
export GITHUB_REPO_OWNER=Treystu
export GITHUB_REPO_NAME=BMSview
```

**Manual Test Flow:**
1. Test issue search:
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
     -H "Content-Type: application/json" \
     -d '{"systemId":"test","query":"search for solar issues"}'
   ```

2. Test file access:
   ```bash
   # Via Gemini tool calling in insights generation
   # Ask Gemini: "What does the solar-estimate function do?"
   ```

3. Test duplicate prevention:
   ```bash
   curl -X POST http://localhost:8888/.netlify/functions/create-github-issue \
     -H "Content-Type: application/json" \
     -d '{"feedbackId":"test-feedback-id"}'
   ```

## Monitoring

### Key Metrics to Track

1. **Duplicate Prevention Rate:**
   - Issues blocked by duplicate detection
   - False positives (manual overrides needed)

2. **GitHub API Usage:**
   - Rate limit consumption
   - Failed requests (rate limits, auth errors)
   - Average response times

3. **Security Events:**
   - Path traversal attempts
   - Blocked path access attempts
   - Allowlist violations

4. **Tool Usage:**
   - Most frequently called tools
   - Average execution times
   - Error rates per tool

### Logs to Monitor

**In Production:**
- Search queries and results
- File access patterns
- Duplicate detection outcomes
- Security violations
- API errors and rate limits

**Example Query (MongoDB logs collection):**
```javascript
db.logs.find({
  "message": "Duplicate issue detected"
}).sort({ timestamp: -1 }).limit(10)
```

## Future Enhancements

### Planned Improvements

1. **Smart Similarity Scoring:**
   - Use embeddings for better semantic matching
   - Consider issue body content, not just titles
   - ML-based duplicate detection

2. **Enhanced Codebase Context:**
   - AST parsing for code structure understanding
   - Cross-file dependency tracking
   - Function signature extraction

3. **Issue Relationship Mapping:**
   - Automatic detection of related issues
   - Dependency graphs between issues
   - Impact analysis for proposed changes

4. **Admin Dashboard Integration:**
   - Duplicate prevention statistics
   - Tool usage analytics
   - Manual override interface

## Troubleshooting

### "GITHUB_TOKEN not configured"

**Cause:** Environment variable not set.

**Solution:**
```bash
# Add to Netlify environment variables
GITHUB_TOKEN=ghp_your_token_here
```

### "Path not allowed"

**Cause:** Trying to access file outside allowlist.

**Solution:**
- Check path against allowlist in `github-api.cjs`
- Use `listDirectory` to discover available files
- Request path addition if legitimately needed

### "Rate limit exceeded"

**Cause:** Too many GitHub API requests.

**Solution:**
- Wait until reset time (shown in error message)
- Reduce query frequency
- Consider caching search results

### "Duplicate issue detected" but it's not a duplicate

**Cause:** High title similarity threshold (>90%).

**Solution:**
- Currently requires manual intervention
- Future: Admin dashboard override feature
- Workaround: Slightly modify issue title

## Security Considerations

### Access Control

**Repository Access:**
- Only public repository data accessible
- Token scoped to read-only operations
- No write access to repository files

**Path Restrictions:**
- Allowlist prevents unauthorized access
- Blocklist protects sensitive files
- Directory traversal blocked

### Data Privacy

**File Contents:**
- Only configuration and source code accessed
- Environment variables never exposed
- User data never accessed

**Issue Data:**
- Public issues only (no private repo support yet)
- Issue content may contain sensitive data - handle appropriately
- Audit logs contain issue metadata only

### Token Security

**Best Practices:**
- Use tokens with minimal required scopes
- Rotate tokens regularly
- Monitor token usage in GitHub settings
- Never commit tokens to repository
- Use Netlify environment variables only

## Support

For issues or questions:
1. Check audit logs for error details
2. Review security guidelines above
3. Test with manual API calls
4. Open GitHub issue with logs and context
