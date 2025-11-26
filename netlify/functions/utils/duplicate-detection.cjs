// @ts-nocheck
/**
 * Enhanced Duplicate Detection for AI Feedback
 * Uses both content hashing and semantic similarity
 */

const { createLogger } = require('./logger.cjs');
const crypto = require('crypto');

/**
 * Calculate content hash (exact match)
 */
function calculateContentHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Calculate simple similarity score between two strings
 * Returns value between 0 (completely different) and 1 (identical)
 */
function calculateSimilarity(str1, str2) {
  // Normalize strings
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Calculate Jaccard similarity using word sets
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Check if feedback is semantically similar to existing items
 */
async function findSimilarFeedback(newFeedback, existingFeedback, options = {}) {
  const log = createLogger('duplicate-detection:similarity');
  const threshold = options.similarityThreshold || 0.7; // 70% similarity
  
  const similarItems = [];
  
  for (const existing of existingFeedback) {
    // Skip if already marked as rejected or implemented
    if (existing.status === 'rejected' || existing.status === 'implemented') {
      continue;
    }
    
    // Calculate similarity scores for key fields
    const titleSimilarity = calculateSimilarity(
      newFeedback.suggestion.title,
      existing.suggestion.title
    );
    
    const descriptionSimilarity = calculateSimilarity(
      newFeedback.suggestion.description,
      existing.suggestion.description
    );
    
    const rationaleSimilarity = calculateSimilarity(
      newFeedback.suggestion.rationale,
      existing.suggestion.rationale
    );
    
    // Weight the similarities (title is most important)
    const overallSimilarity = (
      titleSimilarity * 0.5 +
      descriptionSimilarity * 0.3 +
      rationaleSimilarity * 0.2
    );
    
    if (overallSimilarity >= threshold) {
      similarItems.push({
        feedbackId: existing.id,
        similarity: Math.round(overallSimilarity * 100) / 100,
        titleSimilarity: Math.round(titleSimilarity * 100) / 100,
        descriptionSimilarity: Math.round(descriptionSimilarity * 100) / 100,
        rationaleSimilarity: Math.round(rationaleSimilarity * 100) / 100,
        existing: {
          title: existing.suggestion.title,
          status: existing.status,
          priority: existing.priority,
          created: existing.timestamp
        }
      });
    }
  }
  
  // Sort by similarity (highest first)
  similarItems.sort((a, b) => b.similarity - a.similarity);
  
  log.info('Similarity check completed', {
    newTitle: newFeedback.suggestion.title,
    similarCount: similarItems.length,
    threshold
  });
  
  return similarItems;
}

/**
 * Comprehensive duplicate detection
 */
async function detectDuplicates(newFeedback, feedbackCollection, options = {}) {
  const log = createLogger('duplicate-detection');
  
  try {
    // 1. Exact hash match (fastest)
    const contentHash = calculateContentHash(newFeedback.suggestion);
    
    const exactMatch = await feedbackCollection.findOne({
      contextHash: contentHash,
      status: { $in: ['pending', 'reviewed', 'accepted'] }
    });
    
    if (exactMatch) {
      log.info('Exact duplicate found', {
        existingId: exactMatch.id,
        matchType: 'exact'
      });
      return {
        isDuplicate: true,
        matchType: 'exact',
        existingId: exactMatch.id,
        similarity: 1.0,
        similarItems: []
      };
    }
    
    // 2. Semantic similarity check (more thorough)
    const recentFeedback = await feedbackCollection
      .find({
        systemId: newFeedback.systemId,
        status: { $nin: ['rejected'] }
      })
      .limit(100) // Check last 100 items for performance
      .toArray();
    
    const similarItems = await findSimilarFeedback(newFeedback, recentFeedback, options);
    
    if (similarItems.length > 0 && similarItems[0].similarity >= 0.9) {
      // Very high similarity (>90%) - likely duplicate
      log.info('High similarity duplicate found', {
        existingId: similarItems[0].feedbackId,
        similarity: similarItems[0].similarity
      });
      return {
        isDuplicate: true,
        matchType: 'similar',
        existingId: similarItems[0].feedbackId,
        similarity: similarItems[0].similarity,
        similarItems: similarItems.slice(0, 5) // Top 5 similar items
      };
    }
    
    // No duplicate, but return similar items for reference
    return {
      isDuplicate: false,
      matchType: 'none',
      existingId: null,
      similarity: 0,
      similarItems: similarItems.slice(0, 5)
    };
  } catch (error) {
    log.error('Duplicate detection failed', { error: error.message });
    // On error, don't block submission - return not duplicate
    return {
      isDuplicate: false,
      matchType: 'error',
      error: error.message,
      similarItems: []
    };
  }
}

module.exports = {
  calculateContentHash,
  calculateSimilarity,
  findSimilarFeedback,
  detectDuplicates
};
