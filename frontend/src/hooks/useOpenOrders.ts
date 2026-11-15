import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { getThermalProfile } from '@/utils/deviceProfile';

export interface OpenLimitOrder {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  isSoftwareSL?: boolean;
  mode?: string;
  type?: string;
  isIceberg?: boolean;
  icebergQty?: number;
}

/**
 * Live polling hook for open limit orders on the selected exchange API.
 *
 * BUG-05 fix: isMountedRef guards against state updates on unmounted component
 *             and stale fetches after apiKeyId/symbol changes.
 * BUG-11 fix: Dev-only debug logging so errors are visible during development
 *             without polluting production console.
 *
 * - Polls every `intervalMs` (default 2s desktop, 6s on thermal-guarded devices)
 * - Pauses automatically when the browser tab is hidden (Page Visibility API)
 * - On error, backs off silently in production
 */
export const useOpenOrders = (
  apiKeyId: string | number | null,
  symbol: string,
  intervalMs?: number,
  enabled: boolean = true
): OpenLimitOrder[] => {
  const [orders, setOrders] = useState<OpenLimitOrder[]>([]);
  const ordersRef = useRef<OpenLimitOrder[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true);
  const isMountedRef = useRef(true); // BUG-05: mount guard
  // Short-lived optimistic tombstone IDs so in-flight HTTP polls cannot resurrect cancelled lines
  const tombstoneMapRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const thermalProfile = getThermalProfile();
  const effectiveIntervalMs =
    intervalMs === undefined || thermalProfile.isThermalGuardActive
      ? Math.max(intervalMs ?? 2000, thermalProfile.timings.openOrdersPollMs)
      : intervalMs;

  const fetchOrders = useCallback(async () => {
    // BUG-05 fix: skip stale fetches after unmount, when disabled, or when tab is hidden
    if (
      !enabled ||
      !apiKeyId ||
      !symbol ||
      !isVisibleRef.current ||
      !isMountedRef.current ||
      (typeof document !== 'undefined' && document.hidden)
    ) {
      return;
    }
    try {
      const [res, slRes] = await Promise.all([
        api.get(`/trading/open-limit-orders/${apiKeyId}?symbol=${encodeURIComponent(symbol)}`).catch(() => ({ data: { orders: [] } })),
        api.get(`/trading/active-software-brackets/${apiKeyId}?symbol=${encodeURIComponent(symbol)}`).catch(() => ({ data: [] }))
      ]);

      // Guard again after await — component may have unmounted or been disabled during the request
      if (isMountedRef.current && enabled) {
        const now = Date.now();
        const tombstones = tombstoneMapRef.current;
        for (const [tid, exp] of tombstones.entries()) {
          if (exp <= now) tombstones.delete(tid);
        }

        const limitOrders = (res.data?.orders ?? []).map((o: any) => ({
          ...o,
          isIceberg: Boolean(o.isIceberg),
          icebergQty: o.icebergQty ? Number(o.icebergQty) : undefined
        }));
        const rawSLs = Array.isArray(slRes.data) ? slRes.data : [];
        const softwareSLs = rawSLs
          .filter((sl: any) => sl.status !== 'chasing' && sl.status !== 'pegging' && sl.type !== 'smart_peg')
          .map((sl: any) => ({
            id: String(sl.id),
            side: sl.side,
            price: Number(sl.trigger_price ?? sl.price ?? 0),
            amount: Number(sl.amount ?? 0),
            filled: 0,
            remaining: Number(sl.amount ?? 0),
            isSoftwareSL: true,
            mode: sl.mode,
            type: sl.type
          }))
          .filter((sl: any) => sl.price > 0);
        const deduped = new Map<string, OpenLimitOrder>();
        for (const o of limitOrders) {
          if (o?.id !== undefined && o?.id !== null && String(o.id) !== '') {
            const id = String(o.id);
            const exp = tombstones.get(id);
            if (exp && exp > now) continue;
            deduped.set(id, { ...o, id });
          }
        }
        for (const sl of softwareSLs) {
          if (sl.id) {
            const id = String(sl.id);
            const exp = tombstones.get(id);
            if (exp && exp > now) continue;
            deduped.set(id, sl);
          }
        }
        setOrders(Array.from(deduped.values()));
      }
    } catch (err) {
      // BUG-11 fix: dev-only logging, silent in production
      if (import.meta.env.DEV) {
        console.debug('[useOpenOrders] poll error:', err);
      }
    }
  }, [apiKeyId, symbol, enabled]);

  // Page Visibility API — pause polling when tab is hidden
  useEffect(() => {
    const handleVisibility = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      if (isVisibleRef.current && enabled) fetchOrders(); // Immediate refresh on tab focus
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchOrders, enabled]);

  // Immediate refresh & 0ms optimistic cancellation sync on custom events
  useEffect(() => {
    const handleRefresh = () => {
      if (enabled) fetchOrders();
    };
    const handleOptimisticRemove = (e: Event) => {
      if (!enabled) return;
      const detail = (e as CustomEvent<{
        orderId?: string;
        orderIds?: string[];
        apiKeyId?: string | number;
      }>).detail;
      if (detail?.apiKeyId !== undefined && detail?.apiKeyId !== null && String(detail.apiKeyId) !== String(apiKeyId)) {
        return;
      }
      const targets = new Set<string>();
      if (detail?.orderId) targets.add(String(detail.orderId));
      if (Array.isArray(detail?.orderIds)) {
        for (const id of detail.orderIds) {
          if (id) targets.add(String(id));
        }
      }
      if (targets.size === 0) return;

      const expiry = Date.now() + 5000;
      targets.forEach((id) => tombstoneMapRef.current.set(id, expiry));
      setOrders((prev) => prev.filter((o) => !targets.has(String(o.id))));
    };
    const handleOptimisticClear = (e: Event) => {
      if (!enabled) return;
      const detail = (e as CustomEvent<{ apiKeyId?: string | number }> | undefined)?.detail;
      if (detail?.apiKeyId !== undefined && detail?.apiKeyId !== null && String(detail.apiKeyId) !== String(apiKeyId)) {
        return;
      }
      const expiry = Date.now() + 5000;
      for (const o of ordersRef.current) {
        if (o?.id) tombstoneMapRef.current.set(String(o.id), expiry);
      }
      setOrders([]);
    };
    const handleRollbackRemove = (e: Event) => {
      if (!enabled) return;
      const detail = (e as CustomEvent<{ orderIds?: string[] }> | undefined)?.detail;
      if (Array.isArray(detail?.orderIds) && detail.orderIds.length > 0) {
        for (const id of detail.orderIds) {
          if (id) tombstoneMapRef.current.delete(String(id));
        }
      } else {
        tombstoneMapRef.current.clear();
      }
      fetchOrders();
    };

    window.addEventListener('refreshOpenOrders', handleRefresh);
    window.addEventListener('optimisticRemoveOpenOrder', handleOptimisticRemove);
    window.addEventListener('optimisticClearOpenOrders', handleOptimisticClear);
    window.addEventListener('rollbackRemoveOpenOrder', handleRollbackRemove);
    return () => {
      window.removeEventListener('refreshOpenOrders', handleRefresh);
      window.removeEventListener('optimisticRemoveOpenOrder', handleOptimisticRemove);
      window.removeEventListener('optimisticClearOpenOrders', handleOptimisticClear);
      window.removeEventListener('rollbackRemoveOpenOrder', handleRollbackRemove);
    };
  }, [fetchOrders, enabled, apiKeyId]);

  // Polling loop with proper mount guard
  useEffect(() => {
    if (!enabled || !apiKeyId || !symbol) {
      isMountedRef.current = false;
      setOrders([]);
      return;
    }

    isMountedRef.current = true; // BUG-05: mark mounted on (re)run

    fetchOrders(); // Immediate fetch on mount or dependency change
    timerRef.current = setInterval(fetchOrders, effectiveIntervalMs);

    return () => {
      isMountedRef.current = false; // BUG-05: mark unmounted before cleanup
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchOrders, effectiveIntervalMs, enabled, apiKeyId, symbol]);

  return orders;
};
