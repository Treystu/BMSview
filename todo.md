# BMSview Code Unification Plan

## Current State Analysis
The codebase has duplicate files in both root and src/ directories. The app uses a hybrid approach:
- Runtime: Uses src/ versions (HTML files point to src/)
- Build/Test: Uses root versions (tailwind.config.js, test files)

## Files Requiring Changes

### 1. src/App.tsx
**STATUS: src/ version is CORRECT, root version is outdated**
- src/App.tsx has proper imports and types
- root/App.tsx has old imports (associateDlToSystem, syncManager default, etc.)
- NO CHANGES NEEDED to src/App.tsx

### 2. src/index.tsx
**STATUS: src/ version is CORRECT, root version is outdated**
- src/index.tsx imports from './serviceWorker' which exists in src/
- root/index.tsx imports from './src/serviceWorker' (incorrect)
- NO CHANGES NEEDED to src/index.tsx

### 3. src/admin.tsx
**STATUS: src/ version is CORRECT, root version is outdated**
- src/admin.tsx has proper TypeScript types (NetlifyIdentityWidget)
- root/admin.tsx has 'any' type
- NO CHANGES NEEDED to src/admin.tsx

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

### Phase 2: Update References (Test after each step)
1. **Update tailwind.config.js**
   - Change App.tsx reference to src/App.tsx
   - Test: `npm run build`

2. **Update test files**
   - Change all App.tsx references to src/App.tsx
   - Test: `npm test`

### Phase 3: Cleanup (DANGEROUS - Verify first)
3. **Remove root duplicates ONLY IF:**
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