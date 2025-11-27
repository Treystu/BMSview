# AI Feedback System - Model Assumptions and Limitations

## Overview

This document outlines the statistical models, assumptions, and limitations of BMSview's AI Feedback System. Understanding these helps interpret results accurately and avoid misinterpretation.

## Table of Contents

1. [Validation Model](#validation-model)
2. [Quality Scoring Model](#quality-scoring-model)
3. [Statistical Analysis Models](#statistical-analysis-models)
4. [Known Limitations](#known-limitations)
5. [Edge Cases](#edge-cases)
6. [Future Improvements](#future-improvements)

---

## Validation Model

### Physics-Based Rules

The validation system enforces fundamental physics laws:

#### 1. Voltage Conservation
```
Assumption: Sum of cell voltages = Overall battery voltage
Tolerance: ±0.5V (accounts for measurement precision)

Formula: |overallVoltage - Σ(cellVoltages)| ≤ 0.5V

Why: Series-connected cells add linearly
Limitation: Parallel configurations not yet supported
```

#### 2. Power Relationship
```
Assumption: Power = Current × Voltage
Tolerance: ±50W or 10% (whichever is larger)

Formula: |power - (current × voltage)| ≤ max(50, 0.1 × power)

Why: Fundamental power relationship (P = V × I)
Limitation: Doesn't account for conversion losses
```

#### 3. State of Charge (SOC)
```
Assumption: SOC = (Remaining Capacity / Full Capacity) × 100
Tolerance: ±5% (BMS measurement variance)

Formula: |SOC - (remainingAh / fullCapacityAh × 100)| ≤ 5%

Why: Direct capacity ratio
Limitation: Assumes linear SOC calculation (may differ by chemistry)
```

### Logical Constraints

#### Cell Voltage Ranges (Chemistry-Specific)

**LiFePO4 (Most Common)**
```
Valid Range: 2.5V - 3.65V
Safe Range: 2.8V - 3.5V
Ideal: 3.2V - 3.35V

Assumption: LiFePO4 default unless specified
Limitation: Other chemistries have different ranges
```

**NMC/NCM (Lithium Nickel Manganese Cobalt)**
```
Valid Range: 2.8V - 4.2V
Safe Range: 3.0V - 4.1V
Ideal: 3.6V - 3.9V
```

**LTO (Lithium Titanate)**
```
Valid Range: 1.5V - 2.8V
Safe Range: 1.8V - 2.6V
Ideal: 2.0V - 2.5V
```

#### Temperature Constraints
```
Valid Range: -20°C to 100°C
Warning Range: Outside 0-50°C
Critical: < 0°C or > 60°C

Assumption: Ambient temperature sensor reading
Limitation: Cell core temperature may differ by ±10°C
```

#### Current Direction
```
Positive = Charging (energy into battery)
Negative = Discharging (energy from battery)
MOS Correlation: Charge MOS ON when current > 0.5A
                 Discharge MOS ON when current < -0.5A

Assumption: Standard BMS configuration
Limitation: Some BMS may use opposite convention
```

---

## Quality Scoring Model

### Scoring Algorithm

```
Initial Score: 100

Deductions:
- Critical Error: -20 points each
- Warning: -5 points each
- Floor: 0 (minimum score)

Final Score = max(0, 100 - (criticalCount × 20) - (warningCount × 5))
```

### Score Interpretation

| Score Range | Quality | Meaning | Action |
|-------------|---------|---------|--------|
| 90-100 | Excellent | Perfect or near-perfect extraction | Accept confidently |
| 80-89 | Good | Minor warnings only | Accept, review warnings |
| 60-79 | Fair | Some critical errors corrected | Review, may need manual check |
| 40-59 | Poor | Multiple critical errors | Manual review recommended |
| 0-39 | Failed | Excessive errors, retry failed | Manual entry required |

### Assumptions

1. **Linear Deduction**: Each error equally weighted within its category
   - Limitation: Some errors more severe than others
   - Future: Weighted error scoring

2. **Independent Errors**: Each error counted separately
   - Limitation: Cascading errors (one causes another) double-counted
   - Future: Error dependency graph

3. **Fixed Thresholds**: Same deductions for all systems
   - Limitation: Different battery types may need different tolerances
   - Future: Chemistry-specific validation profiles

---

## Statistical Analysis Models

### Linear Regression (Trend Analysis)

#### Model
```
y = mx + b

Where:
- y: Metric value (SOC, voltage, temperature, etc.)
- x: Time (days since first measurement)
- m: Slope (rate of change per day)
- b: Intercept (starting value)
- R²: Goodness of fit (0-1, 1=perfect linear fit)
```

#### Assumptions

1. **Linearity**: Trends change at constant rate
   - Reality: Battery degradation often non-linear
   - Validity: Good for short-term (7-30 day) forecasts
   - Limitation: Long-term predictions unreliable

2. **Independence**: Each measurement independent
   - Reality: Consecutive measurements correlated (autocorrelation)
   - Impact: May overstate confidence
   - Mitigation: Use daily averages, not raw readings

3. **Homoscedasticity**: Variance constant over time
   - Reality: Variance may increase with degradation
   - Impact: R² may understate uncertainty for older batteries
   - Mitigation: Recalculate trends periodically

#### Confidence Thresholds

```
R² > 0.7:  High Confidence
  - Strong linear pattern
  - Forecast reliable for 7 days
  - Act on trend

R² 0.4-0.7: Medium Confidence
  - Moderate pattern
  - Forecast useful but uncertain
  - Monitor trend

R² < 0.4: Low Confidence
  - Weak or no pattern
  - Forecast unreliable
  - Disregard, data too noisy
```

**Assumptions:**
- Thresholds same for all metrics
- Limitation: Temperature may need higher R² (more volatile)
- Future: Metric-specific confidence thresholds

### Load Profile Analysis

#### Hourly Averaging
```
For each hour 0-23:
  avgWatts[hour] = Σ(discharge_power) / count

Assumptions:
- Discharge only (current < -0.5A)
- Charging power excluded (solar generation != load)
- Average representative of typical usage
```

**Limitations:**
1. Requires 24+ hours data
2. Single outlier can skew average
3. Weekday vs weekend not automatically separated
4. Seasonal patterns not captured (need 90+ days)

#### Nighttime vs Daytime
```
Nighttime: 6 PM - 6 AM (12 hours)
Daytime:   6 AM - 6 PM (12 hours)

Assumptions:
- Fixed times apply to all locations
- Daytime loads captured (not masked by solar)
```

**Limitations:**
- Doesn't account for latitude (longer/shorter days)
- Daylight saving time not considered
- Future: Location-based sunrise/sunset times

### Energy Balance

#### Daily Energy Calculation
```
Generation = ∫(positive current × voltage) dt
Consumption = ∫(negative current × voltage) dt
Net Balance = Generation - Consumption

Using trapezoidal integration between data points
```

**Assumptions:**
1. Data points evenly distributed (or close enough)
2. Linear interpolation between points accurate
3. Voltage constant during integration period

**Limitations:**
- Missing data creates gaps (affects accuracy)
- Rapid load changes between samples missed
- Requires 48+ hours for meaningful results

#### Solar Sufficiency
```
Solar Sufficiency = (Average Daily Generation / Average Daily Consumption) × 100%

>100%: Surplus (battery charging net positive)
 100%: Exactly sufficient
 <100%: Deficit (generator/grid needed)
```

**Critical Assumption:**
- Assumes 100% charging efficiency
- Reality: 85-95% efficient
- Impact: Overestimates sufficiency by 5-15%

#### Battery Autonomy
```
Autonomy (days) = (Battery Capacity × 0.8) / Average Daily Consumption

0.8 factor = 80% depth of discharge (safe for most chemistries)
```

**Assumptions:**
1. Constant daily consumption
2. 80% DoD appropriate for battery chemistry
3. No degradation during autonomy period

**Limitations:**
- Real consumption varies day-to-day
- Weather-dependent loads (heating/cooling) not factored
- LiFePO4 can do 100% DoD safely (conservative estimate)

### Anomaly Detection

#### Outlier Threshold
```
Outlier if: |value - mean| > 2 × standard_deviation

Uses 2-sigma rule (95% confidence interval)
```

**Assumptions:**
1. Data normally distributed (Gaussian)
2. Mean and σ stable over analysis window
3. Anomalies rare (<5% of data points)

**Limitations:**
- Skewed distributions (e.g., SOC often bimodal) violate normality
- Sudden baseline shifts (e.g., new load added) trigger false positives
- Needs 24+ data points for reliable σ calculation

---

## Known Limitations

### Data Quality Dependencies

1. **Image Upload Frequency**
   - Need: Daily minimum, multiple per day ideal
   - Reality: Users may upload irregularly
   - Impact: Gaps in data, trends unreliable
   - Mitigation: System flags "insufficient data"

2. **BMS Compatibility**
   - Trained on: Common BMS layouts (Daly, JBD, Overkill Solar)
   - May struggle: Custom BMS, unusual layouts, foreign languages
   - Mitigation: Retry mechanism usually corrects
   - Future: Expand training data

3. **Weather Data Availability**
   - Source: OpenWeatherMap API
   - Coverage: Good for populated areas, sparse for remote locations
   - Impact: Solar performance analysis less accurate
   - Fallback: Uses system config only

### Statistical Limitations

1. **Short-Term Data**
   - Trend analysis: Needs 7+ days
   - Seasonal patterns: Needs 90+ days
   - Battery degradation: Needs months/years
   - Current: Limited to available data window

2. **Confounding Variables**
   - Load changes (new appliances)
   - Weather patterns (seasonal)
   - User behavior shifts
   - Cannot isolate causes automatically

3. **Linear Assumptions**
   - Battery degradation non-linear (accelerates)
   - SOC estimation chemistry-dependent
   - Temperature effects complex (Arrhenius)
   - Linear regression oversimplifies

---

## Edge Cases

### Multi-Battery Systems

**Current Handling:** Treats as single aggregated system
**Limitation:** Cannot detect individual battery degradation
**Workaround:** Register each battery as separate system if BMS supports

### Parallel Battery Banks

**Current Handling:** Voltage sum validation may fail
**Limitation:** Designed for series configurations
**Workaround:** Manual validation override needed
**Future:** Detect and adapt to parallel configurations

### Incomplete Cell Data

**Example:** 16-cell battery but only 8 cell voltages visible in screenshot
**Current Handling:** Validates only visible cells
**Limitation:** Cannot detect imbalance in hidden cells
**Recommendation:** Capture all cells if possible

### DC-Coupled Solar

**Challenge:** Solar generation and load consumption simultaneous
**Impact:** Energy balance may show "missing" solar (actually consumed by loads)
**Mitigation:** User guide explains this is normal
**Future:** Deconvolve solar generation from net battery current

### Grid/Generator Integration

**Challenge:** Multiple charging sources (solar + generator/grid)
**Impact:** "Solar performance" conflates sources
**Current:** No way to distinguish sources
**Future:** User-tagged charging sessions

---

## Future Improvements

### Planned Enhancements

1. **Weighted Error Scoring**
   - Critical errors weighted by severity
   - Physics violations > logical warnings

2. **Chemistry-Specific Profiles**
   - LiFePO4, NMC, LTO validation presets
   - Adaptive voltage ranges
   - SOC curve correction

3. **Non-Linear Trend Models**
   - Exponential degradation curves
   - Polynomial regression for complex patterns
   - Machine learning trend prediction

4. **Confidence Intervals**
   - Forecast ranges (best/worst case)
   - Uncertainty quantification
   - Probabilistic recommendations

5. **Anomaly Classification**
   - False positive reduction
   - Root cause suggestions
   - Automated anomaly explanation

### Research Areas

1. **Battery State of Health (SOH) Estimation**
   - Internal resistance tracking
   - Capacity fade modeling
   - Remaining useful life prediction

2. **Predictive Maintenance**
   - Failure mode detection
   - Pre-failure warning signals
   - Optimal replacement timing

3. **Load Forecasting**
   - Pattern recognition (daily, weekly, seasonal)
   - Weather-adjusted load prediction
   - Anomaly-aware forecasting

---

## Responsible Use

### Do's ✅

- Use analytics as **guidance**, not absolute truth
- Combine AI insights with **domain expertise**
- **Verify** critical recommendations before acting
- Report **inaccuracies** to improve the system
- Understand **limitations** for your specific use case

### Don'ts ❌

- Don't rely solely on AI for **safety-critical** decisions
- Don't ignore **low confidence** warnings
- Don't extrapolate **trends beyond 7 days**
- Don't assume all **anomalies are real** (check context)
- Don't compare **different battery chemistries** directly

---

## Conclusion

The AI Feedback System uses established statistical methods with documented assumptions and limitations. By understanding these, you can:

1. Interpret results accurately
2. Recognize when results may be unreliable
3. Supplement AI insights with domain knowledge
4. Provide feedback for continuous improvement

For questions or to report assumption violations, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

**Version:** 2.0-comprehensive  
**Last Updated:** 2025-11-26  
**Review Cycle:** Quarterly
