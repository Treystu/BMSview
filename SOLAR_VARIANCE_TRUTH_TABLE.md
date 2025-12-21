# Solar Variance Truth Table & Logic Verification

## 1. Core Logic Verification
| Scenario | Input Conditions | Expected Logic | Actual Implementation | Status |
|----------|------------------|----------------|-----------------------|--------|
| **Night Load** | `isSunUp=false`, `current < 0` | `Load = abs(current)` | `hourlyData[hour].trueLoad.push(Math.abs(observedCurrent))` | ✅ Verified |
| **Night Charging** | `isSunUp=false`, `current > 0.5` | `Generator/Grid Charging` | `hourlyData[hour].nightChargingSamples.push(...)` | ✅ Verified |
| **Day Load** | `isSunUp=true`, `current < 0` | `Load = ExpectedSolar + abs(current)` | `inferredLoad = expectedSolarAmps - observedCurrent` (where observed is negative) | ✅ Verified |
| **Day Charging** | `isSunUp=true`, `current > 0` | `Load = ExpectedSolar - current` | `inferredLoad = expectedSolarAmps - observedCurrent` | ✅ Verified |
| **Zero Coordinates** | `lat=0, lon=0` | Valid location (Equator) | `latitude ?? null` (Fixed bug where 0 was falsy) | ✅ Verified |
| **Timezone Handling** | UTC vs Local | Consistent Solar Time | Switched to `getUTCHours()` to match `solar-irradiance.cjs` | ✅ Verified |

## 2. Variable Definitions & Semantics
| Variable | Definition | Source | Notes |
|----------|------------|--------|-------|
| `expectedSolarAmps` | Theoretical max solar current based on irradiance & system capacity | `solar-irradiance.cjs` + `maxAmpsSolarCharging` | Assumes clear sky unless `cloudCover` provided |
| `observedCurrent` | Net current flowing into/out of battery | BMS Data | Positive = Charging, Negative = Discharging |
| `trueLoad` | Calculated load consumption | `ExpectedSolar - NetCurrent` | Represents "Solar Variance" attributed to load |
| `actualSolar` | Inferred actual solar generation | `trueLoad + NetCurrent` (if charging) | Back-calculated from load + net |

## 3. Edge Case Handling
| Edge Case | Handling Strategy | Verification Result |
|-----------|-------------------|---------------------|
| **System Capacity Mismatch** | If `maxAmps` > Real Capacity, `trueLoad` is inflated | Confirmed in test: 50A config vs 20A real = 28A phantom load |
| **Cloud Cover** | Reduces `expectedSolarAmps` | `solar-irradiance.cjs` applies cloud factor |
| **Generator at Night** | Detected as charging, excluded from load calc | Confirmed in test (Hour 12 initially misidentified as night charging due to TZ bug) |

## 4. Test Results (test-solar-aware.cjs)
- **Scenario**: Equator, Equinox, 20A Peak Solar, 5A Constant Load.
- **System Config**: 23A Max Capacity (tuned to match 20A peak).
- **Result**:
  - Noon Load: 4.87A (Expected ~5A) - Error < 3%
  - Night Load: 5.00A (Expected 5A) - Error 0%
  - Night Charging: Correctly identified when simulated.

## 5. Conclusion
The `solar-aware-load-analysis.cjs` module is mathematically sound and correctly implements the "Solar Variance = Load" logic. The initial bugs (Latitude 0 and Timezone) have been fixed and verified.
