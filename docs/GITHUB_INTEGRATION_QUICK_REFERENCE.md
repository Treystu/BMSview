# GitHub Integration Quick Reference

## For Gemini AI

### Before Creating Any GitHub Issue

**MANDATORY: Always follow this workflow:**

```javascript
// 1. Search for duplicates
const existing = await searchGitHubIssues({
  query: "key words from issue title",
  state: "all"
});

// 2. Verify implementation (if code-related)
const code = await getCodebaseFile({
  path: "file/path/to/verify.ts"
});

// 3. Only then create issue
```

### Quick Tool Reference

| Tool | When to Use | Required Params |
|------|-------------|-----------------|
| `searchGitHubIssues` | **Always** before creating issues | `query` |
| `getCodebaseFile` | Before suggesting code changes | `path` |
| `listDirectory` | To discover available files | `path` |

### Allowed File Paths

✅ **Can Access:**
- `netlify/functions/*`
- `components/*`
- `services/*`
- `state/*`
- `hooks/*`
- `utils/*`
- `docs/*`
- `types.ts`, `*.tsx`, `*.md`
- Config files (`package.json`, `tsconfig.json`, etc.)

❌ **Cannot Access:**
- `node_modules/`
- `.git/`
- `.env*`
- `coverage/`
- `dist/`
- `.netlify/`

### Duplicate Detection Rules

- **Exact match** → 🚫 Blocked (409)
- **>90% similar + open** → 🚫 Blocked (409)
- **Similar + closed** → ✅ Allowed (referenced)

### Example: Complete Workflow

```javascript
// Step 1: Check for existing issues
const searchResults = await searchGitHubIssues({
  query: "solar timeout error",
  state: "all",
  per_page: 10
});

// Step 2: Verify current implementation
const solarFunction = await getCodebaseFile({
  path: "netlify/functions/solar-estimate.ts"
});

// Step 3: Check related utilities
const utils = await listDirectory({
  path: "netlify/functions/utils"
});

// Step 4: Create feedback with context
await submitAppFeedback({
  systemId: currentSystemId,
  feedbackType: "bug_report",
  category: "integration",
  priority: "high",
  content: {
    title: "Solar API timeout after 30 seconds",
    description: `Based on code review of ${solarFunction.path}...`,
    rationale: `Found ${searchResults.total_count} related issues. Current implementation shows...`,
    // ... rest of feedback
  }
});
```

## For Developers

### Setup

```bash
# Add to .env or Netlify environment
GITHUB_TOKEN=ghp_your_personal_access_token_here
GITHUB_REPO_OWNER=Treystu
GITHUB_REPO_NAME=BMSview
```

### Token Scopes Required

- `repo` (full access) OR
- `public_repo` (public repos only)

### Testing Locally

```bash
# 1. Export token
export GITHUB_TOKEN=your_test_token

# 2. Start local server
netlify dev

# 3. Test via Gemini insights
curl -X POST http://localhost:8888/.netlify/functions/generate-insights-with-tools \
  -H "Content-Type: application/json" \
  -d '{
    "systemId": "test-system",
    "query": "search for solar integration issues"
  }'
```

### Monitoring

Check logs for:
- `"Searching GitHub issues"` - Search activity
- `"Fetching file from GitHub"` - File access
- `"Duplicate issue detected"` - Blocked duplicates
- `"Directory traversal attempt blocked"` - Security events

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "GITHUB_TOKEN not configured" | Missing env var | Add to Netlify settings |
| "Path not allowed" | Outside allowlist | Check `github-api.cjs` allowlist |
| "Rate limit exceeded" | Too many API calls | Wait for reset time |
| "Duplicate issue detected" | High similarity | Modify title or review existing |

### Security Checklist

- ✅ Token has minimal required scopes
- ✅ Token stored in environment (never committed)
- ✅ Path allowlist reviewed and minimal
- ✅ Blocked paths include all sensitive files
- ✅ Directory traversal protection enabled
- ✅ File size limits configured (15KB)
- ✅ Audit logging enabled

### Files Modified

Core implementation:
- `netlify/functions/utils/github-api.cjs` - GitHub API wrapper
- `netlify/functions/utils/gemini-tools.cjs` - Tool definitions
- `netlify/functions/create-github-issue.cjs` - Duplicate prevention

Tests:
- `tests/github-api.test.js` - Path validation (24 tests)

Documentation:
- `docs/GITHUB_INTEGRATION.md` - Full documentation
- `.github/copilot-instructions.md` - Gemini instructions
- `docs/GITHUB_INTEGRATION_QUICK_REFERENCE.md` - This file

### Deployment Checklist

Before deploying to production:

- [ ] `GITHUB_TOKEN` set in Netlify environment
- [ ] Token has correct scopes (`repo` or `public_repo`)
- [ ] Tests passing (`npm test -- tests/github-api.test.js`)
- [ ] Build succeeds (`npm run build`)
- [ ] Review path allowlist in `github-api.cjs`
- [ ] Verify rate limit handling
- [ ] Check audit logging is enabled
- [ ] Monitor first 24 hours for errors

## Support & Resources

- **Full Docs:** `docs/GITHUB_INTEGRATION.md`
- **Gemini Instructions:** `.github/copilot-instructions.md`
- **Test Suite:** `tests/github-api.test.js`
- **Source Code:** `netlify/functions/utils/github-api.cjs`

---

**Last Updated:** 2024-12-02  
**Feature:** GitHub Integration for AI Feedback System  
**Issue:** #[TBD]
