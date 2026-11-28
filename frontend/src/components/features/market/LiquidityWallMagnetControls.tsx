import React from 'react';
import { Magnet, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import {
  OrderbookWall,
  WallTargetsSummary,
  formatWallSizeCompact,
} from '../../../utils/liquidityWallMagnet';

interface HudWallMagnetBarProps {
  wallTargets: WallTargetsSummary;
  frontRunTicks: number;
  orderType: 'Market' | 'Limit' | 'SmartPeg';
  isAutoLimit: boolean;
  limitPrice: string;
  smartPegAnchorPrice: string;
  smartPegStrategy: 'bbo' | 'inside_spread' | 'wall_aware';
  smartPegAntiSpoof: boolean;
  isFetchingWalls: boolean;
  formatDisplayPrice: (val: number | undefined | null) => string;
  onSnapLimitToWall: (wall: OrderbookWall, frontRunPrice: number, side: 'Buy' | 'Sell') => void;
  onClearPinnedPrice: () => void;
  onCyclePegStrategy: () => void;
  onRefreshWalls: () => void;
}

export const HudWallMagnetBar: React.FC<HudWallMagnetBarProps> = ({
  wallTargets,
  frontRunTicks,
  orderType,
  isAutoLimit,
  limitPrice,
  smartPegAnchorPrice,
  smartPegStrategy,
  smartPegAntiSpoof,
  isFetchingWalls,
  formatDisplayPrice,
  onSnapLimitToWall,
  onClearPinnedPrice,
  onCyclePegStrategy,
  onRefreshWalls,
}) => {
  const { nearestBuyWall, nearestSellWall, buyFrontRunPrice, sellFrontRunPrice } = wallTargets;
  const activePinnedPrice =
    orderType === 'Limit' && !isAutoLimit && Number(limitPrice) > 0
      ? Number(limitPrice)
      : orderType === 'SmartPeg' && Number(smartPegAnchorPrice) > 0
        ? Number(smartPegAnchorPrice)
        : 0;

  return (
    <div
      data-no-drag="true"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className="flex flex-col gap-1 px-2 py-1 rounded-lg bg-amber-950/20 border border-amber-400/35 shadow-[0_0_12px_rgba(245,158,11,0.12)]"
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 text-[9px] font-mono font-black uppercase tracking-wider text-amber-300 min-w-0">
          <Magnet className="w-2.5 h-2.5 text-amber-400 shrink-0" />
          <span className="truncate">WALL MAGNET (+{frontRunTicks}t)</span>
          {activePinnedPrice > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearPinnedPrice();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="px-1 py-0.2 rounded bg-cyan-500/20 hover:bg-rose-500/30 border border-cyan-400/40 hover:border-rose-400/50 text-cyan-200 hover:text-rose-200 text-[8.5px] font-mono font-bold cursor-pointer transition-all shrink-0"
              title={
                orderType === 'SmartPeg'
                  ? 'Clear SmartPeg Wall Anchor Cap'
                  : 'Reset Limit Price back to Auto Best Limit (BBO)'
              }
            >
              {orderType === 'SmartPeg' ? '⚓' : '📌'} ${formatDisplayPrice(activePinnedPrice)} ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {orderType === 'SmartPeg' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCyclePegStrategy();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-1.5 py-0.2 rounded text-[8.5px] font-mono font-extrabold uppercase border cursor-pointer transition-all ${
                smartPegStrategy === 'wall_aware'
                  ? 'bg-orange-500/25 border-orange-400/60 text-orange-200'
                  : smartPegStrategy === 'inside_spread'
                    ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200'
                    : 'bg-white/5 border-white/15 text-gray-300'
              }`}
              title="Click to cycle SmartPeg Strategy: Top BBO -> Inside-Spread -> Wall-Aware"
            >
              {smartPegStrategy === 'wall_aware'
                ? `🧱 WALL${smartPegAntiSpoof ? ' + SPOOF GUARD' : ''}`
                : smartPegStrategy === 'inside_spread'
                  ? '🎯 INSIDE-SPREAD'
                  : '⚡ TOP BBO'}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRefreshWalls();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded bg-white/5 hover:bg-amber-500/20 border border-white/10 text-gray-400 hover:text-amber-300 transition-colors cursor-pointer"
            title="Scan Live L2 Orderbook Walls"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${isFetchingWalls ? 'animate-spin text-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          disabled={!nearestBuyWall || !buyFrontRunPrice}
          onClick={(e) => {
            e.stopPropagation();
            if (nearestBuyWall && buyFrontRunPrice) {
              onSnapLimitToWall(nearestBuyWall, buyFrontRunPrice, 'Buy');
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`px-1.5 py-1 rounded border text-[9.5px] font-mono flex items-center justify-between gap-1 transition-all ${
            nearestBuyWall && buyFrontRunPrice
              ? 'bg-emerald-500/15 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-200 cursor-pointer active:scale-95'
              : 'bg-white/[0.02] border-white/5 text-gray-500 cursor-not-allowed'
          }`}
          title={
            nearestBuyWall && buyFrontRunPrice
              ? `1-Click Buy Limit front-running Buy Wall @ $${formatDisplayPrice(nearestBuyWall.price)} (Size: ${formatWallSizeCompact(nearestBuyWall.size)})`
              : 'No nearby Buy Support Wall detected yet'
          }
        >
          <span className="truncate font-bold">
            🟢 {buyFrontRunPrice ? `$${formatDisplayPrice(buyFrontRunPrice)}` : 'No Buy Wall'}
          </span>
          {nearestBuyWall?.size ? (
            <span className="text-[8.5px] px-1 rounded bg-emerald-950/80 text-emerald-300 shrink-0 font-bold">
              {formatWallSizeCompact(nearestBuyWall.size)}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          disabled={!nearestSellWall || !sellFrontRunPrice}
          onClick={(e) => {
            e.stopPropagation();
            if (nearestSellWall && sellFrontRunPrice) {
              onSnapLimitToWall(nearestSellWall, sellFrontRunPrice, 'Sell');
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`px-1.5 py-1 rounded border text-[9.5px] font-mono flex items-center justify-between gap-1 transition-all ${
            nearestSellWall && sellFrontRunPrice
              ? 'bg-rose-500/15 hover:bg-rose-500/30 border-rose-500/40 text-rose-200 cursor-pointer active:scale-95'
              : 'bg-white/[0.02] border-white/5 text-gray-500 cursor-not-allowed'
          }`}
          title={
            nearestSellWall && sellFrontRunPrice
              ? `1-Click Sell Limit front-running Sell Wall @ $${formatDisplayPrice(nearestSellWall.price)} (Size: ${formatWallSizeCompact(nearestSellWall.size)})`
              : 'No nearby Sell Resistance Wall detected yet'
          }
        >
          <span className="truncate font-bold">
            🔴 {sellFrontRunPrice ? `$${formatDisplayPrice(sellFrontRunPrice)}` : 'No Sell Wall'}
          </span>
          {nearestSellWall?.size ? (
            <span className="text-[8.5px] px-1 rounded bg-rose-950/80 text-rose-300 shrink-0 font-bold">
              {formatWallSizeCompact(nearestSellWall.size)}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
};

interface FullModalLimitWallPanelProps {
  panelEnabled: boolean;
  onTogglePanelEnabled: () => void;
  wallTargets: WallTargetsSummary;
  frontRunTicks: number;
  setFrontRunTicks: (ticks: number) => void;
  wallMagnetEnabled: boolean;
  setWallMagnetEnabled: (enabled: boolean) => void;
  isFetchingWalls: boolean;
  currentPrice: number;
  formatDisplayPrice: (val: number | undefined | null) => string;
  onSnapLimitToWall: (wall: OrderbookWall, frontRunPrice: number, side: 'Buy' | 'Sell') => void;
  onRefreshWalls: () => void;
}

export const FullModalLimitWallPanel: React.FC<FullModalLimitWallPanelProps> = ({
  panelEnabled,
  onTogglePanelEnabled,
  wallTargets,
  frontRunTicks,
  setFrontRunTicks,
  wallMagnetEnabled,
  setWallMagnetEnabled,
  isFetchingWalls,
  currentPrice,
  formatDisplayPrice,
  onSnapLimitToWall,
  onRefreshWalls,
}) => {
  const { nearestBuyWall, nearestSellWall, buyFrontRunPrice, sellFrontRunPrice } = wallTargets;

  const distLabel = (wallPx?: number) => {
    if (!wallPx || !currentPrice || currentPrice <= 0) return '';
    const pct = ((wallPx - currentPrice) / currentPrice) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  };

  return (
    <div
      className={`rounded-xl border transition-colors ${
        panelEnabled
          ? 'p-2.5 bg-gradient-to-r from-amber-950/25 via-[#060b16] to-cyan-950/25 border-amber-500/30 space-y-2'
          : 'px-2.5 py-2 bg-[#04070e]/90 border-white/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className="flex items-center gap-1.5 min-w-0 cursor-pointer select-none"
          onClick={onTogglePanelEnabled}
        >
          <Magnet className={`w-3.5 h-3.5 shrink-0 ${panelEnabled ? 'text-amber-400' : 'text-gray-500'}`} />
          <span className={`text-[11px] font-extrabold uppercase tracking-wider truncate ${panelEnabled ? 'text-amber-300' : 'text-gray-300'}`}>
            Liquidity-Wall Magnet
          </span>
          {panelEnabled ? (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30 font-mono font-bold shrink-0">
              1-Click Front-Run
            </span>
          ) : (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 border border-white/10 font-mono font-bold uppercase shrink-0">
              OFF
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {panelEnabled && (
            <>
              <div className="flex items-center bg-black/50 rounded p-0.5 border border-white/10 text-[9.5px] font-mono">
                {[1, 2, 3].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFrontRunTicks(t)}
                    className={`px-1.5 py-0.5 rounded font-bold cursor-pointer transition-all ${
                      frontRunTicks === t
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-gray-400 hover:text-white'
                    }`}
                    title={`Place order ${t} tick(s) ahead of the Whale Wall`}
                  >
                    {t}t
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setWallMagnetEnabled(!wallMagnetEnabled)}
                className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-extrabold border cursor-pointer transition-all ${
                  wallMagnetEnabled
                    ? 'bg-amber-500/30 border-amber-400 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.35)]'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
                title="When ON, dragging Buy/Sell/TP/SL onto the chart snaps automatically to the nearest Whale Wall!"
              >
                {wallMagnetEnabled ? '🧲 Drag Snap ON' : '🧲 Drag Snap'}
              </button>

              <button
                type="button"
                onClick={onRefreshWalls}
                className="p-1 rounded bg-white/5 hover:bg-amber-500/20 border border-white/10 text-gray-400 hover:text-amber-300 cursor-pointer"
                title="Refresh L2 Walls from Orderbook"
              >
                <RefreshCw className={`w-3 h-3 ${isFetchingWalls ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onTogglePanelEnabled}
            className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer shrink-0 ${
              panelEnabled ? 'bg-amber-500' : 'bg-gray-700 hover:bg-gray-600'
            }`}
            title={panelEnabled ? 'Turn OFF Liquidity-Wall Magnet panel' : 'Turn ON Liquidity-Wall Magnet panel'}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                panelEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {panelEnabled && (
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={!nearestBuyWall || !buyFrontRunPrice}
          onClick={() => {
            if (nearestBuyWall && buyFrontRunPrice) {
              onSnapLimitToWall(nearestBuyWall, buyFrontRunPrice, 'Buy');
            }
          }}
          className={`p-1.5 rounded-lg border text-left transition-all ${
            nearestBuyWall && buyFrontRunPrice
              ? 'bg-emerald-950/35 hover:bg-emerald-900/45 border-emerald-500/40 cursor-pointer active:scale-[0.98]'
              : 'bg-black/30 border-white/5 opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center justify-between text-[9.5px] font-mono">
            <span className="text-emerald-300 font-bold">🟢 Snap Buy (+{frontRunTicks}t)</span>
            {nearestBuyWall?.size ? (
              <span className="text-emerald-400 font-extrabold">
                Wall {formatWallSizeCompact(nearestBuyWall.size)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono mt-0.5">
            <span className="text-white font-black">
              {buyFrontRunPrice ? `$${formatDisplayPrice(buyFrontRunPrice)}` : 'No Buy Wall'}
            </span>
            <span className="text-[9.5px] text-gray-400">
              {nearestBuyWall ? distLabel(nearestBuyWall.price) : ''}
            </span>
          </div>
        </button>

        <button
          type="button"
          disabled={!nearestSellWall || !sellFrontRunPrice}
          onClick={() => {
            if (nearestSellWall && sellFrontRunPrice) {
              onSnapLimitToWall(nearestSellWall, sellFrontRunPrice, 'Sell');
            }
          }}
          className={`p-1.5 rounded-lg border text-left transition-all ${
            nearestSellWall && sellFrontRunPrice
              ? 'bg-rose-950/35 hover:bg-rose-900/45 border-rose-500/40 cursor-pointer active:scale-[0.98]'
              : 'bg-black/30 border-white/5 opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="flex items-center justify-between text-[9.5px] font-mono">
            <span className="text-rose-300 font-bold">🔴 Snap Sell (-{frontRunTicks}t)</span>
            {nearestSellWall?.size ? (
              <span className="text-rose-400 font-extrabold">
                Wall {formatWallSizeCompact(nearestSellWall.size)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono mt-0.5">
            <span className="text-white font-black">
              {sellFrontRunPrice ? `$${formatDisplayPrice(sellFrontRunPrice)}` : 'No Sell Wall'}
            </span>
            <span className="text-[9.5px] text-gray-400">
              {nearestSellWall ? distLabel(nearestSellWall.price) : ''}
            </span>
          </div>
        </button>
      </div>
      )}
    </div>
  );
};

interface SmartPegWallStrategyPanelProps {
  pegStrategy: 'bbo' | 'inside_spread' | 'wall_aware';
  setPegStrategy: (s: 'bbo' | 'inside_spread' | 'wall_aware') => void;
  wallMultiplier: number;
  setWallMultiplier: (v: number) => void;
  frontRunTicks: number;
  setFrontRunTicks: (v: number) => void;
  antiSpoofGuard: boolean;
  setAntiSpoofGuard: (v: boolean) => void;
  wallTargets: WallTargetsSummary;
  tradeSide: 'Buy' | 'Sell';
  formatDisplayPrice: (val: number | undefined | null) => string;
}

export const SmartPegWallStrategyPanel: React.FC<SmartPegWallStrategyPanelProps> = ({
  pegStrategy,
  setPegStrategy,
  wallMultiplier,
  setWallMultiplier,
  frontRunTicks,
  setFrontRunTicks,
  antiSpoofGuard,
  setAntiSpoofGuard,
  wallTargets,
  tradeSide,
  formatDisplayPrice,
}) => {
  const activeWall = tradeSide === 'Buy' ? wallTargets.nearestBuyWall : wallTargets.nearestSellWall;
  const activeFrontRun = tradeSide === 'Buy' ? wallTargets.buyFrontRunPrice : wallTargets.sellFrontRunPrice;

  return (
    <div className="space-y-2 pt-1.5 border-t border-white/10">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold text-amber-300 uppercase tracking-wider">Smart Peg Strategy</span>
        <span className="font-mono text-[9.5px] text-cyan-300 font-bold">
          {pegStrategy === 'wall_aware'
            ? '🧱 Wall Front-Run'
            : pegStrategy === 'inside_spread'
              ? '🎯 Inside-Spread'
              : '⚡ Top BBO'}
        </span>
      </div>

      <div className="flex bg-black/60 rounded-lg p-0.5 border border-white/10 text-[10px] font-semibold gap-0.5">
        <button
          type="button"
          onClick={() => setPegStrategy('bbo')}
          className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
            pegStrategy === 'bbo'
              ? 'bg-amber-600 text-white font-bold shadow'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Standard Top-of-Book BBO Shadowing"
        >
          <Zap className="w-2.5 h-2.5" />
          <span>Top BBO</span>
        </button>
        <button
          type="button"
          onClick={() => setPegStrategy('inside_spread')}
          className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
            pegStrategy === 'inside_spread'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold shadow'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Places 1 tick inside the spread when spread > 1 tick for #1 Queue Priority"
        >
          <span>🎯 Inside-Spread</span>
        </button>
        <button
          type="button"
          onClick={() => setPegStrategy('wall_aware')}
          className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
            pegStrategy === 'wall_aware'
              ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white font-bold shadow'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Scans L2 depth, detects Whale Walls, front-runs 1-3 ticks ahead, and retreats if spoofed!"
        >
          <span>🧱 Wall-Aware</span>
        </button>
      </div>

      {pegStrategy === 'wall_aware' && (
        <div className="p-2 rounded-lg bg-orange-950/25 border border-orange-500/30 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="flex justify-between text-[9.5px] font-mono">
                <span className="text-gray-300">Wall Sensitivity</span>
                <span className="text-amber-300 font-bold">{wallMultiplier.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="1.5"
                max="5.0"
                step="0.5"
                value={wallMultiplier}
                onChange={(e) => setWallMultiplier(parseFloat(e.target.value) || 2.5)}
                className="w-full accent-amber-500 h-1 bg-black/60 rounded appearance-none cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[9.5px] font-mono">
                <span className="text-gray-300">Front-Run Offset</span>
                <span className="text-cyan-300 font-bold">+{frontRunTicks} Tick{frontRunTicks > 1 ? 's' : ''}</span>
              </div>
              <div className="flex bg-black/50 rounded p-0.5 border border-white/10 text-[9.5px] font-mono">
                {[1, 2, 3].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFrontRunTicks(t)}
                    className={`flex-1 py-0.5 rounded font-bold cursor-pointer ${
                      frontRunTicks === t ? 'bg-cyan-500 text-slate-950' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {t}t
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            onClick={() => setAntiSpoofGuard(!antiSpoofGuard)}
            className="flex items-center justify-between p-1.5 rounded bg-black/40 border border-white/10 cursor-pointer hover:border-emerald-500/40 transition-colors"
            title="If the shadowed Whale Wall shrinks >55% or gets pulled (spoofing), Python evacuates & re-pegs in ~40ms!"
          >
            <div className="flex items-center gap-1.5">
              <ShieldCheck className={`w-3.5 h-3.5 ${antiSpoofGuard ? 'text-emerald-400' : 'text-gray-500'}`} />
              <span className="text-[10px] font-bold text-gray-200">
                Anti-Spoof Pull Guard (40ms Retreat)
              </span>
            </div>
            <span
              className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded border ${
                antiSpoofGuard
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-white/5 border-white/10 text-gray-400'
              }`}
            >
              {antiSpoofGuard ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="text-[9.5px] font-mono text-gray-300 flex items-center justify-between px-1">
            <span>
              Target {tradeSide === 'Buy' ? 'Buy Support' : 'Sell Resistance'} Wall:
            </span>
            <span className="text-amber-300 font-bold">
              {activeWall && activeFrontRun
                ? `$${formatDisplayPrice(activeFrontRun)} (Wall $${formatDisplayPrice(activeWall.price)} • ${formatWallSizeCompact(activeWall.size)})`
                : 'Auto-Fallback to BBO if no wall'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

interface TakeProfitWallSnapButtonProps {
  tradeSide: 'Buy' | 'Sell';
  wallTargets: WallTargetsSummary;
  frontRunTicks: number;
  formatDisplayPrice: (val: number | undefined | null) => string;
  onSnapTpToWall: (frontRunPrice: number, wall: OrderbookWall) => void;
}

export const TakeProfitWallSnapButton: React.FC<TakeProfitWallSnapButtonProps> = ({
  tradeSide,
  wallTargets,
  frontRunTicks,
  formatDisplayPrice,
  onSnapTpToWall,
}) => {
  // For BUY entry, TP sits 1 tick BEFORE the nearest Sell Resistance Wall above market.
  // For SELL entry, TP sits 1 tick ABOVE the nearest Buy Support Wall below market.
  const targetWall = tradeSide === 'Buy' ? wallTargets.nearestSellWall : wallTargets.nearestBuyWall;
  const frontRunPx = tradeSide === 'Buy' ? wallTargets.sellFrontRunPrice : wallTargets.buyFrontRunPrice;

  return (
    <button
      type="button"
      disabled={!targetWall || !frontRunPx}
      onClick={() => {
        if (targetWall && frontRunPx) {
          onSnapTpToWall(frontRunPx, targetWall);
        }
      }}
      className={`w-full py-1 px-2 rounded-lg border text-[10px] font-mono font-bold flex items-center justify-between transition-all ${
        targetWall && frontRunPx
          ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-400/40 text-amber-200 cursor-pointer active:scale-[0.99]'
          : 'bg-black/25 border-white/5 text-gray-500 cursor-not-allowed'
      }`}
      title={
        targetWall && frontRunPx
          ? `Snap Take-Profit ${frontRunTicks} tick(s) before ${tradeSide === 'Buy' ? 'Sell Resistance' : 'Buy Support'} Wall ($${formatDisplayPrice(targetWall.price)})`
          : `No ${tradeSide === 'Buy' ? 'Sell Resistance' : 'Buy Support'} Wall detected for TP snap`
      }
    >
      <span className="flex items-center gap-1.5">
        <Magnet className="w-3 h-3 text-amber-400" />
        <span>
          Snap TP Before {tradeSide === 'Buy' ? 'Resistance' : 'Support'} Wall (-{frontRunTicks}t)
        </span>
      </span>
      <span className="text-amber-300 font-black">
        {frontRunPx ? `$${formatDisplayPrice(frontRunPx)}` : 'No Wall'}
      </span>
    </button>
  );
};
