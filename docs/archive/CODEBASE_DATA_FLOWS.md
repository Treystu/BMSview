# BMSview Data Flows & Architecture

**Purpose:** Detailed data flow diagrams and architectural patterns  
**Last Updated:** 2025-11-05

---

## 🔄 Main Data Flows

### 1. Upload & Analysis Flow

```
User Upload
    ↓
UploadSection.tsx
    ↓
clientService.analyzeBmsScreenshot(file)
    ↓
analyze.cjs (Netlify Function)
    ├─ Extract file metadata
    ├─ Check for duplicates
    └─ Invoke generate-insights
    ↓
generate-insights.cjs
    ├─ Parse image with Gemini
    ├─ Extract battery measurements
    ├─ Generate AI insights
    └─ Store in MongoDB
    ↓
AppState.SYNC_ANALYSIS_COMPLETE
    ↓
AnalysisResult.tsx (Display)
    ↓
User sees insights & recommendations
```

### 2. System Registration Flow

```
User clicks "Register System"
    ↓
PreAnalysisModal.tsx
    ↓
RegisterBms.tsx (Form)
    ↓
clientService.registerBmsSystem(data)
    ↓
systems.cjs (Netlify Function)
    ├─ Validate input
    ├─ Create BmsSystem record
    └─ Store in MongoDB
    ↓
AppState.REGISTER_SYSTEM_SUCCESS
    ↓
clientService.linkAnalysisToSystem(recordId, systemId)
    ↓
systems.cjs (Link operation)
    ├─ Update AnalysisRecord.systemId
    └─ Update MongoDB
    ↓
UI updates with linked system
```

### 3. Analysis History Retrieval

```
AdminDashboard.tsx mounts
    ↓
clientService.getAnalysisHistory(page, limit)
    ↓
history.cjs (Netlify Function)
    ├─ Query MongoDB with pagination
    ├─ Apply filters (systemId, dateRange)
    └─ Return paginated results
    ↓
AdminState.FETCH_PAGE_DATA_SUCCESS
    ↓
Display history table with pagination
```

### 4. System Management Flow

```
Admin selects systems
    ↓
AdminDashboard.tsx
    ↓
clientService.mergeBmsSystems(primaryId, secondaryIds)
    ↓
systems.cjs
    ├─ Merge system records
    ├─ Update all linked analyses
    └─ Delete secondary systems
    ↓
MongoDB updated
    ↓
AdminState updated
    ↓
UI refreshes with merged systems
```

### 5. Weather Data Integration

```
Analysis complete
    ↓
generate-insights.cjs
    ├─ Extract location from analysis
    └─ Call weather.cjs
    ↓
weather.cjs
    ├─ Query weather API
    ├─ Cache in MongoDB
    └─ Return weather data
    ↓
Correlate with battery data
    ↓
Include in insights
```

### 6. Solar Estimation Flow

```
User requests solar estimate
    ↓
SolarEstimatePanel.tsx
    ↓
clientService.getSolarEstimate(location, capacity)
    ↓
solar-estimate.ts (Netlify Function)
    ├─ Query solar API
    ├─ Calculate generation
    └─ Estimate battery charging
    ↓
SolarIntegrationDashboard.tsx
    ↓
Display solar data & correlation
```

---

## 🏗️ Component Hierarchy

```
App.tsx (Main)
├── Header.tsx
├── UploadSection.tsx
│   └── BulkUpload.tsx
├── AnalysisResult.tsx
│   ├── PreAnalysisModal.tsx
│   ├── RegisterBms.tsx
│   └── EditSystemModal.tsx
├── AnalysisHistory.tsx
│   └── HistoricalChart.tsx
├── SolarIntegrationDashboard.tsx
│   ├── SolarEstimatePanel.tsx
│   └── SolarEfficiencyChart.tsx
└── Footer.tsx

admin.tsx (Admin)
└── AdminDashboard.tsx
    ├── BulkUpload.tsx
    ├── HistoricalChart.tsx
    ├── DiagnosticsModal.tsx
    └── IpManagement.tsx
```

---

## 🗄️ Database Schema Relationships

```
BmsSystem (1)
    ↓ (1:N)
AnalysisRecord (N)
    ├─ dlNumber (FK to BmsSystem)
    ├─ systemId (FK to BmsSystem)
    └─ analysisData: BatteryMeasurement[]

AnalysisHistory (N)
    ├─ systemId (FK to BmsSystem)
    ├─ recordId (FK to AnalysisRecord)
    └─ timestamp

WeatherData (N)
    ├─ location
    ├─ timestamp
    └─ correlatedWith: AnalysisRecord[]
```

---

## 🔐 Authentication & Authorization

### Frontend Authentication
```
admin.tsx
    ↓
window.netlifyIdentity.init()
    ↓
Netlify Identity Widget
    ├─ Login
    ├─ Logout
    └─ User context
    ↓
AdminDashboard.tsx (Protected)
```

### Backend Authorization
```
Netlify Function receives request
    ↓
Check Authorization header
    ├─ Valid token → Process request
    └─ Invalid token → Return 401
    ↓
Execute function logic
    ↓
Return response
```

---

## 📊 State Management Flow

### AppState Flow
```
Initial State
    ↓
User uploads file
    ↓
PREPARE_ANALYSIS (add to results)
    ↓
UPDATE_ANALYSIS_STATUS (update status)
    ↓
SYNC_ANALYSIS_COMPLETE (mark complete)
    ↓
ANALYSIS_COMPLETE (clear loading)
    ↓
Display results
```

### AdminState Flow
```
Initial State
    ↓
FETCH_PAGE_DATA_START
    ↓
Query MongoDB
    ↓
FETCH_PAGE_DATA_SUCCESS
    ↓
Update systems & history
    ↓
Display admin panel
    ↓
User performs action (merge, delete, etc.)
    ↓
ACTION_START (set loading flag)
    ↓
Execute action
    ↓
ACTION_SUCCESS (update state)
    ↓
Refresh display
```

---

## 🔌 API Endpoint Patterns

### Netlify Function URLs
```
/.netlify/functions/analyze
/.netlify/functions/generate-insights
/.netlify/functions/upload
/.netlify/functions/systems
/.netlify/functions/history
/.netlify/functions/weather
/.netlify/functions/solar-estimate
/.netlify/functions/admin-diagnostics
/.netlify/functions/admin-systems
```

### Request/Response Pattern
```
Request:
{
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
}

Response:
{
  statusCode: 200,
  body: JSON.stringify({
    success: true,
    data: {...},
    timestamp: ISO8601
  })
}
```

---

## 🔄 Error Handling Flow

```
Function receives request
    ↓
Try-catch wrapper
    ├─ Validation error → 400
    ├─ Not found → 404
    ├─ Unauthorized → 401
    ├─ Rate limited → 429
    ├─ Server error → 500
    └─ Success → 200
    ↓
Log error with context
    ↓
Return error response
    ↓
Frontend catches error
    ↓
Display user-friendly message
    ↓
Log to console for debugging
```

---

## 🚀 Deployment Architecture

```
GitHub Repository
    ↓
Push to main branch
    ↓
Netlify detects change
    ↓
Build Process
    ├─ npm install
    ├─ npm run build
    └─ Generate dist/
    ↓
Deploy Functions
    ├─ Compile .cjs files
    ├─ Compile .ts files
    └─ Deploy to Netlify
    ↓
Deploy Static Assets
    ├─ Upload dist/ to CDN
    └─ Configure routing
    ↓
Live at netlify.app
```

---

## 📈 Performance Optimization Patterns

### Database Query Optimization
```
Unoptimized:
SELECT * FROM analysis_records

Optimized:
SELECT _id, systemId, timestamp, insights
FROM analysis_records
WHERE systemId = ? AND timestamp > ?
LIMIT 50
INDEX: (systemId, timestamp)
```

### Frontend Caching
```
Service Layer
    ↓
Cache layer (in-memory)
    ├─ Cache hit → Return cached data
    └─ Cache miss → Fetch from API
    ↓
Store in cache
    ↓
Return to component
```

### Pagination Pattern
```
Request: page=1, limit=25
    ↓
Calculate offset: (page - 1) * limit
    ↓
Query: SKIP offset LIMIT limit
    ↓
Return: { items: [...], total: N, page: 1 }
    ↓
Frontend: Display page + pagination controls
```

---

## 🔍 Debugging Patterns

### Logging Flow
```
Function execution
    ↓
createLogger(functionName, context)
    ↓
log.info('Event', { context })
    ↓
Structured JSON output
    ↓
Netlify Function Logs
    ↓
Browser Console (frontend)
```

### Error Tracking
```
Error occurs
    ↓
Catch block
    ↓
log.error('Error message', { error, stack, context })
    ↓
Return error response
    ↓
Frontend displays error
    ↓
Developer checks logs
```

---

## 🎯 Key Integration Points

| Integration | Purpose | Flow |
|-------------|---------|------|
| Gemini AI | Insights generation | analyze → generate-insights → Gemini API |
| MongoDB | Data persistence | Functions → MongoDB client → Collections |
| Weather API | Weather data | weather.cjs → Weather API → Cache |
| Solar API | Solar estimation | solar-estimate.ts → Solar API |
| Netlify Identity | Authentication | admin.tsx → Netlify Identity Widget |

---

**Use this document to understand how data flows through the application and how components interact.**

