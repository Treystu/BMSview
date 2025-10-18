#!/usr/bin/env python3
"""
Script to add averaging controls to HistoricalChart.tsx
"""

with open('components/HistoricalChart.tsx', 'r') as f:
    lines = f.readlines()

# Find the line with "chartView === 'timeline' &&"
target_line_idx = None
for i, line in enumerate(lines):
    if "chartView === 'timeline' &&" in line and i > 200:
        target_line_idx = i
        break

if target_line_idx is None:
    print("Could not find target line")
    exit(1)

print(f"Found target at line {target_line_idx + 1}")

# The next line should be the opening div
if '<div className="relative"' not in lines[target_line_idx + 1]:
    print("Unexpected structure")
    exit(1)

# Insert the new controls
indent = '                       '
new_lines = [
    lines[target_line_idx].replace('(', '(\n' + indent + '<>'),
    indent + '    {/* Data Averaging Controls */}\n',
    indent + '    <div className="flex items-center gap-3 border-r border-gray-600 pr-4">\n',
    indent + '        <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">\n',
    indent + '            <input \n',
    indent + '                type="checkbox" \n',
    indent + '                checked={averagingEnabled} \n',
    indent + '                onChange={(e) => {\n',
    indent + '                    setAveragingEnabled(e.target.checked);\n',
    indent + '                    if (!e.target.checked) setManualBucketSize(null);\n',
    indent + '                }}\n',
    indent + '                className="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 text-secondary focus:ring-secondary"\n',
    indent + '            />\n',
    indent + '            <span>Data Averaging</span>\n',
    indent + '        </label>\n',
    indent + '        {averagingEnabled && (\n',
    indent + '            <select \n',
    indent + '                value={manualBucketSize || \'auto\'} \n',
    indent + '                onChange={(e) => setManualBucketSize(e.target.value === \'auto\' ? null : e.target.value)}\n',
    indent + '                className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-secondary focus:border-secondary"\n',
    indent + '            >\n',
    indent + '                <option value="auto">Auto (Zoom-based)</option>\n',
    indent + '                <option value="raw">No Averaging</option>\n',
    indent + '                <option value="5">5 Minutes</option>\n',
    indent + '                <option value="15">15 Minutes</option>\n',
    indent + '                <option value="60">1 Hour</option>\n',
    indent + '                <option value="240">4 Hours</option>\n',
    indent + '                <option value="1440">1 Day</option>\n',
    indent + '            </select>\n',
    indent + '        )}\n',
    indent + '    </div>\n',
]

# Replace the line
lines[target_line_idx] = new_lines[0]
# Insert the rest after
for i, new_line in enumerate(new_lines[1:], 1):
    lines.insert(target_line_idx + i, new_line)

# Now find the closing and add fragment close
# Look for "                       </div>\n                    )}" pattern
for i in range(target_line_idx + 50, min(target_line_idx + 100, len(lines) - 1)):
    if '</div>' in lines[i] and i + 1 < len(lines) and ')}\n' in lines[i + 1] and 'chartView' not in lines[i + 2]:
        # Insert the fragment close before the )}
        lines[i + 1] = '                       </>\n' + lines[i + 1]
        print(f"Updated closing at line {i + 2}")
        break

# Write back
with open('components/HistoricalChart.tsx', 'w') as f:
    f.writelines(lines)

print("✓ Chart controls updated successfully!")