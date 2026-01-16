# BMSview Code Unification Plan

## Current State Analysis
The codebase has duplicate files in both root and src/ directories. The app uses a hybrid approach:
- Runtime: Uses src/ versions (HTML files point to src/)
- Build/Test: Uses root versions (tailwind.config.js, test files)

## Files Requiring Changes

### 1. src/App.tsx
**Missing from src/ version (present in root/App.tsx):**
- Line 9: Change `import syncManager from '@/services/syncManager';` to `import { getSyncManager } from '@/services/syncManager';`
- Line 12: Change `associateDlToSystem` to `associateHardwareIdToSystem`
- Line 18: Remove `'./src/services/uploadService'` import (should be from `'./services/uploadService'`)
- Line 19: Remove `'./src/utils/uploadOptimizer'` import (should be from `'./utils/uploadOptimizer'`)
- Lines 3-8: Remove debug logging from src/ version

### 2. src/index.tsx
**Missing from src/ version (present in root/index.tsx):**
- Line 6: Change `import { registerServiceWorker } from './serviceWorker';` to `import { registerServiceWorker } from './src/serviceWorker';`

### 3. src/admin.tsx
**Missing from src/ version (present in root/admin.tsx):**
- Line 6: Change `netlifyIdentity?: NetlifyIdentityWidget` to `netlifyIdentity: any`

### 4. tailwind.config.js
**Current (line 6):** `"./App.tsx"`
**Change to:** `"./src/App.tsx"`

### 5. Test Files
**Files to update:**
- `tests/duplicate-check-state-fix.test.js`
  - Line 69: Change `../App.tsx` to `../src/App.tsx`
  - Line 85: Change `../App.tsx` to `../src/App.tsx`
  - Line 97: Change `../App.tsx` to `../src/App.tsx`
  - Line 107: Change `../App.tsx` to `../src/App.tsx`
  - Line 131: Change `../App.tsx` to `../src/App.tsx`
  - Line 146: Change `../App.tsx` to `../src/App.tsx`

## Step-by-Step Execution Plan

### Phase 1: Preparation
1. Create backup branch: `git checkout -b backup-before-unification`
2. Create working branch: `git checkout -b unification-changes`

### Phase 2: Merge Differences (Test after each step)
1. **Fix src/App.tsx**
   - Update imports to match root version
   - Remove debug logging
   - Test: `npm run build && npm run dev`

2. **Fix src/index.tsx**
   - Update serviceWorker import path
   - Test: `npm run build && npm run dev`

3. **Fix src/admin.tsx**
   - Update netlifyIdentity type
   - Test: `npm run build && npm run dev`

### Phase 3: Update References
4. **Update tailwind.config.js**
   - Change App.tsx reference to src/App.tsx
   - Test: `npm run build`

5. **Update test files**
   - Change all App.tsx references to src/App.tsx
   - Test: `npm test`

### Phase 4: Cleanup (DANGEROUS - Verify first)
6. **Remove root duplicates ONLY IF:**
   - All tests pass
   - Build succeeds
   - App works in browser
   - No broken imports

**Files to remove:**
- `admin.tsx`
- `App.tsx`
- `index.tsx`
- `types.ts`
- `utils.ts`
- `state/` directory
- `services/` directory
- `components/` directory

## Verification Checklist
- [ ] Build succeeds: `npm run build`
- [ ] Dev server starts: `npm run dev`
- [ ] Main app loads: http://localhost:5173
- [ ] Admin app loads: http://localhost:5174/admin.html
- [ ] Tests pass: `npm test`
- [ ] No import errors in console
- [ ] All functionality works

## Rollback Plan
If anything breaks:
1. `git checkout backup-before-unification`
2. `git checkout main --force`
3. `git push origin main --force`

## Notes
- The src/ versions are more recent and have better TypeScript types
- Root versions have some legacy imports that need updating
- Test files and tailwind config are the main blockers for removing root files
- Proceed with caution and test after each change