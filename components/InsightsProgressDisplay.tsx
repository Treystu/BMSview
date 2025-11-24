/**
 * Insights Progress Display Component
 * 
 * Displays real-time progress for background insights generation.
 * Shows initial summary, tool calls, data fetches, and streaming results.
 * Features collapsible "AI thinking" section that auto-collapses when complete.
 * Implements "Starter Motor" approach: reassuring messages for long-running analyses.
 */

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { InsightsProgress, InsightsJobStatus } from '../hooks/useInsightsPolling';

// Time thresholds for progress messages (in seconds)
const TIME_THRESHOLD_INITIAL = 30;
const TIME_THRESHOLD_ANALYZING = 60;
const TIME_THRESHOLD_CRUNCHING = 120;
const TIME_THRESHOLD_DEEP = 180;

interface InsightsProgressDisplayProps {
  status: InsightsJobStatus | null;
  isPolling: boolean;
  error: string | null;
}

export function InsightsProgressDisplay({ status, isPolling, error }: InsightsProgressDisplayProps) {
  const [showThinking, setShowThinking] = useState(true);
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  // Track when analysis started
  useEffect(() => {
    if (isPolling && !analysisStartTime) {
      setAnalysisStartTime(Date.now());
    } else if (!isPolling) {
      setAnalysisStartTime(null);
      setElapsedSeconds(0);
    }
  }, [isPolling, analysisStartTime]);

  // Update elapsed time every second
  useEffect(() => {
    if (!analysisStartTime) return;
    
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - analysisStartTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [analysisStartTime]);

  // Get appropriate status message based on elapsed time
  const getStatusMessage = () => {
    if (status?.status === 'completed') {
      return 'AI Analysis Complete';
    }
    
    if (elapsedSeconds < TIME_THRESHOLD_INITIAL) {
      return 'AI Analyzing Your Battery...';
    } else if (elapsedSeconds < TIME_THRESHOLD_ANALYZING) {
      return 'Analyzing Historical Trends...';
    } else if (elapsedSeconds < TIME_THRESHOLD_CRUNCHING) {
      return 'Crunching Complex Data...';
    } else if (elapsedSeconds < TIME_THRESHOLD_DEEP) {
      return 'Deep Analysis in Progress...';
    } else {
      return 'Processing Comprehensive Analysis...';
    }
  };
  
  // Auto-collapse thinking section when analysis completes
  useEffect(() => {
    if (status?.status === 'completed' && status?.finalInsights) {
      setShowThinking(false);
    }
  }, [status?.status, status?.finalInsights]);

  if (!status && !error) {
    return null;
  }

  const isComplete = status?.status === 'completed';
  const hasProgress = status?.progress && status.progress.length > 0;

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          🤖 {getStatusMessage()}
        </h3>
        {isPolling && elapsedSeconds > 0 && (
          <p className="text-sm text-gray-500 mb-2">
            Elapsed time: {Math.floor(elapsedSeconds / 60)}m {elapsedSeconds % 60}s
            {elapsedSeconds > TIME_THRESHOLD_ANALYZING && (
              <span className="ml-2 text-blue-600 font-medium">
                • Complex analysis in progress, please wait...
              </span>
            )}
          </p>
        )}
        <StatusBadge status={status?.status} isPolling={isPolling} error={error} elapsedSeconds={elapsedSeconds} />
      </div>

      {/* Final Insights - Show prominently when complete */}
      {status?.finalInsights && (
        <FinalInsightsDisplay insights={status.finalInsights} />
      )}

      {/* Collapsible "AI Thinking" Section */}
      {hasProgress && (
        <div className="mt-4">
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
          >
            <span className="transform transition-transform duration-200" style={{ display: 'inline-block', transform: showThinking ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              ▶
            </span>
            {showThinking ? 'Hide' : 'Show'} AI Thinking Process
            <span className="text-gray-500">({status.progress.length} steps)</span>
          </button>
          
          {showThinking && (
            <div className="mt-3">
              {/* Initial Summary */}
              {status?.initialSummary && (
                <InitialSummaryDisplay summary={status.initialSummary} />
              )}

              {/* Progress Events */}
              <ProgressEventsDisplay progress={status.progress} isLive={!isComplete} />

              {/* Partial Insights */}
              {status?.partialInsights && !status?.finalInsights && (
                <PartialInsightsDisplay insights={status.partialInsights} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {(error || status?.error) && (
        <ErrorDisplay error={error || status?.error || 'Unknown error'} />
      )}
    </div>
  );
}

function StatusBadge({ status, isPolling, error, elapsedSeconds }: { status?: string; isPolling: boolean; error: string | null; elapsedSeconds: number }) {
  if (error) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
        ❌ Error
      </span>
    );
  }

  if (status === 'completed') {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
        ✅ Completed
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
        ❌ Failed
      </span>
    );
  }

  if (status === 'processing' || isPolling) {
    // Show different messages based on elapsed time using the same thresholds
    const message = elapsedSeconds > TIME_THRESHOLD_CRUNCHING ? 'Deep Analysis...' : 
                    elapsedSeconds > TIME_THRESHOLD_ANALYZING ? 'Processing...' : 
                    'Analyzing...';
    
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {message}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
      ⏳ Queued
    </span>
  );
}

function InitialSummaryDisplay({ summary }: { summary: any }) {
  if (!summary) return null;

  const { current, historical } = summary;

  return (
    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
      <h4 className="text-sm font-semibold text-blue-900 mb-3">📊 Initial Battery Summary</h4>
      
      {/* Current Snapshot */}
      {current && (
        <div className="mb-3">
          <p className="text-xs font-medium text-blue-800 mb-2">Current Snapshot:</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {current.voltage && (
              <div>
                <span className="text-gray-600">Voltage:</span>{' '}
                <span className="font-semibold">{current.voltage.toFixed(2)}V</span>
              </div>
            )}
            {current.current !== null && (
              <div>
                <span className="text-gray-600">Current:</span>{' '}
                <span className="font-semibold">{current.current.toFixed(2)}A</span>
              </div>
            )}
            {current.soc !== null && (
              <div>
                <span className="text-gray-600">SOC:</span>{' '}
                <span className="font-semibold">{current.soc.toFixed(1)}%</span>
              </div>
            )}
            {current.cellCount > 0 && (
              <div>
                <span className="text-gray-600">Cells:</span>{' '}
                <span className="font-semibold">{current.cellCount}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historical Summary */}
      {historical && (
        <div>
          <p className="text-xs font-medium text-blue-800 mb-2">Last 7 Days:</p>
          <div className="text-xs text-gray-700">
            <p>{historical.recordCount} data points collected</p>
            {historical.daily && historical.daily.length > 0 && (
              <p className="mt-1">
                Daily average: {(historical.daily.reduce((sum: number, d: any) => sum + (d.avgSOC || 0), 0) / historical.daily.length).toFixed(1)}% SOC
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressEventsDisplay({ progress, isLive }: { progress: InsightsProgress[]; isLive: boolean }) {
  // Show last 15 events, most recent first - increased to show more context
  const recentEvents = [...progress].reverse().slice(0, 15);

  return (
    <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          {isLive && <span className="animate-pulse">🧠</span>}
          {!isLive && <span>🧠</span>}
          <span>{isLive ? 'Gemini Thinking...' : 'Gemini\'s Thought Process'}</span>
        </h4>
        {isLive && (
          <span className="text-xs text-blue-600 font-medium animate-pulse">● LIVE</span>
        )}
      </div>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {recentEvents.map((event, index) => (
          <ProgressEventItem key={index} event={event} isLatest={index === 0 && isLive} />
        ))}
      </div>
      {progress.length > 15 && (
        <p className="text-xs text-blue-600 mt-2">
          Showing last 15 of {progress.length} steps
        </p>
      )}
    </div>
  );
}

function ProgressEventItem({ event, isLatest }: { event: InsightsProgress; isLatest?: boolean }) {
  const getIcon = () => {
    switch (event.type) {
      case 'context_built':
        return '🧠';
      case 'tool_call':
        return '🔧';
      case 'tool_response':
        return '📊';
      case 'ai_response':
        return '🤖';
      case 'iteration':
        return '📈';
      case 'prompt_sent':
        return '📤';
      case 'response_received':
        return '📥';
      case 'status':
        return 'ℹ️';
      case 'error':
        return '❌';
      default:
        return '•';
    }
  };

  const getMessage = () => {
    // Use event.data.message if it exists (our new formatted messages)
    if (event.data.message) {
      return event.data.message;
    }
    
    // Fallback to old formatting
    switch (event.type) {
      case 'context_built':
        return `🧠 Context built for AI (${Math.round((event.data.promptLength || 0) / 1000)}KB prompt)`;
      case 'tool_call':
        const params = event.data.parameters || {};
        const paramSummary = Object.entries(params)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(', ');
        return (
          <div>
            <div className="font-medium">Requesting data: {event.data.tool}</div>
            {paramSummary && (
              <div className="text-xs text-gray-500 mt-1 font-mono">
                {paramSummary}
              </div>
            )}
          </div>
        );
      case 'tool_response':
        const success = event.data.success !== false;
        return (
          <div>
            <div className={success ? 'text-green-700' : 'text-red-700'}>
              {success ? '✓' : '✗'} {event.data.tool} response received ({(event.data.dataSize || 0).toLocaleString()} bytes)
            </div>
            {event.data.parameters && (
              <div className="text-xs text-gray-500 mt-1">
                Query: {JSON.stringify(event.data.parameters).substring(0, 100)}
                {JSON.stringify(event.data.parameters).length > 100 && '...'}
              </div>
            )}
          </div>
        );
      case 'prompt_sent':
        return `📤 Sending prompt to AI (${event.data.messageCount} messages, ${Math.round((event.data.promptLength || 0) / 1000)}KB)`;
      case 'response_received':
        if (event.data.isEmpty) {
          return '⚠️ Received empty response from AI';
        }
        return `📥 Received response from AI (${Math.round((event.data.responseLength || 0) / 1000)}KB)`;
      case 'ai_response':
        return 'AI generated response';
      case 'iteration':
        return `📈 Iteration ${event.data.iteration} of ?`;
      case 'status':
        return event.data.message;
      case 'error':
        return `Error: ${event.data.error}`;
      default:
        return JSON.stringify(event.data);
    }
  };

  return (
    <div className={`flex items-start gap-2 text-xs p-3 rounded-lg transition-all duration-300 ${
      isLatest 
        ? 'bg-white border-2 border-blue-300 shadow-md animate-pulse-subtle' 
        : 'bg-white bg-opacity-60 border border-blue-100'
    }`}>
      <span className="text-lg flex-shrink-0">{getIcon()}</span>
      <div className="flex-1 min-w-0">
        <div className="text-gray-700 whitespace-pre-wrap break-words text-xs leading-relaxed">
          {getMessage()}
        </div>
        {event.timestamp && (
          <div className="text-gray-400 text-xs mt-1">
            {new Date(event.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}

function PartialInsightsDisplay({ insights }: { insights: string }) {
  return (
    <div className="mt-4 p-4 bg-yellow-50 rounded-lg">
      <h4 className="text-sm font-semibold text-yellow-900 mb-3">📝 Preliminary Insights</h4>
      <div className="text-sm text-gray-700 whitespace-pre-wrap">
        {insights}
      </div>
    </div>
  );
}

function FinalInsightsDisplay({ insights }: { insights: any }) {
  const displayText = insights.formattedText || insights.rawText || JSON.stringify(insights);

  return (
    <div className="mt-4 p-6 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg border border-green-200 shadow-sm">
      <h4 className="text-lg font-bold text-green-900 mb-4 flex items-center gap-2">
        <span>✅</span>
        <span>Final Analysis</span>
      </h4>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-gray-900 mb-3 mt-4" {...props} />,
            h2: ({ node, ...props }) => <h2 className="text-lg font-bold text-gray-900 mb-3 mt-4" {...props} />,
            h3: ({ node, ...props }) => <h3 className="text-base font-semibold text-gray-800 mb-2 mt-3" {...props} />,
            h4: ({ node, ...props }) => <h4 className="text-sm font-semibold text-gray-800 mb-2 mt-2" {...props} />,
            p: ({ node, ...props }) => <p className="text-gray-700 mb-3 leading-relaxed break-words" {...props} />,
            ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1.5" {...props} />,
            ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1.5" {...props} />,
            li: ({ node, ...props }) => <li className="text-gray-700 ml-2 leading-relaxed" {...props} />,
            strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
            em: ({ node, ...props }) => <em className="italic text-gray-700" {...props} />,
            code: ({ node, inline, ...props }: any) =>
              inline ? (
                <code className="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm break-words" {...props} />
              ) : (
                <code className="block bg-gray-900 text-green-400 p-3 rounded-lg text-sm overflow-x-auto mb-3" {...props} />
              ),
            blockquote: ({ node, ...props }) => (
              <blockquote className="border-l-4 border-green-500 pl-4 py-2 mb-3 italic text-gray-600 bg-green-50 rounded-r" {...props} />
            ),
            a: ({ node, ...props }) => (
              <a className="text-blue-600 hover:text-blue-800 underline break-words" {...props} />
            ),
            table: ({ node, ...props }) => (
              <div className="overflow-x-auto mb-3">
                <table className="min-w-full divide-y divide-gray-200 border border-gray-300 rounded" {...props} />
              </div>
            ),
            th: ({ node, ...props }) => (
              <th className="px-3 py-2 bg-gray-100 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b" {...props} />
            ),
            td: ({ node, ...props }) => (
              <td className="px-3 py-2 text-sm text-gray-700 border-b break-words" {...props} />
            ),
          }}
        >
          {displayText}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function ErrorDisplay({ error }: { error: string }) {
  return (
    <div className="mt-4 p-4 bg-red-50 rounded-lg">
      <h4 className="text-sm font-semibold text-red-900 mb-2">❌ Error</h4>
      <p className="text-sm text-red-700">{error}</p>
    </div>
  );
}
