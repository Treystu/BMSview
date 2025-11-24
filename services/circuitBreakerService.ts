/**
 * Circuit Breaker Service
 * 
 * Provides utilities for checking and managing circuit breaker states.
 * Used for diagnostic purposes and error recovery.
 */

export interface CircuitBreakerInfo {
  key: string;
  state: 'open' | 'closed' | 'half-open';
  failures: number;
  openUntil: string | null;
  isOpen: boolean;
  timeUntilReset: number;
}

export interface CircuitBreakerStatus {
  timestamp: string;
  breakers: CircuitBreakerInfo[];
  summary: {
    total: number;
    open: number;
    closed: number;
    anyOpen: boolean;
  };
}

/**
 * Get current status of all circuit breakers
 */
export async function getCircuitBreakerStatus(): Promise<CircuitBreakerStatus> {
  const response = await fetch('/.netlify/functions/circuit-breaker-status', {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to get circuit breaker status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Reset a specific circuit breaker by key
 */
export async function resetCircuitBreaker(key: string): Promise<void> {
  const response = await fetch('/.netlify/functions/circuit-breaker-reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ key }),
  });

  if (!response.ok) {
    throw new Error(`Failed to reset circuit breaker: ${response.status}`);
  }
}

/**
 * Reset all circuit breakers
 * Use with caution - for emergency recovery only
 */
export async function resetAllCircuitBreakers(): Promise<void> {
  const response = await fetch('/.netlify/functions/circuit-breaker-reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resetAll: true }),
  });

  if (!response.ok) {
    throw new Error(`Failed to reset all circuit breakers: ${response.status}`);
  }
}

/**
 * Check if any circuit breakers are open
 * Quick check for error recovery UI
 */
export async function hasOpenCircuitBreakers(): Promise<boolean> {
  try {
    const status = await getCircuitBreakerStatus();
    return status.summary.anyOpen;
  } catch (error) {
    console.error('Failed to check circuit breaker status:', error);
    return false; // Assume no breakers open if check fails
  }
}
