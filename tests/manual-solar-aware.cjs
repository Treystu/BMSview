
const { analyzeSolarAwareLoads } = require('../netlify/functions/utils/solar-aware-load-analysis.cjs');

// Mock logger
const log = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: () => { }
};

// Mock system - Using California (-118 Longitude) to test Timezone Logic
const system = {
    id: 'test-system',
    voltage: 48,
    maxAmpsSolarCharging: 30, // Increased to 30A to account for latitude tilt (34 deg N) reducing efficiency
    latitude: 34,
    longitude: -118 // California (PST, UTC-8)
};

// Mock records (simplified)
const records = [];
const startDate = new Date('2025-03-21T00:00:00Z');

// Generate 48 hours of data
for (let i = 0; i < 48; i++) {
    const timestamp = new Date(startDate.getTime() + i * 3600000);
    const utcHour = timestamp.getUTCHours();

    // Solar Noon in CA is ~20:00 UTC (12:00 PST)
    // Sun is up roughly 14:00 UTC to 02:00 UTC (6am to 6pm PST)
    const localHour = (utcHour - 8 + 24) % 24;
    const isDay = localHour >= 6 && localHour < 18;

    // Simulate load: 5A constant
    const loadAmps = 5;

    // Simulate solar generation: Bell curve peaking at Local Noon (12:00)
    let solarAmps = 0;
    if (isDay) {
        solarAmps = 20 * Math.sin(Math.PI * (localHour - 6) / 12);
    }

    // Observed current = Solar - Load
    const observedCurrent = solarAmps - loadAmps;

    records.push({
        timestamp: timestamp.toISOString(),
        analysis: {
            current: observedCurrent,
            power: observedCurrent * 48,
            stateOfCharge: 50 + i, // Dummy SOC
            remainingCapacity: 100 + i // Dummy Ah
        },
        weather: {
            clouds: 0 // Clear sky
        }
    });
}

async function runTest() {
    console.log('Running Solar-Aware Load Analysis Test...');

    const result = await analyzeSolarAwareLoads('test-system', system, records, log);

    console.log('Analysis Result:', JSON.stringify(result, null, 2));

    // Verification
    const dayProfile = result.hourlyProfile.find(h => h.hour === 12); // Noon
    const nightProfile = result.hourlyProfile.find(h => h.hour === 2); // 2 AM

    console.log('\nVerification:');
    console.log(`Noon (Hour 12) - True Load: ${dayProfile.trueLoadAmps}A (Expected ~5A)`);
    console.log(`Night (Hour 2) - True Load: ${nightProfile.trueLoadAmps}A (Expected ~5A)`);

    if (Math.abs(dayProfile.trueLoadAmps - 5) < 1 && Math.abs(nightProfile.trueLoadAmps - 5) < 1) {
        console.log('✅ SUCCESS: True load correctly inferred during both day and night.');
    } else {
        console.error('❌ FAILURE: Load inference incorrect.');
    }
}

runTest();
