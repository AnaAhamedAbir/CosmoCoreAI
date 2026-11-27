import React, { useEffect, useRef, useState } from 'react';
import {
    FeedHealthSnapshot,
    getFeedHealth,
    getLatestLiveBbo,
    getLatestLiveTick,
    getLatestMarkPrice,
    reconnectMarketStream,
    subscribeFeedHealth,
    subscribeLiveBbo,
    subscribeLiveMarkPrice,
    subscribeLiveTradeTicks,
} from '@/hooks/useLevel2MarketData';

interface LiveFeedHealthBadgeProps {
    symbol: string;
    exchange: string;
    showBidAsk: boolean;
    showMarkPrice: boolean;
    compact?: boolean;
    isThermalGuard?: boolean;
}

interface TelemetryState {
    health: FeedHealthSnapshot;
    spreadBps: number | null;
    bboImbalance: 'bid' | 'ask' | 'neutral';
    basisPct: number | null;
}

export const LiveFeedHealthBadge: React.FC<LiveFeedHealthBadgeProps> = React.memo(({
    symbol,
    exchange,
    showBidAsk,
    showMarkPrice,
    compact = false,
    isThermalGuard = false,
}) => {
    const isFutures = symbol.includes(':');
    const [telemetry, setTelemetry] = useState<TelemetryState>(() => ({
        health: getFeedHealth(symbol, exchange),
        spreadBps: null,
        bboImbalance: 'neutral',
        basisPct: null,
    }));

    const latestRef = useRef<{
        health: FeedHealthSnapshot;
        bestBid: number;
        bestAsk: number;
        bidQty: number;
        askQty: number;
        lastPrice: number;
        markPrice: number;
        dirty: boolean;
    }>({
        health: getFeedHealth(symbol, exchange),
        bestBid: 0,
        bestAsk: 0,
        bidQty: 0,
        askQty: 0,
        lastPrice: 0,
        markPrice: 0,
        dirty: false,
    });

    useEffect(() => {
        if (!symbol || !exchange) return;

        const initHealth = getFeedHealth(symbol, exchange);
        const initBbo = getLatestLiveBbo(symbol, exchange);
        const initTick = getLatestLiveTick(symbol, exchange);
        const initMark = getLatestMarkPrice(symbol, exchange);

        latestRef.current = {
            health: initHealth,
            bestBid: initBbo?.bestBid || 0,
            bestAsk: initBbo?.bestAsk || 0,
            bidQty: initBbo?.bidQty || 0,
            askQty: initBbo?.askQty || 0,
            lastPrice: initTick?.price || 0,
            markPrice: initMark?.markPrice || 0,
            dirty: true,
        };

        const computeState = (): TelemetryState => {
            const cur = latestRef.current;
            let spreadBps: number | null = null;
            let bboImbalance: 'bid' | 'ask' | 'neutral' = 'neutral';
            if (showBidAsk && cur.bestBid > 0 && cur.bestAsk >= cur.bestBid) {
                spreadBps = ((cur.bestAsk - cur.bestBid) / cur.bestBid) * 10000;
                if (cur.bidQty > 0 && cur.askQty > 0) {
                    const ratio = cur.bidQty / cur.askQty;
                    if (ratio >= 1.3) bboImbalance = 'bid';
                    else if (ratio <= 0.77) bboImbalance = 'ask';
                }
            }
            let basisPct: number | null = null;
            if (showMarkPrice && isFutures && cur.markPrice > 0 && cur.lastPrice > 0) {
                basisPct = ((cur.lastPrice - cur.markPrice) / cur.markPrice) * 100;
            }
            return {
                health: cur.health,
                spreadBps,
                bboImbalance,
                basisPct,
            };
        };

        setTelemetry(computeState());
        latestRef.current.dirty = false;

        const unsubHealth = subscribeFeedHealth(symbol, exchange, (h) => {
            const modeChanged = latestRef.current.health.mode !== h.mode;
            latestRef.current.health = h;
            if (modeChanged) {
                setTelemetry(computeState());
                latestRef.current.dirty = false;
            } else {
                latestRef.current.dirty = true;
            }
        });

        const unsubBbo = showBidAsk
            ? subscribeLiveBbo(symbol, exchange, (bbo) => {
                  latestRef.current.bestBid = bbo.bestBid;
                  latestRef.current.bestAsk = bbo.bestAsk;
                  latestRef.current.bidQty = bbo.bidQty || 0;
                  latestRef.current.askQty = bbo.askQty || 0;
                  latestRef.current.dirty = true;
              })
            : () => {};

        const unsubMark = (showMarkPrice && isFutures)
            ? subscribeLiveMarkPrice(symbol, exchange, (m) => {
                  latestRef.current.markPrice = m.markPrice;
                  latestRef.current.dirty = true;
              })
            : () => {};

        const unsubTick = (showMarkPrice && isFutures)
            ? subscribeLiveTradeTicks(symbol, exchange, (t) => {
                  latestRef.current.lastPrice = t.price;
                  latestRef.current.dirty = true;
              })
            : () => {};

        // Calm UI flush (350ms on PC / 600ms on thermal guard) — zero chart-tree re-renders
        const flushMs = isThermalGuard ? 600 : 350;
        const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            if (!latestRef.current.dirty) return;
            latestRef.current.dirty = false;
            setTelemetry(computeState());
        }, flushMs);

        return () => {
            clearInterval(timer);
            unsubHealth();
            unsubBbo();
            unsubMark();
            unsubTick();
        };
    }, [symbol, exchange, showBidAsk, showMarkPrice, isFutures, isThermalGuard]);

    const { health, spreadBps, bboImbalance, basisPct } = telemetry;

    const statusConfig =
        health.mode === 'direct'
            ? {
                  dot: 'bg-emerald-400',
                  text: 'text-emerald-300',
                  label: 'DIRECT',
                  title: 'Direct real-time exchange WebSocket active',
              }
            : health.mode === 'relay'
                ? {
                      dot: 'bg-amber-400',
                      text: 'text-amber-300',
                      label: 'RELAY',
                      title: 'Backend WebSocket relay active',
                  }
                : health.mode === 'stale'
                    ? {
                          dot: 'bg-rose-500',
                          text: 'text-rose-300',
                          label: 'STALE ↻',
                          title: 'Feed stale (>4.5s without ticks). Click to reconnect.',
                      }
                    : {
                          dot: 'bg-slate-400',
                          text: 'text-slate-300',
                          label: 'SYNC',
                          title: 'Connecting to live market data stream...',
                      };

    const isStale = health.mode === 'stale';

    return (
        <div
            className={`pointer-events-auto flex items-center gap-1.5 font-mono font-bold rounded-md border shadow-md select-none ${
                isThermalGuard ? 'bg-black/85' : 'bg-black/65 backdrop-blur-md'
            } ${
                isStale ? 'border-rose-500/60' : 'border-white/10'
            } ${compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10.5px] px-2 py-0.5'}`}
        >
            <button
                type="button"
                onClick={() => reconnectMarketStream(symbol, exchange)}
                title={statusConfig.title}
                className="flex items-center gap-1 cursor-pointer hover:opacity-90 transition-opacity"
            >
                <span
                    className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${
                        !isThermalGuard && (health.mode === 'direct' || isStale) ? 'animate-pulse' : ''
                    }`}
                />
                <span className={statusConfig.text}>{statusConfig.label}</span>
            </button>

            {spreadBps !== null && (
                <>
                    <span className="text-white/20">|</span>
                    <span
                        className={`flex items-center gap-1 ${
                            bboImbalance === 'bid'
                                ? 'text-emerald-300'
                                : bboImbalance === 'ask'
                                    ? 'text-rose-300'
                                    : 'text-slate-300'
                        }`}
                        title="Live Best Bid / Ask Spread (basis points)"
                    >
                        <span>SPR</span>
                        <span>{spreadBps < 10 ? spreadBps.toFixed(1) : Math.round(spreadBps)}bp</span>
                    </span>
                </>
            )}

            {basisPct !== null && (
                <>
                    <span className="text-white/20">|</span>
                    <span
                        className={
                            Math.abs(basisPct) >= 0.05
                                ? basisPct > 0
                                    ? 'text-amber-300'
                                    : 'text-purple-300'
                                : 'text-purple-300/90'
                        }
                        title="Futures Last vs Mark Price Basis"
                    >
                        MK {basisPct >= 0 ? '+' : ''}{basisPct.toFixed(2)}%
                    </span>
                </>
            )}
        </div>
    );
});
