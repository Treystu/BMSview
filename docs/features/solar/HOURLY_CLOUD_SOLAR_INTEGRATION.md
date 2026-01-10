# Hourly Cloud & Solar Data Integration - Implementation Guide

## Overview
This feature integrates hourly cloud coverage and solar irradiance data into the Historical Analysis Timeline chart, providing critical environmental context for understanding battery charging behavior.

## What Was Built

### Backend (Pre-existing)
- ✅ Merged data API endpoint: `GET /history?merged=true&systemId=X&startDate=Y&endDate=Z`
- ✅ Data merge utility: `netlify/functions/utils/data-merge.cjs`
- ✅ MongoDB collection: `hourly-weather` with cloud cover and irradiance
- ✅ Linear interpolation for gap filling between BMS readings
- ✅ Automatic downsampling to 2000 points for performance

### Frontend (New Implementation)

#### 1. New Irradiance Metric
**File**: `types.ts`, `components/HistoricalChart.tsx`
- Added `irradiance` to MetricKey type
- Configured as Weather group metric with unit "W/m²"
- Color: #fbbf24 (solar yellow)
- Added to HOURLY_METRICS for hourly average chart support

#### 2. UI Toggle Control
**File**: `components/HistoricalChart.tsx` - ChartControls component
- Location: Bottom controls row, after "Min/Max Bands" toggle
- Label: "☁️ Hourly Weather"
- State: `useMergedData` boolean
- Effect: Switches between BMS-only and merged BMS+Cloud data modes

#### 3. Visual Overlays

##### Cloud Cover Area Chart
- **Rendering**: SVG area path from baseline (0%) to cloud value
- **Style**: 
  - Fill: #94a3b8 (slate gray)
  - Opacity: 0.1 (subtle background)
  - No stroke
  - Non-interactive (pointerEvents: none)
- **Data Source**: `clouds` metric from either BMS weather or hourly cloud data
- **Visibility**: Shown when `clouds` metric is configured and not hidden

##### Irradiance Dashed Line
- **Rendering**: SVG path with dashed stroke
- **Style**:
  - Stroke: #fbbf24 (yellow)
  - Opacity: 0.8
  - Stroke-dasharray: "8 4"
  - Width: 2px (thinner than battery metrics)
- **Data Source**: `estimated_irradiance_w_m2` from merged data
- **Visibility**: Shown when `irradiance` metric is configured and not hidden

#### 4. Source Indicators

##### Path Styling
- **BMS data**: Solid lines, opacity 1.0
- **Cloud data**: Dashed lines (8 4), opacity 0.8
- **Interpolated**: Dashed lines (8 4), opacity 0.6

##### Tooltip Badges
Located just below timestamp in tooltip:
- **📸 BMS Screenshot**: Green badge (bg-green-900/50, text-green-300)
- **☁️ Hourly Weather**: Blue badge (bg-blue-900/50, text-blue-300)
- **🔮 Interpolated**: Purple badge (bg-purple-900/50, text-purple-300)

## How to Use

### For Administrators
1. Navigate to Admin Dashboard → Historical Analysis
2. Select a system with location data (latitude/longitude)
3. Set date range (or use default 30 days)
4. Click "Configure Metrics" and enable:
   - Clouds (recommend right axis, 0-100%)
   - Irradiance (recommend right axis, 0-1200 W/m²)
5. Enable "☁️ Hourly Weather" toggle
6. Wait for chart to reload with merged data

### For Analysis
- **Cloud area**: Gray shading shows cloud coverage over time
- **Irradiance line**: Dashed yellow shows solar energy availability
- **Correlations**: 
  - Low charging during high cloud cover = expected behavior
  - Low charging during low cloud cover = potential system issue
  - Interpolated points show estimated values between BMS readings

### Data Requirements
For merged data to work:
1. System must have latitude/longitude configured
2. Hourly weather data must exist in `hourly-weather` collection
3. Run hourly cloud backfill if needed: Admin → Data Management → "Backfill Hourly Cloud Data"

## Technical Details

### Data Flow
```
User enables toggle
  ↓
Frontend: getMergedTimelineData(systemId, startDate, endDate)
  ↓
Backend: /history?merged=true
  ↓
mergeBmsAndCloudData() in data-merge.cjs
  ↓
1. Fetch BMS screenshots from 'history' collection
2. Fetch hourly weather from 'hourly-weather' collection
3. Interpolate BMS metrics between cloud hourly points
4. Merge and sort by timestamp
5. Downsample if > 2000 points
  ↓
Frontend: mapMergedPointToChartPoint()
  ↓
Chart rendering with source-based styling
```

### Key Functions Modified

#### `mapRecordToPoint()`
- Handles irradiance from `r.weather?.estimated_irradiance_w_m2`
- Preserves source as 'bms' for regular BMS records

#### `mapMergedPointToChartPoint()`
- Extracts irradiance from `p.data.estimated_irradiance_w_m2`
- Preserves source flag ('bms', 'cloud', 'estimated')
- Handles downsampled min/max/avg values

#### `prepareChartData()`
- Checks `useMergedData` state
- Calls `getMergedTimelineData()` when enabled
- Falls back to BMS-only history when disabled

#### Cloud Area Path Generation (useMemo)
```javascript
// Creates SVG area path from baseline to cloud values
// Only rendered if 'clouds' metric is configured
const cloudAreaPath = cloudPoints.map(...) // M -> L -> L -> Z
```

### Performance Optimizations
1. **Automatic Downsampling**: Backend limits to 2000 points max
2. **LOD System**: Reuses existing Level-of-Detail aggregation
3. **useMemo**: Cloud area path computed once per data change
4. **Path Segmentation**: Source-based segments optimize rendering

## Testing Scenarios

### Test 1: Basic Functionality
- [ ] Toggle "☁️ Hourly Weather" on
- [ ] Verify chart reloads
- [ ] Confirm cloud area appears (if clouds metric enabled)
- [ ] Check irradiance line appears (if irradiance metric enabled)

### Test 2: Tooltip Source Badges
- [ ] Hover over BMS data point → See "📸 BMS Screenshot"
- [ ] Hover over hourly cloud point → See "☁️ Hourly Weather"
- [ ] Hover over interpolated point → See "🔮 Interpolated"

### Test 3: Visual Styling
- [ ] BMS lines are solid
- [ ] Cloud/interpolated lines are dashed
- [ ] Cloud area has low opacity (doesn't obscure data)
- [ ] Irradiance line is distinct yellow

### Test 4: Data Correlation
- [ ] Find day with variable cloud cover
- [ ] Verify charging current drops during cloudy periods
- [ ] Check irradiance decreases with cloud cover

### Test 5: Edge Cases
- [ ] System with no hourly cloud data → Falls back to BMS weather only
- [ ] BMS offline period → Hourly cloud continues, BMS interpolated
- [ ] Toggle off → Reverts to BMS-only view
- [ ] Date range with no data → Shows empty chart

## Known Limitations

1. **Data Availability**: Requires hourly weather backfill to be run
2. **Interpolation Accuracy**: Linear interpolation may not match actual battery behavior
3. **Timezone**: All data displayed in UTC (may not match local time)
4. **Performance**: Large date ranges (>90 days) may be slow
5. **Cloud Data Quality**: Dependent on weather API accuracy

## Future Enhancements (Out of Scope)

- Real-time weather API integration
- Configurable interpolation methods (spline, polynomial)
- Weather forecast overlay
- Solar panel efficiency calculations
- Export merged data as CSV
- Comparison mode (multiple systems on one chart)

## Troubleshooting

### "No hourly cloud data appears"
**Solution**: Run hourly cloud backfill from Admin Dashboard

### "Irradiance values seem incorrect"
**Check**: 
- System latitude/longitude is accurate
- Date range is within weather API limits
- `estimated_irradiance_w_m2` field exists in hourly-weather collection

### "Chart is slow with merged data"
**Solution**: 
- Reduce date range
- Downsampling should limit to 2000 points automatically
- Check browser console for errors

### "Source badges not showing"
**Check**: 
- `source` field exists in data points
- Tooltip is hovering over valid data point
- Browser console for JavaScript errors

## References

- Issue: [GitHub Issue Link]
- Backend Utilities: `netlify/functions/utils/data-merge.cjs`
- Frontend Component: `components/HistoricalChart.tsx`
- Type Definitions: `types.ts`
- API Service: `services/clientService.ts` → `getMergedTimelineData()`

---

**Implementation Date**: November 24, 2024
**Status**: ✅ Complete - All phases finished
**Security Scan**: ✅ Passed (0 vulnerabilities)
**Build Status**: ✅ Passing
