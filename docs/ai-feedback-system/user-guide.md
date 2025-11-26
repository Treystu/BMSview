# AI Feedback System User Guide

## Welcome

This guide explains how BMSview's AI Feedback System works to ensure accurate battery data extraction and provide intelligent insights.

## Table of Contents

1. [How It Works](#how-it-works)
2. [Understanding Validation Feedback](#understanding-validation-feedback)
3. [Interpreting Statistical Insights](#interpreting-statistical-insights)
4. [Reading Health Scores](#reading-health-scores)
5. [Understanding Trends](#understanding-trends)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## How It Works

### Data Extraction Process

1. **Upload**: You upload a BMS screenshot
2. **AI Extraction**: Gemini AI reads voltage, current, SOC, temperatures, etc.
3. **Validation**: Data checked against physics rules and logical constraints
4. **Feedback Loop**: If validation fails, AI receives specific feedback and retries
5. **Quality Score**: Final extraction scored 0-100
6. **Analytics**: Validated data fed into statistical analysis engine

### The Feedback Loop

```
┌─────────────┐
│ BMS Image   │
└──────┬──────┘
       │
       v
┌─────────────────┐      ┌──────────────┐
│ Gemini AI       │─────>│ Validation   │
│ Extracts Data   │      │ Check        │
└─────────────────┘      └──────┬───────┘
       ^                         │
       │                         v
       │              ┌──────────────────┐
       │              │ Validation       │
       │              │ Passed?          │
       │              └──────┬───────────┘
       │                     │
       │ NO <────────────────┴────> YES
       │ (with specific              │
       │  feedback)                  v
       │                    ┌────────────────┐
       │                    │ Store Data +   │
       └────────────────────│ Generate       │
          (Max 3 attempts)  │ Analytics      │
                            └────────────────┘
```

---

## Understanding Validation Feedback

### What Gets Validated

The system checks for:

1. **Physics Violations**
   - Voltage sum = overall voltage
   - Power = Current × Voltage
   - Cell voltages within 2.0-4.5V range

2. **Logical Consistency**
   - SOC between 0-100%
   - Remaining capacity ≤ full capacity
   - MOS state matches current flow

3. **Data Reasonableness**
   - Temperature 0-100°C
   - Current within expected range
   - Cell imbalance < 500mV

### Example: SOC Validation Failure

**What You Might See:**
```
Quality Score: 80/100
Issues:
- Invalid SOC: 150% (must be 0-100%)
```

**What It Means:**
The AI misread "15.0%" as "150%". The system detected this (SOC can't exceed 100%) and asked the AI to re-examine the SOC field.

**Resolution:**
On retry, the AI corrects to "15.0%" and validation passes.

### Example: Voltage Mismatch

**What You Might See:**
```
Quality Score: 60/100
Issues:
- Voltage mismatch: Overall 60.0V vs sum of cells 52.28V (diff: 7.72V)
```

**What It Means:**
Physics error. Individual cell voltages should add up to the overall voltage. Either:
- Overall voltage was misread
- One or more cell voltages were wrong

**Resolution:**
AI re-examines both overall voltage AND all cell voltages, identifies the error, and corrects it.

---

## Interpreting Statistical Insights

### Current State Snapshot

Shows real-time battery status:

```
Voltage: 52.4V
Current: -12.5A (discharging)
Power: -655W
SOC: 67.3%
Mode: Discharging at 12.5A (655W)
Runtime: 1d 8h until empty at current load
Temperature: 28.5°C
Cell Imbalance: 45mV (excellent)
```

**Key Metrics:**
- **Voltage**: Should be stable. Rapid decline = problem
- **Current**: Positive = charging, negative = discharging
- **Runtime**: Estimated hours/days until battery empty (assumes 80% depth of discharge)
- **Cell Imbalance**: Difference between highest and lowest cell
  - < 50mV: Excellent
  - 50-100mV: Good
  - 100-200mV: Fair (monitor)
  - > 200mV: Poor (needs attention)

### Load Profile

Shows when and how you use energy:

```
Hourly Average (Watts):
  6 AM:  250W (morning coffee maker, lights)
  12 PM: 450W (midday appliances)
  6 PM:  800W (peak usage - cooking, lights)
  12 AM: 150W (baseload - fridge, standby)

Nighttime (6 PM - 6 AM): 3.6 kWh
Daytime (6 AM - 6 PM): 4.2 kWh
Total Daily Consumption: 7.8 kWh
```

**What to Look For:**
- **Peak hours**: Identify your high-usage times
- **Baseload**: Minimum continuous draw (should be low)
- **Patterns**: Weekday vs weekend differences
- **Anomalies**: Unexpected high usage

### Energy Balance

Shows if solar is meeting your needs:

```
Daily Averages:
  Solar Generation: 8.5 kWh
  Energy Consumption: 7.8 kWh
  Net Balance: +0.7 kWh (surplus)

Solar Sufficiency: 109% (exceeding needs)
Battery Autonomy: 2.3 days at current load
```

**Interpretation:**
- **Sufficiency > 100%**: Solar meets all needs + charges battery
- **Sufficiency 80-100%**: Solar mostly sufficient, occasional generator use
- **Sufficiency < 80%**: Significant generator/grid dependence
- **Autonomy**: Days you can run on battery alone (no solar/generator)

### Solar Performance

Evaluates solar charging efficiency:

```
Actual Daily Charge: 7.2 kWh
Expected Daily Solar: 9.0 kWh
Performance Ratio: 80%

Status: Good
Note: 20% difference may be daytime load, not solar deficiency
```

**Important:** The "missing" solar energy often represents **daytime loads** (appliances running while sun is out), not solar panel problems. Only worry if:
- Performance ratio < 60% on sunny days
- Weather was clear (cloud cover < 20%) but charging was poor

---

## Reading Health Scores

### Overall Health Score

Ranges from 0-100:

| Score | Status | Meaning |
|-------|--------|---------|
| 90-100 | Excellent | Battery performing optimally |
| 75-89 | Good | Minor issues, no action needed |
| 60-74 | Fair | Monitor closely, plan maintenance |
| 40-59 | Poor | Action required soon |
| 0-39 | Critical | Immediate attention needed |

### Health Components

**1. Cell Imbalance**
```
Current: 45mV
Status: Excellent
Trend: Stable
```
- Watch for increasing trend
- > 100mV warrants balancing or cell replacement

**2. Temperature**
```
Average: 28.5°C
Max (24h): 35.2°C
Status: Excellent
```
- Ideal range: 20-30°C
- Warning: > 40°C
- Critical: > 50°C

**3. Capacity Degradation**
```
Current Capacity: 195Ah (97.5% of rated 200Ah)
Degradation: 2.5%
Trend: Stable
```
- New battery: 100%
- Slight degradation: 95-100%
- Moderate: 85-95%
- Significant: 80-85%
- Replacement needed: < 80%

**4. Cycle Life**
```
Current Cycles: 245
Estimated Life: 3000 cycles
Remaining: ~2755 cycles (91.8%)
Status: Excellent
```
- LiFePO4 typical life: 3000-5000 cycles
- Plan replacement when cycles approach rated limit

---

## Understanding Trends

### Trend Confidence

All trends show confidence level:

```
SOC Trend:
  Direction: Decreasing
  Change Rate: -2.3% per day
  Confidence: High (R² = 0.85)
  Forecast (7 days): 51.2%
```

**Confidence Levels:**
- **High (R² > 0.7)**: Strong pattern, trust the forecast
- **Medium (R² 0.4-0.7)**: Moderate pattern, use with caution
- **Low (R² < 0.4)**: Too noisy, disregard forecast

### Common Trend Patterns

**Declining SOC (Concerning)**
```
Change: -3.5% per day
Confidence: High
Meaning: Battery not fully recharging daily
Action: Check solar, reduce loads, or add generator time
```

**Stable SOC (Good)**
```
Change: -0.1% per day
Confidence: Low
Meaning: SOC staying consistent, energy balanced
Action: Continue current operation
```

**Increasing Cell Imbalance (Warning)**
```
Change: +2mV per day
Confidence: Medium
Meaning: Cells drifting apart
Action: Schedule balancing, monitor closely
```

---

## Best Practices

### For Accurate Readings

1. **Upload Clear Images**
   - Good lighting
   - Focus on all text
   - Include all cells if present
   - Avoid glare/reflections

2. **Consistent Timing**
   - Upload at similar times daily
   - Capture full range (morning low SOC, afternoon peak charge)

3. **Let AI Retry**
   - System auto-retries up to 3 times
   - Each retry improves accuracy
   - Final quality score reflects success

### For Useful Analytics

1. **Regular Uploads**
   - Daily uploads minimum for trends
   - Multiple per day better captures patterns
   - Need 7+ days for confident trend analysis

2. **System Configuration**
   - Register battery capacity correctly
   - Set max solar amps accurately
   - Specify chemistry (LiFePO4, NMC, etc.)

3. **Review Insights Weekly**
   - Check health score trend
   - Monitor any declining metrics
   - Act on priority recommendations

---

## Troubleshooting

### Low Quality Scores (<80)

**Problem:** Frequent validation failures, low quality scores

**Causes:**
- Poor image quality (blurry, dark, glare)
- Unusual BMS layout AI hasn't seen before
- Obscured or cut-off data fields

**Solutions:**
- Retake photo with better lighting
- Ensure all fields visible
- Try different angle to reduce glare
- If persistent, upload a clear reference photo in GitHub issue

### "Insufficient Data" Messages

**Problem:** Analytics show "insufficient data" flags

**Causes:**
- New system (< 7 days of data)
- Irregular upload schedule
- Gap in data collection

**Solutions:**
- Continue regular uploads
- Requires 24h minimum for load profiling
- Requires 48h for energy balance
- Requires 7 days for trend analysis

### Unexpected Trends

**Problem:** Trend shows "declining" but battery seems fine

**Causes:**
- Normal seasonal variation
- Recent load changes
- Weather pattern shift
- Low confidence trend (noisy data)

**Solutions:**
- Check trend confidence (High/Medium/Low)
- Low confidence = ignore
- Medium confidence = monitor
- High confidence = investigate cause

### Solar Performance Alerts

**Problem:** "Solar underperforming" but panels seem fine

**Remember:** 
- Delta often represents daytime loads
- Expected solar assumes no loads during charging
- Check cloud cover correlation
- Only worry if clear days show poor performance

**Solutions:**
- Review weather data for those days
- Check for loads running during solar hours
- Compare sunny day performance only

---

## Getting Help

- **Documentation**: Check [Model Assumptions](./model-assumptions.md) for details
- **Admin Guide**: See [Admin Training](./admin-training.md) for advanced features
- **API Docs**: [API Documentation](./api.md) for technical details
- **Issues**: Report problems at https://github.com/Treystu/BMSview/issues

---

## Summary

The AI Feedback System ensures accurate data extraction through:
- Automated validation with physics-based rules
- Iterative feedback loop (up to 3 retries)
- Quality scoring (0-100) for transparency

And provides actionable insights via:
- Real-time health monitoring
- Statistical trend analysis
- Predictive forecasting
- Context-aware recommendations

Keep uploading regularly, review insights weekly, and act on priority recommendations for optimal battery management! 🔋
