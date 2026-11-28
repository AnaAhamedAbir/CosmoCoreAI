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
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const livePriceRef = useRef<number>(currentPrice);
  const badgeElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const entryBadgeElRef = useRef<HTMLDivElement | null>(null);
  const entryBadgeTextRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    livePriceRef.current = currentPrice > 0 ? currentPrice : 0;
  }, [symbol, exchange]);

  useEffect(() => {
    if (currentPrice > 0) {
      livePriceRef.current = currentPrice;
    }
  }, [currentPrice]);

  const entryContext = useMemo(
    () => resolveEffectiveEntryContext(activePosition, openOrders, symbol),
    [activePosition, openOrders, symbol]
  );

  // Manage the horizontal Entry Price line cleanly on the active candlestick series.
  // Keep native title empty so TradePositionOverlay owns the single Entry + P/L pill without colliding with BID/ASK.
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
        title: '',
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
        title: '',
        axisLabelColor: '#0284c7',
        axisLabelTextColor: '#ffffff',
      });
    }

    return () => {
      // Only dispose on unmount or series switch; updates reuse applyOptions above
    };
  }, [series, entryContext, candlesReadyTick]);

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

  const formatBracketLabel = (
    order: OpenLimitOrder,
    pnlUsd: number,
    pnlPct: number,
    rrText: string = ''
  ): string => {
    const isSL = Boolean(order.isSoftwareSL);
    const rawQty = Number(order.remaining > 0 ? order.remaining : order.amount) || 0;
    const qtyStr = rawQty > 0 ? ` ${rawQty >= 1 ? rawQty.toFixed(2) : rawQty.toFixed(4)}` : '';
    if (isSL) {
      const modeUpper = String(order.mode || '').toUpperCase();
      const typeUpper = String(order.type || '').toUpperCase();
      const modeTag =
        modeUpper === 'TRAILING_CHASE' || typeUpper === 'TRAILING_CHASE'
          ? 'TRAIL CHASE'
          : modeUpper === 'SMART_CHASE'
            ? 'SMART CHASE'
            : modeUpper === 'TRAILING'
              ? 'TRAIL'
              : 'SL';
      const icon = pnlUsd >= 0 ? '🛡️' : '🛑';
      const prefix = modeTag === 'SL' ? `${icon} SL` : `${icon} ${modeTag}`;
      return `${prefix}${qtyStr} · ${formatCompactPnl(pnlUsd, pnlPct)}`;
    }
    return `🎯 TP${qtyStr} · ${formatCompactPnl(pnlUsd, pnlPct)}${rrText}`;
  };

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

        return {
          id: `order-${order.id}`,
          order,
          orderCtx,
          kind: (isSL ? 'sl' : 'tp') as 'sl' | 'tp',
          price: effectivePx,
          isPending,
          isProfit: pnl.pnlUsd >= 0,
          text: formatBracketLabel(order, pnl.pnlUsd, pnl.pnlPct, rrText),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [openOrders, entryContext, pendingModification]);

  const applyPillVisualStyle = (
    el: HTMLDivElement,
    opts: {
      kind: 'entry' | 'sl' | 'tp';
      isProfit: boolean;
      isDarkMode: boolean;
      isBeingDragged?: boolean;
      isPending?: boolean;
      rightPx: number;
    }
  ) => {
    const { kind, isProfit, isDarkMode, isBeingDragged, isPending, rightPx } = opts;

    // Explicit solid high-contrast inline colors so Tailwind JIT / opacity steps never turn cards transparent
    let bg: string;
    let border: string;
    let textColor: string;
    let shadow: string;

    if (isDarkMode) {
      if (isProfit) {
        bg = kind === 'entry' ? '#042f24' : '#052e20';
        border = kind === 'entry' ? '#34d399' : '#22c55e';
        textColor = '#ecfdf5';
      } else {
        bg = kind === 'entry' ? '#420a18' : '#3a0915';
        border = kind === 'entry' ? '#fb7185' : '#ef4444';
        textColor = '#ffe4e6';
      }
      shadow = '0 2px 10px rgba(0, 0, 0, 0.88)';
    } else {
      if (isProfit) {
        bg = '#ecfdf5';
        border = '#10b981';
        textColor = '#064e3b';
      } else {
        bg = '#fff1f2';
        border = '#f43f5e';
        textColor = '#881337';
      }
      shadow = '0 2px 6px rgba(15, 23, 42, 0.16)';
    }

    if (isBeingDragged) {
      shadow = isDarkMode
        ? '0 0 0 2px #f59e0b, 0 4px 14px rgba(0, 0, 0, 0.92)'
        : '0 0 0 2px #f59e0b, 0 4px 10px rgba(15, 23, 42, 0.22)';
    } else if (isPending) {
      shadow = isDarkMode
        ? '0 0 0 1.5px #fbbf24, 0 2px 10px rgba(0, 0, 0, 0.85)'
        : '0 0 0 1.5px #f59e0b, 0 2px 6px rgba(15, 23, 42, 0.16)';
    }

    el.style.right = `${rightPx}px`;
    el.style.maxWidth = `calc(100% - ${rightPx + 8}px)`;
    el.style.backgroundColor = bg;
    el.style.borderColor = border;
    el.style.borderLeftColor = kind === 'entry' ? (isDarkMode ? '#38bdf8' : '#0284c7') : border;
    el.style.borderLeftWidth = kind === 'entry' ? '3px' : '1px';
    el.style.color = textColor;
    el.style.boxShadow = shadow;
  };

  // Imperative 60fps sync for Entry live P/L pill + SL/TP pills + Live Drag P/L preview
  const syncPositionsAndLivePnl = useMemo(() => {
    return () => {
      if (!series || !entryContext) return;

      // Dynamically measure the exact width of the right price scale so pills align cleanly
      // just left of the BID / ASK / ▲ lane (~54px) and NEVER intrude on Y-axis numbers or price bars.
      let priceScaleWidth = 68;
      try {
        const measured = chart?.priceScale('right')?.width();
        if (measured && Number.isFinite(measured) && measured > 24) {
          priceScaleWidth = measured;
        }
      } catch {
        // ignore if chart is tearing down
      }
      const rightLaneOffsetPx = Math.round(priceScaleWidth) + 54;

      const rows: {
        key: string;
        el: HTMLDivElement;
        y: number;
      }[] = [];

      // 1. Entry Live P/L Pill (with off-screen directional indicator when panned/zoomed away)
      const paneHeight = containerElRef.current?.clientHeight || 600;
      const minY = 12;
      const maxY = Math.max(minY + 24, paneHeight - 14);
      const minGapPx = 24;

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
          const rawY = Number(yCoord);
          const offPrefix = rawY < minY ? '▲ ' : rawY > maxY ? '▼ ' : '';
          const isProfit = livePnl.pnlUsd >= 0;
          const sideText = entryContext.source === 'spot_bracket'
            ? 'SPOT ENTRY'
            : (entryContext.side === 'long' ? 'LONG' : 'SHORT');
          const levText = entryContext.leverage ? ` ${entryContext.leverage}x` : '';
          entryTxtEl.textContent = `${offPrefix}${sideText}${levText} · ${formatCompactPnl(livePnl.pnlUsd, livePnl.pnlPct)}`;
          entryEl.dataset.profit = isProfit ? 'true' : 'false';
          applyPillVisualStyle(entryEl, {
            kind: 'entry',
            isProfit,
            isDarkMode: isDark,
            rightPx: rightLaneOffsetPx,
          });
          entryEl.style.opacity = offPrefix ? '0.86' : '1';
          rows.push({ key: '__entry__', el: entryEl, y: Math.max(minY, Math.min(maxY, rawY)) });
        } else {
          entryEl.style.opacity = '0';
        }
      }

      // 2. SL / TP Projected P/L Pills (with live 60fps Drag Preview + live R:R recalculation during BOTH SL & TP drag)
      const activeDrag = dragPreviewRef.current;
      const primarySlSpec = bracketSpecs.find((s) => s.kind === 'sl');
      let liveSlRiskAbs = 0;
      if (primarySlSpec) {
        const slEffPx =
          activeDrag && activeDrag.orderId === primarySlSpec.order.id
            ? activeDrag.price
            : primarySlSpec.price;
        const slLivePnl = computeTradePnl({
          entryPrice: primarySlSpec.orderCtx.entryPrice,
          targetPrice: slEffPx,
          amount: primarySlSpec.orderCtx.amount,
          side: primarySlSpec.orderCtx.side,
          isInverse: primarySlSpec.orderCtx.isInverse,
          contracts: primarySlSpec.orderCtx.contracts,
          contractSize: primarySlSpec.orderCtx.contractSize,
        });
        if (slLivePnl && slLivePnl.pnlUsd < 0) {
          liveSlRiskAbs = Math.abs(slLivePnl.pnlUsd);
        }
      }
      const isSlBeingDragged = Boolean(primarySlSpec && activeDrag && activeDrag.orderId === primarySlSpec.order.id);

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

        const rawY = Number(yCoord);
        const offPrefix = !isBeingDragged ? (rawY < minY ? '▲ ' : rawY > maxY ? '▼ ' : '') : '';

        let displayText = spec.text;
        let isProfit = spec.isProfit;

        if (isBeingDragged || (spec.kind === 'tp' && isSlBeingDragged)) {
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
            const liveRrText =
              spec.kind === 'tp' && liveSlRiskAbs > 0 && dragPnl.pnlUsd > 0
                ? ` · ${(dragPnl.pnlUsd / liveSlRiskAbs).toFixed(1)}R`
                : '';
            displayText = formatBracketLabel(spec.order, dragPnl.pnlUsd, dragPnl.pnlPct, liveRrText);
          }
        }

        const finalDisplayText = offPrefix ? `${offPrefix}${displayText}` : displayText;
        const span = el.firstElementChild as HTMLSpanElement | null;
        if (span && span.textContent !== finalDisplayText) {
          span.textContent = finalDisplayText;
        }

        applyPillVisualStyle(el, {
          kind: spec.kind,
          isProfit,
          isDarkMode: isDark,
          isBeingDragged,
          isPending: spec.isPending,
          rightPx: rightLaneOffsetPx,
        });
        el.style.opacity = offPrefix ? '0.86' : '1';
        rows.push({ key: spec.id, el, y: Math.max(minY, Math.min(maxY, rawY)) });
      }

      // 3. Anti-collision vertical nudging (cards stay apart AND clear any Liquidation label & viewport edges)
      const liqPrice = Number(activePosition?.liquidation_price || 0);
      let liqY: number | null = null;
      if (Number.isFinite(liqPrice) && liqPrice > 0) {
        const rawLiqY = series.priceToCoordinate(liqPrice as any);
        if (rawLiqY !== null && rawLiqY !== undefined && Number.isFinite(Number(rawLiqY))) {
          liqY = Number(rawLiqY);
        }
      }

      rows.sort((a, b) => a.y - b.y);
      const dodgeLiquidation = () => {
        if (liqY === null) return;
        for (const row of rows) {
          if (Math.abs(row.y - liqY) < minGapPx) {
            row.y = row.y >= liqY ? liqY + minGapPx : liqY - minGapPx;
          }
        }
        rows.sort((a, b) => a.y - b.y);
      };

      dodgeLiquidation();

      for (let i = 1; i < rows.length; i++) {
        if (rows[i].y - rows[i - 1].y < minGapPx) {
          rows[i].y = rows[i - 1].y + minGapPx;
        }
      }

      // Clamp bottom and push earlier rows gently up if bottom overflows
      if (rows.length > 0 && rows[rows.length - 1].y > maxY) {
        rows[rows.length - 1].y = maxY;
        for (let i = rows.length - 2; i >= 0; i--) {
          if (rows[i + 1].y - rows[i].y < minGapPx) {
            rows[i].y = rows[i + 1].y - minGapPx;
          }
        }
        dodgeLiquidation();
      }

      for (const row of rows) {
        const clampedY = Math.max(minY, Math.min(maxY, row.y));
        row.el.style.transform = `translate3d(0, ${Math.round(clampedY - 10.5)}px, 0)`;
      }
    };
  }, [chart, series, entryContext, activePosition, bracketSpecs, isDark, dragPreviewRef]);

  const scheduleSyncRef = useRef<() => void>(() => {});
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
  scheduleSyncRef.current = scheduleSync;

  // Register imperative drag sync callback for 60fps drag-P/L updates
  useEffect(() => {
    registerDragSyncRef.current = () => scheduleSyncRef.current();
    return () => {
      registerDragSyncRef.current = null;
    };
  }, [registerDragSyncRef]);

  // Subscribe once per chart/series/symbol/exchange (no listener teardown on order updates or idle hover thrashing!)
  useEffect(() => {
    if (!entryContext || !series || !chart) return;

    const triggerSync = () => scheduleSyncRef.current();
    triggerSync();

    const unsubTicks = subscribeLiveTradeTicks(symbol, exchange, (tick) => {
      if (tick?.price && tick.price > 0) {
        livePriceRef.current = tick.price;
        triggerSync();
      }
    });

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(triggerSync);
    timeScale.subscribeSizeChange(triggerSync);

    const overlayHost = containerElRef.current?.parentElement;
    const interactionHost = overlayHost?.parentElement || overlayHost;
    const handlePointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) triggerSync();
    };
    if (interactionHost) {
      interactionHost.addEventListener('wheel', triggerSync, { passive: true });
      interactionHost.addEventListener('pointermove', handlePointerMove, { passive: true });
      interactionHost.addEventListener('pointerup', triggerSync, { passive: true });
      interactionHost.addEventListener('dblclick', triggerSync, { passive: true });
    }

    let ro: ResizeObserver | null = null;
    if (overlayHost && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(triggerSync);
      ro.observe(overlayHost);
    }

    return () => {
      unsubTicks();
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(triggerSync);
        timeScale.unsubscribeSizeChange(triggerSync);
      } catch {
        // chart may already be disposed
      }
      if (interactionHost) {
        interactionHost.removeEventListener('wheel', triggerSync);
        interactionHost.removeEventListener('pointermove', handlePointerMove);
        interactionHost.removeEventListener('pointerup', triggerSync);
        interactionHost.removeEventListener('dblclick', triggerSync);
      }
      ro?.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [chart, series, symbol, exchange, Boolean(entryContext), candlesReadyTick]);

  // Also sync whenever currentPrice, entryContext, or theme changes
  useEffect(() => {
    if (entryContext) {
      scheduleSync();
    }
  }, [currentPrice, entryContext, bracketSpecs, isDark, scheduleSync]);

  if (!entryContext) return null;

  return (
    <div ref={containerElRef} className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {/* Entry Line Right-Edge Live P/L Badge */}
      <div
        ref={entryBadgeElRef}
        style={{ top: 0, opacity: 0, willChange: 'transform' }}
        className="absolute flex items-center gap-1 px-2 h-[21px] rounded font-mono text-[10.5px] font-bold tracking-tight border whitespace-nowrap truncate"
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
          className="absolute flex items-center gap-1 px-2 h-[21px] rounded font-mono text-[10.5px] font-bold tracking-tight border whitespace-nowrap truncate"
        >
          <span>{spec.text}</span>
        </div>
      ))}
    </div>
  );
});
