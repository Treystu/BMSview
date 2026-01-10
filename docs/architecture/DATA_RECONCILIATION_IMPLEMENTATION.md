# Data Reconciliation Dashboard - Implementation Summary

## Overview
This implementation transforms the admin panel's "Combine Duplicate Systems" feature into a comprehensive **Data Reconciliation Dashboard** that provides centralized management of all DL-# (Data Logger) sources in the database.

## What Was Built

### 1. Backend: Data Integrity Endpoint
**File:** `netlify/functions/admin-data-integrity.cjs`

**Purpose:** Audit all DL-# records in the database and categorize them as MATCHED or ORPHAN.

**Key Features:**
- MongoDB aggregation pipeline groups all analysis records by `dlNumber` (DL-#)
- Counts total records per DL-#, tracks first/last seen timestamps
- Cross-references with registered BMS systems to identify orphans
- Returns structured JSON with summary statistics

**API Endpoint:** `GET /.netlify/functions/admin-data-integrity`

**Response Format:**
```json
{
  "summary": {
    "total_dl_sources": 10,
    "matched": 8,
    "orphaned": 2,
    "total_records": 15420,
    "orphaned_records": 50
  },
  "data": [
    {
      "dl_id": "DL-240",
      "record_count": 15420,
      "status": "MATCHED",
      "system_id": "abc123",
      "system_name": "Cabin A",
      "first_seen": "2023-01-01T00:00:00Z",
      "last_seen": "2024-11-23T12:00:00Z",
      "system_chemistry": "LiFePO4",
      "system_voltage": 51.2,
      "system_capacity": 280
    },
    {
      "dl_id": "DL-999",
      "record_count": 50,
      "status": "ORPHAN",
      "system_id": null,
      "system_name": null,
      "first_seen": "2023-01-01T00:00:00Z",
      "last_seen": "2023-01-10T00:00:00Z"
    }
  ],
  "timestamp": "2024-11-24T02:00:00Z"
}
```

### 2. Frontend: Reconciliation Dashboard Component
**File:** `components/admin/reconciliation/ReconciliationDashboard.tsx`

**Key Features:**

#### Summary Cards
- **Total DL Sources**: Count of unique DL-# identifiers
- **Matched (Healthy)**: DL-#s with associated systems
- **Orphaned**: DL-#s needing adoption
- **Orphaned Records**: Total analysis records without systems

#### Orphaned Data Sources Table
Displays all DL-# sources without associated BMS systems:
- **Columns:** DL-#, Record Count, Date Range, Previously Linked System, Actions
- **Action:** "Adopt System" button opens modal to create new system
- **Auto-refresh** capability to update after adoption

#### System Status & Management Table
Shows all registered systems with their linked DL-#s:
- **Columns:** Checkbox (for merge), System Name, Linked DL-#s, Total Records, Chemistry, Actions
- **Features:**
  - Select multiple systems for merging
  - Edit system details (future enhancement)
  - Display all associated DL-# badges
  - Show total record counts per system

#### Merge Systems Controls
When 2+ systems are selected:
- **Primary System Selector**: Choose which system to keep
- **Merge Button**: Combines selected systems
- **Cancel Button**: Clears selections

### 3. Enhanced EditSystemModal
**File:** `components/EditSystemModal.tsx`

**New Features:**
- **Create Mode**: Accepts `null` for system prop to create new systems
- **Initial Data**: Pre-fills form with `initialData` prop
- **Chemistry Dropdown**: Replaced text input with select menu (LiFePO4, LiPo, LiIon, LeadAcid, NiMH, Other)
- **Geolocation Support**: `enableGeolocation` prop triggers automatic GPS detection
- **"Use Current Location" Button**: Detects user's coordinates via browser API
- **Dynamic Title**: Shows "Edit System" or "Create New System"
- **Associated DLs Support**: Can create systems with pre-linked DL-#s

### 4. Updated Client Service
**File:** `services/clientService.ts`

**New/Updated Functions:**

#### `getDataIntegrity()`
```typescript
export const getDataIntegrity = async (): Promise<DataIntegrityResponse>
```
Fetches the data integrity audit from the backend.

#### Updated `registerBmsSystem()`
```typescript
export const registerBmsSystem = async (
    systemData: Omit<BmsSystem, 'id'>  // Now accepts associatedDLs
): Promise<BmsSystem>
```
Modified to accept `associatedDLs` array for creating systems with pre-linked DL-#s.

### 5. Admin Dashboard Integration
**File:** `components/AdminDashboard.tsx`

**Changes:**
- Added new "Data Reconciliation & System Management" section
- Renders `ReconciliationDashboard` component
- Wires up callbacks for system creation and merging
- Refreshes data after operations

## User Workflows

### Workflow 1: Adopt Orphaned DL-#
1. Admin opens Admin Dashboard
2. Scrolls to "Data Reconciliation & System Management"
3. Views orphaned DL-# sources in yellow warning table
4. Clicks "➕ Adopt System" for a DL-#
5. Modal opens with:
   - Pre-filled system name (e.g., "System for DL-240")
   - Pre-linked DL-# in Associated DLs field
   - Auto-detected GPS coordinates (if browser allows)
6. Admin fills in chemistry, voltage, capacity
7. Clicks "Create System"
8. System is created and linked to DL-#
9. Dashboard refreshes, DL-# moves to "matched" status

### Workflow 2: Merge Duplicate Systems
1. Admin views "System Status & Management" table
2. Checks checkboxes next to 2+ systems to merge
3. Selects primary system to keep from dropdown
4. Clicks "🔀 Merge X Systems"
5. Systems are merged (DL-#s combined, others deleted)
6. Dashboard refreshes with updated data

### Workflow 3: Monitor Data Health
1. Admin opens dashboard
2. Views summary cards at top:
   - Total DL Sources: 10
   - Matched: 8 (80% healthy)
   - Orphaned: 2 (needs attention)
   - Orphaned Records: 50 (wasted data)
3. Identifies orphans quickly via yellow warning section
4. Takes action to adopt or investigate

## Technical Implementation Details

### MongoDB Aggregation Pipeline
The backend uses an efficient aggregation pipeline:
1. **$match**: Filters for records with dlNumber present
2. **$group**: Groups by dlNumber, counts records, finds min/max timestamps
3. **$sort**: Orders by record count (descending) to prioritize high-impact orphans

### Geolocation API Integration
```typescript
navigator.geolocation.getCurrentPosition(
    (position) => {
        const { latitude, longitude } = position.coords;
        // Auto-fill form fields
    },
    (error) => {
        // Handle permission denied / error
    },
    {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    }
);
```

### State Management
The ReconciliationDashboard uses local state:
- `integrityData`: Full audit response from backend
- `loading`: Loading indicator
- `error`: Error message display
- `adoptingDL`: Currently adopting orphaned DL-#
- `selectedSystemIds`: Systems selected for merge
- `primarySystemId`: Primary system choice for merge

## Security Considerations
- Geolocation requires HTTPS in production (Netlify deployments)
- Browser permission prompt for location access
- All API calls go through existing authentication (Netlify Identity)
- MongoDB queries use projections to exclude internal `_id` fields

## Performance
- Aggregation pipeline runs on MongoDB server (efficient)
- Frontend caches integrity data until manual refresh
- Minimal re-renders via React state management
- Pagination not needed initially (typical deployments have <100 DL-#s)

## Future Enhancements
1. **Edit System Integration**: Wire up "✏️ Edit" button to open EditSystemModal
2. **Bulk Adoption**: Select multiple orphans and batch-create systems
3. **Auto-association Logic**: Automatically link orphans based on heuristics
4. **Conflict Detection**: Highlight when multiple systems claim same DL-#
5. **Export Functionality**: Download reconciliation report as CSV
6. **Filters/Search**: Filter orphans by date range, record count
7. **Real-time Updates**: WebSocket notifications when new orphans appear

## Testing Checklist
- [ ] Backend aggregation returns correct counts
- [ ] Orphaned DL-#s display in yellow warning table
- [ ] Matched systems show in green table
- [ ] "Adopt System" opens modal with pre-filled data
- [ ] Geolocation button detects coordinates
- [ ] Creating new system links DL-# correctly
- [ ] Merge functionality combines systems as expected
- [ ] Dashboard refreshes after operations
- [ ] Summary cards update accurately
- [ ] Error handling displays user-friendly messages

## Migration from Old "Combine Duplicate Systems"
The old "Combine Duplicate Systems" UI in `DataManagement.tsx` can be deprecated:
- Move merge logic to ReconciliationDashboard (already done)
- Remove checkbox table from DataManagement.tsx
- Keep other data management tools (backfill, cleanup, etc.)
- Update UI to reduce redundancy

## Deployment Notes
1. No database schema changes required (uses existing collections)
2. No environment variable changes needed
3. New backend function auto-deploys with Netlify Functions
4. Frontend changes bundled in standard Vite build
5. Backward compatible (old merge logic still works)
