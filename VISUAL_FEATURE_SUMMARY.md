# Visual Feature Summary - Hourly Cloud & Solar Integration

## UI Location

```
┌─────────────────────────────────────────────────────────────────┐
│ Historical Analysis Chart                                       │
├─────────────────────────────────────────────────────────────────┤
│ Controls:                                                        │
│ ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐          │
│ │ System ▼ │  │ View ▼   │  │ Start   │  │ End     │          │
│ └──────────┘  └──────────┘  └─────────┘  └─────────┘          │
│                                                                  │
│ ┌───────────────────────────────────────────────────────┐      │
│ │ ☑ Data Averaging │ ☑ Min/Max Bands │ ☑ ☁️ Hourly Weather │   │
│ │                  │                 │                  │      │
│ └───────────────────────────────────────────────────────┘      │
│                                           ⬆️ NEW TOGGLE          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│     Chart Visualization                                         │
│     ┌────────────────────────────────────────────────┐         │
│ 100%│░░░░░░░░░░░░░░░░ Cloud Cover (Gray Area) ░░░░│         │
│     │                                                │         │
│  75%│     ┌─────┐                                   │         │
│     │    /       \                                  │         │
│  50%│   /    ⚡   \  ← BMS Data (Solid Lines)       │         │
│     │  /            \                               │         │
│  25%│ /   - - - - -  \ ← Irradiance (Dashed Yellow)│         │
│     │/                \                             │         │
│   0%└────────────────────────────────────────────────┘         │
│     00:00  06:00  12:00  18:00  00:00                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Chart Elements

### 1. Cloud Cover Area (Background)
- **Visual**: Gray shaded area from 0% to cloud value
- **Color**: #94a3b8 (slate gray)
- **Opacity**: 0.1 (very subtle, doesn't obscure data)
- **Purpose**: Show when sun was blocked by clouds
- **Data Points**: Hourly intervals (every :00 minute)

### 2. Irradiance Dashed Line
- **Visual**: Dashed yellow line
- **Color**: #fbbf24 (solar yellow)
- **Pattern**: 8px dash, 4px gap
- **Opacity**: 0.8
- **Purpose**: Show solar energy availability (W/m²)
- **Scale**: 0-1200 W/m² typical range

### 3. BMS Data Lines (Primary)
- **Visual**: Solid colored lines
- **Examples**: 
  - Green: State of Charge
  - Blue: Current
  - Yellow: Voltage
- **Opacity**: 1.0 (full)
- **Data Points**: Sporadic (whenever user uploads screenshot)

### 4. Interpolated Points
- **Visual**: Dashed lines between BMS points
- **Opacity**: 0.6 (faded)
- **Purpose**: Estimate battery state between actual readings
- **Color**: Same as parent metric

## Tooltip Display

```
┌────────────────────────────────────┐
│ Nov 24, 2024 14:30:00 UTC         │
│                                    │
│ [☁️ Hourly Weather]                │
│                                    │
│ ● SOC         85.2 %               │
│ ● Current     12.3 A               │
│ ● Voltage     52.4 V               │
│ ● Clouds      45.0 %               │
│ ● Irradiance  650 W/m²             │
└────────────────────────────────────┘
```

When hovering over different data sources:
- **BMS Screenshot**: [📸 BMS Screenshot] in green
- **Hourly Weather**: [☁️ Hourly Weather] in blue
- **Interpolated**: [🔮 Interpolated] in purple

## Metric Configuration Panel

```
┌─────────────────────────────────────────┐
│ Configure Metrics                       │
├─────────────────────────────────────────┤
│ Battery                                  │
│ ☑ SOC (Left)     ☑ Voltage (Left)       │
│ ☑ Current (Right) ☐ Power               │
│                                          │
│ Weather                                  │
│ ☑ Clouds (Right)                         │ ← Enable for area
│ ☑ Irradiance (Right)                     │ ← Enable for line
│ ☐ Air Temp       ☐ UV Index              │
├─────────────────────────────────────────┤
│ Left Axis: V, %, A                       │
│ Right Axis: %, W/m²                      │
└─────────────────────────────────────────┘
```

## Visual Legend

**Line Styles**:
- ━━━━━ Solid = BMS actual data
- ┈┈┈┈┈ Dashed = Cloud/Irradiance/Interpolated

**Opacity Levels**:
- 1.0 (Full) = BMS screenshots
- 0.8 (High) = Hourly cloud data / Irradiance
- 0.6 (Medium) = Interpolated estimates
- 0.1 (Low) = Cloud area background

**Color Scheme**:
- 🟢 Green: State of Charge, BMS source badge
- 🔵 Blue: Current, Cloud source badge
- 🟡 Yellow: Voltage, Irradiance
- 🟣 Purple: Interpolated source badge
- ⚫ Gray: Cloud cover area

## Real-World Example Interpretation

```
Time:     00:00   06:00   12:00   18:00   00:00
         ┌────────────────────────────────────┐
Clouds   │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  High clouds all day
100%     │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
         │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
         │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
         │                                    │
Irrad.   │    - - - ╱╲ - - -                 │  Low irradiance
600 W/m² │         ╱  ╲                       │  due to clouds
         │        ╱    ╲                      │
         │                                    │
Current  │       ╱▔▔▔▔╲                      │  Charging current
20 A     │      ╱      ╲                     │  follows irradiance
         │     ╱        ╲                    │
         │____╱          ╲____               │
0 A      └────────────────────────────────────┘

Interpretation: 
- Heavy clouds (80-90%) throughout day
- Low solar irradiance (~300-400 W/m²) at peak
- Limited charging current (~10A) due to poor conditions
- This explains low daily charge recovery
```

## Feature Activation Checklist

Before using this feature:
- [ ] System has latitude/longitude configured
- [ ] Hourly cloud data has been backfilled
- [ ] Date range is within available data
- [ ] Enable "Clouds" metric in configuration panel
- [ ] Enable "Irradiance" metric in configuration panel
- [ ] Toggle "☁️ Hourly Weather" ON
- [ ] Chart will reload with merged data

## Visual Comparison

**Before (BMS Only)**:
```
Battery drops at noon, why?
     ┌──────────────┐
100% │   ╲          │ 
     │    ╲         │
 50% │     ╲______  │ ← Unexplained drop
     │              │
  0% └──────────────┘
```

**After (With Cloud Data)**:
```
Battery drops at noon - clouds appeared!
     ┌──────────────┐
100% │░░░░╲░░░░░░░  │ ← Clouds moved in
     │░░░░░╲░░░░░   │
 50% │░░░░░░╲______  │ Now explained!
     │░░░░░░░░░░░░  │
  0% └──────────────┘
```

---

**Result**: Admins can instantly correlate battery behavior with weather conditions!
