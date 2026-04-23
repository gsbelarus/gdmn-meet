'use client';

import { useCallback, useEffect, useState } from 'react';
import { WebRTCConfig } from './types';

async function loadWebRTCConfig(): Promise<WebRTCConfig> {
  const response = await fetch(`/api/webrtc-config?ts=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Unable to load WebRTC config (${response.status})`);
  }

  return (await response.json()) as WebRTCConfig;
}

export function useWebRTCConfig() {
  const [config, setConfig] = useState<WebRTCConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setConfig(await loadWebRTCConfig());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown WebRTC config error';
      setError(message);
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    loading,
    error,
    refetch: fetchConfig,
  };
}
