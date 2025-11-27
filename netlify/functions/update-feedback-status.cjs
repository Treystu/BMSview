// @ts-nocheck
/**
 * Update AI Feedback Status Endpoint
 * Allows admins to update feedback status
 */

const { createLogger } = require('./utils/logger.cjs');
const { getCollection } = require('./utils/mongodb.cjs');
const { getCorsHeaders } = require('./utils/cors.cjs');

exports.handler = async (event, context) => {
  const log = createLogger('update-feedback-status', context);
  const headers = getCorsHeaders(event);
  
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }
  
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    const body = JSON.parse(event.body);
    const { feedbackId, status, adminNotes } = body;
    
    if (!feedbackId || !status) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'feedbackId and status are required' })
      };
    }
    
    // Validate status
    const validStatuses = ['pending', 'reviewed', 'accepted', 'implemented', 'rejected'];
    if (!validStatuses.includes(status)) {
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
    
    log.info('Feedback status updated', { feedbackId, status });
    
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        feedbackId,
        status
      })
    };
  } catch (error) {
    log.error('Update feedback status error', { error: error.message });
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
