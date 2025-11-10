# Changelog

This file tracks major changes, fixes, and migrations in the BMSview project.

## [2025-11-10] Admin Diagnostics and Insights Fixes

### Admin Diagnostics
- Fixed function import errors in `admin-diagnostics.cjs`
  - Changed `getMongoDb()` to `getDb()` from mongodb.cjs
  - Changed `analyzeImage()` to `performAnalysisPipeline()` from analysis-pipeline.cjs
  - Added missing imports for `getAIModelWithTools` and `runGuruConversation`
- Fixed weather and solar services to call APIs via HTTP instead of direct function calls
- Updated Gemini model usage to respect `process.env.GEMINI_MODEL` environment variable with fallback to `gemini-2.5-flash`

### Insights Enhancements
- Implemented 90-day daily rollup with hourly averages for comprehensive trend analysis
- Added `load90DayDailyRollup()` function that:
  - Loads up to 90 days of historical data
  - Aggregates data by day with up to 24 hourly averages per day
  - Computes daily summaries with coverage metrics
- New data only loaded in background mode to keep sync mode fast
- Added `formatDailyRollupSection()` to present historical context to AI

## [2025-11-05] Gemini 2.5 Flash Migration

### Model Updates
- Migrated from Gemini 1.5 Flash to Gemini 2.5 Flash (latest stable model)
- Updated all function calling implementations to use Gemini's recommended patterns
- Enhanced insights generation with true multi-turn conversation support

### Function Calling Improvements
- Implemented proper tool definitions following Gemini's specifications
- Added robust JSON parsing for tool calls and responses
- Implemented conversation history pruning to manage token limits
- Added timeout handling for long-running tool calls

## [2025-11] ReAct Loop Implementation

### AI Insights
- Implemented true ReAct (Reasoning + Acting) loop for insights generation
- Gemini can now request specific data via function calls:
  - `request_bms_data` - BMS metrics with time range and granularity control
  - `getSystemAnalytics` - System-level analytics
  - `getWeatherData` - Weather conditions for correlation
  - `getSolarEstimate` - Solar generation estimates
  - `predict_battery_trends` - Capacity and lifetime predictions
  - `analyze_usage_patterns` - Daily, weekly, seasonal patterns
  - `calculate_energy_budget` - Energy sufficiency calculations

### Context Optimization
- Sync mode: Minimal preloaded context, relies on ReAct loop for data requests
- Background mode: Comprehensive context preloading including analytics and predictions
- Conversation history pruning to manage token budgets effectively

## Previous Major Changes

### Synchronous Analysis Mode
- Implemented `?sync=true` query parameter for immediate analysis results
- Deprecated job-based async processing in favor of direct responses
- Improved duplicate detection using SHA-256 content hashing

### MongoDB Connection Pooling
- Optimized connection pooling (reduced pool size from 10 to 5)
- Implemented connection health checks with 60-second intervals
- Added automatic connection reuse to prevent overload

### Alert Event Grouping
- Consecutive alerts at same threshold now grouped into single events
- Duration tracking for alert events
- Threshold recovery detection to determine when alerts cleared

### Solar Variance Interpretation
- Clarified that solar variance often represents daytime load consumption
- Added ±15% tolerance for solar performance evaluation
- Weather correlation for accurate solar issue detection

### Data Aggregation
- Implemented hourly aggregation for efficient data transfer
- Added daily aggregation for long time ranges
- Intelligent sampling for large datasets to prevent token overflow

---

For a complete history of all changes, refer to the git commit log.
