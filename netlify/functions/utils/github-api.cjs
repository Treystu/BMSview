// @ts-nocheck
/**
 * GitHub API Utility Module
 * Provides safe, validated access to GitHub repository data for AI feedback system
 * 
 * Security Features:
 * - Path allowlist to prevent unauthorized file access
 * - Directory traversal protection
 * - File size limits to prevent token overflow
 * - Rate limiting awareness
 * - Comprehensive error handling
 */

const path = require('path');

/**
 * Allowed paths for file access (security allowlist)
 * Only these paths and their descendants can be accessed
 */
const ALLOWED_PATHS = [
  'netlify/functions',
  'components',
  'services',
  'state',
  'hooks',
  'utils',
  'types.ts',
  'App.tsx',
  'admin.tsx',
  'index.tsx',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
  'README.md',
  'ARCHITECTURE.md',
  'docs'
];

/**
 * Blocked paths that should never be accessed (security exclusions)
 */
const BLOCKED_PATHS = [
  'node_modules',
  '.git',
  '.env',
  '.env.local',
  '.env.production',
  'coverage',
  'dist',
  '.netlify'
];

/**
 * Maximum file size to fetch (15KB to prevent token overflow)
 */
const MAX_FILE_SIZE = 15 * 1024; // 15KB

/**
 * Get repository configuration from environment
 */
function getRepoConfig() {
  return {
    owner: process.env.GITHUB_REPO_OWNER || 'Treystu',
    repo: process.env.GITHUB_REPO_NAME || 'BMSview',
    token: process.env.GITHUB_TOKEN
  };
}

/**
 * Validate GitHub token is configured
 */
function validateToken(token, log) {
  if (!token) {
    log.error('GitHub token not configured');
    throw new Error('GITHUB_TOKEN environment variable is not configured. Please set it in Netlify environment variables.');
  }
}

/**
 * Validate and sanitize file path for security
 * @param {string} path - The file path to validate
 * @param {object} log - Logger instance
 * @returns {string} Sanitized path
 * @throws {Error} If path is invalid or blocked
 */
function validatePath(inputPath, log) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  // Decode URL-encoded characters to prevent bypass
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(inputPath);
  } catch (e) {
    throw new Error('Invalid URL-encoded path');
  }

  // Check for directory traversal attempts BEFORE normalization
  if (decodedPath.includes('./')) {
    log.warn('Directory traversal attempt blocked', { path: inputPath, decodedPath });
    throw new Error('Directory traversal is not allowed');
  }

  // Remove leading/trailing slashes and normalize
  const normalizedPath = decodedPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');

  // Use path.posix.normalize to handle .. properly
  const resolvedPath = path.posix.normalize(normalizedPath);

  // Check for directory traversal attempts (after normalization)
  if (resolvedPath.includes('..')) {
    log.warn('Directory traversal attempt blocked', { path: inputPath, normalizedPath, resolvedPath });
    throw new Error('Directory traversal is not allowed');
  }

  // Split path into parts for segment-level checking
  const parts = resolvedPath.split('/');

  // Check against blocked paths (check each segment)
  // Sort blocked paths by length (descending) to check more specific patterns first
  const sortedBlockedPaths = [...BLOCKED_PATHS].sort((a, b) => b.length - a.length);
  
  for (const blocked of sortedBlockedPaths) {
    // Check if any path segment matches a blocked name
    if (parts.some(p => p === blocked || p.startsWith(blocked + '.'))) {
      log.warn('Blocked path access attempt', { path: resolvedPath, blocked });
      throw new Error(`Access to '${blocked}' is not allowed`);
    }
  }

  // Check against allowed paths
  const isAllowed = ALLOWED_PATHS.some(allowed => 
    resolvedPath === allowed || 
    resolvedPath.startsWith(allowed + '/')
  );

  if (!isAllowed) {
    log.warn('Path not in allowlist', { path: resolvedPath, allowed: ALLOWED_PATHS });
    throw new Error(`Access to '${resolvedPath}' is not allowed. Only specific repository paths can be accessed.`);
  }

  log.debug('Path validated successfully', { path: resolvedPath });
  return resolvedPath;
}

/**
 * Search GitHub issues
 * @param {object} params - Search parameters
 * @param {string} params.query - Search query string
 * @param {string} [params.state] - Issue state: 'open', 'closed', or 'all'
 * @param {string[]} [params.labels] - Label filters
 * @param {number} [params.per_page] - Results per page (max 100)
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Search results with issues array
 */
async function searchGitHubIssues(params, log) {
  const { query, state = 'all', labels = [], per_page = 30 } = params;
  const config = getRepoConfig();
  
  validateToken(config.token, log);

  if (!query || typeof query !== 'string') {
    throw new Error('Query parameter is required and must be a string');
  }

  // Build search query with repository scope
  let searchQuery = `repo:${config.owner}/${config.repo} ${query}`;
  
  // Add state filter if not 'all'
  if (state && state !== 'all') {
    searchQuery += ` state:${state}`;
  }

  // Add label filters (sanitize to prevent query injection)
  if (labels && labels.length > 0) {
    labels.forEach(label => {
      // Escape double quotes in label to prevent breaking the search query
      const sanitizedLabel = label.replace(/"/g, '\\"');
      searchQuery += ` label:"${sanitizedLabel}"`;
    });
  }

  log.info('Searching GitHub issues', {
    owner: config.owner,
    repo: config.repo,
    query: searchQuery,
    per_page
  });

  try {
    const url = new URL('https://api.github.com/search/issues');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('per_page', Math.min(per_page, 100).toString());
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('order', 'desc');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'BMSview-AI-Feedback',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting and other 403 errors
    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      const rateLimitReset = response.headers.get('X-RateLimit-Reset');
      
      if (rateLimitRemaining === '0') {
        const resetDate = new Date(parseInt(rateLimitReset) * 1000);
        log.warn('GitHub API rate limit exceeded', {
          resetAt: resetDate.toISOString()
        });
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleString()}`);
      } else {
        log.warn('GitHub API returned 403 Forbidden (not rate limit)', {
          rateLimitRemaining,
          status: response.status,
          statusText: response.statusText
        });
        // Fall through to generic error handling below
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('GitHub search API error', {
        status: response.status,
        message: errorData.message || response.statusText
      });
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`);
    }

    const data = await response.json();

    log.info('GitHub issues search completed', {
      totalCount: data.total_count,
      returnedCount: data.items?.length || 0,
      query: searchQuery
    });

    // Return simplified issue data
    return {
      total_count: data.total_count,
      items: data.items.map(issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        labels: issue.labels.map(l => l.name),
        body: issue.body ? issue.body.substring(0, 500) : '' // Truncate body for context
      }))
    };
  } catch (error) {
    log.error('Failed to search GitHub issues', {
      error: error.message,
      query: searchQuery
    });
    throw error;
  }
}

/**
 * Get file contents from GitHub repository
 * @param {object} params - Request parameters
 * @param {string} params.path - File path in repository
 * @param {string} [params.ref] - Git ref (branch, tag, or commit SHA)
 * @param {object} log - Logger instance
 * @returns {Promise<object>} File content and metadata
 */
async function getCodebaseFile(params, log) {
  const { path, ref = 'main' } = params;
  const config = getRepoConfig();
  
  validateToken(config.token, log);
  
  // Validate and sanitize path
  const validatedPath = validatePath(path, log);

  log.info('Fetching file from GitHub', {
    owner: config.owner,
    repo: config.repo,
    path: validatedPath,
    ref
  });

  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${validatedPath}?ref=${ref}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'BMSview-AI-Feedback',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      if (rateLimitRemaining === '0') {
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');
        const resetDate = new Date(parseInt(rateLimitReset) * 1000);
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleString()}`);
      }
    }

    if (response.status === 404) {
      log.warn('File not found in repository', { path: validatedPath, ref });
      throw new Error(`File not found: ${validatedPath}`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('GitHub contents API error', {
        status: response.status,
        message: errorData.message || response.statusText
      });
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`);
    }

    const data = await response.json();

    // GitHub API returns base64-encoded content for files
    if (data.type !== 'file') {
      throw new Error(`Path '${validatedPath}' is not a file (type: ${data.type})`);
    }

    // Check file size before decoding
    if (data.size > MAX_FILE_SIZE) {
      log.warn('File exceeds size limit', {
        path: validatedPath,
        size: data.size,
        maxSize: MAX_FILE_SIZE
      });
      
      // Return truncated content with warning
      const decodedContent = Buffer.from(data.content, 'base64').toString('utf-8');
      const truncatedContent = decodedContent.substring(0, MAX_FILE_SIZE);
      
      return {
        path: validatedPath,
        name: data.name,
        size: data.size,
        truncated: true,
        truncatedAt: MAX_FILE_SIZE,
        content: truncatedContent,
        sha: data.sha,
        url: data.html_url,
        message: `File size (${data.size} bytes) exceeds limit (${MAX_FILE_SIZE} bytes). Content has been truncated.`
      };
    }

    // Decode content
    const decodedContent = Buffer.from(data.content, 'base64').toString('utf-8');

    log.info('File fetched successfully', {
      path: validatedPath,
      size: data.size,
      ref
    });

    return {
      path: validatedPath,
      name: data.name,
      size: data.size,
      truncated: false,
      content: decodedContent,
      sha: data.sha,
      url: data.html_url
    };
  } catch (error) {
    log.error('Failed to fetch file from GitHub', {
      error: error.message,
      path: validatedPath,
      ref
    });
    throw error;
  }
}

/**
 * List directory contents from GitHub repository
 * @param {object} params - Request parameters
 * @param {string} params.path - Directory path in repository
 * @param {string} [params.ref] - Git ref (branch, tag, or commit SHA)
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Directory listing
 */
async function listDirectory(params, log) {
  const { path, ref = 'main' } = params;
  const config = getRepoConfig();
  
  validateToken(config.token, log);
  
  // Validate and sanitize path
  const validatedPath = validatePath(path, log);

  log.info('Listing directory from GitHub', {
    owner: config.owner,
    repo: config.repo,
    path: validatedPath,
    ref
  });

  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${validatedPath}?ref=${ref}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'BMSview-AI-Feedback',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    // Handle rate limiting
    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      if (rateLimitRemaining === '0') {
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');
        const resetDate = new Date(parseInt(rateLimitReset) * 1000);
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleString()}`);
      }
    }

    if (response.status === 404) {
      log.warn('Directory not found in repository', { path: validatedPath, ref });
      throw new Error(`Directory not found: ${validatedPath}`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log.error('GitHub contents API error', {
        status: response.status,
        message: errorData.message || response.statusText
      });
      throw new Error(`GitHub API error: ${response.status} - ${errorData.message || response.statusText}`);
    }

    const data = await response.json();

    // Ensure we got a directory listing
    if (!Array.isArray(data)) {
      throw new Error(`Path '${validatedPath}' is not a directory`);
    }

    log.info('Directory listed successfully', {
      path: validatedPath,
      itemCount: data.length,
      ref
    });

    // Return simplified directory listing
    return {
      path: validatedPath,
      items: data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        url: item.html_url
      }))
    };
  } catch (error) {
    log.error('Failed to list directory from GitHub', {
      error: error.message,
      path: validatedPath,
      ref
    });
    throw error;
  }
}

module.exports = {
  searchGitHubIssues,
  getCodebaseFile,
  listDirectory,
  validatePath, // Export for testing
  ALLOWED_PATHS,
  BLOCKED_PATHS,
  MAX_FILE_SIZE
};
