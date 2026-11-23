import React from 'react';
import {
  ChevronDown,
  Magnet,
  RefreshCw,
  ShieldAlert,
  Target,
  Zap,
} from 'lucide-react';
import { OrderbookWall, WallTargetsSummary, formatWallSizeCompact } from '../../../utils/liquidityWallMagnet';

export interface ForceOrderTargetItem {
  id: string;
  side: 'buy' | 'sell';
  amount: number;
  price: number;
  mode: string;
  label: string;
  isSoftwareSL?: boolean;
}

interface ForceExecutionPanelProps {
  forceOrderTargets: ForceOrderTargetItem[];
  selectedForceOrderId: string;
  onSelectForceOrderId: (id: string, choseAll: boolean) => void;
  selectedForceTarget?: ForceOrderTargetItem;
  emergencyMode: 'limit_maker' | 'market';
  onChangeEmergencyMode: (mode: 'limit_maker' | 'market') => void;
  isEmergencySubmitting: boolean;
  emergencySubmittingSide: 'Buy' | 'Sell' | null;
  cancellingOrderId: string | null;
  isCancellingAll: boolean;
  isClosingPosition: boolean;
  isStoppingPeg: boolean;
  isStoppingChase: boolean;
  hasActiveFuturesPos: boolean;
  positionSide?: string;
  positionAmount?: number;
  activePeg?: any;
  activeChase?: any;
  baseCurrency: string;
  effectiveCurrentPrice: number;
  sliderPercentValue: number;
  onRefreshOrders: () => void;
  onCancelOrder: (id: string) => void;
  onCancelAllOrders: () => void;
  onClosePosition: () => void;
  onStopSmartPeg: (peg: any) => void;
  onStopSmartChase: (chase: any) => void;
  onForceTrade: (side: 'Buy' | 'Sell') => void;
  compact?: boolean;
}

export const ForceExecutionPanel: React.FC<ForceExecutionPanelProps> = ({
  forceOrderTargets,
  selectedForceOrderId,
  onSelectForceOrderId,
  selectedForceTarget,
  emergencyMode,
  onChangeEmergencyMode,
  isEmergencySubmitting,
  emergencySubmittingSide,
  cancellingOrderId,
  isCancellingAll,
  isClosingPosition,
  isStoppingPeg,
  isStoppingChase,
  hasActiveFuturesPos,
  positionSide,
  positionAmount,
  activePeg,
  activeChase,
  baseCurrency,
  effectiveCurrentPrice,
  sliderPercentValue,
  onRefreshOrders,
  onCancelOrder,
  onCancelAllOrders,
  onClosePosition,
  onStopSmartPeg,
  onStopSmartChase,
  onForceTrade,
  compact = false,
}) => {
  return (
    <div
      data-no-drag="true"
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`rounded-xl bg-slate-50 dark:bg-gradient-to-r dark:from-[#12080d]/95 dark:via-[#080d18]/95 dark:to-[#071311]/95 border border-amber-500/35 ${
        compact ? 'px-2 py-1.5 space-y-1.5' : 'p-2.5 space-y-2'
      } dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`}
    >
      {/* Target Order Selector Row */}
      <div className="flex items-center justify-between gap-1.5">
        <span
          className="flex items-center gap-1 text-[9.5px] font-mono font-extrabold uppercase tracking-tight text-amber-300/95 shrink-0"
          title="Choose an open order or active bracket to cancel & force execute at current market/BBO price"
        >
          <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
          <span>FORCE</span>
          <span
            className={`px-1 py-0.2 rounded text-[8.5px] font-black leading-none border ${
              forceOrderTargets.length > 0
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                : 'bg-white/5 border-white/10 text-gray-400'
            }`}
          >
            {forceOrderTargets.length}
          </span>
        </span>

        <div className="relative flex-1 min-w-0">
          <select
            value={selectedForceOrderId}
            onChange={(e) => {
              e.stopPropagation();
              const val = e.target.value;
              onSelectForceOrderId(val, val === 'all' && forceOrderTargets.length > 0);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full appearance-none bg-[#050811]/95 hover:bg-[#080d1a] text-cyan-200 font-mono text-[10px] font-bold rounded-md border border-cyan-500/35 focus:border-amber-400/80 pl-2 pr-5 py-1 truncate cursor-pointer focus:outline-none transition-colors"
            title="Select specific open order/bracket to Force Buy or Force Sell, or select ALL / Wallet Balance"
          >
            {forceOrderTargets.map((t, idx) => (
              <option key={t.id} value={t.id} className="bg-[#070b14] text-white font-mono">
                {`#${idx + 1} ${t.label}`}
              </option>
            ))}
            <option value="all" className="bg-[#070b14] text-amber-300 font-mono font-bold">
              {forceOrderTargets.length > 0
                ? `⚡ ALL OPEN ORDERS (${forceOrderTargets.length}) + WALLET`
                : `⚡ WALLET / POSITION (No Open Orders)`}
            </option>
          </select>
          <ChevronDown className="w-3 h-3 text-cyan-400 pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRefreshOrders();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-400 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
          title="Refresh Open Orders List"
        >
          <RefreshCw className="w-3 h-3" />
        </button>

        {forceOrderTargets.length > 0 && (
          <button
            type="button"
            disabled={cancellingOrderId !== null || isCancellingAll}
            onClick={(e) => {
              e.stopPropagation();
              if (selectedForceOrderId !== 'all') {
                onCancelOrder(selectedForceOrderId);
              } else {
                onCancelAllOrders();
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-2 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500 border border-rose-500/40 text-rose-200 hover:text-white text-[9.5px] font-mono font-black uppercase tracking-tight transition-all cursor-pointer shrink-0 active:scale-95 disabled:opacity-50"
            title={selectedForceOrderId !== 'all' ? `Cancel Selected Order #${selectedForceOrderId}` : 'Cancel ALL Open Orders'}
          >
            {cancellingOrderId || isCancellingAll ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : (
              <span>✕ {selectedForceOrderId !== 'all' ? 'Cancel' : 'Cancel All'}</span>
            )}
          </button>
        )}
      </div>

      {/* Mode Switch + Emergency Close / Stop Controls */}
      <div className="flex items-center justify-between gap-1.5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-mono uppercase text-gray-400 font-bold">Mode:</span>
          <div className="flex items-center bg-[#050811] rounded-md p-0.5 border border-white/10">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChangeEmergencyMode('limit_maker');
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-extrabold transition-all cursor-pointer leading-none ${
                emergencyMode === 'limit_maker'
                  ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-[0_0_8px_rgba(6,182,212,0.45)]'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Dynamic Limit Maker (0% Maker Fee — chases Best Bid/Ask until 100% filled)"
            >
              MAKER 0%
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChangeEmergencyMode('market');
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-extrabold transition-all cursor-pointer leading-none ${
                emergencyMode === 'market'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-[0_0_8px_rgba(245,158,11,0.45)]'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Instant Market Price Sweep"
            >
              MARKET
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasActiveFuturesPos && (
            <button
              type="button"
              disabled={isClosingPosition}
              onClick={(e) => {
                e.stopPropagation();
                onClosePosition();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white font-mono text-[9.5px] font-black uppercase tracking-tight transition-all cursor-pointer active:scale-95 shrink-0 shadow-[0_0_8px_rgba(244,63,94,0.35)] disabled:opacity-50"
              title={`Instant Market Close Active ${String(positionSide || '').toUpperCase()} Position (${positionAmount || 0} ${baseCurrency})`}
            >
              {isClosingPosition ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <span>⚡ CLOSE POS</span>}
            </button>
          )}

          {(activePeg || activeChase) && (
            <button
              type="button"
              disabled={isStoppingPeg || isStoppingChase}
              onClick={(e) => {
                e.stopPropagation();
                if (activePeg) onStopSmartPeg(activePeg);
                else if (activeChase) onStopSmartChase(activeChase);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500 border border-amber-400/60 text-amber-200 hover:text-slate-950 font-mono text-[9.5px] font-black uppercase tracking-tight transition-all cursor-pointer active:scale-95 shrink-0"
              title="Stop Active Smart Peg / Chase Immediately"
            >
              ⏹ STOP {activePeg ? 'PEG' : 'CHASE'}
            </button>
          )}
        </div>
      </div>

      {/* Side-by-Side Force Buy & Force Sell Execution */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={isEmergencySubmitting || selectedForceTarget?.side === 'sell'}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedForceTarget?.side === 'sell') return;
            onForceTrade('Buy');
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`relative w-full min-w-0 overflow-hidden py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all select-none group shadow-sm ${
            selectedForceTarget?.side === 'sell'
              ? 'bg-white/[0.02] border border-white/5 text-gray-500 opacity-25 cursor-not-allowed'
              : `bg-emerald-500/15 dark:bg-gradient-to-b dark:from-emerald-500/30 dark:via-emerald-600/25 dark:to-green-900/40 hover:bg-emerald-500 dark:hover:from-emerald-500 dark:hover:via-emerald-600 dark:hover:to-green-700 text-emerald-700 dark:text-emerald-300 hover:text-white border hover:border-emerald-400 dark:hover:border-emerald-300 cursor-pointer active:scale-95 disabled:opacity-50 ${
                  selectedForceTarget?.side === 'buy'
                    ? 'border-emerald-500 dark:border-emerald-300 ring-1 ring-emerald-400/50'
                    : 'border-emerald-500/40 dark:border-emerald-400/50'
                }`
          }`}
          title={
            selectedForceTarget?.side === 'sell'
              ? 'Cannot Force Buy: Selected order is a SELL / Exit order'
              : selectedForceTarget
                ? `Force BUY Selected Order (${selectedForceTarget.label}) via ${emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'}`
                : `Emergency Force BUY (${sliderPercentValue > 0 ? sliderPercentValue : 100}%) via ${emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'}`
          }
        >
          {isEmergencySubmitting && emergencySubmittingSide === 'Buy' ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <Zap
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                selectedForceTarget?.side === 'sell'
                  ? 'opacity-30'
                  : 'text-emerald-600 dark:text-emerald-400 fill-current group-hover:text-white group-hover:scale-110'
              }`}
            />
          )}
          <span className="text-[11px] uppercase tracking-wider font-black leading-none shrink-0">
            FORCE BUY
          </span>
          {selectedForceTarget?.side === 'buy' && (
            <span className="text-[8.5px] font-mono px-1 py-0.2 rounded font-extrabold border shrink-0 leading-tight bg-emerald-950/80 border-emerald-500/50 text-emerald-300">
              FILL
            </span>
          )}
          <span className="text-[9.5px] font-mono text-white/90 group-hover:text-white font-semibold truncate min-w-0">
            •{' '}
            {selectedForceTarget
              ? `${Number(selectedForceTarget.amount.toFixed(1))} ${baseCurrency}${
                  effectiveCurrentPrice > 0 ? ` ($${(selectedForceTarget.amount * effectiveCurrentPrice).toFixed(0)})` : ''
                }`
              : sliderPercentValue > 0
                ? `${sliderPercentValue}%`
                : '100%'}
          </span>
        </button>

        <button
          type="button"
          disabled={isEmergencySubmitting || selectedForceTarget?.side === 'buy'}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedForceTarget?.side === 'buy') return;
            onForceTrade('Sell');
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`relative w-full min-w-0 overflow-hidden py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all select-none group shadow-sm ${
            selectedForceTarget?.side === 'buy'
              ? 'bg-white/[0.02] border border-white/5 text-gray-500 opacity-25 cursor-not-allowed'
              : `bg-rose-500/15 dark:bg-gradient-to-b dark:from-rose-500/30 dark:via-rose-600/25 dark:to-red-900/40 hover:bg-rose-500 dark:hover:from-rose-500 dark:hover:via-rose-600 dark:hover:to-red-700 text-rose-700 dark:text-rose-300 hover:text-white border hover:border-rose-400 dark:hover:border-rose-300 cursor-pointer active:scale-95 disabled:opacity-50 ${
                  selectedForceTarget?.side === 'sell'
                    ? 'border-rose-500 dark:border-rose-300 ring-1 ring-rose-400/50'
                    : 'border-rose-500/40 dark:border-rose-400/50'
                }`
          }`}
          title={
            selectedForceTarget?.side === 'buy'
              ? 'Cannot Force Sell: Selected pending order is a BUY (Entry not filled yet)'
              : selectedForceTarget
                ? `Force SELL Selected Order (${selectedForceTarget.label}) via ${emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'}`
                : `Emergency Force SELL (${sliderPercentValue > 0 ? sliderPercentValue : 100}%) via ${emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'}`
          }
        >
          {isEmergencySubmitting && emergencySubmittingSide === 'Sell' ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <Zap
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                selectedForceTarget?.side === 'buy'
                  ? 'opacity-30'
                  : 'text-rose-600 dark:text-rose-400 fill-current group-hover:text-white group-hover:scale-110'
              }`}
            />
          )}
          <span className="text-[11px] uppercase tracking-wider font-black leading-none shrink-0">
            FORCE SELL
          </span>
          {selectedForceTarget?.side === 'sell' && (
            <span className="text-[8.5px] font-mono px-1 py-0.2 rounded font-extrabold border shrink-0 leading-tight bg-rose-950/80 border-rose-500/50 text-rose-300">
              EXIT
            </span>
          )}
          <span className="text-[9.5px] font-mono text-white/90 group-hover:text-white font-semibold truncate min-w-0">
            •{' '}
            {selectedForceTarget
              ? `${Number(selectedForceTarget.amount.toFixed(1))} ${baseCurrency}${
                  effectiveCurrentPrice > 0 ? ` ($${(selectedForceTarget.amount * effectiveCurrentPrice).toFixed(0)})` : ''
                }`
              : sliderPercentValue > 0
                ? `${sliderPercentValue}%`
                : '100%'}
          </span>
        </button>
      </div>
    </div>
  );
};

interface QuickTpSlInlineStripProps {
  tpEnabled: boolean;
  tpMode: 'percentage' | 'price' | 'absolute' | 'atr';
  tpValue: string;
  tpOrderType: 'Limit' | 'Market';
  onToggleTp: () => void;
  onChangeTpValue: (v: string) => void;
  onChangeTpMode: (m: 'percentage' | 'price' | 'absolute') => void;
  onToggleTpOrderType: () => void;
  slEnabled: boolean;
  slType: 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase';
  slMode: 'percentage' | 'price' | 'absolute' | 'atr';
  slValue: string;
  onToggleSl: () => void;
  onChangeSlValue: (v: string) => void;
  onChangeSlMode: (m: 'percentage' | 'price' | 'absolute' | 'atr') => void;
  tradeSide: 'Buy' | 'Sell';
  wallTargets: WallTargetsSummary;
  frontRunTicks: number;
  formatDisplayPrice: (val: number | undefined | null) => string;
  onSnapTpToWall: (frontRunPrice: number, wall: OrderbookWall) => void;
  onOpenBracketsTab: () => void;
  isNativeExchangeSlLockedToFixed: boolean;
}

export const QuickTpSlInlineStrip: React.FC<QuickTpSlInlineStripProps> = ({
  tpEnabled,
  tpMode,
  tpValue,
  tpOrderType,
  onToggleTp,
  onChangeTpValue,
  onChangeTpMode,
  onToggleTpOrderType,
  slEnabled,
  slType,
  slMode,
  slValue,
  onToggleSl,
  onChangeSlValue,
  onChangeSlMode,
  tradeSide,
  wallTargets,
  frontRunTicks,
  formatDisplayPrice,
  onSnapTpToWall,
  onOpenBracketsTab,
  isNativeExchangeSlLockedToFixed,
}) => {
  const tpTargetWall = tradeSide === 'Buy' ? wallTargets.nearestSellWall : wallTargets.nearestBuyWall;
  const tpFrontRunPx = tradeSide === 'Buy' ? wallTargets.sellFrontRunPrice : wallTargets.buyFrontRunPrice;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {/* Quick TP Mini Card */}
      <div
        className={`rounded-xl border p-2 transition-all space-y-1.5 ${
          tpEnabled
            ? 'bg-emerald-950/15 border-emerald-500/35'
            : 'bg-[#04070e]/75 border-white/10 opacity-80'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={onToggleTp}
            className="flex items-center gap-1.5 cursor-pointer group"
            title="Toggle Attached Take-Profit Bracket"
          >
            <span
              className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] font-black transition-colors ${
                tpEnabled
                  ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                  : 'bg-black/40 border-white/20 text-transparent'
              }`}
            >
              ✓
            </span>
            <Target className="w-3 h-3 text-emerald-400" />
            <span className="text-[11px] font-black uppercase tracking-wide text-emerald-300">
              Take Profit
            </span>
          </button>

          <div className="flex items-center gap-1">
            {tpEnabled && (
              <button
                type="button"
                onClick={onToggleTpOrderType}
                className="px-1.5 py-0.5 rounded bg-black/50 hover:bg-white/10 border border-white/10 text-[9px] font-mono font-bold text-gray-300 cursor-pointer"
                title="Switch TP Execution Type (Limit / Market)"
              >
                {tpOrderType}
              </button>
            )}
            {tpTargetWall && tpFrontRunPx && (
              <button
                type="button"
                onClick={() => onSnapTpToWall(tpFrontRunPx, tpTargetWall)}
                className="px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/30 border border-amber-400/40 text-amber-300 text-[9px] font-mono font-bold flex items-center gap-0.5 cursor-pointer"
                title={`Snap TP ${frontRunTicks}t before ${tradeSide === 'Buy' ? 'Resistance' : 'Support'} Wall ($${formatDisplayPrice(tpTargetWall.price)}, ${formatWallSizeCompact(tpTargetWall.size)})`}
              >
                <Magnet className="w-2.5 h-2.5" />
                <span>Wall</span>
              </button>
            )}
          </div>
        </div>

        {tpEnabled && (
          <div className="flex items-center gap-1">
            <div className="relative flex-1 min-w-0">
              <input
                type="number"
                step="any"
                value={tpValue}
                onChange={(e) => onChangeTpValue(e.target.value)}
                placeholder={tpMode === 'percentage' ? '1.5' : '0.0005'}
                className="w-full bg-[#050811] border border-white/15 focus:border-emerald-400/70 rounded-md py-1 pl-2 pr-5 text-white font-mono text-[11.5px] font-bold focus:outline-none"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-emerald-400 font-mono font-bold pointer-events-none">
                {tpMode === 'percentage' ? '%' : tpMode === 'absolute' ? '🎯' : '$'}
              </span>
            </div>

            <div className="flex bg-[#050811] rounded-md border border-white/10 p-0.5 shrink-0">
              {(['percentage', 'price', 'absolute'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeTpMode(m)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold cursor-pointer transition-colors ${
                    tpMode === m
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title={m === 'percentage' ? 'Percentage (%)' : m === 'price' ? 'Price Delta ($)' : 'Exact Target Price'}
                >
                  {m === 'percentage' ? '%' : m === 'price' ? '$' : '🎯'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick SL Mini Card */}
      <div
        className={`rounded-xl border p-2 transition-all space-y-1.5 ${
          slEnabled
            ? 'bg-rose-950/15 border-rose-500/35'
            : 'bg-[#04070e]/75 border-white/10 opacity-80'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={onToggleSl}
            className="flex items-center gap-1.5 cursor-pointer group"
            title="Toggle Attached Stop-Loss Protection"
          >
            <span
              className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] font-black transition-colors ${
                slEnabled
                  ? 'bg-rose-500 border-rose-400 text-white'
                  : 'bg-black/40 border-white/20 text-transparent'
              }`}
            >
              ✓
            </span>
            <ShieldAlert className="w-3 h-3 text-rose-400" />
            <span className="text-[11px] font-black uppercase tracking-wide text-rose-300">
              Stop Loss
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenBracketsTab}
            className="px-1.5 py-0.5 rounded bg-black/50 hover:bg-white/10 border border-white/10 text-[9px] font-mono font-bold text-amber-300 hover:text-white cursor-pointer transition-colors"
            title="Configure Smart Chase, Anti-Wick Guard, Auto-Breakeven & Native OTOCO"
          >
            {slType === 'smart_chase'
              ? '⚡ Chase ⚙'
              : slType === 'trailing_chase'
                ? '⚡ Trail ⚙'
                : slType === 'trailing'
                  ? '📈 Trail ⚙'
                  : '🛡️ Fixed ⚙'}
          </button>
        </div>

        {slEnabled && (
          <div className="flex items-center gap-1">
            {slMode === 'atr' ? (
              <button
                type="button"
                onClick={onOpenBracketsTab}
                className="flex-1 py-1 px-2 rounded-md bg-black/50 border border-rose-500/30 text-[10.5px] font-mono font-bold text-rose-300 text-left truncate cursor-pointer"
              >
                ATR Auto-Volatility (Tune ⚙)
              </button>
            ) : (
              <div className="relative flex-1 min-w-0">
                <input
                  type="number"
                  step="any"
                  value={slValue}
                  onChange={(e) => onChangeSlValue(e.target.value)}
                  placeholder={slMode === 'percentage' ? '1.0' : '0.0002'}
                  className="w-full bg-[#050811] border border-white/15 focus:border-rose-400/70 rounded-md py-1 pl-2 pr-5 text-white font-mono text-[11.5px] font-bold focus:outline-none"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-rose-400 font-mono font-bold pointer-events-none">
                  {slMode === 'percentage' ? '%' : slMode === 'absolute' ? '🎯' : '$'}
                </span>
              </div>
            )}

            <div className="flex bg-[#050811] rounded-md border border-white/10 p-0.5 shrink-0">
              {(['percentage', 'price', 'absolute'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeSlMode(m)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold cursor-pointer transition-colors ${
                    slMode === m
                      ? 'bg-rose-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title={m === 'percentage' ? 'Percentage (%)' : m === 'price' ? 'Price Delta ($)' : 'Exact Stop Price'}
                >
                  {m === 'percentage' ? '%' : m === 'price' ? '$' : '🎯'}
                </button>
              ))}
              {slType !== 'smart_chase' && slType !== 'trailing_chase' && !isNativeExchangeSlLockedToFixed && (
                <button
                  type="button"
                  onClick={() => onChangeSlMode('atr')}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer transition-colors ${
                    slMode === 'atr'
                      ? 'bg-rose-500 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="ATR Volatility Stop"
                >
                  ATR
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
