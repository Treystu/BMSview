# Complete Fixes Implementation Plan

## Issue 1: Upload Disappearing (CRITICAL - Main Page)
**Problem:** In `UploadSection.tsx`, `clearFiles()` is called immediately after `onAnalyze()`, causing files to disappear before analysis completes.

**Location:** `components/UploadSection.tsx` line 50
```typescript
const handleAnalyzeClick = () => {
  if (files.length > 0) {
    log('info', 'Analyze button clicked.', { fileCount: files.length });
    onAnalyze(files);
    clearFiles(); // ❌ THIS CLEARS FILES IMMEDIATELY!
  }
};
```

**Fix:** Don't clear files immediately. Let the parent component manage when to clear.

## Issue 2: Upload Disappearing (CRITICAL - Admin Page)  
**Problem:** Same issue in `AdminDashboard.tsx` - files are cleared in the bulk upload flow.

**Fix:** Adjust the bulk upload flow to not clear files prematurely.

## Issue 3: SystemManager Placeholders (CRITICAL)
**Problem:** Hardcoded systems in `components/Admin/SystemManager.tsx`

**Fix:** 
1. Fetch systems from API on mount
2. Implement real POST for adding systems
3. Implement real DELETE for removing systems
4. Add backend POST/DELETE handlers

## Issue 4: HistoryManager Placeholders (CRITICAL)
**Problem:** Hardcoded history in `components/Admin/HistoryManager.tsx`

**Fix:**
1. Fetch history from API on mount
2. Implement real DELETE for removing records
3. Add backend DELETE handler

## Issue 5: Backend Missing Endpoints (CRITICAL)
**Problem:** `netlify/functions/systems.js` only has GET handler

**Fix:** Add POST, PUT, DELETE handlers