import React from 'react';

export type CostLevel = 'low' | 'medium' | 'high';

export interface CostEstimate {
    level: CostLevel;
    label: string;
    estimatedTokens: number;
    estimatedCost: number;
    color: string;
}

/**
 * Gemini 2.5 Flash pricing (per million tokens)
 * Input: $0.075/1M, Output: $0.30/1M
 */
const INPUT_COST_PER_M = 0.075;
const OUTPUT_COST_PER_M = 0.30;

/**
 * Estimate cost for image analysis
 * - Image: ~258 tokens (Gemini's fixed rate)
 * - Prompt: ~2000 tokens
 * - Response: ~500 tokens
 */
export const estimateAnalysisCost = (fileCount: number): CostEstimate => {
    if (fileCount === 0) {
        return { level: 'low', label: 'Low', estimatedTokens: 0, estimatedCost: 0, color: 'bg-green-100 text-green-800' };
    }

    const TOKENS_PER_IMAGE = 258 + 2000; // image + prompt
    const OUTPUT_TOKENS_PER_IMAGE = 500;

    const totalInputTokens = fileCount * TOKENS_PER_IMAGE;
    const totalOutputTokens = fileCount * OUTPUT_TOKENS_PER_IMAGE;
    const totalTokens = totalInputTokens + totalOutputTokens;

    const estimatedCost = (totalInputTokens / 1_000_000) * INPUT_COST_PER_M +
        (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M;

    return categorizeEstimate(totalTokens, estimatedCost);
};

/**
 * Estimate cost for insights generation
 * Based on context window size and query complexity
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
    // Estimate data points based on context window if not provided
    // Assume ~24 data points per day (hourly aggregates)
    const estimatedDataPoints = dataPointCount || Math.min(contextWindowDays * 24, 2160); // Cap at 90 days hourly

    // Token estimates per turn:
    // - System prompt: ~3000 tokens
    // - Context data: ~10 tokens per data point (compressed)
    // - Tool calls: ~500 tokens per call
    // - Response: ~1000 tokens per turn

    const systemPromptTokens = 3000;
    const contextDataTokens = estimatedDataPoints * 10;
    const tokensPerToolCall = 500;
    const tokensPerResponse = 1000;

    // Estimate number of turns based on query type
    // Custom queries: up to 20 turns, standard: up to 10 turns
    const maxTurns = isCustomQuery ? 8 : 4; // Average turns, not max
    const avgToolCallsPerTurn = 1.5;

    const inputTokensPerTurn = systemPromptTokens + contextDataTokens + (tokensPerToolCall * avgToolCallsPerTurn);
    const outputTokensPerTurn = tokensPerResponse + (tokensPerToolCall * avgToolCallsPerTurn);

    // Total across all turns (input tokens accumulate due to conversation history)
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let turn = 1; turn <= maxTurns; turn++) {
        // Each turn adds to conversation history
        totalInputTokens += inputTokensPerTurn + (outputTokensPerTurn * (turn - 1));
        totalOutputTokens += outputTokensPerTurn;
    }

    const estimatedCost = (totalInputTokens / 1_000_000) * INPUT_COST_PER_M +
        (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_M;

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

interface CostEstimateBadgeProps {
    estimate: CostEstimate;
    showTokens?: boolean;
    showCost?: boolean;
    className?: string;
    size?: 'sm' | 'md';
}

/**
 * Reusable cost estimate badge component
 */
export const CostEstimateBadge: React.FC<CostEstimateBadgeProps> = ({
    estimate,
    showTokens = false,
    showCost = true,
    className = '',
    size = 'sm'
}) => {
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
