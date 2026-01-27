# BMS Analyzer Local

A simplified, local-only version of the BMS (Battery Management System) screenshot analyzer. Upload BMS screenshots, extract battery data using Gemini AI, and store results in a local CSV file.

## Features

- 📸 **Upload BMS Screenshots** - Drag and drop or click to upload
- 🤖 **AI-Powered Extraction** - Uses Google Gemini Flash to extract battery metrics
- 🔄 **Automatic Deduplication** - Hash-based detection prevents duplicate processing
- 📊 **Full Data Extraction** - 30+ fields including voltages, currents, temperatures, cell data
- 🌤️ **Weather Integration** - Optional weather data enrichment via OpenWeatherMap
- 📁 **CSV Output** - Clean, local CSV file that updates in place
- ⚙️ **UI-Based Settings** - Configure API keys directly in the browser

## Quick Start

### Option 1: Run from Source

```bash
# Navigate to the local directory
cd local

# Install dependencies
npm install

# Start the server
npm start
```

The app will open automatically at http://localhost:3847

### Option 2: Build Standalone Executable

```bash
# Install dependencies
npm install

# Build for macOS Intel
npm run build

# OR build for macOS Apple Silicon
npm run build:arm
```

The executable will be created in the `dist/` folder.

## Configuration

All configuration is done through the **Settings** tab in the UI:

### Required: Gemini API Key
1. Get your key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Go to Settings → API Keys
3. Enter your Gemini API key and click "Save Key"

### Optional: Weather API Key
1. Get your key from [OpenWeatherMap](https://openweathermap.org/api)
2. Go to Settings → API Keys
3. Enter your Weather API key and click "Save Key"

### Location (for weather data)
- Default: Big Island, Hawaii (19.442831, -154.943977)
- Customize in Settings → Location

## Data Output

All data is stored in `./output/bms-data.csv` with these columns:

| Column | Description |
|--------|-------------|
| id | Unique record ID |
| contentHash | SHA-256 hash of image (for dedup) |
| timestamp | When analysis was performed |
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

## API Keys Summary

| Service | Required | Purpose | Get Key |
|---------|----------|---------|---------|
| Google Gemini | ✅ Yes | Image analysis & data extraction | [AI Studio](https://makersuite.google.com/app/apikey) |
| OpenWeatherMap | ❌ No | Weather data enrichment | [OpenWeatherMap](https://openweathermap.org/api) |

## Project Structure

```
local/
├── server.js           # Express server
├── package.json        # Dependencies & scripts
├── lib/
│   ├── analyzer.js     # Gemini AI integration
│   ├── csv-store.js    # CSV storage & deduplication
│   ├── weather.js      # OpenWeatherMap integration
│   └── settings.js     # Settings management
├── public/
│   └── index.html      # Web UI
├── output/
│   └── bms-data.csv    # Output data (created on first run)
└── settings.json       # API keys & config (created on first run)
```

## Troubleshooting

### "Gemini API key not configured"
Go to Settings and add your Gemini API key.

### "This screenshot was already analyzed"
The image hash matches a previous upload. This is expected behavior - duplicates are skipped to save API costs.

### Weather data not showing
1. Check that you've added a Weather API key in Settings
2. Verify your location coordinates are correct
3. OpenWeatherMap may have rate limits on free tier

### CSV file not found
Upload at least one screenshot first. The CSV is created on the first successful analysis.

## License

MIT
