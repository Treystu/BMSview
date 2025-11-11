// Shim to provide generateInsightsWithTools for legacy require('./utils/insights-tools.cjs') path.
// Updated to use generate-insights.cjs (the unified insights generation file)
module.exports = require('../generate-insights.cjs');
