#!/usr/bin/env python3
"""
Final fix for chart controls
"""

with open('components/HistoricalChart.tsx', 'r') as f:
    content = f.read()

# Find and replace the problematic closing
# The issue is that </> was inserted in the wrong place
content = content.replace(
    '''                                                           </div>
                          </>
                                                       )}''',
    '''                                                           </div>
                                                       )}'''
)

# Now find the correct place to close the fragment
# It should be right before the final closing of the timeline conditional
content = content.replace(
    '''                               </div>
                           )}
                       </div>
                    )}
                    <button onClick={onGenerate}''',
    '''                               </div>
                           )}
                       </div>
                       </>
                    )}
                    <button onClick={onGenerate}'''
)

with open('components/HistoricalChart.tsx', 'w') as f:
    f.write(content)

print("✓ Fixed fragment placement!")