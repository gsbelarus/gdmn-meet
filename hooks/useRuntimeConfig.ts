'use client';

import { useCallback, useEffect, useState } from 'react';
import { SOCKET_PATH } from '@/lib/constants';

type RuntimeConfig = {
  homeUrl: string;
  peerServerUrl: string;
  socketPath: string;
};

function buildBrowserConfig(): RuntimeConfig | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const homeUrl = window.location.origin;
  const peerUrl = new URL(homeUrl);

  if (peerUrl.hostname === 'localhost' || peerUrl.hostname === '127.0.0.1') {
    peerUrl.port = '4000';
  } else {
    const labels = peerUrl.hostname.split('.');

    if (labels[0] && !labels[0].endsWith('-peer')) {
      labels[0] = `${labels[0]}-peer`;
      peerUrl.hostname = labels.join('.');
    }

    peerUrl.port = '';
  }

  return {
    homeUrl,
    peerServerUrl: peerUrl.toString().replace(/\/$/, ''),
    socketPath: SOCKET_PATH,
  };
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(`/api/runtime-config?ts=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Unable to load runtime config (${response.status})`);
  }

  return (await response.json()) as RuntimeConfig;
}

export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    const browserConfig = buildBrowserConfig();

    if (browserConfig) {
      setConfig(browserConfig);
    }

    setLoading(true);
    setError(null);

    try {
      setConfig(await loadRuntimeConfig());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown runtime config error';

      setError(message);

      if (!browserConfig) {
        setConfig(null);
      }
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