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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

For issues or questions:
- Check the [Solar Integration Guide](./SOLAR_INTEGRATION_GUIDE.md)
- Review error messages in browser console
- Check Netlify function logs for backend issues

## License

Private - All rights reserved
