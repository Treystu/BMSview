# Quick Integration Guide - Sync UI Components

## Adding Components to Your App

### 1. Add SyncStatusIndicator to Header

In your main `App.tsx` or wherever your Header is rendered:

```typescript
import SyncStatusIndicator from './components/SyncStatusIndicator';

// In your render:
<Header />
<SyncStatusIndicator />
```

This will show a bar displaying:
- Real-time sync status (✓ Synced / ↻ Syncing / ⚠ Error)
- Last sync time (e.g., "45s ago")
- Cache statistics (hits vs network requests)
- Pending items count
- "Sync Now" button
- Next sync countdown

### 2. Add DiagnosticsPanel to Admin Dashboard

In `components/AdminDashboard.tsx`:

```typescript
import DiagnosticsPanel from './components/DiagnosticsPanel';

// In your render, add a new section:
<section>
  <h2 className="text-2xl font-semibold text-secondary mb-4">
    Production Diagnostics
  </h2>
  <DiagnosticsPanel />
</section>
```

This will show:
- 7 selectable diagnostic tests
- Test selection checkboxes
- "Run Selected Tests" button
- Real-time results with status indicators
- Expandable detail sections
- Summary statistics

### 3. Initialize Sync Manager in App

In `App.tsx`, add useEffect to start periodic sync:

```typescript
import syncManager from './services/syncManager';

useEffect(() => {
  syncManager.startPeriodicSync();
  
  return () => {
    syncManager.stopPeriodicSync();
  };
}, []);
```

### 4. Integrate with AppState

The AppState already has the fields. When performing critical actions:

```typescript
import { useAppState } from './state/appState';

const { dispatch } = useAppState();

// After successful sync:
dispatch({
  type: 'UPDATE_SYNC_STATUS',
  payload: {
    isSyncing: false,
    lastSyncTime: { systems: Date.now() }
  }
});

// On error:
dispatch({
  type: 'SYNC_ERROR',
  payload: error.message
});
```

---

## Testing Checklist

- [ ] Components render without errors
- [ ] SyncStatusIndicator displays status
- [ ] Sync manager timer starts and updates
- [ ] Diagnostics panel opens and shows tests
- [ ] Can select/deselect tests
- [ ] Running tests calls `/admin-diagnostics` endpoint
- [ ] Results display correctly with icons
- [ ] Manual sync button works
- [ ] Cache statistics update in real-time
- [ ] Offline mode works (read-only)

---

## Environment Variables

Ensure these are set in `.env` or Netlify dashboard:

```bash
GEMINI_API_KEY=your_key
MONGODB_URI=your_connection_string
MONGODB_DB_NAME=bmsview
URL=https://your-netlify-app.netlify.app  # For production
LOG_LEVEL=INFO  # or DEBUG for development
```

---

## Troubleshooting

**Diagnostics endpoint returns 500**
- Check MONGODB_URI is correct
- Verify all sync fields exist in collections
- Check Netlify function logs

**Sync status stuck on "Syncing"**
- Check browser console for errors
- Verify network is working
- Check Netlify function logs for sync endpoints

**Cache not populating**
- Verify IndexedDB is enabled in browser
- Check `isLocalCacheEnabled()` returns true
- Check DevTools → Application → IndexedDB

**Timestamp validation failing**
- Ensure all `updatedAt` fields end with 'Z'
- Verify server uses UTC timezone
- Run cache integrity diagnostic

---

## Production Deployment

1. **Run all diagnostics locally first**
   ```bash
   netlify dev
   # Open admin panel, run all 7 diagnostics
   ```

2. **Deploy to Netlify**
   ```bash
   git push origin main
   ```

3. **Monitor in production**
   - Check Netlify function logs
   - Verify sync status in UI
   - Monitor MongoDB connection count
   - Check for any timeout errors

4. **Measure impact**
   - Compare MongoDB query counts before/after
   - Monitor cache hit rates
   - Check response times
   - Verify no data loss

---

## API Endpoints

### Sync Endpoints
- `GET /.netlify/functions/sync-metadata?collection=systems`
- `GET /.netlify/functions/sync-incremental?collection=systems&since=2025-11-09T10:00:00Z`
- `POST /.netlify/functions/sync-push`

### Diagnostics
- `POST /.netlify/functions/admin-diagnostics`
  - Body: `{ selectedTests: ['cache-integrity', 'sync-status', ...] }`

---

## Performance Expectations

After implementing local-first sync:

- **MongoDB Calls**: 90% reduction
- **App Load Time**: <1 second (from cache)
- **Upload Time**: <5 seconds (dual-write)
- **Periodic Sync**: <10 seconds
- **Cache Hits**: 70-80% of reads
- **Network Requests**: Only on user actions

---

## Support

For issues or questions:
1. Check diagnostic test results
2. Review browser console logs
3. Check Netlify function logs
4. Review MongoDB collection schema
5. Verify timestamp formats (UTC ISO 8601)
