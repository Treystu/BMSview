# AI Feedback System Quick Reference

## For Developers

### Enabling AI Feedback in Your Code

```javascript
// When calling insights generation
const response = await fetch('/.netlify/functions/generate-insights-full-context', {
  method: 'POST',
  body: JSON.stringify({
    systemId: 'your_system_id',
    enableFeedback: true,  // Enable AI feedback
    contextWindowDays: 90   // Analyze last 90 days
  })
});
```

### Adding Custom Feedback Prompts

```javascript
// Guide the AI to look for specific improvements
const response = await fetch('/.netlify/functions/generate-insights-full-context', {
  method: 'POST',
  body: JSON.stringify({
    systemId: 'your_system_id',
    enableFeedback: true,
    customPrompt: `
      Focus on:
      1. Solar charging efficiency
      2. Battery degradation patterns
      3. Weather API accuracy
      
      Suggest improvements if found.
    `
  })
});
```

## For Administrators

### Accessing AI Feedback Dashboard

1. Log in to Admin Dashboard (`/admin.html`)
2. Scroll to "🤖 AI Feedback & Suggestions" section
3. Use tabs to filter feedback

### Feedback Status Workflow

```
Pending → Reviewed → Accepted → Implemented
                  ↓
              Rejected
```

### Priority Levels

| Priority | Badge | Action |
|----------|-------|--------|
| Critical | 🔴 | Immediate attention |
| High | 🟠 | Review within 1 week |
| Medium | 🟡 | Review within 1 month |
| Low | ⚪ | Review as capacity allows |

### Creating GitHub Issues

1. Find high-priority feedback
2. Review details
3. Click "Create GitHub Issue" button
4. Issue automatically formatted and created

## Feedback Categories

| Category | Icon | Description |
|----------|------|-------------|
| Weather API | 🌤️ | Weather service improvements |
| Data Structure | 🗄️ | Database/data model changes |
| UI/UX | 🎨 | User interface improvements |
| Performance | ⚡ | Speed/efficiency optimizations |
| Integration | 🔌 | External service connections |
| Analytics | 📊 | Analysis and reporting |

## Common Feedback Examples

### API Suggestion
```
Title: Switch to Solcast API for Solar Forecasting
Priority: High
Category: Weather API

Benefit: Reduce solar prediction error from 23% to <8%
Effort: Days
```

### Performance Optimization
```
Title: Implement Protocol Buffers for Data Transfer
Priority: Medium
Category: Performance

Benefit: 65% reduction in payload size, 2.1s faster loads
Effort: Weeks
```

### Feature Request
```
Title: Predictive Alert System for Battery Degradation
Priority: High
Category: Analytics

Benefit: Prevent 73% of unexpected downtimes
Effort: Weeks
```

## API Quick Reference

### Generate Full Context Insights
```bash
POST /.netlify/functions/generate-insights-full-context
Content-Type: application/json

{
  "systemId": "sys_123",
  "enableFeedback": true,
  "contextWindowDays": 90
}
```

### Get AI Feedback
```bash
GET /.netlify/functions/get-ai-feedback?status=pending&priority=high
```

### Update Feedback Status
```bash
POST /.netlify/functions/update-feedback-status
Content-Type: application/json

{
  "feedbackId": "fb_123",
  "status": "accepted",
  "adminNotes": "Approved for implementation"
}
```

### Create GitHub Issue
```bash
POST /.netlify/functions/create-github-issue
Content-Type: application/json

{
  "feedbackId": "fb_123"
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No feedback generated | Enable with `enableFeedback: true` |
| Too many duplicates | System auto-deduplicates; review existing first |
| GitHub creation fails | Check GITHUB_TOKEN environment variable |
| Context too large | Reduce `contextWindowDays` parameter |

## Best Practices

1. **Review Regularly**: Check pending feedback weekly
2. **Prioritize Wisely**: Focus on high/critical items first
3. **Track Implementation**: Update status as work progresses
4. **Close Loop**: Mark as implemented when complete
5. **Learn from AI**: Review rejected items to improve AI guidance

## Metrics to Track

- Total feedback items
- Acceptance rate (Accepted / Total)
- Implementation rate (Implemented / Accepted)
- Average time to implementation
- ROI of implemented suggestions

## Environment Variables

```bash
# Required
GEMINI_API_KEY=your_api_key
MONGODB_URI=mongodb://...

# Optional (for GitHub integration)
GITHUB_TOKEN=your_github_token

# Model selection
GEMINI_MODEL=gemini-2.5-flash
```

## Contact

For issues or questions:
- Open GitHub issue
- Check documentation in `docs/FULL_CONTEXT_MODE.md`
- Review test examples in `tests/full-context-system.test.js`
