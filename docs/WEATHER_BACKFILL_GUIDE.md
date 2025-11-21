# Weather Backfill Features - Implementation Guide

## Overview

This document describes the weather backfill features in BMSview, including the fixed regular weather backfill and the new hourly cloud backfill functionality.

## Features

### 1. Regular Weather Backfill (Fixed)

**What it does:**
- Backfills missing weather data for existing analysis records
- Fetches historical weather data (temperature, clouds, UVI) for records that don't have weather information

**How it works:**
1. Finds all analysis records linked to systems that are missing weather data
2. Uses the system's GPS coordinates and the analysis timestamp
3. Fetches historical weather from OpenWeatherMap API
4. Updates records in batches with throttling to respect API rate limits

**Usage:**
- Navigate to Admin Dashboard → Data Management section
- Click "Backfill Weather" button
- The system will process all records needing weather data

**Technical Details:**
- Uses direct API calls to OpenWeatherMap (no longer uses HTTP proxy)
- Batch size: 50 records
- Throttle delay: 1 second between batches
- Retry delay: 2 seconds after errors
- Collection: `history` (updates existing records)

### 2. Hourly Cloud Backfill (New)

**What it does:**
- Fetches granular hourly weather data for ALL daylight hours across your entire historical data range
- Provides detailed cloud coverage and solar irradiance data for accurate solar efficiency analysis

**How it works:**
1. For each system with GPS coordinates:
   - Finds the min and max analysis dates
   - Calculates daylight hours for each date based on location (sunrise/sunset)
   - Fetches hourly weather data from OpenWeatherMap for each day
   - Filters to only daylight hours
   - Stores detailed hourly measurements

2. Data collected per hour:
   - Cloud percentage (0-100%)
   - Temperature (°C)
   - UV Index
   - Estimated solar irradiance (W/m²)
   - Weather condition

**Usage:**
- Navigate to Admin Dashboard → Data Management section
- Click "Backfill Hourly Cloud Data" button (purple button)
- Confirm the operation (this may take considerable time and API calls)
- Monitor the backend logs for progress

**Technical Details:**
- Uses astronomical calculations to determine daylight hours per location/date
- Handles polar day/night edge cases (Arctic/Antarctic regions)
- Throttling: 1 second between API calls
- Collection: `hourly-weather` (new collection)
- Skips dates that already have hourly data

**MongoDB Schema - `hourly-weather` Collection:**
```javascript
{
  systemId: "system-uuid",
  systemName: "My Battery System",
  date: "2024-06-21",  // YYYY-MM-DD
  latitude: 40.7128,
  longitude: -74.0060,
  daylightHours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],  // Hours 0-23
  hourlyData: [
    {
      hour: 6,
      timestamp: "2024-06-21T06:00:00.000Z",
      clouds: 25,  // Percentage
      temp: 18.5,  // °C
      uvi: 1.2,
      weather_main: "Clear",
      estimated_irradiance_w_m2: 30  // Rough estimate from UVI
    },
    // ... more hourly records for each daylight hour
  ],
  createdAt: "2024-11-21T22:00:00.000Z"
}
```

## API Rate Limits

**OpenWeatherMap Free Tier:**
- 1,000 calls per day
- 60 calls per minute

**Backfill Considerations:**
- Regular weather backfill: 1 call per record (can process ~1000 records per day)
- Hourly cloud backfill: 1 call per day per system (can process ~1000 system-days per API day)

**Example:** If you have 2 systems with 6 months of data each:
- System 1: ~180 days × 1 call = 180 calls
- System 2: ~180 days × 1 call = 180 calls
- Total: 360 calls (fits within daily limit)

## Use Cases

### Regular Weather Backfill
- Initial data migration after adding GPS coordinates to systems
- Filling gaps after API failures or downtime
- Adding weather context to historical analysis records

### Hourly Cloud Backfill
- **Solar efficiency monitoring:** Compare expected vs actual solar charging
- **Performance troubleshooting:** Identify periods of poor solar performance
- **Predictive analytics:** Build models for solar generation predictions
- **Cloud impact analysis:** Correlate battery charging rates with cloud coverage
- **Hourly pattern detection:** Understand how cloud patterns affect solar throughout the day

## Troubleshooting

### Regular Weather Backfill Issues

**Problem:** "No records need weather data" but you know there are missing records
**Solution:** Check that:
- Records are linked to a system (systemId is not null)
- Systems have latitude/longitude coordinates set
- Records actually lack weather data (weather field is null or missing clouds property)

**Problem:** High error count during backfill
**Solution:**
- Check WEATHER_API_KEY environment variable is set
- Verify API key is valid and has remaining quota
- Check network connectivity to api.openweathermap.org
- Review logs for specific error messages

### Hourly Cloud Backfill Issues

**Problem:** Backfill takes too long or times out
**Solution:**
- Process is designed to run for extended periods
- Check Netlify function timeout limits (max 26 seconds for free tier, 10 minutes for pro)
- Consider running backfill in smaller date ranges
- Monitor API quota usage

**Problem:** Missing hourly data for certain dates
**Solution:**
- Check if dates fall within OpenWeatherMap's historical data availability (typically last 5 days for free tier, longer for paid)
- Polar regions (very high latitudes) may have issues during certain seasons
- Verify system GPS coordinates are accurate

**Problem:** Estimated irradiance values seem off
**Solution:**
- Irradiance is estimated from UVI (UVI × 25 = rough W/m²)
- For more accurate irradiance, consider upgrading to OpenWeatherMap's Solar Energy API
- Values are meant for relative comparison, not absolute measurements

## Future Enhancements

Potential improvements for future iterations:

1. **Incremental Updates**
   - Add scheduled job to backfill new data automatically
   - Only process recent dates (last 7 days) on a schedule

2. **API Integration**
   - Integrate with OpenWeatherMap Solar Energy API for accurate irradiance
   - Add support for alternative weather APIs

3. **UI Improvements**
   - Progress indicator during backfill
   - Summary statistics after completion
   - Ability to backfill specific date ranges or systems

4. **Data Visualization**
   - Charts showing cloud coverage patterns
   - Solar efficiency heatmaps
   - Correlation graphs (cloud % vs charging rate)

5. **Performance Optimization**
   - Parallel processing for multiple systems
   - Caching strategies for repeated date ranges
   - Database indexing for hourly-weather collection

## Related Files

### Backend (Netlify Functions)
- `netlify/functions/history.cjs` - Main handler with both backfill actions
- `netlify/functions/utils/weather-fetcher.cjs` - Weather API utilities
- `netlify/functions/weather.cjs` - Weather endpoint (for real-time queries)

### Frontend
- `services/clientService.ts` - Client-side API functions
- `components/AdminDashboard.tsx` - Admin UI with backfill buttons
- `components/admin/DataManagement.tsx` - Data management UI component
- `state/adminState.tsx` - State management for admin features

### Tests
- `tests/weather-fetcher.test.js` - Comprehensive tests for weather utilities

## MongoDB Indexes (Recommended)

For optimal performance with hourly weather data:

```javascript
// Index for hourly-weather collection
db['hourly-weather'].createIndex({ systemId: 1, date: 1 }, { unique: true });
db['hourly-weather'].createIndex({ date: 1 });
db['hourly-weather'].createIndex({ systemId: 1 });
```

## License & Attribution

Weather data provided by OpenWeatherMap (https://openweathermap.org)
Sunrise/sunset calculations use astronomical algorithms based on NOAA Solar Calculator
