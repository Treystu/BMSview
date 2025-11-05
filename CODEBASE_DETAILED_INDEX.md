# BMSview Detailed Component & Function Index

**Purpose:** Complete reference of all components, functions, and their locations  
**Last Updated:** 2025-11-05

---

## 📁 Frontend Components

### Main Application
- **App.tsx** - Main app component with upload, analysis, and registration
- **admin.tsx** - Admin portal with Netlify Identity authentication
- **index.tsx** - React root entry point

### Core Components
| Component | File | Purpose |
|-----------|------|---------|
| UploadSection | `components/UploadSection.tsx` | File upload interface |
| AnalysisResult | `components/AnalysisResult.tsx` | Display analysis results |
| AdminDashboard | `components/AdminDashboard.tsx` | Admin management panel |
| HistoricalChart | `components/HistoricalChart.tsx` | Battery data visualization |
| RegisterBms | `components/RegisterBms.tsx` | System registration form |
| BulkUpload | `components/BulkUpload.tsx` | Batch upload interface |

### UI Components
| Component | File | Purpose |
|-----------|------|---------|
| Header | `components/Header.tsx` | Navigation header |
| Footer | `components/Footer.tsx` | Page footer |
| Hero | `components/Hero.tsx` | Landing hero section |
| Features | `components/Features.tsx` | Features showcase |
| About | `components/About.tsx` | About section |
| Contact | `components/Contact.tsx` | Contact form |

### Feature Components
| Component | File | Purpose |
|-----------|------|---------|
| SolarIntegrationDashboard | `components/SolarIntegrationDashboard.tsx` | Solar data display |
| SolarEstimatePanel | `components/SolarEstimatePanel.tsx` | Solar estimates |
| SolarEfficiencyChart | `components/SolarEfficiencyChart.tsx` | Solar efficiency viz |
| AnalysisHistory | `components/AnalysisHistory.tsx` | Historical analysis view |
| DiagnosticsModal | `components/DiagnosticsModal.tsx` | System diagnostics |
| EditSystemModal | `components/EditSystemModal.tsx` | System editing |
| PreAnalysisModal | `components/PreAnalysisModal.tsx` | Pre-analysis options |
| IpManagement | `components/IpManagement.tsx` | IP management |

### Admin Components
- `components/admin/` - Admin-specific sub-components

---

## 🔧 Services Layer

### clientService.ts
**Purpose:** API client for Netlify functions

**Key Functions:**
- `analyzeBmsScreenshot(file)` - Upload and analyze screenshot
- `registerBmsSystem(data)` - Register new BMS system
- `getRegisteredSystems(page, limit)` - Fetch systems
- `getAnalysisHistory(page, limit)` - Fetch analysis history
- `linkAnalysisToSystem(recordId, systemId)` - Link analysis to system
- `deleteAnalysisRecord(recordId)` - Delete analysis record
- `runDiagnostics(tests)` - Run system diagnostics
- `streamAllHistory()` - Stream all history data
- `findDuplicateAnalysisSets()` - Find duplicate analyses
- `mergeBmsSystems(primaryId, secondaryIds)` - Merge systems
- `autoAssociateRecords()` - Auto-associate records
- `backfillWeatherData()` - Backfill weather data

### geminiService.ts
**Purpose:** Gemini AI integration

**Key Functions:**
- `analyzeBmsScreenshot(file)` - Analyze screenshot with Gemini
- `extractDataFromImage(file)` - Extract data from image
- `generateInsights(data)` - Generate AI insights

### solarService.ts
**Purpose:** Solar API integration

**Key Functions:**
- `estimateSolarGeneration(location, capacity)` - Estimate solar output
- `getSolarData(systemId)` - Get solar data for system
- `correlateWithBattery(solarData, batteryData)` - Correlate data

### weatherService.ts
**Purpose:** Weather data integration

**Key Functions:**
- `getWeatherData(location)` - Fetch weather data
- `getHistoricalWeather(location, date)` - Get historical weather
- `correlateWithAnalysis(weatherData, analysisData)` - Correlate data

---

## 🔌 Netlify Functions

### Core Functions
| Function | File | Purpose |
|----------|------|---------|
| analyze | `netlify/functions/analyze.cjs` | Orchestrate analysis |
| generate-insights | `netlify/functions/generate-insights.cjs` | AI insights |
| upload | `netlify/functions/upload.cjs` | File upload |
| systems | `netlify/functions/systems.cjs` | System CRUD |
| history | `netlify/functions/history.cjs` | History retrieval |

### Integration Functions
| Function | File | Purpose |
|----------|------|---------|
| weather | `netlify/functions/weather.cjs` | Weather data |
| solar-estimate | `netlify/functions/solar-estimate.ts` | Solar estimation |
| admin-diagnostics | `netlify/functions/admin-diagnostics.cjs` | System diagnostics |
| admin-systems | `netlify/functions/admin-systems.cjs` | Admin system ops |

### Utility Functions
| Function | File | Purpose |
|----------|------|---------|
| logger | `netlify/functions/utils/logger.cjs` | Structured logging |
| mongodb | `netlify/functions/utils/mongodb.cjs` | DB client |
| config | `netlify/functions/utils/config.cjs` | Configuration |
| battery-analysis | `netlify/functions/utils/battery-analysis.cjs` | Analysis helpers |
| gemini-tools | `netlify/functions/utils/gemini-tools.cjs` | Gemini tools |
| validation | `netlify/functions/utils/validation.cjs` | Input validation |
| errors | `netlify/functions/utils/errors.cjs` | Error handling |

---

## 🎣 Custom Hooks

### useFileUpload.ts
**Purpose:** Handle file upload logic

**Functions:**
- `useFileUpload()` - Main hook for file uploads

### useJobPolling.ts (Legacy)
**Purpose:** Poll job status (deprecated)

---

## 📊 State Management

### appState.tsx
**State Interface:**
```typescript
AppState {
  analysisResults: DisplayableAnalysisResult[]
  isLoading: boolean
  error: string | null
  isRegistering: boolean
  registrationError: string | null
  registrationSuccess: string | null
  isRegisterModalOpen: boolean
  registeredSystems: PaginatedResponse<BmsSystem>
  analysisHistory: PaginatedResponse<AnalysisRecord>
  registrationContext: { dlNumber: string } | null
}
```

**Actions:**
- PREPARE_ANALYSIS
- UPDATE_ANALYSIS_STATUS
- SYNC_ANALYSIS_COMPLETE
- ANALYSIS_COMPLETE
- SET_ERROR
- FETCH_DATA_SUCCESS
- OPEN_REGISTER_MODAL
- CLOSE_REGISTER_MODAL
- REGISTER_SYSTEM_START/SUCCESS/ERROR

### adminState.tsx
**State Interface:**
```typescript
AdminState {
  systems: BmsSystem[]
  history: AnalysisRecord[]
  historyCache: AnalysisRecord[]
  loading: boolean
  error: string | null
  systemsPage: number
  historyPage: number
  totalSystems: number
  totalHistory: number
  actionStatus: { [key: string]: boolean }
  // ... more fields
}
```

---

## 🗂️ Utility Functions

### utils/battery-analysis.cjs
- `buildPrompt(systemId, data, customPrompt)` - Build AI prompt
- `parseInsights(text, batteryData)` - Parse AI response
- `calculateRuntimeEstimate(measurements, config)` - Estimate runtime
- `generateGeneratorRecommendations(runtime, power)` - Generator recs
- `fallbackTextSummary(batteryData)` - Fallback analysis

### utils/solarCorrelation.ts
- `correlateWithSolar(batteryData, solarData)` - Correlate data
- `calculateEfficiency(batteryData, solarData)` - Calculate efficiency

### utils/logger.cjs
- `createLogger(name, context)` - Create logger instance
- `createTimer(logger, name)` - Create timer

---

## 📝 Type Definitions

### types/index.ts
- `BatteryMeasurement` - Single measurement
- `BatteryAnalysisRequest` - Request payload
- `BatteryInsights` - Analysis results
- `BatteryPerformanceMetrics` - Performance data
- `BatteryEfficiencyMetrics` - Efficiency data
- `AnalysisResponse` - API response
- `BmsSystem` - System definition
- `AnalysisRecord` - Analysis record
- `DisplayableAnalysisResult` - UI result
- `PaginatedResponse<T>` - Paginated response

### types/solar.ts
- `SolarData` - Solar measurement
- `SolarEstimate` - Solar estimate
- `SolarCorrelation` - Correlation data

---

## 🧪 Test Files

### Unit Tests
- `tests/insights-generation.test.js` - Insights generation
- `tests/insights-generation.clean.test.js` - Clean handler
- `tests/insights-generation.comprehensive.test.js` - Comprehensive
- `tests/insights-generation.simple.test.js` - Simple scenarios
- `tests/upload-functionality.test.js` - Upload tests
- `tests/upload-optimization.test.js` - Optimization tests
- `tests/duplicate-detection.test.js` - Duplicate detection
- `tests/function-calling.test.js` - Gemini function calling

---

## 🔍 Key Data Structures

### BmsSystem
```typescript
{
  _id: ObjectId
  dlNumber: string
  systemId: string
  name: string
  location: string
  capacity: number
  voltage: number
  createdAt: Date
  updatedAt: Date
}
```

### AnalysisRecord
```typescript
{
  _id: ObjectId
  fileName: string
  dlNumber: string
  systemId: string
  analysisData: BatteryMeasurement[]
  insights: BatteryInsights
  timestamp: Date
  createdAt: Date
}
```

---

## 🚀 Quick Reference

**To find a component:** Search `components/` directory  
**To find a service:** Check `services/` directory  
**To find a function:** Check `netlify/functions/` directory  
**To find types:** Check `types/` directory  
**To find utilities:** Check `utils/` or `netlify/functions/utils/`  
**To find tests:** Check `tests/` directory  

---

**Use this index to quickly locate any component, service, or function in the codebase.**

