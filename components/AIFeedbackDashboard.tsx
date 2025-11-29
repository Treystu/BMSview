import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

interface NotificationPreferences {
  enableNotifications: boolean;
  priorities: string[];
  categories: string[];
  types: string[];
}

interface FeedbackFilters {
  searchQuery: string;
  categories: string[];
  priorities: string[];
  types: string[];
  dateFrom: string;
  dateTo: string;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  enableNotifications: true,
  priorities: ['critical', 'high'],
  categories: [],
  types: [],
};

const DEFAULT_FILTERS: FeedbackFilters = {
  searchQuery: '',
  categories: [],
  priorities: [],
  types: [],
  dateFrom: '',
  dateTo: '',
};

const CATEGORIES = ['weather_api', 'data_structure', 'ui_ux', 'performance', 'integration', 'analytics'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const TYPES = ['feature_request', 'api_suggestion', 'data_format', 'bug_report', 'optimization'];

// Helper function for type labels
const getTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    feature_request: 'Feature Request',
    api_suggestion: 'API Suggestion',
    data_format: 'Data Format',
    bug_report: 'Bug Report',
    optimization: 'Optimization'
  };
  return labels[type] || type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

// Helper function to format elapsed time
const formatElapsedTime = (startTime: number | null): string => {
  if (!startTime) return '';
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s`;
};

// Helper function to capitalize strings
const capitalize = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

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
  
  // New state for UX enhancements
  const [searchFilters, setSearchFilters] = useState<FeedbackFilters>(DEFAULT_FILTERS);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [showNotificationPrefs, setShowNotificationPrefs] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState<{
    isRunning: boolean;
    message: string;
    progress: number;
    startTime: number | null;
  }>({ isRunning: false, message: '', progress: 0, startTime: null });
  const [elapsedTime, setElapsedTime] = useState('');

  // Update elapsed time while running
  useEffect(() => {
    if (!analysisProgress.isRunning || !analysisProgress.startTime) {
      setElapsedTime('');
      return;
    }
    
    const interval = setInterval(() => {
      setElapsedTime(formatElapsedTime(analysisProgress.startTime));
    }, 1000);
    
    return () => clearInterval(interval);
  }, [analysisProgress.isRunning, analysisProgress.startTime]);

  // Load notification preferences from localStorage on mount
  useEffect(() => {
    const savedPrefs = localStorage.getItem('aiFeedbackNotificationPrefs');
    if (savedPrefs) {
      try {
        setNotificationPrefs(JSON.parse(savedPrefs));
      } catch (e) {
        console.warn('Failed to parse notification preferences:', e);
      }
    }
  }, []);

  // Save notification preferences to localStorage
  const saveNotificationPrefs = useCallback((prefs: NotificationPreferences) => {
    setNotificationPrefs(prefs);
    localStorage.setItem('aiFeedbackNotificationPrefs', JSON.stringify(prefs));
  }, []);

  // Filter feedbacks based on search and advanced filters
  const filteredFeedbacks = useMemo(() => {
    return feedbacks.filter(feedback => {
      // Search query filter
      if (searchFilters.searchQuery) {
        const query = searchFilters.searchQuery.toLowerCase();
        const matchesSearch = 
          feedback.suggestion.title.toLowerCase().includes(query) ||
          feedback.suggestion.description.toLowerCase().includes(query) ||
          feedback.category.toLowerCase().includes(query) ||
          feedback.feedbackType.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Category filter
      if (searchFilters.categories.length > 0) {
        if (!searchFilters.categories.includes(feedback.category)) return false;
      }

      // Priority filter
      if (searchFilters.priorities.length > 0) {
        if (!searchFilters.priorities.includes(feedback.priority)) return false;
      }

      // Type filter
      if (searchFilters.types.length > 0) {
        if (!searchFilters.types.includes(feedback.feedbackType)) return false;
      }

      // Date range filter
      if (searchFilters.dateFrom) {
        const feedbackDate = new Date(feedback.timestamp);
        const fromDate = new Date(searchFilters.dateFrom);
        if (feedbackDate < fromDate) return false;
      }

      if (searchFilters.dateTo) {
        const feedbackDate = new Date(feedback.timestamp);
        const toDate = new Date(searchFilters.dateTo);
        toDate.setHours(23, 59, 59, 999); // Include entire end day
        if (feedbackDate > toDate) return false;
      }

      return true;
    });
  }, [feedbacks, searchFilters]);

  // Toggle feedback selection for bulk actions
  const toggleFeedbackSelection = useCallback((id: string) => {
    setSelectedFeedbackIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Select all visible feedbacks
  const selectAllFeedbacks = useCallback(() => {
    setSelectedFeedbackIds(new Set(filteredFeedbacks.map(f => f.id)));
  }, [filteredFeedbacks]);

  // Deselect all feedbacks
  const deselectAllFeedbacks = useCallback(() => {
    setSelectedFeedbackIds(new Set());
  }, []);

  // Handle bulk status update
  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedFeedbackIds.size === 0) return;
    
    setBulkActionLoading(true);
    setBulkStatusValue('');
    setAnalysisProgress({
      isRunning: true,
      message: `Updating ${selectedFeedbackIds.size} items to ${newStatus}...`,
      progress: 0,
      startTime: Date.now()
    });

    try {
      const ids = Array.from(selectedFeedbackIds);
      let completed = 0;

      // Run all status updates concurrently, updating progress as each completes
      await Promise.all(
        ids.map(feedbackId =>
          handleStatusUpdate(feedbackId, newStatus).then(() => {
            completed++;
            setAnalysisProgress(prev => ({
              ...prev,
              progress: Math.round((completed / ids.length) * 100),
              message: `Updated ${completed}/${ids.length} items...`
            }));
          })
        )
      );

      setSelectedFeedbackIds(new Set());
      setAnalysisProgress({
        isRunning: false,
        message: `Successfully updated ${ids.length} items`,
        progress: 100,
        startTime: null
      });

      // Clear success message after 3 seconds
      setTimeout(() => {
        setAnalysisProgress({ isRunning: false, message: '', progress: 0, startTime: null });
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
      setAnalysisProgress({ isRunning: false, message: '', progress: 0, startTime: null });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Handle bulk reject (marks items as rejected)
  const handleBulkReject = async () => {
    if (selectedFeedbackIds.size === 0) return;
    
    const confirmed = window.confirm(
      `Are you sure you want to reject ${selectedFeedbackIds.size} feedback items? They will be marked as rejected and hidden from the default view.`
    );
    if (!confirmed) return;

    setBulkActionLoading(true);
    setAnalysisProgress({
      isRunning: true,
      message: `Rejecting ${selectedFeedbackIds.size} items...`,
      progress: 0,
      startTime: Date.now()
    });

    try {
      const ids = Array.from(selectedFeedbackIds);
      let completed = 0;

      // Run all status updates concurrently, updating progress as each completes
      await Promise.all(
        ids.map(feedbackId =>
          handleStatusUpdate(feedbackId, 'rejected').then(() => {
            completed++;
            setAnalysisProgress(prev => ({
              ...prev,
              progress: Math.round((completed / ids.length) * 100),
              message: `Rejecting ${completed}/${ids.length} items...`
            }));
          })
        )
      );

      setSelectedFeedbackIds(new Set());
      setAnalysisProgress({
        isRunning: false,
        message: `Successfully rejected ${ids.length} items`,
        progress: 100,
        startTime: null
      });

      // Clear success message after 3 seconds
      setTimeout(() => {
        setAnalysisProgress({ isRunning: false, message: '', progress: 0, startTime: null });
      }, 3000);

      await fetchAIFeedback();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk reject failed');
      setAnalysisProgress({ isRunning: false, message: '', progress: 0, startTime: null });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchFilters(DEFAULT_FILTERS);
  }, []);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchFilters.searchQuery !== '' ||
      searchFilters.categories.length > 0 ||
      searchFilters.priorities.length > 0 ||
      searchFilters.types.length > 0 ||
      searchFilters.dateFrom !== '' ||
      searchFilters.dateTo !== ''
    );
  }, [searchFilters]);

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
            <div 
              className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" 
              aria-hidden="true" 
              onClick={(e) => {
                // Only close if clicking directly on backdrop, not bubbled from child
                if (e.target === e.currentTarget) {
                  setImplementModal({ show: false, feedbackId: null, feedbackTitle: '' });
                }
              }}
            ></div>
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
                          <label htmlFor="actualEffortHours" className="block text-sm font-medium text-gray-700">
                            Actual Effort (hours)
                          </label>
                          <input
                            id="actualEffortHours"
                            type="number"
                            min="0"
                            step="0.5"
                            aria-describedby="actualEffortHours-help"
                            value={implementMetrics.actualEffortHours || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              actualEffortHours: e.target.value ? parseFloat(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 4"
                          />
                          <p id="actualEffortHours-help" className="text-xs text-gray-500 mt-1">
                            Total hours spent implementing
                          </p>
                        </div>
                        
                        <div>
                          <label htmlFor="actualBenefitScore" className="block text-sm font-medium text-gray-700">
                            Benefit Score (0-100)
                          </label>
                          <input
                            id="actualBenefitScore"
                            type="number"
                            min="0"
                            max="100"
                            aria-describedby="actualBenefitScore-help"
                            value={implementMetrics.actualBenefitScore || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              actualBenefitScore: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 75"
                          />
                          <p id="actualBenefitScore-help" className="text-xs text-gray-500 mt-1">
                            Overall benefit rating
                          </p>
                        </div>
                        
                        <div>
                          <label htmlFor="performanceChange" className="block text-sm font-medium text-gray-700">
                            Performance Change (%)
                          </label>
                          <input
                            id="performanceChange"
                            type="number"
                            step="1"
                            aria-describedby="performanceChange-help"
                            value={implementMetrics.performanceImprovementPercent || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              performanceImprovementPercent: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 15"
                          />
                          <p id="performanceChange-help" className="text-xs text-gray-500 mt-1">
                            Positive = improvement
                          </p>
                        </div>
                        
                        <div>
                          <label htmlFor="stabilityScore" className="block text-sm font-medium text-gray-700">
                            Stability Score (0-100)
                          </label>
                          <input
                            id="stabilityScore"
                            type="number"
                            min="0"
                            max="100"
                            aria-describedby="stabilityScore-help"
                            value={implementMetrics.stabilityScore || ''}
                            onChange={(e) => setImplementMetrics({
                              ...implementMetrics,
                              stabilityScore: e.target.value ? parseInt(e.target.value) : undefined
                            })}
                            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                            placeholder="e.g., 90"
                          />
                          <p id="stabilityScore-help" className="text-xs text-gray-500 mt-1">
                            Post-implementation stability
                          </p>
                        </div>
                      </div>
                      
                      <div>
                        <label htmlFor="userSatisfactionChange" className="block text-sm font-medium text-gray-700">
                          User Satisfaction Change (-100 to +100)
                        </label>
                        <input
                          id="userSatisfactionChange"
                          type="number"
                          min="-100"
                          max="100"
                          aria-describedby="userSatisfactionChange-help"
                          value={implementMetrics.userSatisfactionChange || ''}
                          onChange={(e) => setImplementMetrics({
                            ...implementMetrics,
                            userSatisfactionChange: e.target.value ? parseInt(e.target.value) : undefined
                          })}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                          placeholder="e.g., 20"
                        />
                        <p id="userSatisfactionChange-help" className="text-xs text-gray-500 mt-1">
                          Positive = improvement, negative = decline
                        </p>
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
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 md:p-6">
        <h3 className="text-lg md:text-xl font-semibold text-gray-900 mb-4">📊 Feedback Analytics</h3>
        <FeedbackAnalytics />
      </div>

      {/* Progress Indicator for Long-Running Operations */}
      {analysisProgress.isRunning && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4" role="status" aria-live="polite">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-blue-900">{analysisProgress.message}</p>
                {elapsedTime && (
                  <span className="text-xs text-blue-600">Running for {elapsedTime}</span>
                )}
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${analysisProgress.progress}%` }}
                ></div>
              </div>
            </div>
            <span className="text-sm font-medium text-blue-600">{analysisProgress.progress}%</span>
          </div>
        </div>
      )}

      {/* Success Message */}
      {!analysisProgress.isRunning && analysisProgress.message && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4" role="status">
          <div className="flex items-center">
            <svg className="h-5 w-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <p className="text-sm font-medium text-green-800">{analysisProgress.message}</p>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
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
          {/* Notification Preferences Toggle */}
          <button
            onClick={() => setShowNotificationPrefs(!showNotificationPrefs)}
            className="flex items-center px-3 py-2 text-sm bg-white border border-blue-300 rounded-md hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            aria-expanded={showNotificationPrefs}
            aria-controls="notification-prefs-panel"
          >
            <svg className="h-4 w-4 mr-2 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span className="hidden sm:inline">Notifications</span>
          </button>
        </div>
      </div>

      {/* Notification Preferences Panel */}
      {showNotificationPrefs && (
        <div id="notification-prefs-panel" className="bg-gray-50 border border-gray-200 rounded-lg p-4 md:p-6">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">🔔 Notification Preferences</h4>
          <div className="space-y-4">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <label htmlFor="enable-notifications" className="text-sm font-medium text-gray-700">
                Enable AI Feedback Notifications
              </label>
              <button
                id="enable-notifications"
                role="switch"
                aria-checked={notificationPrefs.enableNotifications}
                onClick={() => saveNotificationPrefs({ ...notificationPrefs, enableNotifications: !notificationPrefs.enableNotifications })}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  notificationPrefs.enableNotifications ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    notificationPrefs.enableNotifications ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {notificationPrefs.enableNotifications && (
              <>
                {/* Priority Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notify for Priorities
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRIORITIES.map(priority => (
                      <label key={priority} className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={notificationPrefs.priorities.includes(priority)}
                          onChange={(e) => {
                            const newPriorities = e.target.checked
                              ? [...notificationPrefs.priorities, priority]
                              : notificationPrefs.priorities.filter(p => p !== priority);
                            saveNotificationPrefs({ ...notificationPrefs, priorities: newPriorities });
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-600 capitalize">{priority}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Category Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notify for Categories
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(category => (
                      <label key={category} className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={notificationPrefs.categories.includes(category)}
                          onChange={(e) => {
                            const newCategories = e.target.checked
                              ? [...notificationPrefs.categories, category]
                              : notificationPrefs.categories.filter(c => c !== category);
                            saveNotificationPrefs({ ...notificationPrefs, categories: newCategories });
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-600">{getCategoryLabel(category)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Type Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Notify for Types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TYPES.map(type => (
                      <label key={type} className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={notificationPrefs.types.includes(type)}
                          onChange={(e) => {
                            const newTypes = e.target.checked
                              ? [...notificationPrefs.types, type]
                              : notificationPrefs.types.filter(t => t !== type);
                            saveNotificationPrefs({ ...notificationPrefs, types: newTypes });
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="ml-2 text-sm text-gray-600">{getTypeLabel(type)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Search and Advanced Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search Input */}
          <div className="flex-1">
            <label htmlFor="feedback-search" className="sr-only">Search feedback</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                id="feedback-search"
                type="text"
                placeholder="Search by title, description, category..."
                value={searchFilters.searchQuery}
                onChange={(e) => setSearchFilters({ ...searchFilters, searchQuery: e.target.value })}
                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`inline-flex items-center px-4 py-2 border rounded-md text-sm font-medium transition-colors ${
              hasActiveFilters
                ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
            aria-expanded={showAdvancedFilters}
          >
            <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {hasActiveFilters && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                Active
              </span>
            )}
          </button>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* Advanced Filters Panel */}
        {showAdvancedFilters && (
          <div className="pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Category Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                multiple
                value={searchFilters.categories}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  setSearchFilters({ ...searchFilters, categories: selected });
                }}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm h-24"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{getCategoryLabel(cat)}</option>
                ))}
              </select>
            </div>

            {/* Priority Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                multiple
                value={searchFilters.priorities}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  setSearchFilters({ ...searchFilters, priorities: selected });
                }}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm h-24"
              >
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{capitalize(p)}</option>
                ))}
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                multiple
                value={searchFilters.types}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  setSearchFilters({ ...searchFilters, types: selected });
                }}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm h-24"
              >
                {TYPES.map(t => (
                  <option key={t} value={t}>{getTypeLabel(t)}</option>
                ))}
              </select>
            </div>

            {/* Date Range Filter */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Date Range</label>
              <input
                type="date"
                value={searchFilters.dateFrom}
                onChange={(e) => setSearchFilters({ ...searchFilters, dateFrom: e.target.value })}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                aria-label="From date"
              />
              <input
                type="date"
                value={searchFilters.dateTo}
                onChange={(e) => setSearchFilters({ ...searchFilters, dateTo: e.target.value })}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                aria-label="To date"
              />
            </div>
          </div>
        )}

        {/* Filter Results Summary */}
        {hasActiveFilters && (
          <div className="text-sm text-gray-600">
            Showing {filteredFeedbacks.length} of {feedbacks.length} items
          </div>
        )}
      </div>

      {/* Filter Tabs - Mobile Responsive */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="-mb-px flex space-x-4 md:space-x-8 min-w-max px-1" role="tablist">
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
                role="tab"
                aria-selected={isActive}
                onClick={() => setFilter(tab.key)}
                className={`
                  whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs md:text-sm transition-colors
                  ${isActive
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }
                `}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(' ')[0] || tab.label}</span>
                <span className="ml-1">({count})</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bulk Actions Bar */}
      {selectedFeedbackIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={selectedFeedbackIds.size === filteredFeedbacks.length}
              onChange={(e) => e.target.checked ? selectAllFeedbacks() : deselectAllFeedbacks()}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded mr-3"
              aria-label="Select all feedback items"
            />
            <span className="text-sm font-medium text-blue-900">
              {selectedFeedbackIds.size} item{selectedFeedbackIds.size !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              value={bulkStatusValue}
              onChange={(e) => {
                const newValue = e.target.value;
                if (newValue) {
                  handleBulkStatusUpdate(newValue);
                }
              }}
              disabled={bulkActionLoading}
              className="px-3 py-2 text-sm border border-blue-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1 sm:flex-none"
              aria-label="Bulk update status"
            >
              <option value="">Update Status...</option>
              <option value="pending">Set to Pending</option>
              <option value="reviewed">Set to Reviewed</option>
              <option value="accepted">Set to Accepted</option>
              <option value="implemented">Set to Implemented</option>
              <option value="rejected">Set to Rejected</option>
            </select>
            <button
              onClick={handleBulkReject}
              disabled={bulkActionLoading}
              className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
            >
              Reject Selected
            </button>
            <button
              onClick={deselectAllFeedbacks}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Select All / Deselect All Controls */}
      {filteredFeedbacks.length > 0 && selectedFeedbackIds.size === 0 && (
        <div className="flex items-center gap-4 text-sm">
          <button
            onClick={selectAllFeedbacks}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Select All ({filteredFeedbacks.length})
          </button>
        </div>
      )}

      {/* Feedback List */}
      <div className="space-y-4">
        {filteredFeedbacks.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-2 text-gray-500">
              {hasActiveFilters 
                ? 'No feedback items match your filters.'
                : 'No feedback items found for this status.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-blue-600 hover:text-blue-800 font-medium text-sm"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          filteredFeedbacks.map(feedback => (
            <div
              key={feedback.id}
              className={`border-2 rounded-lg overflow-hidden transition-shadow hover:shadow-md ${
                selectedFeedbackIds.has(feedback.id) ? 'ring-2 ring-blue-500 ' : ''
              }${getPriorityColor(feedback.priority)}`}
            >
              {/* Header */}
              <div className="bg-white px-4 md:px-6 py-3 md:py-4 border-b">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  {/* Selection Checkbox */}
                  <div className="flex items-center sm:pt-1">
                    <input
                      type="checkbox"
                      checked={selectedFeedbackIds.has(feedback.id)}
                      onChange={() => toggleFeedbackSelection(feedback.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      aria-label={`Select ${feedback.suggestion.title}`}
                    />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base md:text-lg font-semibold text-gray-900 break-words">
                      {feedback.suggestion.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs md:text-sm">
                      <span className={`px-2 py-1 rounded-full font-medium ${getPriorityBadgeColor(feedback.priority)}`}>
                        {feedback.priority.toUpperCase()}
                      </span>
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                        {getCategoryLabel(feedback.category)}
                      </span>
                      <span className="text-gray-500 hidden sm:inline">
                        {getTypeLabel(feedback.feedbackType)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto sm:ml-4">
                    <select
                      value={feedback.status}
                      onChange={(e) => handleStatusChange(feedback.id, e.target.value, feedback.suggestion.title)}
                      aria-label={`Update status for ${feedback.suggestion.title}`}
                      className="flex-1 sm:flex-none block pl-3 pr-8 py-2 text-sm border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 rounded-md"
                    >
                      <option value="pending">Pending</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="accepted">Accepted</option>
                      <option value="implemented">Implemented</option>
                      <option value="rejected">Rejected</option>
                    </select>
                    {feedback.effectivenessScore !== undefined && (
                      <div className="text-xs text-center px-2 py-1 bg-gray-50 rounded">
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
              <div className="bg-white px-4 md:px-6 py-3 md:py-4 space-y-3 md:space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1 text-sm md:text-base">Description</h4>
                  <p className="text-gray-700 text-sm md:text-base">{feedback.suggestion.description}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1 text-sm md:text-base">Rationale</h4>
                  <p className="text-gray-700 text-sm md:text-base">{feedback.suggestion.rationale}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1 text-sm md:text-base">Expected Benefit</h4>
                  <p className="text-gray-700 text-sm md:text-base">{feedback.suggestion.expectedBenefit}</p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 mb-1 text-sm md:text-base">Implementation Details</h4>
                  <p className="text-gray-700 text-sm md:text-base">{feedback.suggestion.implementation}</p>
                  <p className="text-xs md:text-sm text-gray-500 mt-1">
                    Estimated Effort: <span className="font-medium">{feedback.suggestion.estimatedEffort}</span>
                  </p>
                </div>

                {feedback.suggestion.codeSnippets && feedback.suggestion.codeSnippets.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 text-sm md:text-base">Code Suggestions</h4>
                    <div className="bg-gray-50 rounded-md p-2 md:p-3 overflow-x-auto">
                      <pre className="text-xs md:text-sm text-gray-800 font-mono whitespace-pre-wrap break-words">
                        {feedback.suggestion.codeSnippets.join('\n\n')}
                      </pre>
                    </div>
                  </div>
                )}

                {feedback.suggestion.affectedComponents && feedback.suggestion.affectedComponents.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-2 text-sm md:text-base">Affected Components</h4>
                    <div className="flex flex-wrap gap-2">
                      {feedback.suggestion.affectedComponents.map((comp, idx) => (
                        <span key={idx} className="inline-flex items-center px-2 py-1 rounded-md text-xs md:text-sm bg-gray-100 text-gray-700">{comp}</span>
                      ))}
                    </div>
                  </div>
                )}

                {feedback.adminNotes && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-2 md:p-3">
                    <h4 className="font-semibold text-yellow-900 mb-1 text-sm md:text-base">Admin Notes</h4>
                    <p className="text-yellow-800 text-xs md:text-sm">{feedback.adminNotes}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-gray-50 px-4 md:px-6 py-2 md:py-3 border-t text-xs text-gray-500">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    <span>Generated: {new Date(feedback.timestamp).toLocaleDateString()}</span>
                    <span className="hidden sm:inline">| Model: {feedback.geminiModel}</span>
                  </div>
                  {feedback.githubIssue && (
                    <a
                      href={feedback.githubIssue.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-medium inline-flex items-center"
                    >
                      View Issue #{feedback.githubIssue.number}
                      <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
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
