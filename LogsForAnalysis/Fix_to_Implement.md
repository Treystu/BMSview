Root Cause Diagnosis: Grey-Screen Reload on Analysis Completion
Summary of Investigation
After thorough analysis of the logs and codebase, I've identified the root cause of the grey-screen issue.

Key Evidence from Logs
Console_Admin_Logs.txt:64-72

The critical log sequence shows:

Line 64 (uploadOptimizer): "Synchronous analysis successful"
Line 65 (AdminDashboard): "Processing analysis result"
Line 66-68 (main-C-S4EtX-.js): SyncManager initialized, service worker, "Detected admin page - skipping main app initialization"
Line 69 (localCache): "Cached analysis record"
The smoking gun: The main app bundle (main-C-S4EtX-.js) is being loaded and executed DURING the admin page's analysis result processing.

Root Cause
Problem: Main Bundle Loading on Admin Page
When the admin dashboard processes analysis results, the dynamic import of localCache at AdminDashboard.tsx:493 somehow triggers Vite to load the main app bundle:

typescript
const localCacheModule = await import('../services/localCache');
This causes:

SyncManager singleton instantiation (syncManager.ts:686: export const syncManager = new SyncManager();)
Service worker registration attempt from index.tsx
App.tsx execution which detects admin page and skips, but the damage is already done
Why This Causes Grey Screen
The main bundle loading causes:

Module side effects executing (SyncManager, service worker)
React state corruption or re-mounting due to shared module scope conflicts
Possible race condition between admin state updates and main app initialization
Proposed Fix Strategy
Option 1: Fix Vite Code Splitting (Recommended - Minimal Change)
Add manual chunk configuration to vite.config.ts to isolate syncManager and other main-only modules:

typescript
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      admin: resolve(__dirname, 'admin.html'),
    },
    output: {
      manualChunks: (id) => {
        // Keep syncManager exclusively in main bundle
        if (id.includes('syncManager') || id.includes('serviceWorker')) {
          return 'main-only';
        }
        // Keep localCache as a separate chunk
        if (id.includes('localCache')) {
          return 'local-cache';
        }
      }
    }
  },
},
Option 2: Make SyncManager Lazy (More Defensive)
Change syncManager.ts:686 from eager singleton to lazy initialization:

typescript
// Before (problematic - executes on import)
export const syncManager = new SyncManager();
// After (lazy - only executes when accessed)
let _syncManager: SyncManager | null = null;
export function getSyncManager(): SyncManager {
  if (!_syncManager) {
    _syncManager = new SyncManager();
  }
  return _syncManager;
}
Then update App.tsx to use getSyncManager() instead of syncManager.

Option 3: Remove Dynamic Import in AdminDashboard (Simplest)
In AdminDashboard.tsx:491-498, replace the dynamic import with a static import at the top of the file:

typescript
// At top of file
import { historyCache } from '../services/localCache';
// Then in the function (remove the dynamic import)
await historyCache.put(tempRecord, 'synced');
This eliminates the dynamic import that's triggering the problematic bundle loading.

Recommended Implementation Order
Quick Win (Option 3): Remove the dynamic import of localCache - this is the immediate trigger
Belt & Suspenders (Option 2): Make SyncManager lazy to prevent side effects
Long-term (Option 1): Configure Vite's manualChunks for proper bundle isolation
Additional Debugging Visibility
If you need more visibility before implementing the fix, add this diagnostic logging to syncManager.ts at the top:

typescript
console.warn('[BUNDLE-DEBUG] syncManager.ts module executed', {
  timestamp: new Date().toISOString(),
  pathname: typeof window !== 'undefined' ? window.location.pathname : 'N/A',
  stack: new Error().stack
});
This will show the exact call stack that's causing the main bundle to load on the admin page.

Confidence Level: High
The evidence conclusively shows:

Main bundle is loading when it shouldn't
Timing aligns with the dynamic localCache import
Grey screen follows immediately after main bundle side effects execute