const { buildPrompt } = require('../utils/battery-analysis.cjs');

describe('Generate Insights - Single Point Data Analysis', () => {
  describe('buildPrompt - Single Point Detection', () => {
    it('should detect single-point data and use appropriate prompt', () => {
      const singlePointData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ],
        voltage: 48.2,
        current: 5.3,
        temperature: 28,
        stateOfCharge: 75,
        capacity: 100,
        alerts: ['Cell voltage imbalance detected'],
        summary: 'Battery system operating normally with minor cell imbalance'
      });

      const prompt = buildPrompt('system-001', singlePointData, null);

      // Should mention that this is a snapshot
      expect(prompt).toContain('snapshot');
      expect(prompt).toContain('single');

      // Should explicitly say NOT to calculate degradation
      expect(prompt).toContain('Do NOT attempt to calculate degradation');

      // Should focus on current state
      expect(prompt).toContain('current');
      expect(prompt).toContain('RIGHT NOW');
    });

    it('should use time-series prompt for multiple measurements', () => {
      const timeSeriesData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T19:00:00Z',
            voltage: 48.0,
            current: 5.0,
            temperature: 27,
            stateOfCharge: 80,
            capacity: 100
          },
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ],
        voltage: 48.2,
        current: 5.3,
        temperature: 28,
        stateOfCharge: 75,
        capacity: 100
      });

      const prompt = buildPrompt('system-001', timeSeriesData, null);

      // Should ask for degradation and trends
      expect(prompt).toContain('degradation');
      expect(prompt).toContain('Capacity retention');
      expect(prompt).toContain('Charging efficiency');
    });

    it('should handle custom prompt with single-point data', () => {
      const singlePointData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ]
      });

      const customPrompt = 'How long can this battery run at 10A?';
      const prompt = buildPrompt('system-001', singlePointData, customPrompt);

      // Should include the custom prompt
      expect(prompt).toContain(customPrompt);
      expect(prompt).toContain('USER QUESTION');
    });

    it('should include battery data in prompt', () => {
      const singlePointData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ],
        voltage: 48.2,
        current: 5.3,
        temperature: 28,
        stateOfCharge: 75,
        capacity: 100
      });

      const prompt = buildPrompt('system-001', singlePointData, null);

      // Should include the battery data
      expect(prompt).toContain('48.2');
      expect(prompt).toContain('5.3');
      expect(prompt).toContain('28');
      expect(prompt).toContain('75');
    });

    it('should include system ID in prompt', () => {
      const singlePointData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ]
      });

      const prompt = buildPrompt('my-system-123', singlePointData, null);

      expect(prompt).toContain('my-system-123');
    });

    it('should handle empty measurements array', () => {
      const emptyData = JSON.stringify({
        measurements: [],
        voltage: null,
        current: null
      });

      const prompt = buildPrompt('system-001', emptyData, null);

      // Should still generate a prompt
      expect(prompt).toBeTruthy();
      expect(prompt.length > 0).toBe(true);
    });

    it('should focus on current state analysis for single point', () => {
      const singlePointData = JSON.stringify({
        measurements: [
          {
            timestamp: '2025-11-05T20:00:00Z',
            voltage: 48.2,
            current: 5.3,
            temperature: 28,
            stateOfCharge: 75,
            capacity: 100
          }
        ],
        alerts: ['High temperature warning'],
        summary: 'Battery operating with elevated temperature'
      });

      const prompt = buildPrompt('system-001', singlePointData, null);

      // Should mention alerts and current state
      expect(prompt).toContain('alerts');
      expect(prompt).toContain('current');
      expect(prompt).toContain('health');
    });
  });
});

