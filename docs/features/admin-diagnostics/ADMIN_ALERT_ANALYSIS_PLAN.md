# Admin Alert Analysis Overhaul Plan

## Objective
Refactor the "Alert Analysis" in the Admin Dashboard to calculate and display the **duration** of alert events rather than the raw count of data points. This eliminates the issue where frequent screenshots during a single event inflate the error count. Additionally, group correlated alerts (e.g., varying SOC values) into single events.

## 1. Data Structure Design

### Alert Normalization
We will normalize alert strings to group variations together.

| Original Alert Pattern | Normalized Key |
|------------------------|----------------|
| `CRITICAL: High cell voltage imbalance: *mV` | `CRITICAL: High cell voltage imbalance` |
| `WARNING: Cell voltage imbalance detected: *mV` | `WARNING: Cell voltage imbalance detected` |
| `CRITICAL: High temperature detected: *°C` | `CRITICAL: High temperature detected` |
| `WARNING: High temperature detected: *°C` | `WARNING: High temperature detected` |
| `CRITICAL: MOS temperature is very high: *°C` | `CRITICAL: MOS temperature is very high` |
| `CRITICAL: Battery level is critical: *%` | `CRITICAL: Battery level is critical` |
| `WARNING: Low battery: *%` | `WARNING: Low battery` |

### Output Data Structure
The `system-analytics` endpoint will return a new `alertAnalysis` structure:

```typescript
interface AlertEventStats {
    alert: string;              // Normalized alert text
    count: number;              // Number of distinct events
    totalDurationMinutes: number; // Total duration of all events
    avgDurationMinutes: number; // Average duration per event
    firstSeen: string;          // ISO Timestamp
    lastSeen: string;           // ISO Timestamp
}

interface AlertAnalysis {
    events: AlertEventStats[];
    totalEvents: number;
    totalDurationMinutes: number;
}
```

## 2. Backend Implementation (`netlify/functions/system-analytics.cjs`)

### Logic Update
1.  **Sort Records**: Ensure `systemHistory` is sorted by timestamp ascending.
2.  **Normalize**: Create a helper to strip values from alert strings using Regex.
3.  **Event Loop**: Iterate through sorted records to track "Active Events".
    *   Maintain a map of `ActiveEvents`: `Key -> { startTime, lastTime }`.
    *   For each record:
        *   Get list of normalized alerts.
        *   **Update Existing**: If an alert is already active, update its `lastTime` to current record timestamp.
        *   **Start New**: If an alert is new, add to `ActiveEvents` with `startTime` = `lastTime` = current timestamp.
        *   **Close Ended**: If an active alert is **NOT** present in the current record:
            *   Calculate duration: `lastTime - startTime`.
            *   If duration is 0 (single point), assume a minimum duration (e.g., 5 mins) or just 0.
            *   Push to `FinishedEvents`.
            *   Remove from `ActiveEvents`.
    *   **Time Gaps**: If the time difference between records exceeds a threshold (e.g., 6 hours), close ALL active events to prevent spanning across large data gaps (e.g., system offline).
4.  **Aggregation**: Group `FinishedEvents` by alert key to calculate totals.

## 3. Frontend Implementation (`components/admin/AlertAnalysis.tsx`)

### UI Changes
1.  **Update Interface**: Update `AlertAnalysisProps` to match the new data structure.
2.  **Visuals**:
    *   Replace "Count" bar with "Duration" bar.
    *   Display "Total Duration" (e.g., "5h 30m") prominently.
    *   Show "Event Count" (e.g., "3 events") as secondary info.
    *   Keep the severity color coding (Red/Yellow/Blue).
3.  **Tooltip/Details**: Add hover title showing "Average duration: X mins".

## 4. Execution Steps
1.  **Modify Backend**: Update `netlify/functions/system-analytics.cjs` with the new aggregation logic.
2.  **Update Types**: Update `services/clientService.ts` with new interfaces.
3.  **Modify Frontend**: Update `components/admin/AlertAnalysis.tsx` to render the new stats.
4.  **Verify**: Check Admin Dashboard to ensure alerts are grouped and durations look correct.