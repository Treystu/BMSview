
import { useState, useEffect, useRef, useCallback } from 'react';

export interface SystemStatus {
  timestamp: string;
  analysis: {
    events?: any[];
    count?: number;
    error?: string;
  };
  health: {
    mongodb: string;
    uptime?: number;
    memory?: any;
    recentAnalyses?: number;
    error?: string;
  };
  insights: {
    activeJobs?: any[];
    count?: number;
    error?: string;
  };
}

interface PollingConfig {
  activeInterval?: number;
  idleInterval?: number;
  errorInterval?: number;
}

const DEFAULT_CONFIG: Required<PollingConfig> = {
  activeInterval: 5000,
  idleInterval: 30000,
  errorInterval: 15000
};

export function useAdaptivePolling(config: PollingConfig = {}) {
  const { activeInterval, idleInterval, errorInterval } = { ...DEFAULT_CONFIG, ...config };
  
  const [data, setData] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIdle, setIsIdle] = useState(false);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Activity detection
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;
    
    const resetIdle = () => {
      setIsIdle(false);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setIsIdle(true), 60000); // Idle after 1 min no interaction
    };

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keypress', resetIdle);
    window.addEventListener('click', resetIdle);
    
    resetIdle();

    return () => {
      window.removeEventListener('mousemove', resetIdle);
      window.removeEventListener('keypress', resetIdle);
      window.removeEventListener('click', resetIdle);
      clearTimeout(idleTimer);
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!mountedRef.current) return;
    
    // Skip if tab is hidden
    if (document.hidden) return;

    setLoading(true);
    try {
      const response = await fetch('/.netlify/functions/poll-updates');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const result = await response.json();
      if (mountedRef.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Polling failed');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    
    const loop = async () => {
      await fetchData();
      
      let nextInterval = activeInterval;
      if (error) nextInterval = errorInterval;
      else if (isIdle) nextInterval = idleInterval;
      
      if (mountedRef.current) {
        timeoutRef.current = setTimeout(loop, nextInterval);
      }
    };

    loop();

    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [fetchData, activeInterval, idleInterval, errorInterval, isIdle, error]);

  return { data, loading, error, isIdle };
}
