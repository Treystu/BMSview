# Creating AI Feedback System Issues - Instructions

This guide provides multiple methods to create the 12 AI Feedback System issues related to issue #204.

## Quick Start (Recommended)

### Method 1: Using GitHub Web Interface (Easiest)

1. Open the pre-formatted issues document: [AI_FEEDBACK_SYSTEM_ISSUES.md](./AI_FEEDBACK_SYSTEM_ISSUES.md)
2. For each issue (Issues 1-12):
   - Go to https://github.com/Treystu/BMSview/issues/new
   - Copy the issue title
   - Copy the entire content from "## Overview" to the end
   - Paste into GitHub's issue form
   - Add the labels listed at the end of each issue
   - Click "Submit new issue"

**Time required:** ~15-20 minutes for all 12 issues

### Method 2: Using GitHub CLI (Fastest)

```bash
# Prerequisites: GitHub CLI installed and authenticated
# Install: https://cli.github.com/

# Authenticate if needed
gh auth login

# Run the creation script
cd /home/runner/work/BMSview/BMSview
./scripts/create-ai-feedback-issues.sh
```

**Time required:** ~2-3 minutes (automated)

### Method 3: Using Node.js API Script (Most Flexible)

```bash
# Prerequisites: Node.js installed, GitHub Personal Access Token

# Set your GitHub token
export GITHUB_TOKEN=your_personal_access_token_here

# Run the script
cd /home/runner/work/BMSview/BMSview
node scripts/create-issues-api.js
```

To create a GitHub Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Create AI Feedback Issues")
4. Select scope: `repo` (Full control of private repositories)
5. Click "Generate token"
6. Copy the token immediately (you won't see it again!)

**Time required:** ~2-3 minutes (automated)

## What Gets Created

All 12 issues will be created with:
- ✅ Descriptive titles
- ✅ Structured markdown bodies with:
  - Overview section
  - Task checklists
  - Acceptance criteria
  - Reference to parent issue #204
  - Priority level
- ✅ Appropriate labels (`ai-feedback` + specific labels)

## Issue Summary

| Priority | Count | Issues |
|----------|-------|--------|
| High | 4 | Data Privacy, Testing, Error Handling, Security |
| Medium | 5 | Documentation, Performance, Monitoring, Migration, Cost Management |
| Low | 3 | Analytics, Integrations, UX Enhancements |

## Files Created

- **AI_FEEDBACK_SYSTEM_ISSUES.md** - Formatted document with all 12 issues for manual creation
- **scripts/create-ai-feedback-issues.sh** - Bash script using GitHub CLI
- **scripts/create-issues-api.js** - Node.js script using GitHub REST API
- **ISSUE_CREATION_GUIDE.md** - This file

## Troubleshooting

### GitHub CLI Error: "To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN"

If running in GitHub Actions, the token needs to be explicitly set:

```bash
export GH_TOKEN=${{ github.token }}
./scripts/create-ai-feedback-issues.sh
```

### API Rate Limiting

If you hit rate limits:
- Wait 1 hour for the limit to reset
- Or use an authenticated request (scripts already handle this)
- Check your rate limit status: `curl https://api.github.com/rate_limit`

### Labels Don't Exist

Some labels may need to be created first. Common labels that might need creation:
- `ai-feedback`
- `quality-assurance`
- `developer-experience`
- `external-tools`

To create a label:
```bash
gh label create "ai-feedback" --color "0E8A16" --description "AI feedback system related"
```

## Next Steps After Creation

1. ✅ Verify all 12 issues were created
2. ✅ Ensure they all reference #204
3. ✅ Assign team members to appropriate issues
4. ✅ Set milestones if applicable
5. ✅ Add issues to project board if you use one
6. ✅ Prioritize which issues to tackle first (High priority issues recommended)

## Support

If you encounter issues:
1. Check that your GitHub token has `repo` scope
2. Verify you have permission to create issues in the repository
3. Ensure all prerequisite labels exist (or let the script create them)
4. Review the error messages - they usually indicate the specific problem

---

**Repository:** Treystu/BMSview  
**Parent Issue:** #204 - Full Context Mode with AI-Driven App Feedback System  
**Total Issues:** 12  
**Estimated Time:** 2-20 minutes depending on method chosen
