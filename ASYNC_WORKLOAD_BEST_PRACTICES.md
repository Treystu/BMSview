# Netlify Async Workloads - Implementation Best Practices

## Critical Information for All Async Workload Implementations

This document provides the definitive guide for implementing Netlify Async Workloads in the BMSview repository, based on lessons learned from issues #274, #275, and #276.

---

## The 250 MB Bundle Size Challenge

### Root Cause
The `@netlify/async-workloads` package has a 43MB dependency tree (primarily `@netlify/blobs` and related packages). When bundled into Netlify functions, this can exceed the 250 MB uncompressed limit.

### CRITICAL RULE #1: Use ES Modules (.mjs), Not CommonJS (.cjs)

**❌ WRONG - Will fail at runtime:**
```javascript
// generate-insights-trigger.cjs (CommonJS)
const { AsyncWorkloadsClient } = require('@netlify/async-workloads'); // ERROR!
```

**Error you'll get:**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/node_modules/@netlify/async-workloads/index.js 
from /var/task/netlify/functions/generate-insights-trigger.cjs not supported.
```

**✅ CORRECT - Use ES Module:**
```javascript
// generate-insights-trigger.mjs (ES Module)
import { AsyncWorkloadsClient } from '@netlify/async-workloads'; // ✅ Works!
```

**Why:** @netlify/async-workloads is published as an ES Module (ESM) only. CommonJS cannot `require()` ES Modules - you MUST use ES Module `import` syntax.

---

## The Complete Solution: 4 Critical Requirements

### 1. Use .mjs Extension (ES Module Format)

**File naming:**
- ✅ `generate-insights-trigger.mjs` - ES Module
- ✅ `generate-insights-background.mjs` - ES Module
- ❌ `generate-insights-trigger.cjs` - CommonJS (will fail)
- ❌ `generate-insights-trigger.js` - Ambiguous (avoid)

### 2. Use NFT Bundler (Not esbuild)

**netlify.toml configuration:**
```toml
[functions."your-async-function"]
  node_bundler = "nft"  # ✅ Reliable externalization
  external_node_modules = ["@netlify/async-workloads"]
  async_workloads = true  # Only for workload handlers
```

**Why NFT over esbuild:**
- **NFT (Node File Trace):** Designed specifically for serverless functions, reliably respects `external_node_modules`
- **esbuild:** General-purpose bundler, inconsistent with external module handling, may still bundle despite configuration

### 3. Direct Imports Only (No Transitive Imports)

**❌ WRONG - Transitive import through utility:**
```javascript
// utils/async-client.cjs
const { AsyncWorkloadsClient } = require('@netlify/async-workloads');
module.exports = { triggerWorkload: async () => { /* ... */ } };

// trigger.mjs
import { triggerWorkload } from './utils/async-client.cjs'; // ❌ Still bundles!
```

**✅ CORRECT - Direct import in function:**
```javascript
// trigger.mjs
import { AsyncWorkloadsClient } from '@netlify/async-workloads'; // ✅ Externalized

export const handler = async (event, context) => {
  const client = new AsyncWorkloadsClient();
  const result = await client.send('my-event', { data: {...} });
  // ...
};
```

**Why:** Bundlers follow the require/import chain. Even with `external_node_modules`, transitive imports through utilities may still get bundled. Import directly in your function file.

### 4. Proper Package Configuration

**package.json:**
```json
{
  "dependencies": {
    "@netlify/async-workloads": "^0.0.106"
  }
}
```

**Note:** The package MUST be in package.json even though it's externalized. Netlify needs it in dependencies to provide it at runtime.

---

## Complete Working Example

### Trigger Function (trigger.mjs)
```javascript
// MUST be .mjs (ES Module)
import { AsyncWorkloadsClient } from '@netlify/async-workloads';
import { createLogger } from './utils/logger.cjs';

export const handler = async (event, context) => {
  const log = createLogger('my-trigger');
  
  // Parse request
  const body = JSON.parse(event.body || '{}');
  
  // Create async workload client
  const client = new AsyncWorkloadsClient();
  
  // Send event to workload system
  const result = await client.send('my-event-name', {
    data: {
      jobId: 'job-123',
      ...body
    },
    priority: 5 // 0-10 scale, 5 = normal
  });
  
  log.info('Workload triggered', { eventId: result.eventId });
  
  return {
    statusCode: 202,
    body: JSON.stringify({
      jobId: 'job-123',
      eventId: result.eventId,
      message: 'Processing started'
    })
  };
};
```

### Workload Handler (handler.mjs)
```javascript
// MUST be .mjs (ES Module)
import { asyncWorkloadFn, ErrorDoNotRetry, ErrorRetryAfterDelay } from '@netlify/async-workloads';
import { processJob } from './utils/processor.cjs';

const handler = asyncWorkloadFn(async (event) => {
  const { eventData, eventId, attempt } = event;
  
  // Multi-step workflow
  const steps = ['initialize', 'fetch', 'process', 'store', 'complete'];
  
  for (const step of steps) {
    try {
      await performStep(step, eventData);
    } catch (error) {
      if (error.code === 'RATE_LIMIT') {
        // Retry after delay
        throw new ErrorRetryAfterDelay({
          message: 'Rate limited. Will retry after 5 minutes',
          retryDelay: 300000, // 5 minutes in milliseconds
          error
        });
      }
      
      if (error.code === 'INVALID_DATA') {
        // Don't retry
        throw new ErrorDoNotRetry(error.message);
      }
      
      // Standard error - uses backoff schedule
      throw error;
    }
  }
  
  return { success: true, result: 'Job completed' };
});

// Configuration
export const asyncWorkloadConfig = {
  name: 'my-workload',
  events: ['my-event-name'],
  maxRetries: 15,
  eventFilter: (event) => {
    return event.data && event.data.jobId;
  },
  backoffSchedule: (attempt) => {
    if (attempt === 1) return 5000;   // 5s
    if (attempt === 2) return 10000;  // 10s
    if (attempt === 3) return 30000;  // 30s
    return 60000;                     // 60s
  }
};

export default handler;
```

### Configuration (netlify.toml)
```toml
# Workload handler
[functions."my-handler"]
  node_bundler = "nft"
  external_node_modules = ["@netlify/async-workloads"]
  async_workloads = true

# Trigger function
[functions."my-trigger"]
  node_bundler = "nft"
  external_node_modules = ["@netlify/async-workloads"]
```

---

## Troubleshooting Guide

### Issue 1: "require() of ES Module not supported"

**Symptom:**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported
```

**Solution:**
- Convert your function from `.cjs` to `.mjs`
- Change `require()` to `import`
- Change `module.exports` to `export`

### Issue 2: "function exceeds maximum size of 250 MB"

**Symptom:**
```
Deploy did not succeed with HTTP Error 400: The function exceeds the maximum size of 250 MB
```

**Solutions (in order of likelihood):**

1. **Check bundler:** Must be `nft`, not `esbuild`
   ```toml
   node_bundler = "nft"  # ✅ Not "esbuild"
   ```

2. **Check for transitive imports:** Import directly in function file
   ```javascript
   // ❌ Don't import through utilities
   import { trigger } from './utils/async-helper.mjs';
   
   // ✅ Import directly
   import { AsyncWorkloadsClient } from '@netlify/async-workloads';
   ```

3. **Check external_node_modules config:**
   ```toml
   external_node_modules = ["@netlify/async-workloads"]  # ✅ Must be present
   ```

4. **Check package.json:** Package must be in dependencies
   ```json
   "dependencies": {
     "@netlify/async-workloads": "^0.0.106"  # ✅ Required
   }
   ```

### Issue 3: Workload never executes

**Symptom:** Event sent successfully but handler never runs

**Solutions:**

1. **Check async_workloads flag:**
   ```toml
   [functions."my-handler"]
     async_workloads = true  # ✅ Required for handlers
   ```

2. **Check event name:** Must match between trigger and handler
   ```javascript
   // Trigger
   await client.send('my-event', { ... });
   
   // Handler config
   export const asyncWorkloadConfig = {
     events: ['my-event']  // ✅ Must match
   };
   ```

3. **Check eventFilter:** May be rejecting valid events
   ```javascript
   eventFilter: (event) => {
     console.log('Event received:', event); // Debug
     return true; // Temporarily accept all to test
   }
   ```

---

## Migration Checklist for Existing Functions

When converting an existing function to async workloads:

- [ ] Rename file from `.cjs` to `.mjs`
- [ ] Change `const X = require(...)` to `import X from '...'`
- [ ] Change `module.exports =` to `export` or `export default`
- [ ] Import `AsyncWorkloadsClient` directly in function (not through utility)
- [ ] Update netlify.toml:
  - [ ] Set `node_bundler = "nft"`
  - [ ] Add `external_node_modules = ["@netlify/async-workloads"]`
  - [ ] Add `async_workloads = true` for handlers
- [ ] Verify `@netlify/async-workloads` in package.json dependencies
- [ ] Test locally with `netlify dev`
- [ ] Verify build succeeds with `npm run build`
- [ ] Deploy and test in production

---

## Related Issues

- **Issue #276:** Deprecate generate-insights-background.cjs - Implemented async workloads
- **Issue #275:** Background insights processing improvements
- **Issue #274:** Async workload architecture design

All future async workload implementations MUST follow this guide to avoid the 250 MB bundle size issue and runtime errors.

---

## Additional Resources

- [Netlify Async Workloads Overview](https://docs.netlify.com/build/async-workloads/overview/)
- [Netlify Async Workloads API Reference](https://docs.netlify.com/build/async-workloads/writing-workloads/)
- [Node.js ES Modules Documentation](https://nodejs.org/api/esm.html)
- [NFT (Node File Trace) on GitHub](https://github.com/vercel/nft)

---

**Last Updated:** December 2025  
**Applies To:** Issues #274, #275, #276 and all future async workload implementations
