# BMS Analyzer Local v2.0

A local BMS (Battery Management System) screenshot analyzer that extracts battery data using Gemini AI and stores results in CSV format.

## What's New in v2.0: Zero-Tolerance Timestamp Policy

**Version 2.0 introduces strict timestamp enforcement:**

- Timestamps are extracted **ONLY** from filenames via TimeAuthority
- Files without valid timestamps are **REJECTED** (not processed with fallbacks)
- No guessing, no file metadata, no AI hallucination
- Local time sovereignty: extracted times are preserved as-is (no UTC conversion)

### Required Filename Format

```
Screenshot_YYYYMMDD-HHMMSS.png
```

**Examples:**
- `Screenshot_20260126-130950.png` → `2026-01-26T13:09:50`
- `Screenshot_20260115-083022.png` → `2026-01-15T08:30:22`

Files not matching this pattern will be skipped with: **"Not meeting filename expectations"**

---

## Features

- 📸 **Upload BMS Screenshots** - Drag and drop or click to upload
- 🤖 **AI-Powered Extraction** - Uses Google Gemini Flash to extract battery metrics
- ⏱️ **Strict Timestamps** - Filename-based timestamps only (no guessing!)
- 🔄 **Automatic Deduplication** - Hash-based detection prevents duplicate processing
- 📊 **Full Data Extraction** - 30+ fields including voltages, currents, temperatures
- 🌤️ **Weather Integration** - Optional weather/solar data enrichment
- 📁 **CSV Output** - Clean, local CSV file that updates in place
- ⚙️ **UI-Based Settings** - Configure API keys directly in the browser

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Application

```bash
npm start
```

This will:
- Start the server at `http://localhost:3847`
- Automatically open your browser to the UI

### 3. Configure API Key

1. Open the **Settings** tab in the UI
2. Add your Gemini API key (get one from [Google AI Studio](https://makersuite.google.com/app/apikey))
3. Optionally add OpenWeatherMap API key for weather data

### 4. Upload Screenshots

- Drag and drop BMS screenshots or ZIP files
- Only files matching `Screenshot_YYYYMMDD-HHMMSS.png` will be processed
- Results are saved to `output/bms-data.csv`

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server (v2.0 modular version) |
| `npm run start:legacy` | Start the original server.js (v1.x) |
| `npm run dev` | Same as `npm start` (development) |
| `npm run build` | Build standalone macOS x64 executable |
| `npm run build:arm` | Build standalone macOS ARM executable |
| `npm run build:all` | Build for all platforms |

---

## Building a Standalone Executable

To create a standalone executable that doesn't require Node.js:

```bash
# Install pkg globally (one-time)
npm install -g pkg

# Build for your platform
npm run build        # macOS Intel
npm run build:arm    # macOS Apple Silicon
npm run build:all    # All platforms

# The executable will be in the dist/ folder
./dist/bms-analyzer
```

---

## Project Structure

```
bms-analyzer-local/
├── src/                      # v2.0 Modular codebase
│   ├── server.js             # Entry point
│   ├── app.js                # Express app setup
│   ├── routes/               # API route handlers
│   │   ├── index.js          # Route aggregator
│   │   ├── upload.js         # File upload & analysis
│   │   ├── history.js        # Data retrieval
│   │   ├── settings.js       # Configuration
│   │   └── refresh.js        # Background refresh (SSE)
│   ├── services/             # Business logic
│   │   ├── TimeAuthority.js  # Strict timestamp enforcer
│   │   ├── analyzer.js       # Gemini AI integration
│   │   ├── csv-store.js      # CSV persistence
│   │   ├── weather.js        # Weather/solar APIs
│   │   └── data-validator.js # Validation + timestamp auto-fix
│   └── prompts/
│       └── bms-system-v1.txt # AI extraction prompt
├── lib/                      # Original v1.x modules (still used)
├── public/                   # Frontend UI
├── output/                   # CSV output directory
├── server.js                 # Legacy entry point (v1.x)
└── package.json
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze` | POST | Upload and analyze screenshots |
| `/api/history` | GET | Get all analysis records |
| `/api/export` | GET | Download CSV file |
| `/api/settings` | GET/POST | Read/update settings |
| `/api/models` | GET | List available Gemini models |
| `/api/estimate/:modelId` | GET | Get cost estimate |
| `/api/refresh-stream` | GET | SSE stream for background refresh |
| `/api/backfill-weather` | POST | Backfill missing weather data |

---

## Data Output

All data is stored in `./output/bms-data.csv` with these columns:

| Column | Description |
|--------|-------------|
| id | Unique record ID |
| contentHash | SHA-256 hash of image (for dedup) |
| timestamp | When analysis was performed |
| **timestampFromFilename** | **Authoritative timestamp from filename** |
| hardwareSystemId | System ID from BMS (e.g., DL-12345) |
| stateOfCharge | SOC percentage |
| overallVoltage | Total pack voltage |
| current | Current (negative = discharge) |
| power | Power in watts |
| remainingCapacity | Remaining capacity (Ah) |
| fullCapacity | Full capacity (Ah) |
| cycleCount | Charge/discharge cycles |
| chargeMosOn | Charge MOSFET status |
| dischargeMosOn | Discharge MOSFET status |
| balanceOn | Balancing status |
| highestCellVoltage | Maximum cell voltage |
| lowestCellVoltage | Minimum cell voltage |
| averageCellVoltage | Average cell voltage |
| cellVoltageDifference | Max-min voltage spread |
| temperature_1-4 | Temperature sensors |
| mosTemperature | MOSFET temperature |
| cellVoltages | JSON array of all cell voltages |
| status | Normal/Warning/Critical |
| alerts | JSON array of alerts |
| weather_* | Weather data (if configured) |
| solar_* | Solar irradiance data |

---

## Environment Variables

Create a `.env` file in the project root (optional):

```env
PORT=3847
DEBUG=true
```

API keys should be configured through the UI Settings tab (stored in `settings.json`).

---

## API Keys Summary

| Service | Required | Purpose | Get Key |
|---------|----------|---------|---------|
| Google Gemini | ✅ Yes | Image analysis & data extraction | [AI Studio](https://makersuite.google.com/app/apikey) |
| OpenWeatherMap | ❌ No | Weather data enrichment | [OpenWeatherMap](https://openweathermap.org/api) |

---

## Troubleshooting

### "Not meeting filename expectations"

Your screenshot filename doesn't match the required pattern. Rename it to:
```
Screenshot_YYYYMMDD-HHMMSS.png
```

### "Gemini API key not configured"

1. Go to Settings tab
2. Enter your Gemini API key
3. Click "Save Key"

### "This screenshot was already analyzed"

The image hash matches a previous upload. This is expected behavior - duplicates are skipped to save API costs.

### Missing weather/solar data

1. Go to Settings tab
2. Enter latitude and longitude
3. (Optional) Add OpenWeatherMap API key for weather data
4. Click "Refresh" on the History tab to backfill

### CSV file not found

Upload at least one screenshot first. The CSV is created on the first successful analysis.

---

## License

MIT
