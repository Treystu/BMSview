import React, { useState, useEffect } from 'react';

/**
 * Cost Estimation Badge Component
 * 
 * Estimates and displays the cost of AI operations based on token usage.
 * Pricing data is synchronized with official Google Gemini pricing:
 * https://ai.google.dev/gemini-api/docs/pricing
 * 
 * Updated: December 2025
 */

export type CostLevel = 'low' | 'medium' | 'high';

export interface CostEstimate {
    level: CostLevel;
    label: string;
    estimatedTokens: number;
    estimatedCost: number;
    color: string;
}

export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
    description?: string;
}

export interface ModelPricingResponse {
    currentModel: {
        model: string;
        pricing: ModelPricing;
    };
    allModels: Record<string, ModelPricing>;
    defaultModel: string;
}

// Default pricing (Gemini 2.5 Flash) - used as fallback
// Updated Dec 2025 to match official Google pricing
const DEFAULT_INPUT_COST_PER_M = 0.10;
const DEFAULT_OUTPUT_COST_PER_M = 0.40;

// Cached pricing from backend
let cachedPricing: ModelPricingResponse | null = null;
let pricingFetchPromise: Promise<ModelPricingResponse | null> | null = null;

/**
 * Fetch model pricing from backend
 * Caches result to avoid repeated requests
 */
export async function fetchModelPricing(): Promise<ModelPricingResponse | null> {
    if (cachedPricing) {
        return cachedPricing;
    }
    
    if (pricingFetchPromise) {
        return pricingFetchPromise;
    }
    
    pricingFetchPromise = (async () => {
        try {
            const response = await fetch('/.netlify/functions/model-pricing');
            if (response.ok) {
                cachedPricing = await response.json();
                return cachedPricing;
            }
        } catch (error) {
            console.warn('Failed to fetch model pricing, using defaults:', error);
        }
        return null;
    })();
    
    return pricingFetchPromise;
}

/**
 * Get current model pricing (sync version using cache)
 * Falls back to defaults if not yet fetched
 */
export function getCurrentPricing(): { inputCostPerM: number; outputCostPerM: number } {
    if (cachedPricing?.currentModel?.pricing) {
        return {
            inputCostPerM: cachedPricing.currentModel.pricing.inputPerMillion,
            outputCostPerM: cachedPricing.currentModel.pricing.outputPerMillion
        };
    }
    return {
        inputCostPerM: DEFAULT_INPUT_COST_PER_M,
        outputCostPerM: DEFAULT_OUTPUT_COST_PER_M
    };
}

// Analysis token estimates
const IMAGE_TOKENS = 258; // Gemini's fixed rate for images
const PROMPT_TOKENS = 2000;
const ANALYSIS_RESPONSE_TOKENS = 500;

// Insights estimation constants
const HOURS_PER_DAY = 24;
const MAX_HOURLY_DATA_POINTS = 2160; // 90 days * 24 hours
const SYSTEM_PROMPT_TOKENS = 3000;
const TOKENS_PER_DATA_POINT = 10;
const TOKENS_PER_TOOL_CALL = 500;
const TOKENS_PER_RESPONSE = 1000;

/**
 * Estimate cost for image analysis
 * - Image: ~258 tokens (Gemini's fixed rate)
 * - Prompt: ~2000 tokens
 * - Response: ~500 tokens
 * 
 * Note: Cost estimates are based on the currently configured model.
 * Call fetchModelPricing() to ensure estimates use the correct pricing.
 */
export const estimateAnalysisCost = (fileCount: number): CostEstimate => {
    if (fileCount === 0) {
        return { level: 'low', label: 'Low', estimatedTokens: 0, estimatedCost: 0, color: 'bg-green-100 text-green-800' };
    }

    const { inputCostPerM, outputCostPerM } = getCurrentPricing();
    
    const TOKENS_PER_IMAGE = IMAGE_TOKENS + PROMPT_TOKENS;
    const OUTPUT_TOKENS_PER_IMAGE = ANALYSIS_RESPONSE_TOKENS;

    const totalInputTokens = fileCount * TOKENS_PER_IMAGE;
    const totalOutputTokens = fileCount * OUTPUT_TOKENS_PER_IMAGE;
    const totalTokens = totalInputTokens + totalOutputTokens;

    const estimatedCost = (totalInputTokens / 1_000_000) * inputCostPerM +
        (totalOutputTokens / 1_000_000) * outputCostPerM;

    return categorizeEstimate(totalTokens, estimatedCost);
};

/**
 * Estimate cost for insights generation
 * Based on context window size and query complexity
 * 
 * Note: Cost estimates are based on the currently configured model.
 * Call fetchModelPricing() to ensure estimates use the correct pricing.
 * 
 * @param contextWindowDays - Number of days of historical data
 * @param isCustomQuery - Whether this is a custom query (more turns)
 * @param dataPointCount - Approximate number of data points (if known)
 */
export const estimateInsightsCost = (
    contextWindowDays: number = 30,
    isCustomQuery: boolean = false,
    dataPointCount?: number
): CostEstimate => {
    const { inputCostPerM, outputCostPerM } = getCurrentPricing();
    
    // Estimate data points based on context window if not provided
    const estimatedDataPoints = dataPointCount || Math.min(contextWindowDays * HOURS_PER_DAY, MAX_HOURLY_DATA_POINTS);

    // Calculate token estimates
    const contextDataTokens = estimatedDataPoints * TOKENS_PER_DATA_POINT;

    // Estimate number of turns based on query type
    // Custom queries: up to 20 turns, standard: up to 10 turns
    const maxTurns = isCustomQuery ? 8 : 4; // Average turns, not max
    const avgToolCallsPerTurn = 1.5;

    const inputTokensPerTurn = SYSTEM_PROMPT_TOKENS + contextDataTokens + (TOKENS_PER_TOOL_CALL * avgToolCallsPerTurn);
    const outputTokensPerTurn = TOKENS_PER_RESPONSE + (TOKENS_PER_TOOL_CALL * avgToolCallsPerTurn);

    // Total across all turns (input tokens accumulate due to conversation history)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let turn = 1; turn <= maxTurns; turn++) {
        // Each turn adds to conversation history
        totalInputTokens += inputTokensPerTurn + (outputTokensPerTurn * (turn - 1));
        totalOutputTokens += outputTokensPerTurn;
    }

    const estimatedCost = (totalInputTokens / 1_000_000) * inputCostPerM +
        (totalOutputTokens / 1_000_000) * outputCostPerM;

    return categorizeEstimate(totalInputTokens + totalOutputTokens, estimatedCost);
};

/**
 * Categorize cost estimate into low/medium/high
 */
function categorizeEstimate(totalTokens: number, estimatedCost: number): CostEstimate {
    // Cost thresholds
    if (estimatedCost < 0.01) {
        return { level: 'low', label: 'Low', estimatedTokens: totalTokens, estimatedCost, color: 'bg-green-100 text-green-800' };
    } else if (estimatedCost < 0.05) {
        return { level: 'medium', label: 'Medium', estimatedTokens: totalTokens, estimatedCost, color: 'bg-yellow-100 text-yellow-800' };
    } else {
        return { level: 'high', label: 'High', estimatedTokens: totalTokens, estimatedCost, color: 'bg-red-100 text-red-800' };
    }
}

/**
 * Format token count for display
 */
export const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`;
    return tokens.toString();
};

/**
 * Hook to fetch model pricing on component mount
 * Returns the current model name for display
 */
export function useModelPricing(): { currentModel: string | null; isLoading: boolean } {
    const [currentModel, setCurrentModel] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    
    useEffect(() => {
        fetchModelPricing()
            .then((pricing) => {
                if (pricing?.currentModel?.model) {
                    setCurrentModel(pricing.currentModel.model);
                }
            })
            .finally(() => setIsLoading(false));
    }, []);
    
    return { currentModel, isLoading };
}

interface CostEstimateBadgeProps {
    estimate: CostEstimate;
    showTokens?: boolean;
    showCost?: boolean;
    className?: string;
    size?: 'sm' | 'md';
}

/**
 * Reusable cost estimate badge component
 * Automatically fetches model pricing from backend on first render
 */
export const CostEstimateBadge: React.FC<CostEstimateBadgeProps> = ({
    estimate,
    showTokens = false,
    showCost = true,
    className = '',
    size = 'sm'
}) => {
    // Fetch pricing on mount (updates cache for subsequent estimates)
    // Fire-and-forget pattern - errors are handled inside fetchModelPricing
    useEffect(() => {
        void fetchModelPricing();
    }, []);
    
    const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

    return (
        <span className={`inline-flex items-center gap-1 rounded-full font-medium ${estimate.color} ${sizeClasses} ${className}`}>
            <span>Est. Cost: {estimate.label}</span>
            {showCost && estimate.estimatedCost > 0 && (
                <span className="opacity-75">(~${estimate.estimatedCost.toFixed(4)})</span>
            )}
            {showTokens && estimate.estimatedTokens > 0 && (
                <span className="opacity-75">• {formatTokens(estimate.estimatedTokens)} tokens</span>
            )}
        </span>
    );
};

export default CostEstimateBadge;
