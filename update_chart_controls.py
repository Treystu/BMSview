#!/usr/bin/env python3
"""
Script to update the HistoricalChart.tsx file with averaging controls
"""

# Read the file
with open('components/HistoricalChart.tsx', 'r') as f:
    content = f.read()

# Find and replace the section
old_section = '''               <div className="flex justify-end items-center gap-4 mt-4">
                    {hasChartData && <button onClick={onResetView} className="text-sm text-secondary hover:underline">Reset View</button>}
                    {chartView === 'timeline' && (
                       <div className="relative" ref={metricConfigRef}>'''

new_section = '''               <div className="flex justify-end items-center gap-4 mt-4">
                    {hasChartData && <button onClick={onResetView} className="text-sm text-secondary hover:underline">Reset View</button>}
                    {chartView === 'timeline' && (
                       <>
                           {/* Data Averaging Controls */}
                           <div className="flex items-center gap-3 border-r border-gray-600 pr-4">
                               <label className="flex items-center space-x-2 text-sm text-gray-300 cursor-pointer">
                                   <input 
                                       type="checkbox" 
                                       checked={averagingEnabled} 
                                       onChange={(e) => {
                                           setAveragingEnabled(e.target.checked);
                                           if (!e.target.checked) setManualBucketSize(null);
                                       }}
                                       className="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 text-secondary focus:ring-secondary"
                                   />
                                   <span>Data Averaging</span>
                               </label>
                               {averagingEnabled && (
                                   <select 
                                       value={manualBucketSize || 'auto'} 
                                       onChange={(e) => setManualBucketSize(e.target.value === 'auto' ? null : e.target.value)}
                                       className="bg-gray-700 border border-gray-600 rounded-md px-2 py-1 text-sm text-white focus:ring-secondary focus:border-secondary"
                                   >
                                       <option value="auto">Auto (Zoom-based)</option>
                                       <option value="raw">No Averaging</option>
                                       <option value="5">5 Minutes</option>
                                       <option value="15">15 Minutes</option>
                                       <option value="60">1 Hour</option>
                                       <option value="240">4 Hours</option>
                                       <option value="1440">1 Day</option>
                                   </select>
                               )}
                           </div>
                           <div className="relative" ref={metricConfigRef}>'''

if old_section in content:
    content = content.replace(old_section, new_section)
    print("✓ Found and replaced the section")
else:
    print("✗ Section not found - checking for variations")
    # Try to find just the start
    if 'className="flex justify-end items-center gap-4 mt-4"' in content:
        print("✓ Found the div, but exact match failed")
    else:
        print("✗ Could not find the div at all")
    exit(1)

# Also need to close the fragment
old_close = '''                       </div>
                    )}
                    <button onClick={onGenerate}'''

new_close = '''                           </div>
                       </>
                    )}
                    <button onClick={onGenerate}'''

if old_close in content:
    content = content.replace(old_close, new_close)
    print("✓ Found and replaced the closing section")
else:
    print("✗ Closing section not found")
    exit(1)

# Write the updated content
with open('components/HistoricalChart.tsx', 'w') as f:
    f.write(content)

print("✓ File updated successfully!")