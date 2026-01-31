/**
 * Refresh Routes - Background data refresh with SSE
 * Includes timestamp auto-fix during validation
 */

const express = require('express');
const {
  getAllRecords,
  getRecordsMissingWeather,
  updateRecord,
  reloadData,
  repairAllData
} = require('../services/csv-store');
const { validateAndRepairAllWithTimestamps } = require('../services/data-validator');
const { getWeather, getSolarOnly } = require('../services/weather');
const { getSettings } = require('../services/settings');

const router = express.Router();

// Store for active SSE connections
const sseClients = new Set();

// Broadcast to all SSE clients
function broadcastSSE(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

// Refresh state
let refreshInProgress = false;
let refreshAborted = false;

// GET /api/refresh-stream - SSE endpoint
router.get('/refresh-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  sseClients.add(res);
  console.log(`[Refresh] SSE client connected. Total: ${sseClients.size}`);

  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
    console.log(`[Refresh] SSE client disconnected. Total: ${sseClients.size}`);
  });
});

// POST /api/refresh-start - Start background refresh
router.post('/refresh-start', async (req, res) => {
  if (refreshInProgress) {
    return res.json({ success: false, message: 'Refresh already in progress' });
  }

  refreshInProgress = true;
  refreshAborted = false;

  res.json({ success: true, message: 'Refresh started' });

  // Run in background
  runBackgroundRefresh().finally(() => {
    refreshInProgress = false;
  });
});

// POST /api/refresh-abort - Abort refresh
router.post('/refresh-abort', (req, res) => {
  if (!refreshInProgress) {
    return res.json({ success: false, message: 'No refresh in progress' });
  }
  refreshAborted = true;
  res.json({ success: true, message: 'Refresh abort requested' });
});

// GET /api/refresh-status - Get refresh status
router.get('/refresh-status', (req, res) => {
  res.json({ inProgress: refreshInProgress });
});

// POST /api/backfill-weather - Backfill missing weather data
router.post('/backfill-weather', async (req, res) => {
  console.log('[Refresh] Backfill weather request');

  try {
    const settings = getSettings();

    if (!settings.latitude || !settings.longitude) {
      return res.status(400).json({
        error: 'Location not configured. Please set latitude/longitude in Settings.'
      });
    }

    const recordsToUpdate = getRecordsMissingWeather();
    console.log(`[Refresh] Found ${recordsToUpdate.length} records missing weather/solar`);

    if (recordsToUpdate.length === 0) {
      return res.json({
        success: true,
        message: 'All records already have weather/solar data',
        updated: 0
      });
    }

    let successCount = 0;
    let errorCount = 0;

    for (const record of recordsToUpdate) {
      try {
        const timestamp = record.timestampFromFilename || record.timestamp;

        // Parse timestamp - handle both formats
        let effectiveTime;
        if (timestamp && !timestamp.endsWith('Z') && timestamp.includes('T')) {
          // Local time format from TimeAuthority
          const [datePart, timePart] = timestamp.split('T');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, min, sec] = timePart.split(':').map(Number);
          effectiveTime = new Date(year, month - 1, day, hour, min, sec);
        } else {
          effectiveTime = timestamp ? new Date(timestamp) : new Date();
        }

        let weather = null;
        if (settings.weatherApiKey) {
          weather = await getWeather(settings.latitude, settings.longitude, settings.weatherApiKey, effectiveTime);
        } else {
          weather = await getSolarOnly(settings.latitude, settings.longitude, effectiveTime);
        }

        if (weather) {
          updateRecord(record.id, {
            weather_temp: weather.temp ?? null,
            weather_clouds: weather.clouds ?? null,
            weather_uvi: weather.uvi ?? null,
            weather_condition: weather.weather_main ?? null,
            solar_ghi: weather.solar_ghi ?? null,
            solar_dni: weather.solar_dni ?? null,
            solar_dhi: weather.solar_dhi ?? null,
            solar_direct: weather.solar_direct ?? null
          });
          successCount++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        console.warn(`[Refresh] Weather fetch failed for ${record.id}:`, err.message);
        errorCount++;
      }
    }

    res.json({
      success: true,
      message: 'Backfill complete',
      total: recordsToUpdate.length,
      updated: successCount,
      errors: errorCount
    });

  } catch (error) {
    console.error('[Refresh] Backfill error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Background refresh function
async function runBackgroundRefresh() {
  const settings = getSettings();
  const phases = [];
  let allRecords = [];

  try {
    // Phase 1: Validate, Repair, and Fix Timestamps
    broadcastSSE('phase', { phase: 'migration', status: 'running', message: 'Validating and repairing data (including timestamps)...' });

    const repairResult = repairAllData((phase, current, total, message) => {
      broadcastSSE('progress', { phase: 'migration', current, total, message });
    });

    if (repairResult.repaired > 0) {
      broadcastSSE('phase', {
        phase: 'migration',
        status: 'complete',
        message: `Repaired ${repairResult.repaired} of ${repairResult.total} records`
      });
      phases.push({
        phase: 'migration',
        success: true,
        total: repairResult.total,
        repaired: repairResult.repaired,
        valid: repairResult.valid
      });
    } else {
      broadcastSSE('phase', {
        phase: 'migration',
        status: 'complete',
        message: `All ${repairResult.total} records valid`
      });
      phases.push({ phase: 'migration', success: true, skipped: true, total: repairResult.total });
    }

    if (refreshAborted) {
      broadcastSSE('complete', { success: false, aborted: true, phases });
      return;
    }

    // Phase 2: Reload and send to UI
    broadcastSSE('phase', { phase: 'reload', status: 'running', message: 'Reloading data...' });
    reloadData();
    allRecords = getAllRecords();
    broadcastSSE('phase', { phase: 'reload', status: 'complete', message: `Loaded ${allRecords.length} records` });
    phases.push({ phase: 'reload', success: true, count: allRecords.length });

    broadcastSSE('records', { records: allRecords });

    if (refreshAborted) {
      broadcastSSE('complete', { success: false, aborted: true, phases });
      return;
    }

    // Phase 3: Weather/Solar backfill
    if (settings.latitude && settings.longitude) {
      const recordsNeedingWeather = getRecordsMissingWeather();

      if (recordsNeedingWeather.length > 0) {
        broadcastSSE('phase', {
          phase: 'weather',
          status: 'running',
          message: `Fetching weather for ${recordsNeedingWeather.length} records...`,
          total: recordsNeedingWeather.length
        });

        let updated = 0;
        let errors = 0;

        for (let i = 0; i < recordsNeedingWeather.length; i++) {
          if (refreshAborted) break;

          const record = recordsNeedingWeather[i];

          try {
            const timestamp = record.timestampFromFilename || record.timestamp;

            // Parse timestamp
            let effectiveTime;
            if (timestamp && !timestamp.endsWith('Z') && timestamp.includes('T')) {
              const [datePart, timePart] = timestamp.split('T');
              const [year, month, day] = datePart.split('-').map(Number);
              const [hour, min, sec] = timePart.split(':').map(Number);
              effectiveTime = new Date(year, month - 1, day, hour, min, sec);
            } else {
              effectiveTime = timestamp ? new Date(timestamp) : new Date();
            }

            let weather = null;
            if (settings.weatherApiKey) {
              weather = await getWeather(settings.latitude, settings.longitude, settings.weatherApiKey, effectiveTime);
            } else {
              weather = await getSolarOnly(settings.latitude, settings.longitude, effectiveTime);
            }

            if (weather) {
              const updates = {
                weather_temp: weather.temp ?? null,
                weather_clouds: weather.clouds ?? null,
                weather_uvi: weather.uvi ?? null,
                weather_condition: weather.weather_main ?? null,
                solar_ghi: weather.solar_ghi ?? null,
                solar_dni: weather.solar_dni ?? null,
                solar_dhi: weather.solar_dhi ?? null,
                solar_direct: weather.solar_direct ?? null
              };

              updateRecord(record.id, updates);
              updated++;

              const updatedRecord = { ...record, ...updates };
              broadcastSSE('record-update', { record: updatedRecord });
            }
          } catch (err) {
            errors++;
            console.warn(`[Refresh] Weather failed for ${record.id}: ${err.message}`);
          }

          broadcastSSE('progress', {
            phase: 'weather',
            current: i + 1,
            total: recordsNeedingWeather.length,
            message: `Processing ${i + 1}/${recordsNeedingWeather.length}`,
            updated,
            errors
          });

          await new Promise(resolve => setTimeout(resolve, 30));
        }

        broadcastSSE('phase', {
          phase: 'weather',
          status: refreshAborted ? 'aborted' : 'complete',
          message: `Updated ${updated} records, ${errors} errors`,
          updated,
          errors
        });
        phases.push({ phase: 'weather', success: true, updated, errors });
      } else {
        broadcastSSE('phase', { phase: 'weather', status: 'skipped', message: 'All records have weather data' });
        phases.push({ phase: 'weather', success: true, skipped: true });
      }
    } else {
      broadcastSSE('phase', { phase: 'weather', status: 'skipped', message: 'Location not configured' });
      phases.push({ phase: 'weather', success: true, skipped: true, reason: 'no_location' });
    }

    // Complete
    const summary = {
      totalRecords: allRecords.length,
      repaired: phases.find(p => p.phase === 'migration')?.repaired || 0,
      weatherUpdated: phases.find(p => p.phase === 'weather')?.updated || 0
    };

    broadcastSSE('complete', {
      success: !refreshAborted,
      aborted: refreshAborted,
      phases,
      summary,
      message: refreshAborted ? 'Refresh aborted' : 'Refresh complete'
    });

  } catch (error) {
    console.error('[Refresh] Error:', error.message);
    broadcastSSE('error', { error: error.message, phases });
  }
}

module.exports = router;
