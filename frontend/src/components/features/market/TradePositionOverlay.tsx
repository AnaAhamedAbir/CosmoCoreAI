import React, { useEffect, useMemo, useRef } from 'react';
import { IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import { OpenLimitOrder } from '@/hooks/useOpenOrders';
import { FastPositionResponse } from '@/services/manualTradeService';
import { subscribeLiveTradeTicks } from '@/hooks/useLevel2MarketData';
import {
  computeTradePnl,
  formatCompactPnl,
  resolveEffectiveEntryContext,
  resolveOrderEntryContext,
} from '@/utils/positionPnl';

export interface DragPnlPreview {
  orderId: string;
  price: number;
  isSL: boolean;
  isTP: boolean;
  side: 'buy' | 'sell';
  amount: number;
  entryPrice?: number;
}

interface PendingModSnapshot {
  orderId: string;
  newPrice: number;
  isSL: boolean;
  side: 'buy' | 'sell';
  amount: number;
  targetOrder: OpenLimitOrder;
}

interface TradePositionOverlayProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  symbol: string;
  exchange: string;
  currentPrice: number;
  activePosition?: FastPositionResponse | null;
  openOrders: OpenLimitOrder[];
  candlesReadyTick: number;
  isDark: boolean;
  pendingModification: PendingModSnapshot | null;
  dragPreviewRef: React.MutableRefObject<DragPnlPreview | null>;
  registerDragSyncRef: React.MutableRefObject<(() => void) | null>;
  formatPrice: (price: number | undefined | null) => string;
}

interface BadgeRowSpec {
  id: string;
  kind: 'entry' | 'tp' | 'sl';
  price: number;
  isDragging?: boolean;
  isPending?: boolean;
  isProfit: boolean;
  text: string;
}

/**
 * Modular pro-trader chart overlay that renders:
 * 1. An Entry Price horizontal line on fill (both Futures positions and Spot brackets)
 * 2. A live unrealized P/L pill anchored to the right end of the Entry line
 * 3. Projected P/L (+ R:R) pills on active SL and TP lines, updating at 60fps while dragging
 */
export const TradePositionOverlay: React.FC<TradePositionOverlayProps> = React.memo(({
  chart,
  series,
  symbol,
  exchange,
  currentPrice,
  activePosition,
  openOrders,
  candlesReadyTick,
  isDark,
  pendingModification,
  dragPreviewRef,
  registerDragSyncRef,
  formatPrice,
}) => {
  const entryLineRef = useRef<any>(null);
  const entryLineSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const livePriceRef = useRef<number>(currentPrice);
  const badgeElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const entryBadgeElRef = useRef<HTMLDivElement | null>(null);
  const entryBadgeTextRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentPrice > 0) {
      livePriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  const entryContext = useMemo(
    () => resolveEffectiveEntryContext(activePosition, openOrders, symbol),
    [activePosition, openOrders, symbol]
  );

  // Manage the horizontal Entry Price line cleanly on the active candlestick series
  useEffect(() => {
    if (!series) return;

    const removeEntryLine = () => {
      if (entryLineRef.current && entryLineSeriesRef.current) {
        try {
          entryLineSeriesRef.current.removePriceLine(entryLineRef.current);
        } catch {
          // series may already be disposed
        }
      }
      entryLineRef.current = null;
      entryLineSeriesRef.current = null;
    };

    if (!entryContext || entryContext.entryPrice <= 0) {
      removeEntryLine();
      return;
    }

    const sideTag = entryContext.side === 'long' ? 'LONG' : 'SHORT';
    const title = entryContext.source === 'spot_bracket'
      ? `ENTRY (${formatPrice(entryContext.entryPrice)})`
      : `${sideTag} ENTRY`;

    if (entryLineSeriesRef.current !== series) {
      removeEntryLine();
    }

    if (!entryLineRef.current) {
      entryLineRef.current = series.createPriceLine({
        price: entryContext.entryPrice,
        color: '#38bdf8',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
        axisLabelColor: '#0284c7',
        axisLabelTextColor: '#ffffff',
      });
      entryLineSeriesRef.current = series;
    } else {
      entryLineRef.current.applyOptions({
        price: entryContext.entryPrice,
        color: '#38bdf8',
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
        axisLabelColor: '#0284c7',
        axisLabelTextColor: '#ffffff',
      });
    }

    return () => {
      // Only dispose on unmount or series switch; updates reuse applyOptions above
    };
  }, [series, entryContext, candlesReadyTick, formatPrice]);

  // Ensure entry price line is removed cleanly when component unmounts or series changes
  useEffect(() => {
    return () => {
      if (entryLineRef.current && entryLineSeriesRef.current) {
        try {
          entryLineSeriesRef.current.removePriceLine(entryLineRef.current);
        } catch {
          // ignore
        }
      }
      entryLineRef.current = null;
      entryLineSeriesRef.current = null;
    };
  }, [series]);

  // Build static + pending-confirm SL/TP pill rows (drag override is applied imperatively at 60fps)
  const bracketSpecs = useMemo(() => {
    if (!entryContext) return [];

    const activeSlOrTp = (openOrders || []).filter(
      (o) => (Boolean(o.isSoftwareSL) || o.mode === 'TP') && o.price > 0
    );

    // Pair primary SL/TP risk for R:R badge when unambiguous
    const firstSl = activeSlOrTp.find((o) => Boolean(o.isSoftwareSL));
    const slRiskAbs = (() => {
      if (!firstSl) return 0;
      const slPx =
        pendingModification?.orderId === firstSl.id
          ? pendingModification.newPrice
          : firstSl.price;
      const slCtx = resolveOrderEntryContext(firstSl, entryContext);
      if (!slCtx) return 0;
      const slPnl = computeTradePnl({
        entryPrice: slCtx.entryPrice,
        targetPrice: slPx,
        amount: slCtx.amount,
        side: slCtx.side,
        isInverse: slCtx.isInverse,
        contracts: slCtx.contracts,
        contractSize: slCtx.contractSize,
      });
      return slPnl && slPnl.pnlUsd < 0 ? Math.abs(slPnl.pnlUsd) : 0;
    })();

    return activeSlOrTp
      .map((order) => {
        const isPending = pendingModification?.orderId === order.id;
        const effectivePx = isPending ? pendingModification!.newPrice : order.price;
        const orderCtx = resolveOrderEntryContext(order, entryContext);
        if (!orderCtx) return null;

        const pnl = computeTradePnl({
          entryPrice: orderCtx.entryPrice,
          targetPrice: effectivePx,
          amount: orderCtx.amount,
          side: orderCtx.side,
          isInverse: orderCtx.isInverse,
          contracts: orderCtx.contracts,
          contractSize: orderCtx.contractSize,
        });
        if (!pnl) return null;

        const isSL = Boolean(order.isSoftwareSL);
        const rrText =
          !isSL && slRiskAbs > 0 && pnl.pnlUsd > 0
            ? ` · ${(pnl.pnlUsd / slRiskAbs).toFixed(1)}R`
            : '';

        const prefix = isSL
          ? (pnl.pnlUsd >= 0 ? '🛡️ SL' : '🛑 SL')
          : '🎯 TP';

        return {
          id: `order-${order.id}`,
          order,
          orderCtx,
          kind: (isSL ? 'sl' : 'tp') as 'sl' | 'tp',
          price: effectivePx,
          isPending,
          isProfit: pnl.pnlUsd >= 0,
          text: `${prefix} ${formatCompactPnl(pnl.pnlUsd, pnl.pnlPct)}${rrText}`,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [openOrders, entryContext, pendingModification]);

  // Imperative 60fps sync for Entry live P/L pill + SL/TP pills + Live Drag P/L preview
  const syncPositionsAndLivePnl = useMemo(() => {
    return () => {
      if (!series || !entryContext) return;

      const rows: {
        key: string;
        el: HTMLDivElement;
        y: number;
      }[] = [];

      // 1. Entry Live P/L Pill
      const entryEl = entryBadgeElRef.current;
      const entryTxtEl = entryBadgeTextRef.current;
      if (entryEl && entryTxtEl) {
        const livePx = livePriceRef.current > 0 ? livePriceRef.current : entryContext.entryPrice;
        const livePnl = computeTradePnl({
          entryPrice: entryContext.entryPrice,
          targetPrice: livePx,
          amount: entryContext.amount,
          side: entryContext.side,
          isInverse: entryContext.isInverse,
          contracts: entryContext.contracts,
          contractSize: entryContext.contractSize,
        });
        const yCoord = series.priceToCoordinate(entryContext.entryPrice as any);
        if (livePnl && yCoord !== null && yCoord !== undefined && Number.isFinite(Number(yCoord))) {
          const isProfit = livePnl.pnlUsd >= 0;
          const sideText = entryContext.source === 'spot_bracket'
            ? 'SPOT'
            : (entryContext.side === 'long' ? 'LONG' : 'SHORT');
          const levText = entryContext.leverage ? ` ${entryContext.leverage}x` : '';
          entryTxtEl.textContent = `${sideText}${levText} · ${formatCompactPnl(livePnl.pnlUsd, livePnl.pnlPct)}`;
          entryEl.dataset.profit = isProfit ? 'true' : 'false';
          entryEl.className = `absolute right-1.5 flex items-center gap-1 px-2 h-[20px] rounded-md font-mono text-[10px] font-bold tracking-tight border shadow-sm transition-colors duration-75 whitespace-nowrap ${
            isProfit
              ? isDark
                ? 'bg-emerald-950/90 border-emerald-400/60 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                : 'bg-emerald-50/95 border-emerald-500/60 text-emerald-800'
              : isDark
                ? 'bg-rose-950/90 border-rose-400/60 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.25)]'
                : 'bg-rose-50/95 border-rose-500/60 text-rose-800'
          }`;
          entryEl.style.opacity = '1';
          rows.push({ key: '__entry__', el: entryEl, y: Number(yCoord) });
        } else {
          entryEl.style.opacity = '0';
        }
      }

      // 2. SL / TP Projected P/L Pills (with 60fps Drag Preview override)
      const activeDrag = dragPreviewRef.current;
      for (const spec of bracketSpecs) {
        const el = badgeElementsRef.current.get(spec.id);
        if (!el) continue;

        const isBeingDragged = Boolean(activeDrag && activeDrag.orderId === spec.order.id);
        const effPrice = isBeingDragged ? activeDrag!.price : spec.price;
        const yCoord = series.priceToCoordinate(effPrice as any);

        if (yCoord === null || yCoord === undefined || !Number.isFinite(Number(yCoord))) {
          el.style.opacity = '0';
          continue;
        }

        let displayText = spec.text;
        let isProfit = spec.isProfit;

        if (isBeingDragged) {
          const dragPnl = computeTradePnl({
            entryPrice: spec.orderCtx.entryPrice,
            targetPrice: effPrice,
            amount: spec.orderCtx.amount,
            side: spec.orderCtx.side,
            isInverse: spec.orderCtx.isInverse,
            contracts: spec.orderCtx.contracts,
            contractSize: spec.orderCtx.contractSize,
          });
          if (dragPnl) {
            isProfit = dragPnl.pnlUsd >= 0;
            const prefix = spec.kind === 'sl' ? (isProfit ? '🛡️ SL' : '🛑 SL') : '🎯 TP';
            displayText = `${prefix} ${formatCompactPnl(dragPnl.pnlUsd, dragPnl.pnlPct)}`;
          }
        }

        const span = el.firstElementChild as HTMLSpanElement | null;
        if (span && span.textContent !== displayText) {
          span.textContent = displayText;
        }

        const borderHighlight = isBeingDragged
          ? 'ring-1 ring-amber-400/90 shadow-md'
          : spec.isPending
            ? 'ring-1 ring-amber-400/70'
            : '';

        el.className = `absolute right-1.5 flex items-center gap-1 px-1.5 h-[19px] rounded font-mono text-[10px] font-bold tracking-tight border whitespace-nowrap ${borderHighlight} ${
          isProfit
            ? isDark
              ? 'bg-emerald-950/88 border-emerald-500/50 text-emerald-300'
              : 'bg-emerald-50/95 border-emerald-500/50 text-emerald-800'
            : isDark
              ? 'bg-rose-950/88 border-rose-500/50 text-rose-300'
              : 'bg-rose-50/95 border-rose-500/50 text-rose-800'
        }`;
        el.style.opacity = '1';
        rows.push({ key: spec.id, el, y: Number(yCoord) });
      }

      // 3. Anti-collision vertical nudging so adjacent pills never overlap unreadably
      rows.sort((a, b) => a.y - b.y);
      const minGapPx = 21;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].y - rows[i - 1].y < minGapPx) {
          rows[i].y = rows[i - 1].y + minGapPx;
        }
      }

      for (const row of rows) {
        const clampedY = Math.max(12, row.y);
        row.el.style.transform = `translate3d(0, ${Math.round(clampedY - 10)}px, 0)`;
      }
    };
  }, [series, entryContext, bracketSpecs, isDark, dragPreviewRef]);

  // Schedule rAF coordinate & P/L sync
  const scheduleSync = useMemo(() => {
    return () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        syncPositionsAndLivePnl();
      });
    };
  }, [syncPositionsAndLivePnl]);

  // Register imperative drag sync callback for 60fps drag-P/L updates
  useEffect(() => {
    registerDragSyncRef.current = scheduleSync;
    return () => {
      if (registerDragSyncRef.current === scheduleSync) {
        registerDragSyncRef.current = null;
      }
    };
  }, [registerDragSyncRef, scheduleSync]);

  // Subscribe to live trade ticks, pan/zoom range changes, and resizes
  useEffect(() => {
    if (!entryContext || !series || !chart) return;

    scheduleSync();

    const unsubTicks = subscribeLiveTradeTicks(symbol, exchange, (tick) => {
      if (tick?.price && tick.price > 0) {
        livePriceRef.current = tick.price;
        scheduleSync();
      }
    });

    const timeScale = chart.timeScale();
    const handleRangeChange = () => scheduleSync();
    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    chart.subscribeCrosshairMove(handleRangeChange);

    let ro: ResizeObserver | null = null;
    const parentEl = entryBadgeElRef.current?.parentElement;
    if (parentEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => scheduleSync());
      ro.observe(parentEl);
    }

    return () => {
      unsubTicks();
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
        chart.unsubscribeCrosshairMove(handleRangeChange);
      } catch {
        // chart may already be disposed
      }
      ro?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [chart, series, symbol, exchange, entryContext, bracketSpecs, candlesReadyTick, scheduleSync]);

  // Also sync whenever currentPrice or entryContext changes
  useEffect(() => {
    if (entryContext) {
      scheduleSync();
    }
  }, [currentPrice, entryContext, bracketSpecs, scheduleSync]);

  if (!entryContext) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {/* Entry Line Right-Edge Live P/L Badge */}
      <div
        ref={entryBadgeElRef}
        style={{ top: 0, opacity: 0, willChange: 'transform' }}
        className="absolute right-1.5 flex items-center gap-1 px-2 h-[20px] rounded-md font-mono text-[10px] font-bold tracking-tight border whitespace-nowrap"
      >
        <span ref={entryBadgeTextRef} />
      </div>

      {/* SL & TP Right-Edge Projected P/L Pills */}
      {bracketSpecs.map((spec) => (
        <div
          key={spec.id}
          ref={(node) => {
            if (node) {
              badgeElementsRef.current.set(spec.id, node);
            } else {
              badgeElementsRef.current.delete(spec.id);
            }
          }}
          style={{ top: 0, opacity: 0, willChange: 'transform' }}
          className="absolute right-1.5 flex items-center gap-1 px-1.5 h-[19px] rounded font-mono text-[10px] font-bold tracking-tight border whitespace-nowrap"
        >
          <span>{spec.text}</span>
        </div>
      ))}
    </div>
  );
});
