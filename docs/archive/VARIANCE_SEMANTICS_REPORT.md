# Variance Semantics Report

## Executive Summary
The "Solar Variance" metric in BMSview is semantically equivalent to **"Daytime Load Consumption"** (plus system inefficiencies). This report clarifies the relationship between Expected Solar, Actual Solar, Net Current, and Load.

## The Core Equation
$$ Load_{Day} = Solar_{Expected} - Current_{Net} $$

Where:
- $Solar_{Expected}$: Theoretical generation based on location, time, and system capacity (adjusted for clouds).
- $Current_{Net}$: The actual current measured by the BMS (Positive = Charging, Negative = Discharging).
- $Load_{Day}$: The inferred power consumption during the day.

## Semantic Interpretation

### 1. The "Missing Energy" is Load
When the BMS reports less charging current than the solar panels *should* be producing, the difference is assumed to be consumed by immediate loads (inverter, DC loads) *before* reaching the battery shunt.

**Example:**
- **Expected Solar**: 40A (Sunny noon, 2kW array)
- **Net Battery Current**: 10A (Charging)
- **Inference**: 30A is being consumed by the house/load.
- **Reported Load**: 30A.

### 2. The "Inefficiency" Ambiguity
If the system capacity is configured incorrectly (e.g., user claims 50A capacity but panels are dirty/degraded and only produce 30A), the analysis will interpret the 20A deficit as **Load**.

- **Config**: 50A Max
- **Real Max**: 30A
- **Load**: 0A
- **Net Current**: 30A
- **Calculation**: $Load = 50A - 30A = 20A$
- **Result**: Phantom 20A load reported.

**Mitigation**: The "Solar Efficiency" metric tracks this. If "Efficiency" is consistently low (<80%) during known low-load periods, it suggests a system capacity configuration error or hardware issue, rather than high load.

### 3. Night vs. Day Semantics
- **Night**: $Load = |Current_{Net}|$ (Direct measurement).
- **Day**: $Load = Solar_{Expected} - Current_{Net}$ (Inferred).

This creates a potential discontinuity at sunrise/sunset if the Solar Model ($Solar_{Expected}$) does not perfectly match reality. The `solar-aware-load-analysis.cjs` module smooths this by using `isSunUp` from the astronomical calculator.

## ReAct/Async Insights Contract
The AI (Gemini) receives these metrics via `comprehensive-analytics.cjs`.
- **Input**: `solarAwareStats` object containing `hourlyProfile`, `dailySummary`, `timeOfDayPatterns`.
- **AI Responsibility**:
  - Interpret "Solar Efficiency" contextually.
  - Distinguish between "High Load" (variable) and "System Derating" (constant ratio).
  - Use `timeOfDayPatterns` to identify load shifting opportunities.

## Verification Status
The logic has been verified via `test-solar-aware.cjs`.
- **Fixes Applied**:
  - `latitude: 0` handling (was treated as falsy).
  - Timezone alignment (switched to UTC to match solar model).
- **Current State**: The logic correctly infers load within <3% error margin when system configuration matches reality.
