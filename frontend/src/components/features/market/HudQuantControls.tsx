import React from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { FastPositionResponse, MlLivePreviewResponse } from '../../../services/manualTradeService';
import { TradePnlPreview } from '../../../utils/riskAndPnlCalculator';

interface HudLivePositionPnlChipProps {
  positionData: FastPositionResponse;
  effectiveCurrentPrice: number;
  hasActiveSoftwareSl: boolean;
  isBreakevenActivated: boolean;
  isMovingBe: boolean;
  onMoveToBreakeven: () => void;
}

export const HudLivePositionPnlChip: React.FC<HudLivePositionPnlChipProps> = ({
  positionData,
  effectiveCurrentPrice,
  hasActiveSoftwareSl,
  isBreakevenActivated,
  isMovingBe,
  onMoveToBreakeven,
}) => {
  const sideLower = String(positionData.side || '').toLowerCase();
  const isLong = sideLower === 'long';
  const entry = Number(positionData.entry_price || 0);
  const refPx = effectiveCurrentPrice > 0 ? effectiveCurrentPrice : Number(positionData.mark_price || 0);

  let liveUsd = Number(positionData.unrealized_pnl || 0);
  let livePct = Number(positionData.pnl_pct || 0);

  if (entry > 0 && refPx > 0 && positionData.amount > 0) {
    const diff = isLong ? refPx - entry : entry - refPx;
    if (positionData.is_inverse && positionData.contracts && positionData.contracts > 0 && positionData.contract_size && positionData.contract_size > 0) {
      const notionalUsd = positionData.contracts * positionData.contract_size;
      liveUsd = notionalUsd * (diff / entry);
    } else {
      liveUsd = diff * positionData.amount;
    }
    livePct = (diff / entry) * 100;
  } else if (positionData.is_inverse && refPx > 0 && liveUsd !== 0) {
    liveUsd = liveUsd * refPx;
  }

  const isInProfit = liveUsd > 0 || livePct > 0;
  const pnlText =
    entry > 0 || liveUsd !== 0
      ? `${liveUsd >= 0 ? '+' : '-'}$${Math.abs(liveUsd).toFixed(2)} (${livePct >= 0 ? '+' : ''}${livePct.toFixed(1)}%)`
      : '';

  return (
    <div className="flex items-center gap-1 shrink-0 pointer-events-auto">
      <span
        className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-black leading-tight border shrink-0 ${
          isLong
            ? liveUsd >= 0
              ? 'bg-emerald-500/25 text-emerald-200 border-emerald-400/55'
              : 'bg-emerald-500/15 text-rose-300 border-rose-400/45'
            : liveUsd >= 0
              ? 'bg-rose-500/25 text-emerald-200 border-emerald-400/55'
              : 'bg-rose-500/20 text-rose-200 border-rose-400/50'
        }`}
        title={`Active ${positionData.side.toUpperCase()} • Entry: $${entry || '?'} • Live: $${refPx || '?'}`}
      >
        {isLong ? 'LONG' : 'SHORT'}
        {pnlText ? ` ${pnlText}` : ''}
      </span>

      {hasActiveSoftwareSl && (
        <button
          type="button"
          disabled={isMovingBe || !isInProfit || isBreakevenActivated}
          onClick={(e) => {
            e.stopPropagation();
            onMoveToBreakeven();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-black border leading-tight transition-all cursor-pointer flex items-center gap-0.5 ${
            isBreakevenActivated
              ? 'bg-emerald-500/30 border-emerald-400/60 text-emerald-200 cursor-default'
              : isInProfit
                ? 'bg-cyan-500/25 hover:bg-emerald-500/40 border-cyan-400/60 text-cyan-200 hover:text-white active:scale-95'
                : 'bg-white/[0.03] border-white/10 text-gray-500 opacity-50 cursor-not-allowed'
          }`}
          title={
            isBreakevenActivated
              ? 'Breakeven SL is already active'
              : isInProfit
                ? '1-Click Move SL to Entry + Fee Buffer (Risk-Free)'
                : 'Position must be in profit before moving SL to Breakeven'
          }
        >
          {isMovingBe ? (
            <RefreshCw className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <ShieldCheck className="w-2.5 h-2.5" />
          )}
          <span>{isBreakevenActivated ? 'BE✓' : 'BE'}</span>
        </button>
      )}
    </div>
  );
};

interface HudLiveAiMicroGaugeProps {
  preview: MlLivePreviewResponse | null;
  tradeSide: 'Buy' | 'Sell';
  bullishThreshold: number;
  bearishThreshold: number;
  compact?: boolean;
}

export const HudLiveAiMicroGauge: React.FC<HudLiveAiMicroGaugeProps> = ({
  preview,
  tradeSide,
  bullishThreshold,
  bearishThreshold,
  compact = true,
}) => {
  if (!preview || preview.status !== 'ok') return null;

  const isBuy = tradeSide === 'Buy';
  const dirProb = isBuy ? (preview.bullish_pct ?? 50) : (preview.bearish_pct ?? 50);
  const reqPct = (isBuy ? bullishThreshold : bearishThreshold) * 100;
  const ready = dirProb >= reqPct;
  const flowVal = isBuy ? preview.flow_bull_pct : preview.flow_bear_pct;
  const l2Val = isBuy ? preview.l2_bid_pct : preview.l2_ask_pct;

  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-0.5 rounded border font-mono text-[9.5px] ${
        ready
          ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-200'
          : 'bg-amber-950/30 border-amber-500/35 text-amber-200'
      }`}
      title={`Live Pre-Trade AI Score vs ${tradeSide.toUpperCase()} threshold (${reqPct.toFixed(0)}%)`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span>{ready ? '🟢' : '🟠'}</span>
        <span className="font-bold">
          {isBuy ? 'Bull' : 'Bear'}: <strong className="text-white">{dirProb.toFixed(1)}%</strong>
          <span className="text-gray-400"> / {reqPct.toFixed(0)}%</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 text-[9px]">
        {flowVal !== null && flowVal !== undefined && (
          <span className="px-1 rounded bg-black/40 border border-white/10 text-cyan-200">
            Flow {flowVal.toFixed(0)}%
          </span>
        )}
        {!compact && l2Val !== null && l2Val !== undefined && (
          <span className="px-1 rounded bg-black/40 border border-white/10 text-blue-200">
            L2 {l2Val.toFixed(0)}%
          </span>
        )}
        <span
          className={`px-1 rounded font-black ${
            ready ? 'bg-emerald-500/25 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {ready ? 'GO' : 'WAIT'}
        </span>
      </div>
    </div>
  );
};

interface HudCompactPnlStripProps {
  preview: TradePnlPreview;
}

export const HudCompactPnlStrip: React.FC<HudCompactPnlStripProps> = ({ preview }) => {
  if (preview.notionalUsd <= 0 || (preview.estProfitUsd === null && preview.maxLossUsd === null)) {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-0.5 rounded bg-[#050914]/90 border border-cyan-500/20 font-mono text-[9.5px]">
      <div className="flex items-center gap-2">
        {preview.estProfitUsd !== null && (
          <span className="text-emerald-300 font-bold">🎯 +${preview.estProfitUsd.toFixed(2)}</span>
        )}
        {preview.maxLossUsd !== null && (
          <span className="text-rose-300 font-bold">🛡️ -${preview.maxLossUsd.toFixed(2)}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {preview.riskRewardRatio !== null && (
          <span className={preview.isLowRR ? 'text-amber-300 font-black' : 'text-cyan-300 font-bold'}>
            R:R 1:{preview.riskRewardRatio.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
};
