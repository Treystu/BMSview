import React, { useState, useEffect } from 'react';
import { FeedbackAnalytics } from './FeedbackAnalytics';

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
  effectivenessScore?: number;
  actualBenefitScore?: number;
  actualEffortHours?: number;
  metrics?: {
    viewCount: number;
    lastViewed: Date | null;
  };
}

interface ImplementationMetrics {
  actualEffortHours?: number;
  actualBenefitScore?: number;
  performanceImprovementPercent?: number;
  userSatisfactionChange?: number;
  stabilityScore?: number;
  implementationNotes?: string;
}

export const AIFeedbackDashboard: React.FC = () => {
  const [feedbacks, setFeedbacks] = useState<AIFeedback[]>([]);
  const [filter, setFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; feedbackId: string | null }>({
    show: false,
    feedbackId: null
  });
  const [implementModal, setImplementModal] = useState<{ 
    show: boolean; 
    feedbackId: string | null;
    feedbackTitle: string;
  }>({
    show: false,
    feedbackId: null,
    feedbackTitle: ''
  });
  const [implementMetrics, setImplementMetrics] = useState<ImplementationMetrics>({});

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

  const handleStatusUpdate = async (
    feedbackId: string, 
    newStatus: string, 
    adminNotes?: string,
    metrics?: ImplementationMetrics
  ) => {
    try {
      const body: Record<string, unknown> = { feedbackId, status: newStatus };
      if (adminNotes) body.adminNotes = adminNotes;
      
      // Include implementation metrics if provided
      if (metrics) {
        if (metrics.actualEffortHours !== undefined) body.actualEffortHours = metrics.actualEffortHours;
        if (metrics.actualBenefitScore !== undefined) body.actualBenefitScore = metrics.actualBenefitScore;
        if (metrics.performanceImprovementPercent !== undefined) body.performanceImprovementPercent = metrics.performanceImprovementPercent;
        if (metrics.userSatisfactionChange !== undefined) body.userSatisfactionChange = metrics.userSatisfactionChange;
        if (metrics.stabilityScore !== undefined) body.stabilityScore = metrics.stabilityScore;
        if (metrics.implementationNotes) body.implementationNotes = metrics.implementationNotes;
      }

      const response = await fetch('/.netlify/functions/update-feedback-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error('Failed to update feedback status');
      }

      // Refresh the list
      await fetchAIFeedback();
    } catch (err) {
      console.error('Error updating status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const handleStatusChange = (feedbackId: string, newStatus: string, feedbackTitle: string) => {
    if (newStatus === 'implemented') {
      // Open implementation metrics modal
      setImplementMetrics({});
      setImplementModal({ show: true, feedbackId, feedbackTitle });
    } else {
      handleStatusUpdate(feedbackId, newStatus);
    }
  };

  const handleImplementSubmit = async () => {
    if (implementModal.feedbackId) {
      await handleStatusUpdate(implementModal.feedbackId, 'implemented', undefined, implementMetrics);
      setImplementModal({ show: false, feedbackId: null, feedbackTitle: '' });
      setImplementMetrics({});
    }
  };

  const handleCreateGitHubIssue = async (feedbackId: string) => {
    try {
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
      setError(null);
      
      // Refresh the list
      await fetchAIFeedback();
      
      // Show success message (you could use a toast notification here)
      console.log(`GitHub Issue #${data.issueNumber} created successfully!`);
    } catch (err) {
      console.error('Error creating GitHub issue:', err);
      setError(err instanceof Error ? err.message : 'Failed to create GitHub issue');
    } finally {
      setConfirmModal({ show: false, feedbackId: null });
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
      {/* Error Alert (non-blocking) */}
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <svg className="h-5 w-5 text-red-400 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-red-800">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-3 inline-flex text-red-400 hover:text-red-600"
            aria-label="Dismiss error"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.show && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setConfirmModal({ show: false, feedbackId: null })}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-green-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Create GitHub Issue
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        This will create a formatted GitHub issue for this feedback. The issue will include all details, code snippets, and affected components.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => confirmModal.feedbackId && handleCreateGitHubIssue(confirmModal.feedbackId)}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-600 text-base font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Create Issue
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmModal({ show: false, feedbackId: null })}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Implementation Metrics Modal */}
      {implementModal.show && (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="implement-modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setImplementModal({ show: false, feedbackId: null, feedbackTitle: '' })}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left flex-1">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="implement-modal-title">
                      Mark as Implemented
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 truncate" title={implementModal.feedbackTitle}>
                      {implementModal.feedbackTitle}
                    </p>
                    <div className="mt-4 space-y-4">
                      <p className="text-sm text-gray-600">
                        Track implementation metrics to calculate effectiveness and ROI.
                      </p>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Actual Effort (hours)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={implementMetrics.actualEffortHours || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              actualEffortHours: e.target.value ? parseFloat(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 4"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Benefit Score (0-100)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={implementMetrics.actualBenefitScore || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              actualBenefitScore: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 75"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Performance Change (%)
                          </label>
                          <input
                            type="number"
                            step="1"
                            value={implementMetrics.performanceImprovementPercent || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              performanceImprovementPercent: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 15"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Stability Score (0-100)
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={implementMetrics.stabilityScore || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              stabilityScore: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 90"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          User Satisfaction Change (-100 to +100)
                        </label>
                        <input
                          type="number"
                          min="-100"
                          max="100"
                          value={implementMetrics.userSatisfactionChange || ''}
                          onChange={(e) => setImplementMetrics({
                            ...implementMetrics,
                            userSatisfactionChange: e.target.value ? parseInt(e.target.value) : undefined
                          })}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                          placeholder="e.g., 20 (positive = improvement)"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Implementation Notes
                        </label>
                        <textarea
                          rows={2}
                          value={implementMetrics.implementationNotes || ''}
                          onChange={(e) => setImplementMetrics({
                            ...implementMetrics,
                            implementationNotes: e.target.value
                          })}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                          placeholder="Optional notes about the implementation..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleImplementSubmit}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Mark Implemented
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImplementModal({ show: false, feedbackId: null, feedbackTitle: '' });
                    setImplementMetrics({});
                  }}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Section */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-gray-900 mb-4">📊 Feedback Analytics</h3>
        <FeedbackAnalytics />
      </div>

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
                      onChange={(e) => handleStatusChange(feedback.id, e.target.value, feedback.suggestion.title)}
                      aria-label={`Update status for ${feedback.suggestion.title}`}
                      className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    >
                      <option value="pending">Pending</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="accepted">Accepted</option>
                      <option value="implemented">Implemented</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    {feedback.effectivenessScore !== undefined && (
                      <div className="text-xs text-center">
                        <span className="text-gray-500">Effectiveness:</span>{' '}
                        <span className={`font-bold ${
                          feedback.effectivenessScore >= 70 ? 'text-green-600' : 
                          feedback.effectivenessScore >= 50 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {feedback.effectivenessScore}/100
                        </span>
                      </div>
                    )}
                    {!feedback.githubIssue && (
                      <button
                        onClick={() => setConfirmModal({ show: true, feedbackId: feedback.id })}
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
