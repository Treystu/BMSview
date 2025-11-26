# Full Context Mode with AI-Driven App Feedback System

## Overview

The Full Context Mode with AI-Driven App Feedback System transforms Gemini AI from a passive analyzer into an active collaborator that provides deep insights and suggests application improvements.

## Architecture

### Components

1. **Full Context Builder** (`netlify/functions/utils/full-context-builder.cjs`)
   - Aggregates ALL available data points
   - Runs statistical analysis tools
   - Collects external data sources
   - Computes health metrics

2. **Statistical Tools Suite** (`netlify/functions/utils/statistical-tools.cjs`)
   - Basic statistical analysis (mean, median, std dev, percentiles)
   - Trend analysis with linear regression
   - Anomaly detection using standard deviation
   - Correlation analysis for multivariate data

3. **AI Feedback System**
   - Submission endpoint (`ai-feedback.cjs`)
   - Retrieval endpoint (`get-ai-feedback.cjs`)
   - Status update endpoint (`update-feedback-status.cjs`)
   - GitHub issue creation (`create-github-issue.cjs`)

4. **Enhanced Insights Generation** (`generate-insights-full-context.cjs`)
   - Full context mode with comprehensive data analysis
   - Function calling for AI feedback submission
   - Gemini 2.5 Flash integration

5. **Admin Dashboard UI** (`components/AIFeedbackDashboard.tsx`)
   - Priority-based feedback display
   - Status management
   - GitHub issue integration
   - Filtering by status, priority, category

## Features

### Full Context Data Aggregation

The system aggregates:
- **Raw Data**: All analyses, cell data, temperatures, voltages, currents, alarms, state changes
- **Tool Outputs**: Statistical analysis, trend detection, anomaly detection, correlations
- **External Data**: Weather history, solar production, grid pricing (future)
- **Metadata**: System configuration, battery specs, warranty info (future)
- **Computed Metrics**: Health score, remaining life, degradation rate, efficiency

### Statistical Analysis

#### Basic Statistics
- Descriptive statistics (mean, median, std dev, variance, range)
- Percentiles (p5, p25, p50, p75, p95, p99)
- Outlier detection using IQR method

#### Trend Analysis
- Linear regression on time series data
- R-squared confidence metrics
- Change point detection
- Trend classification (increasing/decreasing/stable)

#### Anomaly Detection
- Standard deviation-based anomaly scoring
- Configurable thresholds (default: 3σ)
- Anomaly rate calculation

#### Correlation Analysis
- Pearson correlation coefficients
- Correlation matrix generation
- Strong correlation identification (|r| > 0.7)

### AI Feedback System

#### Feedback Types
- `feature_request` - New feature suggestions
- `api_suggestion` - API integration improvements
- `data_format` - Data structure optimizations
- `bug_report` - Identified issues
- `optimization` - Performance improvements

#### Categories
- `weather_api` - Weather service integrations
- `data_structure` - Data models and schemas
- `ui_ux` - User interface improvements
- `performance` - Speed and efficiency
- `integration` - External service connections
- `analytics` - Analysis and reporting

#### Priority Levels
- `critical` 🔴 - Immediate attention required
- `high` 🟠 - Important improvements
- `medium` 🟡 - Moderate priority
- `low` ⚪ - Nice to have

#### Feedback Workflow
1. **AI Generation**: Gemini identifies improvement opportunities
2. **Function Call**: Uses `submitAppFeedback` function
3. **Storage**: Saved to MongoDB with deduplication
4. **Review**: Admin reviews in dashboard
5. **Status Updates**: Pending → Reviewed → Accepted → Implemented
6. **GitHub Integration**: Auto-create issues for high-priority items

## API Endpoints

### POST `/.netlify/functions/generate-insights-full-context`

Generate insights with complete context and feedback capability.

**Request:**
```json
{
  "systemId": "sys_123",
  "enableFeedback": true,
  "contextWindowDays": 90,
  "customPrompt": "Optional custom analysis prompt"
}
```

**Response:**
```json
{
  "insights": "Comprehensive analysis text...",
  "dataPointsAnalyzed": 15420,
  "feedbackSubmitted": 2,
  "feedbackSubmissions": [
    {
      "feedbackId": "fb_123",
      "isDuplicate": false,
      "type": "api_suggestion",
      "priority": "high"
    }
  ],
  "contextSize": 524288,
  "systemId": "sys_123",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### POST `/.netlify/functions/ai-feedback`

Submit AI-generated feedback.

**Request:**
```json
{
  "systemId": "sys_123",
  "feedbackType": "api_suggestion",
  "category": "weather_api",
  "priority": "high",
  "content": {
    "title": "Switch to Solcast API",
    "description": "Current weather API has 3-hour granularity...",
    "rationale": "Finer granularity improves solar predictions...",
    "implementation": "Replace OpenWeatherMap calls...",
    "expectedBenefit": "Reduce prediction error from 23% to <8%",
    "estimatedEffort": "days",
    "codeSnippets": ["const forecast = await solcast.getForecast()"],
    "affectedComponents": ["weatherService.ts", "solarIntegration.cjs"]
  }
}
```

### GET `/.netlify/functions/get-ai-feedback`

Retrieve AI feedback with filtering.

**Query Parameters:**
- `status` - Filter by status (default: 'all')
- `priority` - Filter by priority
- `category` - Filter by category
- `limit` - Results per page (default: 50)
- `skip` - Pagination offset (default: 0)

### POST `/.netlify/functions/update-feedback-status`

Update feedback status.

**Request:**
```json
{
  "feedbackId": "fb_123",
  "status": "accepted",
  "adminNotes": "Approved for Q2 implementation"
}
```

### POST `/.netlify/functions/create-github-issue`

Auto-generate GitHub issue from feedback.

**Request:**
```json
{
  "feedbackId": "fb_123"
}
```

**Response:**
```json
{
  "success": true,
  "issueNumber": 204,
  "issueUrl": "https://github.com/Treystu/BMSview/issues/204",
  "feedbackId": "fb_123"
}
```

## Database Schema

### Collection: `ai_feedback`

```javascript
{
  _id: ObjectId,
  id: String,                    // Unique feedback ID
  timestamp: Date,               // Creation timestamp
  systemId: String,              // Associated BMS system
  feedbackType: String,          // Type of feedback
  category: String,              // Category
  priority: String,              // Priority level
  status: String,                // Current status
  geminiModel: String,           // AI model used
  contextHash: String,           // Hash for deduplication
  suggestion: {
    title: String,
    description: String,
    rationale: String,
    implementation: String,
    expectedBenefit: String,
    estimatedEffort: String,
    codeSnippets: [String],
    affectedComponents: [String]
  },
  githubIssue: {
    number: Number,
    url: String,
    status: String
  },
  adminNotes: String,
  implementationDate: Date,
  updatedAt: Date,
  metrics: {
    viewCount: Number,
    lastViewed: Date,
    discussionCount: Number
  }
}
```

### Indexes

```javascript
db.ai_feedback.createIndex({ priority: 1, status: 1 });
db.ai_feedback.createIndex({ systemId: 1, timestamp: -1 });
db.ai_feedback.createIndex({ contextHash: 1 });  // Prevent duplicates
```

## Usage Examples

### Example 1: Generate Full Context Insights

```javascript
const response = await fetch('/.netlify/functions/generate-insights-full-context', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    systemId: 'my_system_001',
    enableFeedback: true,
    contextWindowDays: 90
  })
});

const data = await response.json();
console.log('Insights:', data.insights);
console.log('Feedback submitted:', data.feedbackSubmitted);
```

### Example 2: Review AI Feedback in Admin Dashboard

1. Navigate to Admin Dashboard
2. Scroll to "🤖 AI Feedback & Suggestions" section
3. Use tabs to filter by status (Pending, Reviewed, Accepted, Implemented)
4. Review feedback details
5. Update status using dropdown
6. Create GitHub issue for high-priority items

### Example 3: Custom Analysis with Feedback

```javascript
const response = await fetch('/.netlify/functions/generate-insights-full-context', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    systemId: 'my_system_001',
    enableFeedback: true,
    customPrompt: `
      Analyze battery degradation patterns and identify:
      1. Root causes of capacity loss
      2. Optimal charging strategies
      3. Improvements to prediction accuracy
      
      If you identify any app improvements, submit feedback.
    `
  })
});
```

## Testing

Run the comprehensive test suite:

```bash
npm test -- tests/full-context-system.test.js
```

**Test Coverage:**
- Full context builder (3 tests)
- Statistical analysis (6 tests)
- Trend analysis (3 tests)
- Anomaly detection (2 tests)
- Correlation analysis (3 tests)
- AI feedback validation (3 tests)

**Total: 17 tests, all passing**

## Performance Considerations

### Data Volume Management
- Default context window: 90 days
- Configurable via `contextWindowDays` parameter
- Full context size typically: 100KB - 2MB
- Gemini token limit: ~1M tokens (plenty of headroom)

### Database Optimization
- Indexes on priority, status, systemId, timestamp
- Deduplication using contextHash
- Pagination for large result sets

### Caching Strategy
- MongoDB connection pooling (5 connections)
- Health check interval: 60 seconds
- Context reuse within analysis session

## Security

### API Protection
- CORS enabled with proper headers
- Input validation on all endpoints
- MongoDB injection prevention
- Rate limiting (inherited from Netlify)

### Data Privacy
- System IDs used instead of sensitive data
- Admin-only access to feedback dashboard
- GitHub token stored as environment variable

## Future Enhancements

1. **GitHub API Integration**
   - Real GitHub issue creation (currently mock)
   - Issue status synchronization
   - Comment tracking

2. **Advanced Analytics**
   - Machine learning models (LSTM, Prophet)
   - Frequency domain analysis (FFT)
   - Seasonal decomposition
   - Causal inference

3. **External Data Sources**
   - Grid pricing history
   - Maintenance records
   - Warranty tracking
   - Installation metadata

4. **Automated Actions**
   - Auto-accept low-risk improvements
   - A/B testing for suggestions
   - Performance impact tracking
   - ROI calculation

5. **Collaboration Features**
   - Multi-admin review workflow
   - Discussion threads on feedback
   - Voting/ranking system
   - Implementation tracking

## Troubleshooting

### Issue: No feedback generated

**Solution:** Ensure `enableFeedback: true` in request and sufficient data points available.

### Issue: Duplicate feedback

**Solution:** System automatically deduplicates using contextHash. Check existing feedback before manual submission.

### Issue: GitHub issue creation fails

**Solution:** Currently using mock implementation. To enable real GitHub integration, set `GITHUB_TOKEN` environment variable.

### Issue: Large context size

**Solution:** Reduce `contextWindowDays` parameter or implement data sampling for very large datasets.

## Contributing

When adding new feedback types or categories:

1. Update validation in `ai-feedback.cjs`
2. Add to TypeScript types in `types.ts`
3. Update dashboard UI in `AIFeedbackDashboard.tsx`
4. Add tests to `tests/full-context-system.test.js`
5. Update this documentation

## License

Part of BMSview project. See main README for license information.
