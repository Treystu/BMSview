// @ts-nocheck
/**
 * Update AI Feedback Status Endpoint
 * Allows admins to update feedback status with implementation tracking
 */

const { createLogger, createLoggerFromEvent, createTimer } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');
const {
  createStandardEntryMeta,
  logDebugRequestSummary
} = require('./utils/handler-logging.cjs');
const { createForwardingLogger } = require('./utils/log-forwarder.cjs');

exports.handler = async (event, context) => {
  const log = createLoggerFromEvent('update-feedback-status', event, context);
  const timer = createTimer(log, 'update-feedback-status-handler');
  const headers = getCorsHeaders(event);

  log.entry(createStandardEntryMeta(event));
  logDebugRequestSummary(log, event, { label: 'Update feedback status request', includeBody: true, bodyMaxStringLength: 20000 });

  // Unified logging: also forward to centralized collector
  const forwardLog = createForwardingLogger('update-feedback-status');

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    log.debug('OPTIONS preflight request');
    timer.end();
    log.exit(200);
    return { statusCode: 200, headers };
  }

  try {
    if (event.httpMethod !== 'POST') {
      log.warn('Method not allowed', { method: event.httpMethod });
      timer.end();
      log.exit(405);
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    const body = JSON.parse(event.body);
    const {
      feedbackId,
      status,
      adminNotes,
      // New implementation tracking fields
      actualEffortHours,
      actualBenefitScore,
      performanceImprovementPercent,
      userSatisfactionChange,
      implementationNotes,
      stabilityScore
    } = body;

    if (!feedbackId || !status) {
      timer.end({ success: false, error: 'missing_fields' });
      log.exit(400, { outcome: 'validation_error', fields: ['feedbackId', 'status'] });
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'feedbackId and status are required' })
      };
    }

    // Validate status
    const validStatuses = ['pending', 'reviewed', 'accepted', 'implemented', 'rejected'];
    if (!validStatuses.includes(status)) {
      timer.end({ success: false, error: 'invalid_status' });
      log.exit(400, { outcome: 'validation_error', field: 'status' });
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` })
      };
    }

    const feedbackCollection = await getCollection('ai_feedback');

    // Update feedback
    const updateData = {
      status,
      updatedAt: new Date()
    };

    if (adminNotes) {
      updateData.adminNotes = adminNotes;
    }

    if (status === 'implemented') {
      updateData.implementationDate = new Date();

      // Track implementation metrics with validation
      if (actualEffortHours !== undefined) {
        if (actualEffortHours < 0) {
          return {
            statusCode: 400,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'actualEffortHours must be non-negative' })
          };
        }
        updateData.actualEffortHours = actualEffortHours;
      }
      if (actualBenefitScore !== undefined) {
        updateData.actualBenefitScore = Math.min(100, Math.max(0, actualBenefitScore));
      }
      if (performanceImprovementPercent !== undefined) {
        updateData.performanceImprovementPercent = performanceImprovementPercent;
      }
      if (userSatisfactionChange !== undefined) {
        updateData.userSatisfactionChange = Math.min(100, Math.max(-100, userSatisfactionChange));
      }
      if (implementationNotes) {
        updateData.implementationNotes = implementationNotes;
      }
      if (stabilityScore !== undefined) {
        updateData.stabilityScore = Math.min(100, Math.max(0, stabilityScore));
      }

      // Calculate initial effectiveness score
      const effectivenessScore = calculateBasicEffectivenessScore(updateData);
      if (effectivenessScore !== null) {
        updateData.effectivenessScore = effectivenessScore;
      }
    }

    const result = await feedbackCollection.updateOne(
      { id: feedbackId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Feedback not found' })
      };
    }

    log.info('Feedback status updated', {
      feedbackId,
      status,
      hasImplementationMetrics: status === 'implemented' && (actualEffortHours !== undefined || actualBenefitScore !== undefined)
    });

    timer.end({ success: true });
    log.exit(200, { feedbackId, status });

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        feedbackId,
        status,
        effectivenessScore: updateData.effectivenessScore || null
      })
    };
  } catch (error) {
    log.error('Update feedback status error', { error: error.message });
    timer.end({ success: false, error: error.message });
    log.exit(500);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to update feedback status',
        message: error.message
      })
    };
  }
};

/**
 * Calculate basic effectiveness score based on available metrics
 */
function calculateBasicEffectivenessScore(updateData) {
  let totalScore = 0;
  let count = 0;

  // ROI/Benefit score
  if (updateData.actualBenefitScore !== undefined) {
    totalScore += updateData.actualBenefitScore;
    count++;
  }

  // Stability score
  if (updateData.stabilityScore !== undefined) {
    totalScore += updateData.stabilityScore;
    count++;
  }

  // Performance improvement (convert to 0-100 scale)
  if (updateData.performanceImprovementPercent !== undefined) {
    // Cap at 100, negative improvements score lower
    const perfScore = Math.min(100, Math.max(0, 50 + updateData.performanceImprovementPercent));
    totalScore += perfScore;
    count++;
  }

  // User satisfaction change (convert to 0-100 scale)
  if (updateData.userSatisfactionChange !== undefined) {
    const satScore = 50 + (updateData.userSatisfactionChange / 2);
    totalScore += Math.min(100, Math.max(0, satScore));
    count++;
  }

  return count > 0 ? Math.round(totalScore / count) : null;
}

// Export for testing
module.exports.calculateBasicEffectivenessScore = calculateBasicEffectivenessScore;
