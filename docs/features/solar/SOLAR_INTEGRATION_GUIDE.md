# Solar Integration Guide for BMS Validator

## Overview

This guide documents the comprehensive solar energy estimation and battery charging correlation system integrated into the BMS Validator application. The integration enables users to:

1. Fetch solar energy estimates based on location and panel specifications
2. Compare expected solar input with actual battery charging data
3. Identify system inefficiencies and anomalies
4. Receive actionable recommendations for system optimization

## Architecture

### Backend Components

#### 1. Netlify Function Proxy (`/netlify/functions/solar-estimate.ts`)

**Purpose**: Secure proxy for the Solar Charge Estimator API

**Features**:
- Request validation and sanitization
- Error handling and logging
- Response caching (1-hour TTL)
- CORS handling

**Endpoint**: `/.netlify/functions/solar-estimate`

**Query Parameters**:
- `location` (required): US Zip Code or "lat,lon" format
- `panelWatts` (required): Panel maximum power rating in Watts
- `startDate` (required): Start date in YYYY-MM-DD format
- `endDate` (required): End date in YYYY-MM-DD format

**Example Request**:
```
GET /.netlify/functions/solar-estimate?location=80942&panelWatts=400&startDate=2025-10-29&endDate=2025-10-31
```

**Response Format**:
```json
{
  "locationName": "Colorado Springs",
  "panelWatts": "400",
  "dailyEstimates": [
    {
      "date": "2025-10-29",
      "estimatedWh": 2104.8,
      "isForecast": false
    }
  ],
  "hourlyBreakdown": [
    {
      "timestamp": "2025-10-29T12:00",
      "irradiance_w_m2": 750.2,
      "estimated_wh": 300.08,
      "is_daylight": true
    }
  ]
}
```

### Frontend Components

#### 2. Solar Service (`/services/solarService.ts`)

**Purpose**: Client-side service for interacting with the solar API

**Key Functions**:
- `fetchSolarEstimate()`: Fetches solar estimates with automatic caching
- `calculateTotalEstimatedEnergy()`: Sums total energy across date range
- `getHourlyDataForDate()`: Filters hourly data for specific date
- `getDaylightHours()`: Filters to daylight hours only
- `getPeakSolarHour()`: Identifies peak generation hour
- `separateHistoricalAndForecast()`: Splits data by forecast flag
- `validateLocation()`: Validates zip code or coordinate format
- `formatDateForAPI()`: Formats dates for API consumption
- `getDateRangeForLastDays()`: Generates date ranges

**Caching Strategy**:
- In-memory cache with 1-hour TTL
- Cache key: `location_panelWatts_startDate_endDate`
- Automatic cache invalidation on expiry

#### 3. Solar Correlation Utilities (`/utils/solarCorrelation.ts`)

**Purpose**: Battery-solar correlation and efficiency analysis

**Key Functions**:

**Energy Conversion**:
- `ahToWh()`: Converts Amp-hours to Watt-hours
- `whToAh()`: Converts Watt-hours to Amp-hours
- `calculateMaxSolarInput()`: Calculates theoretical max input

**Data Processing**:
- `extractBatteryEnergyData()`: Extracts charging data from BMS records
- `correlateSolarWithBattery()`: Correlates solar estimates with battery gains
- `analyzeEfficiency()`: Performs comprehensive efficiency analysis

**Anomaly Detection**:
- `detectChargingAnomalies()`: Identifies charging issues
- `matchHourlyData()`: Matches solar data with BMS records

**Analysis**:
- `calculateExpectedRuntime()`: Estimates runtime from solar input
- `estimateDaysToFullCharge()`: Predicts days to full charge
- `getEfficiencyStatus()`: Categorizes efficiency (good/warning/critical)
- `generateEfficiencyRecommendations()`: Provides actionable advice

#### 4. UI Components

##### SolarEstimatePanel (`/components/SolarEstimatePanel.tsx`)

**Purpose**: User interface for fetching solar estimates

**Features**:
- Location input (zip code or coordinates)
- Panel wattage configuration
- Date range selection (3, 7, 14, 30 days)
- Real-time estimate display
- Historical vs. forecast indicators
- Peak generation hour display
- Daily breakdown table

**Props**:
- `systemConfig`: Optional pre-populated system configuration
- `onEstimateLoaded`: Callback when estimate is successfully fetched

##### SolarEfficiencyChart (`/components/SolarEfficiencyChart.tsx`)

**Purpose**: Visualizes efficiency analysis and correlations

**Features**:
- Average, peak, and lowest efficiency metrics
- Anomaly count display
- Expected vs. actual energy comparison
- Daily performance breakdown
- Color-coded efficiency status
- Automated recommendations

**Props**:
- `analysis`: EfficiencyAnalysis object from correlation utilities

##### SolarIntegrationDashboard (`/components/SolarIntegrationDashboard.tsx`)

**Purpose**: Integrated dashboard combining all solar features

**Features**:
- Combines SolarEstimatePanel and SolarEfficiencyChart
- Automatic correlation when both solar and BMS data available
- Responsive grid layout
- Contextual help messages

**Props**:
- `bmsRecords`: Array of BMS analysis records
- `systemConfig`: Battery system configuration

### Type Definitions

#### Solar Types (`/types/solar.ts`)

**Core Types**:
- `SolarEstimateRequest`: API request parameters
- `SolarEstimateResponse`: API response structure
- `DailyEstimate`: Daily energy estimate with forecast flag
- `HourlyBreakdown`: Hourly irradiance and energy data
- `SolarAPIError`: Error response format

**Correlation Types**:
- `BatteryEnergyData`: Battery charging data structure
- `SolarCorrelation`: Solar-battery correlation result
- `EfficiencyAnalysis`: Comprehensive efficiency metrics

**Configuration Types**:
- `SolarSystemConfig`: Solar panel system configuration
- `BatterySystemConfig`: Battery system configuration

## Usage Examples

### Basic Solar Estimate

```typescript
import { fetchSolarEstimate } from 'services/solarService';

const estimate = await fetchSolarEstimate({
  location: '80942',
  panelWatts: 400,
  startDate: '2025-10-29',
  endDate: '2025-10-31',
});

console.log('Total energy:', calculateTotalEstimatedEnergy(estimate));
```

### Battery-Solar Correlation

```typescript
import { extractBatteryEnergyData, correlateSolarWithBattery, analyzeEfficiency } from 'utils/solarCorrelation';

// Extract battery charging data
const batteryData = extractBatteryEnergyData(bmsRecords, 12); // 12V system

// Correlate with solar estimates
const correlations = correlateSolarWithBattery(solarEstimate, batteryData, 70);

// Analyze efficiency
const analysis = analyzeEfficiency(correlations);

console.log('Average efficiency:', analysis.averageEfficiency);
console.log('Anomalies:', analysis.anomalyCount);
```

### Using the Dashboard Component

```typescript
import { SolarIntegrationDashboard } from 'components/SolarIntegrationDashboard';

<SolarIntegrationDashboard
  bmsRecords={analysisRecords}
  systemConfig={{
    nominalVoltage: 12,
    fullCapacityAh: 200,
    systemId: 'system-123',
    location: {
      latitude: 38.8339,
      longitude: -104.8214,
    },
  }}
/>
```

## Key Features

### 1. Automatic Forecast Detection

The API automatically distinguishes between historical data and forecasts using the `isForecast` flag. This is based on:
- Current date in the location's timezone
- 2-3 day delay in historical data availability

### 2. Efficiency Thresholds

**Good**: ≥80% efficiency
**Warning**: 60-79% efficiency
**Critical**: <60% efficiency

### 3. Anomaly Detection

Anomalies are flagged when:
- Efficiency drops below 70% (configurable)
- High solar irradiance but no charging detected
- Low solar irradiance but high charging current

### 4. Caching Strategy

- Client-side: 1-hour in-memory cache
- Server-side: 1-hour HTTP cache headers
- Cache key includes all request parameters

## API Limitations

### Solar Charge Estimator API

1. **Historical Data Delay**: 2-3 days for archive data
2. **Geocoding**: Some remote zip codes may fail (use coordinates instead)
3. **Hourly Resolution**: Data is hourly, not sub-hourly
4. **Location**: US locations only

### Recommended Best Practices

1. **Use GPS Coordinates**: More reliable than zip codes
2. **Request Recent Data**: Last 7-14 days for best mix of historical/forecast
3. **Handle Errors Gracefully**: Network issues, invalid locations, etc.
4. **Cache Aggressively**: Reduce API calls for same parameters
5. **Validate Inputs**: Check location format and date ranges before API calls

## Troubleshooting

### Common Issues

**Issue**: "Could not find location for Zip Code"
**Solution**: Use GPS coordinates instead: `"latitude,longitude"`

**Issue**: No historical data available
**Solution**: Historical data has 2-3 day delay. Recent dates will be forecasts.

**Issue**: Efficiency shows 0%
**Solution**: Ensure BMS records have positive `remainingCapacity` changes (charging events)

**Issue**: Build fails with import errors
**Solution**: Verify path aliases are configured in both `vite.config.ts` and `tsconfig.json`

## Future Enhancements

1. **Multi-Panel Support**: Handle multiple solar panels or arrays
2. **Loss Modeling**: Account for typical system losses (10-20%)
3. **Weather Integration**: Correlate efficiency with weather conditions
4. **Historical Trends**: Track efficiency over weeks/months
5. **Predictive Alerts**: Notify before efficiency drops
6. **Export Reports**: Generate PDF reports of efficiency analysis

## Testing

### Local Testing

```bash
# Build the project
npm run build

# Preview the build
npm run preview
```

### Testing the Netlify Function

The function will be automatically deployed with the site. Test using:

```bash
curl "https://your-site.netlify.app/.netlify/functions/solar-estimate?location=80942&panelWatts=400&startDate=2025-10-29&endDate=2025-10-31"
```

## Deployment

The solar integration is automatically deployed with the main application:

1. Push changes to GitHub
2. Netlify automatically builds and deploys
3. Netlify function is deployed to `/.netlify/functions/solar-estimate`
4. Frontend components are bundled with the main application

## Support

For issues or questions:
- Check the Solar Charge Estimator API documentation
- Review error messages in browser console
- Check Netlify function logs for backend issues
- Verify BMS records have required fields for correlation

## Conclusion

The solar integration provides comprehensive analysis of solar energy potential and battery charging efficiency. By correlating expected solar input with actual battery gains, users can identify system issues, optimize performance, and make informed decisions about their solar-battery systems.