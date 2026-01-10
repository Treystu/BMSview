import React, { useCallback, useEffect, useState } from 'react';
import { deleteStory, getStories, getStory, type StoriesResponse } from '../services/clientService';
import type { AnalysisData, AnalysisRecord, AnalysisStory } from '../types';

interface StoryViewerProps {
  selectedStoryId?: string | null;
  onBack?: () => void;
}

// Timeline card for individual analysis records
const TimelineCard: React.FC<{ record: AnalysisRecord; index: number }> = ({ record, index }) => {
  const data = record.analysis || {} as Partial<AnalysisData>;

  return (
    <div className="relative pl-8 pb-6 border-l-2 border-secondary last:border-l-0">
      <div className="absolute left-0 top-0 w-4 h-4 bg-secondary rounded-full -translate-x-1/2"></div>
      <div className="bg-gray-700 rounded-lg p-4 ml-4">
        <div className="flex justify-between items-start mb-2">
          <span className="text-sm text-gray-400">Screenshot {index + 1}</span>
          <span className="text-xs text-gray-500">{record.timestamp || record.fileName}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-gray-400">SOC:</span>
            <span className="ml-2 text-white font-medium">{data.stateOfCharge ?? 'N/A'}%</span>
          </div>
          <div>
            <span className="text-gray-400">Voltage:</span>
            <span className="ml-2 text-white font-medium">{data.voltage ?? 'N/A'}V</span>
          </div>
          <div>
            <span className="text-gray-400">Current:</span>
            <span className="ml-2 text-white font-medium">{data.current ?? 'N/A'}A</span>
          </div>
          <div>
            <span className="text-gray-400">Power:</span>
            <span className="ml-2 text-white font-medium">{data.power ?? 'N/A'}W</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// AI Interpretation display
const AiInterpretationPanel: React.FC<{ interpretation: AnalysisStory['aiInterpretation'] }> = ({ interpretation }) => {
  if (!interpretation) {
    return (
      <div className="bg-gray-700 rounded-lg p-4 text-gray-400 italic">
        AI interpretation not available
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-gray-700 to-gray-800 rounded-lg p-6 border border-secondary/30">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <h4 className="text-lg font-semibold text-white">AI Analysis</h4>
        {interpretation.generatedAt && (
          <span className="text-xs text-gray-500 ml-auto">
            Generated: {new Date(interpretation.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {interpretation.summary && (
          <div>
            <h5 className="text-sm font-medium text-secondary mb-1">Summary</h5>
            <p className="text-gray-300 text-sm">{interpretation.summary}</p>
          </div>
        )}

        {interpretation.trendAnalysis && (
          <div>
            <h5 className="text-sm font-medium text-secondary mb-1">Trend Analysis</h5>
            <p className="text-gray-300 text-sm">{interpretation.trendAnalysis}</p>
          </div>
        )}

        {interpretation.events && interpretation.events.length > 0 && (
          <div>
            <h5 className="text-sm font-medium text-secondary mb-1">Notable Events</h5>
            <ul className="list-disc list-inside text-gray-300 text-sm space-y-1">
              {interpretation.events.map((event, i) => (
                <li key={i}>{event}</li>
              ))}
            </ul>
          </div>
        )}

        {interpretation.recommendations && interpretation.recommendations.length > 0 && (
          <div>
            <h5 className="text-sm font-medium text-secondary mb-1">Recommendations</h5>
            <ul className="list-disc list-inside text-gray-300 text-sm space-y-1">
              {interpretation.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

// Story detail view
const StoryDetail: React.FC<{ story: AnalysisStory; onBack: () => void; onDelete: (id: string) => void }> = ({
  story,
  onBack,
  onDelete
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(story.id);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-secondary hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Stories
        </button>
        <button
          onClick={handleDelete}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${confirmDelete
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-700 hover:bg-red-600/20 text-red-400 hover:text-red-300'
            }`}
        >
          {confirmDelete ? 'Click again to confirm' : 'Delete Story'}
        </button>
      </div>

      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white mb-2">{story.title}</h2>
        <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4">
          <span>Created: {story.createdAt ? new Date(story.createdAt).toLocaleString() : 'Unknown'}</span>
          <span>•</span>
          <span>{story.timeline?.length || 0} screenshots</span>
          {story.photos?.length > 0 && (
            <>
              <span>•</span>
              <span>{story.photos.length} photos</span>
            </>
          )}
        </div>

        {story.summary && (
          <div className="mb-4">
            <h4 className="text-sm font-medium text-secondary mb-1">Summary</h4>
            <p className="text-gray-300">{story.summary}</p>
          </div>
        )}

        {story.userContext && (
          <div className="bg-gray-700/50 rounded-lg p-4 border-l-4 border-secondary">
            <h4 className="text-sm font-medium text-secondary mb-1">User Context</h4>
            <p className="text-gray-300 italic">{story.userContext}</p>
          </div>
        )}
      </div>

      {/* AI Interpretation */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">AI Interpretation</h3>
        <AiInterpretationPanel interpretation={story.aiInterpretation} />
      </div>

      {/* Timeline */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Timeline</h3>
        <div className="bg-gray-800 rounded-lg p-6">
          {story.timeline && story.timeline.length > 0 ? (
            <div className="space-y-2">
              {story.timeline.map((record, index) => (
                <TimelineCard key={record.id || index} record={record} index={index} />
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">No timeline data available</p>
          )}
        </div>
      </div>

      {/* Photos */}
      {story.photos && story.photos.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Photos</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {story.photos.map((photo, index) => (
              <div key={index} className="bg-gray-800 rounded-lg overflow-hidden">
                <img src={photo.url} alt={photo.caption || `Photo ${index + 1}`} className="w-full h-32 object-cover" />
                {photo.caption && (
                  <p className="p-2 text-sm text-gray-400">{photo.caption}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Story list item
const StoryListItem: React.FC<{ story: AnalysisStory; onSelect: (id: string) => void }> = ({ story, onSelect }) => {
  return (
    <div
      onClick={() => onSelect(story.id)}
      className="bg-gray-800 rounded-lg p-4 hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-secondary/30"
    >
      <div className="flex justify-between items-start">
        <h3 className="text-lg font-semibold text-white">{story.title}</h3>
        <span className="text-xs text-gray-500">
          {story.createdAt ? new Date(story.createdAt).toLocaleDateString() : 'Unknown date'}
        </span>
      </div>
      <p className="text-gray-400 text-sm mt-2 line-clamp-2">{story.summary || 'No summary provided'}</p>
      <div className="flex gap-4 mt-3 text-xs text-gray-500">
        <span>{story.timeline?.length || 0} screenshots</span>
        {story.photos?.length > 0 && <span>{story.photos.length} photos</span>}
        {story.aiInterpretation && (
          <span className="text-secondary">
            <svg className="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
            </svg>
            AI analyzed
          </span>
        )}
      </div>
    </div>
  );
};

const StoryViewer: React.FC<StoryViewerProps> = ({ selectedStoryId, onBack }) => {
  const [stories, setStories] = useState<AnalysisStory[]>([]);
  const [currentStory, setCurrentStory] = useState<AnalysisStory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response: StoriesResponse = await getStories(page, 10);
      setStories(response.stories);
      setTotalPages(Math.ceil(response.total / 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stories');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchStory = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const story = await getStory(id);
      setCurrentStory(story);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch story');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStoryId) {
      fetchStory(selectedStoryId);
    } else if (!currentStory) {
      fetchStories();
    }
  }, [selectedStoryId, fetchStory, fetchStories, currentStory]);

  const handleSelectStory = (id: string) => {
    fetchStory(id);
  };

  const handleBack = () => {
    setCurrentStory(null);
    if (onBack) {
      onBack();
    } else {
      fetchStories();
    }
  };

  const handleDeleteStory = async (id: string) => {
    try {
      await deleteStory(id);
      setCurrentStory(null);
      fetchStories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete story');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-secondary"></div>
        <span className="ml-3 text-gray-400">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-600 rounded-lg p-4 text-red-400">
        <p className="font-medium">Error</p>
        <p className="text-sm">{error}</p>
        <button
          onClick={() => currentStory ? fetchStory(currentStory.id) : fetchStories()}
          className="mt-2 text-sm text-secondary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (currentStory) {
    return <StoryDetail story={currentStory} onBack={handleBack} onDelete={handleDeleteStory} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-white">Stories</h2>
        <span className="text-sm text-gray-400">{stories.length} stories found</span>
      </div>

      {stories.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p className="text-gray-400">No stories yet</p>
          <p className="text-sm text-gray-500 mt-2">
            Create a story by enabling Story Mode in the Bulk Upload section
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {stories.map((story) => (
              <StoryListItem key={story.id} story={story} onSelect={handleSelectStory} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
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
        </>
      )}
    </div>
  );
};

export default StoryViewer;
