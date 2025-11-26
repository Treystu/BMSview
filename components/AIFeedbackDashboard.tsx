import React, { useState, useEffect } from 'react';

interface AIFeedback {
  id: string;
  timestamp: Date;
  systemId: string;
  feedbackType: string;
  category: string;
  priority: string;
  status: string;
  geminiModel: string;
  suggestion: {
    title: string;
    description: string;
    rationale: string;
    implementation: string;
    expectedBenefit: string;
    estimatedEffort: string;
    codeSnippets?: string[];
    affectedComponents?: string[];
  };
  githubIssue?: {
    number: number;
    url: string;
  };
  adminNotes?: string;
  metrics?: {
    viewCount: number;
    lastViewed: Date | null;
  };
}

export const AIFeedbackDashboard: React.FC = () => {
  const [feedbacks, setFeedbacks] = useState<AIFeedback[]>([]);
  const [filter, setFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchAIFeedback();
  }, [filter]);

  const fetchAIFeedback = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/.netlify/functions/get-ai-feedback?status=${filter}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch AI feedback');
      }
      
      const data = await response.json();
      setFeedbacks(data.feedbacks);
      setTotalCount(data.totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error fetching AI feedback:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (feedbackId: string, newStatus: string, adminNotes?: string) => {
    try {
      const response = await fetch('/.netlify/functions/update-feedback-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedbackId, status: newStatus, adminNotes })
      });

      if (!response.ok) {
        throw new Error('Failed to update feedback status');
      }

      // Refresh the list
      await fetchAIFeedback();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status');
    }
  };

  const handleCreateGitHubIssue = async (feedbackId: string) => {
    try {
      const confirmed = confirm('Create a GitHub issue for this feedback?');
      if (!confirmed) return;

      const response = await fetch('/.netlify/functions/create-github-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedbackId })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create GitHub issue');
      }

      const data = await response.json();
      alert(`GitHub Issue #${data.issueNumber} created successfully!`);
      
      // Refresh the list
      await fetchAIFeedback();
    } catch (err) {
      console.error('Error creating GitHub issue:', err);
      alert(err instanceof Error ? err.message : 'Failed to create GitHub issue');
    }
  };

  const getPriorityColor = (priority: string): string => {
    const colors: Record<string, string> = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-blue-100 text-blue-800 border-blue-300',
      low: 'bg-gray-100 text-gray-800 border-gray-300'
    };
    return colors[priority] || colors.low;
  };

  const getPriorityBadgeColor = (priority: string): string => {
    const colors: Record<string, string> = {
      critical: 'bg-red-500 text-white',
      high: 'bg-orange-500 text-white',
      medium: 'bg-blue-500 text-white',
      low: 'bg-gray-500 text-white'
    };
    return colors[priority] || colors.low;
  };

  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      weather_api: 'Weather API',
      data_structure: 'Data Structure',
      ui_ux: 'UI/UX',
      performance: 'Performance',
      integration: 'Integration',
      analytics: 'Analytics'
    };
    return labels[category] || category;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading AI feedback...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Error: {error}</p>
        <button
          onClick={fetchAIFeedback}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">🤖 AI Active Feedback</h3>
            <p className="mt-1 text-sm text-blue-700">
              Gemini AI is continuously analyzing system performance and suggesting improvements. 
              Review and act on high-priority items below.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'pending', label: 'Pending' },
            { key: 'reviewed', label: 'Reviewed' },
            { key: 'accepted', label: 'Accepted' },
            { key: 'implemented', label: 'Implemented' },
            { key: 'all', label: 'All Feedback' }
          ].map(tab => {
            const count = tab.key === 'all' ? totalCount : feedbacks.filter(f => f.status === tab.key).length;
            const isActive = filter === tab.key;
            
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`
                  whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </nav>
      </div>

      {/* Feedback List */}
      <div className="space-y-4">
        {feedbacks.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-500">No feedback items found for this filter.</p>
          </div>
        ) : (
          feedbacks.map(feedback => (
            <div
              key={feedback.id}
              className={`border-2 rounded-lg overflow-hidden ${getPriorityColor(feedback.priority)}`}
            >
              {/* Header */}
              <div className="bg-white px-6 py-4 border-b">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {feedback.suggestion.title}
                    </h3>
                    <div className="mt-2 flex items-center space-x-3 text-sm">
                      <span className={`px-2 py-1 rounded-full font-medium ${getPriorityBadgeColor(feedback.priority)}`}>
                        {feedback.priority.toUpperCase()}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                        {getCategoryLabel(feedback.category)}
                      </span>
                      <span className="text-gray-500">
                        {feedback.feedbackType.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4 flex flex-col space-y-2">
                    <select
                      value={feedback.status}
                      onChange={(e) => handleStatusUpdate(feedback.id, e.target.value)}
                      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                      <option value="pending">Pending</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="accepted">Accepted</option>
                      <option value="implemented">Implemented</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    {!feedback.githubIssue && (
                      <button
                        onClick={() => handleCreateGitHubIssue(feedback.id)}
                        className="px-3 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
                      >
                        Create GitHub Issue
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="bg-white px-6 py-4 space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">Description</h4>
                  <p className="text-gray-700">{feedback.suggestion.description}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">Rationale</h4>
                  <p className="text-gray-700">{feedback.suggestion.rationale}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">Expected Benefit</h4>
                  <p className="text-gray-700">{feedback.suggestion.expectedBenefit}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">Implementation Details</h4>
                  <p className="text-gray-700">{feedback.suggestion.implementation}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Estimated Effort: <span className="font-medium">{feedback.suggestion.estimatedEffort}</span>
                  </p>
                </div>

                {feedback.suggestion.codeSnippets && feedback.suggestion.codeSnippets.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Code Suggestions</h4>
                    <div className="bg-gray-50 rounded-md p-3 overflow-x-auto">
                      <pre className="text-sm text-gray-800 font-mono">
                        {feedback.suggestion.codeSnippets.join('\n\n')}
                      </pre>
                    </div>
                  </div>
                )}

                {feedback.suggestion.affectedComponents && feedback.suggestion.affectedComponents.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2">Affected Components</h4>
                    <ul className="list-disc list-inside space-y-1">
                      {feedback.suggestion.affectedComponents.map((comp, idx) => (
                        <li key={idx} className="text-gray-700">{comp}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {feedback.adminNotes && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                    <h4 className="font-semibold text-yellow-900 mb-1">Admin Notes</h4>
                    <p className="text-yellow-800 text-sm">{feedback.adminNotes}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-gray-50 px-6 py-3 border-t text-xs text-gray-500">
                <div className="flex items-center justify-between">
                  <div>
                    Generated: {new Date(feedback.timestamp).toLocaleString()} | 
                    Model: {feedback.geminiModel}
                  </div>
                  {feedback.githubIssue && (
                    <a
                      href={feedback.githubIssue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      View Issue #{feedback.githubIssue.number} →
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
