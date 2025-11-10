# Codebase Reference

This document consolidates all codebase documentation including structure, patterns, data flows, and best practices.

## Architecture Overview

BMSview is a Battery Management System screenshot analysis tool using Google Gemini AI. Built with React + TypeScript frontend and Netlify Functions backend.

See ARCHITECTURE.md for detailed system design.

## Module Systems

**Critical**: Never mix module systems!

- Frontend (.ts/.tsx): ES modules (import/export)
- Backend (.cjs): CommonJS (require()/module.exports)  
- Exception: solar-estimate.ts (TypeScript, bundled)

## MongoDB Collections

Database: bmsview (or MONGODB_DB_NAME env var)

- analysis-results: Analysis records with deduplication
- systems: Registered BMS systems
- history: Legacy analysis history
- insights-jobs: Background AI jobs

Connection: Always use `getCollection()` from utils/mongodb.cjs

## Path Aliases

Frontend only (configured in vite.config.ts and tsconfig.json):
- components/*
- services/*
- state/*
- hooks/*
- utils/*

Use aliases consistently, avoid relative imports.

## Best Practices

### Logging
All code uses structured JSON logging via utils/logger.cjs

### Error Handling  
- Use retry wrappers from utils/retry.cjs
- Implement circuit breakers for external APIs
- Return structured error responses

### MongoDB
- Always use getCollection() helper
- Implement retry logic
- Pool size: 5 connections

### Gemini API
- Use process.env.GEMINI_MODEL with fallback
- Implement timeouts (25s iteration, 58s total)
- Handle JSON parsing errors

## Anti-Patterns

1. Don't create job-based flows - use sync mode
2. Don't use require() in frontend
3. Don't skip logging
4. Don't hardcode model names
5. Don't mix module systems

For implementation details, see consolidated documentation:
- ARCHITECTURE.md - System design
- FEATURES.md - Feature implementations  
- ADMIN_GUIDE.md - Admin panel
- DEPLOYMENT.md - Deployment procedures
