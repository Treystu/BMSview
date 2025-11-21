# Data Integrity Warning Banner - UI Preview

## Visual Representation

```
┌─────────────────────────────────────────────────────────────┐
│  battery_screenshot_2024.jpg              ✅ Completed      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┃  ⚠️                                                       │
│  ┃  ⚠️ Data Integrity Warning                              │
│  ┃                                                          │
│  ┃  The AI may have misread some values from this          │
│  ┃  screenshot. Please review the data below carefully     │
│  ┃  and manually verify critical readings.                 │
│  ┃                                                          │
│  ┃  ▶ Show validation warnings (3)                         │
│  ┃                                                          │
│  Orange border-left (4px)                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Battery Metrics                                            │
│  SOC: 150% ⚠️    Voltage: 60.0V ⚠️    Current: -5.2A       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Expanded Details View

```
┌─────────────────────────────────────────────────────────────┐
│  ┃  ⚠️ Data Integrity Warning                              │
│  ┃                                                          │
│  ┃  The AI may have misread some values...                 │
│  ┃                                                          │
│  ┃  ▼ Show validation warnings (3)                         │
│  ┃  ┌────────────────────────────────────────────────────┐ │
│  ┃  │ • Invalid SOC: 150% (must be 0-100%)              │ │
│  ┃  │ • Voltage mismatch: Overall 60V vs sum of cells   │ │
│  ┃  │   52.28V (diff: 7.72V)                            │ │
│  ┃  │ • Cell 16 voltage 5V out of range (2-4.5V)        │ │
│  ┃  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Color Scheme
- **Background**: `bg-orange-50` (light orange)
- **Border**: `border-orange-500` (4px left border, orange)
- **Text**: `text-orange-700` (dark orange)
- **Headings**: `text-orange-800` (darker orange)
- **Details box**: `bg-orange-100` (slightly darker orange background)

## Interactive Elements
- **Summary**: Cursor pointer, underline on hover
- **Details expansion**: Native browser `<details>` element
- **Warning count**: Dynamically shows number of warnings in parentheses

## Positioning
Located in analysis result card:
1. After filename/status header
2. After duplicate detection banner (if present)
3. After save error banner (if present)
4. **BEFORE** battery metrics display
5. Above all other analysis data

## Conditional Display
Only shows when ALL conditions are met:
- `result.needsReview === true`
- `result.validationWarnings` exists
- `result.validationWarnings.length > 0`

## User Experience Flow
1. User uploads BMS screenshot
2. AI extraction completes
3. Validation runs automatically
4. If validation fails:
   - Orange warning banner appears
   - User sees clear message
   - User can expand to see specific issues
   - User reviews actual data below banner
   - User manually verifies critical values
5. If validation passes:
   - No banner shown
   - Clean data display

## Accessibility
- ✅ Semantic HTML (`<details>`, `<summary>`, `<ul>`, `<li>`)
- ✅ SVG icon with proper viewBox
- ✅ Color not sole indicator (icon + text)
- ✅ Expandable/collapsible for screen readers
- ✅ Clear hierarchical structure

## Real-World Example

**Scenario:** AI misreads "100%" as "150%" for SOC

**What user sees:**
```
⚠️ Data Integrity Warning
The AI may have misread some values from this screenshot.
Please review the data below carefully and manually verify
critical readings.

▶ Show validation warnings (1)
```

**When expanded:**
```
• Invalid SOC: 150% (must be 0-100%)
```

**Then in data display:**
```
State of Charge: 150%  ⚠️
```

User immediately knows to double-check the actual screenshot for the correct SOC value.
