#!/usr/bin/env node
/**
 * Script to create 12 AI Feedback System issues using GitHub API
 * 
 * Prerequisites:
 * - Node.js installed
 * - GitHub Personal Access Token with 'repo' scope
 * 
 * Usage:
 *   GITHUB_TOKEN=your_token_here node scripts/create-issues-api.js
 * 
 * Or set the token in your environment:
 *   export GITHUB_TOKEN=your_token_here
 *   node scripts/create-issues-api.js
 */

const https = require('https');

const REPO_OWNER = 'Treystu';
const REPO_NAME = 'BMSview';
const PARENT_ISSUE = 204;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('❌ Error: GITHUB_TOKEN environment variable is not set');
  console.error('');
  console.error('Please set your GitHub Personal Access Token:');
  console.error('  export GITHUB_TOKEN=your_token_here');
  console.error('  node scripts/create-issues-api.js');
  console.error('');
  console.error('To create a token, visit: https://github.com/settings/tokens');
  process.exit(1);
}

const issues = [
  {
    title: 'Data Privacy & Compliance Framework for AI Feedback System',
    body: `## Overview
Implement comprehensive data privacy and compliance framework for AI feedback system.

## Tasks
- [ ] Implement data anonymization for AI feedback when dealing with user data
- [ ] Add GDPR compliance for storing and processing feedback
- [ ] Create data retention policies for AI-generated insights
- [ ] Implement user consent mechanisms for AI analysis

## Acceptance Criteria
- All user data is anonymized before AI processing
- GDPR compliance documentation completed
- Data retention policies documented and implemented
- User consent UI/UX implemented and tested

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
High`,
    labels: ['privacy', 'compliance', 'security', 'ai-feedback']
  },
  {
    title: 'Testing & Validation Infrastructure for AI Feedback',
    body: `## Overview
Create comprehensive testing and validation infrastructure for AI feedback system.

## Tasks
- [ ] Create unit tests for all statistical analysis functions
- [ ] Implement integration tests for the full context pipeline
- [ ] Add performance benchmarks for large dataset processing
- [ ] Create validation suite for AI feedback quality
- [ ] Implement A/B testing framework for AI suggestions

## Acceptance Criteria
- 90%+ code coverage for statistical functions
- Integration tests pass for all data pipeline scenarios
- Performance benchmarks established and documented
- AI feedback quality metrics defined and tracked
- A/B testing framework operational

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
High`,
    labels: ['testing', 'validation', 'quality-assurance', 'ai-feedback']
  },
  {
    title: 'Monitoring & Observability for AI Feedback System',
    body: `## Overview
Implement comprehensive monitoring and observability for AI feedback system.

## Tasks
- [ ] Set up metrics collection for AI feedback accuracy
- [ ] Implement tracking for feedback implementation success rates
- [ ] Create dashboards for system performance with full context mode
- [ ] Add alerting for anomalous AI behavior or feedback patterns
- [ ] Implement cost tracking for increased Gemini API usage

## Acceptance Criteria
- Real-time metrics dashboard operational
- Alert system configured with appropriate thresholds
- Cost tracking integrated with billing alerts
- Performance metrics baselined and tracked
- Anomaly detection system operational

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Medium`,
    labels: ['monitoring', 'observability', 'metrics', 'ai-feedback']
  },
  {
    title: 'Error Handling & Resilience for AI Operations',
    body: `## Overview
Implement robust error handling and resilience mechanisms for AI feedback system.

## Tasks
- [ ] Implement fallback mechanisms when full context exceeds token limits
- [ ] Add graceful degradation when statistical tools fail
- [ ] Create error recovery for failed GitHub issue creation
- [ ] Implement retry logic for AI feedback submission
- [ ] Add circuit breakers for external API dependencies

## Acceptance Criteria
- System continues operating when individual components fail
- Token limit exceeded scenarios handled gracefully
- Retry logic implemented with exponential backoff
- Circuit breakers prevent cascade failures
- Error messages are informative and actionable

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
High`,
    labels: ['error-handling', 'resilience', 'reliability', 'ai-feedback']
  },
  {
    title: 'Documentation & Training for AI Feedback System',
    body: `## Overview
Create comprehensive documentation and training materials for AI feedback system.

## Tasks
- [ ] Create developer documentation for the feedback API
- [ ] Write user guides for interpreting AI suggestions
- [ ] Document statistical model assumptions and limitations
- [ ] Create training materials for admin dashboard usage
- [ ] Add inline documentation for all new statistical functions

## Acceptance Criteria
- API documentation complete with examples
- User guides reviewed and approved
- Statistical model documentation peer-reviewed
- Training materials tested with target audience
- All functions have JSDoc/TypeScript documentation

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Medium`,
    labels: ['documentation', 'training', 'developer-experience', 'ai-feedback']
  },
  {
    title: 'Performance Optimization Infrastructure for Full Context Mode',
    body: `## Overview
Implement performance optimization infrastructure for handling large-scale data processing.

## Tasks
- [ ] Implement caching layer for frequently accessed historical data
- [ ] Create data partitioning strategy for large datasets
- [ ] Add query optimization for MongoDB aggregations
- [ ] Implement batch processing for statistical calculations
- [ ] Create CDN strategy for serving large context responses

## Acceptance Criteria
- Response times < 2s for 95th percentile requests
- Caching reduces database load by 60%+
- Batch processing handles 10K+ data points efficiently
- MongoDB queries optimized with proper indexing
- CDN configured for static content delivery

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Medium`,
    labels: ['performance', 'optimization', 'scalability', 'ai-feedback']
  },
  {
    title: 'Feedback Loop Metrics & Analytics Dashboard',
    body: `## Overview
Build analytics system to track AI feedback effectiveness and ROI.

## Tasks
- [ ] Build analytics to track which AI suggestions get implemented
- [ ] Create ROI calculator for implemented suggestions
- [ ] Implement user satisfaction tracking for AI-driven changes
- [ ] Add metrics for time-to-implementation of suggestions
- [ ] Create feedback effectiveness scoring system

## Acceptance Criteria
- Dashboard shows implementation rate of AI suggestions
- ROI calculations automated and reported monthly
- User satisfaction surveys integrated post-implementation
- Time-to-implementation tracked and optimized
- Effectiveness scores guide future AI training

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Low`,
    labels: ['analytics', 'metrics', 'roi', 'ai-feedback']
  },
  {
    title: 'External Tool Integrations for AI Feedback',
    body: `## Overview
Implement integrations with external tools and platforms for AI feedback system.

## Tasks
- [ ] Implement Slack/Discord notifications for critical AI feedback
- [ ] Create webhook system for third-party integrations
- [ ] Add export functionality for AI insights (CSV, JSON, PDF)
- [ ] Implement integration with project management tools (Jira, Linear)
- [ ] Create API for external systems to query AI feedback

## Acceptance Criteria
- Slack notifications working for high-priority feedback
- Webhook system documented and tested
- Export functionality supports all major formats
- At least one project management tool integrated
- Public API documented and rate-limited

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Low`,
    labels: ['integrations', 'external-tools', 'api', 'ai-feedback']
  },
  {
    title: 'Security Hardening for AI Feedback Endpoints',
    body: `## Overview
Implement comprehensive security hardening for AI feedback system.

## Tasks
- [ ] Implement input validation for all AI feedback endpoints
- [ ] Add rate limiting per user/system for feedback generation
- [ ] Create audit logs for all AI feedback actions
- [ ] Implement role-based access control for feedback management
- [ ] Add encryption for sensitive feedback data at rest

## Acceptance Criteria
- All endpoints protected against injection attacks
- Rate limiting prevents API abuse
- Audit logs capture all critical actions
- RBAC implemented with at least 3 role levels
- Encryption verified for sensitive data storage

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
High`,
    labels: ['security', 'hardening', 'authentication', 'ai-feedback']
  },
  {
    title: 'Migration & Rollback Strategy for AI System',
    body: `## Overview
Create comprehensive migration and rollback strategy for AI feedback system deployment.

## Tasks
- [ ] Create data migration scripts for existing analyses
- [ ] Implement feature flags for gradual rollout
- [ ] Create rollback procedures for each phase
- [ ] Add backwards compatibility for existing API consumers
- [ ] Implement data backup before major changes

## Acceptance Criteria
- Zero-downtime migration process documented
- Feature flags control all major features
- Rollback tested and takes < 15 minutes
- API versioning maintains backwards compatibility
- Automated backups before all migrations

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Medium`,
    labels: ['migration', 'deployment', 'rollback', 'ai-feedback']
  },
  {
    title: 'Cost Management & Optimization for AI Operations',
    body: `## Overview
Implement cost management and optimization strategies for AI operations.

## Tasks
- [ ] Implement cost estimation before running full context analysis
- [ ] Create budget alerts for API usage
- [ ] Add tiered processing based on priority/cost
- [ ] Implement data sampling strategies for cost reduction
- [ ] Create cost-benefit analysis dashboard

## Acceptance Criteria
- Cost estimates shown before expensive operations
- Budget alerts trigger at 50%, 75%, and 90% thresholds
- Tiered processing reduces costs by 30%+
- Sampling strategies maintain 95%+ accuracy
- Dashboard shows real-time cost vs. benefit metrics

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Medium`,
    labels: ['cost-management', 'optimization', 'budgeting', 'ai-feedback']
  },
  {
    title: 'User Experience Enhancements for AI Feedback Dashboard',
    body: `## Overview
Implement UX enhancements for AI feedback system interaction.

## Tasks
- [ ] Add progress indicators for long-running analyses
- [ ] Create notification preferences for AI suggestions
- [ ] Implement feedback filtering and search in admin UI
- [ ] Add bulk actions for feedback management
- [ ] Create mobile-responsive admin dashboard

## Acceptance Criteria
- Progress indicators show real-time analysis status
- Users can configure notification preferences
- Search and filter reduce feedback discovery time by 50%
- Bulk actions handle 100+ items efficiently
- Mobile dashboard fully functional on all devices

## Parent Issue
Related to #${PARENT_ISSUE} - Full Context Mode with AI-Driven App Feedback System

## Priority
Low`,
    labels: ['user-experience', 'ui-ux', 'dashboard', 'ai-feedback']
  }
];

/**
 * Make an HTTPS request to GitHub API
 */
function makeGitHubRequest(path, method, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'User-Agent': 'BMSview-Issue-Creator',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * Create a single GitHub issue
 */
async function createIssue(issueData) {
  const path = `/repos/${REPO_OWNER}/${REPO_NAME}/issues`;
  return await makeGitHubRequest(path, 'POST', issueData);
}

/**
 * Add a delay between requests to avoid rate limiting
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main function to create all issues
 */
async function main() {
  console.log('🚀 Creating 12 AI Feedback System issues...');
  console.log(`📍 Repository: ${REPO_OWNER}/${REPO_NAME}`);
  console.log(`🔗 Parent issue: #${PARENT_ISSUE}`);
  console.log('');

  const createdIssues = [];

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    try {
      console.log(`[${i + 1}/12] Creating: ${issue.title}`);
      
      const result = await createIssue(issue);
      createdIssues.push(result);
      
      console.log(`✅ Created issue #${result.number}: ${result.html_url}`);
      
      // Wait 1 second between requests to be nice to the API
      if (i < issues.length - 1) {
        await delay(1000);
      }
    } catch (error) {
      console.error(`❌ Failed to create issue: ${issue.title}`);
      console.error(`   Error: ${error.message}`);
      
      // Continue with next issue instead of stopping
      continue;
    }
  }

  console.log('');
  console.log('📊 Summary:');
  console.log(`   ✅ Successfully created: ${createdIssues.length}/${issues.length} issues`);
  
  if (createdIssues.length > 0) {
    console.log('');
    console.log('📝 Created issues:');
    createdIssues.forEach((issue) => {
      console.log(`   #${issue.number}: ${issue.title}`);
      console.log(`   ${issue.html_url}`);
    });
  }

  if (createdIssues.length < issues.length) {
    console.log('');
    console.log('⚠️  Some issues failed to create. Check the error messages above.');
    process.exit(1);
  }

  console.log('');
  console.log('✨ All issues created successfully!');
  console.log(`🔗 View all issues: https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`);
}

// Run the script
main().catch((error) => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
