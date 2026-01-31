#!/usr/bin/env node
/**
 * BMS Analyzer Local - Entry Point
 *
 * Simplified local BMS screenshot analyzer
 * Extracts battery data from screenshots using Gemini AI and stores in CSV
 *
 * ZERO-TOLERANCE TIMESTAMP POLICY:
 * - Timestamps are extracted ONLY from filenames via TimeAuthority
 * - Files without valid timestamps are REJECTED
 * - No fallbacks, no guessing, no AI hallucination
 */

const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = require('./app');
const { DEFAULT_MODEL } = require('./services/analyzer');

const PORT = process.env.PORT || 3847;

// Start server
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  BMS Analyzer Local v2.0                     ║
║          Zero-Tolerance Timestamp Policy Edition             ║
╠══════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                   ║
║                                                              ║
║  Features:                                                   ║
║  • Upload BMS screenshots or ZIP files                       ║
║  • STRICT timestamp extraction from filenames                ║
║  • Model selection with cost estimation                      ║
║  • Automatic duplicate detection (hash-based)                ║
║  • Weather data enrichment                                   ║
║  • CSV output with all extracted fields                      ║
║                                                              ║
║  Filename Format Required:                                   ║
║    Screenshot_YYYYMMDD-HHMMSS.png                            ║
║    Example: Screenshot_20260126-130950.png                   ║
║                                                              ║
║  Default model: ${DEFAULT_MODEL.padEnd(24)}            ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Try to open browser (only in development, not in pkg)
  if (!process.pkg) {
    try {
      const open = (await import('open')).default;
      await open(`http://localhost:${PORT}`);
    } catch (e) {
      // Ignore if open fails
    }
  }
});
