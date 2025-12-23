import React, { useEffect, useMemo, useState } from 'react';
import { hasOpenCircuitBreakers, resetAllCircuitBreakers } from '../services/circuitBreakerService';
import { getRecentHistoryForSystem, streamInsights } from '../services/clientService';
import { useAppState } from '../state/appState';
import type { AnalysisData, BmsSystem, DisplayableAnalysisResult, WeatherData } from '../types';
import { InsightMode, InsightModeDescriptions } from '../types';
import { formatError, getIsActualError } from '../utils';
import { CostEstimateBadge, estimateInsightsCost } from './CostEstimateBadge';
import CloudIcon from './icons/CloudIcon';
import SpinnerIcon from './icons/SpinnerIcon';
import SunIcon from './icons/SunIcon';
import ThermometerIcon from './icons/ThermometerIcon';
import TypewriterMarkdown from './TypewriterMarkdown';
import VisualInsightsRenderer from './VisualInsightsRenderer';

// Loading state messages for each insight mode
const InsightModeLoadingStates: Record<InsightMode, { title: string; description: string }> = {
  [InsightMode.WITH_TOOLS]: {
    title: '🤖 AI Battery Guru Thinking...',
    description: 'Analyzing your battery data with intelligent querying. The AI can request specific historical data on-demand to answer your questions.'
  },
  [InsightMode.FULL_CONTEXT]: {
    title: '🧠 Full Context Mode Loading...',
    description: 'Loading complete historical data and enabling AI feedback capability. This may take longer but provides the deepest analysis with app improvement suggestions.'
  },
  [InsightMode.STANDARD]: {
    title: '⚡ Generating Insights...',
    description: 'Processing your request using the legacy endpoint (same capabilities as Battery Guru).'
  },
  [InsightMode.VISUAL_GURU]: {
    title: '📊 Visual Guru Expert Analyzing...',
    description: 'Generating infographic-style insights with charts for time-based metrics. Optimized for visual clarity and dashboard-ready output.'
  },
  [InsightMode.ASYNC_WORKLOAD]: {
    title: '⚡ Async Workload Queued...',
    description: 'Your analysis has been queued in Netlify\'s durable async system. This workload can run unlimited time with automatic retries. Check status via polling.'
  }
};

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
  console.log(JSON.stringify({
    level: level.toUpperCase(),
    timestamp: new Date().toISOString(),
    component: 'AnalysisResult',
    message,
    context
  }));
};

interface AnalysisResultProps {
  result: DisplayableAnalysisResult;
  registeredSystems: BmsSystem[];
  onLinkRecord: (recordId: string, systemId: string, dlNumber?: string | null) => void;
  onReprocess: (file: File) => void;
  onRegisterNewSystem: (dlNumber: string) => void;
}

const DeeperInsightsSection: React.FC<{ analysisData: AnalysisData, systemId?: string, systemName?: string }> = ({ analysisData, systemId, systemName }) => {
  const { state, dispatch } = useAppState();
  const [insights, setInsights] = useState('');
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'initializing' | 'streaming' | 'complete' | 'error'>('idle');
  const [isLoading, setIsLoading] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [circuitBreakerOpen, setCircuitBreakerOpen] = useState(false);
  const [isResettingCircuitBreaker, setIsResettingCircuitBreaker] = useState(false);
  // Consent checkbox state is intentionally NOT persisted across page reloads.
  // This is privacy-friendly and GDPR-compliant, requiring explicit consent per session.
  // If you wish to persist consent, consider using localStorage with a timestamp and clear documentation.
  const [consentGranted, setConsentGranted] = useState(false); // User consent for AI analysis
  const successTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Context window configuration
  const [contextWindowDays, setContextWindowDays] = useState(30); // Default 1 month

  // Model override configuration
  const [modelOverride, setModelOverride] = useState(''); // Empty = use default
  const [customModel, setCustomModel] = useState(''); // For custom model input
  const [useCustomModel, setUseCustomModel] = useState(false); // Toggle between preset and custom

  // Insight mode selection from global state
  const selectedMode = state.selectedInsightMode;
  const setSelectedMode = (mode: InsightMode) => {
    dispatch({ type: 'SET_INSIGHT_MODE', payload: mode });
  };

  // Available Gemini models (presets)
  const availableModels = [
    { value: '', label: 'Default (2.5 Flash)' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3.0 Pro Preview' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp' },
    { value: 'gemini-2.0-flash-thinking-exp-1219', label: 'Gemini 2.0 Flash Thinking' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
    { value: 'gemini-exp-1206', label: 'Gemini Exp 1206' },
    { value: 'learnlm-1.5-pro-experimental', label: 'LearnLM 1.5 Pro Experimental' },
    { value: 'custom', label: 'Custom Model (enter below)' },
  ];

  // Get the effective model to use
  const getEffectiveModel = () => {
    if (useCustomModel || modelOverride === 'custom') {
      return customModel.trim();
    }
    return modelOverride;
  };

  // Predefined context window options
  const contextWindowOptions = [
    { days: 1 / 24, label: '1 Hour' },
    { days: 1 / 8, label: '3 Hours' },
    { days: 0.5, label: '12 Hours' },
    { days: 1, label: '1 Day' },
    { days: 3, label: '3 Days' },
    { days: 7, label: '1 Week' },
    { days: 14, label: '2 Weeks' },
    { days: 30, label: '1 Month' },
    { days: 60, label: '2 Months' },
    { days: 90, label: '3 Months' },
    { days: 180, label: '6 Months' },
    { days: 365, label: '1 Year' }
  ];

  const getContextWindowLabel = (days: number) => {
    const option = contextWindowOptions.find(opt => opt.days === days);
    return option ? option.label : `${days} days`;
  };

  // Calculate estimated cost based on context window and query type
  const standardInsightsCostEstimate = useMemo(
    () => estimateInsightsCost(contextWindowDays, false),
    [contextWindowDays]
  );

  const customQueryCostEstimate = useMemo(
    () => estimateInsightsCost(contextWindowDays, true),
    [contextWindowDays]
  );

  const handleGenerateInsights = async (prompt?: string, overrideMode?: InsightMode) => {
    if (!consentGranted) {
      setError('Please grant consent for AI analysis to proceed.');
      return;
    }

    setIsLoading(true);
    setAnalysisStatus('initializing');
    setError(null);
    setInsights('');

    try {

      // Fetch recent history from local cache to bridge the sync gap
      let recentHistory: any[] = [];
      if (systemId) {
        try {
          recentHistory = await getRecentHistoryForSystem(systemId, contextWindowDays);
          log('info', 'Attached recent history from client cache to insights payload', { count: recentHistory.length });
        } catch (hErr) {
          log('warn', 'Failed to attach recent history', { error: String(hErr) });
        }
      }

      await streamInsights(
        {
          analysisData,
          systemId,
          customPrompt: prompt,
          useEnhancedMode: true,
          contextWindowDays, // Pass context window configuration
          modelOverride: getEffectiveModel() || undefined, // Pass model override if selected
          // Iteration limits: 20 for custom queries, 10 for standard (matches react-loop.cjs constants)
          maxIterations: prompt ? 20 : 10,
          insightMode: overrideMode || selectedMode, // Use override mode if provided, otherwise use selected mode
          consentGranted, // Pass consent flag
          recentHistory // Pass the locally cached history
        },
        (chunk) => {
          setInsights(prev => prev + chunk);
          setAnalysisStatus('streaming');
        },
        () => {
          setAnalysisStatus('complete');
          setIsLoading(false);
        },
        async (err) => {
          setError(err.message);
          setAnalysisStatus('error');
          setIsLoading(false);

          // Check if circuit breaker might be open
          try {
            const hasOpen = await hasOpenCircuitBreakers();
            setCircuitBreakerOpen(hasOpen);
            if (hasOpen) {
              log('warn', 'Circuit breaker is open after error', { error: err.message });
            }
          } catch (checkError) {
            log('error', 'Failed to check circuit breaker status', { error: checkError });
          }
        }
      );
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      setError(errorMessage);
      setAnalysisStatus('error');
      setIsLoading(false);
      log('error', 'Deeper insights stream initiation failed.', { error: errorMessage });

      // Check if circuit breaker might be open
      hasOpenCircuitBreakers()
        .then(hasOpen => setCircuitBreakerOpen(hasOpen))
        .catch(err => log('error', 'Failed to check circuit breaker status', { error: err }));
    }
  };

  const handleResetCircuitBreaker = async () => {
    setIsResettingCircuitBreaker(true);
    try {
      await resetAllCircuitBreakers();
      setCircuitBreakerOpen(false);
      setError(null);
      log('info', 'Circuit breaker reset successfully');

      // Clear any existing timeout
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }

      // Show success message briefly with cleanup
      setInsights('✅ Circuit breaker reset. You can try generating insights again.');
      setAnalysisStatus('idle');
      successTimeoutRef.current = setTimeout(() => {
        setInsights('');
        successTimeoutRef.current = null;
      }, 3000);
    } catch (err) {
      log('error', 'Failed to reset circuit breaker', { error: err });
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset circuit breaker';
      setError(`Reset failed: ${errorMessage}`);
    } finally {
      setIsResettingCircuitBreaker(false);
    }
  };

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
          <span className="text-2xl">🔋</span>
        </div>
        <h4 className="text-2xl font-bold text-gray-900">Battery Guru Insights</h4>
      </div>

      {insights && (
        <div className="mb-6 p-8 bg-white rounded-2xl shadow-xl border border-gray-100 transition-all duration-300 hover:shadow-2xl">
          {analysisStatus === 'complete' && (
            <div className="mb-4 flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100">
                <span className="text-green-600 text-lg">✓</span>
              </div>
              <h5 className="text-lg font-semibold text-gray-800">
                {selectedMode === InsightMode.VISUAL_GURU ? 'Visual Analysis Complete' : 'Analysis Complete'}
              </h5>
            </div>
          )}
          {selectedMode === InsightMode.VISUAL_GURU ? (
            <VisualInsightsRenderer
              content={insights}
              className="visual-insights-content"
            />
          ) : (
            <TypewriterMarkdown
              content={insights}
              speed={30}
              interval={40}
              className="insights-content"
            />
          )}
        </div>
      )}

      {isLoading && !insights && (
        <div className="relative overflow-hidden p-8 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-2xl shadow-lg border border-blue-100">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 animate-pulse"></div>
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-20"></div>
              <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
                <SpinnerIcon className="h-8 w-8 text-white animate-spin" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h5 className="text-lg font-bold text-gray-900">
                {InsightModeLoadingStates[selectedMode].title}
              </h5>
              <p className="text-sm text-gray-600 max-w-md">
                {InsightModeLoadingStates[selectedMode].description}
              </p>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg shadow-sm">
          <h5 className="font-bold text-red-800 flex items-center">
            <span className="mr-2">⚠️</span>
            Error Generating Insights
          </h5>
          <p className="text-red-700 mt-1 whitespace-pre-wrap">{error}</p>

          {/* Mode-specific error suggestions */}
          {!circuitBreakerOpen && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-lg">
              <p className="text-blue-900 text-sm font-semibold mb-2">
                💡 Suggestions to resolve this error:
              </p>
              <ul className="text-blue-800 text-sm space-y-1 list-disc list-inside">
                {selectedMode === InsightMode.WITH_TOOLS && (
                  <>
                    <li>Reduce the data analysis window (currently {getContextWindowLabel(contextWindowDays)})</li>
                    <li>Ask a simpler, more specific question</li>
                    <li>Try again in a few moments if the service is busy</li>
                  </>
                )}
                {selectedMode === InsightMode.FULL_CONTEXT && (
                  <>
                    <li>Full Context Mode loads ALL data upfront - this can be slower</li>
                    <li>Consider using <strong>Battery Guru</strong> mode for faster responses</li>
                    <li>Ensure your system has sufficient historical data</li>
                    <li>Try again in a few moments if the service is busy</li>
                  </>
                )}
                {selectedMode === InsightMode.STANDARD && (
                  <>
                    <li>This is a legacy endpoint - use <strong>Battery Guru</strong> mode directly for better support</li>
                    <li>Reduce the data analysis window (currently {getContextWindowLabel(contextWindowDays)})</li>
                    <li>Ensure your system has enough historical data</li>
                  </>
                )}
              </ul>
            </div>
          )}

          {circuitBreakerOpen && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
              <p className="text-yellow-800 text-sm mb-2">
                🔌 <strong>Circuit Breaker Open:</strong> The service is temporarily unavailable due to repeated failures.
                This is a safety mechanism to prevent cascading errors.
              </p>
              <button
                onClick={handleResetCircuitBreaker}
                disabled={isResettingCircuitBreaker}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${isResettingCircuitBreaker
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-yellow-600 text-white hover:bg-yellow-700'
                  }`}
              >
                {isResettingCircuitBreaker ? 'Resetting...' : '🔄 Reset Circuit Breaker'}
              </button>
              <p className="text-yellow-700 text-xs mt-2">
                Note: Resetting the circuit breaker will clear the error state and allow you to try again.
                If the underlying issue persists, the circuit breaker will reopen.
              </p>
            </div>
          )}

          {!circuitBreakerOpen && (
            <div className="mt-3">
              <button
                onClick={() => handleGenerateInsights(customPrompt || undefined)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                🔄 Retry with Current Mode
              </button>
            </div>
          )}
        </div>
      )}
      {!isLoading && (
        <div className="p-5 bg-gradient-to-r from-gray-50 to-gray-100 rounded-lg space-y-4 border border-gray-200">
          {/* Insight Mode Selector */}
          <div className="mb-4 p-4 bg-white rounded-lg border border-gray-300">
            <label htmlFor="insight-mode-selector" className="block text-sm font-semibold text-gray-700 mb-3">
              🎯 Insight Generation Mode: <span className="text-indigo-600">{InsightModeDescriptions[selectedMode].label}</span>
            </label>
            <p className="text-xs text-gray-600 mb-3">
              Choose the analysis approach that best suits your needs. Each mode offers different capabilities and processing times.
            </p>
            <select
              id="insight-mode-selector"
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as InsightMode)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600 bg-white cursor-pointer mb-3"
            >
              {Object.entries(InsightModeDescriptions).map(([mode, info]) => (
                <option key={mode} value={mode}>
                  {info.label}
                </option>
              ))}
            </select>

            {/* Mode Description and Features */}
            <div className="mt-3 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
              <p className="text-sm font-medium text-indigo-900 mb-2">
                {InsightModeDescriptions[selectedMode].description}
              </p>
              <ul className="text-xs text-indigo-800 space-y-1">
                {InsightModeDescriptions[selectedMode].features.map((feature) => (
                  <li key={feature} className="flex items-start">
                    <span className="mr-2">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Context Window Slider */}
          <div className="mb-4 p-4 bg-white rounded-lg border border-gray-300">
            <label htmlFor="context-window-slider" className="block text-sm font-semibold text-gray-700 mb-3">
              📊 Data Analysis Window: <span className="text-blue-600">{getContextWindowLabel(contextWindowDays)}</span>
            </label>
            <p className="text-xs text-gray-600 mb-3">
              Select how far back the AI should retrieve historical data for analysis.
              Larger windows provide more context but may take longer to process.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 whitespace-nowrap">1 Hour</span>
              <input
                id="context-window-slider"
                type="range"
                min="0"
                max="11"
                step="1"
                value={contextWindowOptions.findIndex(opt => opt.days === contextWindowDays)}
                onChange={(e) => {
                  const index = parseInt(e.target.value, 10);
                  setContextWindowDays(contextWindowOptions[index].days);
                }}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <span className="text-xs text-gray-500 whitespace-nowrap">1 Year</span>
            </div>
            <div className="mt-2 flex justify-between text-xs text-gray-500">
              <span>Recent</span>
              <span>Comprehensive</span>
            </div>
          </div>

          {/* Model Override Dropdown */}
          <div className="mb-4 p-4 bg-white rounded-lg border border-gray-300">
            <label htmlFor="model-override" className="block text-sm font-semibold text-gray-700 mb-3">
              🤖 AI Model: <span className="text-purple-600">
                {modelOverride === 'custom' || useCustomModel
                  ? customModel.trim() || 'Custom (not set)'
                  : availableModels.find(m => m.value === modelOverride)?.label || 'Default (2.5 Flash)'}
              </span>
            </label>
            <p className="text-xs text-gray-600 mb-3">
              Select a preset model or enter a custom model name. Pro models provide better analysis for complex queries but take longer.
              <a
                href="https://ai.google.dev/gemini-api/docs/pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-blue-600 hover:text-blue-800 underline"
              >
                View official pricing
              </a>
            </p>
            <select
              id="model-override"
              value={modelOverride}
              onChange={(e) => {
                setModelOverride(e.target.value);
                if (e.target.value === 'custom') {
                  setUseCustomModel(true);
                } else {
                  setUseCustomModel(false);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 bg-white cursor-pointer mb-3"
            >
              {availableModels.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>

            {/* Custom Model Input - shown when "Custom" is selected or user wants custom */}
            {(modelOverride === 'custom' || useCustomModel) && (
              <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                <label htmlFor="custom-model-input" className="block text-xs font-semibold text-purple-800 mb-2">
                  Custom Model Name
                </label>
                <input
                  id="custom-model-input"
                  type="text"
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  placeholder="e.g., gemini-3.0-ultra, gemini-2.5-pro-latest"
                  className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-sm font-mono"
                />
                <p className="text-xs text-purple-700 mt-2">
                  Enter any Gemini model name. Make sure it's available in your API key's permissions.
                </p>
              </div>
            )}
          </div>

          {/* Consent Checkbox */}
          <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentGranted}
                onChange={(e) => setConsentGranted(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div className="text-sm text-gray-700">
                <span className="font-semibold text-blue-800">I agree to AI Data Analysis</span>
                <p className="mt-1 text-xs text-gray-600">
                  By checking this box, you consent to having your anonymized battery data processed by AI services (Gemini) to generate insights.
                  Your data is anonymized before processing and retained for 30 days for analysis purposes.
                </p>
              </div>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <button
                type="button"
                onClick={() => handleGenerateInsights()}
                disabled={!consentGranted}
                className={`w-full sm:w-auto font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-200 transform flex items-center justify-center gap-2 ${consentGranted
                    ? 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 hover:scale-105 text-white cursor-pointer'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
              >
                <span>🔍</span>
                <span>Generate AI Insights</span>
              </button>
              <CostEstimateBadge estimate={standardInsightsCostEstimate} showTokens={true} size="sm" />
            </div>
            <p className="text-sm text-gray-600 text-center sm:text-left">
              AI will intelligently query historical data and analyze trends for comprehensive insights.
            </p>
          </div>
          <div className="border-t border-gray-300 pt-4 space-y-2">
            <label htmlFor={`custom-prompt-${analysisData.dlNumber || 'new'}`} className="block text-sm font-medium text-gray-700">
              Or ask a custom question about your system
              {systemName && <span className="text-xs text-gray-500"> (AI can request relevant data to answer)</span>}
            </label>
            <textarea
              id={`custom-prompt-${analysisData.dlNumber || 'new'}`}
              rows={3}
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
              placeholder="e.g., I want to run an extra 5A load all night. Will I have enough power until sunrise?"
            />
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <button
                type="button"
                onClick={() => handleGenerateInsights(customPrompt)}
                disabled={!customPrompt.trim() || !consentGranted}
                className={`w-full sm:w-auto font-bold py-2 px-4 rounded-lg shadow-md transition-all duration-200 flex items-center justify-center gap-2 ${customPrompt.trim() && consentGranted
                    ? 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white'
                    : 'bg-gray-400 text-gray-200 cursor-not-allowed'
                  }`}
              >
                <span>💬</span>
                <span>Submit Custom Query</span>
              </button>
              {customPrompt.trim() && (
                <CostEstimateBadge estimate={customQueryCostEstimate} showTokens={true} size="sm" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricCard: React.FC<{
  title: string;
  value: string | number | null;
  unit: string;
  cardClassName?: string;
  valueClassName?: string;
}> = ({ title, value, unit, cardClassName = 'bg-white', valueClassName = 'text-secondary' }) => (
  <div className={`p-4 rounded-lg shadow-md text-center transition-colors duration-300 ${cardClassName}`}>
    <h4 className="text-sm font-medium text-gray-500">{title}</h4>
    <p className={`text-2xl font-bold transition-colors duration-300 ${valueClassName}`}>
      {value !== null && value !== undefined ? value : 'N/A'}
      <span className="text-lg text-neutral-dark ml-1">{unit}</span>
    </p>
  </div>
);


const WeatherCard: React.FC<{ icon: React.ReactNode; title: string; value: string | number | null; unit: string; }> = ({ icon, title, value, unit }) => (
  <div className="flex items-center space-x-3 bg-white p-3 rounded-lg shadow-sm">
    <div className="text-secondary">
      {icon}
    </div>
    <div>
      <h4 className="text-xs font-medium text-gray-500">{title}</h4>
      <p className="text-md font-bold text-neutral-dark">
        {value ?? 'N/A'}
        <span className="text-sm font-normal ml-1">{unit}</span>
      </p>
    </div>
  </div>
);

const WeatherSection: React.FC<{ weather: WeatherData }> = ({ weather }) => (
  <div className="mb-8">
    <h4 className="text-xl font-semibold text-neutral-dark mb-4">Weather Conditions at Time of Analysis</h4>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <WeatherCard icon={<ThermometerIcon className="h-6 w-6" />} title="Temperature" value={weather.temp != null ? weather.temp.toFixed(1) : null} unit="°C" />
      <WeatherCard icon={<CloudIcon className="h-6 w-6" />} title="Cloud Cover" value={weather.clouds} unit="%" />
      <WeatherCard icon={<SunIcon className="h-6 w-6" />} title="UV Index" value={weather.uvi} unit="" />
    </div>
  </div>
);


const AdoptionSection: React.FC<{
  dlNumber: string;
  systems: BmsSystem[];
  onAdopt: (systemId: string) => void;
  onRegisterNew: () => void;
  disabled?: boolean;
}> = ({ dlNumber, systems, onAdopt, onRegisterNew, disabled }) => {
  const [selectedSystemId, setSelectedSystemId] = React.useState('');

  const handleAdoptClick = () => {
    if (selectedSystemId) {
      log('info', 'Adoption "Adopt" button clicked.', { dlNumber, selectedSystemId });
      onAdopt(selectedSystemId);
    }
  };

  const handleRegisterClick = () => {
    log('info', 'Adoption "Register New System" button clicked.', { dlNumber });
    onRegisterNew();
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSystemId = e.target.value;
    log('info', 'User changed system selection for adoption.', { dlNumber, newSystemId });
    setSelectedSystemId(newSystemId);
  };

  return (
    <div className={`mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      <p className="font-semibold text-yellow-800">This DL Number is unassigned.</p>
      <p className="text-sm text-yellow-700 mb-2">You can adopt it into one of your registered systems, or register a new one.</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={selectedSystemId}
          onChange={handleSelectChange}
          disabled={disabled}
          aria-label={`Select system for DL ${dlNumber}`}
          title={`Select system for DL ${dlNumber}`}
          className="block w-full sm:w-auto px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-secondary focus:border-secondary sm:text-sm disabled:bg-gray-200"
        >
          <option value="">Select a system...</option>
          {systems.map(system => (
            <option key={system.id} value={system.id}>{system.name}</option>
          ))}
        </select>
        <button
          onClick={handleAdoptClick}
          disabled={!selectedSystemId || disabled}
          className="bg-secondary hover:bg-primary text-white font-bold py-2 px-4 rounded-lg shadow-md disabled:bg-gray-400 transition-colors"
        >
          Adopt
        </button>
        <span className="text-sm text-gray-500 mx-2 hidden sm:inline">or</span>
        <button onClick={handleRegisterClick} disabled={disabled} className="text-secondary hover:underline text-sm font-semibold disabled:text-gray-500 disabled:no-underline">
          Register New System
        </button>
      </div>
      {disabled && <p className="text-xs text-yellow-600 mt-2">Adoption is disabled because the analysis could not be saved. Please resolve the save error shown above.</p>}
    </div>
  );
};

const ActionableInsights: React.FC<{ analysis: AnalysisData }> = ({ analysis }) => {
  const criticalAlerts = analysis.alerts?.filter(a => a.toUpperCase().startsWith('CRITICAL:')) || [];
  const warningAlerts = analysis.alerts?.filter(a => a.toUpperCase().startsWith('WARNING:')) || [];

  const infoAlerts = analysis.alerts?.filter(a =>
    !a.toUpperCase().startsWith('CRITICAL:') &&
    !a.toUpperCase().startsWith('WARNING:')
  ) || [];

  if (criticalAlerts.length === 0 && warningAlerts.length === 0 && infoAlerts.length === 0) {
    return null;
  }

  return (
    <div className="mb-8">
      <h4 className="text-xl font-semibold text-neutral-dark mb-4">Immediate Alerts</h4>

      {criticalAlerts.length > 0 && (
        <div className="mb-4 p-4 bg-red-100 border-l-4 border-red-500 rounded-r-lg">
          <div className="flex items-center">
            <svg className="h-6 w-6 text-red-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <h5 className="text-lg font-bold text-red-800">Immediate Action Required</h5>
          </div>
          <ul className="mt-2 list-disc list-inside space-y-1 text-red-700">
            {criticalAlerts.map((alert, index) => (
              <li key={index}>{alert.replace(/^CRITICAL: /i, '')}</li>
            ))}
          </ul>
        </div>
      )}

      {warningAlerts.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-100 border-l-4 border-yellow-500 rounded-r-lg">
          <div className="flex items-center">
            <svg className="h-6 w-6 text-yellow-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h5 className="text-lg font-bold text-yellow-800">Warnings &amp; Recommendations</h5>
          </div>
          <ul className="mt-2 list-disc list-inside space-y-1 text-yellow-700">
            {warningAlerts.map((alert, index) => (
              <li key={index}>{alert.replace(/^WARNING: /i, '')}</li>
            ))}
          </ul>
        </div>
      )}

      {infoAlerts.length > 0 && (
        <div className="mb-4 p-4 bg-blue-100 border-l-4 border-blue-500 rounded-r-lg">
          <div className="flex items-center">
            <svg className="h-6 w-6 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <h5 className="text-lg font-bold text-blue-800">Information</h5>
          </div>
          <ul className="mt-2 list-disc list-inside space-y-1 text-blue-700">
            {infoAlerts.map((alert, index) => (
              <li key={index}>{alert}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Helper function to determine Tailwind classes for health-based color coding
const getHealthStyles = (type: 'diff' | 'temp' | 'mos', value: number | null | undefined): { card: string; value: string } => {
  if (value == null) return { card: 'bg-white', value: 'text-secondary' };

  switch (type) {
    case 'diff': // value is in Volts
      if (value > 0.1) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
      if (value > 0.05) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
      break;
    case 'temp': // value is in Celsius
      if (value > 50) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
      if (value > 40) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
      if (value < 0) return { card: 'bg-blue-100 border border-blue-200', value: 'text-blue-600' };
      break;
    case 'mos': // value is in Celsius
      if (value > 80) return { card: 'bg-red-100 border border-red-200', value: 'text-red-600' };
      if (value > 65) return { card: 'bg-yellow-100 border border-yellow-200', value: 'text-yellow-600' };
      break;
  }
  return { card: 'bg-white', value: 'text-secondary' };
};


const AnalysisResult: React.FC<AnalysisResultProps> = ({ result, registeredSystems, onLinkRecord, onReprocess, onRegisterNewSystem }) => {
  const { fileName, data, error, weather, isDuplicate, isBatchDuplicate, file, saveError, recordId } = result;

  useEffect(() => {
    const statusContext = { fileName, error, hasData: !!data, isDuplicate, recordId };
    log('info', 'AnalysisResult component rendered/updated.', statusContext);
  }, [fileName, data, error, isDuplicate, recordId]);

  const isActualError = getIsActualError(result);
  const isPending = !result.data && !isActualError;

  // Determine the actual status for display
  const getDisplayStatus = () => {
    if (data) return { key: 'completed', text: 'Completed', color: 'green' };
    const lowerError = error?.toLowerCase() || '';
    if (isActualError) return { key: 'error', text: formatError(error!), color: 'red' };
    if (isPending) {
      if (lowerError.includes('extracting')) return { key: 'processing', text: 'Extracting Data', color: 'blue' };
      if (lowerError.includes('matching')) return { key: 'processing', text: 'Matching System', color: 'blue' };
      if (lowerError.includes('fetching')) return { key: 'processing', text: 'Fetching Weather', color: 'blue' };
      if (lowerError.includes('saving')) return { key: 'processing', text: 'Saving Result', color: 'blue' };
      if (lowerError.includes('queued')) return { key: 'queued', text: 'Queued for Analysis', color: 'yellow' };
      if (lowerError.includes('submitted')) return { key: 'submitted', text: 'Submitted', color: 'gray' };
      return { key: 'processing', text: error!, color: 'blue' };
    }
    return { key: 'unknown', text: 'Unknown Status', color: 'gray' };
  };

  const displayStatus = getDisplayStatus();

  const tempStyles = getHealthStyles('temp', data?.temperature);
  const mosTempStyles = getHealthStyles('mos', data?.mosTemperature);
  const diffStyles = getHealthStyles('diff', data?.cellVoltageDifference);


  const handleReprocessClick = () => {
    if (file) {
      log('info', 'Reprocess button clicked.', { fileName });
      onReprocess(file);
    }
  };

  if (isPending) {
    return (
      <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold text-neutral-dark break-all flex-1">{fileName}</h3>
          <div className="ml-4">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-${displayStatus.color}-100 text-${displayStatus.color}-800 border-${displayStatus.color}-200`}>
              {displayStatus.key === 'processing' && <SpinnerIcon className={`h-3 w-3 mr-1 text-${displayStatus.color}-500`} />}
              {displayStatus.key === 'queued' && <span className="mr-1">⏳</span>}
              {displayStatus.key === 'submitted' && <span className="mr-1">📤</span>}
              {displayStatus.text}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <SpinnerIcon className="h-6 w-6 text-secondary" />
            </div>
            <p className="text-neutral text-sm">{displayStatus.text}...</p>
            {result.submittedAt && (
              <p className="text-neutral text-xs mt-1">
                Submitted {new Date(result.submittedAt).toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const dlNumber = data?.dlNumber;
  let associatedSystemName: string | null = null;
  let adoptionNeeded = false;
  let associatedSystem: BmsSystem | undefined;

  if (dlNumber) {
    associatedSystem = registeredSystems.find(system => system.associatedDLs?.includes(dlNumber));
    if (associatedSystem) {
      associatedSystemName = associatedSystem.name;
    } else {
      adoptionNeeded = true;
    }
  }

  return (
    <div className="bg-neutral-light p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <h3 className="text-2xl font-bold text-neutral-dark break-all flex-1">{fileName}</h3>
        <div className="ml-4 flex gap-2">
          {isDuplicate && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-blue-100 text-blue-800 border-blue-200">
              <span className="mr-1">🔄</span>
              Duplicate (from cache)
            </span>
          )}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-${displayStatus.color}-100 text-${displayStatus.color}-800 border-${displayStatus.color}-200`}>
            {displayStatus.key === 'completed' && <span className="mr-1">✅</span>}
            {displayStatus.key === 'error' && <span className="mr-1">❌</span>}
            {displayStatus.text}
          </span>
        </div>
      </div>

      {isDuplicate && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center mb-2">
                <span className="text-2xl mr-2">🔄</span>
                <h4 className="text-lg font-semibold text-blue-800">Duplicate Detected</h4>
              </div>
              <p className="text-blue-700 mb-1">
                {data
                  ? 'This screenshot was previously analyzed. Showing cached results to save time and API costs.'
                  : isBatchDuplicate
                    ? 'Skipped: A file with the same name exists in this upload batch.'
                    : 'Skipped: A file with this name already exists in your history.'}
              </p>
              {data && data._timestamp && (
                <p className="text-blue-600 text-sm">
                  Original analysis: {new Date(data._timestamp).toLocaleString()}
                </p>
              )}
            </div>
            {file && (
              <button
                type="button"
                onClick={handleReprocessClick}
                className="ml-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors whitespace-nowrap flex items-center gap-2"
              >
                <span>🔄</span>
                <span>{data ? 'Re-analyze' : 'Analyze'} Anyway</span>
              </button>
            )}
          </div>
        </div>
      )}

      {saveError && (
        <div className="mb-6 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-r-lg">
          <h4 className="text-lg font-semibold text-yellow-800 mb-2">Warning: Not Saved</h4>
          <p className="text-yellow-700">The analysis was successful, but the result could not be saved to your history. The data below is displayed temporarily.</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-medium text-yellow-800 hover:underline">Show error details</summary>
            <p className="mt-1 text-yellow-600 bg-yellow-100 p-2 rounded-md font-mono text-xs break-all">{saveError}</p>
          </details>
        </div>
      )}

      {result.needsReview && result.validationWarnings && result.validationWarnings.length > 0 && (
        <div className="mb-6 p-4 bg-orange-50 border-l-4 border-orange-500 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-6 w-6 text-orange-500 mr-3 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-orange-800 mb-2">⚠️ Data Integrity Warning</h4>
              <p className="text-orange-700 mb-3">
                The AI may have misread some values from this screenshot. Please review the data below carefully and manually verify critical readings.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer font-medium text-orange-800 hover:underline text-sm">
                  Show validation warnings ({result.validationWarnings.length})
                </summary>
                <ul className="mt-2 list-disc list-inside space-y-1 text-orange-700 text-sm bg-orange-100 p-3 rounded-md">
                  {result.validationWarnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </div>
      )}

      {isActualError && !isDuplicate && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 rounded-r-lg">
          <div className="flex items-start">
            <svg className="h-5 w-5 text-red-500 mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <h4 className="text-lg font-semibold text-red-800 mb-2">Analysis Failed</h4>
              <p className="text-red-700 mb-3">{formatError(error ?? 'Unknown error')}</p>
              {error?.includes('backend_error') && (
                <div className="bg-red-100 p-3 rounded-md text-sm text-red-700 mb-3">
                  <strong>Backend Issue:</strong> We're experiencing connection problems. Please try again in a few minutes.
                </div>
              )}
              {error?.includes('timeout') && (
                <div className="bg-red-100 p-3 rounded-md text-sm text-red-700 mb-3">
                  <strong>Timeout:</strong> The analysis is taking longer than expected. You can try uploading a smaller image or wait a few minutes and try again.
                </div>
              )}
              {file && (
                <button
                  onClick={handleReprocessClick}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {data && (
        <>
          {dlNumber && (
            <div className="mb-4 text-center p-2 bg-gray-100 rounded-md">
              <span className="text-sm font-medium text-gray-600">DL Number: </span>
              <span className="font-bold text-neutral-dark tracking-wider">{dlNumber}</span>
              {associatedSystemName && (
                <p className="text-xs text-green-700">✓ Associated with: <span className="font-semibold">{associatedSystemName}</span></p>
              )}
            </div>
          )}
          {adoptionNeeded && dlNumber && (
            <AdoptionSection
              dlNumber={dlNumber}
              systems={registeredSystems}
              onAdopt={(systemId) => {
                if (recordId) {
                  onLinkRecord(recordId, systemId, dlNumber);
                }
              }}
              onRegisterNew={() => onRegisterNewSystem(dlNumber)}
              disabled={!recordId}
            />
          )}

          <ActionableInsights analysis={data} />

          <DeeperInsightsSection
            analysisData={data}
            systemId={associatedSystem?.id}
            systemName={associatedSystem?.name}
          />

          {weather && <WeatherSection weather={weather} />}

          <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">Core Vitals</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard title="Voltage" value={data.overallVoltage != null ? data.overallVoltage.toFixed(1) : null} unit="V" />
              <MetricCard title="Current" value={data.current != null ? data.current.toFixed(1) : null} unit="A" />
              {data.power != null && <MetricCard title="Power" value={data.power.toFixed(1)} unit="W" />}
              <MetricCard title="State of Charge" value={data.stateOfCharge != null ? data.stateOfCharge.toFixed(1) : null} unit="%" />
            </div>
          </div>

          <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">Capacity & Cycles</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(() => {
                const remainingCapacity = data.remainingCapacity;
                let fullCapacity = associatedSystem?.capacity;

                if (fullCapacity == null || fullCapacity <= 0) {
                  if (data.fullCapacity != null && data.fullCapacity > 0) {
                    fullCapacity = data.fullCapacity;
                  } else {
                    fullCapacity = null;
                  }
                }

                if (remainingCapacity != null || fullCapacity != null) {
                  const remainingStr = remainingCapacity != null ? remainingCapacity.toFixed(1) : '?';
                  const fullStr = fullCapacity != null ? fullCapacity.toFixed(1) : null;

                  const capacityValue = fullStr ? `${remainingStr} / ${fullStr}` : remainingStr;
                  return <MetricCard title="Capacity" value={capacityValue} unit="Ah" />;
                }
                return <div className="hidden md:block"></div>;
              })()}
              {data.cycleCount != null && <MetricCard title="Cycles" value={data.cycleCount} unit="" />}
            </div>
          </div>

          <div className="mb-8">
            <h4 className="text-xl font-semibold text-neutral-dark mb-4">System Status</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.status && <MetricCard title="Status" value={data.status} unit="" />}
              {data.chargeMosOn != null && <MetricCard title="Charge MOS" value={data.chargeMosOn ? 'ON' : 'OFF'} unit="" />}
              {data.dischargeMosOn != null && <MetricCard title="Discharge MOS" value={data.dischargeMosOn ? 'ON' : 'OFF'} unit="" />}
              {data.balanceOn != null && <MetricCard title="Balancing" value={data.balanceOn ? 'ON' : 'OFF'} unit="" />}
            </div>
          </div>

          {(data.temperature != null || data.mosTemperature != null || (data.temperatures && data.temperatures.length > 1)) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Temperatures</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.temperature != null && (
                  <MetricCard title="Battery Temp" value={data.temperature.toFixed(1)} unit="°C" cardClassName={tempStyles.card} valueClassName={tempStyles.value} />
                )}
                {data.mosTemperature != null && (
                  <MetricCard title="MOS Temp" value={data.mosTemperature.toFixed(1)} unit="°C" cardClassName={mosTempStyles.card} valueClassName={mosTempStyles.value} />
                )}
                {data.temperatures && data.temperatures.slice(1).map((temp, index) => (
                  <MetricCard key={index} title={`Sensor T${index + 2}`} value={temp.toFixed(1)} unit="°C" />
                ))}
              </div>
            </div>
          )}

          {(data.highestCellVoltage != null || data.lowestCellVoltage != null || data.cellVoltageDifference != null || data.averageCellVoltage != null) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Cell Health</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {data.highestCellVoltage != null && (
                  <MetricCard title="Highest Cell" value={data.highestCellVoltage.toFixed(3)} unit="V" />
                )}
                {data.lowestCellVoltage != null && (
                  <MetricCard title="Lowest Cell" value={data.lowestCellVoltage.toFixed(3)} unit="V" />
                )}
                {data.cellVoltageDifference != null && (
                  <MetricCard title="Difference" value={(data.cellVoltageDifference * 1000).toFixed(1)} unit="mV" cardClassName={diffStyles.card} valueClassName={diffStyles.value} />
                )}
                {data.averageCellVoltage != null && (
                  <MetricCard title="Average Cell" value={data.averageCellVoltage.toFixed(3)} unit="V" />
                )}
              </div>
            </div>
          )}

          {(data.serialNumber || data.softwareVersion || data.hardwareVersion || data.snCode) && (
            <div className="mb-8">
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Device Details</h4>
              <div className="p-4 bg-white rounded-lg shadow-md text-sm text-neutral-dark space-y-2">
                {data.serialNumber && <p><strong className="font-semibold text-gray-600">Serial Number:</strong> <span className="font-mono">{data.serialNumber}</span></p>}
                {data.softwareVersion && <p><strong className="font-semibold text-gray-600">Software Version:</strong> <span className="font-mono">{data.softwareVersion}</span></p>}
                {data.hardwareVersion && <p><strong className="font-semibold text-gray-600">Hardware Version:</strong> <span className="font-mono">{data.hardwareVersion}</span></p>}
                {data.snCode && <p><strong className="font-semibold text-gray-600">SN Code:</strong> <span className="font-mono">{data.snCode}</span></p>}
              </div>
            </div>
          )}

          {data.cellVoltages && data.cellVoltages.length > 0 && (
            <div>
              <h4 className="text-xl font-semibold text-neutral-dark mb-4">Cell Voltage Breakdown</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {data.cellVoltages.map((voltage, index) => (
                  <div key={index} className="bg-white p-3 rounded-md shadow-sm flex justify-between items-center text-sm">
                    <span className="font-medium text-gray-600">Cell {index + 1}:</span>
                    <span className="font-bold text-primary">{voltage.toFixed(3)} V</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AnalysisResult;

