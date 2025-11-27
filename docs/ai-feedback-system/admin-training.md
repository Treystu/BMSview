# AI Feedback System - Admin Training Guide

## Overview

This guide provides administrators with comprehensive training on monitoring, managing, and troubleshooting the AI Feedback System.

## Table of Contents

1. [Admin Dashboard Overview](#admin-dashboard-overview)
2. [Monitoring Data Quality](#monitoring-data-quality)
3. [System Analytics Features](#system-analytics-features)
4. [Troubleshooting Guide](#troubleshooting-guide)
5. [Performance Optimization](#performance-optimization)
6. [Best Practices](#best-practices)
7. [Maintenance Tasks](#maintenance-tasks)

---

## Admin Dashboard Overview

### Accessing the Dashboard

Navigate to: `https://your-site.netlify.app/admin.html`

**Features Available:**
- System registration and management
- Historical analysis viewing
- Analytics visualization
- Diagnostics and health checks
- Data quality monitoring

### Dashboard Components

#### 1. Systems Management Panel
- **List all systems**: View registered battery systems
- **Add system**: Register new battery with configuration
- **Edit system**: Update capacity, chemistry, location
- **Delete system**: Remove inactive systems

#### 2. Analysis History
- **View records**: Browse all BMS analysis records
- **Filter by system**: Show specific battery history
- **Date range selection**: View data for custom time periods
- **Quality scores**: See validation quality over time

#### 3. Analytics Visualization
- **Hourly averages**: View 24-hour load patterns
- **Trends**: See SOC, voltage, temperature trends
- **Health metrics**: Track battery health over time
- **Alert analysis**: Review alert frequencies and types

#### 4. Diagnostics Panel
- **System health**: Check MongoDB, Gemini API, weather service
- **Recent errors**: View application error logs
- **Performance metrics**: Response times, success rates
- **Data completeness**: Identify gaps in historical data

---

## Monitoring Data Quality

### Quality Score Dashboard

**Location:** Admin Dashboard → System Analytics → Quality Trends

**Key Metrics:**

1. **Average Quality Score (Rolling 30 Days)**
   ```
   Target: >85
   Warning: <80
   Critical: <70
   
   Interpretation:
   - 90-100: Excellent data quality
   - 80-89: Good, minor validation issues
   - 70-79: Fair, review validation failures
   - <70: Poor, investigate image quality or model issues
   ```

2. **Validation Success Rate**
   ```
   Target: >95%
   Warning: <90%
   Critical: <85%
   
   Formula: (Passed on first attempt / Total analyses) × 100
   
   Low rate indicates:
   - Poor image quality from users
   - BMS layout not recognized
   - Model performance degradation
   ```

3. **Retry Rate**
   ```
   Target: <20%
   Warning: 20-40%
   Critical: >40%
   
   Formula: (Required retries / Total analyses) × 100
   
   High rate indicates:
   - Complex BMS layouts
   - Image quality issues
   - Need for model retraining
   ```

### Monitoring Actions

**Daily Checks:**
```bash
# Check average quality score (last 24h)
curl "/.netlify/functions/admin-diagnostics?check=quality&hours=24"

# Expected response:
{
  "avgScore": 87.3,
  "total": 45,
  "excellent": 28,
  "good": 14,
  "fair": 3,
  "poor": 0
}
```

**Weekly Reviews:**
1. Review quality score trend (should be stable or improving)
2. Identify systems with consistently low scores
3. Check for common validation errors
4. Review retry patterns

**Monthly Reports:**
1. Generate quality report for all systems
2. Identify training data gaps (uncommon BMS types)
3. Review user feedback on validation accuracy
4. Plan model improvements if needed

### Common Quality Issues

#### Issue: Low Quality Scores (<80 average)

**Diagnostic Steps:**
```sql
-- MongoDB query to find common validation errors
db.getCollection('analysis-results').aggregate([
  {$match: {qualityScore: {$lt: 80}}},
  {$unwind: "$validationResult.warnings"},
  {$group: {
    _id: "$validationResult.warnings",
    count: {$sum: 1}
  }},
  {$sort: {count: -1}},
  {$limit: 10}
])
```

**Common Causes:**
1. **Voltage mismatch**: BMS reports individual cells incorrectly
2. **SOC out of range**: Misreading decimal point (15.0% → 150%)
3. **Power calculation**: Unit conversion errors (kW vs W)

**Resolution:**
1. Check if specific BMS model causing issues
2. Add training examples for problematic layouts
3. Update validation tolerances if too strict
4. Contact users about image quality

#### Issue: High Retry Rate (>30%)

**Diagnostic Steps:**
1. Check which systems require frequent retries
2. Review image quality from those systems
3. Identify BMS layout patterns

**Resolution:**
1. Request better quality images from users
2. Add BMS-specific prompts to Gemini
3. Increase retry limit for complex layouts (max 5)
4. Document known problematic BMS models

---

## System Analytics Features

### Hourly Averages Analysis

**Access:** `GET /.netlify/functions/system-analytics?systemId=XXX`

**Use Cases:**

1. **Load Profiling**
   ```javascript
   // Find peak usage hours
   const peakHour = hourlyAverages.reduce((max, curr) => 
     curr.avgPower.discharge < max.avgPower.discharge ? curr : max
   );
   console.log(`Peak usage: Hour ${peakHour.hour} at ${Math.abs(peakHour.avgPower.discharge)}W`);
   ```

2. **Solar Performance Baseline**
   ```javascript
   // Check sunny day charging pattern
   const sunnyDayBaseline = performanceBaseline.sunnyDayChargingAmpsByHour;
   const currentPerformance = hourlyAverages[12].avgCurrent.charge;
   
   if (currentPerformance < sunnyDayBaseline[12] * 0.7) {
     console.warn('Solar underperforming at peak hour');
   }
   ```

3. **Alert Trends**
   ```javascript
   // Identify most common alerts
   alertAnalysis.alertCounts.forEach(alert => {
     if (alert.count > 10) {
       console.log(`Frequent alert: ${alert.type} (${alert.count} times)`);
     }
   });
   ```

### Comprehensive Analytics

**Access:** Called internally by insights generation

**Admin Visibility:**
- View analytics JSON in browser console (admin.html debug mode)
- Export analytics data for external analysis
- Compare analytics across multiple systems

**Key Admin Uses:**

1. **System Comparison**
   ```javascript
   // Compare health scores across systems
   const systems = await getAllSystems();
   const healthScores = await Promise.all(
     systems.map(async sys => ({
       id: sys.id,
       score: (await generateAnalytics(sys.id)).batteryHealth.healthScore
     }))
   );
   
   healthScores.sort((a,b) => a.score - b.score);
   console.log('Systems by health:', healthScores);
   ```

2. **Fleet-Wide Trends**
   ```javascript
   // Identify widespread issues
   const allTrends = await Promise.all(
     systems.map(sys => generateAnalytics(sys.id))
   );
   
   const decliningSOC = allTrends.filter(
     a => a.trends.soc.trend === 'decreasing' && a.trends.soc.confidence === 'high'
   );
   
   if (decliningSOC.length > systems.length * 0.3) {
     console.warn('30%+ of systems showing declining SOC - check weather or seasonal factors');
   }
   ```

---

## Troubleshooting Guide

### Problem: Analysis Failing (HTTP 500)

**Symptoms:**
- Upload succeeds but analysis times out
- Error message: "Analysis processing failed"

**Diagnostic Steps:**
```bash
# Check Netlify function logs
netlify functions:log analyze

# Look for:
# - MongoDB connection errors
# - Gemini API timeouts
# - Memory errors
```

**Common Causes:**

1. **MongoDB Connection Timeout**
   ```
   Error: MongoNetworkTimeoutError
   
   Fix:
   - Check MONGODB_URI environment variable
   - Verify MongoDB Atlas IP whitelist includes Netlify IPs
   - Check connection pool settings (should be 5-10)
   ```

2. **Gemini API Rate Limit**
   ```
   Error: 429 Too Many Requests
   
   Fix:
   - Implement exponential backoff (already in retry.cjs)
   - Check API quota in Google Cloud Console
   - Upgrade Gemini API tier if needed
   ```

3. **Function Timeout (>60s)**
   ```
   Error: Function execution timed out
   
   Fix:
   - Use sync mode (?sync=true) for faster response
   - Reduce historical data window if generating analytics
   - Split large operations into background jobs
   ```

### Problem: Low Quality Scores System-Wide

**Symptoms:**
- Quality scores dropped from 85+ to 70-
- Increase in validation failures
- More retry attempts needed

**Diagnostic Steps:**
1. Check Gemini model version
   ```bash
   echo $GEMINI_MODEL
   # Should be: gemini-2.5-flash or newer
   ```

2. Review recent validation errors
   ```javascript
   // In admin dashboard console
   const recentErrors = await getRecentValidationErrors(7); // Last 7 days
   console.log('Most common:', recentErrors.slice(0,10));
   ```

3. Check for BMS type pattern
   ```javascript
   const lowScoreAnalyses = await findByQualityRange(0, 75);
   const bmsByCount = groupByBMSType(lowScoreAnalyses);
   // Is one BMS type over-represented?
   ```

**Common Causes:**

1. **Model Degradation**
   - Gemini model updated with breaking changes
   - Prompt no longer optimal for new model
   - Fix: Review and update analysis prompt

2. **New BMS Types**
   - Users uploading unfamiliar BMS layouts
   - Fix: Collect samples, add to training data

3. **Image Quality Decline**
   - Users taking darker/blurrier photos
   - Fix: Add image quality guide to UI

### Problem: Insights Generation Slow (>30s)

**Symptoms:**
- Insights timeout in UI
- Background jobs queueing up
- Users report long wait times

**Diagnostic Steps:**
```bash
# Check average insights generation time
curl "/.netlify/functions/admin-diagnostics?check=performance"

# Expected: <25s for 90 days of data
# Warning: >30s
# Critical: >50s
```

**Optimization:**

1. **MongoDB Query Optimization**
   ```javascript
   // Ensure indexes exist
   db.history.createIndex({systemId: 1, timestamp: 1});
   db['analysis-results'].createIndex({systemId: 1, timestamp: -1});
   
   // Check query performance
   db.history.explain().find({
     systemId: 'sys-123',
     timestamp: {$gte: '2024-01-01'}
   });
   ```

2. **Reduce Data Window**
   ```javascript
   // In comprehensive-analytics.cjs, adjust:
   const thirtyDaysAgo = new Date();
   thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30); // Was 90
   ```

3. **Enable Caching**
   ```javascript
   // Cache analytics for 10 minutes
   const cacheKey = `analytics:${systemId}:${Date.now() / 600000 | 0}`;
   const cached = await cache.get(cacheKey);
   if (cached) return cached;
   
   const analytics = await generateComprehensiveAnalytics(...);
   await cache.set(cacheKey, analytics, 600); // 10 min TTL
   ```

---

## Performance Optimization

### Database Indexes

**Required Indexes:**
```javascript
// In MongoDB Atlas or shell
db.history.createIndex({systemId: 1, timestamp: 1});
db.history.createIndex({timestamp: 1});
db['analysis-results'].createIndex({systemId: 1, timestamp: -1});
db['analysis-results'].createIndex({qualityScore: 1});
db.systems.createIndex({id: 1}, {unique: true});
```

**Verify Indexes:**
```javascript
db.history.getIndexes();
// Should show: _id, systemId_timestamp, timestamp
```

### Caching Strategy

**What to Cache:**
1. Analytics results (10-15 min TTL)
2. System configurations (1 hour TTL)
3. Weather data (1 hour TTL)
4. Hourly averages (30 min TTL)

**What NOT to Cache:**
1. Real-time analysis results
2. Validation feedback
3. Quality scores
4. Active alerts

### Connection Pooling

**Current Settings (mongodb.cjs):**
```javascript
{
  maxPoolSize: 5,
  minPoolSize: 1,
  maxIdleTimeMS: 60000,
  serverSelectionTimeoutMS: 10000
}
```

**Tuning Guidelines:**
- **High traffic (>100 req/min)**: Increase maxPoolSize to 10
- **Low traffic (<10 req/min)**: Decrease to 3
- **Timeout errors**: Increase serverSelectionTimeoutMS to 15000

---

## Best Practices

### Daily Operations

1. **Morning Check**
   - Review overnight analysis quality
   - Check for error spikes in logs
   - Verify MongoDB connection healthy

2. **Monitor Thresholds**
   - Quality score >85
   - Success rate >95%
   - Average response time <2s

3. **User Support**
   - Respond to quality issues <24h
   - Provide image quality guidance
   - Collect samples for difficult BMS types

### Weekly Tasks

1. **Quality Review**
   - Generate weekly quality report
   - Identify trending issues
   - Review retry patterns

2. **Performance Check**
   - Review function execution times
   - Check database query performance
   - Monitor API quota usage

3. **System Health**
   - Verify all services operational
   - Check backup integrity
   - Review security logs

### Monthly Maintenance

1. **Data Cleanup**
   ```javascript
   // Archive old analyses (>1 year)
   const oneYearAgo = new Date();
   oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
   
   const oldRecords = await db.history.find({
     timestamp: {$lt: oneYearAgo.toISOString()}
   });
   
   // Archive to cold storage, then delete
   await archiveToS3(oldRecords);
   await db.history.deleteMany({
     timestamp: {$lt: oneYearAgo.toISOString()}
   });
   ```

2. **Model Review**
   - Check for Gemini model updates
   - Review prompt effectiveness
   - Update validation rules if needed

3. **Documentation**
   - Update known issues list
   - Document new BMS types
   - Refresh troubleshooting guides

---

## Maintenance Tasks

### Routine Maintenance

#### Update System Configuration
```javascript
// Example: Update battery capacity after replacement
await db.systems.updateOne(
  {id: 'sys-123'},
  {$set: {
    capacity: 300,  // New capacity in Ah
    cycleCount: 0,  // Reset cycles
    installDate: new Date().toISOString()
  }}
);
```

#### Clean Up Test Data
```javascript
// Remove test analyses
await db['analysis-results'].deleteMany({
  fileName: /^test-/i
});
```

#### Regenerate Analytics Cache
```javascript
// Force refresh for all systems
const systems = await db.systems.find().toArray();
for (const sys of systems) {
  await generateComprehensiveAnalytics(sys.id, null, log);
}
```

### Emergency Procedures

#### Database Connection Lost
```bash
# 1. Check MongoDB Atlas status
# 2. Verify MONGODB_URI correct
# 3. Check IP whitelist
# 4. Restart Netlify function (redeploy)
netlify deploy --prod
```

#### Gemini API Down
```bash
# 1. Check Google Cloud Status
# 2. Verify API key valid
# 3. Check quota not exceeded
# 4. Switch to fallback model if configured
```

#### Mass Validation Failures
```javascript
// 1. Identify cause
const recentFailures = await db['analysis-results'].find({
  qualityScore: {$lt: 60},
  timestamp: {$gt: new Date(Date.now() - 3600000).toISOString()}
}).toArray();

// 2. Check for pattern
const errors = recentFailures.map(f => f.validationResult.warnings);
const commonError = findMostCommon(errors);

// 3. If systemic issue, pause auto-retries
// 4. Notify users of known issue
// 5. Fix root cause (prompt, validation rule, etc.)
// 6. Re-enable auto-retries
```

---

## Support Resources

### Documentation Links
- [API Documentation](./api.md)
- [User Guide](./user-guide.md)
- [Model Assumptions](./model-assumptions.md)
- [System Diagnostics Guide](../SYSTEM_DIAGNOSTICS.md)

### Support Channels
- GitHub Issues: https://github.com/Treystu/BMSview/issues
- Email: support@bmsview.com (if configured)

### Escalation Path
1. Check this guide first
2. Review system diagnostics
3. Search GitHub issues
4. Create new issue with:
   - Symptoms
   - Diagnostic steps taken
   - Relevant logs
   - System configuration (sanitized)

---

## Summary

As a BMSview administrator, your key responsibilities are:

✅ **Monitor** data quality daily (target >85 score)  
✅ **Optimize** performance (response times <2s)  
✅ **Troubleshoot** issues using this guide  
✅ **Maintain** databases and indexes  
✅ **Support** users with validation issues  
✅ **Report** bugs and suggest improvements  

Keep this guide bookmarked and review monthly for updates!

**Last Updated:** 2025-11-26  
**Guide Version:** 2.0
