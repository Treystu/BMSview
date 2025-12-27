/**
 * Circuit Breaker Service
 * 
 * Provides utilities for checking and managing circuit breaker states.
 * Used for diagnostic purposes and error recovery.
 * Supports both global and per-tool circuit breakers.
 */

export interface CircuitBreakerInfo {
  key?: string;
  toolName?: string;
  state: 'open' | 'closed' | 'half-open';
  failures: number;
  openUntil?: string | null;
  isOpen?: boolean;
  timeUntilReset?: number;
  totalRequests?: number;
  totalFailures?: number;
  failureRate?: string;
  lastFailureTime?: string | null;
}

export interface CircuitBreakerStatus {
  timestamp: string;
  global?: {
    breakers: CircuitBreakerInfo[];
    summary: {
      total: number;
      open: number;
      closed: number;
      anyOpen: boolean;
    };
  };
  tools?: {
    breakers: CircuitBreakerInfo[];
    summary: {
      total: number;
      open: number;
      halfOpen?: number;
      closed: number;
      anyOpen: boolean;
    };
  };
  overall?: {
    anyOpen: boolean;
    totalBreakers: number;
  };
  // Legacy support
  breakers?: CircuitBreakerInfo[];
  summary?: {
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
 * Reset a specific global circuit breaker by key
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
 * Reset a specific tool circuit breaker by name
 */
export async function resetToolCircuitBreaker(toolName: string): Promise<void> {
  const response = await fetch('/.netlify/functions/circuit-breaker-reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ toolName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to reset tool circuit breaker: ${response.status}`);
  }
}

/**
 * Reset all global circuit breakers
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
 * Reset all tool circuit breakers
 * Use with caution - for emergency recovery only
 */
export async function resetAllToolCircuitBreakers(): Promise<void> {
  const response = await fetch('/.netlify/functions/circuit-breaker-reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resetAllTools: true }),
  });

  if (!response.ok) {
    throw new Error(`Failed to reset all tool circuit breakers: ${response.status}`);
  }
}

/**
 * Check if any circuit breakers are open
 * Quick check for error recovery UI
 */
export async function hasOpenCircuitBreakers(): Promise<boolean> {
  try {
    const status = await getCircuitBreakerStatus();
    
    // Check new format first
    if (status.overall) {
      return status.overall.anyOpen;
    }
    
    // Fallback to legacy format
    return status.summary?.anyOpen || false;
  } catch (error) {
    console.error('Failed to check circuit breaker status:', error);
    return false; // Assume no breakers open if check fails
  }
}

/**
 * Get count of open circuit breakers by type
 */
export async function getOpenBreakerCounts(): Promise<{
  global: number;
  tools: number;
  total: number;
}> {
  try {
    const status = await getCircuitBreakerStatus();
    
    return {
      global: status.global?.summary.open || 0,
      tools: status.tools?.summary.open || 0,
      total: (status.global?.summary.open || 0) + (status.tools?.summary.open || 0)
    };
  } catch (error) {
    console.error('Failed to get open breaker counts:', error);
    return { global: 0, tools: 0, total: 0 };
  }
}
