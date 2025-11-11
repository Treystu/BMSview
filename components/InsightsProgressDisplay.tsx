/**
 * Insights Progress Display Component
 * 
 * Displays real-time progress for background insights generation.
 * Shows initial summary, tool calls, data fetches, and streaming results.
 */

import React from 'react';
import type { InsightsProgress, InsightsJobStatus } from '../hooks/useInsightsPolling';

interface InsightsProgressDisplayProps {
  status: InsightsJobStatus | null;
  isPolling: boolean;
  error: string | null;
}

export function InsightsProgressDisplay({ status, isPolling, error }: InsightsProgressDisplayProps) {
  if (!status && !error) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          🤖 AI Insights Generation
        </h3>
        <StatusBadge status={status?.status} isPolling={isPolling} error={error} />
      </div>

      {/* Initial Summary */}
      {status?.initialSummary && (
        <InitialSummaryDisplay summary={status.initialSummary} />
      )}

      {/* Progress Events */}
      {status?.progress && status.progress.length > 0 && (
        <ProgressEventsDisplay progress={status.progress} />
      )}

      {/* Partial Insights */}
      {status?.partialInsights && (
        <PartialInsightsDisplay insights={status.partialInsights} />
      )}

      {/* Final Insights */}
      {status?.finalInsights && (
        <FinalInsightsDisplay insights={status.finalInsights} />
      )}

      {/* Error Display */}
      {(error || status?.error) && (
        <ErrorDisplay error={error || status?.error || 'Unknown error'} />
      )}
    </div>
  );
}

function StatusBadge({ status, isPolling, error }: { status?: string; isPolling: boolean; error: string | null }) {
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
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-blue-800" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Processing...
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

function ProgressEventsDisplay({ progress }: { progress: InsightsProgress[] }) {
  // Show last 15 events, most recent first - increased to show more context
  const recentEvents = [...progress].reverse().slice(0, 15);

  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">🔄 AI Conversation Flow</h4>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {recentEvents.map((event, index) => (
          <ProgressEventItem key={index} event={event} />
        ))}
      </div>
      {progress.length > 15 && (
        <p className="text-xs text-gray-500 mt-2">
          Showing last 15 of {progress.length} events
        </p>
      )}
    </div>
  );
}

function ProgressEventItem({ event }: { event: InsightsProgress }) {
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
    <div className="flex items-start gap-2 text-xs">
      <span className="text-lg flex-shrink-0">{getIcon()}</span>
      <div className="flex-1 min-w-0">
        <div className="text-gray-700 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
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
      <span className="flex-shrink-0">{getIcon()}</span>
      <div className="flex-1">
        <div className="text-gray-700">{getMessage()}</div>
        <p className="text-gray-400 text-xs mt-1">
          {new Date(event.timestamp).toLocaleTimeString()}
        </p>
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
    <div className="mt-4 p-4 bg-green-50 rounded-lg">
      <h4 className="text-sm font-semibold text-green-900 mb-3">✅ Final Analysis</h4>
      <div className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
        {displayText}
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
