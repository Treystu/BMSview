<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# BMS Validator - Battery Management System Analysis Tool

An advanced application for analyzing Battery Management System (BMS) screenshots using AI, with integrated solar energy estimation and battery charging correlation features.

View your app in AI Studio: https://ai.studio/apps/drive/1ATGOGWROvHw_0dBbow54GOPJ3IUn_Qsk

## Features

### Core BMS Analysis
- 📸 **Screenshot Analysis**: Upload BMS screenshots for AI-powered analysis
- 📊 **Historical Tracking**: Track battery performance over time
- 🔋 **System Management**: Register and manage multiple BMS systems
- 📈 **Data Visualization**: Interactive charts and graphs
- 🔍 **Anomaly Detection**: Identify potential issues automatically

### ⚡ Ultimate AI Battery Guru
- **Context-Rich Insights**: The guru preloads system analytics, energy budgets, forecasts, weather, and the latest 24 snapshot logs before answering
- **Smart Tool Orchestration**: Gemini 2.5 Flash uses structured tool calls for targeted queries, with automated background escalation on complex prompts
- **Operational Summaries**: Front-end stream now surfaces a “Guru Context Primer” so operators see the data foundation used in every AI recommendation
- **Recent Snapshot Intel**: Netlify functions aggregate the most recent history entries, highlighting SOC deltas, net amp-hour movement, and alert trends
- **Production-Ready Background Jobs**: Status polling returns context summaries alongside progress so async runs remain transparent

### ☀️ NEW: Solar Integration
- **Solar Energy Estimation**: Get accurate solar generation estimates based on location and panel specs
- **Battery-Solar Correlation**: Compare expected solar input with actual battery charging
- **Efficiency Analysis**: Identify system inefficiencies and optimization opportunities
- **Anomaly Detection**: Automatically flag charging issues and performance gaps
- **Actionable Recommendations**: Receive specific advice for system improvements

## Run Locally

**Prerequisites:**  Node.js 20+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables in `.env.local`:
   ```
   GEMINI_API_KEY=your_gemini_api_key
   MONGODB_URI=your_mongodb_connection_string
   MONGODB_DB_NAME=your_database_name
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

5. Preview production build:
   ```bash
   npm run preview
   ```

## Solar Integration

The application now includes comprehensive solar energy analysis capabilities. See [SOLAR_INTEGRATION_GUIDE.md](./SOLAR_INTEGRATION_GUIDE.md) for detailed documentation.

### Quick Start with Solar Features

1. Navigate to the Solar Integration Dashboard
2. Enter your location (zip code or GPS coordinates)
3. Specify your solar panel wattage
4. Select date range for analysis
5. View solar estimates and efficiency correlations

### API Endpoint

The solar integration uses a Netlify function proxy:
```
GET /.netlify/functions/solar-estimate
  ?location=80942
  &panelWatts=400
  &startDate=2025-10-29
  &endDate=2025-10-31
```

## Project Structure

```
BMSview/
├── components/           # React components
│   ├── admin/           # Admin-specific components
│   ├── SolarEstimatePanel.tsx
│   ├── SolarEfficiencyChart.tsx
│   └── SolarIntegrationDashboard.tsx
├── services/            # API services
│   ├── solarService.ts  # Solar API client
│   ├── geminiService.ts
│   └── weatherService.ts
├── utils/               # Utility functions
│   └── solarCorrelation.ts  # Battery-solar correlation
├── types/               # TypeScript type definitions
│   └── solar.ts         # Solar-related types
├── netlify/functions/   # Serverless functions
│   └── solar-estimate.ts
├── state/               # State management
└── hooks/               # Custom React hooks
```

## Recent Updates

### Build Fixes (October 2025)
- ✅ Fixed import resolution issues in `adminState.tsx`
- ✅ Configured path aliases in `vite.config.ts` and `tsconfig.json`
- ✅ Added ES module support with `"type": "module"` in `package.json`
- ✅ Build now completes successfully without errors

### Solar Integration (October 2025)
- ✅ Implemented Netlify function proxy for Solar Charge Estimator API
- ✅ Created comprehensive solar service with caching
- ✅ Built battery-solar correlation engine
- ✅ Developed UI components for solar analysis
- ✅ Added efficiency analysis and anomaly detection

## Technologies

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS
- **Backend**: Netlify Functions (serverless)
- **Database**: MongoDB
- **AI**: Google Gemini API
- **APIs**: Solar Charge Estimator API, OpenWeather API

## Deployment

The application is automatically deployed via Netlify:

1. Push changes to GitHub
2. Netlify automatically builds and deploys
3. Environment variables are configured in Netlify dashboard

## Local-First Sync Migration

The new local-first sync layer relies on fresh `updatedAt` and `_syncStatus` fields across MongoDB collections. Run the migration function **after** completing the backup procedure and validating in staging.

### Backup Procedure (Run Before Migration)

- Export the target database:
  ```bash
  mongodump --uri "$MONGODB_URI" --db "$MONGODB_DB_NAME" --out ./backups/$(date +%Y%m%d-%H%M%S)
  ```
- Verify the dump folder contains collection archives (`systems.bson`, `history.bson`, `analysis-results.bson`).
- Compress the dump and store it in secure object storage (Netlify build artifacts or S3) with the timestamped folder name.
- Record the backup location in your deployment log so it can be restored quickly with `mongorestore` if needed.

### Migration Steps (Staging First)

1. Point your shell at the staging environment variables (`MONGODB_URI`, `MONGODB_DB_NAME`).
2. Trigger the migration:
   ```bash
   curl -X POST "https://<staging-site>/.netlify/functions/migrate-add-sync-fields"
   ```
3. Confirm the JSON response reports `success: true` and lists all migrated collections.
4. Spot check the database:
   - Ensure documents now include ISO 8601 `updatedAt` values ending in `Z`.
   - Confirm `_syncStatus` defaults to `synced` on legacy records.
   - Validate the new indexes with `db.getCollection('<name>').getIndexes()`.
5. Hit the sync metadata endpoint to verify canonical timestamps:
   ```bash
   curl "https://<staging-site>/.netlify/functions/sync-metadata?collection=systems"
   ```
6. Repeat the same process in production only after staging verification passes and the backup is stored safely.

### Post-Migration Verification

- `/.netlify/functions/sync-incremental` should return freshly normalized documents when queried with a recent ISO timestamp.
- `sync-metadata` checksums should be non-null for populated collections.
- Admin diagnostics (Phase 4) should be updated later to assert timestamp formatting and sync status consistency.

## Contributing

### For Human Contributors

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (`npm test`, `npm run build`)
5. Submit a pull request

### For GitHub Copilot Coding Agent

This repository is configured with comprehensive instructions for GitHub Copilot coding agent:

- **Instructions**: See `.github/copilot-instructions.md` for detailed coding guidelines, architecture patterns, and development workflows
- **Configuration**: Custom settings in `.copilot/config.json`
- **Best Practices**: When creating issues for Copilot to work on:
  - Write clear, specific issue titles
  - Provide context and acceptance criteria
  - Specify which files to modify
  - Include examples and test expectations
  - See the instructions file for detailed guidance on writing good AI-friendly issues

**Ideal Tasks for Copilot:**
- Bug fixes with clear reproduction steps
- Adding unit tests
- Documentation updates
- Code refactoring
- Feature additions with well-defined requirements

**Tasks Requiring Human Review:**
- Architecture changes
- Security-critical code
- Performance optimization
- Complex business logic

## Support

For issues or questions:
- Check the [Solar Integration Guide](./SOLAR_INTEGRATION_GUIDE.md)
- Review error messages in browser console
- Check Netlify function logs for backend issues

## License

Private - All rights reserved
