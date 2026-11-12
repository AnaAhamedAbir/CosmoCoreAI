import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, ChevronDown, RefreshCw, Square, ShieldAlert, Zap, Layers, AlertTriangle, Minus, Maximize2, GripVertical, Trash2, Target, MoveVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { manualTradeService, ApiKey, FastBalanceResponse, FastPositionResponse } from '../../../services/manualTradeService';
import { notificationService } from '../../../services/notification';
import { mlModelsService } from '../../../services/mlModelsService';
import { trainingStudioToolsService } from '../../../services/trainingStudioToolsService';
import { CustomMLModel } from '../../../types';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';

const MotionButton = motion.button as any;
const MotionDiv = motion.div as any;

export interface AvailablePair {
  id: string;
  symbol: string;
  exchange: string;
  isMain?: boolean;
  price?: number;
}

interface ManualTradeModalProps {
  symbol: string;
  currentPrice: number;
  availablePairs?: AvailablePair[];
  onSelectPair?: (pair: AvailablePair) => void;
  onApiKeyChange?: (apiKeyId: string) => void;
  clickedPrice?: number | null;
  openTrigger?: number;
  buttonSize?: 'sm' | 'md';
  onClose?: () => void;
  onOpenChange?: (isOpen: boolean) => void;
  onChartDragBracketStart?: (type: 'tp' | 'sl') => void;
  onChartDragBracketMove?: (type: 'tp' | 'sl', clientX: number, clientY: number) => number | null;
  onChartDragBracketEnd?: (type: 'tp' | 'sl', clientX: number, clientY: number) => { inChart: boolean; price: number | null };
}

const ManualTradeModalBase: React.FC<ManualTradeModalProps> = ({ 
  symbol, 
  currentPrice, 
  availablePairs,
  onSelectPair,
  onApiKeyChange, 
  clickedPrice, 
  openTrigger, 
  buttonSize = 'md', 
  onClose,
  onOpenChange,
  onChartDragBracketStart,
  onChartDragBracketMove,
  onChartDragBracketEnd
}) => {
  const { isThermalGuardActive, timings } = useDeviceProfile();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [submittingSide, setSubmittingSide] = useState<'Buy' | 'Sell' | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string>(symbol);

  React.useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Floating Modal Drag Position State (Zero-React-Re-render Direct GPU Transform Pattern)
  // Dedicated independent positions for Minimized Quick-Trade Cyber-HUD and Full Terminal Modal
  const [hudPos, setHudPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cosmo_manual_trade_hud_pos_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
        }
      } catch {}
    }
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    return { x: 20, y: Math.max(8, winH - 104 - 180) };
  });

  const [modalPos, setModalPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cosmo_manual_trade_full_pos_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
        }
      } catch {}
    }
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    return { x: 20, y: Math.max(16, winH - 104 - 620) };
  });

  const hasUserDraggedHudRef = React.useRef<boolean>(
    typeof window !== 'undefined' ? Boolean(localStorage.getItem('cosmo_manual_trade_hud_pos_v2')) : false
  );

  const hasUserDraggedModalRef = React.useRef<boolean>(
    typeof window !== 'undefined' ? Boolean(localStorage.getItem('cosmo_manual_trade_full_pos_v2')) : false
  );

  const dragRef = React.useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
    minX: 6,
    maxX: 1500,
    minY: 4,
    maxY: 1000
  });
  const modalContainerRef = React.useRef<HTMLDivElement>(null);

  // Interactive Drag-to-Chart TP / SL State (for Touch & Mouse)
  const [activeDragLine, setActiveDragLine] = useState<{
    type: 'tp' | 'sl';
    currentPrice: number;
    pointerPos: { x: number; y: number };
  } | null>(null);

  const activeDragLineRef = React.useRef<{
    type: 'tp' | 'sl';
    pointerId: number;
    isDragging: boolean;
  } | null>(null);
  const activeDragCleanupRef = React.useRef<(() => void) | null>(null);

  // Sync internal activeSymbol whenever parent symbol prop updates
  React.useEffect(() => {
    if (symbol) {
      setActiveSymbol(symbol);
    }
  }, [symbol]);

  const activePair = availablePairs?.find(p => p.symbol === activeSymbol);
  const effectiveCurrentPrice = (activePair?.price && activePair.price > 0)
    ? activePair.price
    : (activeSymbol === symbol ? currentPrice : (activePair?.price || currentPrice || 0));

  const handleSelectPair = (pair: AvailablePair) => {
    setActiveSymbol(pair.symbol);
    if (pair.price && pair.price > 0) {
      setLimitPrice(pair.price.toString());
    }
    onSelectPair?.(pair);
  };

  const formatDisplayPrice = (val: number | undefined | null) => {
    if (!val || val <= 0) return '';
    if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (val >= 0.0001) return val.toFixed(4);
    return val.toFixed(6);
  };

  const [orderType, setOrderType] = useState<'Market' | 'Limit' | 'SmartPeg'>('Limit');
  const [smartPegMaxDev, setSmartPegMaxDev] = useState<number>(5.0);
  const [size, setSize] = useState<string>('');
  const [selectedPercent, setSelectedPercent] = useState<string | null>('100%');
  const [leverage, setLeverage] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedApi, setSelectedApi] = useState<string>('');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [balanceData, setBalanceData] = useState<FastBalanceResponse | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tradeSide, setTradeSide] = useState<'Buy' | 'Sell'>('Sell');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('isolated');
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  const [isAutoLimit, setIsAutoLimit] = useState<boolean>(true);
  const [positionData, setPositionData] = useState<FastPositionResponse | null>(null);
  const [isLoadingPosition, setIsLoadingPosition] = useState(false);
  const [tpConfig, setTpConfig] = useState({
    enabled: true,
    mode: 'price' as 'percentage' | 'price' | 'absolute' | 'atr',
    value: '0.00005',
    orderType: 'Limit' as 'Limit' | 'Market',
    timeoutMins: 0
  });
  const [slConfig, setSlConfig] = useState({
    enabled: true,
    type: 'smart_chase' as 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase',
    mode: 'price' as 'percentage' | 'price' | 'absolute' | 'atr',
    value: '0.0002',
    atrPeriod: 10,
    atrMultiplier: 2.0,
    atrTimeframe: '15m',
    timeoutMins: 0,
    smartChaseDeviationPct: 5.0,
    smartChaseDelayMs: 1500,
    smartChaseMaxAttempts: 10000,
    smartChaseMode: 'dynamic_bbo' as 'dynamic_bbo' | 'interval',
    smartChaseTriggerSource: 'bid_ask' as 'last' | 'bid_ask',
    smartChasePegStrategy: 'bbo' as 'bbo' | 'inside_spread' | 'wall_aware',
    smartChaseWallMultiplier: 2.5,
    autoBreakevenEnabled: false,
    autoBreakevenTriggerPct: 1.0,
    autoBreakevenBufferPct: 0.05
  });
  const [useNativeTpSl, setUseNativeTpSl] = useState<boolean>(false);
  const [activeBrackets, setActiveBrackets] = useState<any[]>([]);
  const [openLimitOrders, setOpenLimitOrders] = useState<any[]>([]);
  const [selectedForceOrderId, setSelectedForceOrderId] = useState<string>('all');
  const userChoseAllForceRef = React.useRef<boolean>(false);
  const openOrdersPollTickRef = React.useRef<number>(0);
  const [isStoppingChase, setIsStoppingChase] = useState(false);
  const [isStoppingPeg, setIsStoppingPeg] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [isCancellingAll, setIsCancellingAll] = useState(false);
  const [isClosingPosition, setIsClosingPosition] = useState(false);
  const [emergencyMode, setEmergencyMode] = useState<'limit_maker' | 'market'>('limit_maker');
  const [isEmergencySubmitting, setIsEmergencySubmitting] = useState(false);
  const [emergencySubmittingSide, setEmergencySubmittingSide] = useState<'Buy' | 'Sell' | null>(null);
  const [isTelegramConnected, setIsTelegramConnected] = useState<boolean | null>(null);

  React.useEffect(() => {
    notificationService.getSettings()
      .then(s => {
        const active = Boolean(s && s.is_enabled && s.alert_manual_trade !== false && (s.use_master_bot || (s.telegram_bot_token && s.telegram_chat_id)));
        setIsTelegramConnected(active);
      })
      .catch(() => setIsTelegramConnected(false));
  }, []);

  // Binance Native Iceberg state (Spot Limit only)
  const [isIceberg, setIsIceberg] = useState<boolean>(true);
  const [icebergMode, setIcebergMode] = useState<'percent' | 'qty'>('qty');
  const [icebergPercent, setIcebergPercent] = useState<string>('20');
  const [icebergCustomQty, setIcebergCustomQty] = useState<string>('250');

  // L2 Machine Learning Filter state (from ML Registry)
  const [mlModels, setMlModels] = useState<CustomMLModel[]>([]);
  const [isLoadingMlModels, setIsLoadingMlModels] = useState<boolean>(false);
  const [pinnedModelId, setPinnedModelId] = useState<string | null>(null);
  const hasManualMlOverrideRef = React.useRef<boolean>(false);
  const [mlFilterConfig, setMlFilterConfig] = useState({
    enabled: false,
    modelId: '',
    executionMode: 'basic' as 'basic' | 'advanced',
    bullishThreshold: 0.50,
    bearishThreshold: 0.50,
    autoThreshold: true
  });
  const [aiRejectNotice, setAiRejectNotice] = useState<{
    side: string;
    symbol: string;
    modelName: string;
    directionLabel: string;
    calibratedProb: number;
    rawProb?: number | null;
    threshold: number;
    oppositeLabel: string;
    oppositeProb: number;
    flowLabel?: string | null;
    flowPct?: number | null;
    l2Label?: string | null;
    l2Pct?: number | null;
    tpHitEst?: number | null;
    reason: string;
    summary: string;
    timestamp: string;
  } | null>(null);

  const triggerAiShieldRejection = React.useCallback((rawObjOrMsg: any, fallbackSide: string = 'BUY') => {
    let notice: NonNullable<typeof aiRejectNotice>;
    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (rawObjOrMsg && typeof rawObjOrMsg === 'object' && (rawObjOrMsg.rejected_by_ai || rawObjOrMsg.status === 'rejected_by_ai')) {
      const sideStr = String(rawObjOrMsg.side || fallbackSide).toUpperCase();
      notice = {
        side: sideStr,
        symbol: String(rawObjOrMsg.symbol || activeSymbol),
        modelName: String(rawObjOrMsg.model_name || 'AI Filter Model'),
        directionLabel: String(rawObjOrMsg.direction_label || (sideStr === 'BUY' ? 'Bullish' : 'Bearish')),
        calibratedProb: Number(rawObjOrMsg.calibrated_prob ?? 0),
        rawProb: rawObjOrMsg.raw_prob !== undefined && rawObjOrMsg.raw_prob !== null ? Number(rawObjOrMsg.raw_prob) : null,
        threshold: Number(rawObjOrMsg.threshold ?? 50),
        oppositeLabel: String(rawObjOrMsg.opposite_label || (sideStr === 'BUY' ? 'Bearish' : 'Bullish')),
        oppositeProb: Number(rawObjOrMsg.opposite_prob ?? 0),
        flowLabel: rawObjOrMsg.flow_label || null,
        flowPct: rawObjOrMsg.flow_pct !== undefined && rawObjOrMsg.flow_pct !== null ? Number(rawObjOrMsg.flow_pct) : null,
        l2Label: rawObjOrMsg.l2_label || null,
        l2Pct: rawObjOrMsg.l2_pct !== undefined && rawObjOrMsg.l2_pct !== null ? Number(rawObjOrMsg.l2_pct) : null,
        tpHitEst: rawObjOrMsg.tp_hit_est !== undefined && rawObjOrMsg.tp_hit_est !== null ? Number(rawObjOrMsg.tp_hit_est) : null,
        reason: String(rawObjOrMsg.reason || 'Unfavorable market microstructure detected'),
        summary: String(rawObjOrMsg.summary || rawObjOrMsg.message || ''),
        timestamp: nowStr
      };
    } else {
      const msg = String(rawObjOrMsg || '');
      const sideMatch = msg.match(/Denied\s+(BUY|SELL)/i);
      const sideStr = sideMatch ? sideMatch[1].toUpperCase() : fallbackSide.toUpperCase();
      const modelMatch = msg.match(/'([^']+)'/);
      const calMatch = msg.match(/(?:Calibrated\s+)?(Bullish|Bearish|Score):\s*([\d.]+)%/i);
      const rawMatch = msg.match(/Raw(?:\s+Uncalibrated)?:\s*([\d.]+)%/i);
      const threshMatch = msg.match(/Threshold\s*([\d.]+)%/i);
      const oppMatch = msg.match(/\[(Bullish|Bearish):\s*([\d.]+)%/i);
      const flowMatch = msg.match(/(Flow\s+(?:Bull|Bear)):\s*([\d.]+)%/i);
      const l2Match = msg.match(/(L2\s+(?:Bid|Ask)):\s*([\d.]+)%/i);
      const tpHitMatch = msg.match(/TP\s+Hit\s+Est:\s*([\d.]+)%/i);
      const reasonParts = msg.split('|').map(s => s.trim());
      const lastReason = reasonParts.length > 1 ? reasonParts[reasonParts.length - 1].replace(/\)\.?$/, '').replace(/\]\.?$/, '') : msg;

      const calVal = calMatch ? parseFloat(calMatch[2]) : 0;
      const oppVal = oppMatch ? parseFloat(oppMatch[2]) : Math.max(0, Number((100 - calVal).toFixed(1)));

      notice = {
        side: sideStr,
        symbol: activeSymbol,
        modelName: modelMatch ? modelMatch[1] : 'AI Filter Model',
        directionLabel: calMatch ? calMatch[1] : (sideStr === 'BUY' ? 'Bullish' : 'Bearish'),
        calibratedProb: calVal,
        rawProb: rawMatch ? parseFloat(rawMatch[1]) : null,
        threshold: threshMatch ? parseFloat(threshMatch[1]) : 50,
        oppositeLabel: oppMatch ? oppMatch[1] : (sideStr === 'BUY' ? 'Bearish' : 'Bullish'),
        oppositeProb: oppVal,
        flowLabel: flowMatch ? flowMatch[1] : null,
        flowPct: flowMatch ? parseFloat(flowMatch[2]) : null,
        l2Label: l2Match ? l2Match[1] : null,
        l2Pct: l2Match ? parseFloat(l2Match[2]) : null,
        tpHitEst: tpHitMatch ? parseFloat(tpHitMatch[1]) : null,
        reason: lastReason,
        summary: msg,
        timestamp: nowStr
      };
    }

    setAiRejectNotice(notice);

    toast.custom(
      (t) => (
        <div
          className={`${
            t.visible ? 'animate-enter' : 'animate-leave'
          } max-w-[390px] w-full ${isThermalGuardActive ? 'bg-[#0B0E14]/95' : 'bg-[#0b101b]/95 backdrop-blur-xl'} border border-amber-500/45 rounded-xl shadow-[0_14px_45px_rgba(0,0,0,0.85),0_0_25px_rgba(245,158,11,0.18)] p-3.5 text-white pointer-events-auto`}
        >
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                    AI Trade Shield
                  </span>
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${
                      notice.side === 'BUY'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {notice.side} Blocked
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 font-mono truncate max-w-[240px]">
                  {notice.symbol} • {notice.modelName}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toast.dismiss(t.id)}
              className="text-gray-500 hover:text-white p-1 rounded hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-2.5 space-y-2">
            {/* Probability vs Threshold Bar */}
            <div className="bg-black/50 p-2 rounded-lg border border-white/5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-gray-300">
                  Calibrated {notice.directionLabel}:{' '}
                  <strong className="text-amber-300">{notice.calibratedProb.toFixed(1)}%</strong>
                  {notice.rawProb !== null && notice.rawProb !== undefined && Math.abs(notice.rawProb - notice.calibratedProb) > 3 && (
                    <span className="text-[9px] text-gray-500 ml-1">(Raw: {notice.rawProb.toFixed(1)}%)</span>
                  )}
                </span>
                <span className="text-cyan-300 font-bold">
                  Req: ≥{notice.threshold.toFixed(0)}%
                </span>
              </div>

              <div className="relative h-2 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    notice.side === 'BUY'
                      ? 'bg-gradient-to-r from-emerald-600 to-amber-400'
                      : 'bg-gradient-to-r from-rose-600 to-amber-400'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(4, notice.calibratedProb))}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-cyan-300 shadow-[0_0_6px_#22d3ee]"
                  style={{ left: `${Math.min(98, Math.max(2, notice.threshold))}%` }}
                  title={`Required Threshold: ${notice.threshold}%`}
                />
              </div>

              <div className="flex items-center justify-between text-[9.5px] font-mono text-gray-400">
                <span>
                  Opposite ({notice.oppositeLabel}):{' '}
                  <strong className="text-white">{notice.oppositeProb.toFixed(1)}%</strong>
                </span>
                {notice.tpHitEst !== null && notice.tpHitEst !== undefined && (
                  <span>
                    TP Hit Est: <strong className="text-amber-300">{notice.tpHitEst.toFixed(0)}%</strong>
                  </span>
                )}
              </div>
            </div>

            {/* Microstructure Telemetry Badges */}
            {(notice.flowPct !== null || notice.l2Pct !== null) && (
              <div className="grid grid-cols-2 gap-1.5 text-[9.5px] font-mono">
                {notice.flowPct !== null && notice.flowPct !== undefined && (
                  <div className="bg-white/5 px-2 py-1 rounded border border-white/5 flex items-center justify-between">
                    <span className="text-gray-400">{notice.flowLabel || 'Tick Flow'}:</span>
                    <span className="text-white font-bold">{notice.flowPct.toFixed(0)}%</span>
                  </div>
                )}
                {notice.l2Pct !== null && notice.l2Pct !== undefined && (
                  <div className="bg-white/5 px-2 py-1 rounded border border-white/5 flex items-center justify-between">
                    <span className="text-gray-400">{notice.l2Label || 'L2 Book'}:</span>
                    <span className="text-white font-bold">{notice.l2Pct.toFixed(0)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Protection Reason */}
            <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5 text-[10px] text-amber-200/95 leading-snug flex items-start gap-1.5">
              <span className="text-amber-400 shrink-0 mt-0.5">⚡</span>
              <span>{notice.reason}</span>
            </div>
          </div>
        </div>
      ),
      { id: 'ai-trade-shield-toast', duration: 6500 }
    );
  }, [activeSymbol]);

  const mlModelsRef = React.useRef(mlModels);
  mlModelsRef.current = mlModels;

  const getModelOptimalThresholds = React.useCallback((modelId: string, customModels?: any[]) => {
    const list = customModels || mlModelsRef.current;
    const model = list.find(m => m.id === modelId);
    if (!model || !model.versions || model.versions.length === 0) {
      return { bullish: 0.50, bearish: 0.50, isImbalanced: false, note: 'Balanced 50/50' };
    }
    const activeVer = model.versions.find(v => v.id === model.activeVersionId) || model.versions[0];
    const cm = activeVer?.explainability?.confusionMatrix;
    if (cm && Array.isArray(cm.matrix) && cm.matrix.length === 2) {
      const r0 = (Number(cm.matrix[0][0]) || 0) + (Number(cm.matrix[0][1]) || 0);
      const r1 = (Number(cm.matrix[1][0]) || 0) + (Number(cm.matrix[1][1]) || 0);
      const tot = r0 + r1;
      if (tot > 0) {
        const p0 = r0 / tot;
        const p1 = r1 / tot;
        if (p0 >= 0.70) {
          // Class 0 majority (e.g. 90% Class 0 down/flat, 10% Class 1 pump)
          return {
            bullish: 0.42,
            bearish: 0.48,
            isImbalanced: true,
            note: `Auto-Aligned: BUY ≥ 42% | SELL ≥ 48% (${Math.round(p0 * 100)}% base)`
          };
        } else if (p1 >= 0.70) {
          return {
            bullish: 0.48,
            bearish: 0.42,
            isImbalanced: true,
            note: `Auto-Aligned: BUY ≥ 48% | SELL ≥ 42% (${Math.round(p1 * 100)}% base)`
          };
        }
      }
    }
    return { bullish: 0.50, bearish: 0.50, isImbalanced: false, note: 'Balanced 50/50' };
  }, []);

  const fetchMlModels = React.useCallback(async () => {
    setIsLoadingMlModels(true);
    try {
      const [models, pinned] = await Promise.all([
        mlModelsService.getModels(),
        trainingStudioToolsService.getPinnedManualTradeModel().catch(() => null),
      ]);
      const list = models || [];
      setMlModels(list);
      const validPinned = pinned && list.some(m => m.id === pinned.model_id) ? pinned : null;
      setPinnedModelId(validPinned ? validPinned.model_id : null);
      if (list.length > 0) {
        setMlFilterConfig(prev => {
          const shouldApplyPin = Boolean(validPinned && (!prev.modelId || !hasManualMlOverrideRef.current));
          const chosenId = shouldApplyPin && validPinned
            ? validPinned.model_id
            : (prev.modelId && list.some(m => m.id === prev.modelId) ? prev.modelId : list[0].id);
          const opt = getModelOptimalThresholds(chosenId, list);
          return {
            ...prev,
            modelId: chosenId,
            enabled: shouldApplyPin && validPinned ? validPinned.enabled : prev.enabled,
            bullishThreshold: prev.autoThreshold ? opt.bullish : prev.bullishThreshold,
            bearishThreshold: prev.autoThreshold ? opt.bearish : prev.bearishThreshold
          };
        });
      }
    } catch {
      // ignore silently
    } finally {
      setIsLoadingMlModels(false);
    }
  }, [getModelOptimalThresholds]);

  React.useEffect(() => {
    if (isOpen) {
      fetchMlModels();
      setTradeSide('Sell');
      setIcebergMode('qty');
      setIcebergCustomQty((prev) => (!prev || prev === '0' ? '250' : prev));
    } else {
      hasManualMlOverrideRef.current = false;
    }
  }, [isOpen]);

  // Pre-warm ML model + live features in backend RAM so BUY/SELL order execution is instant (<5ms)
  React.useEffect(() => {
    if (!isOpen || !mlFilterConfig.modelId || !activeSymbol) return;
    if (typeof document === 'undefined' || (!document.hidden && document.visibilityState === 'visible')) {
      manualTradeService.warmupMlFilter(activeSymbol, mlFilterConfig.modelId);
    }
    if (!mlFilterConfig.enabled) return;
    const warmupInterval = setInterval(() => {
      if (typeof document === 'undefined' || (!document.hidden && document.visibilityState === 'visible')) {
        manualTradeService.warmupMlFilter(activeSymbol, mlFilterConfig.modelId);
      }
    }, timings.mlWarmupMs);
    return () => clearInterval(warmupInterval);
  }, [isOpen, mlFilterConfig.enabled, mlFilterConfig.modelId, activeSymbol, timings.mlWarmupMs]);

  // Poll active software brackets and open exchange orders
  const lastOpenOrdersFetchRef = React.useRef<number>(0);
  const isOpenRef = React.useRef(isOpen);
  isOpenRef.current = isOpen;

  const isActivelyChasingOrPegging = React.useMemo(
    () =>
      isSubmitting ||
      isEmergencySubmitting ||
      activeBrackets.some((b) => b?.status === 'chasing' || b?.status === 'pegging'),
    [isSubmitting, isEmergencySubmitting, activeBrackets]
  );

  const bracketThermalRef = React.useRef({
    isThermalGuardActive,
    openOrdersPollMs: timings.openOrdersPollMs,
    isActivelyChasingOrPegging,
  });
  bracketThermalRef.current = {
    isThermalGuardActive,
    openOrdersPollMs: timings.openOrdersPollMs,
    isActivelyChasingOrPegging,
  };

  const fetchActiveBrackets = React.useCallback(async (forceOpenOrders = false) => {
    if (!selectedApi) return;
    if (!forceOpenOrders && typeof document !== 'undefined' && document.hidden) return;
    try {
      const now = Date.now();
      const isVisible = typeof document === 'undefined' || (!document.hidden && document.visibilityState === 'visible');
      const timeSinceLast = now - lastOpenOrdersFetchRef.current;
      const { isThermalGuardActive: guardActive, openOrdersPollMs, isActivelyChasingOrPegging: isActive } = bracketThermalRef.current;
      const openOrdersMinGapMs = guardActive && !isActive ? Math.max(6000, openOrdersPollMs) : 4500;
      // Only query exchange open orders if forced, or if enough time has elapsed and modal is open & tab visible
      const shouldFetchOpenOrders =
        forceOpenOrders || (isOpenRef.current && isVisible && timeSinceLast >= openOrdersMinGapMs);

      if (shouldFetchOpenOrders) {
        lastOpenOrdersFetchRef.current = now;
        const [bracketsRes, openOrdersRes] = await Promise.all([
          manualTradeService.getActiveSoftwareBrackets(Number(selectedApi), activeSymbol).catch(() => []),
          manualTradeService.getOpenLimitOrders(Number(selectedApi), activeSymbol).catch(() => ({ orders: [] }))
        ]);
        setActiveBrackets(bracketsRes || []);
        const ordersList = Array.isArray(openOrdersRes) ? openOrdersRes : (openOrdersRes?.orders || []);
        setOpenLimitOrders(ordersList);
      } else {
        const data = await manualTradeService.getActiveSoftwareBrackets(Number(selectedApi), activeSymbol);
        setActiveBrackets(data || []);
      }
    } catch (err) {
      // silent background check
    }
  }, [selectedApi, activeSymbol]);

  const lastBracketImmediateFetchScopeRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!selectedApi) return;
    const scopeKey = `${selectedApi}:${activeSymbol}:${isOpen ? '1' : '0'}`;
    if (lastBracketImmediateFetchScopeRef.current !== scopeKey) {
      lastBracketImmediateFetchScopeRef.current = scopeKey;
      if (typeof document === 'undefined' || !document.hidden) {
        fetchActiveBrackets(true);
      }
    }
    const pollInterval = isActivelyChasingOrPegging
      ? timings.bracketActivePollMs
      : isOpen
        ? timings.bracketOpenPollMs
        : timings.bracketClosedPollMs;
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || (!document.hidden && document.visibilityState === 'visible')) {
        fetchActiveBrackets(false);
      }
    }, pollInterval);
    return () => clearInterval(interval);
  }, [
    selectedApi,
    activeSymbol,
    isOpen,
    isActivelyChasingOrPegging,
    timings.bracketActivePollMs,
    timings.bracketOpenPollMs,
    timings.bracketClosedPollMs,
    fetchActiveBrackets
  ]);

  // Unified list of selectable open orders & software brackets for Emergency Force Buy/Sell
  const forceOrderTargets = React.useMemo(() => {
    const items: Array<{
      id: string;
      side: 'buy' | 'sell';
      amount: number;
      price: number;
      mode: string;
      label: string;
      isSoftwareSL?: boolean;
    }> = [];
    const mergedBracketIds = new Set<string>();
    const seenOrderIds = new Set<string>();

    // 1. Exchange open limit / TP / STOP orders (correlating linked software SL brackets if present)
    for (const ord of openLimitOrders) {
      if (!ord || !ord.id) continue;
      const oid = String(ord.id);
      if (seenOrderIds.has(oid)) continue;
      seenOrderIds.add(oid);

      const sideLower = String(ord.side || 'sell').toLowerCase() === 'buy' ? 'buy' : 'sell';
      const sideLabel = sideLower.toUpperCase();
      const amt = Number(ord.amount || 0);
      const price = Number(ord.price || 0);
      const mode = String(ord.mode || 'LIMIT').toUpperCase();

      const linkedSl = activeBrackets.find(
        (b) =>
          b &&
          b.id &&
          (String(b.tp_order_id || '') === oid || String(b.entry_order_id || '') === oid)
      );

      if (linkedSl) {
        mergedBracketIds.add(String(linkedSl.id));
        const slPrice = Number(linkedSl.trigger_price || linkedSl.price || 0);
        const effAmt = amt || Number(linkedSl.amount || 0);
        const isLinkedTp = String(linkedSl.tp_order_id || '') === oid || mode === 'TP';
        const resolvedMode = isLinkedTp ? 'TP' : mode;
        const tagPrefix = isLinkedTp ? '🎯 [TP+SL]' : '📌 [ENTRY+SL]';
        items.push({
          id: oid,
          side: sideLower,
          amount: effAmt,
          price,
          mode: resolvedMode,
          isSoftwareSL: !isLinkedTp && Boolean(ord.isSoftwareSL || mode === 'STOP'),
          label: `${tagPrefix} ${sideLabel} ${Number(effAmt.toFixed(4))} @ $${formatDisplayPrice(price)}${
            slPrice > 0 ? ` / SL $${formatDisplayPrice(slPrice)}` : ''
          }`
        });
      } else {
        const icon = mode === 'TP' ? '🎯' : mode === 'STOP' ? '🛑' : '📌';
        items.push({
          id: oid,
          side: sideLower,
          amount: amt,
          price,
          mode,
          isSoftwareSL: Boolean(ord.isSoftwareSL || mode === 'STOP'),
          label: `${icon} [${mode}] ${sideLabel} ${Number(amt.toFixed(4))} @ $${formatDisplayPrice(price)}`
        });
      }
    }

    // 2. Remaining active software brackets / Smart Pegs / Smart Chases
    for (const b of activeBrackets) {
      if (!b || !b.id) continue;
      const bid = String(b.id);
      if (mergedBracketIds.has(bid) || seenOrderIds.has(bid)) continue;
      seenOrderIds.add(bid);

      const sideLower = String(b.side || 'sell').toLowerCase() === 'buy' ? 'buy' : 'sell';
      const sideLabel = sideLower.toUpperCase();
      const totalAmt = Number(b.amount || 0);
      const filledAmt = Number(b.filled_amount || 0);
      const remAmt =
        b.status === 'pegging' && filledAmt > 0 && totalAmt > filledAmt
          ? totalAmt - filledAmt
          : totalAmt;
      const price = Number(b.current_maker_price || b.trigger_price || b.price || 0);
      const mode = String(b.mode || b.type || 'SMART_CHASE').toUpperCase();
      const isPegEntry = b.status === 'pegging' || String(b.type || '').toLowerCase() === 'smart_peg';
      const tag =
        b.status === 'pegging'
          ? '⚡ [PEG]'
          : b.status === 'chasing'
            ? '🔥 [CHASE]'
            : mode === 'TRAILING'
              ? '📈 [TRAIL]'
              : '🛡️ [SL]';

      items.push({
        id: bid,
        side: sideLower,
        amount: remAmt,
        price,
        mode,
        isSoftwareSL: !isPegEntry,
        label: `${tag} ${sideLabel} ${Number(remAmt.toFixed(4))} @ $${formatDisplayPrice(price)}`
      });
    }

    return items;
  }, [openLimitOrders, activeBrackets]);

  // Keep selectedForceOrderId synchronized with live open orders/brackets
  React.useEffect(() => {
    if (forceOrderTargets.length === 0) {
      userChoseAllForceRef.current = false;
      if (selectedForceOrderId !== 'all') {
        setSelectedForceOrderId('all');
      }
      return;
    }
    const stillExists = forceOrderTargets.some((t) => t.id === selectedForceOrderId);
    if (selectedForceOrderId !== 'all' && !stillExists) {
      setSelectedForceOrderId(forceOrderTargets[0].id);
    } else if (selectedForceOrderId === 'all' && !userChoseAllForceRef.current) {
      setSelectedForceOrderId(forceOrderTargets[0].id);
    }
  }, [forceOrderTargets, selectedForceOrderId]);

  const selectedForceTarget = React.useMemo(
    () => (selectedForceOrderId !== 'all' ? forceOrderTargets.find((t) => t.id === selectedForceOrderId) : undefined),
    [forceOrderTargets, selectedForceOrderId]
  );

  const handleStopSmartChase = async (targetChase?: any) => {
    if (!selectedApi) return;
    setIsStoppingChase(true);
    try {
      const res = await manualTradeService.stopSmartChase({
        apiKeyId: Number(selectedApi),
        symbol: activeSymbol,
        slId: targetChase?.id
      });
      toast.success(res.message || '🛑 Smart Chase SL stopped.');
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to stop Smart Chase');
    } finally {
      setIsStoppingChase(false);
    }
  };

  const handleStopSmartPeg = async (targetPeg?: any) => {
    if (!selectedApi) return;
    setIsStoppingPeg(true);
    try {
      const res = await manualTradeService.stopSmartPeg({
        apiKeyId: Number(selectedApi),
        symbol: activeSymbol,
        pegId: targetPeg?.id
      });
      toast.success(res.message || '🛑 Smart Peg Entry cancelled.');
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to stop Smart Peg Entry');
    } finally {
      setIsStoppingPeg(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!selectedApi) return;
    setCancellingOrderId(orderId);
    try {
      const res = await manualTradeService.cancelOrder(Number(selectedApi), orderId, activeSymbol);
      toast.success(res?.message || `🛑 Order #${orderId} cancelled.`);
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to cancel order');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleCancelAllOrders = async () => {
    if (!selectedApi) return;
    setIsCancellingAll(true);
    try {
      const res = await manualTradeService.cancelAllOrders(Number(selectedApi), activeSymbol);
      toast.success(res?.message || `🛑 All open orders on ${activeSymbol} cancelled.`);
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to cancel all orders');
    } finally {
      setIsCancellingAll(false);
    }
  };

  const handleClosePosition = async () => {
    if (!selectedApi) return;
    setIsClosingPosition(true);
    try {
      const res = await manualTradeService.closePosition(Number(selectedApi), activeSymbol);
      toast.success(res?.message || `🚨 Position closed successfully at Market price.`);
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to close position');
    } finally {
      setIsClosingPosition(false);
    }
  };

  const handleEmergencyForceTrade = async (side: 'Buy' | 'Sell') => {
    if (!selectedApi) {
      toast.error('Please select an API Key first.');
      setIsMinimized(false);
      return;
    }
    setIsEmergencySubmitting(true);
    setEmergencySubmittingSide(side);
    try {
      const targetObj =
        selectedForceOrderId !== 'all'
          ? forceOrderTargets.find((t) => t.id === selectedForceOrderId)
          : undefined;

      if (targetObj) {
        if (targetObj.side === 'buy' && side === 'Sell') {
          toast.error('Cannot Force Sell a pending BUY order. Wait for fill or cancel order.');
          return;
        }
        if (targetObj.side === 'sell' && side === 'Buy') {
          toast.error('Cannot Force Buy a pending SELL / Exit order.');
          return;
        }
      }

      const hasCustomTypedSize = !targetObj && !selectedPercent && Boolean(size) && Number(size) > 0;
      const effectivePct = targetObj
        ? selectedPercent
          ? Math.max(1, Math.min(100, Number(selectedPercent.replace('%', '')) || 100))
          : 100
        : hasCustomTypedSize
          ? 0
          : selectedPercent
            ? Math.max(1, Math.min(100, Number(selectedPercent.replace('%', '')) || 100))
            : 100;
      const refOrderPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
      const customBaseAmt = hasCustomTypedSize
        ? (isInverseFutures && contractSize > 0
            ? (sizeMode === 'quote'
                ? Math.max(1, Math.floor(Number(size) / contractSize))
                : Math.max(1, Math.round((Number(size) * refOrderPrice) / contractSize)))
            : (sizeMode === 'quote' && refOrderPrice > 0 ? Number(size) / refOrderPrice : Number(size)))
        : undefined;

      const attachedTpPayload =
        tpConfig.enabled && tpConfig.value && Number(tpConfig.value) > 0
          ? {
              enabled: true,
              mode: tpConfig.mode as 'percentage' | 'price' | 'absolute',
              value: Number(tpConfig.value),
              order_type: tpConfig.orderType,
              timeout_mins: tpConfig.timeoutMins
            }
          : undefined;

      const attachedSlPayload =
        slConfig.enabled && (slConfig.mode === 'atr' || (slConfig.value && Number(slConfig.value) > 0))
          ? {
              enabled: true,
              type: slConfig.type,
              mode: slConfig.mode,
              value: Number(slConfig.value || 0),
              atr_period: slConfig.atrPeriod,
              atr_multiplier: slConfig.atrMultiplier,
              atr_timeframe: slConfig.atrTimeframe,
              timeout_mins: slConfig.timeoutMins,
              smart_chase_deviation_pct: slConfig.smartChaseDeviationPct ?? 5.0,
              smartChaseDeviationPct: slConfig.smartChaseDeviationPct ?? 5.0,
              smart_chase_delay_ms: slConfig.smartChaseDelayMs ?? 1500,
              smartChaseDelayMs: slConfig.smartChaseDelayMs ?? 1500,
              smart_chase_max_attempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
              smartChaseMaxAttempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
              smart_chase_mode: slConfig.smartChaseMode || 'dynamic_bbo',
              smartChaseMode: slConfig.smartChaseMode || 'dynamic_bbo',
              smart_chase_trigger_source: slConfig.smartChaseTriggerSource || 'bid_ask',
              smartChaseTriggerSource: slConfig.smartChaseTriggerSource || 'bid_ask',
              smart_chase_peg_strategy: slConfig.smartChasePegStrategy || 'bbo',
              smartChasePegStrategy: slConfig.smartChasePegStrategy || 'bbo',
              smart_chase_wall_multiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
              smartChaseWallMultiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
              auto_breakeven_enabled: slConfig.autoBreakevenEnabled,
              autoBreakevenEnabled: slConfig.autoBreakevenEnabled,
              auto_breakeven_trigger_pct: slConfig.autoBreakevenTriggerPct ?? 1.0,
              autoBreakevenTriggerPct: slConfig.autoBreakevenTriggerPct ?? 1.0,
              auto_breakeven_buffer_pct: slConfig.autoBreakevenBufferPct ?? 0.05,
              autoBreakevenBufferPct: slConfig.autoBreakevenBufferPct ?? 0.05
            }
          : undefined;

      const res = await manualTradeService.emergencyForceOrder({
        apiKeyId: Number(selectedApi),
        symbol: activeSymbol,
        side,
        executionMode: emergencyMode,
        sizePct: effectivePct,
        customAmount: customBaseAmt,
        targetOrderId: targetObj ? targetObj.id : 'all',
        targetOrderAmount: targetObj ? targetObj.amount : undefined,
        targetOrderMode: targetObj ? targetObj.mode : undefined,
        leverage: isFutures ? leverage : undefined,
        marginMode: isFutures ? marginMode : undefined,
        reduceOnly: isFutures ? reduceOnly : false,
        attached_tp: attachedTpPayload,
        attached_sl: attachedSlPayload,
        enable_ml_filter: Boolean(mlFilterConfig.enabled && mlFilterConfig.modelId && !(isFutures && reduceOnly)),
        ml_model_id: mlFilterConfig.enabled ? mlFilterConfig.modelId : undefined,
        ml_execution_mode: mlFilterConfig.executionMode,
        ml_bullish_threshold: mlFilterConfig.bullishThreshold,
        ml_bearish_threshold: mlFilterConfig.bearishThreshold
      });

      if (res?.rejected_by_ai || res?.status === 'rejected_by_ai') {
        triggerAiShieldRejection(res, side);
        return;
      }
      setAiRejectNotice(null);

      toast.success(
        res.message ||
          (emergencyMode === 'limit_maker'
            ? `⚡ Emergency Force ${side} (0% Fee Maker Peg) active for ${activeSymbol}!`
            : `🚨 Emergency Force ${side} (Market) executed for ${activeSymbol}!`)
      );
      fetchActiveBrackets(true);
      fetchBalance(true);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
      }, 1000);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
      }, 2200);
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || err?.message || 'Emergency Force Order failed';
      if (typeof errMsg === 'string' && errMsg.includes('AI Filter Denied')) {
        triggerAiShieldRejection(errMsg, side);
      } else {
        toast.error(`❌ ${errMsg}`);
      }
    } finally {
      setIsEmergencySubmitting(false);
      setEmergencySubmittingSide(null);
    }
  };

  // Fetch API Keys on component mount
  React.useEffect(() => {
    const fetchKeys = async () => {
      try {
        const keys = await manualTradeService.getApiKeys();
        setApiKeys(keys);
        if (keys.length > 0) {
          const firstId = keys[0].id.toString();
          setSelectedApi(firstId);
          onApiKeyChange?.(firstId);
        }
      } catch (e) {
        console.error("Failed to load APIs", e);
      }
    };
    fetchKeys();
  }, [onApiKeyChange]);

  // BUG-12 fix: Reset size and mode when symbol changes to avoid stale amounts on wrong pair
  React.useEffect(() => {
    setSize('');
    setSizeMode('base');
    setBalanceData(null);
    setIcebergCustomQty('250');
  }, [activeSymbol]);

  const isFetchingBalanceRef = React.useRef(false);

  // Fetch balance and position (supports silent background polling and explicit refresh)
  const fetchBalance = React.useCallback(async (isSilent = false) => {
    if (!selectedApi || !isOpen) return;
    if (isFetchingBalanceRef.current) return; // Prevent concurrent/overlapping requests
    isFetchingBalanceRef.current = true;

    if (!isSilent) {
      setIsLoadingBalance(true);
      setIsLoadingPosition(true);
    }
    setIsRefreshing(true);
    try {
      const balancePromise = manualTradeService.getFastBalance(Number(selectedApi), activeSymbol);
      const positionPromise = activeSymbol.includes(':')
        ? manualTradeService.getActivePosition(Number(selectedApi), activeSymbol).catch(() => null)
        : Promise.resolve(null);

      const [data, pos] = await Promise.all([balancePromise, positionPromise]);
      setBalanceData(data);
      if (activeSymbol.includes(':')) {
        setPositionData(pos);
      }
    } catch (e) {
      if (!isSilent) {
        setBalanceData(null);
        setPositionData(null);
      }
    } finally {
      isFetchingBalanceRef.current = false;
      setIsLoadingBalance(false);
      setIsLoadingPosition(false);
      setIsRefreshing(false);
    }
  }, [selectedApi, activeSymbol, isOpen]);

  // Live background auto-refresh (5.5s desktop / 9.5s mobile thermal guard) while modal is open
  React.useEffect(() => {
    if (!isOpen || !selectedApi) return;

    // Immediate initial fetch
    fetchBalance(false);

    // Periodic live sync (adaptive per device thermal profile)
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && document.visibilityState === 'visible') {
        fetchBalance(true);
      }
    }, timings.balancePollMs);

    // Immediate refresh on tab focus / visibility restore
    const handleVisibilityChange = () => {
      if (!document.hidden && document.visibilityState === 'visible') {
        fetchBalance(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, selectedApi, activeSymbol, fetchBalance, timings.balancePollMs]);

  // Trigger immediate orderbook/chart/balance sync when an active software bracket stops (e.g. TP filled)
  const prevActiveBracketScopeRef = React.useRef<string>('');
  const prevActiveBracketIdsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const scopeKey = `${selectedApi || ''}:${activeSymbol || ''}`;
    const nextIds = new Set(activeBrackets.map((b: any) => String(b.id)));
    if (prevActiveBracketScopeRef.current !== scopeKey) {
      prevActiveBracketScopeRef.current = scopeKey;
      prevActiveBracketIdsRef.current = nextIds;
      return;
    }

    let closedAny = false;
    prevActiveBracketIdsRef.current.forEach((id) => {
      if (!nextIds.has(id)) closedAny = true;
    });
    prevActiveBracketIdsRef.current = nextIds;

    if (closedAny) {
      window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      fetchActiveBrackets(true);
      if (isOpenRef.current) {
        fetchBalance(true);
      }
    }
  }, [activeBrackets, selectedApi, activeSymbol, fetchActiveBrackets, fetchBalance]);

  // Dynamic left position so modal opens cleanly docked to the left of the workspace (clearing sidebar)
  const [modalLeft, setModalLeft] = useState<number>(() => {
    if (typeof document !== 'undefined') {
      const aside = document.querySelector('aside');
      if (aside) {
        return Math.max(20, Math.round(aside.getBoundingClientRect().right) + 20);
      }
    }
    return 100;
  });

  // Re-calculate left docking position whenever modal opens or window resizes
  React.useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const updatePosition = () => {
      const aside = document.querySelector('aside');
      let targetLeft = 20;
      if (aside && aside.offsetWidth > 60) {
        const rightEdge = Math.round(aside.getBoundingClientRect().right);
        targetLeft = Math.max(20, rightEdge + 20);
        setModalLeft(targetLeft);
      } else {
        setModalLeft(20);
      }

      const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
      if (!hasUserDraggedModalRef.current) {
        setModalPos(prev => ({
          x: targetLeft,
          y: Math.max(16, winH - 104 - 620)
        }));
      }
      if (!hasUserDraggedHudRef.current) {
        setHudPos(prev => ({
          x: targetLeft,
          y: Math.max(8, winH - 104 - 180)
        }));
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen]);

  // Clamp screen position using actual rendered dimensions so modal/HUD never breaches screen bounds
  const clampPos = React.useCallback((
    rawX: number,
    rawY: number,
    isMin: boolean,
    elOverride?: HTMLElement | null
  ) => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const modalEl = elOverride || modalContainerRef.current;
    const modalW = modalEl?.offsetWidth || (isMin ? 395 : 320);
    const modalH = modalEl?.offsetHeight || (isMin ? 180 : 620);

    const leftMargin = 6;
    const rightMargin = 6;
    // Minimized HUD can sit right against the top screen border (top >= 4px)
    const topMargin = isMin ? 4 : 12;
    const bottomMargin = isMin ? 8 : 16;

    const minX = leftMargin;
    const maxX = Math.max(minX, winW - modalW - rightMargin);

    const minY = topMargin;
    const maxY = Math.max(minY, winH - modalH - bottomMargin);

    return {
      x: Math.max(minX, Math.min(maxX, Math.round(rawX))),
      y: Math.max(minY, Math.min(maxY, Math.round(rawY)))
    };
  }, []);

  // Synchronize modal position and observe live DOM dimension changes (e.g., when orders appear or accordions toggle)
  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const modalEl = modalContainerRef.current;
    if (!modalEl) return;

    const currentPos = isMinimized ? hudPos : modalPos;
    const clamped = clampPos(currentPos.x, currentPos.y, isMinimized, modalEl);

    // Apply clamped transform directly
    modalEl.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0)`;
    dragRef.current.currentX = clamped.x;
    dragRef.current.currentY = clamped.y;

    if (clamped.x !== currentPos.x || clamped.y !== currentPos.y) {
      if (isMinimized) {
        setHudPos(clamped);
      } else {
        setModalPos(clamped);
      }
    }

    // Dynamic ResizeObserver ensures that when order option detects active order or height increases,
    // top position remains stable and never exceeds boundary!
    const resizeObserver = new ResizeObserver((entries) => {
      if (dragRef.current.isDragging) return;
      for (const entry of entries) {
        const targetEl = entry.target as HTMLElement;
        const active = isMinimized ? hudPos : modalPos;
        const nextClamped = clampPos(active.x, active.y, isMinimized, targetEl);
        if (nextClamped.x !== active.x || nextClamped.y !== active.y) {
          targetEl.style.transform = `translate3d(${nextClamped.x}px, ${nextClamped.y}px, 0)`;
          dragRef.current.currentX = nextClamped.x;
          dragRef.current.currentY = nextClamped.y;
          if (isMinimized) {
            setHudPos(nextClamped);
          } else {
            setModalPos(nextClamped);
          }
        }
      }
    });

    resizeObserver.observe(modalEl);

    const onWindowResize = () => {
      if (dragRef.current.isDragging) return;
      const active = isMinimized ? hudPos : modalPos;
      const nextClamped = clampPos(active.x, active.y, isMinimized, modalContainerRef.current);
      if (modalContainerRef.current) {
        modalContainerRef.current.style.transform = `translate3d(${nextClamped.x}px, ${nextClamped.y}px, 0)`;
      }
      dragRef.current.currentX = nextClamped.x;
      dragRef.current.currentY = nextClamped.y;
      if (nextClamped.x !== active.x || nextClamped.y !== active.y) {
        if (isMinimized) {
          setHudPos(nextClamped);
        } else {
          setModalPos(nextClamped);
        }
      }
    };

    window.addEventListener('resize', onWindowResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [isOpen, isMinimized, clampPos]);

  // Ultra-Smooth 120fps GPU Mouse & Touch Drag Handler (Zero React re-renders & zero layout thrashing during drag)
  const handleStartDrag = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const isTouch = 'touches' in e;

    // For mouse events, only allow primary mouse button (left-click)
    if (!isTouch && (e as React.MouseEvent).button !== 0) return;

    // Do not initiate drag if clicking/tapping on interactive controls (buttons, inputs, select, slider)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select') || target.closest('[data-no-drag="true"]')) {
      return;
    }

    const startClientX = isTouch ? e.touches[0]?.clientX : (e as React.MouseEvent).clientX;
    const startClientY = isTouch ? e.touches[0]?.clientY : (e as React.MouseEvent).clientY;
    if (startClientX === undefined || startClientY === undefined) return;

    if (!isTouch && e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    const modalEl = modalContainerRef.current;
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const modalW = modalEl?.offsetWidth || (isMinimized ? 395 : 320);
    const modalH = modalEl?.offsetHeight || (isMinimized ? 180 : 620);
    const topMargin = isMinimized ? 4 : 12;
    const bottomMargin = isMinimized ? 8 : 16;

    const currentPos = isMinimized ? hudPos : modalPos;
    const drag = dragRef.current;
    drag.isDragging = true;
    drag.startX = startClientX;
    drag.startY = startClientY;
    drag.originX = currentPos.x;
    drag.originY = currentPos.y;
    drag.currentX = currentPos.x;
    drag.currentY = currentPos.y;
    drag.minX = 6;
    drag.maxX = Math.max(drag.minX, winW - modalW - 6);
    drag.minY = topMargin;
    drag.maxY = Math.max(drag.minY, winH - modalH - bottomMargin);

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    // Shield underlying LightweightCharts / OrderFlowHeatmap canvas from receiving mousemove / crosshair events during drag
    document.body.style.pointerEvents = 'none';

    // Temporarily suspend expensive 24px Gaussian backdrop-filter blur over live 60fps WebGL/Canvas while dragging
    if (modalEl) {
      modalEl.style.pointerEvents = 'auto';
      modalEl.style.backdropFilter = 'none';
      (modalEl.style as any).webkitBackdropFilter = 'none';
      modalEl.style.backgroundColor =
        typeof document !== 'undefined' && document.documentElement.classList.contains('light')
          ? 'rgba(255, 255, 255, 0.98)'
          : isMinimized
            ? 'rgba(9, 13, 22, 0.98)'
            : 'rgba(6, 9, 15, 0.96)';
      modalEl.style.transition = 'none';
    }

    const applyMove = (clientX: number, clientY: number) => {
      if (!drag.isDragging) return;
      const rawX = drag.originX + (clientX - drag.startX);
      const rawY = drag.originY + (clientY - drag.startY);

      const clampedX = Math.max(drag.minX, Math.min(drag.maxX, rawX));
      const clampedY = Math.max(drag.minY, Math.min(drag.maxY, rawY));

      drag.currentX = clampedX;
      drag.currentY = clampedY;

      if (modalContainerRef.current) {
        modalContainerRef.current.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
      }
    };

    const onMouseMove = (mv: MouseEvent) => {
      applyMove(mv.clientX, mv.clientY);
    };

    const onTouchMove = (tv: TouchEvent) => {
      if (!drag.isDragging) return;
      if (tv.cancelable) tv.preventDefault();
      const touch = tv.touches[0];
      if (!touch) return;
      applyMove(touch.clientX, touch.clientY);
    };

    const onUp = () => {
      if (!drag.isDragging) return;
      drag.isDragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.style.pointerEvents = '';

      if (modalContainerRef.current) {
        modalContainerRef.current.style.pointerEvents = '';
        modalContainerRef.current.style.backdropFilter = '';
        (modalContainerRef.current.style as any).webkitBackdropFilter = '';
        modalContainerRef.current.style.backgroundColor = '';
        modalContainerRef.current.style.transition = '';
      }

      const finalPos = { x: drag.currentX, y: drag.currentY };
      if (isMinimized) {
        hasUserDraggedHudRef.current = true;
        setHudPos(finalPos);
        try {
          localStorage.setItem('cosmo_manual_trade_hud_pos_v2', JSON.stringify(finalPos));
        } catch {}
      } else {
        hasUserDraggedModalRef.current = true;
        setModalPos(finalPos);
        try {
          localStorage.setItem('cosmo_manual_trade_full_pos_v2', JSON.stringify(finalPos));
        } catch {}
      }

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    window.addEventListener('blur', onUp);
  }, [hudPos, modalPos, isMinimized]);

  // Safety cleanup: ensure body styles are always restored if modal closes or unmounts mid-drag
  React.useEffect(() => {
    if (!isOpen && dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.body.style.pointerEvents = '';
      }
    }
    return () => {
      if (typeof document !== 'undefined' && dragRef.current.isDragging) {
        dragRef.current.isDragging = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.body.style.pointerEvents = '';
      }
    };
  }, [isOpen]);

  // Size mode: 'base' = in token (DOGE), 'quote' = in USD (USDC/USDT)
  const [sizeMode, setSizeMode] = useState<'base' | 'quote'>('base');

  // Derive base and quote currency from symbol (e.g. DOGE/USDC or DOGE/USD:DOGE)
  const baseCurrency = activeSymbol.split('/')[0] || 'BASE';
  const quoteCurrency = (activeSymbol.split('/')[1] || 'QUOTE').split(':')[0];

  // Determine if it is a futures pair (CCXT futures symbols usually contain a colon, e.g. BTC/USDT:USDT or DOGE/USD:DOGE)
  const isFutures = activeSymbol.includes(':');

  // Settle currency (e.g. DOGE for DOGE/USD:DOGE, USDT for DOGE/USDT:USDT)
  const settleCurrency = isFutures
    ? (activeSymbol.split(':')[1] || '').split('-')[0]
    : quoteCurrency;

  // Determine if it is a Coin-Margined Inverse Futures contract (collateralized in baseCurrency, e.g. DOGE)
  const isInverseFutures = isFutures && (
    Boolean(balanceData?.is_inverse) ||
    settleCurrency.toUpperCase() === baseCurrency.toUpperCase()
  );

  // Contract size in USD (e.g. $10 for DOGE/USD:DOGE, $100 for BTC/USD:BTC)
  const contractSize = balanceData?.contract_size || (
    isInverseFutures ? (baseCurrency.toUpperCase() === 'BTC' ? 100 : 10) : 1
  );

  // For Limit orders
  const [limitPrice, setLimitPrice] = useState<string>(effectiveCurrentPrice ? effectiveCurrentPrice.toString() : '');

  // Effective reference price for sizing and TP/SL estimation: uses custom Limit price when in manual Limit mode
  const effectiveOrderPrice = React.useMemo(() => {
    if (orderType === 'Limit' && !isAutoLimit && limitPrice && Number(limitPrice) > 0) {
      return Number(limitPrice);
    }
    return effectiveCurrentPrice;
  }, [orderType, isAutoLimit, limitPrice, effectiveCurrentPrice]);

  // Smart default value calculator when user switches TP/SL mode (% <-> $ <-> Absolute)
  const getSmartGapValue = React.useCallback((
    targetMode: 'percentage' | 'price' | 'absolute',
    isTp: boolean,
    side: 'Buy' | 'Sell' = tradeSide
  ): string => {
    const defaultPct = isTp ? 1.5 : 1.0;
    if (targetMode === 'percentage') {
      return defaultPct.toString();
    }
    const refPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
    if (refPrice <= 0) {
      return isTp ? '0.0003' : '0.0001';
    }
    const decimals = refPrice >= 1000 ? 2 : refPrice >= 1 ? 4 : refPrice >= 0.001 ? 5 : 7;
    if (targetMode === 'price') {
      const rawGap = refPrice * (defaultPct / 100);
      const minTick = Math.pow(10, -decimals);
      const clampedGap = Math.max(minTick, Number(rawGap.toFixed(decimals)));
      return clampedGap.toString();
    }
    // targetMode === 'absolute'
    const dir = isTp
      ? (side === 'Buy' ? 1 : -1)
      : (side === 'Buy' ? -1 : 1);
    const absTarget = refPrice * (1 + dir * (defaultPct / 100));
    return Math.max(Math.pow(10, -decimals), Number(absTarget.toFixed(decimals))).toString();
  }, [effectiveOrderPrice, effectiveCurrentPrice, tradeSide]);

  // Unified eligibility check for Native Binance Spot OTO/OTOCO
  const isNativeTpSlSupported = React.useMemo(() => {
    if (isFutures) return false;
    if (orderType !== 'Limit') return false;
    if (!tpConfig.enabled && !slConfig.enabled) return false;
    if (tpConfig.enabled && tpConfig.orderType === 'Market') return false;
    if (slConfig.enabled && (
      slConfig.type === 'trailing' ||
      slConfig.type === 'smart_chase' ||
      slConfig.type === 'trailing_chase' ||
      slConfig.mode === 'atr' ||
      slConfig.autoBreakevenEnabled
    )) {
      return false;
    }
    return true;
  }, [isFutures, orderType, tpConfig.enabled, tpConfig.orderType, slConfig.enabled, slConfig.type, slConfig.mode, slConfig.autoBreakevenEnabled]);

  // Derived total base amount currently configured
  const currentBaseAmount = React.useMemo(() => {
    const raw = parseFloat(size);
    if (isNaN(raw) || raw <= 0) return 0;
    if (sizeMode === 'quote') {
      const p = effectiveOrderPrice || effectiveCurrentPrice || Number(limitPrice) || 0;
      return p > 0 ? raw / p : 0;
    }
    return raw;
  }, [size, sizeMode, effectiveOrderPrice, effectiveCurrentPrice, limitPrice]);

  // Derived effective iceberg visible quantity in base asset
  const effectiveIcebergQty = React.useMemo(() => {
    if (!isIceberg || currentBaseAmount <= 0) return 0;
    if (icebergMode === 'percent') {
      const pct = parseFloat(icebergPercent);
      return !isNaN(pct) && pct > 0 && pct < 100 ? (currentBaseAmount * pct) / 100 : 0;
    } else {
      const qty = parseFloat(icebergCustomQty);
      return !isNaN(qty) && qty > 0 ? qty : 0;
    }
  }, [isIceberg, icebergMode, icebergPercent, icebergCustomQty, currentBaseAmount]);

  const calculateSize = React.useCallback((
    pctStr: string,
    balance: FastBalanceResponse | null,
    price: number,
    mode: 'base' | 'quote',
    side: 'Buy' | 'Sell',
    futures: boolean,
    lev: number,
    redOnly: boolean,
    pos: FastPositionResponse | null
  ) => {
    if (!balance || price <= 0) return '';
    const percentage = Number(pctStr.replace('%', '')) / 100;
    if (isNaN(percentage) || percentage <= 0) return '';

    // Support Coin-Margined Inverse Futures (e.g. DOGE/USD:DOGE)
    if (isInverseFutures) {
      const formatInverseSize = (targetCont: number) => {
        if (mode === 'quote') {
          return (targetCont * contractSize).toString();
        }
        const baseAmt = (targetCont * contractSize) / price;
        return baseAmt < 1
          ? Number(baseAmt.toFixed(6)).toString()
          : Number(baseAmt.toFixed(4)).toString();
      };
      if (redOnly && pos && ((pos.contracts && pos.contracts > 0) || pos.amount > 0)) {
        const totalCont = (pos.contracts && pos.contracts > 0)
          ? pos.contracts
          : Math.max(1, Math.round((pos.amount * price) / contractSize));
        const targetCont = Math.max(1, Math.floor(totalCont * percentage));
        return formatInverseSize(targetCont);
      }
      const totalNotionalUSD = (balance.base_free || 0) * 0.99 * price * lev;
      const targetCont = Math.floor((totalNotionalUSD * percentage) / contractSize);
      if (targetCont <= 0) return '';
      return formatInverseSize(targetCont);
    }

    let maxValue = 0;
    if (mode === 'quote') {
      if (futures) {
        if (redOnly && pos && pos.amount > 0) {
          maxValue = pos.amount * price;
        } else {
          maxValue = (balance.quote_free || 0) * lev;
        }
      } else if (side === 'Buy') {
        maxValue = balance.quote_free || 0;
      } else {
        maxValue = (balance.base_free || 0) * price;
      }
    } else {
      if (futures) {
        if (redOnly && pos && pos.amount > 0) {
          maxValue = pos.amount;
        } else {
          maxValue = ((balance.quote_free || 0) * lev) / price;
        }
      } else if (side === 'Buy') {
        maxValue = (balance.quote_free || 0) / price;
      } else {
        maxValue = balance.base_free || 0;
      }
    }

    const val = maxValue * percentage;
    const decimals = mode === 'quote' ? 2 : 6;
    const rounded = Math.floor(val * Math.pow(10, decimals)) / Math.pow(10, decimals);
    return rounded > 0 ? rounded.toString() : '';
  }, [isInverseFutures, contractSize]);

  // Automatically recalculate size when selectedPercent is active and balance/price/settings change
  React.useEffect(() => {
    if (selectedPercent && balanceData && effectiveOrderPrice > 0) {
      const calculated = calculateSize(
        selectedPercent,
        balanceData,
        effectiveOrderPrice,
        sizeMode,
        tradeSide,
        isFutures,
        leverage,
        reduceOnly,
        positionData
      );
      if (calculated) {
        setSize(calculated);
      }
    }
  }, [
    selectedPercent,
    balanceData,
    effectiveOrderPrice,
    sizeMode,
    tradeSide,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize
  ]);

  const sliderPercentValue = React.useMemo(() => {
    if (selectedPercent) {
      const parsed = Number(selectedPercent.replace('%', ''));
      if (!isNaN(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
    }
    if (!size || Number(size) <= 0 || !balanceData || effectiveOrderPrice <= 0) return 0;
    const maxStr = calculateSize(
      '100%',
      balanceData,
      effectiveOrderPrice,
      sizeMode,
      tradeSide,
      isFutures,
      leverage,
      reduceOnly,
      positionData
    );
    const maxVal = Number(maxStr);
    if (!maxVal || maxVal <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(size) / maxVal) * 100)));
  }, [
    selectedPercent,
    size,
    balanceData,
    effectiveOrderPrice,
    sizeMode,
    tradeSide,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize
  ]);

  const handlePercentSliderChange = React.useCallback((pctNum: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(pctNum)));
    if (clamped === 0) {
      setSelectedPercent(null);
      setSize('');
      return;
    }
    const pctStr = `${clamped}%`;
    setSelectedPercent(pctStr);
    if (balanceData && effectiveOrderPrice > 0) {
      let newSize = calculateSize(
        pctStr,
        balanceData,
        effectiveOrderPrice,
        sizeMode,
        tradeSide,
        isFutures,
        leverage,
        reduceOnly,
        positionData
      );
      if (!newSize && !isFutures) {
        const altSide: 'Buy' | 'Sell' = tradeSide === 'Buy' ? 'Sell' : 'Buy';
        const altSize = calculateSize(
          pctStr,
          balanceData,
          effectiveOrderPrice,
          sizeMode,
          altSide,
          isFutures,
          leverage,
          reduceOnly,
          positionData
        );
        if (altSize) {
          setTradeSide(altSide);
          newSize = altSize;
        }
      }
      if (newSize) {
        setSize(newSize);
      }
    }
  }, [
    balanceData,
    effectiveOrderPrice,
    sizeMode,
    tradeSide,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize
  ]);

  const lastTriggerRef = React.useRef<number>(0);

  // Update limit price when clickedPrice from chart changes via an explicit trigger
  React.useEffect(() => {
    // Only auto-open if a new valid trigger has been dispatched after mounting
    if (openTrigger && openTrigger > 0 && openTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = openTrigger;
      if (clickedPrice && clickedPrice > 0) {
        setOrderType('Limit');
        setIsAutoLimit(false); // Disable auto best limit since user manually picked a price
        setLimitPrice(clickedPrice.toString());
        setTradeSide('Sell');
        setIsOpen(true); // Auto-open modal if closed
        setIsMinimized(false);
      }
    } else if (!openTrigger || openTrigger === 0) {
      lastTriggerRef.current = 0;
    }
  }, [clickedPrice, openTrigger]);

  // Update limit price placeholder when currentPrice changes if user hasn't typed
  React.useEffect(() => {
    if (orderType === 'Limit' && !limitPrice && effectiveCurrentPrice) {
      setLimitPrice(effectiveCurrentPrice.toString());
    }
  }, [effectiveCurrentPrice, orderType, limitPrice]);

  // Check if there is any live pending order (limit order, smart bracket) or active futures position to protect
  const hasLivePendingOrPosition = React.useMemo(() => {
    if (openLimitOrders.length > 0 || forceOrderTargets.length > 0 || activeBrackets.length > 0) {
      return true;
    }
    if (isFutures) {
      return Boolean(positionData && positionData.amount > 0 && positionData.side !== 'none');
    }
    return false;
  }, [openLimitOrders.length, forceOrderTargets.length, activeBrackets.length, isFutures, positionData]);

  // Handle Dragging TP / SL Line from Minimized HUD onto the Chart
  const startLineDrag = React.useCallback((e: React.PointerEvent, type: 'tp' | 'sl') => {
    e.preventDefault();
    e.stopPropagation();

    activeDragCleanupRef.current?.();

    if (!selectedApi) {
      toast.error('Please select an API Key first.');
      return;
    }

    const pointerId = e.pointerId;
    const targetEl = e.currentTarget as HTMLElement;
    try {
      targetEl.setPointerCapture(pointerId);
    } catch {}

    activeDragLineRef.current = {
      type,
      pointerId,
      isDragging: true
    };

    const startFn = onChartDragBracketStart || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketStart : null);
    startFn?.(type);

    setActiveDragLine({
      type,
      currentPrice: effectiveCurrentPrice || 0,
      pointerPos: { x: e.clientX, y: e.clientY }
    });

    const onPointerMove = (ev: PointerEvent) => {
      if (!activeDragLineRef.current?.isDragging) return;
      const moveFn = onChartDragBracketMove || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketMove : null);
      const livePrice = moveFn ? moveFn(type, ev.clientX, ev.clientY) : null;

      setActiveDragLine({
        type,
        currentPrice: livePrice !== null && livePrice > 0 ? livePrice : (effectiveCurrentPrice || 0),
        pointerPos: { x: ev.clientX, y: ev.clientY }
      });
    };

    const cleanupDrag = (clearGhostLine: boolean) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onDragAbort);
      window.removeEventListener('blur', onDragAbort);
      activeDragCleanupRef.current = null;

      try {
        targetEl.releasePointerCapture(pointerId);
      } catch {}

      if (clearGhostLine) {
        activeDragLineRef.current = null;
        setActiveDragLine(null);
        const endFn = onChartDragBracketEnd || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketEnd : null);
        endFn?.(type, -1, -1);
      }
    };

    const onDragAbort = () => {
      cleanupDrag(true);
    };

    const onPointerUp = async (ev: PointerEvent) => {
      cleanupDrag(false);

      const wasDragging = activeDragLineRef.current?.isDragging;
      activeDragLineRef.current = null;
      setActiveDragLine(null);

      if (!wasDragging) return;

      const endFn = onChartDragBracketEnd || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketEnd : null);
      const result = endFn ? endFn(type, ev.clientX, ev.clientY) : { inChart: false, price: null };

      if (!result.inChart || !result.price || result.price <= 0) {
        toast('Drag cancelled (released outside chart)', { icon: '↩️' });
        return;
      }

      const dropPrice = result.price;
      const buyBackSuffix = (type === 'sl' && dropPrice > (effectiveCurrentPrice || 0)) ? ' (BUY-BACK)' : (type === 'tp' && dropPrice < (effectiveCurrentPrice || 0) ? ' (DIP BUY-BACK)' : '');
      const toastId = toast.loading(`Placing ${type.toUpperCase()}${buyBackSuffix} at ${dropPrice < 1 ? dropPrice.toFixed(6) : dropPrice.toFixed(4)}...`);

      try {
        let targetAmount: number | undefined = undefined;
        let targetSide: string | undefined = undefined;
        let targetOrderId: string | undefined = undefined;

        const resolveTargetFromForceOrder = (target: (typeof forceOrderTargets)[number]) => {
          const isExitOrder = Boolean(target.isSoftwareSL || target.mode === 'TP');
          let resolvedSide: 'buy' | 'sell' = isExitOrder
            ? (target.side === 'buy' ? 'sell' : 'buy')
            : (target.side === 'buy' ? 'buy' : 'sell');

          // Spot / Cash Swing & Chart Geometry Alignment:
          // SL above market -> Buy-Back SL (exit is Buy, so swing entry_side is 'sell').
          // SL below market -> Long SL (exit is Sell, so swing entry_side is 'buy').
          // TP above market -> Long TP (exit is Sell, so swing entry_side is 'buy').
          // TP below market -> Dip Buy-Back TP (exit is Buy, so swing entry_side is 'sell').
          const currentPx = effectiveCurrentPrice || 0;
          if (currentPx > 0 && dropPrice > 0) {
            if (type === 'sl') {
              resolvedSide = dropPrice > currentPx ? 'sell' : 'buy';
            } else if (type === 'tp') {
              resolvedSide = dropPrice > currentPx ? 'buy' : 'sell';
            }
          }

          let resolvedAmount = target.amount;
          if (
            isInverseFutures &&
            positionData &&
            positionData.contracts &&
            positionData.contracts > 0 &&
            positionData.amount > 0 &&
            Math.abs(target.amount - positionData.amount) <= Math.max(1e-8, positionData.amount * 0.02) &&
            Math.abs(target.amount - positionData.contracts) > Math.max(1e-8, positionData.contracts * 0.02)
          ) {
            resolvedAmount = positionData.contracts;
          }
          return {
            amount: resolvedAmount,
            orderId: target.id,
            side: resolvedSide
          };
        };

        // 1. If user has a specific order selected in the HUD dropdown (Row 4), use that order's exact target!
        if (selectedForceTarget && selectedForceTarget.amount > 0) {
          const resolved = resolveTargetFromForceOrder(selectedForceTarget);
          targetAmount = resolved.amount;
          targetOrderId = resolved.orderId;
          targetSide = resolved.side;
        } else if (isFutures && positionData && positionData.amount > 0) {
          // 2. When 'all' is selected in Futures with an active position, target the position directly before any open order fallback
          targetAmount = (isInverseFutures && positionData.contracts && positionData.contracts > 0)
            ? positionData.contracts
            : positionData.amount;
          targetSide = positionData.side.toLowerCase() === 'long' ? 'buy' : 'sell';
          targetOrderId = undefined;
        } else if (forceOrderTargets.length > 0 && selectedForceOrderId === 'all' && forceOrderTargets[0].amount > 0) {
          // 3. Fallback to first active open order/bracket when no futures position is active
          const resolved = resolveTargetFromForceOrder(forceOrderTargets[0]);
          targetAmount = resolved.amount;
          targetOrderId = resolved.orderId;
          targetSide = resolved.side;
        } else {
          // Spot or no active futures position: infer side from chart drop price
          const currentPx = effectiveCurrentPrice || 0;
          if (type === 'tp') {
            targetSide = dropPrice > currentPx ? 'buy' : 'sell';
          } else {
            targetSide = dropPrice < currentPx ? 'buy' : 'sell';
          }

          if (size && Number(size) > 0) {
            targetAmount = sizeMode === 'quote' && dropPrice > 0 ? Number(size) / dropPrice : Number(size);
          } else if (balanceData) {
            const effectiveQuote = (balanceData.quote_free || 0) > 0
              ? (balanceData.quote_free || 0)
              : ((balanceData.quote_total || 0) > 0 ? (balanceData.quote_total || 0) : 0);
            const effectiveBase = (balanceData.base_free || 0) > 0
              ? (balanceData.base_free || 0)
              : ((balanceData.base_total || 0) > 0 ? (balanceData.base_total || 0) : 0);

            if (targetSide === 'sell') {
              if (effectiveQuote > 0 && dropPrice > 0) {
                targetAmount = effectiveQuote / dropPrice;
              } else if (effectiveBase > 0) {
                targetAmount = effectiveBase;
              }
            } else {
              if (effectiveBase > 0) {
                targetAmount = effectiveBase;
              } else if (effectiveQuote > 0 && dropPrice > 0) {
                targetAmount = effectiveQuote / dropPrice;
              }
            }
          }
        }

        const attachedSlPayload = {
          ...slConfig,
          enabled: true,
          type: slConfig.type,
          mode: slConfig.mode,
          value: dropPrice,
          atr_period: slConfig.atrPeriod,
          atr_multiplier: slConfig.atrMultiplier,
          atr_timeframe: slConfig.atrTimeframe,
          timeout_mins: slConfig.timeoutMins,
          smart_chase_deviation_pct: slConfig.smartChaseDeviationPct ?? 5.0,
          smartChaseDeviationPct: slConfig.smartChaseDeviationPct ?? 5.0,
          smart_chase_delay_ms: slConfig.smartChaseDelayMs ?? 1500,
          smartChaseDelayMs: slConfig.smartChaseDelayMs ?? 1500,
          smart_chase_max_attempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
          smartChaseMaxAttempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
          smart_chase_mode: slConfig.smartChaseMode || 'dynamic_bbo',
          smartChaseMode: slConfig.smartChaseMode || 'dynamic_bbo',
          smart_chase_trigger_source: slConfig.smartChaseTriggerSource || 'bid_ask',
          smartChaseTriggerSource: slConfig.smartChaseTriggerSource || 'bid_ask',
          smart_chase_peg_strategy: slConfig.smartChasePegStrategy || 'bbo',
          smartChasePegStrategy: slConfig.smartChasePegStrategy || 'bbo',
          smart_chase_wall_multiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
          smartChaseWallMultiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
          auto_breakeven_enabled: slConfig.autoBreakevenEnabled,
          autoBreakevenEnabled: slConfig.autoBreakevenEnabled,
          auto_breakeven_trigger_pct: slConfig.autoBreakevenTriggerPct ?? 1.0,
          autoBreakevenTriggerPct: slConfig.autoBreakevenTriggerPct ?? 1.0,
          auto_breakeven_buffer_pct: slConfig.autoBreakevenBufferPct ?? 0.05,
          autoBreakevenBufferPct: slConfig.autoBreakevenBufferPct ?? 0.05
        };

        const res = await manualTradeService.placeDragBracket({
          apiKeyId: Number(selectedApi),
          symbol: activeSymbol,
          bracketType: type,
          price: dropPrice,
          amount: targetAmount,
          isFutures: isFutures,
          side: targetSide,
          tpConfig: tpConfig,
          slConfig: attachedSlPayload,
          targetOrderId: targetOrderId,
        });

        toast.success(res.message || `✅ ${type.toUpperCase()}${buyBackSuffix} placed at ${dropPrice < 1 ? dropPrice.toFixed(6) : dropPrice.toFixed(4)}`, { id: toastId });

        fetchBalance(true);
        fetchActiveBrackets(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.detail || err?.message || `Failed to place ${type.toUpperCase()}`, { id: toastId });
      }
    };

    activeDragCleanupRef.current = () => cleanupDrag(true);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onDragAbort);
    window.addEventListener('blur', onDragAbort);
  }, [selectedApi, onChartDragBracketStart, onChartDragBracketMove, onChartDragBracketEnd, effectiveCurrentPrice, isFutures, isInverseFutures, positionData, balanceData, size, sizeMode, effectiveOrderPrice, tradeSide, activeSymbol, tpConfig, slConfig, fetchBalance, fetchActiveBrackets, hasLivePendingOrPosition, selectedForceTarget, forceOrderTargets, selectedForceOrderId]);

  React.useEffect(() => {
    if (!isOpen) {
      activeDragCleanupRef.current?.();
    }
  }, [isOpen]);

  React.useEffect(() => () => activeDragCleanupRef.current?.(), []);

  const handleTrade = async (side: 'Buy' | 'Sell') => {
    if (!selectedApi) {
      toast.error('Please select an API Key to execute the trade.');
      setIsMinimized(false);
      return;
    }

    // Sync tradeSide and recalculate percentage-based size when clicking Buy/Sell for the opposite side (e.g. in Minimized mode)
    let resolvedSizeStr = size;
    if (side !== tradeSide || ((!resolvedSizeStr || Number(resolvedSizeStr) <= 0) && selectedPercent)) {
      if (side !== tradeSide) setTradeSide(side);
      if (selectedPercent && balanceData && effectiveOrderPrice > 0) {
        const recalculated = calculateSize(
          selectedPercent,
          balanceData,
          effectiveOrderPrice,
          sizeMode,
          side,
          isFutures,
          leverage,
          reduceOnly,
          positionData
        );
        if (recalculated && Number(recalculated) > 0) {
          resolvedSizeStr = recalculated;
          setSize(recalculated);
        } else if (!isFutures) {
          toast.error(`Insufficient ${side === 'Buy' ? quoteCurrency : baseCurrency} balance for ${side} order.`);
          return;
        }
      }
    }

    if (!resolvedSizeStr || isNaN(Number(resolvedSizeStr)) || Number(resolvedSizeStr) <= 0) {
      toast.error('Please enter a valid size');
      setIsMinimized(false);
      return;
    }

    if (mlFilterConfig.enabled && !(isFutures && reduceOnly)) {
      if (!mlFilterConfig.modelId) {
        toast.error('🤖 Please select a trained ML Model from Registry for the L2 ML Filter, or turn off the filter.');
        setIsMinimized(false);
        return;
      }
    }

    const refEntryPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;

    if (tpConfig.enabled) {
      const tpVal = Number(tpConfig.value);
      if (!tpConfig.value || isNaN(tpVal) || tpVal <= 0) {
        toast.error('Please enter a valid target gap for the Attached TP.');
        return;
      }
      if (refEntryPrice > 0) {
        let estTp = 0;
        if (tpConfig.mode === 'percentage') {
          estTp = side === 'Buy' ? refEntryPrice * (1 + tpVal / 100) : refEntryPrice * (1 - tpVal / 100);
        } else if (tpConfig.mode === 'price') {
          estTp = side === 'Buy' ? refEntryPrice + tpVal : refEntryPrice - tpVal;
        } else if (tpConfig.mode === 'absolute') {
          estTp = tpVal;
        }
        if (estTp <= 0) {
          toast.error(`❌ Invalid TP price: computed TP (${estTp.toFixed(6)}) must be greater than 0.`);
          return;
        }
        if (side === 'Buy' && estTp <= refEntryPrice) {
          toast.error(`❌ For a BUY order, Take-Profit (${formatDisplayPrice(estTp)}) must be ABOVE entry price (${formatDisplayPrice(refEntryPrice)}).`);
          return;
        }
        if (side === 'Sell' && estTp >= refEntryPrice) {
          toast.error(`❌ For a SELL order, Take-Profit (${formatDisplayPrice(estTp)}) must be BELOW entry price (${formatDisplayPrice(refEntryPrice)}).`);
          return;
        }
        if (Math.abs(estTp - refEntryPrice) / refEntryPrice < 0.00001) {
          toast.error(`❌ TP gap (${tpConfig.value}) is too small for ${activeSymbol} at $${formatDisplayPrice(refEntryPrice)} and would round to entry price.`);
          return;
        }
      }
    }

    if (slConfig.enabled) {
      if (slConfig.mode !== 'atr' && (!slConfig.value || isNaN(Number(slConfig.value)) || Number(slConfig.value) <= 0)) {
        toast.error('Please enter a valid gap for the Attached Stop-Loss.');
        return;
      }
      if (slConfig.mode === 'atr' && (slConfig.atrPeriod <= 0 || slConfig.atrMultiplier <= 0)) {
        toast.error('Please enter a valid ATR Period and Multiplier.');
        return;
      }
      if ((slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase') && (!slConfig.smartChaseDeviationPct || slConfig.smartChaseDeviationPct <= 0)) {
        toast.error('Please enter a valid Max Deviation (%) for Smart Chase.');
        return;
      }
      if (slConfig.autoBreakevenEnabled && (!slConfig.autoBreakevenTriggerPct || slConfig.autoBreakevenTriggerPct <= 0)) {
        toast.error('Please enter a valid trigger profit % for Auto-Breakeven.');
        return;
      }
      if (slConfig.mode !== 'atr' && refEntryPrice > 0) {
        const slVal = Number(slConfig.value);
        let estSl = 0;
        if (slConfig.mode === 'percentage') {
          estSl = side === 'Buy' ? refEntryPrice * (1 - slVal / 100) : refEntryPrice * (1 + slVal / 100);
        } else if (slConfig.mode === 'price') {
          estSl = side === 'Buy' ? refEntryPrice - slVal : refEntryPrice + slVal;
        } else if (slConfig.mode === 'absolute') {
          estSl = slVal;
        }
        if (estSl <= 0) {
          toast.error(`❌ Invalid SL price: computed SL (${estSl.toFixed(6)}) must be greater than 0.`);
          return;
        }
        if (side === 'Buy' && estSl >= refEntryPrice) {
          toast.error(`❌ For a BUY order, Stop-Loss (${formatDisplayPrice(estSl)}) must be BELOW entry price (${formatDisplayPrice(refEntryPrice)}).`);
          return;
        }
        if (side === 'Sell' && estSl <= refEntryPrice) {
          toast.error(`❌ For a SELL order, Stop-Loss (${formatDisplayPrice(estSl)}) must be ABOVE entry price (${formatDisplayPrice(refEntryPrice)}).`);
          return;
        }
        if (Math.abs(estSl - refEntryPrice) / refEntryPrice < 0.00001) {
          toast.error(`❌ SL gap (${slConfig.value}) is too small for ${activeSymbol} at $${formatDisplayPrice(refEntryPrice)} and would round to entry price.`);
          return;
        }
      }
    }

    // Convert quote amount → base amount / contracts if needed
    let baseAmount = Number(resolvedSizeStr);
    let contractsCount: number | undefined = undefined;
    const convPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;

    if (isInverseFutures) {
      if (convPrice <= 0) {
        toast.error('Cannot execute COIN-M trade: reference price is unavailable.');
        return;
      }
      const usdVal = sizeMode === 'quote' ? Number(resolvedSizeStr) : Number(resolvedSizeStr) * convPrice;
      contractsCount = Math.max(1, Math.round(usdVal / contractSize));
      if (usdVal < (contractSize * 0.9)) {
        toast.error(`❌ Minimum order size for ${activeSymbol} is 1 contract ($${contractSize} USD). Current order value is ~$${usdVal.toFixed(2)} USD.`);
        return;
      }
      baseAmount = (contractsCount * contractSize) / convPrice;
    } else if (sizeMode === 'quote') {
      if (convPrice <= 0) {
        toast.error('Cannot convert: reference price is unavailable.');
        return;
      }
      baseAmount = Number(resolvedSizeStr) / convPrice;
    }
    
    setIsSubmitting(true);
    setSubmittingSide(side);
    try {
      if (orderType === 'Limit' && !isAutoLimit && (!limitPrice || Number(limitPrice) <= 0)) {
        toast.error('Please enter a valid limit price or enable Auto Limit.');
        return; // finally block handles setIsSubmitting(false)
      }

      // Validate Iceberg (Spot Limit only)
      if (orderType === 'Limit' && !isFutures && isIceberg) {
        if (effectiveIcebergQty <= 0) {
          toast.error('Please enter a valid visible Iceberg slice quantity.');
          return;
        }
        if (effectiveIcebergQty >= baseAmount) {
          toast.error(`Iceberg slice (${effectiveIcebergQty.toFixed(2)}) must be smaller than total order quantity (${baseAmount.toFixed(2)} ${baseCurrency}).`);
          return;
        }
        const refPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
        const sliceNotional = effectiveIcebergQty * refPrice;
        if (sliceNotional < 5.0) {
          const minQty = refPrice > 0 ? Math.ceil(5.05 / refPrice) : 65;
          toast.error(`❌ Iceberg slice value (~$${sliceNotional.toFixed(2)}) is below Binance minimum $5 notional! Minimum slice is ~${minQty} ${baseCurrency}.`, { duration: 6000 });
          return;
        }
      }

      const paramsPayload: any = isFutures ? { leverage, marginMode, reduceOnly } : {};
      if (isInverseFutures && contractsCount) {
        paramsPayload.contracts = contractsCount;
      }
      if (orderType === 'Limit' && isAutoLimit) {
        paramsPayload.autoBestLimit = true;
      }
      if (orderType === 'SmartPeg') {
        paramsPayload.maxChaseDeviationPct = smartPegMaxDev;
      }

      // BUG-09 fix: Use the actual selected API key's exchange instead of hardcoded 'binance'
      const resolvedExchange = apiKeys.find(k => k.id.toString() === selectedApi)?.exchange || 'binance';

      const payload: any = {
        symbol: activeSymbol,
        side,
        type: orderType,
        amount: (isInverseFutures && contractsCount) ? contractsCount : baseAmount,
        price: orderType === 'Limit' ? (isAutoLimit ? 0 : Number(limitPrice)) : undefined,
        exchange_id: resolvedExchange,
        api_key_id: selectedApi ? Number(selectedApi) : undefined,
        params: Object.keys(paramsPayload).length > 0 ? paramsPayload : undefined,
        client_timestamp: Date.now(),
        use_native_tp_sl: isNativeTpSlSupported ? Boolean(useNativeTpSl) : false,
        iceberg_qty: (orderType === 'Limit' && !isFutures && isIceberg && effectiveIcebergQty > 0) ? effectiveIcebergQty : undefined
      };

      if (tpConfig.enabled && tpConfig.value && Number(tpConfig.value) > 0) {
        payload.attached_tp = {
          enabled: true,
          mode: tpConfig.mode,
          value: Number(tpConfig.value),
          order_type: tpConfig.orderType,
          timeout_mins: tpConfig.timeoutMins
        };
      }

      if (slConfig.enabled) {
        if (slConfig.mode === 'atr' || (slConfig.value && Number(slConfig.value) > 0)) {
          payload.attached_sl = {
            enabled: true,
            type: slConfig.type,
            mode: slConfig.mode,
            value: Number(slConfig.value || 0),
            atr_period: slConfig.atrPeriod,
            atr_multiplier: slConfig.atrMultiplier,
            atr_timeframe: slConfig.atrTimeframe,
            timeout_mins: slConfig.timeoutMins,
            smart_chase_deviation_pct: slConfig.smartChaseDeviationPct ?? 5.0,
            smartChaseDeviationPct: slConfig.smartChaseDeviationPct ?? 5.0,
            smart_chase_delay_ms: slConfig.smartChaseDelayMs ?? 1500,
            smartChaseDelayMs: slConfig.smartChaseDelayMs ?? 1500,
            smart_chase_max_attempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
            smartChaseMaxAttempts: slConfig.smartChaseMaxAttempts !== undefined && slConfig.smartChaseMaxAttempts !== null ? slConfig.smartChaseMaxAttempts : 10000,
            smart_chase_mode: slConfig.smartChaseMode || 'dynamic_bbo',
            smartChaseMode: slConfig.smartChaseMode || 'dynamic_bbo',
            smart_chase_trigger_source: slConfig.smartChaseTriggerSource || 'bid_ask',
            smartChaseTriggerSource: slConfig.smartChaseTriggerSource || 'bid_ask',
            smart_chase_peg_strategy: slConfig.smartChasePegStrategy || 'bbo',
            smartChasePegStrategy: slConfig.smartChasePegStrategy || 'bbo',
            smart_chase_wall_multiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
            smartChaseWallMultiplier: slConfig.smartChaseWallMultiplier ?? 2.5,
            auto_breakeven_enabled: slConfig.autoBreakevenEnabled,
            autoBreakevenEnabled: slConfig.autoBreakevenEnabled,
            auto_breakeven_trigger_pct: slConfig.autoBreakevenTriggerPct ?? 1.0,
            autoBreakevenTriggerPct: slConfig.autoBreakevenTriggerPct ?? 1.0,
            auto_breakeven_buffer_pct: slConfig.autoBreakevenBufferPct ?? 0.05,
            autoBreakevenBufferPct: slConfig.autoBreakevenBufferPct ?? 0.05
          };
        }
      }

      if (mlFilterConfig.enabled && mlFilterConfig.modelId && !(isFutures && reduceOnly)) {
        payload.enable_ml_filter = true;
        payload.ml_model_id = mlFilterConfig.modelId;
        payload.ml_execution_mode = mlFilterConfig.executionMode;
        payload.ml_bullish_threshold = mlFilterConfig.bullishThreshold;
        payload.ml_bearish_threshold = mlFilterConfig.bearishThreshold;
      }

      const orderRes = await manualTradeService.placeOrder(payload);
      if (orderRes?.rejected_by_ai || orderRes?.status === 'rejected_by_ai') {
        triggerAiShieldRejection(orderRes, side);
        return;
      }
      setAiRejectNotice(null);

      const createdOrderId = orderRes?.id;
      const aiNote = orderRes?.ai_filter_info ? ` [🤖 ${orderRes.ai_filter_info}]` : '';

      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-sm w-full ${isThermalGuardActive ? 'bg-[#0B0E14]/95' : 'bg-[#070b14]/95 backdrop-blur-xl'} border border-cyan-500/40 rounded-xl shadow-[0_10px_35px_rgba(0,0,0,0.85)] p-3 text-white pointer-events-auto flex items-center justify-between gap-3`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-base shrink-0">{orderType === 'SmartPeg' ? '⚡' : '✅'}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold truncate">
                  {side} {orderType} Placed {aiNote}
                </span>
                <span className="text-[10px] text-gray-400 font-mono truncate">
                  {activeSymbol} {createdOrderId ? `• #${createdOrderId}` : ''}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {createdOrderId && orderType !== 'Market' && (
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(t.id);
                    handleCancelOrder(String(createdOrderId));
                  }}
                  className="px-2 py-1 rounded bg-rose-500/25 hover:bg-rose-500 border border-rose-500/40 text-rose-200 hover:text-white text-[10px] font-mono font-bold uppercase transition-all cursor-pointer active:scale-95"
                  title="Immediately cancel this order"
                >
                  ✕ Cancel
                </button>
              )}
              {orderType === 'Market' && isFutures && (
                <button
                  type="button"
                  onClick={() => {
                    toast.dismiss(t.id);
                    handleClosePosition();
                  }}
                  className="px-2 py-1 rounded bg-rose-500/25 hover:bg-rose-500 border border-rose-500/40 text-rose-200 hover:text-white text-[10px] font-mono font-bold uppercase transition-all cursor-pointer active:scale-95"
                  title="Immediately close this position at Market"
                >
                  ⚡ Close
                </button>
              )}
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ),
        { duration: 6000 }
      );

      // Auto-refresh balance & open orders immediately after order placement, followed by staggered syncs
      fetchActiveBrackets(true);
      fetchBalance(true);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
      }, 1200);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
      }, 2500);
    } catch (error: any) {
      // BUG-02 fix: Read FastAPI detail message if available
      const errMsg = error?.response?.data?.detail || error?.message || 'Unknown error occurred';
      if (typeof errMsg === 'string' && errMsg.includes('AI Filter Denied')) {
        triggerAiShieldRejection(errMsg, side);
      } else if (typeof errMsg === 'string' && errMsg.includes('AI Filter')) {
        toast.error(errMsg, { duration: 5000 });
      } else {
        toast.error(`❌ Order failed: ${errMsg}`);
      }
    } finally {
      // BUG-02 fix: Always reset submitting state regardless of outcome
      setIsSubmitting(false);
      setSubmittingSide(null);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!isOpen && (
          <MotionButton
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => {
              setIsOpen(true);
              setIsMinimized(false);
              setTradeSide('Sell');
            }}
            className={`absolute inset-0 w-full h-full rounded-full flex items-center justify-center border text-white ${isThermalGuardActive ? '' : 'backdrop-blur-md'} z-[999] transition-all focus:outline-none group ${
              activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging')
                ? 'bg-gradient-to-r from-red-600 via-amber-600 to-amber-500 border-amber-400 animate-pulse shadow-md dark:shadow-[0_0_20px_rgba(245,158,11,0.7)]'
                : `bg-brand-primary hover:bg-blue-600 border-slate-900/15 dark:border-blue-400/30 shadow-md ${buttonSize === 'sm' ? 'dark:shadow-[0_0_12px_rgba(59,130,246,0.4)]' : 'dark:shadow-[0_0_20px_rgba(59,130,246,0.4)]'}`
            }`}
            title={
              activeBrackets.some(b => b.status === 'pegging')
                ? "⚡ Smart Peg Entry Active! Click to manage"
                : (activeBrackets.some(b => b.status === 'chasing') ? "⚡ Smart Chase SL Chasing! Click to manage" : "Manual Trade")
            }
          >
            {activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging') ? (
              <Zap className={`${buttonSize === 'sm' ? 'w-5 h-5' : 'w-7 h-7'} text-amber-300 fill-amber-300 animate-bounce-subtle`} />
            ) : (
              <DollarSign className={`${buttonSize === 'sm' ? 'w-5 h-5' : 'w-8 h-8'} group-hover:scale-110 transition-transform`} />
            )}
            {activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging') && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 border border-white"></span>
              </span>
            )}
            {!activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging') && openLimitOrders.length > 0 && (
              <span
                className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 rounded-full bg-amber-500 text-[9px] font-black font-mono text-slate-950 items-center justify-center border border-white shadow-md animate-pulse"
                title={`${openLimitOrders.length} Open Orders active`}
              >
                {openLimitOrders.length}
              </span>
            )}
          </MotionButton>
        )}
      </AnimatePresence>

      {/* Floating Emergency Stop Banner when modal is closed */}
      {typeof document !== 'undefined' && !isOpen && activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging') && createPortal(
        (() => {
          const activePeg = activeBrackets.find(b => b.status === 'pegging');
          const activeChase = activeBrackets.find(b => b.status === 'chasing');
          return (
            <div className={`cosmo-theme-modal fixed bottom-[104px] right-24 z-[99998] flex items-center gap-3 px-3.5 py-2 rounded-2xl ${isThermalGuardActive ? 'bg-white dark:bg-[#0B0E14]/95' : 'bg-white/95 dark:bg-[#0c0204]/95 backdrop-blur-xl'} border border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.35)] animate-fade-in select-none`}>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <div className="flex flex-col text-left">
                <span className="text-[11px] font-black text-amber-200 uppercase tracking-wide flex items-center gap-1">
                  <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                  {activePeg ? `Entry Pegging • ${activeSymbol} (${activePeg.side?.toUpperCase()})` : `SL Chasing • ${activeSymbol}`}
                </span>
                <span className="text-[10px] text-amber-300 font-mono">
                  {activePeg 
                    ? `Attempt ${activePeg.current_attempt || 1}/${activePeg.max_attempts ? activePeg.max_attempts : '∞'} • Maker: ${activePeg.current_maker_price || 'Active'}`
                    : `Attempt ${activeChase?.current_attempt || 1}/${activeChase?.max_attempts ? activeChase.max_attempts : '∞'}`
                  }
                </span>
              </div>
              {activePeg ? (
                <button
                  type="button"
                  disabled={isStoppingPeg}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopSmartPeg(activePeg);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-[11px] uppercase tracking-wider shadow-md transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Stop Smart Peg Entry Immediately"
                >
                  <Square className="w-3 h-3 fill-white" />
                  {isStoppingPeg ? 'Stopping...' : 'Stop Peg'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isStoppingChase}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStopSmartChase(activeChase);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black text-[11px] uppercase tracking-wider shadow-md transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Stop Smart Chase Immediately"
                >
                  <Square className="w-3 h-3 fill-white" />
                  {isStoppingChase ? 'Stopping...' : 'Stop SL'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(true);
                  setIsMinimized(false);
                  setTradeSide('Sell');
                }}
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white text-[10px] font-bold uppercase transition-all cursor-pointer"
              >
                Open
              </button>
            </div>
          );
        })(),
        document.body
      )}

      {/* Glassmorphism Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && (
            <div
              ref={modalContainerRef}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${dragRef.current.isDragging ? dragRef.current.currentX : (isMinimized ? hudPos.x : modalPos.x)}px, ${dragRef.current.isDragging ? dragRef.current.currentY : (isMinimized ? hudPos.y : modalPos.y)}px, 0)`,
                willChange: 'transform'
              }}
              className={`cosmo-theme-modal fixed rounded-xl ${
                isMinimized
                  ? isThermalGuardActive
                    ? 'w-[395px] max-w-[calc(100vw-12px)] bg-[#0B0E14]/95 border-cyan-500/45 shadow-[0_10px_28px_rgba(0,0,0,0.9)]'
                    : 'w-[395px] max-w-[calc(100vw-12px)] bg-[#070b14] bg-gradient-to-b from-[#0b1120]/95 via-[#070b14]/[0.98] to-[#05070d]/[0.98] border-cyan-500/40 shadow-[0_10px_32px_rgba(0,0,0,0.85),0_0_20px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl'
                  : isThermalGuardActive
                    ? 'w-80 max-w-[calc(100vw-12px)] rounded-2xl bg-[#0B0E14]/95 border-white/15 shadow-[0_8px_28px_rgba(0,0,0,0.85)]'
                    : 'w-80 max-w-[calc(100vw-12px)] rounded-2xl bg-[#000000]/80 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl'
              } border z-[99999] overflow-hidden transition-colors duration-200 select-none`}
            >
              {isMinimized ? (
                /* ULTRA-SLIM PREMIUM MINIMIZED QUICK TRADE CYBER-HUD */
                <div
                  onMouseDown={handleStartDrag}
                  onTouchStart={handleStartDrag}
                  style={{ touchAction: 'none' }}
                  className="relative select-none overflow-hidden"
                >
                  {/* Top Neon Horizon Accent Line */}
                  <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 opacity-85" />

                  <div className="px-2.5 py-1.5 space-y-1 relative z-10">
                    {/* Row 1: Single-Line Ultra-Slim Drag Handle & Header */}
                    <div
                      onMouseDown={handleStartDrag}
                      onTouchStart={handleStartDrag}
                      style={{ touchAction: 'none' }}
                      className="flex items-center justify-between gap-1 cursor-grab active:cursor-grabbing select-none"
                      title="Drag to move HUD"
                    >
                      <div className="flex items-center gap-1 min-w-0 pointer-events-none flex-wrap">
                        <GripVertical className="w-3 h-3 text-cyan-400/80 shrink-0" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse shrink-0" />
                        <span className="font-black text-white text-[11px] tracking-tight truncate max-w-[85px]">{activeSymbol}</span>
                        <span
                          className={`text-[8px] uppercase px-1 py-0.2 rounded font-mono font-extrabold border leading-tight shrink-0 ${
                            isFutures
                              ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                              : 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                          }`}
                        >
                          {isFutures ? `${leverage}x` : 'SPOT'}
                        </span>
                        {effectiveCurrentPrice > 0 && (
                          <span className="text-emerald-400 font-mono text-[10px] font-bold tracking-tight shrink-0">
                            ${formatDisplayPrice(effectiveCurrentPrice)}
                          </span>
                        )}
                        <span className="text-[8px] px-1 py-0.2 rounded bg-white/[0.06] border border-white/10 text-gray-300 font-mono font-bold uppercase leading-tight shrink-0">
                          {orderType === 'SmartPeg' ? '⚡PEG' : orderType === 'Market' ? 'MKT' : 'LMT'}
                        </span>
                        {tpConfig.enabled && (
                          <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono font-bold leading-tight shrink-0">
                            TP
                          </span>
                        )}
                        {slConfig.enabled && (
                          <span className="text-[8px] px-1 py-0.2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 font-mono font-bold leading-tight shrink-0">
                            SL
                          </span>
                        )}
                        {mlFilterConfig.enabled && (
                          <span
                            className="text-[8px] px-1 py-0.2 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300 font-mono font-bold leading-tight shrink-0"
                            title="L2 Machine Learning Entry Filter Active"
                          >
                            AI
                          </span>
                        )}
                        {openLimitOrders.length > 0 && (
                          <span
                            className="text-[8px] px-1 py-0.2 rounded bg-amber-500/25 border border-amber-500/50 text-amber-300 font-mono font-black leading-tight cursor-pointer hover:bg-amber-500/35 animate-pulse shrink-0 pointer-events-auto"
                            title={`${openLimitOrders.length} open limit orders active. Click to view and cancel.`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsMinimized(false);
                            }}
                          >
                            {openLimitOrders.length} OPEN
                          </span>
                        )}
                        {isFutures && positionData && positionData.amount > 0 && positionData.side !== 'none' && (
                          <span
                            className={`text-[8px] px-1 py-0.2 rounded font-mono font-black leading-tight border shrink-0 ${
                              positionData.side.toLowerCase() === 'long'
                                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400/50'
                                : 'bg-rose-500/25 text-rose-300 border-rose-400/50'
                            }`}
                            title={`Active Position: ${positionData.side.toUpperCase()} ${positionData.amount} ${baseCurrency}`}
                          >
                            POS:{positionData.side.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[8px] font-mono text-gray-400 hidden xl:inline max-w-[65px] truncate">
                          {balanceData
                            ? isInverseFutures
                              ? `${(balanceData.base_free || 0).toFixed(1)} ${baseCurrency}`
                              : sizeMode === 'quote' || isFutures || tradeSide === 'Buy'
                                ? `${(balanceData.quote_free || 0).toFixed(1)} ${quoteCurrency}`
                                : `${(balanceData.base_free || 0).toFixed(1)} ${baseCurrency}`
                            : ''}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchBalance(false);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`p-1 rounded bg-white/[0.04] hover:bg-white/10 border border-white/[0.07] text-gray-400 hover:text-cyan-300 transition-all cursor-pointer ${
                            isRefreshing ? 'text-cyan-400' : ''
                          }`}
                          title="Refresh Balance"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMinimized(false);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="p-1 rounded bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 hover:text-white transition-all cursor-pointer"
                          title="Expand Full Trade Terminal"
                        >
                          <Maximize2 className="w-2.5 h-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                            setIsMinimized(false);
                            onClose?.();
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="p-1 rounded bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.07] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer"
                          title="Close"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>

                    {/* Row 2: Ultra-Compact Order Size + 25/50/75/100% Shortcuts + 0-100% Slide Bar */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="rounded-lg bg-slate-50 dark:bg-[#04070e]/90 border border-slate-200 dark:border-white/[0.08] px-2 py-1 space-y-1 shadow-inner dark:shadow-[inset_0_1px_6px_rgba(0,0,0,0.65)]"
                    >
                      {/* Line 2A: Unit Switch + Size Input + 4 Shortcut Points (25, 50, 75, 100%) + Active % Badge */}
                      <div className="flex items-center justify-between gap-1">
                        {/* Base / Quote Mini Toggle */}
                        <div className="flex items-center bg-[#0a101d] rounded p-0.5 border border-white/10 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSizeMode('base');
                              if (!selectedPercent) setSize('');
                            }}
                            className={`px-1 py-0.2 rounded text-[8px] font-extrabold transition-all cursor-pointer leading-tight ${
                              sizeMode === 'base'
                                ? 'bg-cyan-500 text-slate-950'
                                : 'text-gray-400 hover:text-white'
                            }`}
                          >
                            {baseCurrency}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSizeMode('quote');
                              if (!selectedPercent) setSize('');
                            }}
                            className={`px-1 py-0.2 rounded text-[8px] font-extrabold transition-all cursor-pointer leading-tight ${
                              sizeMode === 'quote'
                                ? 'bg-amber-400 text-slate-950'
                                : 'text-gray-400 hover:text-white'
                            }`}
                          >
                            {quoteCurrency}
                          </button>
                        </div>

                        {/* Compact Size Input */}
                        <input
                          type="number"
                          value={size}
                          onChange={(e) => {
                            setSize(e.target.value);
                            setSelectedPercent(null);
                          }}
                          placeholder="0.00"
                          className="w-[74px] bg-[#0a101d]/90 border border-white/10 focus:border-cyan-400/60 rounded py-0.5 px-1.5 text-white font-mono text-[10px] font-bold focus:outline-none transition-colors"
                        />

                        {/* 4 Shortcut Point Buttons: 25%, 50%, 75%, 100% */}
                        <div className="flex items-center gap-1 flex-1 justify-end">
                          {[25, 50, 75, 100].map((pt) => {
                            const isSelected = sliderPercentValue === pt;
                            return (
                              <button
                                key={pt}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePercentSliderChange(pt);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-extrabold border transition-all cursor-pointer active:scale-95 leading-tight ${
                                  isSelected
                                    ? 'bg-gradient-to-r from-cyan-500/35 to-emerald-500/30 border-cyan-400 text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.35)]'
                                    : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-cyan-500/40 text-gray-400 hover:text-white'
                                }`}
                              >
                                {pt}%
                              </button>
                            );
                          })}
                        </div>

                        {/* Live Percentage Readout Pill */}
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-mono text-[9px] font-black shrink-0 min-w-[34px] text-center leading-tight">
                          {sliderPercentValue}%
                        </span>
                      </div>

                      {/* Line 2B: 0% to 100% Interactive Slide Bar with Milestone Track Points */}
                      <div className="relative h-3 flex items-center select-none px-1">
                        <div className="w-full h-1 rounded-full bg-slate-200 dark:bg-[#0c1424] border border-slate-300 dark:border-white/10 relative overflow-visible">
                          <div
                            style={{ width: `${sliderPercentValue}%` }}
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-emerald-400 shadow-[0_0_8px_rgba(6,182,212,0.65)] transition-all duration-75"
                          />

                          {[0, 25, 50, 75, 100].map((pt) => {
                            const isReached = sliderPercentValue >= pt && (pt > 0 || sliderPercentValue > 0);
                            return (
                              <div
                                key={pt}
                                style={{ left: `${pt}%` }}
                                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border transition-all duration-150 ${
                                  isReached
                                    ? 'bg-cyan-300 border-white shadow-[0_0_5px_rgba(34,211,238,0.9)]'
                                    : 'bg-[#152036] border-white/25'
                                }`}
                              />
                            );
                          })}
                        </div>

                        <div
                          style={{ left: `calc(${sliderPercentValue}% - 6px)` }}
                          className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,1)] transition-all duration-75"
                        />

                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={sliderPercentValue}
                          onChange={(e) => handlePercentSliderChange(Number(e.target.value))}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                          title={`Order Size: ${sliderPercentValue}%`}
                        />
                      </div>
                    </div>

                    {/* Row 2.5: Compact AI ML Filter & Model Selector Bar in Minimized HUD */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border transition-all ${
                        mlFilterConfig.enabled
                          ? 'bg-blue-950/40 border-blue-500/45 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
                          : 'bg-white/[0.02] border-white/10'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          hasManualMlOverrideRef.current = true;
                          setMlFilterConfig(prev => ({
                            ...prev,
                            enabled: !prev.enabled,
                            modelId: !prev.enabled && !prev.modelId && mlModels.length > 0 ? mlModels[0].id : prev.modelId
                          }));
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono font-extrabold uppercase tracking-wider border transition-all cursor-pointer shrink-0 flex items-center gap-1 ${
                          mlFilterConfig.enabled
                            ? 'bg-blue-600/30 border-blue-400 text-blue-200 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                            : 'bg-black/40 border-white/15 text-gray-400 hover:text-white'
                        }`}
                        title="Toggle L2 / Training Studio Machine Learning Entry Filter"
                      >
                        <span>🤖 AI {mlFilterConfig.enabled ? 'ON' : 'OFF'}</span>
                      </button>

                      <div className="relative flex-1 min-w-0">
                        <select
                          value={mlFilterConfig.modelId}
                          onChange={(e) => {
                            e.stopPropagation();
                            hasManualMlOverrideRef.current = true;
                            const val = e.target.value;
                            const opt = getModelOptimalThresholds(val);
                            setMlFilterConfig(prev => ({
                              ...prev,
                              modelId: val,
                              enabled: Boolean(val) ? true : prev.enabled,
                              bullishThreshold: prev.autoThreshold ? opt.bullish : prev.bullishThreshold,
                              bearishThreshold: prev.autoThreshold ? opt.bearish : prev.bearishThreshold
                            }));
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="w-full appearance-none bg-[#050811]/95 hover:bg-[#080d1a] text-blue-200 font-mono text-[9px] font-bold rounded border border-blue-500/30 focus:border-blue-400 pl-1.5 pr-4 py-0.5 truncate cursor-pointer focus:outline-none transition-colors"
                          title="Select Trained ML Model from ML Registry"
                        >
                          <option value="" className="bg-[#070b14] text-gray-400">
                            {mlModels.length === 0 ? 'No ML Registry Models' : '-- Select ML Model --'}
                          </option>
                          {mlModels.map((m) => (
                            <option key={m.id} value={m.id} className="bg-[#070b14] text-white font-mono">
                              {`${m.name} (${m.modelType})`}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="w-2.5 h-2.5 text-blue-400 pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" />
                      </div>

                      {mlFilterConfig.enabled && (
                        <span
                          className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-black/50 border border-blue-500/30 text-blue-300 shrink-0"
                          title="Bullish BUY Threshold / Bearish SELL Threshold"
                        >
                          B:{(mlFilterConfig.bullishThreshold * 100).toFixed(0)}% S:{(mlFilterConfig.bearishThreshold * 100).toFixed(0)}%
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchMlModels();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-0.5 rounded bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-400 hover:text-blue-300 transition-colors cursor-pointer shrink-0"
                        title="Refresh ML Models from Registry"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isLoadingMlModels ? 'animate-spin text-blue-400' : ''}`} />
                      </button>
                    </div>

                    {/* Row 3: Sleek Single-Line Quick Buy & Sell Execution Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTrade('Buy');
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="relative overflow-hidden py-1.5 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 bg-emerald-500/15 dark:bg-gradient-to-b dark:from-emerald-500/30 dark:via-emerald-600/25 dark:to-green-900/40 hover:bg-emerald-500 dark:hover:from-emerald-500 dark:hover:via-emerald-600 dark:hover:to-green-700 text-emerald-700 dark:text-emerald-300 hover:text-white border border-emerald-500/40 dark:border-emerald-400/50 hover:border-emerald-400 dark:hover:border-emerald-300 shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_12px_rgba(16,185,129,0.2)] hover:shadow-[0_0_18px_rgba(16,185,129,0.45)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer group"
                      >
                        {isSubmitting && submittingSide === 'Buy' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-300 shrink-0" />
                        ) : (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 group-hover:text-white transition-transform shrink-0" />
                        )}
                        <span className="text-[11px] uppercase tracking-wider font-black leading-none">
                          {isSubmitting && submittingSide === 'Buy' ? 'Buying...' : isFutures ? 'BUY / LONG' : 'BUY'}
                        </span>
                        {size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                          <span className="text-[9px] font-mono text-emerald-700/90 dark:text-emerald-200/90 group-hover:text-white font-semibold truncate">
                            • ${sizeMode === 'quote' ? Number(size).toFixed(0) : (Number(size) * effectiveOrderPrice).toFixed(0)}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTrade('Sell');
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="relative overflow-hidden py-1.5 px-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 bg-rose-500/15 dark:bg-gradient-to-b dark:from-rose-500/30 dark:via-rose-600/25 dark:to-red-900/40 hover:bg-rose-500 dark:hover:from-rose-500 dark:hover:via-rose-600 dark:hover:to-red-700 text-rose-700 dark:text-rose-300 hover:text-white border border-rose-500/40 dark:border-rose-400/50 hover:border-rose-400 dark:hover:border-rose-300 shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_12px_rgba(244,63,94,0.2)] hover:shadow-[0_0_18px_rgba(244,63,94,0.45)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer group"
                      >
                        {isSubmitting && submittingSide === 'Sell' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600 dark:text-rose-300 shrink-0" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 group-hover:text-white transition-transform shrink-0" />
                        )}
                        <span className="text-[11px] uppercase tracking-wider font-black leading-none">
                          {isSubmitting && submittingSide === 'Sell' ? 'Selling...' : isFutures ? 'SELL / SHORT' : 'SELL'}
                        </span>
                        {size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                          <span className="text-[9px] font-mono text-rose-700/90 dark:text-rose-200/90 group-hover:text-white font-semibold truncate">
                            • ${sizeMode === 'quote' ? Number(size).toFixed(0) : (Number(size) * effectiveOrderPrice).toFixed(0)}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Row 3.5: Interactive Drag-to-Chart TP / SL Quick Protector Bar (Always available for Pending & Executed Trades) */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="grid grid-cols-2 gap-1.5"
                    >
                      {/* Drag TP Handle */}
                      <div
                        onPointerDown={(e) => startLineDrag(e, 'tp')}
                        style={{ touchAction: 'none' }}
                        className="py-1 px-2 rounded-lg border border-emerald-400/40 hover:border-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 text-emerald-300 flex items-center justify-between font-mono text-[9px] font-black select-none transition-all cursor-grab active:cursor-grabbing shadow-[0_0_10px_rgba(16,185,129,0.12)] active:scale-95 group"
                        title="Touch or drag onto chart to place Take Profit at your target price level"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Target className="w-3 h-3 text-emerald-400 group-hover:scale-110 transition-transform shrink-0" />
                          <span className="uppercase tracking-wider">Drag TP</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[7.5px] px-1 py-0.2 rounded font-bold uppercase border bg-emerald-500/20 text-emerald-300 border-emerald-400/30">
                            {tpConfig.orderType}
                          </span>
                          <MoveVertical className="w-3 h-3 text-emerald-400/70" />
                        </div>
                      </div>

                      {/* Drag SL Handle */}
                      <div
                        onPointerDown={(e) => startLineDrag(e, 'sl')}
                        style={{ touchAction: 'none' }}
                        className="py-1 px-2 rounded-lg border border-rose-400/40 hover:border-rose-300 bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 text-rose-300 flex items-center justify-between font-mono text-[9px] font-black select-none transition-all cursor-grab active:cursor-grabbing shadow-[0_0_10px_rgba(244,63,94,0.12)] active:scale-95 group"
                        title="Touch or drag onto chart to place Stop Loss (Smart Chase) at your target price level"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <ShieldAlert className="w-3 h-3 text-rose-400 group-hover:scale-110 transition-transform shrink-0" />
                          <span className="uppercase tracking-wider">Drag SL</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[7.5px] px-1 py-0.2 rounded font-bold uppercase border bg-rose-500/20 text-rose-300 border-rose-400/30">
                            {slConfig.type === 'smart_chase' ? '⚡Chase' : slConfig.type === 'trailing' ? 'Trail' : 'Fixed'}
                          </span>
                          <MoveVertical className="w-3 h-3 text-rose-400/70" />
                        </div>
                      </div>
                    </div>

                    {/* Row 4: Ultra-Slim Emergency Force Buy / Sell Panel with Target Order Selector */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="rounded-lg bg-slate-50 dark:bg-gradient-to-r dark:from-[#13070c]/95 dark:via-[#090d18]/95 dark:to-[#061310]/95 border border-amber-500/35 px-2 py-1 space-y-1 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    >
                      {/* Sub-Row 4A: Target Order Selector (Select which specific Open Order / Bracket to Force Buy/Sell, or ALL) */}
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className="flex items-center gap-1 text-[8px] font-mono font-extrabold uppercase tracking-tight text-amber-300/90 shrink-0"
                          title="Choose which open order or active bracket to cancel & force execute at current price"
                        >
                          <span>🎯 ORDER</span>
                          <span
                            className={`px-1 py-0.2 rounded text-[7px] font-black leading-none border ${
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
                              userChoseAllForceRef.current = val === 'all' && forceOrderTargets.length > 0;
                              setSelectedForceOrderId(val);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="w-full appearance-none bg-[#050811]/95 hover:bg-[#080d1a] text-cyan-200 font-mono text-[9px] font-bold rounded border border-cyan-500/35 focus:border-amber-400/80 pl-1.5 pr-4 py-0.5 truncate cursor-pointer focus:outline-none transition-colors"
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
                          <ChevronDown className="w-2.5 h-2.5 text-cyan-400 pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" />
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchActiveBrackets(true);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="p-0.5 rounded bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-400 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
                          title="Refresh Open Orders List"
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                        </button>

                        {forceOrderTargets.length > 0 && (
                          <button
                            type="button"
                            disabled={cancellingOrderId !== null || isCancellingAll}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedForceOrderId !== 'all') {
                                handleCancelOrder(selectedForceOrderId);
                              } else {
                                handleCancelAllOrders();
                              }
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500 border border-rose-500/40 text-rose-200 hover:text-white text-[8px] font-mono font-black uppercase tracking-tight transition-all cursor-pointer shrink-0 active:scale-95 disabled:opacity-50"
                            title={selectedForceOrderId !== 'all' ? `Cancel Selected Order #${selectedForceOrderId}` : 'Cancel ALL Open Orders'}
                          >
                            {cancellingOrderId || isCancellingAll ? (
                              <RefreshCw className="w-2 h-2 animate-spin" />
                            ) : (
                              <span>✕ {selectedForceOrderId !== 'all' ? 'Cancel' : 'Cancel All'}</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Sub-Row 4B: Execution Mode (1. Limit Maker 0% Fee | 2. Market) + Force Buy & Force Sell Triggers */}
                      <div className="flex items-center justify-between gap-1.5">
                        {/* Left: Emergency Label + 2 Execution Mode Options (1. Limit Maker 0% Fee | 2. Market) */}
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="flex items-center gap-0.5 text-[8px] font-black uppercase tracking-wider text-amber-300"
                            title="Emergency Force Trigger: Cancels selected order & executes at current price"
                          >
                            <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400 animate-pulse" />
                            FORCE
                          </span>

                          <div className="flex items-center bg-[#050811] rounded p-0.5 border border-white/10">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEmergencyMode('limit_maker');
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-extrabold transition-all cursor-pointer leading-none ${
                                emergencyMode === 'limit_maker'
                                  ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                              title="Option 1: Dynamic Limit Maker (0% Maker Fee — chases Best Bid/Ask until 100% filled)"
                            >
                              MAKER 0%
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEmergencyMode('market');
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-extrabold transition-all cursor-pointer leading-none ${
                                emergencyMode === 'market'
                                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                              title="Option 2: Instant Market Price Sweep"
                            >
                              MARKET
                            </button>
                          </div>
                        </div>

                        {/* Right: Instant Emergency Force Buy & Force Sell Triggers (+ Stop button if Peg/Chase active) */}
                        <div className="flex items-center gap-1 flex-1 justify-end">
                          {isFutures && positionData && positionData.amount > 0 && positionData.side !== 'none' && (
                            <button
                              type="button"
                              disabled={isClosingPosition}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClosePosition();
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="px-1.5 py-1 rounded bg-rose-600 hover:bg-rose-500 border border-rose-400 text-white font-mono text-[8px] font-black uppercase tracking-tight transition-all cursor-pointer active:scale-95 shrink-0 shadow-[0_0_8px_rgba(244,63,94,0.4)] disabled:opacity-50"
                              title={`Instant Market Close Active ${positionData.side.toUpperCase()} Position (${positionData.amount} ${baseCurrency})`}
                            >
                              {isClosingPosition ? <RefreshCw className="w-2 h-2 animate-spin" /> : <span>⚡ CLOSE</span>}
                            </button>
                          )}

                          {activeBrackets.some((b) => b.status === 'pegging' || b.status === 'chasing') && (
                            <button
                              type="button"
                              disabled={isStoppingPeg || isStoppingChase}
                              onClick={(e) => {
                                e.stopPropagation();
                                const peg = activeBrackets.find((b) => b.status === 'pegging');
                                if (peg) {
                                  handleStopSmartPeg(peg);
                                } else {
                                  handleStopSmartChase(activeBrackets.find((b) => b.status === 'chasing'));
                                }
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="px-1.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500 border border-amber-400/60 text-amber-200 hover:text-slate-950 font-mono text-[8px] font-black uppercase tracking-tight transition-all cursor-pointer active:scale-95 shrink-0"
                              title="Stop Active Smart Peg / Chase Immediately"
                            >
                              ⏹ STOP
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isEmergencySubmitting || selectedForceTarget?.side === 'sell'}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedForceTarget?.side === 'sell') return;
                              handleEmergencyForceTrade('Buy');
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`flex-1 py-1 px-1.5 rounded font-mono text-[9px] font-black uppercase tracking-tight flex items-center justify-center gap-1 transition-all ${
                              selectedForceTarget?.side === 'sell'
                                ? 'bg-white/[0.02] border border-white/5 text-gray-500 opacity-25 cursor-not-allowed select-none'
                                : `bg-emerald-500/15 dark:bg-gradient-to-r dark:from-emerald-600/35 dark:to-cyan-600/35 hover:bg-emerald-500 dark:hover:from-emerald-500 dark:hover:to-cyan-500 border hover:border-emerald-400 dark:hover:border-white text-emerald-700 dark:text-emerald-200 hover:text-white dark:hover:text-slate-950 shadow-sm dark:shadow-[0_0_10px_rgba(16,185,129,0.2)] hover:shadow-[0_0_14px_rgba(16,185,129,0.5)] cursor-pointer active:scale-95 disabled:opacity-50 ${
                                    selectedForceTarget?.side === 'buy'
                                      ? 'border-emerald-500 dark:border-emerald-300 ring-1 ring-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                                      : 'border-emerald-500/50 dark:border-emerald-400/60'
                                  }`
                            }`}
                            title={
                              selectedForceTarget?.side === 'sell'
                                ? 'Cannot Force Buy: Selected order is a SELL / Exit order'
                                : selectedForceTarget
                                  ? `Force BUY Selected Order (${selectedForceTarget.label}) via ${
                                      emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'
                                    }`
                                  : `Emergency Force BUY (${sliderPercentValue > 0 ? sliderPercentValue : 100}%) via ${
                                      emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'
                                    }`
                            }
                          >
                            {isEmergencySubmitting && emergencySubmittingSide === 'Buy' ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
                            ) : (
                              <Zap className={`w-2.5 h-2.5 shrink-0 ${selectedForceTarget?.side === 'sell' ? 'opacity-30' : 'fill-current'}`} />
                            )}
                            <span>FORCE BUY</span>
                            {selectedForceTarget?.side === 'buy' && (
                              <span className="text-[7.5px] font-black text-emerald-300 bg-emerald-950/80 px-1 py-0.2 rounded border border-emerald-500/50 leading-none">
                                FILL
                              </span>
                            )}
                            <span className="text-[8px] opacity-90">
                              {selectedForceTarget
                                ? `${Number(selectedForceTarget.amount.toFixed(1))}`
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
                              handleEmergencyForceTrade('Sell');
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`flex-1 py-1 px-1.5 rounded font-mono text-[9px] font-black uppercase tracking-tight flex items-center justify-center gap-1 transition-all ${
                              selectedForceTarget?.side === 'buy'
                                ? 'bg-white/[0.02] border border-white/5 text-gray-500 opacity-25 cursor-not-allowed select-none'
                                : `bg-rose-500/15 dark:bg-gradient-to-r dark:from-rose-600/40 dark:to-amber-600/35 hover:bg-rose-500 dark:hover:from-rose-500 dark:hover:to-amber-500 border hover:border-rose-400 dark:hover:border-white text-rose-700 dark:text-rose-200 hover:text-white shadow-sm dark:shadow-[0_0_10px_rgba(244,63,94,0.25)] hover:shadow-[0_0_14px_rgba(244,63,94,0.55)] cursor-pointer active:scale-95 disabled:opacity-50 ${
                                    selectedForceTarget?.side === 'sell'
                                      ? 'border-rose-500 dark:border-rose-300 ring-1 ring-rose-400/60 shadow-[0_0_12px_rgba(244,63,94,0.35)]'
                                      : 'border-rose-500/50 dark:border-rose-400/60'
                                  }`
                            }`}
                            title={
                              selectedForceTarget?.side === 'buy'
                                ? 'Cannot Force Sell: Selected pending order is a BUY (Entry not filled yet)'
                                : selectedForceTarget
                                  ? `Force SELL Selected Order (${selectedForceTarget.label}) via ${
                                      emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'
                                    }`
                                  : `Emergency Force SELL (${sliderPercentValue > 0 ? sliderPercentValue : 100}%) via ${
                                      emergencyMode === 'limit_maker' ? 'Limit Maker (0% Fee)' : 'Market Price'
                                    }`
                            }
                          >
                            {isEmergencySubmitting && emergencySubmittingSide === 'Sell' ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin shrink-0" />
                            ) : (
                              <Zap className={`w-2.5 h-2.5 shrink-0 ${selectedForceTarget?.side === 'buy' ? 'opacity-30' : 'fill-current'}`} />
                            )}
                            <span>FORCE SELL</span>
                            {selectedForceTarget?.side === 'sell' && (
                              <span className="text-[7.5px] font-black text-rose-300 bg-rose-950/80 px-1 py-0.2 rounded border border-rose-500/50 leading-none">
                                EXIT
                              </span>
                            )}
                            <span className="text-[8px] opacity-90">
                              {selectedForceTarget
                                ? `${Number(selectedForceTarget.amount.toFixed(1))}`
                                : sliderPercentValue > 0
                                  ? `${sliderPercentValue}%`
                                  : '100%'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Header (Drag area) */}
                  <div 
                    onMouseDown={handleStartDrag}
                    onTouchStart={handleStartDrag}
                    style={{ touchAction: 'none' }}
                    className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5 cursor-grab active:cursor-grabbing select-none"
                    title="Drag to move"
                  >
                    <div className="flex flex-col pointer-events-none text-left">
                      <span className="font-bold text-white text-lg tracking-wide leading-tight">{activeSymbol}</span>
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-brand-primary">
                        <span>Quick Trade • {isFutures ? 'Futures' : 'Spot'}</span>
                        {effectiveCurrentPrice > 0 && (
                          <span className="text-gray-400 font-mono normal-case">
                            (${formatDisplayPrice(effectiveCurrentPrice)})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchBalance(false);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={`p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-cyan-400 transition-colors cursor-pointer ${isRefreshing ? 'text-cyan-400' : ''}`}
                        title="Refresh Balance & Position"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMinimized(true);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                        title="Minimize to Quick Buy/Sell"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          setIsOpen(false); 
                          setIsMinimized(false);
                          onClose?.();
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

              {/* Multi-Chart Pair Selector Dropdown */}
              {availablePairs && availablePairs.length > 1 && (
                <div className="px-4 py-2.5 bg-black/60 border-b border-white/10 space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse" />
                      Select Chart Pair ({availablePairs.length} Open)
                    </label>
                  </div>
                  <div className="relative">
                    <select
                      value={activeSymbol}
                      onChange={(e) => {
                        const targetSymbol = e.target.value;
                        const selected = availablePairs.find(p => p.symbol === targetSymbol);
                        if (selected) {
                          handleSelectPair(selected);
                        }
                      }}
                      className="w-full bg-[#0a0d16] border border-brand-primary/40 hover:border-brand-primary rounded-xl py-2 pl-3 pr-8 text-white font-bold text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary/50 transition-all appearance-none cursor-pointer shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                    >
                      {availablePairs.map((p) => {
                        const pPrice = formatDisplayPrice(p.price);
                        const label = `${p.symbol}${pPrice ? ` • $${pPrice}` : ''}${p.isMain ? ' (Main)' : ''}`;
                        return (
                          <option key={p.id} value={p.symbol} className="bg-[#0b0e17] text-white py-1">
                            {label}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="absolute right-3 top-[10px] w-4 h-4 text-brand-primary pointer-events-none" />
                  </div>
                </div>
              )}

              {/* Body */}
              <div 
                className="p-4 flex flex-col cursor-default"
              >
              {/* Scrollable Content */}
              <div
                style={{ touchAction: 'pan-y' }}
                className="space-y-4 max-h-[55vh] overflow-y-auto pr-1 pb-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20"
              >

              {/* ACTIVE SMART CHASE / SOFTWARE SL / SMART PEG LIVE STATUS & CANCEL BUTTON */}
              {(() => {
                const activePeg = activeBrackets.find(b => b.status === 'pegging');
                const activeChase = activeBrackets.find(b => b.status === 'chasing');
                const activeSoftwareSls = activeBrackets.filter(b => b.status === 'monitoring' && (b.type === 'smart_chase' || b.type === 'trailing_chase' || b.type === 'trailing' || b.auto_breakeven_enabled));

                if (activePeg) {
                  return (
                    <div className="p-3 rounded-xl bg-gradient-to-br from-amber-950/90 via-black to-amber-950/40 border border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.25)] flex flex-col gap-2.5 animate-fadeIn">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                          </span>
                          <span className="text-xs font-black tracking-wide text-amber-200 uppercase flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                            Smart Peg Entry Active
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          Attempt {activePeg.current_attempt || 1}/{activePeg.max_attempts ? activePeg.max_attempts : '∞'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-black/60 p-2 rounded-lg border border-white/5 font-mono">
                        <div className="text-left">
                          <span className="text-gray-400 block text-[9px] uppercase">Side</span>
                          <span className={`font-bold ${activePeg.side?.toLowerCase() === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                            {activePeg.side?.toUpperCase()} (Maker)
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-400 block text-[9px] uppercase">Best Maker Price</span>
                          <span className="text-amber-300 font-bold">{activePeg.current_maker_price || 'Active'}</span>
                        </div>
                        <div className="text-left col-span-2 pt-1 border-t border-white/5 flex justify-between text-[9px]">
                          <span className="text-gray-400">Target Size / Filled:</span>
                          <span className="text-gray-200 font-semibold">{activePeg.filled_amount || 0} / {activePeg.amount}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isStoppingPeg}
                        onClick={() => handleStopSmartPeg(activePeg)}
                        className="w-full py-2 px-3 rounded-lg bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <Square className="w-3.5 h-3.5 fill-white" />
                        {isStoppingPeg ? 'Stopping Peg...' : 'Stop Smart Peg Entry'}
                      </button>
                    </div>
                  );
                }

                if (activeChase) {
                  return (
                    <div className="p-3 rounded-xl bg-gradient-to-br from-red-950/90 via-amber-950/70 to-black border border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.25)] flex flex-col gap-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                          </span>
                          <span className="text-xs font-black tracking-wide text-red-200 uppercase flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                            {activeChase.chase_mode === 'dynamic_bbo' ? 'Dynamic BBO Peg Chasing' : 'Smart Chase SL Chasing'}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          Attempt {activeChase.current_attempt || 1}/{activeChase.max_attempts ? activeChase.max_attempts : '∞'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-black/60 p-2 rounded-lg border border-white/5 font-mono">
                        <div className="text-left">
                          <span className="text-gray-400 block text-[9px] uppercase">SL Trigger</span>
                          <span className="text-white font-bold">
                            {activeChase.trigger_price || '—'}
                            {activeChase.trigger_source && (
                              <span className="text-[8.5px] text-cyan-300 font-normal ml-1">
                                ({activeChase.trigger_source === 'bid_ask' ? '⚡ Bid/Ask' : '📊 Last'})
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-gray-400 block text-[9px] uppercase">Maker Price</span>
                          <span className="text-amber-300 font-bold">{activeChase.current_maker_price || 'Active'}</span>
                        </div>
                        <div className="text-left col-span-2 pt-1 border-t border-white/5 flex justify-between text-[9px]">
                          <span className="text-gray-400">Position Remaining:</span>
                          <span className="text-gray-200 font-semibold">{activeChase.amount} ({activeChase.side?.toUpperCase()})</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isStoppingChase}
                        onClick={() => handleStopSmartChase(activeChase)}
                        className="w-full py-2 px-3 rounded-lg bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-xs uppercase tracking-wider shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        <Square className="w-3.5 h-3.5 fill-white" />
                        {isStoppingChase ? 'Stopping Chase...' : 'Stop Smart Chase SL'}
                      </button>
                    </div>
                  );
                }

                if (activeSoftwareSls.length > 0) {
                  return (
                    <div className="flex flex-col gap-1.5 animate-fadeIn">
                      {activeSoftwareSls.map((activeSoftwareSl, idx) => {
                        const isChase = activeSoftwareSl.type === 'smart_chase';
                        const isTrailChase = activeSoftwareSl.type === 'trailing_chase';
                        const baseLabel = isTrailChase 
                          ? '⚡ Trailing Chase Armed' 
                          : (isChase ? '⚡ Smart Chase Armed' : (activeSoftwareSl.type === 'trailing' ? '⚡ Trailing SL Armed' : '🛡️ Stop-Loss Armed'));
                        const titleLabel = activeSoftwareSls.length > 1 ? `${baseLabel} #${idx + 1}` : baseLabel;

                        return (
                          <div key={activeSoftwareSl.id || idx} className="p-2.5 rounded-xl bg-blue-950/60 border border-blue-500/40 shadow-sm flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
                              <div className="flex flex-col text-left">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[11px] font-bold text-cyan-300 uppercase leading-tight">{titleLabel}</span>
                                  {activeSoftwareSl.peg_strategy === 'wall_aware' && (
                                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                                      🧱 Wall-Aware
                                    </span>
                                  )}
                                  {activeSoftwareSl.peg_strategy === 'inside_spread' && (
                                    <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                                      🎯 Inside-Spread
                                    </span>
                                  )}
                                  {activeSoftwareSl.auto_breakeven_enabled && (
                                    <span className={`text-[8px] font-mono px-1 py-0.2 rounded font-bold border ${activeSoftwareSl.breakeven_activated ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500/40' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'}`}>
                                      {activeSoftwareSl.breakeven_activated ? '🛡️ BE Active' : '🛡️ Auto-BE'}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-300 font-mono">
                                  SL @ {activeSoftwareSl.trigger_price || activeSoftwareSl.price} ({activeSoftwareSl.amount})
                                  {activeSoftwareSl.trigger_source === 'bid_ask' ? ' • ⚡ Bid/Ask' : ' • 📊 Last'}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isStoppingChase}
                              onClick={() => handleStopSmartChase(activeSoftwareSl)}
                              className="py-1 px-2.5 rounded-md bg-white/5 hover:bg-red-950/80 hover:text-red-300 hover:border-red-500/50 border border-white/10 text-gray-300 text-[10px] font-bold tracking-wider transition-all cursor-pointer disabled:opacity-50"
                            >
                              {isStoppingChase ? 'Cancelling...' : 'Cancel SL'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return null;
              })()}

              {/* ACTIVE POSITION LIVE STATUS & QUICK MARKET CLOSE */}
              {isFutures && positionData && positionData.amount > 0 && positionData.side !== 'none' && (
                <div className="p-2.5 rounded-xl bg-gradient-to-r from-[#170a14] via-[#0e101d] to-[#0a1518] border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)] flex items-center justify-between gap-2 animate-fadeIn mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${positionData.side.toLowerCase() === 'long' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'} animate-pulse`} />
                    <div className="flex flex-col text-left min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-extrabold text-white uppercase tracking-tight">Active Position:</span>
                        <span className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded border ${positionData.side.toLowerCase() === 'long' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40'}`}>
                          {positionData.side.toUpperCase()}
                        </span>
                        <span className="text-[10px] font-mono font-bold text-gray-200">
                          {isInverseFutures && positionData.contracts ? `${positionData.contracts} Cont (~${positionData.amount.toFixed(2)} ${baseCurrency})` : `${positionData.amount} ${baseCurrency}`}
                        </span>
                      </div>
                      <span className="text-[8.5px] text-gray-400 font-mono">
                        Instant Market Exit / Flatten
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isClosingPosition}
                    onClick={handleClosePosition}
                    className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-mono text-[10px] font-black uppercase tracking-wider shadow-[0_0_12px_rgba(244,63,94,0.35)] transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 active:scale-95 shrink-0"
                    title="Close active position immediately at Market price"
                  >
                    {isClosingPosition ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3 fill-current" />
                    )}
                    <span>{isClosingPosition ? 'Closing...' : 'Close Pos'}</span>
                  </button>
                </div>
              )}

              {/* OPEN LIMIT ORDERS LIST & CANCEL ACTIONS */}
              {openLimitOrders && openLimitOrders.length > 0 && (
                <div className="p-2.5 rounded-xl bg-[#070b14]/90 border border-white/10 shadow-sm flex flex-col gap-2 animate-fadeIn mb-2">
                  <div className="flex items-center justify-between pb-1 border-b border-white/5">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-[11px] font-bold text-gray-200 uppercase tracking-wide">
                        Open Orders ({openLimitOrders.length})
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isCancellingAll}
                      onClick={handleCancelAllOrders}
                      className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[9.5px] font-mono font-bold tracking-wider transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Cancel all open orders on this symbol"
                    >
                      {isCancellingAll ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                      <span>{isCancellingAll ? 'Cancelling...' : 'Cancel All'}</span>
                    </button>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10">
                    {openLimitOrders.map((ord: any) => {
                      const isBuy = String(ord.side).toLowerCase() === 'buy';
                      const mode = ord.mode || 'LIMIT';
                      const isCancelling = cancellingOrderId === String(ord.id);
                      return (
                        <div
                          key={ord.id}
                          className="p-1.5 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between text-[10px] font-mono"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`px-1 py-0.2 rounded text-[8px] font-bold uppercase ${
                                isBuy
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {isBuy ? 'BUY' : 'SELL'}
                            </span>
                            <span className="text-[8px] text-gray-400 uppercase font-bold">[{mode}]</span>
                            <span className="text-gray-200 truncate">
                              {Number(ord.amount || ord.remaining || 0).toFixed(2)} @{' '}
                              <strong className="text-white">${formatDisplayPrice(ord.price)}</strong>
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={isCancelling}
                            onClick={() => handleCancelOrder(String(ord.id))}
                            className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 border border-transparent hover:border-rose-500/30 transition-all cursor-pointer disabled:opacity-50 shrink-0 ml-1"
                            title={`Cancel Order #${ord.id}`}
                          >
                            {isCancelling ? (
                              <RefreshCw className="w-3 h-3 animate-spin text-rose-400" />
                            ) : (
                              <X className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Buy / Sell Tabs */}
              <div className="flex p-1 rounded-lg bg-black/40 border border-white/5 mb-2">
                <button
                  onClick={() => setTradeSide('Buy')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all uppercase tracking-wider ${
                    tradeSide === 'Buy' 
                      ? 'bg-green-500/20 text-green-400 border border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.15)]' 
                      : 'text-gray-500 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {isFutures ? 'Long' : 'Buy'}
                </button>
                <button
                  onClick={() => setTradeSide('Sell')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all uppercase tracking-wider ${
                    tradeSide === 'Sell' 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.15)]' 
                      : 'text-gray-500 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {isFutures ? 'Short' : 'Sell'}
                </button>
              </div>

              {/* API Account Selector */}
              <div className="space-y-1">
                <div className="flex justify-between items-end">
                    <label className="text-xs text-gray-400 font-medium">Execute With</label>
                </div>
                <div className="relative">
                  <select 
                    value={selectedApi}
                    onChange={(e) => { setSelectedApi(e.target.value); onApiKeyChange?.(e.target.value); }}
                    className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:border-brand-primary/50 transition-colors appearance-none cursor-pointer hover:bg-black/60"
                  >
                    {apiKeys.map(k => (
                       <option key={k.id} value={k.id} className="bg-[#000000]">
                       {/* BUG-08 fix: Robust label fallback with exchange uppercase */}
                       {k.name || k.label || k.key_name || `${k.exchange?.toUpperCase()} — Key #${k.id}`}
                       </option>
                    ))}
                    {apiKeys.length === 0 && <option value="" disabled>No API Keys found</option>}
                  </select>
                  <ChevronDown className="absolute right-3 top-[10px] w-4 h-4 text-gray-500 pointer-events-none" />
                </div>
              </div>

              {/* Order Type Toggle: Market | Limit | ⚡ Smart Peg */}
              <div className="flex p-1 rounded-lg bg-black/40 border border-white/5 gap-1">
                {(['Market', 'Limit', 'SmartPeg'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setOrderType(type)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1 ${
                      orderType === type 
                        ? type === 'SmartPeg'
                          ? 'bg-gradient-to-r from-amber-500 to-red-500 text-white shadow-md'
                          : 'bg-brand-primary text-white shadow-sm' 
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {type === 'SmartPeg' ? (
                      <>
                        <Zap className="w-3 h-3 text-amber-300 fill-amber-300" />
                        <span>Smart Peg</span>
                      </>
                    ) : (
                      <span className="uppercase tracking-wider">{type}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Smart Peg Entry Explanatory & Settings Panel */}
              <AnimatePresence>
                {orderType === 'SmartPeg' && (
                  <MotionDiv
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="p-2.5 rounded-xl bg-gradient-to-r from-amber-950/40 via-red-950/20 to-black border border-amber-500/30 text-[10px] space-y-2 overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        <span>⚡ Dynamic Maker Peg Entry Active</span>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                        Post-Only Maker
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-400 leading-relaxed">
                      Automatically shadows the top of the orderbook (Best Bid for Buy, Best Ask for Sell) at #1 Queue Priority until 100% filled.
                    </p>
                    <div className="space-y-1 pt-1 border-t border-white/5">
                      <div className="flex justify-between items-center text-[9px] text-gray-400">
                        <span>Max Chase Drift Guard</span>
                        <span className="text-amber-400 font-bold font-mono">
                          {smartPegMaxDev === 0 ? 'Unlimited (∞)' : `${smartPegMaxDev}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="5.0"
                        step="0.1"
                        value={smartPegMaxDev}
                        onChange={(e) => setSmartPegMaxDev(parseFloat(e.target.value))}
                        className="w-full accent-amber-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                      />
                      <p className="text-[8px] text-gray-500">
                        {smartPegMaxDev === 0 ? 'Chases continuously until filled.' : 'Stops chasing if price drifts too far away from initial entry.'}
                      </p>
                    </div>
                  </MotionDiv>
                )}
              </AnimatePresence>

              {/* Price (if limit) */}
              <AnimatePresence>
                {orderType === 'Limit' && (
                  <MotionDiv 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-3 overflow-hidden"
                  >
                    {/* Switch: Auto Best Limit */}
                    <div className="flex items-center justify-between bg-black/20 p-2 rounded-lg border border-brand-primary/20 cursor-pointer" onClick={() => setIsAutoLimit(!isAutoLimit)}>
                       <div className="flex flex-col">
                          <span className="text-xs font-bold text-brand-primary">Auto Best Limit (Post-Only)</span>
                          <span className="text-[10px] text-gray-500">Snipes entry at Best Bid/Ask without Taker Fees</span>
                       </div>
                       <div className={`relative w-8 h-4 rounded-full transition-colors ${isAutoLimit ? 'bg-brand-primary' : 'bg-gray-600'}`}>
                          <MotionDiv 
                             className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                             animate={{ x: isAutoLimit ? 16 : 0 }}
                             transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                       </div>
                    </div>

                    {!isAutoLimit && (
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400 font-medium">Limit Price</label>
                          <div className="relative">
                            <input 
                              type="number"
                              value={limitPrice}
                              disabled={isAutoLimit}
                              onChange={(e) => setLimitPrice(e.target.value)}
                              className="w-full bg-black/30 border border-white/10 rounded-lg py-2 px-3 pl-8 text-white text-sm focus:outline-none focus:border-brand-primary/50 transition-colors disabled:opacity-50"
                            />
                            <span className="absolute left-3 top-2 text-gray-500 text-sm">$</span>
                          </div>
                        </div>
                    )}
                  </MotionDiv>
                )}
              </AnimatePresence>

              {/* Size */}
              <div className="space-y-1">
                {/* Label row: currency name + toggle switch + balance */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 font-medium">
                      Order Size
                    </label>
                    {/* Base / Quote toggle */}
                    <div className="flex items-center gap-1 bg-black/40 rounded-full p-0.5 border border-white/10">
                      <button
                        onClick={() => {
                          setSizeMode('base');
                          if (!selectedPercent) setSize('');
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                          sizeMode === 'base'
                            ? 'bg-brand-primary text-white shadow'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {baseCurrency}
                      </button>
                      <button
                        onClick={() => {
                          setSizeMode('quote');
                          if (!selectedPercent) setSize('');
                        }}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all ${
                          sizeMode === 'quote'
                            ? 'bg-yellow-500 text-black shadow'
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {quoteCurrency}
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 text-right flex flex-col items-end">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title={`Live Auto-Sync Active (${(timings.balancePollMs / 1000).toFixed(1)}s)`} />
                      <span>Balance:</span>
                      <span className="text-gray-200 font-semibold font-mono">
                        {isLoadingBalance ? "..." : balanceData ? (
                          isInverseFutures
                            ? sizeMode === 'quote'
                              ? `${(balanceData.base_free || 0).toFixed(2)} ${baseCurrency} (~$${(((balanceData.base_free || 0) * (effectiveOrderPrice || effectiveCurrentPrice || 0))).toFixed(2)})`
                              : `${(balanceData.base_free || 0).toFixed(2)} ${baseCurrency}`
                            : sizeMode === 'quote'
                              ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                              : isFutures
                                ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                                : tradeSide === 'Buy'
                                  ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                                  : `${(balanceData.base_free || 0).toFixed(4)} ${baseCurrency}`
                        ) : "N/A"}
                      </span>
                    </div>

                    {/* Show helpful diagnostic badge if funds are located in USDⓈ-M or Spot wallet instead of COIN-M */}
                    {isInverseFutures && (balanceData?.base_free || 0) === 0 && Boolean(balanceData?.usds_futures_free && balanceData.usds_futures_free > 0) && (
                      <div className="text-[9px] text-amber-300 font-mono flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 mt-0.5" title="Funds are in USDⓈ-M Futures wallet instead of COIN-M Futures">
                        <span>⚠️ {balanceData?.usds_futures_free?.toFixed(2)} in USDⓈ-M! Transfer to COIN-M</span>
                      </div>
                    )}
                    {isInverseFutures && (balanceData?.base_free || 0) === 0 && Boolean(balanceData?.spot_free && balanceData.spot_free > 0) && (
                      <div className="text-[9px] text-amber-300 font-mono flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 mt-0.5" title="Funds are in Spot wallet instead of COIN-M Futures">
                        <span>⚠️ {balanceData?.spot_free?.toFixed(2)} in Spot! Transfer to COIN-M</span>
                      </div>
                    )}

                    {/* Show Locked / In-Orders Balance if any */}
                    {balanceData && (
                      (() => {
                        const isQuoteTarget = !isInverseFutures && (sizeMode === 'quote' || (isFutures ? true : tradeSide === 'Buy'));
                        const lockedAmount = isQuoteTarget ? (balanceData.quote_used || 0) : (balanceData.base_used || 0);
                        const curr = isQuoteTarget ? quoteCurrency : baseCurrency;
                        if (lockedAmount > 0) {
                          return (
                            <div className="text-[9px] text-amber-400 font-mono flex items-center gap-1">
                              <span>Locked:</span>
                              <span>{isQuoteTarget ? lockedAmount.toFixed(2) : lockedAmount.toFixed(4)} {curr}</span>
                            </div>
                          );
                        }
                        return null;
                      })()
                    )}

                    {isFutures && reduceOnly && (
                      <div className="text-[10px] text-brand-primary font-mono">
                        Pos: {isLoadingPosition ? "..." : (positionData && positionData.amount > 0 ? (
                          isInverseFutures && positionData.contracts
                            ? `${positionData.contracts} Cont (~${positionData.amount.toFixed(1)} ${baseCurrency})`
                            : `${positionData.amount} (${positionData.side.toUpperCase()})`
                        ) : "0")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Input field */}
                <div className="relative">
                  <input
                    type="number"
                    value={size}
                    onChange={(e) => {
                      setSize(e.target.value);
                      setSelectedPercent(null);
                    }}
                    placeholder={isInverseFutures ? `Min 1 Cont ($${contractSize})` : "0.00"}
                    className="w-full bg-black/30 border border-white/10 rounded-lg py-2 px-3 pl-8 text-white text-sm focus:outline-none focus:border-brand-primary/50 transition-colors"
                  />
                  {/* Currency symbol badge */}
                  <span className="absolute left-2.5 top-2 text-[11px] font-bold text-gray-500">
                    {sizeMode === 'quote' ? '$' : baseCurrency.slice(0, 3)}
                  </span>
                </div>

                {/* Live conversion estimate */}
                {size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                  <div className="flex items-center gap-1.5 px-1 pt-0.5 flex-wrap">
                    <span className="text-[10px] text-gray-600">≈</span>
                    {sizeMode === 'quote' ? (
                      <span className="text-[10px] text-yellow-400 font-semibold">
                        {(Number(size) / effectiveOrderPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseCurrency}
                      </span>
                    ) : (
                      <span className="text-[10px] text-yellow-400 font-semibold">
                        ${(Number(size) * effectiveOrderPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} {quoteCurrency}
                      </span>
                    )}
                    {isInverseFutures && (
                      <span className="text-[10px] bg-brand-primary/20 text-brand-primary px-1.5 py-0.2 rounded font-mono font-semibold">
                        • {Math.max(1, Math.round(((sizeMode === 'quote' ? Number(size) : Number(size) * effectiveOrderPrice)) / contractSize))} Cont (${contractSize}/Cont)
                      </span>
                    )}
                  </div>
                )}

                {/* % quick-fill buttons */}
                <div className="flex justify-between mt-2 gap-2">
                  {['25%', '50%', '75%', '100%'].map(pct => {
                    const isSelected = selectedPercent === pct;
                    return (
                      <button
                        key={pct}
                        className={`flex-1 py-1 text-[10px] font-bold rounded border transition-colors ${
                          isSelected
                            ? 'bg-brand-primary text-white border-brand-primary shadow-[0_0_8px_rgba(59,130,246,0.4)]'
                            : 'border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                        onClick={() => {
                          setSelectedPercent(pct);
                          if (balanceData && effectiveOrderPrice > 0) {
                            const newSize = calculateSize(
                              pct,
                              balanceData,
                              effectiveOrderPrice,
                              sizeMode,
                              tradeSide,
                              isFutures,
                              leverage,
                              reduceOnly,
                              positionData
                            );
                            if (newSize) {
                              setSize(newSize);
                            }
                          }
                        }}
                      >
                        {pct}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Binance Native Iceberg Order Panel (Spot Limit Only) */}
              {orderType === 'Limit' && !isFutures && (
                <div className="space-y-2.5 bg-cyan-950/20 p-2.5 rounded-lg border border-cyan-500/20 transition-all">
                  <div 
                    className="flex justify-between items-center cursor-pointer select-none"
                    onClick={() => setIsIceberg(!isIceberg)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded bg-cyan-500/10 text-cyan-400">
                        <Layers className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex flex-col text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-cyan-300">Binance Native Iceberg</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold uppercase">Spot GTC</span>
                        </div>
                        <span className="text-[10px] text-gray-400">
                          Splits limit order into smaller visible book slices
                        </span>
                      </div>
                    </div>
                    <div className={`relative w-8 h-4 rounded-full transition-colors ${isIceberg ? 'bg-cyan-500' : 'bg-gray-600'}`}>
                      <MotionDiv 
                        className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                        animate={{ x: isIceberg ? 16 : 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    </div>
                  </div>

                  <AnimatePresence>
                    {isIceberg && (
                      <MotionDiv
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="space-y-2.5 overflow-hidden pt-2 border-t border-cyan-500/20"
                      >
                        {/* Slice Mode Selector */}
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-[10px] text-gray-400 font-medium">Visible Slice Size</label>
                          <div className="flex bg-black/40 rounded border border-white/10 p-0.5">
                            <button
                              type="button"
                              onClick={() => setIcebergMode('percent')}
                              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                                icebergMode === 'percent' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              % of Total
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIcebergMode('qty');
                                if (!icebergCustomQty || icebergCustomQty === '0') {
                                  setIcebergCustomQty('250');
                                }
                              }}
                              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                                icebergMode === 'qty' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              {baseCurrency}
                            </button>
                          </div>
                        </div>

                        {/* Percent Quick Buttons */}
                        {icebergMode === 'percent' && (
                          <div className="grid grid-cols-4 gap-1.5">
                            {['10', '20', '25', '50'].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setIcebergPercent(pct)}
                                className={`py-1 text-[10px] font-mono rounded border transition-all ${
                                  icebergPercent === pct
                                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                    : 'bg-black/30 border-white/5 text-gray-400 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Base Coin Qty Quick Buttons */}
                        {icebergMode === 'qty' && (
                          <div className="grid grid-cols-4 gap-1.5">
                            {['100', '250', '500', '1000'].map((q) => (
                              <button
                                key={q}
                                type="button"
                                onClick={() => setIcebergCustomQty(q)}
                                className={`py-1 text-[10px] font-mono rounded border transition-all ${
                                  icebergCustomQty === q
                                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                    : 'bg-black/30 border-white/5 text-gray-400 hover:text-white hover:bg-white/5'
                                }`}
                              >
                                {q} {baseCurrency}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Input Field */}
                        <div className="relative">
                          <input 
                            type="number"
                            step="any"
                            value={icebergMode === 'percent' ? icebergPercent : icebergCustomQty}
                            onChange={(e) => {
                              if (icebergMode === 'percent') {
                                setIcebergPercent(e.target.value);
                              } else {
                                setIcebergCustomQty(e.target.value);
                              }
                            }}
                            placeholder={icebergMode === 'percent' ? 'e.g. 20' : '250'}
                            className="w-full bg-black/40 border border-cyan-500/30 rounded py-1.5 px-3 pr-14 text-white text-xs font-mono focus:outline-none focus:border-cyan-400 transition-colors"
                          />
                          <span className="absolute right-3 top-1.5 text-[10px] text-cyan-400 font-bold font-mono">
                            {icebergMode === 'percent' ? '% SLICE' : baseCurrency}
                          </span>
                        </div>

                        {/* Live Slice Calculation & Warning Pill */}
                        {(() => {
                          if (effectiveIcebergQty <= 0 || currentBaseAmount <= 0) return null;
                          const refPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
                          const sliceNotional = effectiveIcebergQty * refPrice;
                          const minRequiredSlice = refPrice > 0 ? Math.ceil(5.05 / refPrice) : 65;

                          if (effectiveIcebergQty >= currentBaseAmount) {
                            return (
                              <div className="p-2 rounded bg-amber-950/40 border border-amber-500/40 text-[10px] text-amber-300 flex items-center gap-1.5 font-mono">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>Slice ({effectiveIcebergQty.toFixed(2)}) must be smaller than total order ({currentBaseAmount.toFixed(2)} {baseCurrency}).</span>
                              </div>
                            );
                          }

                          if (sliceNotional < 5.0) {
                            return (
                              <div className="p-2 rounded bg-red-950/50 border border-red-500/50 flex flex-col gap-1.5 text-[10px] animate-fadeIn">
                                <div className="flex items-center justify-between text-red-300 font-bold">
                                  <span className="flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                    Slice value (${sliceNotional.toFixed(2)}) is below Binance $5.00 Min Notional!
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-gray-300">
                                  <span className="text-[9px]">Binance requires each slice ≥ $5.00 (~{minRequiredSlice} {baseCurrency})</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIcebergMode('qty');
                                      setIcebergCustomQty(minRequiredSlice.toString());
                                    }}
                                    className="px-2 py-0.5 rounded bg-red-600/30 hover:bg-red-600/60 text-red-200 border border-red-500/50 font-bold uppercase tracking-wider text-[9px] transition-colors cursor-pointer"
                                  >
                                    Auto-Set Min ({minRequiredSlice} {baseCurrency})
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-between text-[10px] font-mono">
                              <span className="text-gray-300">
                                Order Book Shows: <strong className="text-cyan-300">{effectiveIcebergQty.toFixed(4)} {baseCurrency}</strong> (~${sliceNotional.toFixed(2)})
                              </span>
                              <span className="text-cyan-400 font-bold">
                                ≈ {Math.max(1, Math.ceil(currentBaseAmount / effectiveIcebergQty))} Slices Total ✓
                              </span>
                            </div>
                          );
                        })()}
                      </MotionDiv>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* L2 / Training Studio Machine Learning Filter Panel (Prominent Top Placement) */}
              <div className={`space-y-2.5 p-3 rounded-lg border transition-all ${mlFilterConfig.enabled ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.12)]' : 'bg-black/30 border-blue-500/20'}`}>
                <div
                  className="flex justify-between items-center cursor-pointer group"
                  onClick={() => {
                    hasManualMlOverrideRef.current = true;
                    setMlFilterConfig(prev => ({
                      ...prev,
                      enabled: !prev.enabled,
                      modelId: !prev.enabled && !prev.modelId && mlModels.length > 0 ? mlModels[0].id : prev.modelId
                    }));
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${mlFilterConfig.enabled ? 'bg-blue-500/25 text-blue-300 border border-blue-400/50' : 'bg-white/5 text-blue-400/70'}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                      </svg>
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-gray-200 group-hover:text-white transition-colors">
                          L2 Machine Learning Filter
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold uppercase ${mlFilterConfig.enabled ? 'bg-blue-500/30 text-blue-200 border border-blue-400/40' : 'bg-white/5 text-gray-400'}`}>
                          {mlFilterConfig.enabled ? 'ACTIVE' : 'OFF'}
                        </span>
                        {pinnedModelId && mlFilterConfig.modelId === pinnedModelId && (
                          <span className="text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/35">
                            PINNED
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400">
                        🤖 Filter {tradeSide.toUpperCase()} entry using Training Studio / ML Registry model
                      </span>
                    </div>
                  </div>
                  <div className={`relative w-8 h-4 rounded-full transition-colors ${mlFilterConfig.enabled ? 'bg-blue-500' : 'bg-gray-600'}`}>
                    <MotionDiv
                      className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                      animate={{ x: mlFilterConfig.enabled ? 16 : 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  </div>
                </div>

                {/* Always-Visible ML Registry Model Selector Dropdown */}
                <div className="bg-black/45 p-2 rounded-lg border border-blue-500/25 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                      Select Trained Model (ML Registry)
                    </label>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchMlModels();
                      }}
                      className="p-1 rounded bg-white/5 hover:bg-blue-500/20 text-gray-400 hover:text-blue-300 transition-colors cursor-pointer flex items-center gap-1 text-[9px]"
                      title="Refresh Models from ML Registry"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingMlModels ? 'animate-spin text-blue-400' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {mlModels.length === 0 ? (
                    <p className="text-[10px] text-amber-400/90 italic py-1">
                      No models found in ML Registry. Train & save a model in Training Studio first.
                    </p>
                  ) : (
                    <select
                      className="w-full bg-black border border-blue-500/30 rounded-lg py-1.5 px-2.5 text-white outline-none focus:border-blue-400 text-xs font-bold cursor-pointer"
                      value={mlFilterConfig.modelId}
                      onChange={(e) => {
                        hasManualMlOverrideRef.current = true;
                        const val = e.target.value;
                        const opt = getModelOptimalThresholds(val);
                        setMlFilterConfig(prev => ({
                          ...prev,
                          modelId: val,
                          enabled: Boolean(val) ? true : prev.enabled,
                          bullishThreshold: prev.autoThreshold ? opt.bullish : prev.bullishThreshold,
                          bearishThreshold: prev.autoThreshold ? opt.bearish : prev.bearishThreshold
                        }));
                      }}
                    >
                      <option value="">-- Select a Model from ML Registry --</option>
                      {mlModels.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.modelType}) - v{m.versions?.find(v => v.id === m.activeVersionId)?.version || '1.0'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <AnimatePresence>
                  {mlFilterConfig.enabled && (
                    <MotionDiv
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="space-y-2.5 overflow-hidden pt-1 border-t border-white/5"
                    >
                      {/* Execution Mode Selector (Signal Only vs Dynamic Setup, matching WallHunterModal) */}
                      <div className="bg-black/40 p-2 rounded-lg border border-white/5 space-y-1.5">
                        <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">
                          Execution Mode
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setMlFilterConfig(prev => ({ ...prev, executionMode: 'basic' }))}
                            className={`py-1.5 px-2 rounded-lg font-bold text-[10px] transition-all border cursor-pointer ${
                              mlFilterConfig.executionMode === 'basic'
                                ? 'bg-blue-600/25 border-blue-500 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                                : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5'
                            }`}
                          >
                            Signal Only (Filter Entry)
                          </button>
                          <button
                            type="button"
                            onClick={() => setMlFilterConfig(prev => ({ ...prev, executionMode: 'advanced' }))}
                            className={`py-1.5 px-2 rounded-lg font-bold text-[10px] transition-all border cursor-pointer ${
                              mlFilterConfig.executionMode === 'advanced'
                                ? 'bg-purple-600/25 border-purple-500 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                                : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5'
                            }`}
                          >
                            Dynamic Setup (AI TP/SL)
                          </button>
                        </div>
                      </div>

                      {/* Smart Auto-Align to Model Toggle */}
                      {(() => {
                        const opt = getModelOptimalThresholds(mlFilterConfig.modelId);
                        return (
                          <div className="flex items-center justify-between p-2 rounded-lg bg-black/45 border border-blue-500/25">
                            <div className="flex items-center gap-2 min-w-0">
                              <Zap className={`w-3.5 h-3.5 shrink-0 ${mlFilterConfig.autoThreshold ? 'text-amber-400 fill-amber-400' : 'text-gray-500'}`} />
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-gray-200">
                                    Smart Auto-Align to Model
                                  </span>
                                  <span className={`text-[8.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase border ${mlFilterConfig.autoThreshold ? 'bg-amber-500/20 text-amber-300 border-amber-500/35 shadow-[0_0_8px_rgba(245,158,11,0.2)]' : 'bg-white/5 text-gray-400 border-white/5'}`}>
                                    {mlFilterConfig.autoThreshold ? 'AUTO ON' : 'MANUAL'}
                                  </span>
                                </div>
                                <span className="text-[9px] text-gray-400 font-mono truncate">
                                  {opt.note}
                                </span>
                              </div>
                            </div>
                            <div
                              className={`relative w-7 h-3.5 rounded-full transition-colors cursor-pointer shrink-0 ${mlFilterConfig.autoThreshold ? 'bg-amber-500' : 'bg-gray-700'}`}
                              onClick={() => {
                                const newAuto = !mlFilterConfig.autoThreshold;
                                setMlFilterConfig(prev => ({
                                  ...prev,
                                  autoThreshold: newAuto,
                                  bullishThreshold: newAuto ? opt.bullish : prev.bullishThreshold,
                                  bearishThreshold: newAuto ? opt.bearish : prev.bearishThreshold
                                }));
                              }}
                              title={mlFilterConfig.autoThreshold ? "Click to set custom manual thresholds" : "Click to auto-tune thresholds to model"}
                            >
                              <MotionDiv
                                className="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full"
                                animate={{ x: mlFilterConfig.autoThreshold ? 14 : 0 }}
                                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Bullish Threshold (Active for BUY orders) */}
                      <div className={`p-2.5 rounded-lg border transition-colors ${tradeSide === 'Buy' ? 'bg-emerald-950/25 border-emerald-500/35' : 'bg-black/30 border-white/5 opacity-85'}`}>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] font-bold text-gray-300 uppercase flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${tradeSide === 'Buy' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}></span>
                            <span>BUY Filter: Bullish Threshold</span>
                          </label>
                          <span className="text-xs font-mono font-bold text-emerald-400">
                            {(mlFilterConfig.bullishThreshold * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="0.9"
                          step="0.01"
                          value={mlFilterConfig.bullishThreshold}
                          onChange={(e) => setMlFilterConfig(prev => ({ ...prev, autoThreshold: false, bullishThreshold: parseFloat(e.target.value) }))}
                          className="w-full accent-emerald-500 h-1.5 bg-black/50 rounded-lg cursor-pointer"
                        />
                        <p className="text-[9px] text-gray-400 mt-1 leading-tight">
                          For <span className="text-emerald-400 font-semibold">BUY</span> orders: AI must predict ≥{(mlFilterConfig.bullishThreshold * 100).toFixed(0)}% Bullish probability to permit entry, otherwise it denies the trade.
                        </p>
                      </div>

                      {/* Bearish Threshold (Active for SELL orders — Spot Hold Currency Sell High & Futures Short) */}
                      <div className={`p-2.5 rounded-lg border transition-colors ${tradeSide === 'Sell' ? 'bg-rose-950/25 border-rose-500/35' : 'bg-black/30 border-white/5 opacity-85'}`}>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] font-bold text-gray-300 uppercase flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${tradeSide === 'Sell' ? 'bg-rose-400 animate-pulse' : 'bg-gray-500'}`}></span>
                            <span>SELL Filter: Bearish Threshold</span>
                          </label>
                          <span className="text-xs font-mono font-bold text-rose-400">
                            {(mlFilterConfig.bearishThreshold * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="0.9"
                          step="0.01"
                          value={mlFilterConfig.bearishThreshold}
                          onChange={(e) => setMlFilterConfig(prev => ({ ...prev, autoThreshold: false, bearishThreshold: parseFloat(e.target.value) }))}
                          className="w-full accent-rose-500 h-1.5 bg-black/50 rounded-lg cursor-pointer"
                        />
                        <p className="text-[9px] text-gray-400 mt-1 leading-tight">
                          For <span className="text-rose-400 font-semibold">SELL</span> orders (Spot Hold Sell High → Low TP Buy Back, or Short): AI must predict ≥{(mlFilterConfig.bearishThreshold * 100).toFixed(0)}% Bearish probability to permit selling.
                        </p>
                      </div>
                    </MotionDiv>
                  )}
                </AnimatePresence>
              </div>

              {/* Native Binance TP/SL Toggle */}
              {(tpConfig.enabled || slConfig.enabled) && !isFutures && (
                <div className={`flex justify-between items-center bg-brand-primary/10 p-2 rounded border border-brand-primary/30 transition-opacity ${!isNativeTpSlSupported ? 'opacity-40 pointer-events-none' : ''}`}>
                  <div className="flex flex-col">
                      <span className="text-xs font-bold text-brand-primary">Use Native Binance OTO/OTOCO</span>
                      <span className="text-[9px] text-brand-primary/80">
                        {orderType === 'SmartPeg'
                          ? '⚡ Dynamic Peg Mode: Entry is dynamic maker; Native OCO auto-spawns upon fill'
                          : orderType === 'Market'
                            ? '⚡ Market Entry: Post-fill Native OCO/Bracket spawns automatically upon fill'
                            : (tpConfig.enabled && tpConfig.orderType === 'Market')
                              ? '⚠️ Auto-disabled: Market TP requires software bracket execution'
                              : !isNativeTpSlSupported
                                ? '⚠️ Auto-disabled: Trailing / Smart Chase / ATR / Auto-BE SL is active'
                                : 'Exchange atomic bracket (100% crash proof)'
                        }
                      </span>
                  </div>
                  <div className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${useNativeTpSl && isNativeTpSlSupported ? 'bg-brand-primary' : 'bg-gray-600'}`} onClick={() => {
                      if (isNativeTpSlSupported) {
                          setUseNativeTpSl(!useNativeTpSl);
                      }
                  }}>
                      <MotionDiv 
                          className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                          animate={{ x: (useNativeTpSl && isNativeTpSlSupported) ? 16 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                  </div>
                </div>
              )}

              {/* Bracket Order (Attached TP) Panel */}
              <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-brand-primary/10 transition-all">
                  <div className="flex justify-between items-center cursor-pointer" onClick={() => setTpConfig({...tpConfig, enabled: !tpConfig.enabled})}>
                      <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-300 group-hover:text-white transition-colors">Attached Take-Profit (Bracket)</span>
                          <span className="text-[10px] text-gray-500">Auto-trigger scalp exit once entry fills</span>
                      </div>
                      <div className={`relative w-8 h-4 rounded-full transition-colors ${tpConfig.enabled ? 'bg-brand-primary' : 'bg-gray-600'}`}>
                          <MotionDiv 
                             className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                             animate={{ x: tpConfig.enabled ? 16 : 0 }}
                             transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                      </div>
                  </div>
                  
                  <AnimatePresence>
                     {tpConfig.enabled && (
                        <MotionDiv
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="space-y-3 overflow-hidden pt-2 border-t border-white/5"
                        >
                            {/* Layout Grid */}
                            <div className="grid grid-cols-2 gap-2">
                                {/* TP Order Type */}
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">TP Order Type</label>
                                    <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                        {(['Limit', 'Market'] as const).map(type => (
                                            <button
                                                key={type}
                                                onClick={() => setTpConfig({...tpConfig, orderType: type})}
                                                className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.orderType === type ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Gap Mode */}
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">Mode</label>
                                    <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                        <button
                                            onClick={() => setTpConfig({
                                                ...tpConfig,
                                                mode: 'percentage',
                                                value: tpConfig.mode === 'percentage' ? tpConfig.value : getSmartGapValue('percentage', true)
                                            })}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.mode === 'percentage' ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            %
                                        </button>
                                        <button
                                            onClick={() => setTpConfig({
                                                ...tpConfig,
                                                mode: 'price',
                                                value: tpConfig.mode === 'price' ? tpConfig.value : getSmartGapValue('price', true)
                                            })}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.mode === 'price' ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            $
                                        </button>
                                        <button
                                            onClick={() => setTpConfig({
                                                ...tpConfig,
                                                mode: 'absolute',
                                                value: tpConfig.mode === 'absolute' ? tpConfig.value : getSmartGapValue('absolute', true)
                                            })}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.mode === 'absolute' ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            🎯
                                        </button>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Target Gap & Timeout */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">{tpConfig.mode === 'absolute' ? 'Exact Price' : 'Target Gap'}</label>
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={tpConfig.value}
                                            onChange={(e) => setTpConfig({...tpConfig, value: e.target.value})}
                                            placeholder={tpConfig.mode === 'absolute' ? (tradeSide === 'Buy' ? "e.g. 1.050" : "e.g. 0.950") : (tpConfig.mode === 'percentage' ? "e.g. 1.5" : "e.g. 0.005")}
                                            className="w-full bg-black/30 border border-white/10 rounded py-1 px-2 pr-6 text-white text-xs focus:outline-none focus:border-brand-primary/50"
                                        />
                                        <span className="absolute right-2 top-1.5 text-[10px] text-brand-primary font-bold">{tpConfig.mode === 'percentage' ? '%' : (tpConfig.mode === 'absolute' ? '🎯' : '$')}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                                            <span>Monitor Limit</span>
                                            {tpConfig.timeoutMins === 0 && (
                                                <span className="text-[8px] text-emerald-400/90 font-medium">● Infinite</span>
                                            )}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setTpConfig({ ...tpConfig, timeoutMins: tpConfig.timeoutMins === 0 ? 60 : 0 })}
                                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-all flex items-center gap-1 border ${
                                                tpConfig.timeoutMins === 0
                                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30 shadow-sm'
                                                    : 'bg-white/5 text-gray-400 border-white/10 hover:text-white hover:bg-white/10'
                                            }`}
                                            title={tpConfig.timeoutMins === 0 ? "Infinite monitor active (watches until filled). Click to set minute limit." : "Click to disable timeout limit (Monitor Infinitely)"}
                                        >
                                            {tpConfig.timeoutMins === 0 ? (
                                                <>
                                                    <span className="text-xs font-bold leading-none">∞</span>
                                                    <span>No Limit</span>
                                                </>
                                            ) : (
                                                <span>Limit On</span>
                                            )}
                                        </button>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input 
                                            type="range"
                                            min="0" max="60" step="1"
                                            value={tpConfig.timeoutMins}
                                            onChange={(e) => setTpConfig({...tpConfig, timeoutMins: Number(e.target.value)})}
                                            className="w-full accent-brand-primary h-1 bg-black/50 rounded appearance-none cursor-pointer"
                                            title={tpConfig.timeoutMins === 0 ? "0 = Infinite (Monitors until filled)" : `${tpConfig.timeoutMins} minutes limit`}
                                        />
                                        <span 
                                            className={`text-[10px] font-mono min-w-[28px] text-right font-bold transition-colors ${
                                                tpConfig.timeoutMins === 0 ? 'text-emerald-400' : 'text-gray-300'
                                            }`}
                                            title={tpConfig.timeoutMins === 0 ? "0 = Infinite (Monitors until filled)" : `${tpConfig.timeoutMins} minutes limit`}
                                        >
                                            {tpConfig.timeoutMins === 0 ? '∞' : `${tpConfig.timeoutMins}m`}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </MotionDiv>
                     )}
                  </AnimatePresence>
              </div>

              {/* Attached Stop Loss (SL) Panel */}
              <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-red-500/10 transition-all">
                  <div className="flex justify-between items-center cursor-pointer group" onClick={() => setSlConfig({...slConfig, enabled: !slConfig.enabled})}>
                      <div className="flex flex-col">
                          <span className="text-xs font-bold text-gray-300 group-hover:text-white transition-colors">Attached Stop-Loss (SL)</span>
                          <span className="text-[10px] text-gray-400">{(slConfig.type === 'fixed' || slConfig.type === 'trailing') ? '🛡️ Binance Native Order (Visible on Exchange)' : '⚡ Bot Maker Loop (Zero Maker Fee)'}</span>
                      </div>
                      <div className={`relative w-8 h-4 rounded-full transition-colors ${slConfig.enabled ? 'bg-red-500' : 'bg-gray-600'}`}>
                          <MotionDiv 
                             className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                             animate={{ x: slConfig.enabled ? 16 : 0 }}
                             transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          />
                      </div>
                  </div>
                  
                  <AnimatePresence>
                     {slConfig.enabled && (
                        <MotionDiv
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="space-y-3 overflow-hidden pt-2 border-t border-white/5"
                        >
                            {/* Execution Engine Selector (Exchange Native vs Smart Chase Bot) */}
                            <div className="space-y-2 bg-black/30 p-2.5 rounded-lg border border-white/5">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] text-gray-300 font-semibold flex items-center gap-1">
                                        <span>SL Execution Engine</span>
                                    </label>
                                    <span className={`text-[8.5px] px-1.5 py-0.5 rounded font-mono font-bold ${
                                        (slConfig.type === 'fixed' || slConfig.type === 'trailing')
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    }`}>
                                        {(slConfig.type === 'fixed' || slConfig.type === 'trailing') ? '🛡️ Binance Native (Safe)' : '⚡ Bot Software Loop'}
                                    </span>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/50 rounded-lg border border-white/10">
                                    <button
                                        type="button"
                                        onClick={() => setSlConfig({
                                            ...slConfig,
                                            type: 'fixed',
                                            mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                                            value: slConfig.mode === 'atr' ? getSmartGapValue('percentage', false) : slConfig.value
                                        })}
                                        className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-md transition-all text-center ${
                                            (slConfig.type === 'fixed' || slConfig.type === 'trailing')
                                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold shadow-md shadow-emerald-950/40 ring-1 ring-emerald-400/30'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        <span className="text-[10.5px] font-bold flex items-center gap-1">
                                            <span>🛡️</span> Exchange Native
                                        </span>
                                        <span className="text-[7.5px] opacity-80 leading-tight mt-0.5">
                                            Real order on Binance • 24/7 Safe
                                        </span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setSlConfig({
                                            ...slConfig,
                                            type: 'smart_chase',
                                            mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                                            value: slConfig.mode === 'atr' ? getSmartGapValue('percentage', false) : slConfig.value
                                        })}
                                        className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-md transition-all text-center ${
                                            (slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase')
                                                ? 'bg-gradient-to-r from-red-500 to-amber-500 text-white font-bold shadow-md shadow-amber-950/40 ring-1 ring-amber-400/30'
                                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                        }`}
                                    >
                                        <span className="text-[10.5px] font-bold flex items-center gap-1">
                                            <span>⚡</span> Smart Chase
                                        </span>
                                        <span className="text-[7.5px] opacity-80 leading-tight mt-0.5">
                                            Bot Maker Loop • 0% Fee
                                        </span>
                                    </button>
                                </div>

                                {/* Dynamic Sub-Variant & Gap Mode */}
                                <div className="grid grid-cols-2 gap-2 pt-0.5">
                                    {/* Sub-variant based on selected target */}
                                    <div className="space-y-1">
                                        <label className="text-[9.5px] text-gray-400 font-medium">
                                            {(slConfig.type === 'fixed' || slConfig.type === 'trailing') ? 'Order Variant' : 'Chase Strategy'}
                                        </label>
                                        <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                            {(slConfig.type === 'fixed' || slConfig.type === 'trailing') ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSlConfig({ ...slConfig, type: 'fixed' })}
                                                        className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'fixed' ? 'bg-emerald-600 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                                    >
                                                        Fixed Stop
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSlConfig({ ...slConfig, type: 'trailing', mode: slConfig.mode === 'absolute' ? 'percentage' : slConfig.mode })}
                                                        className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'trailing' ? 'bg-emerald-600 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                                    >
                                                        Trailing
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSlConfig({ ...slConfig, type: 'smart_chase' })}
                                                        className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'smart_chase' ? 'bg-amber-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                                    >
                                                        BBO Chase
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSlConfig({ ...slConfig, type: 'trailing_chase' })}
                                                        className={`flex-1 text-[8px] py-1 rounded transition-colors ${slConfig.type === 'trailing_chase' ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                                    >
                                                        ⚡ Trail Chase
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Gap Mode */}
                                    <div className="space-y-1">
                                        <label className="text-[9.5px] text-gray-400 font-medium">Gap Unit</label>
                                        <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({
                                                    ...slConfig,
                                                    mode: 'percentage',
                                                    value: slConfig.mode === 'percentage' ? slConfig.value : getSmartGapValue('percentage', false)
                                                })}
                                                className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'percentage' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                %
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({
                                                    ...slConfig,
                                                    mode: 'price',
                                                    value: slConfig.mode === 'price' ? slConfig.value : getSmartGapValue('price', false)
                                                })}
                                                className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'price' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                $
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({
                                                    ...slConfig,
                                                    mode: 'absolute',
                                                    type: (slConfig.type === 'trailing' || slConfig.type === 'trailing_chase') ? 'fixed' : slConfig.type,
                                                    value: slConfig.mode === 'absolute' ? slConfig.value : getSmartGapValue('absolute', false)
                                                })}
                                                className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'absolute' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                🎯
                                            </button>
                                            {slConfig.type !== 'smart_chase' && slConfig.type !== 'trailing_chase' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setSlConfig({...slConfig, mode: 'atr', type: 'trailing'})}
                                                    className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'atr' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                                >
                                                    ATR
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Assurance Banner */}
                                {(slConfig.type === 'fixed' || slConfig.type === 'trailing') ? (
                                    <div className="text-[9px] text-emerald-300 font-mono flex items-center gap-1.5 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
                                        <span>🛡️</span>
                                        <span><strong>Binance Native Stop:</strong> অর্ডার সরাসরি Binance-এ বসবে এবং অ্যাপে দৃশ্যমান থাকবে।</span>
                                    </div>
                                ) : (
                                    <div className="text-[9px] text-amber-300 font-mono flex items-center gap-1.5 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
                                        <span>⚠️</span>
                                        <span><strong>Bot Software Loop:</strong> ব্যাকএন্ড মেমোরিতে ট্র্যাক হবে (Binance অর্ডারবুকে সরাসরি বসবে না)।</span>
                                    </div>
                                )}
                            </div>
                            
                            {/* Target Gap & Timeout */}
                            <div className="grid grid-cols-2 gap-2">
                                {slConfig.mode === 'atr' ? (
                                    <div className="grid grid-cols-3 gap-1">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-gray-400 font-medium">TF</label>
                                            <select 
                                                value={slConfig.atrTimeframe}
                                                onChange={(e) => setSlConfig({...slConfig, atrTimeframe: e.target.value})}
                                                className="w-full bg-black/30 border border-white/10 rounded py-1 px-1 text-white text-[10px] focus:outline-none"
                                            >
                                                <option value="1m">1m</option>
                                                <option value="5m">5m</option>
                                                <option value="15m">15m</option>
                                                <option value="1h">1h</option>
                                                <option value="4h">4h</option>
                                                <option value="1d">1d</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-gray-400 font-medium">Period</label>
                                            <input 
                                                type="number"
                                                value={slConfig.atrPeriod}
                                                onChange={(e) => setSlConfig({...slConfig, atrPeriod: Number(e.target.value)})}
                                                className="w-full bg-black/30 border border-white/10 rounded py-1 px-2 text-white text-[10px] focus:outline-none"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-gray-400 font-medium">Mult.</label>
                                            <input 
                                                type="number"
                                                step="0.1"
                                                value={slConfig.atrMultiplier}
                                                onChange={(e) => setSlConfig({...slConfig, atrMultiplier: Number(e.target.value)})}
                                                className="w-full bg-black/30 border border-white/10 rounded py-1 px-2 text-white text-[10px] focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-gray-400 font-medium">
                                            {slConfig.mode === 'absolute' ? 'Exact Price' : (slConfig.type === 'smart_chase' ? 'Chase Trigger Gap' : (slConfig.type === 'trailing_chase' ? 'Trailing Callback Gap' : (slConfig.type === 'trailing' ? 'Callback Rate/Distance' : 'Stop Gap')))}
                                        </label>
                                        <div className="relative">
                                            <input 
                                                type="number"
                                                value={slConfig.value}
                                                onChange={(e) => setSlConfig({...slConfig, value: e.target.value})}
                                                placeholder={slConfig.mode === 'absolute' ? (tradeSide === 'Buy' ? "e.g. 0.950" : "e.g. 1.050") : (slConfig.mode === 'percentage' ? "e.g. 1.0" : "e.g. 0.003")}
                                                className="w-full bg-black/30 border border-white/10 rounded py-1 px-2 pr-6 text-white text-xs focus:outline-none focus:border-red-500/50"
                                            />
                                            <span className="absolute right-2 top-1.5 text-[10px] text-red-500 font-bold">{slConfig.mode === 'percentage' ? '%' : (slConfig.mode === 'absolute' ? '🎯' : '$')}</span>
                                        </div>
                                    </div>
                                )}
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                                            <span>Monitor Limit</span>
                                            {slConfig.timeoutMins === 0 && (
                                                <span className="text-[8px] text-emerald-400/90 font-medium">● Infinite</span>
                                            )}
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => setSlConfig({ ...slConfig, timeoutMins: slConfig.timeoutMins === 0 ? 60 : 0 })}
                                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold transition-all flex items-center gap-1 border ${
                                                slConfig.timeoutMins === 0
                                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30 shadow-sm'
                                                    : 'bg-white/5 text-gray-400 border-white/10 hover:text-white hover:bg-white/10'
                                            }`}
                                            title={slConfig.timeoutMins === 0 ? "Infinite monitor active (watches until filled). Click to set minute limit." : "Click to disable timeout limit (Monitor Infinitely)"}
                                        >
                                            {slConfig.timeoutMins === 0 ? (
                                                <>
                                                    <span className="text-xs font-bold leading-none">∞</span>
                                                    <span>No Limit</span>
                                                </>
                                            ) : (
                                                <span>Limit On</span>
                                            )}
                                        </button>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <input 
                                            type="range"
                                            min="0" max="60" step="1"
                                            value={slConfig.timeoutMins}
                                            onChange={(e) => setSlConfig({...slConfig, timeoutMins: Number(e.target.value)})}
                                            className="w-full accent-red-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                                            title={slConfig.timeoutMins === 0 ? "0 = Infinite (Monitors until filled)" : `${slConfig.timeoutMins} minutes limit`}
                                        />
                                        <span 
                                            className={`text-[10px] font-mono min-w-[28px] text-right font-bold transition-colors ${
                                                slConfig.timeoutMins === 0 ? 'text-emerald-400' : 'text-gray-300'
                                            }`}
                                            title={slConfig.timeoutMins === 0 ? "0 = Infinite (Monitors until filled)" : `${slConfig.timeoutMins} minutes limit`}
                                        >
                                            {slConfig.timeoutMins === 0 ? '∞' : `${slConfig.timeoutMins}m`}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Smart Chase Detailed Controls (for Smart Chase & Trailing Chase) */}
                            {(slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase') && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 space-y-2 mt-1 animate-fadeIn">
                                    <div className="flex items-center justify-between text-[10px]">
                                        <span className="font-bold text-red-400 flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                            {slConfig.type === 'trailing_chase' ? 'Trailing Chase Engine (Maker Post-Only)' : 'Smart Chase Settings (Maker Post-Only)'}
                                        </span>
                                        <span className="text-[9px] text-amber-400 font-mono font-bold">Circuit: {slConfig.smartChaseDeviationPct}%</span>
                                    </div>

                                    {/* Pegging Strategy Selector: Standard BBO vs Inside-Spread vs Wall-Aware */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center text-[9px] text-gray-400">
                                            <span className="font-semibold text-gray-300">Pegging Strategy</span>
                                            <span className="text-[8.5px] font-mono text-amber-300 font-bold">
                                                {slConfig.smartChasePegStrategy === 'wall_aware' ? '🧱 Wall-Aware' : (slConfig.smartChasePegStrategy === 'inside_spread' ? '🎯 Inside-Spread' : '⚡ Top BBO')}
                                            </span>
                                        </div>
                                        <div className="flex bg-black/60 rounded p-0.5 border border-white/5 text-[9px] font-semibold">
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({ ...slConfig, smartChasePegStrategy: 'bbo' })}
                                                className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                    slConfig.smartChasePegStrategy === 'bbo'
                                                        ? 'bg-amber-600 text-white font-bold shadow-md'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                                title="Standard Top-of-Book BBO: Tracks Best Bid/Ask directly"
                                            >
                                                ⚡ Top BBO
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({ ...slConfig, smartChasePegStrategy: 'inside_spread' })}
                                                className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                    slConfig.smartChasePegStrategy === 'inside_spread'
                                                        ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold shadow-md'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                                title="Inside-Spread Pegging: Places 1 tick inside spread when spread > 1 tick. Ensures #1 queue priority maker fill without taker fees."
                                            >
                                                🎯 Inside-Spread
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({ ...slConfig, smartChasePegStrategy: 'wall_aware' })}
                                                className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                    slConfig.smartChasePegStrategy === 'wall_aware'
                                                        ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white font-bold shadow-md'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                                title="Liquidity-Wall Aware: Scans L2 depth, detects support/resistance walls, and front-runs 1 tick ahead."
                                            >
                                                🧱 Wall-Aware
                                            </button>
                                        </div>
                                        {slConfig.smartChasePegStrategy === 'wall_aware' && (
                                            <div className="p-2 rounded bg-amber-950/20 border border-amber-500/20 space-y-1">
                                                <div className="flex justify-between items-center text-[8.5px]">
                                                    <span className="text-gray-300">Wall Threshold Multiplier</span>
                                                    <span className="text-amber-400 font-mono font-bold">{slConfig.smartChaseWallMultiplier}x Depth</span>
                                                </div>
                                                <input 
                                                    type="range"
                                                    min="1.5" max="5.0" step="0.5"
                                                    value={slConfig.smartChaseWallMultiplier}
                                                    onChange={(e) => setSlConfig({ ...slConfig, smartChaseWallMultiplier: parseFloat(e.target.value) || 2.5 })}
                                                    className="w-full accent-amber-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                                                />
                                                <p className="text-[8px] text-gray-400 leading-tight">
                                                    Front-runs orderbook clusters with volume ≥ {slConfig.smartChaseWallMultiplier}x average depth.
                                                </p>
                                            </div>
                                        )}
                                        {slConfig.smartChasePegStrategy === 'inside_spread' && (
                                            <p className="text-[8px] text-cyan-400/90 leading-tight">
                                                💡 Jumps 1 tick inside the spread to capture top execution priority before takers match other makers.
                                            </p>
                                        )}
                                    </div>

                                    {/* Chase Trigger Basis Toggle: Last Market Price vs Bid / Ask Price */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center text-[9px] text-gray-400">
                                            <span className="font-semibold text-gray-300">Trigger Condition Basis</span>
                                            <span className="text-[8.5px] font-mono text-cyan-300 font-bold">
                                                {slConfig.smartChaseTriggerSource === 'bid_ask' ? '⚡ Bid / Ask (BBO)' : '📊 Last Market Price'}
                                            </span>
                                        </div>
                                        <div className="flex bg-black/60 rounded p-0.5 border border-white/5 text-[9px] font-semibold">
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({ ...slConfig, smartChaseTriggerSource: 'last' })}
                                                className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                    slConfig.smartChaseTriggerSource === 'last'
                                                        ? 'bg-blue-600 text-white font-bold shadow-md'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                                title="Last Traded Price: Standard market trigger. Immune to temporary spread widening or empty book spikes."
                                            >
                                                📊 Last Price
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSlConfig({ ...slConfig, smartChaseTriggerSource: 'bid_ask' })}
                                                className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                    slConfig.smartChaseTriggerSource === 'bid_ask'
                                                        ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold shadow-md'
                                                        : 'text-gray-400 hover:text-white'
                                                }`}
                                                title="Order Book Bid/Ask: Triggers instantly based on executable Top-of-Book (Bid for Long exit, Ask for Short exit). Eliminates lag on slow pairs."
                                            >
                                                ⚡ Bid / Ask
                                            </button>
                                        </div>
                                        <p className="text-[8px] text-gray-400 leading-tight">
                                            {slConfig.smartChaseTriggerSource === 'bid_ask'
                                                ? 'Triggers immediately when Top Bid (Long exit) or Ask (Short exit) reaches SL.'
                                                : 'Triggers when a matched trade on the exchange reaches or breaches SL.'}
                                        </p>
                                    </div>

                                    {/* Chase Mode Selector: Dynamic BBO Peg vs Interval Timer */}
                                    <div className="flex bg-black/60 rounded p-0.5 border border-white/5 text-[9px] font-semibold">
                                        <button
                                            type="button"
                                            onClick={() => setSlConfig({ ...slConfig, smartChaseMode: 'dynamic_bbo' })}
                                            className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                slConfig.smartChaseMode === 'dynamic_bbo'
                                                    ? 'bg-gradient-to-r from-amber-500 to-red-500 text-white font-bold shadow-md'
                                                    : 'text-gray-400 hover:text-white'
                                            }`}
                                            title="Real-time Order Book Shadowing: Automatically tracks Best Bid/Ask in real time without waiting"
                                        >
                                            <Zap className="w-2.5 h-2.5 text-amber-300 fill-amber-300" />
                                            ⚡ Dynamic BBO Peg
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSlConfig({ ...slConfig, smartChaseMode: 'interval' })}
                                            className={`flex-1 py-1 rounded transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                                slConfig.smartChaseMode === 'interval'
                                                    ? 'bg-gradient-to-r from-amber-500 to-red-500 text-white font-bold shadow-md'
                                                    : 'text-gray-400 hover:text-white'
                                            }`}
                                            title="Interval Timer: Waits for a fixed delay time before checking and retrying"
                                        >
                                            ⏱️ Interval Chase
                                        </button>
                                    </div>

                                    {slConfig.smartChaseMode === 'dynamic_bbo' ? (
                                        <div className="p-2 rounded bg-amber-950/30 border border-amber-500/30 text-[9px] text-amber-300/90 space-y-0.5">
                                            <div className="font-bold flex items-center gap-1 text-amber-300">
                                                <Zap className="w-3 h-3 text-amber-400 fill-amber-400" />
                                                <span>Real-Time Order Book Shadowing Active</span>
                                            </div>
                                            <p className="text-[8.5px] text-gray-400 leading-tight">
                                                Stays resting at Top-of-Book to preserve queue priority. Instantly cancels and re-pegs when another participant outbids you!
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="p-1.5 rounded bg-black/40 border border-white/5 text-[9px] text-gray-400">
                                            <span>Waits for configured delay interval between chase attempts.</span>
                                        </div>
                                    )}

                                    {/* Max Chase Deviation Slider */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center text-[9px] text-gray-400">
                                            <span>Max Deviation (Circuit Breaker)</span>
                                            <span className="text-amber-400 font-bold font-mono">{slConfig.smartChaseDeviationPct}%</span>
                                        </div>
                                        <input 
                                            type="range"
                                            min="0.1" max="5.0" step="0.1"
                                            value={slConfig.smartChaseDeviationPct}
                                            onChange={(e) => setSlConfig({...slConfig, smartChaseDeviationPct: parseFloat(e.target.value)})}
                                            className="w-full accent-amber-500 h-1 bg-black/50 rounded appearance-none cursor-pointer"
                                        />
                                        <p className="text-[8px] text-gray-500">Breach triggers emergency Market Sweep.</p>
                                    </div>

                                    {/* Retries and Delay Grid */}
                                    <div className={`grid ${slConfig.smartChaseMode === 'dynamic_bbo' ? 'grid-cols-1' : 'grid-cols-2'} gap-2 pt-1 border-t border-white/5`}>
                                        <div className="space-y-1">
                                            <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                <span>Max Re-pegs / Retries</span>
                                                <span className="text-[8px] text-amber-400 font-bold">0 = ∞ (Continuous)</span>
                                            </label>
                                            <input 
                                                type="number"
                                                min="0" max="100000" step="1"
                                                value={slConfig.smartChaseMaxAttempts}
                                                onChange={(e) => setSlConfig({...slConfig, smartChaseMaxAttempts: parseInt(e.target.value) || 0})}
                                                placeholder="0 (Unlimited)"
                                                className="w-full bg-black/40 border border-white/10 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-red-500/50"
                                            />
                                        </div>
                                        {slConfig.smartChaseMode === 'interval' && (
                                            <div className="space-y-1">
                                                <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                    <span>Delay (ms)</span>
                                                    <span className="text-[8px] text-gray-500">Throttle</span>
                                                </label>
                                                <input 
                                                    type="number"
                                                    min="200" max="5000" step="100"
                                                    value={slConfig.smartChaseDelayMs}
                                                    onChange={(e) => setSlConfig({...slConfig, smartChaseDelayMs: parseInt(e.target.value) || 1500})}
                                                    placeholder="1500"
                                                    className="w-full bg-black/40 border border-white/10 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-red-500/50"
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Auto-Breakeven (Capital Protection) Panel */}
                            <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-lg p-2.5 space-y-2 mt-2">
                                <div className="flex justify-between items-center cursor-pointer group" onClick={() => setSlConfig({ ...slConfig, autoBreakevenEnabled: !slConfig.autoBreakevenEnabled })}>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        <span className="text-[10px] font-bold text-emerald-300 group-hover:text-white transition-colors">
                                            🛡️ Auto-Breakeven (Risk-Free Trade)
                                        </span>
                                    </div>
                                    <div className={`relative w-7 h-3.5 rounded-full transition-colors ${slConfig.autoBreakevenEnabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
                                        <MotionDiv 
                                            className="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full"
                                            animate={{ x: slConfig.autoBreakevenEnabled ? 14 : 0 }}
                                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                        />
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {slConfig.autoBreakevenEnabled && (
                                        <MotionDiv
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="space-y-2 pt-1 border-t border-emerald-500/10 overflow-hidden"
                                        >
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="space-y-1">
                                                    <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                        <span>Trigger at Profit</span>
                                                        <span className="text-emerald-400 font-mono font-bold">+{slConfig.autoBreakevenTriggerPct}%</span>
                                                    </label>
                                                    <input 
                                                        type="number"
                                                        step="0.1"
                                                        min="0.1"
                                                        max="50"
                                                        value={slConfig.autoBreakevenTriggerPct}
                                                        onChange={(e) => setSlConfig({ ...slConfig, autoBreakevenTriggerPct: parseFloat(e.target.value) || 0.5 })}
                                                        className="w-full bg-black/40 border border-emerald-500/20 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-emerald-500/50"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                        <span>Fee Buffer</span>
                                                        <span className="text-emerald-400 font-mono font-bold">+{slConfig.autoBreakevenBufferPct}%</span>
                                                    </label>
                                                    <input 
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        max="1.0"
                                                        value={slConfig.autoBreakevenBufferPct}
                                                        onChange={(e) => setSlConfig({ ...slConfig, autoBreakevenBufferPct: parseFloat(e.target.value) || 0.05 })}
                                                        className="w-full bg-black/40 border border-emerald-500/20 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-emerald-500/50"
                                                        title="Extra cushion above entry price to guarantee 0 loss after exchange commissions"
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[8px] text-emerald-400/80 leading-tight">
                                                ⚡ When profit reaches +{slConfig.autoBreakevenTriggerPct}%, SL automatically ratchets to Entry + {slConfig.autoBreakevenBufferPct}% buffer (100% Risk-Free)!
                                            </p>
                                        </MotionDiv>
                                    )}
                                </AnimatePresence>
                            </div>
                        </MotionDiv>
                     )}
                  </AnimatePresence>
              </div>

              {/* Futures Options Panel */}
              {isFutures && (
                <div className="space-y-3 bg-black/20 p-3 rounded-lg border border-white/5">
                  {/* Margin Mode & Leverage Header */}
                  <div className="flex justify-between items-center text-xs text-gray-400 font-medium">
                    <div className="flex bg-black/40 rounded p-0.5 border border-white/5">
                        <button 
                          onClick={() => setMarginMode('cross')}
                          className={`px-2 py-0.5 rounded transition-colors ${marginMode === 'cross' ? 'bg-brand-primary text-white font-bold' : 'hover:text-white'}`}
                        >
                          Cross
                        </button>
                        <button 
                          onClick={() => setMarginMode('isolated')}
                          className={`px-2 py-0.5 rounded transition-colors ${marginMode === 'isolated' ? 'bg-brand-primary text-white font-bold' : 'hover:text-white'}`}
                        >
                          Isolated
                        </button>
                    </div>
                    <span className="text-xs bg-brand-primary/20 text-brand-primary px-2 py-0.5 rounded font-mono font-bold tracking-wider">{leverage}x</span>
                  </div>
                  
                  {/* Leverage Slider */}
                  <input 
                    type="range" 
                    min="1" 
                    max="125" 
                    value={leverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                    className="w-full accent-brand-primary h-1.5 bg-black/50 rounded-lg appearance-none cursor-pointer"
                  />

                  {/* Reduce Only Checkbox */}
                  <label className="flex items-center space-x-2 cursor-pointer group w-max">
                    <input 
                       type="checkbox" 
                       checked={reduceOnly}
                       onChange={(e) => setReduceOnly(e.target.checked)}
                       className="form-checkbox bg-black/40 border-white/20 text-brand-primary rounded focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                    />
                    <span className="text-xs text-gray-400 group-hover:text-white transition-colors">Reduce Only (Close Position)</span>
                  </label>
                </div>
              )}

              </div> {/* End Scrollable Content */}

              {/* Inline AI Trade Shield Rejection Card (Sticky above Execute button) */}
              <AnimatePresence>
                {aiRejectNotice && (
                  <MotionDiv
                    initial={{ height: 0, opacity: 0, y: 6 }}
                    animate={{ height: 'auto', opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: 6 }}
                    className="overflow-hidden mt-2"
                  >
                    <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-950/60 via-[#0d1424] to-black border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.15)] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-amber-300">
                            AI Shield Protected ({aiRejectNotice.side} Blocked)
                          </span>
                          <span className="text-[9px] text-gray-500 font-mono">
                            {aiRejectNotice.timestamp}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAiRejectNotice(null)}
                          className="text-gray-400 hover:text-white p-0.5 rounded hover:bg-white/10 transition-colors cursor-pointer"
                          title="Dismiss AI Shield Notice"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Score vs Threshold Progress Bar */}
                      <div className="space-y-1 bg-black/50 p-2 rounded-lg border border-white/5">
                        <div className="flex items-center justify-between text-[9.5px] font-mono">
                          <span className="text-gray-300">
                            {aiRejectNotice.directionLabel}:{' '}
                            <strong className="text-amber-300">{aiRejectNotice.calibratedProb.toFixed(1)}%</strong>
                            {aiRejectNotice.rawProb !== null && aiRejectNotice.rawProb !== undefined && Math.abs(aiRejectNotice.rawProb - aiRejectNotice.calibratedProb) > 3 && (
                              <span className="text-[8.5px] text-gray-500 ml-1">(Raw {aiRejectNotice.rawProb.toFixed(1)}%)</span>
                            )}
                          </span>
                          <span className="text-cyan-300 font-bold">
                            Req ≥{aiRejectNotice.threshold.toFixed(0)}% • {aiRejectNotice.oppositeLabel} {aiRejectNotice.oppositeProb.toFixed(1)}%
                          </span>
                        </div>
                        <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              aiRejectNotice.side === 'BUY'
                                ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                                : 'bg-gradient-to-r from-rose-500 to-amber-400'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(4, aiRejectNotice.calibratedProb))}%` }}
                          />
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-cyan-300"
                            style={{ left: `${Math.min(98, Math.max(2, aiRejectNotice.threshold))}%` }}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[8.5px] font-mono text-gray-300">
                          <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                            Model: <strong className="text-blue-300">{aiRejectNotice.modelName}</strong>
                          </span>
                          {aiRejectNotice.flowPct !== null && aiRejectNotice.flowPct !== undefined && (
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                              {aiRejectNotice.flowLabel || 'Flow'}: <strong className="text-white">{aiRejectNotice.flowPct.toFixed(0)}%</strong>
                            </span>
                          )}
                          {aiRejectNotice.l2Pct !== null && aiRejectNotice.l2Pct !== undefined && (
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                              {aiRejectNotice.l2Label || 'L2'}: <strong className="text-white">{aiRejectNotice.l2Pct.toFixed(0)}%</strong>
                            </span>
                          )}
                          {aiRejectNotice.tpHitEst !== null && aiRejectNotice.tpHitEst !== undefined && (
                            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">
                              TP Hit Est: <strong className="text-amber-300">{aiRejectNotice.tpHitEst.toFixed(0)}%</strong>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-[9.5px] text-amber-200/95 leading-tight flex items-start gap-1.5 px-1">
                        <span className="text-amber-400 shrink-0">⚡</span>
                        <span>{aiRejectNotice.reason}</span>
                      </div>
                    </div>
                  </MotionDiv>
                )}
              </AnimatePresence>

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-3 mt-2 border-t border-white/10">
                <button
                  onClick={() => handleTrade(tradeSide)}
                  disabled={isSubmitting}
                  className={`flex-1 py-3 px-4 rounded-xl font-bold flex flex-col items-center justify-center transition-all disabled:opacity-50 group border ${
                     orderType === 'SmartPeg'
                       ? tradeSide === 'Buy'
                         ? 'bg-gradient-to-r from-amber-600/30 to-green-600/30 hover:from-amber-600 hover:to-green-600 text-amber-300 hover:text-white border-amber-500/60 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                         : 'bg-gradient-to-r from-amber-600/30 to-red-600/30 hover:from-amber-600 hover:to-red-600 text-amber-300 hover:text-white border-amber-500/60 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
                       : tradeSide === 'Buy' 
                         ? 'bg-green-500/20 hover:bg-green-500 text-green-400 hover:text-white border-green-500/50 hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]'
                         : 'bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {orderType === 'SmartPeg' ? (
                      <Zap className="w-5 h-5 text-amber-300 fill-amber-300 group-hover:scale-110 transition-transform animate-bounce-subtle" />
                    ) : tradeSide === 'Buy' ? (
                      <TrendingUp className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
                    ) : (
                      <TrendingDown className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />
                    )}
                    <span className="text-sm uppercase tracking-wider">
                      {orderType === 'SmartPeg' ? 'Smart Peg' : 'Execute'} {isFutures ? (tradeSide === 'Buy' ? 'Long' : 'Short') : tradeSide}
                    </span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Footer Status */}
            <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center justify-between">
              <span className="text-[10px] text-gray-500 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse shadow-[0_0_5px_rgba(34,197,94,0.8)]"></span>
                Secure Execution via API
              </span>
              {isTelegramConnected === true ? (
                <span className="text-[10px] text-cyan-400/90 flex items-center gap-1.5 font-medium" title="Telegram alerts are active and verified">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.8)]"></span>
                  Telegram Alerts Active
                </span>
              ) : isTelegramConnected === false ? (
                <a
                  href="/settings"
                  className="text-[10px] text-amber-400/90 hover:text-amber-300 flex items-center gap-1.5 font-medium underline cursor-pointer"
                  title="Manual trade alerts are disabled in Settings or Telegram bot is not connected. Click to configure in Settings."
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  Manual Trade Alerts Disabled
                </a>
              ) : null}
            </div>
                </>
              )}
            </div>
        )}
      </AnimatePresence>,
      document.body
    )}

      {/* Floating Drag-to-Chart Price Badge (follows finger/mouse over chart) */}
      {activeDragLine && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 1000) - 190, Math.max(10, activeDragLine.pointerPos.x + 16)),
            top: Math.max(10, activeDragLine.pointerPos.y - 42),
            pointerEvents: 'none',
            zIndex: 999999,
          }}
          className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] font-black shadow-2xl ${isThermalGuardActive ? '' : 'backdrop-blur-md'} flex items-center gap-2 select-none animate-fadeIn ${
            activeDragLine.type === 'tp'
              ? 'bg-emerald-950/95 border-emerald-400 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.55)]'
              : 'bg-rose-950/95 border-rose-400 text-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.55)]'
          }`}
        >
          {activeDragLine.type === 'tp' ? (
            <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}
          <span>
            {activeDragLine.type === 'tp' ? 'TP' : 'SL'} @ ${formatDisplayPrice(activeDragLine.currentPrice)}
          </span>
          {effectiveCurrentPrice > 0 && activeDragLine.currentPrice > 0 && (
            <span
              className={`text-[9px] font-extrabold ${
                activeDragLine.currentPrice >= effectiveCurrentPrice ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              ({(((activeDragLine.currentPrice - effectiveCurrentPrice) / effectiveCurrentPrice) * 100) >= 0 ? '+' : ''}
              {(((activeDragLine.currentPrice - effectiveCurrentPrice) / effectiveCurrentPrice) * 100).toFixed(2)}%)
            </span>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

export const ManualTradeModal = React.memo(ManualTradeModalBase);
