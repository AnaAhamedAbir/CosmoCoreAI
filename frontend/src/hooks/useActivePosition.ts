import { useState, useEffect, useRef, useCallback } from 'react';
import { manualTradeService, FastPositionResponse } from '../services/manualTradeService';
import { getThermalProfile } from '@/utils/deviceProfile';

/**
 * Live polling hook for the active Futures position (entry, mark, PnL, and liquidation price).
 * Only active for Futures symbols (containing ':'); returns null on Spot.
 */
export const useActivePosition = (
  apiKeyId: string | number | null,
  symbol: string,
  intervalMs?: number,
  enabled: boolean = true
): FastPositionResponse | null => {
  const [position, setPosition] = useState<FastPositionResponse | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);
  const isMountedRef = useRef(true);

  const isFutures = Boolean(symbol && symbol.includes(':'));
  const thermalProfile = getThermalProfile();
  const effectiveIntervalMs =
    intervalMs === undefined || thermalProfile.isThermalGuardActive
      ? Math.max(intervalMs ?? 2500, thermalProfile.timings.openOrdersPollMs)
      : Math.max(intervalMs, 2000);

  const fetchPosition = useCallback(async (forceRefresh: boolean = false) => {
    if (
      !enabled ||
      !isFutures ||
      !apiKeyId ||
      !symbol ||
      !isVisibleRef.current ||
      !isMountedRef.current ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    try {
      const pos = await manualTradeService.getActivePosition(Number(apiKeyId), symbol, forceRefresh);
      if (isMountedRef.current && enabled && isFutures) {
        setPosition(pos ?? null);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.debug('[useActivePosition] poll error:', err);
      }
    }
  }, [apiKeyId, symbol, enabled, isFutures]);

  useEffect(() => {
    const handleVisibility = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      if (isVisibleRef.current && enabled && isFutures) {
        fetchPosition(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchPosition, enabled, isFutures]);

  useEffect(() => {
    const handleRefresh = () => {
      if (enabled && isFutures) {
        manualTradeService.invalidatePollCache(apiKeyId);
        fetchPosition(true);
      }
    };
    window.addEventListener('refreshOpenOrders', handleRefresh);
    window.addEventListener('refreshActivePosition', handleRefresh);
    return () => {
      window.removeEventListener('refreshOpenOrders', handleRefresh);
      window.removeEventListener('refreshActivePosition', handleRefresh);
    };
  }, [fetchPosition, enabled, isFutures, apiKeyId]);

  useEffect(() => {
    if (!enabled || !isFutures || !apiKeyId || !symbol) {
      isMountedRef.current = false;
      setPosition(null);
      return;
    }

    isMountedRef.current = true;
    fetchPosition();
    timerRef.current = setInterval(fetchPosition, effectiveIntervalMs);

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchPosition, effectiveIntervalMs, enabled, isFutures, apiKeyId, symbol]);

  return position;
};
