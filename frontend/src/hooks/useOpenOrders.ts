import { useState, useEffect, useRef, useCallback } from 'react';
import { manualTradeService } from '../services/manualTradeService';
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
  rawType?: string;
  entryPrice?: number;
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
  // Short-lived optimistic added/synced order lines so chart renders at 0ms even during in-flight HTTP polls
  const optimisticOrdersRef = useRef<Map<string, OpenLimitOrder & { _exp: number }>>(new Map());

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
      const numKey = Number(apiKeyId);
      const [openOrdersData, slData] = await Promise.all([
        manualTradeService.getOpenLimitOrders(numKey, symbol).catch(() => ({ orders: [] })),
        manualTradeService.getActiveSoftwareBrackets(numKey, symbol).catch(() => [])
      ]);

      // Guard again after await — component may have unmounted or been disabled during the request
      if (isMountedRef.current && enabled) {
        const now = Date.now();
        const tombstones = tombstoneMapRef.current;
        for (const [tid, exp] of tombstones.entries()) {
          if (exp <= now) tombstones.delete(tid);
        }

        const limitOrders = (openOrdersData?.orders ?? (Array.isArray(openOrdersData) ? openOrdersData : [])).map((o: any) => ({
          ...o,
          entryPrice: o.entryPrice ? Number(o.entryPrice) : undefined,
          isIceberg: Boolean(o.isIceberg),
          icebergQty: o.icebergQty ? Number(o.icebergQty) : undefined
        }));
        const rawSLs = Array.isArray(slData) ? slData : [];
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
            type: sl.type,
            entryPrice: sl.entry_price ? Number(sl.entry_price) : undefined,
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
        const optMap = optimisticOrdersRef.current;
        for (const [oid, optOrder] of optMap.entries()) {
          const tExp = tombstones.get(oid);
          if (deduped.has(oid) || optOrder._exp <= now || (tExp && tExp > now)) {
            optMap.delete(oid);
          } else {
            const { _exp, ...cleanOrder } = optOrder;
            deduped.set(oid, cleanOrder);
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
      if (enabled) {
        manualTradeService.invalidatePollCache(apiKeyId);
        fetchOrders();
      }
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
      targets.forEach((id) => {
        tombstoneMapRef.current.set(id, expiry);
        optimisticOrdersRef.current.delete(id);
      });
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
      optimisticOrdersRef.current.clear();
      setOrders([]);
    };
    const handleOptimisticAdd = (e: Event) => {
      if (!enabled) return;
      const detail = (e as CustomEvent<{
        order?: OpenLimitOrder;
        orders?: OpenLimitOrder[];
        replaceId?: string;
        apiKeyId?: string | number;
        symbol?: string;
      }>).detail;
      if (!detail) return;
      if (detail.apiKeyId !== undefined && detail.apiKeyId !== null && String(detail.apiKeyId) !== String(apiKeyId)) {
        return;
      }
      if (detail.symbol && symbol && String(detail.symbol).trim().toUpperCase() !== String(symbol).trim().toUpperCase()) {
        return;
      }
      const incoming = [
        ...(Array.isArray(detail.orders) ? detail.orders : []),
        ...(detail.order ? [detail.order] : []),
      ].filter((o) => o && o.id && Number(o.price) > 0);
      if (incoming.length === 0 && !detail.replaceId) return;

      const repId = detail.replaceId ? String(detail.replaceId) : '';
      if (repId) {
        optimisticOrdersRef.current.delete(repId);
        tombstoneMapRef.current.set(repId, Date.now() + 5000);
      }

      const exp = Date.now() + 4500;
      for (const raw of incoming) {
        const oid = String(raw.id);
        const existingOpt = optimisticOrdersRef.current.get(oid);
        const existingCur = ordersRef.current.find((o) => String(o.id) === oid);
        const preservedEntryPrice =
          raw.entryPrice !== undefined ? raw.entryPrice : (existingOpt?.entryPrice ?? existingCur?.entryPrice);
        const preservedRawType =
          raw.rawType !== undefined ? raw.rawType : (existingOpt?.rawType ?? existingCur?.rawType);
        tombstoneMapRef.current.delete(oid);
        optimisticOrdersRef.current.set(oid, {
          ...raw,
          id: oid,
          price: Number(raw.price),
          amount: Number(raw.amount ?? 0),
          filled: Number(raw.filled ?? 0),
          remaining: Number(raw.remaining ?? raw.amount ?? 0),
          ...(preservedEntryPrice !== undefined ? { entryPrice: preservedEntryPrice } : {}),
          ...(preservedRawType !== undefined ? { rawType: preservedRawType } : {}),
          _exp: exp,
        });
      }

      setOrders((prev) => {
        const nextMap = new Map<string, OpenLimitOrder>();
        for (const o of prev) {
          const oid = String(o.id);
          if (repId && oid === repId) continue;
          nextMap.set(oid, o);
        }
        for (const raw of incoming) {
          const oid = String(raw.id);
          const existing = nextMap.get(oid);
          const preservedEntryPrice =
            raw.entryPrice !== undefined ? raw.entryPrice : existing?.entryPrice;
          const preservedRawType =
            raw.rawType !== undefined ? raw.rawType : existing?.rawType;
          nextMap.set(oid, {
            ...raw,
            id: oid,
            price: Number(raw.price),
            amount: Number(raw.amount ?? 0),
            filled: Number(raw.filled ?? 0),
            remaining: Number(raw.remaining ?? raw.amount ?? 0),
            ...(preservedEntryPrice !== undefined ? { entryPrice: preservedEntryPrice } : {}),
            ...(preservedRawType !== undefined ? { rawType: preservedRawType } : {}),
          });
        }
        return Array.from(nextMap.values());
      });
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

    const handleOptimisticSwap = (event: Event) => {
      if (!enabled) return;
      const detail = (event as CustomEvent<{ oldOrderId?: string; newOrderId?: string; newPrice?: number }>).detail;
      const oldId = detail?.oldOrderId ? String(detail.oldOrderId) : '';
      const newId = detail?.newOrderId ? String(detail.newOrderId) : '';
      if (!oldId) return;
      const resolvedId = newId || oldId;

      if (oldId !== resolvedId) {
        optimisticOrdersRef.current.delete(oldId);
        tombstoneMapRef.current.set(oldId, Date.now() + 5000);
      }

      const existing = ordersRef.current.find((o) => String(o.id) === oldId) || optimisticOrdersRef.current.get(oldId);
      if (existing) {
        const updatedOrder: OpenLimitOrder = {
          ...existing,
          id: resolvedId,
          price: typeof detail.newPrice === 'number' ? detail.newPrice : existing.price,
        };
        tombstoneMapRef.current.delete(resolvedId);
        optimisticOrdersRef.current.set(resolvedId, {
          ...updatedOrder,
          _exp: Date.now() + 3500,
        });
      }

      setOrders((prev) => {
        const nextMap = new Map<string, OpenLimitOrder>();
        for (const o of prev) {
          const oid = String(o.id);
          if (oid === oldId) {
            const updated: OpenLimitOrder = {
              ...o,
              id: resolvedId,
              price: typeof detail.newPrice === 'number' ? detail.newPrice : o.price,
            };
            if (!nextMap.has(resolvedId)) {
              nextMap.set(resolvedId, updated);
            }
          } else {
            nextMap.set(oid, o);
          }
        }
        return Array.from(nextMap.values());
      });
    };

    window.addEventListener('refreshOpenOrders', handleRefresh);
    window.addEventListener('optimisticAddOpenOrder', handleOptimisticAdd);
    window.addEventListener('optimisticRemoveOpenOrder', handleOptimisticRemove);
    window.addEventListener('optimisticClearOpenOrders', handleOptimisticClear);
    window.addEventListener('rollbackRemoveOpenOrder', handleRollbackRemove);
    window.addEventListener('optimisticSwapOpenOrder', handleOptimisticSwap);
    return () => {
      window.removeEventListener('refreshOpenOrders', handleRefresh);
      window.removeEventListener('optimisticAddOpenOrder', handleOptimisticAdd);
      window.removeEventListener('optimisticRemoveOpenOrder', handleOptimisticRemove);
      window.removeEventListener('optimisticClearOpenOrders', handleOptimisticClear);
      window.removeEventListener('rollbackRemoveOpenOrder', handleRollbackRemove);
      window.removeEventListener('optimisticSwapOpenOrder', handleOptimisticSwap);
    };
  }, [fetchOrders, enabled, apiKeyId, symbol]);

  // Polling loop with proper mount guard
  useEffect(() => {
    if (!enabled || !apiKeyId || !symbol) {
      isMountedRef.current = false;
      optimisticOrdersRef.current.clear();
      tombstoneMapRef.current.clear();
      setOrders([]);
      return;
    }

    isMountedRef.current = true; // BUG-05: mark mounted on (re)run
    optimisticOrdersRef.current.clear();
    tombstoneMapRef.current.clear();

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
