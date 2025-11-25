import React, { useEffect, useState, useCallback } from 'react';
import type { AnalysisStory, AnalysisRecord } from '../../types';
import StoryViewer from '../StoryViewer';

interface StoryEvent {
  analysisId: string;
  timestamp: string;
  annotation: string;
  contextNotes: {
    priorEvents: string;
    environmentalFactors: string;
    maintenanceActions: string;
  };
  addedAt?: string;
}

interface AdminStory {
  id: string;
  adminId?: string;
  title: string;
  description: string;
  systemIdentifier?: string;
  events: StoryEvent[];
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    totalEvents: number;
    dateRange: {
      start: string | null;
      end: string | null;
    };
  };
}

interface AdminStoriesResponse {
  items: AdminStory[];
  totalItems: number;
  page: number;
  limit: number;
  totalPages: number;
}

const AdminStoryManager: React.FC = () => {
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSystemIdentifier, setNewSystemIdentifier] = useState('');
  const [newTags, setNewTags] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/.netlify/functions/admin-stories?page=${page}&limit=10`);
      if (!response.ok) {
        throw new Error('Failed to fetch stories');
      }
      const data: AdminStoriesResponse = await response.json();
      setStories(data.items);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stories');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const handleCreateStory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setError('Title is required');
      return;
    }

    setCreating(true);
    setError(null);
    
    try {
      const response = await fetch('/.netlify/functions/admin-stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim(),
          systemIdentifier: newSystemIdentifier.trim() || undefined,
          tags: newTags.split(',').map(t => t.trim()).filter(Boolean),
          isActive: true,
          events: []
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to create story');
      }

      // Reset form and refresh
      setNewTitle('');
      setNewDescription('');
      setNewSystemIdentifier('');
      setNewTags('');
      setShowCreateForm(false);
      fetchStories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create story');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (story: AdminStory) => {
    try {
      const response = await fetch(`/.netlify/functions/admin-stories?id=${story.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !story.isActive })
      });

      if (!response.ok) {
        throw new Error('Failed to update story');
      }

      fetchStories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update story');
    }
  };

  const handleDeleteStory = async (storyId: string) => {
    if (!confirm('Are you sure you want to delete this story?')) {
      return;
    }

    try {
      const response = await fetch(`/.netlify/functions/admin-stories?id=${storyId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete story');
      }

      fetchStories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete story');
    }
  };

  // If a story is selected, show the StoryViewer
  if (selectedStoryId) {
    return (
      <StoryViewer 
        selectedStoryId={selectedStoryId} 
        onBack={() => setSelectedStoryId(null)} 
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-semibold text-white">Stories Management</h3>
          <p className="text-sm text-gray-400 mt-1">
            Group related analyses with context for enhanced AI insights
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-secondary hover:bg-primary text-white rounded-lg transition-colors"
        >
          {showCreateForm ? 'Cancel' : '+ Create New Story'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-600 rounded-lg p-4 text-red-400">
          <p>{error}</p>
          <button 
            onClick={() => setError(null)}
            className="text-sm text-secondary hover:underline mt-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create Story Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateStory} className="bg-gray-800 rounded-lg p-6 space-y-4 border border-secondary/30">
          <h4 className="text-lg font-medium text-white">Create New Story</h4>
          
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Cloudy Week Battery Performance"
              className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:border-secondary focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Describe the context, event, or pattern this story captures..."
              rows={3}
              className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:border-secondary focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                System Identifier
              </label>
              <input
                type="text"
                value={newSystemIdentifier}
                onChange={(e) => setNewSystemIdentifier(e.target.value)}
                placeholder="Optional: Link to specific system"
                className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:border-secondary focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Tags (comma-separated)
              </label>
              <input
                type="text"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="e.g., solar, weather, maintenance"
                className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:border-secondary focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !newTitle.trim()}
              className="px-4 py-2 bg-secondary hover:bg-primary text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating...' : 'Create Story'}
            </button>
          </div>
        </form>
      )}

      {/* Stories List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary"></div>
          <span className="ml-3 text-gray-400">Loading stories...</span>
        </div>
      ) : stories.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <p className="text-gray-400 text-lg">No stories yet</p>
          <p className="text-sm text-gray-500 mt-2">
            Create a story to group analyses with contextual information
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 px-4 py-2 bg-secondary hover:bg-primary text-white rounded-lg transition-colors"
          >
            Create Your First Story
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {stories.map((story) => (
            <div
              key={story.id}
              className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 
                      className="text-lg font-medium text-white cursor-pointer hover:text-secondary"
                      onClick={() => setSelectedStoryId(story.id)}
                    >
                      {story.title}
                    </h4>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      story.isActive 
                        ? 'bg-green-900/50 text-green-400 border border-green-600/30' 
                        : 'bg-gray-700 text-gray-400 border border-gray-600'
                    }`}>
                      {story.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {story.description && (
                    <p className="text-gray-400 text-sm mt-1 line-clamp-2">{story.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                    <span>📅 Created: {new Date(story.createdAt).toLocaleDateString()}</span>
                    <span>📊 Events: {story.events?.length || 0}</span>
                    {story.systemIdentifier && (
                      <span>🔗 System: {story.systemIdentifier}</span>
                    )}
                    {story.tags && story.tags.length > 0 && (
                      <span>🏷️ {story.tags.join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => setSelectedStoryId(story.id)}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                    title="View Story"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleToggleActive(story)}
                    className={`p-2 transition-colors ${
                      story.isActive 
                        ? 'text-green-400 hover:text-green-300' 
                        : 'text-gray-400 hover:text-green-400'
                    }`}
                    title={story.isActive ? 'Deactivate' : 'Activate'}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDeleteStory(story.id)}
                    className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete Story"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-gray-400">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminStoryManager;
