# Admin Historical Analysis Overhaul - Implementation Summary

## Overview
This document summarizes the comprehensive overhaul of the Admin Historical Analysis feature, which introduces data merging between BMS screenshot data and Cloud hourly weather data, along with chart stability improvements.

## What Was Changed

### Backend Implementation

#### 1. Data Merge Utility (`netlify/functions/utils/data-merge.cjs`)
A new utility module that provides:
- **mergeBmsAndCloudData**: Merges BMS screenshot data with Cloud hourly weather data
  - Fetches data from both `history` and `hourly-weather` MongoDB collections
  - Linear interpolation between cloud hourly points for estimated BMS values
  - Source tagging: 'bms', 'cloud', or 'estimated'
  - Intelligent merging: BMS data for battery metrics, Cloud data for weather metrics

- **downsampleMergedData**: Server-side aggregation for large datasets
  - Activates when data exceeds 2000 points
  - Preserves min/max/avg for accurate visualization
  - Maintains dataPoints count for transparency

- **linearInterpolate**: Helper function for smooth value estimation

#### 2. History API Enhancement (`netlify/functions/history.cjs`)
Enhanced GET endpoint with new parameters:
```
GET /.netlify/functions/history?merged=true&systemId=X&startDate=Y&endDate=Z&downsample=true&maxPoints=2000
```

**Response Format:**
```json
{
  "systemId": "system-123",
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z",
  "totalPoints": 1500,
  "downsampled": false,
  "data": [
    {
      "timestamp": "2024-01-01T06:00:00.000Z",
      "source": "bms",
      "data": {
        "stateOfCharge": 75,
        "overallVoltage": 52.3,
        "current": -5.0,
        "clouds": 50,
        ...
      },
      "recordId": "rec-123",
      "fileName": "screenshot.jpg"
    },
    {
      "timestamp": "2024-01-01T07:00:00.000Z",
      "source": "estimated",
      "data": {
        "stateOfCharge": 72.5,
        "overallVoltage": 52.1,
        "clouds": 45,
        ...
      }
    }
  ]
}
```

### Frontend Implementation

#### 1. Service Layer (`services/clientService.ts`)
New function: `getMergedTimelineData`
- TypeScript interfaces for type safety
- `MergedTimelineResponse` and `MergedDataPoint` types
- Comprehensive type definitions for all data fields including min/max/avg

#### 2. Historical Chart Component (`components/HistoricalChart.tsx`)

**Key Additions:**

1. **chartKey for Deterministic Rendering**
   ```typescript
   const chartKey = useMemo(() => {
     return JSON.stringify({
       systemId: selectedSystemId,
       startDate,
       endDate,
       metricConfig: Object.keys(metricConfig).sort(),
       zoomPercentage,
       chartView,
       useMergedData
     });
   }, [selectedSystemId, startDate, endDate, metricConfig, zoomPercentage, chartView, useMergedData]);
   ```
   Forces complete re-render when any parameter changes, eliminating stale state issues.

2. **Merged Data Support**
   - New state: `useMergedData` to toggle between BMS-only and merged modes
   - `mapMergedPointToChartPoint`: Converter for merged data format
   - Updated `prepareChartData`: Fetches merged data when enabled
   - Backward compatible with existing BMS-only mode

3. **Visual Differentiation by Source**
   - Path segmentation by data source
   - Styling based on source type:
     - BMS: Solid lines, 100% opacity
     - Cloud: Dashed lines (strokeDasharray="8 4"), 80% opacity
     - Estimated: Dashed lines (strokeDasharray="8 4"), 60% opacity

4. **Enhanced aggregateData Function**
   - Handles both old (AnalysisRecord) and new (chart point) formats
   - Proper multiplier handling for mixed data sources
   - Correct anomaly detection with reversed multipliers
   - Preserves source information through aggregation

### Testing

#### Unit Tests (`tests/data-merge.test.js`)
11 comprehensive tests covering:

1. **Linear Interpolation**
   - Correct interpolation between values
   - Edge cases (t === t0, t === t1, t0 === t1)

2. **Data Merging**
   - BMS + Cloud data merging
   - BMS priority for battery metrics, Cloud priority for weather
   - Only BMS data scenarios
   - Only Cloud data scenarios

3. **Downsampling**
   - No downsampling when under threshold
   - Min/max/avg preservation
   - DataPoints count accuracy

All tests passing ✅

## How to Use

### Enable Merged Data Mode

The feature is currently opt-in via the `useMergedData` state toggle. To use it:

1. Select a system in the Historical Analysis section
2. Set start and end dates
3. Enable merged data mode (toggle to be added to UI)
4. Chart will fetch and display merged BMS + Cloud data

### API Usage

To fetch merged data programmatically:
```typescript
import { getMergedTimelineData } from 'services/clientService';

const data = await getMergedTimelineData(
  systemId,
  startDate,
  endDate,
  true, // enable downsampling
  2000  // max points
);
```

### Understanding Data Sources

When viewing the chart:
- **Solid lines**: Real BMS screenshot data
- **Dashed lines with higher opacity**: Cloud hourly data (no BMS screenshots)
- **Dashed lines with lower opacity**: Estimated values (interpolated between cloud points)

## Technical Benefits

### Chart Stability
- **chartKey** ensures deterministic rendering
- No more stale visual states when parameters change
- Immediate updates when filters are applied

### Performance
- Server-side downsampling reduces client processing
- Multiple LOD (Level of Detail) layers optimize zoom performance
- Efficient data structures minimize memory usage

### Data Completeness
- Fills gaps between BMS screenshots with cloud hourly data
- Provides continuous timeline even with sparse screenshot data
- More accurate trend analysis with hourly granularity

### Code Quality
- Comprehensive TypeScript types
- Backward compatible with existing functionality
- Well-tested with 11 passing unit tests
- Code review feedback addressed

## Migration Path

### For Existing Installations
1. No breaking changes - merged data is opt-in
2. Existing BMS-only mode continues to work
3. Cloud hourly data needs to be backfilled for merged mode
4. Use `hourly-cloud-backfill` action in Admin Dashboard

### For New Features
To add merged data support to other components:
1. Import `getMergedTimelineData` from clientService
2. Use `MergedDataPoint` type for data handling
3. Check `source` field to differentiate data types
4. Apply appropriate styling based on source

## Future Enhancements

Potential improvements for future iterations:
1. Add UI toggle for merged data mode in chart controls
2. Implement real-time data streaming for live updates
3. Add more interpolation methods (cubic spline, polynomial)
4. Cache merged data results for frequently accessed ranges
5. Add export functionality for merged datasets
6. Extend to other chart types (hourly, predictive)

## Troubleshooting

### Common Issues

**Q: Chart not updating when changing dates**
A: The chartKey should force re-render. Check browser console for errors.

**Q: Dashed lines not appearing**
A: Ensure cloud hourly data exists. Run hourly-cloud-backfill if needed.

**Q: Performance issues with large datasets**
A: Enable downsampling by setting `downsample=true` in API call.

**Q: Gaps in data despite merged mode**
A: Cloud hourly data may not exist for that date range. Check MongoDB `hourly-weather` collection.

## Files Changed

### Backend
- `netlify/functions/utils/data-merge.cjs` (new)
- `netlify/functions/history.cjs` (modified)

### Frontend
- `services/clientService.ts` (modified)
- `components/HistoricalChart.tsx` (modified)

### Tests
- `tests/data-merge.test.js` (new)

### Documentation
- `ADMIN_HISTORICAL_ANALYSIS_OVERHAUL.md` (this file)

## Conclusion

This overhaul significantly improves the Admin Historical Analysis feature by:
1. Providing unified BMS + Cloud data visualization
2. Ensuring deterministic chart rendering
3. Optimizing performance with server-side downsampling
4. Maintaining backward compatibility
5. Adding comprehensive test coverage

The implementation is production-ready and backward compatible with existing functionality.
