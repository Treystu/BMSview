
const { analyzeSolarAwareLoads } = require('./netlify/functions/utils/solar-aware-load-analysis.cjs');

// Mock logger
const log = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: () => { }
};

// Mock system - Using Equator/Prime Meridian for simple 6am-6pm sun
const system = {
    id: 'test-system',
    voltage: 48,
    maxAmpsSolarCharging: 23, // Tuned to match simulated 20A peak (20 / 0.86 efficiency)
    latitude: 0,
    longitude: 0
};

// Mock records (simplified)
const records = [];
const startDate = new Date('2025-03-21T00:00:00Z'); // Equinox for perfect 12h day// Generate 48 hours of data
for (let i = 0; i < 48; i++) {
    const timestamp = new Date(startDate.getTime() + i * 3600000);
    const hour = timestamp.getUTCHours();

    // Simulate solar day (6am to 6pm)
    const isDay = hour >= 6 && hour < 18;

    // Simulate load: 5A constant
    const loadAmps = 5;

    // Simulate solar generation: Bell curve peaking at noon
    let solarAmps = 0;
    if (isDay) {
        solarAmps = 20 * Math.sin(Math.PI * (hour - 6) / 12);
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
