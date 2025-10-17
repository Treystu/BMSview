# BMSview Deployment Checklist

## Pre-Deployment

### 1. Environment Preparation
- [ ] Verify MongoDB connection string is correct
- [ ] Confirm Gemini API key is valid and has quota
- [ ] Check all required environment variables are set
- [ ] Verify Netlify site configuration

### 2. Database Setup
- [ ] Backup existing database
- [ ] Run index creation script: `node scripts/create-indexes.js`
- [ ] Verify indexes are created successfully
- [ ] Test query performance with new indexes

### 3. Code Review
- [ ] Review all enhanced function files
- [ ] Verify logger integration in all functions
- [ ] Check configuration module usage
- [ ] Confirm error handling is comprehensive

### 4. Local Testing
- [ ] Test analyze function locally
- [ ] Test process-analysis function locally
- [ ] Test get-job-status function locally
- [ ] Verify frontend polling hook works correctly

## Deployment Steps

### 1. Backup Current State
```bash
# Backup current functions
mkdir -p backups/$(date +%Y%m%d)
cp netlify/functions/*.js backups/$(date +%Y%m%d)/

# Backup environment variables
netlify env:list > backups/$(date +%Y%m%d)/env-vars.txt

# Tag current state
git tag -a pre-optimization-$(date +%Y%m%d) -m "Pre-optimization backup"
git push origin --tags
```
- [ ] Functions backed up
- [ ] Environment variables documented
- [ ] Git tag created

### 2. Deploy Utility Modules
```bash
# Ensure utils directory is complete
ls -la netlify/functions/utils/
# Should see: logger.js, dbClient.js, geminiClient.js, config.js
```
- [ ] logger.js deployed
- [ ] dbClient.js deployed
- [ ] geminiClient.js deployed
- [ ] config.js deployed

### 3. Update Environment Variables
```bash
# Add new environment variables in Netlify dashboard
# Or use CLI:
netlify env:set DB_MAX_POOL_SIZE 10
netlify env:set RATE_LIMIT_TOKENS_PER_MINUTE 60
netlify env:set CIRCUIT_BREAKER_THRESHOLD 5
# ... (see IMPLEMENTATION_GUIDE.md for full list)
```
- [ ] Database configuration variables set
- [ ] Gemini API configuration variables set
- [ ] Job processing configuration variables set
- [ ] Rate limiting configuration variables set
- [ ] Logging configuration variables set

### 4. Deploy Enhanced Functions

#### Option A: Direct Replacement (Recommended for test-1 branch)
```bash
# Replace existing files
mv netlify/functions/analyze-enhanced.js netlify/functions/analyze.js
mv netlify/functions/process-analysis-enhanced.js netlify/functions/process-analysis.js
mv netlify/functions/get-job-status-optimized.js netlify/functions/get-job-status.js
```
- [ ] analyze.js replaced
- [ ] process-analysis.js replaced
- [ ] get-job-status.js replaced

#### Option B: Gradual Migration (Recommended for production)
```bash
# Deploy enhanced versions with different names first
# Test thoroughly before switching
```
- [ ] Enhanced versions deployed alongside originals
- [ ] Testing completed successfully
- [ ] Traffic switched to enhanced versions
- [ ] Old versions removed

### 5. Deploy Frontend Changes
```bash
# Update frontend components
# Ensure useJobPolling hook is integrated
```
- [ ] useJobPolling hook added
- [ ] AnalysisResult component updated
- [ ] App.tsx updated with new polling logic
- [ ] Error handling improved

### 6. Commit and Push
```bash
git add .
git commit -m "Implement comprehensive BMSview optimizations

- Add shared utilities (logger, dbClient, geminiClient, config)
- Enhance process-analysis with rate limiting and circuit breaker
- Optimize get-job-status with indexes and caching
- Update analyze with environment-aware URLs
- Add useJobPolling hook with exponential backoff
- Create database index migration script
- Add comprehensive documentation"

git push origin test-1
```
- [ ] Changes committed
- [ ] Pushed to test-1 branch
- [ ] Netlify build triggered

## Post-Deployment Verification

### 1. Function Deployment
```bash
# Verify functions are deployed
netlify functions:list

# Should see:
# - analyze
# - process-analysis
# - get-job-status
# - job-shepherd (if enabled)
```
- [ ] All functions listed
- [ ] No deployment errors

### 2. Database Indexes
```bash
# Connect to MongoDB and verify
db.jobs.getIndexes()
db.history.getIndexes()
db.systems.getIndexes()
```
- [ ] jobs collection has 5 indexes
- [ ] history collection has 5 indexes
- [ ] systems collection has 2 indexes

### 3. Function Testing

#### Test analyze function
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "images": [{
      "fileName": "test.jpg",
      "image": "base64_data",
      "mimeType": "image/jpeg"
    }],
    "systems": []
  }'
```
- [ ] Returns 200 status
- [ ] Creates job successfully
- [ ] Logs show proper structure
- [ ] Background processor invoked

#### Test get-job-status function
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/get-job-status \
  -H "Content-Type: application/json" \
  -d '{"jobIds": ["test-job-id"]}'
```
- [ ] Returns 200 status
- [ ] Response time < 500ms
- [ ] Proper status returned
- [ ] Cache headers present

#### Test process-analysis function
```bash
# This is invoked automatically by analyze
# Check logs for:
# - "Function invoked"
# - "Processing job"
# - Status transitions
# - "Job completed" or proper error handling
```
- [ ] Function logs appear
- [ ] Status transitions logged
- [ ] Proper error handling
- [ ] Job completes or fails gracefully

### 4. Log Verification
```bash
# Check logs for structured format
netlify logs --live

# Look for:
# - JSON formatted logs
# - timestamp, level, function, requestId fields
# - Proper error logging
# - Performance metrics
```
- [ ] Logs are structured (JSON format)
- [ ] All required fields present
- [ ] No unexpected errors
- [ ] Performance metrics logged

### 5. Performance Verification

#### Database Query Performance
```bash
# In MongoDB shell:
db.jobs.find({ id: { $in: ["id1", "id2", "id3"] } }).explain("executionStats")

# Verify:
# - executionTimeMillis < 100
# - stage: "IXSCAN" (not COLLSCAN)
# - totalDocsExamined ≈ nReturned
```
- [ ] Query uses index (IXSCAN)
- [ ] Execution time < 100ms
- [ ] No collection scans

#### Function Response Times
```bash
# Monitor function logs for timing metrics
# get-job-status should be < 200ms
# process-analysis should complete within timeout
# analyze should return quickly (< 1s)
```
- [ ] get-job-status < 200ms average
- [ ] analyze < 1s average
- [ ] process-analysis completes successfully

### 6. Rate Limiting Verification
```bash
# Send multiple rapid requests
for i in {1..20}; do
  curl -X POST https://your-site.netlify.app/.netlify/functions/analyze \
    -H "Content-Type: application/json" \
    -d '{"images": [...]}' &
done

# Check logs for rate limiting messages
```
- [ ] Rate limiting activates appropriately
- [ ] No quota exhaustion errors
- [ ] Proper backoff behavior

### 7. Circuit Breaker Verification
```bash
# Temporarily set invalid API key
# Send requests and verify circuit breaker behavior
# Check logs for circuit breaker state changes
```
- [ ] Circuit breaker opens on failures
- [ ] Transitions to half-open after timeout
- [ ] Closes on successful requests

### 8. Frontend Verification
- [ ] Open application in browser
- [ ] Submit test analysis
- [ ] Verify status updates in real-time
- [ ] Check browser console for errors
- [ ] Verify polling stops on completion
- [ ] Test error handling (network errors, etc.)

### 9. End-to-End Test
```bash
# Complete workflow test:
# 1. Upload image
# 2. Monitor status changes
# 3. Verify completion
# 4. Check result accuracy
```
- [ ] Image upload successful
- [ ] Status transitions: Queued → Processing → Completed
- [ ] Result appears in UI
- [ ] Data is accurate
- [ ] No errors in logs

## Monitoring Setup

### 1. Set Up Alerts
- [ ] Database query timeout alerts (> 1s)
- [ ] Function error rate alerts (> 5%)
- [ ] Circuit breaker state alerts
- [ ] Rate limit hit alerts
- [ ] Job failure rate alerts (> 10%)

### 2. Dashboard Configuration
- [ ] Function performance dashboard
- [ ] Database performance metrics
- [ ] API usage tracking
- [ ] Job processing metrics
- [ ] Error rate tracking

### 3. Log Aggregation
- [ ] Configure log aggregation service (optional)
- [ ] Set up log retention policy
- [ ] Configure log search and filtering
- [ ] Set up log-based alerts

## Rollback Plan

### If Issues Occur

#### 1. Immediate Rollback
```bash
# Revert to previous deployment
netlify rollback

# Or restore from backup
cp backups/$(date +%Y%m%d)/*.js netlify/functions/
git commit -am "Rollback to pre-optimization state"
git push origin test-1
```

#### 2. Partial Rollback
```bash
# Rollback specific function
cp backups/$(date +%Y%m%d)/analyze.js netlify/functions/
git commit -am "Rollback analyze function"
git push origin test-1
```

#### 3. Database Rollback
```bash
# Remove indexes if causing issues
db.jobs.dropIndex("idx_jobs_status_created")
# Restore from backup if needed
mongorestore --uri="$MONGODB_URI" backup/
```

### Rollback Checklist
- [ ] Identify problematic component
- [ ] Restore from backup
- [ ] Verify functionality restored
- [ ] Document issue for investigation
- [ ] Plan fix and re-deployment

## Post-Deployment Tasks

### Immediate (Within 1 Hour)
- [ ] Monitor logs for errors
- [ ] Check function invocation counts
- [ ] Verify job completion rates
- [ ] Monitor database performance
- [ ] Check API quota usage

### Short-term (Within 24 Hours)
- [ ] Analyze performance metrics
- [ ] Review error patterns
- [ ] Optimize based on real usage
- [ ] Update documentation if needed
- [ ] Communicate status to team

### Long-term (Within 1 Week)
- [ ] Comprehensive performance review
- [ ] User feedback collection
- [ ] Fine-tune configuration
- [ ] Plan next optimizations
- [ ] Update runbooks

## Success Criteria

### Performance
- ✅ get-job-status response time < 200ms (was 10-20s)
- ✅ Database queries < 100ms (was 10s+)
- ✅ Job completion rate > 95%
- ✅ Error rate < 5%
- ✅ UI updates in real-time

### Reliability
- ✅ No stuck jobs
- ✅ Proper error handling
- ✅ Graceful degradation
- ✅ Rate limiting prevents quota exhaustion
- ✅ Circuit breaker prevents cascading failures

### User Experience
- ✅ Real-time status updates
- ✅ Clear error messages
- ✅ No UI freezing
- ✅ Responsive interface
- ✅ Accurate results

## Sign-off

- [ ] Technical lead approval
- [ ] QA testing completed
- [ ] Performance benchmarks met
- [ ] Documentation updated
- [ ] Team notified

**Deployed by:** _________________  
**Date:** _________________  
**Version:** _________________  
**Notes:** _________________