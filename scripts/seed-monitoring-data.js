#!/usr/bin/env node

/**
 * Seed Monitoring Data Script
 * 
 * This script seeds the monitoring collections with sample data for testing.
 * Run with: node scripts/seed-monitoring-data.js
 */

const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || 'bmsview';

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set');
  process.exit(1);
}

/**
 * Generate sample AI operations
 */
function generateSampleOperations(count = 100) {
  const operations = [];
  const now = Date.now();
  const models = ['gemini-2.5-flash', 'gemini-1.5-pro'];
  const operationTypes = ['analysis', 'insights', 'feedbackGeneration'];
  const systemIds = ['system-1', 'system-2', 'system-3', null];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000); // Last 7 days
    const operation = operationTypes[Math.floor(Math.random() * operationTypes.length)];
    const model = models[Math.floor(Math.random() * models.length)];
    const success = Math.random() > 0.05; // 95% success rate
    const duration = success 
      ? 1000 + Math.random() * 5000  // 1-6 seconds for success
      : 500 + Math.random() * 2000;  // 0.5-2.5 seconds for failures
    
    const inputTokens = Math.floor(500 + Math.random() * 2000);
    const outputTokens = Math.floor(200 + Math.random() * 1000);
    const tokensUsed = inputTokens + outputTokens;

    // Calculate cost based on model
    const pricing = model === 'gemini-1.5-pro' 
      ? { input: 1.25 / 1000000, output: 5.00 / 1000000 }
      : { input: 0.075 / 1000000, output: 0.30 / 1000000 };
    
    const cost = (inputTokens * pricing.input) + (outputTokens * pricing.output);

    operations.push({
      id: uuidv4(),
      timestamp: timestamp.toISOString(),
      operation,
      systemId: systemIds[Math.floor(Math.random() * systemIds.length)],
      duration: Math.round(duration),
      tokensUsed,
      inputTokens,
      outputTokens,
      cost: parseFloat(cost.toFixed(6)),
      success,
      error: success ? null : 'Sample error: API timeout',
      model,
      contextWindowDays: [7, 14, 30, 90][Math.floor(Math.random() * 4)],
      metadata: {
        sample: true,
        generatedAt: new Date().toISOString()
      }
    });
  }

  return operations;
}

/**
 * Generate sample alerts
 */
function generateSampleAlerts(count = 10) {
  const alerts = [];
  const now = Date.now();
  const severities = ['low', 'medium', 'high', 'critical'];
  const types = ['cost_spike', 'error_rate', 'latency', 'accuracy_drop'];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now - Math.random() * 3 * 24 * 60 * 60 * 1000); // Last 3 days
    const severity = severities[Math.floor(Math.random() * severities.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const resolved = Math.random() > 0.4; // 60% resolved

    alerts.push({
      id: uuidv4(),
      timestamp: timestamp.toISOString(),
      severity,
      type,
      message: `Sample ${type} alert - ${severity} severity`,
      metadata: {
        threshold: 100,
        actual: 150,
        sample: true
      },
      resolved,
      resolvedAt: resolved ? new Date(timestamp.getTime() + Math.random() * 2 * 60 * 60 * 1000).toISOString() : null
    });
  }

  return alerts;
}

/**
 * Generate sample feedback tracking
 */
function generateSampleFeedback(count = 20) {
  const feedback = [];
  const now = Date.now();
  const statuses = ['pending', 'implemented', 'rejected', 'expired'];

  for (let i = 0; i < count; i++) {
    const suggestedAt = new Date(now - Math.random() * 14 * 24 * 60 * 60 * 1000); // Last 14 days
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    const item = {
      id: uuidv4(),
      feedbackId: `feedback-${uuidv4().slice(0, 8)}`,
      suggestedAt: suggestedAt.toISOString(),
      status,
      metadata: { sample: true }
    };

    if (status === 'implemented') {
      item.implementedAt = new Date(suggestedAt.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
      item.effectiveness = Math.floor(60 + Math.random() * 40); // 60-100
      item.implementationType = 'code_change';
      item.implementationNotes = 'Sample implementation notes';
    } else if (status === 'rejected') {
      item.implementationNotes = 'Sample rejection reason';
    }

    feedback.push(item);
  }

  return feedback;
}

/**
 * Generate sample metrics
 */
function generateSampleMetrics(count = 50) {
  const metrics = [];
  const now = Date.now();
  const metricTypes = ['accuracy', 'implementation_rate', 'performance', 'cost'];
  const systemIds = ['system-1', 'system-2', 'system-3', null];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000);
    const metricType = metricTypes[Math.floor(Math.random() * metricTypes.length)];

    metrics.push({
      id: uuidv4(),
      timestamp: timestamp.toISOString(),
      systemId: systemIds[Math.floor(Math.random() * systemIds.length)],
      metricType,
      metricName: `${metricType}_metric`,
      value: Math.random() * 100,
      unit: metricType === 'cost' ? 'usd' : 'percent',
      metadata: {
        sample: true
      }
    });
  }

  return metrics;
}

/**
 * Main seeding function
 */
async function seedData() {
  console.log('🌱 Starting monitoring data seeding...\n');

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Clear existing sample data
    console.log('\n🧹 Clearing existing sample data...');
    await db.collection('ai_operations').deleteMany({ 'metadata.sample': true });
    await db.collection('anomaly_alerts').deleteMany({ 'metadata.sample': true });
    await db.collection('feedback_tracking').deleteMany({ 'metadata.sample': true });
    await db.collection('ai_metrics').deleteMany({ 'metadata.sample': true });

    // Seed AI operations
    console.log('\n📊 Seeding AI operations...');
    const operations = generateSampleOperations(100);
    await db.collection('ai_operations').insertMany(operations);
    console.log(`   ✅ Inserted ${operations.length} operations`);

    // Seed alerts
    console.log('\n🚨 Seeding alerts...');
    const alerts = generateSampleAlerts(10);
    await db.collection('anomaly_alerts').insertMany(alerts);
    console.log(`   ✅ Inserted ${alerts.length} alerts`);

    // Seed feedback tracking
    console.log('\n💬 Seeding feedback tracking...');
    const feedback = generateSampleFeedback(20);
    await db.collection('feedback_tracking').insertMany(feedback);
    console.log(`   ✅ Inserted ${feedback.length} feedback items`);

    // Seed metrics
    console.log('\n📈 Seeding metrics...');
    const metrics = generateSampleMetrics(50);
    await db.collection('ai_metrics').insertMany(metrics);
    console.log(`   ✅ Inserted ${metrics.length} metrics`);

    // Summary
    console.log('\n📝 Summary:');
    console.log(`   Operations: ${operations.length}`);
    console.log(`   Alerts: ${alerts.length}`);
    console.log(`   Feedback: ${feedback.length}`);
    console.log(`   Metrics: ${metrics.length}`);

    // Calculate some stats
    const totalCost = operations.reduce((sum, op) => sum + op.cost, 0);
    const successRate = operations.filter(op => op.success).length / operations.length;
    const avgDuration = operations.reduce((sum, op) => sum + op.duration, 0) / operations.length;

    console.log('\n📊 Sample Data Stats:');
    console.log(`   Total Cost: $${totalCost.toFixed(4)}`);
    console.log(`   Success Rate: ${(successRate * 100).toFixed(1)}%`);
    console.log(`   Avg Duration: ${Math.round(avgDuration)}ms`);

    console.log('\n✅ Seeding completed successfully!');
    console.log('\n💡 You can now view the monitoring dashboard with sample data.');
    console.log('   Navigate to: /.netlify/functions/monitoring?type=dashboard');

  } catch (error) {
    console.error('\n❌ Error seeding data:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run seeding
seedData().catch(console.error);
