# BMSview Complete Codebase Reference

**Last Updated:** 2025-11-05  
**Project:** BMSview - Battery Management System Analysis Platform  
**Tech Stack:** React 18 + TypeScript + Vite | Node.js 20 | MongoDB | Google Gemini AI

---

## 📋 Quick Navigation

### Core Entry Points
- **Frontend:** `index.tsx` → `App.tsx` (main app) | `admin.tsx` (admin portal)
- **Backend:** `netlify/functions/` (serverless functions)
- **State:** `state/appState.tsx` | `state/adminState.tsx`
- **Services:** `services/clientService.ts` | `services/geminiService.ts`

---

## 🏗️ Architecture Overview

### Frontend Architecture
```
index.tsx (React root)
  ↓
App.tsx (main app) / admin.tsx (admin)
  ↓
AppStateProvider / AdminStateProvider (Context)
  ↓
Components (UploadSection, AnalysisResult, AdminDashboard, etc.)
  ↓
Services (clientService, geminiService, solarService, weatherService)
  ↓
Netlify Functions (Backend APIs)
```

### Backend Architecture
```
Netlify Functions (Node.js 20)
  ├── analyze.cjs - File analysis orchestration
  ├── generate-insights.cjs - AI insights generation
  ├── upload.cjs - File upload & duplicate detection
  ├── systems.cjs - BMS system management
  ├── history.cjs - Analysis history retrieval
  ├── weather.cjs - Weather data integration
  ├── solar-estimate.ts - Solar estimation
  ├── admin-diagnostics.cjs - System diagnostics
  └── utils/ - Shared utilities
      ├── logger.cjs - Structured logging
      ├── mongodb.cjs - Database client
      ├── config.cjs - Configuration management
      └── battery-analysis.cjs - Analysis helpers
```

---

## 📦 Key Components & Services

### Frontend Components
| Component | Purpose |
|-----------|---------|
| `UploadSection` | File upload interface |
| `AnalysisResult` | Display analysis results |
| `AdminDashboard` | Admin management panel |
| `HistoricalChart` | Battery data visualization |
| `SolarIntegrationDashboard` | Solar correlation display |
| `BulkUpload` | Batch file upload |

### Services Layer
| Service | Purpose |
|---------|---------|
| `clientService.ts` | API calls to Netlify functions |
| `geminiService.ts` | Gemini AI integration |
| `solarService.ts` | Solar API integration |
| `weatherService.ts` | Weather data fetching |

### State Management
| State | Purpose |
|-------|---------|
| `AppState` | Main app state (results, loading, systems) |
| `AdminState` | Admin panel state (systems, history, actions) |

---

## 🔌 Netlify Functions Reference

### Core Functions
- **analyze.cjs** - Orchestrates file analysis pipeline
- **generate-insights.cjs** - Generates AI-powered battery insights
- **upload.cjs** - Handles file uploads with duplicate detection
- **systems.cjs** - CRUD operations for BMS systems
- **history.cjs** - Retrieves analysis history with pagination

### Integration Functions
- **weather.cjs** - Fetches weather data for correlation
- **solar-estimate.ts** - Estimates solar generation
- **admin-diagnostics.cjs** - Runs system health checks

### Data Flow
```
Upload → analyze.cjs → generate-insights.cjs → MongoDB
                    ↓
              geminiService (AI)
                    ↓
              Battery Insights
```

---

## 🗄️ Database Schema

### Collections
- **bms_systems** - Registered BMS systems
- **analysis_records** - Analysis results
- **analysis_history** - Historical analysis data
- **jobs** - Job queue (legacy)
- **weather_data** - Cached weather information

### Key Indexes
- `bms_systems`: `dlNumber`, `systemId`
- `analysis_records`: `systemId`, `timestamp`, `dlNumber`
- `analysis_history`: `systemId`, `createdAt`

---

## 🔑 Type Definitions

### Core Types (`types/index.ts`)
```typescript
BatteryMeasurement - Single measurement point
BatteryAnalysisRequest - Analysis request payload
BatteryInsights - Analysis results
BatteryPerformanceMetrics - Performance data
BatteryEfficiencyMetrics - Efficiency data
AnalysisResponse - API response format
BmsSystem - Registered system
AnalysisRecord - Analysis record
```

---

## 🚀 Key Features

### 1. Battery Analysis
- Screenshot upload & OCR extraction
- AI-powered insights generation
- Performance trend analysis
- Efficiency calculations

### 2. System Management
- Register BMS systems
- Link analysis to systems
- Historical tracking
- Duplicate detection

### 3. Admin Features
- System diagnostics
- Bulk operations
- Data management
- Weather/Solar integration

### 4. Solar Integration
- Solar generation estimation
- Battery-solar correlation
- Efficiency metrics

---

## 📊 Data Flow Examples

### Upload & Analysis Flow
```
1. User uploads BMS screenshot
2. UploadSection → clientService.analyzeBmsScreenshot()
3. → analyze.cjs (orchestration)
4. → generate-insights.cjs (AI analysis)
5. → MongoDB (store results)
6. → UI updates with insights
```

### System Registration Flow
```
1. User initiates registration
2. AnalysisResult → clientService.registerBmsSystem()
3. → systems.cjs (create system)
4. → MongoDB (store system)
5. → Link analysis to system
```

---

## 🔧 Configuration

### Environment Variables
```
MONGODB_URI - MongoDB connection string
GEMINI_API_KEY - Google Gemini API key
WEATHER_API_KEY - Weather service API key
NETLIFY_SITE_URL - Netlify site URL
NODE_ENV - Environment (development/production)
```

### Config Module (`netlify/functions/utils/config.cjs`)
- Centralized configuration management
- Environment variable validation
- Default values for all settings

---

## 🧪 Testing

### Test Files
- `tests/insights-generation.*.test.js` - Insights generation tests
- `tests/upload-*.test.js` - Upload functionality tests
- `tests/duplicate-detection.test.js` - Duplicate detection tests
- `tests/function-calling.test.js` - Gemini function calling tests

### Running Tests
```bash
npm test                 # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

---

## 📝 Coding Standards

### BMSview Standards
1. Never duplicate export statements in same file
2. Merge duplicate tsconfig.json keys
3. Use npm for dependencies (never manually edit package.json)
4. In .js files, avoid require() for ES modules - use dynamic import()
5. For browser APIs (localStorage), check typeof !== 'undefined'
6. Test files use short timeouts (10-100ms), not production values
7. Avoid global afterEach assertions that break error-handling tests

---

## 🔗 Important Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies & scripts |
| `vite.config.ts` | Vite build configuration |
| `tsconfig.json` | TypeScript configuration |
| `jest.config.cjs` | Jest testing configuration |
| `netlify.toml` | Netlify deployment config |
| `tailwind.config.js` | Tailwind CSS configuration |

---

## 🚨 Common Issues & Solutions

### Issue: "No battery measurements provided"
**Solution:** Ensure analysisData is properly converted to measurements format in generate-insights.cjs

### Issue: Jobs stuck in Queued
**Solution:** Check MongoDB indexes and connection pooling in utils/mongodb.cjs

### Issue: Gemini API rate limiting
**Solution:** Implement circuit breaker and exponential backoff in utils/config.cjs

---

## 📚 Documentation Files

- `README.md` - Project overview
- `IMPLEMENTATION_GUIDE.md` - Implementation details
- `DEPLOYMENT_CHECKLIST.md` - Deployment steps
- `docs/DEVELOPMENT.md` - Development guide
- `GEMINI.md` - Gemini integration details

---

## 🎯 Next Steps for Development

1. **Review** this reference document
2. **Understand** the data flow from upload to insights
3. **Check** the specific component/function you're working on
4. **Follow** BMSview coding standards
5. **Run tests** before committing changes
6. **Build** to verify no errors: `npm run build`

---

**For questions or clarifications, refer to the specific documentation files or examine the source code directly.**

