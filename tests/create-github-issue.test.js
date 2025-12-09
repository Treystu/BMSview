/**
 * Tests for Create GitHub Issue Endpoint
 * 
 * Tests the GitHub API integration for creating issues from AI feedback.
 */

// Mock MongoDB before requiring the handler
jest.mock('../netlify/functions/utils/mongodb.cjs', () => ({
  getCollection: jest.fn()
}));

// Mock GitHub API for duplicate detection
jest.mock('../netlify/functions/utils/github-api.cjs', () => ({
  searchGitHubIssues: jest.fn().mockResolvedValue({
    total_count: 0,
    items: []
  })
}));

const { handler, formatGitHubIssue, createGitHubIssueAPI } = require('../netlify/functions/create-github-issue.cjs');
const { getCollection } = require('../netlify/functions/utils/mongodb.cjs');
const { searchGitHubIssues } = require('../netlify/functions/utils/github-api.cjs');

// Mock fetch globally
global.fetch = jest.fn();

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

describe('create-github-issue', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GITHUB_TOKEN = 'test_github_token';
    process.env.GITHUB_REPO_OWNER = 'TestOwner';
    process.env.GITHUB_REPO_NAME = 'TestRepo';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('formatGitHubIssue', () => {
    const mockFeedback = {
      priority: 'high',
      category: 'performance',
      feedbackType: 'improvement_suggestion',
      geminiModel: 'gemini-2.5-flash',
      systemId: 'system-123',
      timestamp: new Date('2025-01-15'),
      id: 'feedback-123',
      suggestion: {
        title: 'Improve response time',
        description: 'The API response time can be improved',
        rationale: 'Better user experience',
        expectedBenefit: '50% faster responses',
        implementation: 'Add caching layer',
        estimatedEffort: '2 days',
        affectedComponents: ['api', 'cache'],
        codeSnippets: ['const cache = new Cache();']
      }
    };

    test('should format feedback with correct title structure', () => {
      const result = formatGitHubIssue(mockFeedback);
      
      expect(result.title).toContain('🟠'); // high priority emoji
      expect(result.title).toContain('⚡'); // performance category emoji
      expect(result.title).toContain('Improve response time');
    });

    test('should include all required sections in body', () => {
      const result = formatGitHubIssue(mockFeedback);
      
      expect(result.body).toContain('## AI-Generated Feedback');
      expect(result.body).toContain('### Description');
      expect(result.body).toContain('### Rationale');
      expect(result.body).toContain('### Expected Benefit');
      expect(result.body).toContain('### Implementation Details');
      expect(result.body).toContain('### Affected Components');
      expect(result.body).toContain('### Suggested Code');
    });

    test('should include correct labels', () => {
      const result = formatGitHubIssue(mockFeedback);
      
      expect(result.labels).toContain('ai-generated');
      expect(result.labels).toContain('priority-high');
      expect(result.labels).toContain('category-performance');
      expect(result.labels).toContain('improvement_suggestion');
    });

    test('should handle missing optional fields', () => {
      const minimalFeedback = {
        ...mockFeedback,
        suggestion: {
          ...mockFeedback.suggestion,
          affectedComponents: [],
          codeSnippets: []
        }
      };

      const result = formatGitHubIssue(minimalFeedback);
      
      expect(result.body).not.toContain('### Affected Components');
      expect(result.body).not.toContain('### Suggested Code');
    });
  });

  describe('createGitHubIssueAPI', () => {
    const validIssueData = {
      title: 'Test Issue',
      body: 'Test body content',
      labels: ['test-label']
    };

    test('should throw error when issueData is not an object', async () => {
      await expect(createGitHubIssueAPI(null, mockLogger))
        .rejects.toThrow('issueData must be an object');
      
      await expect(createGitHubIssueAPI('string', mockLogger))
        .rejects.toThrow('issueData must be an object');
    });

    test('should throw error when title is missing', async () => {
      await expect(createGitHubIssueAPI({ body: 'test' }, mockLogger))
        .rejects.toThrow('issueData.title is required and must be a string');
    });

    test('should throw error when body is missing', async () => {
      await expect(createGitHubIssueAPI({ title: 'test' }, mockLogger))
        .rejects.toThrow('issueData.body is required and must be a string');
    });

    test('should throw error when GITHUB_TOKEN is missing', async () => {
      delete process.env.GITHUB_TOKEN;
      
      await expect(createGitHubIssueAPI(validIssueData, mockLogger))
        .rejects.toThrow('GITHUB_TOKEN environment variable is not configured');
    });

    test('should create GitHub issue successfully', async () => {
      const mockResponse = {
        number: 123,
        url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/123',
        html_url: 'https://github.com/TestOwner/TestRepo/issues/123',
        state: 'open',
        created_at: '2025-01-15T00:00:00Z'
      };

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await createGitHubIssueAPI(validIssueData, mockLogger);

      expect(result.number).toBe(123);
      expect(result.html_url).toBe('https://github.com/TestOwner/TestRepo/issues/123');
      expect(result.state).toBe('open');
      expect(mockLogger.info).toHaveBeenCalledWith('Calling GitHub API to create issue', expect.any(Object));
      expect(mockLogger.info).toHaveBeenCalledWith('GitHub issue created successfully', expect.any(Object));
    });

    test('should handle GitHub API 401 (authentication) error', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({
          message: 'Bad credentials',
          documentation_url: 'https://docs.github.com/rest'
        })
      });

      await expect(createGitHubIssueAPI(validIssueData, mockLogger))
        .rejects.toThrow('GitHub API error (401): Bad credentials');
    });

    test('should handle GitHub API 403 (permissions) error', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({
          message: 'Resource not accessible by integration',
          documentation_url: 'https://docs.github.com/rest'
        })
      });

      await expect(createGitHubIssueAPI(validIssueData, mockLogger))
        .rejects.toThrow('GitHub API error (403): Resource not accessible by integration');
    });

    test('should handle GitHub API 422 (validation) error', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({
          message: 'Validation Failed',
          errors: [{ resource: 'Issue', field: 'title', code: 'missing' }]
        })
      });

      await expect(createGitHubIssueAPI(validIssueData, mockLogger))
        .rejects.toThrow('GitHub API error (422): Validation Failed');
    });

    test('should retry on 429 (rate limit) error', async () => {
      // First call returns 429, second call succeeds
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            number: 456,
            url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/456',
            html_url: 'https://github.com/TestOwner/TestRepo/issues/456',
            state: 'open',
            created_at: '2025-01-15T00:00:00Z'
          })
        });

      const result = await createGitHubIssueAPI(validIssueData, mockLogger);

      expect(result.number).toBe(456);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, 10000);

    test('should retry on 5xx server errors', async () => {
      // First call returns 503, second call succeeds
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable'
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            number: 789,
            url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/789',
            html_url: 'https://github.com/TestOwner/TestRepo/issues/789',
            state: 'open',
            created_at: '2025-01-15T00:00:00Z'
          })
        });

      const result = await createGitHubIssueAPI(validIssueData, mockLogger);

      expect(result.number).toBe(789);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('handler', () => {
    const mockFeedbackData = {
      id: 'feedback-123',
      priority: 'high',
      category: 'performance',
      feedbackType: 'improvement',
      geminiModel: 'gemini-2.5-flash',
      systemId: 'system-123',
      timestamp: new Date(),
      suggestion: {
        title: 'Test Improvement',
        description: 'Test description',
        rationale: 'Test rationale',
        expectedBenefit: 'Test benefit',
        implementation: 'Test implementation',
        estimatedEffort: '1 day'
      }
    };

    beforeEach(() => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(mockFeedbackData),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
      };
      getCollection.mockResolvedValue(mockCollection);
    });

    test('should handle OPTIONS request', async () => {
      const event = {
        httpMethod: 'OPTIONS',
        headers: {}
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
    });

    test('should reject non-POST methods', async () => {
      const event = {
        httpMethod: 'GET',
        headers: {}
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(405);
      expect(JSON.parse(response.body).error).toBe('Method not allowed');
    });

    test('should require feedbackId or feedback', async () => {
      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({})
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Either feedbackId or feedback is required');
    });

    test('should return 404 for non-existent feedback', async () => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };
      getCollection.mockResolvedValue(mockCollection);

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'non-existent' })
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toBe('Feedback not found');
    });

    test('should return 409 when GitHub issue already exists', async () => {
      const mockCollection = {
        findOne: jest.fn().mockResolvedValue({
          ...mockFeedbackData,
          githubIssue: { number: 100, url: 'https://github.com/test/test/issues/100' }
        })
      };
      getCollection.mockResolvedValue(mockCollection);

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error).toBe('GitHub issue already exists for this feedback');
    });

    test('should create GitHub issue successfully', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 200,
          url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/200',
          html_url: 'https://github.com/TestOwner/TestRepo/issues/200',
          state: 'open',
          created_at: '2025-01-15T00:00:00Z'
        })
      });

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.issueNumber).toBe(200);
      
      // Verify searchGitHubIssues was called for duplicate detection
      expect(searchGitHubIssues).toHaveBeenCalled();
    });

    test('should detect duplicate issues using searchGitHubIssues', async () => {
      // Mock searchGitHubIssues to return similar issues
      searchGitHubIssues.mockResolvedValueOnce({
        total_count: 1,
        items: [{
          number: 50,
          title: '🟠 ⚡ Test Improvement',
          html_url: 'https://github.com/TestOwner/TestRepo/issues/50',
          state: 'open'
        }]
      });

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      // Should detect as duplicate and return 409
      expect(response.statusCode).toBe(409);
      expect(body.error).toBe('Duplicate issue detected');
      expect(body.duplicateIssue).toBeDefined();
      expect(body.duplicateIssue.number).toBe(50);
      expect(body.reason).toBeDefined();
      
      // Verify searchGitHubIssues was called with correct parameters
      expect(searchGitHubIssues).toHaveBeenCalled();
      const searchCall = searchGitHubIssues.mock.calls[0];
      expect(searchCall[0]).toEqual(expect.objectContaining({
        query: expect.any(String),
        state: 'all',
        per_page: 10
      }));
    });

    test('should proceed with issue creation when no duplicates found', async () => {
      // Mock searchGitHubIssues to return no duplicates
      searchGitHubIssues.mockResolvedValueOnce({
        total_count: 0,
        items: []
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 201,
          url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/201',
          html_url: 'https://github.com/TestOwner/TestRepo/issues/201',
          state: 'open',
          created_at: '2025-01-15T00:00:00Z'
        })
      });

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.issueNumber).toBe(201);
      expect(searchGitHubIssues).toHaveBeenCalled();
    });

    test('should handle searchGitHubIssues errors gracefully', async () => {
      // Mock searchGitHubIssues to return an error
      searchGitHubIssues.mockResolvedValueOnce({
        error: true,
        message: 'GitHub API rate limit exceeded'
      });

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 202,
          url: 'https://api.github.com/repos/TestOwner/TestRepo/issues/202',
          html_url: 'https://github.com/TestOwner/TestRepo/issues/202',
          state: 'open',
          created_at: '2025-01-15T00:00:00Z'
        })
      });

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});
      const body = JSON.parse(response.body);

      // Should still create the issue despite search failure
      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(searchGitHubIssues).toHaveBeenCalled();
    });

    test('should handle API errors gracefully', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Bad credentials' })
      });

      const event = {
        httpMethod: 'POST',
        headers: {},
        body: JSON.stringify({ feedbackId: 'feedback-123' })
      };

      const response = await handler(event, {});

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toBe('Failed to create GitHub issue');
    });
  });
});
