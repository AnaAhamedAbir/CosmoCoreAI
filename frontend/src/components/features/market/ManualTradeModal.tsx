import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, ChevronDown, RefreshCw, Square, ShieldAlert, Zap, Layers, AlertTriangle, Minus, Maximize2, GripVertical, Trash2, Target, MoveVertical, Magnet, KeyRound } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { manualTradeService, ApiKey, FastBalanceResponse, FastPositionResponse, MlLivePreviewResponse } from '../../../services/manualTradeService';
import { notificationService } from '../../../services/notification';
import { mlModelsService } from '../../../services/mlModelsService';
import { trainingStudioToolsService } from '../../../services/trainingStudioToolsService';
import { CustomMLModel } from '../../../types';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { beginFloatingModalDrag, endFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { FloatingModalCyberFX } from '../../common/FloatingModalCyberFX';
import { findBestWallsForTrade, OrderbookWall } from '../../../utils/liquidityWallMagnet';
import {
  calculateRiskBasedPositionSize,
  calculateTradePnlAndRRPreview,
  calculateDragLineDeltaUsd,
} from '../../../utils/riskAndPnlCalculator';
import {
  RiskSizingSubBar,
  LivePnlAndRRBar,
} from './RiskSizeAndPnlControls';
import {
  HudLivePositionPnlChip,
  HudLiveAiMicroGauge,
  HudCompactPnlStrip,
} from './HudQuantControls';
import {
  HudWallMagnetBar,
  FullModalLimitWallPanel,
  SmartPegWallStrategyPanel,
} from './LiquidityWallMagnetControls';
import {
  ForceExecutionPanel,
  QuickTpSlInlineStrip,
} from './ManualTradeTerminalPanels';
import { BracketTpSlTabPanel } from './BracketTpSlTabPanel';

const MotionButton = motion.button as any;
const MotionDiv = motion.div as any;

export interface AvailablePair {
  id: string;
  symbol: string;
  exchange: string;
  isMain?: boolean;
  price?: number;
}

type ChartDragBracketType = 'tp' | 'sl' | 'buy' | 'sell' | 'peg_buy' | 'peg_sell';

interface ManualTradeModalProps {
  symbol: string;
  currentPrice: number;
  activePairId?: string;
  availablePairs?: AvailablePair[];
  orderbookWalls?: OrderbookWall[];
  onSelectPair?: (pair: AvailablePair) => void;
  onApiKeyChange?: (apiKeyId: string) => void;
  clickedPrice?: number | null;
  openTrigger?: number;
  buttonSize?: 'sm' | 'md';
  onClose?: () => void;
  onOpenChange?: (isOpen: boolean) => void;
  onChartDragBracketStart?: (type: ChartDragBracketType) => void;
  onChartDragBracketMove?: (type: ChartDragBracketType, clientX: number, clientY: number) => number | null;
  onChartDragBracketEnd?: (type: ChartDragBracketType, clientX: number, clientY: number) => { inChart: boolean; price: number | null };
}

const ManualTradeModalBase: React.FC<ManualTradeModalProps> = ({
  symbol,
  currentPrice,
  activePairId,
  availablePairs,
  orderbookWalls,
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
  const [hudDrawer, setHudDrawer] = useState<'none' | 'force' | 'ai' | 'wall'>('none');
  const [showFuturesPopover, setShowFuturesPopover] = useState(false);
  const [activeTerminalTab, setActiveTerminalTab] = useState<'order' | 'brackets' | 'ai' | 'orders'>('order');
  const [submittingSide, setSubmittingSide] = useState<'Buy' | 'Sell' | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string>(symbol);
  const [selectedPairId, setSelectedPairId] = useState<string>(activePairId || '');

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
      } catch { }
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
      } catch { }
    }
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    return { x: 20, y: Math.max(16, winH - 104 - 778) };
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

  // Interactive Drag-to-Chart TP / SL / Order State (for Touch & Mouse)
  const [activeDragLine, setActiveDragLine] = useState<{
    type: 'tp' | 'sl' | 'buy' | 'sell' | 'peg_buy' | 'peg_sell';
    currentPrice: number;
    pointerPos: { x: number; y: number };
  } | null>(null);

  const activeDragLineRef = React.useRef<{
    type: 'tp' | 'sl' | 'buy' | 'sell' | 'peg_buy' | 'peg_sell';
    pointerId: number;
    isDragging: boolean;
  } | null>(null);
  const activeDragCleanupRef = React.useRef<(() => void) | null>(null);

  // Sync internal activeSymbol and selectedPairId whenever parent props update
  React.useEffect(() => {
    if (symbol) {
      setActiveSymbol(symbol);
    }
  }, [symbol]);

  React.useEffect(() => {
    if (activePairId) {
      setSelectedPairId(activePairId);
    }
  }, [activePairId]);

  const activePair =
    (selectedPairId ? availablePairs?.find(p => p.id === selectedPairId) : undefined) ||
    availablePairs?.find(p => p.symbol === activeSymbol);
  const effectiveCurrentPrice = (activePair?.price && activePair.price > 0)
    ? activePair.price
    : (activeSymbol === symbol ? currentPrice : (activePair?.price || currentPrice || 0));

  const handleSelectPair = (pair: AvailablePair) => {
    setSelectedPairId(pair.id);
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
  const [smartPegAnchorPrice, setSmartPegAnchorPrice] = useState<string>('');
  const [smartPegStrategy, setSmartPegStrategy] = useState<'bbo' | 'inside_spread' | 'wall_aware'>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_wall_magnet_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (p?.pegStrategy === 'bbo' || p?.pegStrategy === 'inside_spread' || p?.pegStrategy === 'wall_aware') {
          return p.pegStrategy;
        }
      }
    } catch { }
    return 'bbo';
  });
  const [smartPegWallMultiplier, setSmartPegWallMultiplier] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_wall_magnet_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.wallMultiplier === 'number' && p.wallMultiplier >= 1.1) return p.wallMultiplier;
      }
    } catch { }
    return 2.5;
  });
  const [smartPegFrontRunTicks, setSmartPegFrontRunTicks] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_wall_magnet_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.frontRunTicks === 'number' && p.frontRunTicks >= 1) return p.frontRunTicks;
      }
    } catch { }
    return 1;
  });
  const [smartPegAntiSpoof, setSmartPegAntiSpoof] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_wall_magnet_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.antiSpoof === 'boolean') return p.antiSpoof;
      }
    } catch { }
    return true;
  });
  const [wallMagnetEnabled, setWallMagnetEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_wall_magnet_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.wallMagnetEnabled === 'boolean') return p.wallMagnetEnabled;
      }
    } catch { }
    return false;
  });
  const [fetchedWalls, setFetchedWalls] = useState<OrderbookWall[]>([]);
  const [isFetchingWalls, setIsFetchingWalls] = useState<boolean>(false);
  const [isShiftPressed, setIsShiftPressed] = useState<boolean>(false);
  const [size, setSize] = useState<string>('');
  const [selectedPercent, setSelectedPercent] = useState<string | null>('100%');
  const [leverage, setLeverage] = useState<number>(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedApi, setSelectedApi] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const savedId = localStorage.getItem('cosmo_manual_selected_api_v1');
      if (savedId) return savedId;
      const cachedKeys = localStorage.getItem('cosmo_manual_api_keys_cache_v1');
      if (cachedKeys) {
        const parsed = JSON.parse(cachedKeys);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.id !== undefined) {
          return String(parsed[0].id);
        }
      }
    } catch { }
    return '';
  });
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const cachedKeys = localStorage.getItem('cosmo_manual_api_keys_cache_v1');
      if (cachedKeys) {
        const parsed = JSON.parse(cachedKeys);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { }
    return [];
  });
  const readCachedBalance = React.useCallback((apiId: string, sym: string): FastBalanceResponse | null => {
    if (!apiId || !sym || typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('cosmo_manual_balance_cache_v1');
      if (!raw) return null;
      const map = JSON.parse(raw);
      return (map && map[`${apiId}:${sym}`]) || null;
    } catch {
      return null;
    }
  }, []);
  const writeCachedBalance = React.useCallback((apiId: string, sym: string, data: FastBalanceResponse) => {
    if (!apiId || !sym || typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('cosmo_manual_balance_cache_v1');
      const map = raw ? JSON.parse(raw) : {};
      const keys = Object.keys(map);
      if (keys.length >= 25) {
        delete map[keys[0]];
      }
      map[`${apiId}:${sym}`] = data;
      localStorage.setItem('cosmo_manual_balance_cache_v1', JSON.stringify(map));
    } catch { }
  }, []);
  const [balanceData, setBalanceData] = useState<FastBalanceResponse | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const savedId = localStorage.getItem('cosmo_manual_selected_api_v1') || (() => {
        const ck = localStorage.getItem('cosmo_manual_api_keys_cache_v1');
        const p = ck ? JSON.parse(ck) : null;
        return Array.isArray(p) && p[0]?.id !== undefined ? String(p[0].id) : '';
      })();
      if (!savedId) return null;
      const raw = localStorage.getItem('cosmo_manual_balance_cache_v1');
      const map = raw ? JSON.parse(raw) : null;
      return (map && map[`${savedId}:${symbol}`]) || null;
    } catch {
      return null;
    }
  });
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
    autoBreakevenBufferPct: 0.05,
    antiWickMode: 'instant' as 'instant' | 'dwell' | 'candle_close',
    antiWickDwellSeconds: 3,
    antiWickTimeframe: '1m' as '1m' | '3m' | '5m' | '15m',
    antiWickDisasterPct: 2.0,
  });
  const [sizingMode, setSizingMode] = useState<'standard' | 'risk_usd' | 'risk_pct'>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_risk_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (p?.sizingMode === 'standard' || p?.sizingMode === 'risk_usd' || p?.sizingMode === 'risk_pct') {
          return p.sizingMode;
        }
      }
    } catch { }
    return 'standard';
  });
  const [riskAmountInput, setRiskAmountInput] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('cosmo_manual_risk_cfg_v1');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.riskAmountInput === 'string' && p.riskAmountInput) return p.riskAmountInput;
      }
    } catch { }
    return '10';
  });
  const [mlLivePreview, setMlLivePreview] = useState<MlLivePreviewResponse | null>(null);
  const [isMovingBreakeven, setIsMovingBreakeven] = useState<boolean>(false);
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
        const active = Boolean(s && s.is_enabled && s.alert_manual_trade !== false && s.telegram_chat_id && (s.use_master_bot || s.telegram_bot_token));
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
          className={`${t.visible ? 'animate-enter' : 'animate-leave'
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
                    className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${notice.side === 'BUY'
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
                  className={`h-full rounded-full transition-all duration-300 ${notice.side === 'BUY'
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
      setIcebergMode('qty');
      setIcebergCustomQty((prev) => (!prev || prev === '0' ? '250' : prev));
    } else {
      hasManualMlOverrideRef.current = false;
    }
  }, [isOpen]);

  // Pre-warm ML model + live features in backend RAM and refresh Pre-Trade AI Micro-Gauge
  React.useEffect(() => {
    if (!isOpen || !mlFilterConfig.modelId || !activeSymbol) {
      setMlLivePreview(null);
      return;
    }
    const refreshMlPreview = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (mlFilterConfig.enabled) {
        // Live preview reuses and warms the exact same RAM feature cache without gc.collect() spikes
        manualTradeService
          .getMlFilterLivePreview(
            activeSymbol,
            mlFilterConfig.modelId,
            mlFilterConfig.bullishThreshold,
            mlFilterConfig.bearishThreshold,
            activePair?.exchange || 'binance'
          )
          .then((res) => {
            if (res && res.status === 'ok') setMlLivePreview(res);
          });
      } else {
        manualTradeService.warmupMlFilter(activeSymbol, mlFilterConfig.modelId);
      }
    };
    refreshMlPreview();
    if (!mlFilterConfig.enabled) {
      setMlLivePreview(null);
      return;
    }
    const warmupInterval = setInterval(refreshMlPreview, timings.mlWarmupMs);
    return () => clearInterval(warmupInterval);
  }, [
    isOpen,
    mlFilterConfig.enabled,
    mlFilterConfig.modelId,
    mlFilterConfig.bullishThreshold,
    mlFilterConfig.bearishThreshold,
    activeSymbol,
    activePair?.exchange,
    timings.mlWarmupMs
  ]);

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
      const openOrdersMinGapMs = guardActive && !isActive ? Math.max(2500, openOrdersPollMs) : 2500;
      // Only query exchange open orders if forced, or if enough time has elapsed and modal is open & tab visible
      const shouldFetchOpenOrders =
        forceOpenOrders || (isOpenRef.current && isVisible && timeSinceLast >= openOrdersMinGapMs);

      if (shouldFetchOpenOrders) {
        lastOpenOrdersFetchRef.current = now;
        if (forceOpenOrders) {
          manualTradeService.invalidatePollCache(Number(selectedApi));
        }
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
      const rawRem = Number(ord.remaining);
      const amt = rawRem > 0 ? rawRem : Number(ord.amount || 0);
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
          label: `${tagPrefix} ${sideLabel} ${Number(effAmt.toFixed(4))} @ $${formatDisplayPrice(price)}${slPrice > 0 ? ` / SL $${formatDisplayPrice(slPrice)}` : ''
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

  // Sync modal-local openLimitOrders / activeBrackets immediately on live Binance WS order_sync events
  React.useEffect(() => {
    const handleOrderSync = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (!detail || !selectedApi) return;
      if (detail.api_key_id !== undefined && String(detail.api_key_id) !== String(selectedApi)) return;
      if (detail.event === 'order_removed') {
        const ids = new Set<string>();
        if (detail.order_id) ids.add(String(detail.order_id));
        if (Array.isArray(detail.order_ids)) {
          for (const x of detail.order_ids) if (x) ids.add(String(x));
        }
        if (ids.size > 0) {
          setOpenLimitOrders((prev) => prev.filter((o) => !ids.has(String(o.id))));
          setActiveBrackets((prev) =>
            prev.filter((b) => {
              const bIds = [b?.id, b?.tp_order_id, b?.entry_order_id, b?.disaster_sl_order_id, b?.sl_order_id].filter(Boolean).map(String);
              return !bIds.some((id) => ids.has(id));
            })
          );
        }
        fetchActiveBrackets(true);
      } else if (detail.event === 'orders_cleared') {
        setOpenLimitOrders([]);
        setActiveBrackets([]);
        fetchActiveBrackets(true);
      } else if (detail.event === 'order_added') {
        fetchActiveBrackets(true);
      }
    };
    window.addEventListener('orderSyncEvent', handleOrderSync);
    return () => window.removeEventListener('orderSyncEvent', handleOrderSync);
  }, [selectedApi, fetchActiveBrackets]);

  const collectLinkedOrderIds = (orderId: string, bracketHint?: any): string[] => {
    const oid = String(orderId || '').trim();
    const ids = new Set<string>(oid ? [oid] : []);
    const inspectBracket = (b: any) => {
      if (!b) return;
      const fields = [b.id, b.tp_order_id, b.entry_order_id, b.disaster_sl_order_id, b.sl_order_id].filter(Boolean).map(String);
      if (!oid || fields.includes(oid) || b === bracketHint) {
        fields.forEach((f) => ids.add(f));
      }
    };
    if (bracketHint) inspectBracket(bracketHint);
    for (const b of activeBrackets) inspectBracket(b);
    return Array.from(ids);
  };

  const handleStopSmartChase = async (targetChase?: any) => {
    if (!selectedApi) return;
    const removedIds = targetChase?.id ? collectLinkedOrderIds(String(targetChase.id), targetChase) : [];
    const removedSet = new Set(removedIds);
    // 0ms optimistic removal before awaiting backend/exchange round-trip
    if (removedSet.size > 0) {
      setActiveBrackets((prev) => prev.filter((b) => !removedSet.has(String(b.id))));
      setOpenLimitOrders((prev) => prev.filter((o) => !removedSet.has(String(o.id))));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderIds: removedIds, apiKeyId: selectedApi } }));
      }
    }
    setIsStoppingChase(true);
    try {
      const res = await manualTradeService.stopSmartChase({
        apiKeyId: Number(selectedApi),
        symbol: activeSymbol,
        slId: targetChase?.id
      });
      toast.success(res.message || '🛑 Smart Chase SL stopped.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rollbackRemoveOpenOrder', { detail: { orderIds: removedIds } }));
      }
      fetchActiveBrackets(true);
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to stop Smart Chase');
    } finally {
      setIsStoppingChase(false);
    }
  };

  const handleStopSmartPeg = async (targetPeg?: any) => {
    if (!selectedApi) return;
    const removedIds = targetPeg?.id ? collectLinkedOrderIds(String(targetPeg.id), targetPeg) : [];
    const removedSet = new Set(removedIds);
    // 0ms optimistic removal before awaiting backend/exchange round-trip
    if (removedSet.size > 0) {
      setActiveBrackets((prev) => prev.filter((b) => !removedSet.has(String(b.id))));
      setOpenLimitOrders((prev) => prev.filter((o) => !removedSet.has(String(o.id))));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderIds: removedIds, apiKeyId: selectedApi } }));
      }
    }
    setIsStoppingPeg(true);
    try {
      const res = await manualTradeService.stopSmartPeg({
        apiKeyId: Number(selectedApi),
        symbol: activeSymbol,
        pegId: targetPeg?.id
      });
      toast.success(res.message || '🛑 Smart Peg Entry cancelled.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rollbackRemoveOpenOrder', { detail: { orderIds: removedIds } }));
      }
      fetchActiveBrackets(true);
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to stop Smart Peg Entry');
    } finally {
      setIsStoppingPeg(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!selectedApi) return;
    const oid = String(orderId);
    const removedIds = collectLinkedOrderIds(oid);
    const removedSet = new Set(removedIds);

    // 0ms optimistic removal on chart & modal BEFORE backend/Binance REST round-trip
    setActiveBrackets((prev) =>
      prev.filter((b) => {
        const fields = [b?.id, b?.tp_order_id, b?.entry_order_id, b?.disaster_sl_order_id, b?.sl_order_id].filter(Boolean).map(String);
        return !fields.some((f) => removedSet.has(f));
      })
    );
    setOpenLimitOrders((prev) => prev.filter((o) => !removedSet.has(String(o.id))));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderIds: removedIds, apiKeyId: selectedApi } }));
    }

    setCancellingOrderId(orderId);
    try {
      const res = await manualTradeService.cancelOrder(Number(selectedApi), orderId, activeSymbol);
      toast.success(res?.message || `🛑 Order #${orderId} cancelled.`);
      if (Array.isArray(res?.cancelled_ids) && res.cancelled_ids.length > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderIds: res.cancelled_ids, apiKeyId: selectedApi } })
        );
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rollbackRemoveOpenOrder', { detail: { orderIds: removedIds } }));
      }
      fetchActiveBrackets(true);
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to cancel order');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleCancelAllOrders = async () => {
    if (!selectedApi) return;
    // 0ms optimistic clear BEFORE backend/Binance REST round-trip
    setOpenLimitOrders([]);
    setActiveBrackets([]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('optimisticClearOpenOrders', { detail: { apiKeyId: selectedApi } }));
    }
    setIsCancellingAll(true);
    try {
      const res = await manualTradeService.cancelAllOrders(Number(selectedApi), activeSymbol);
      toast.success(res?.message || `🛑 All open orders on ${activeSymbol} cancelled.`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rollbackRemoveOpenOrder'));
      }
      fetchActiveBrackets(true);
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to cancel all orders');
    } finally {
      setIsCancellingAll(false);
    }
  };

  const handleClosePosition = async () => {
    if (!selectedApi) return;
    // 0ms optimistic clear of attached SL/TP lines before Market Flatten returns
    setOpenLimitOrders([]);
    setActiveBrackets([]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('optimisticClearOpenOrders', { detail: { apiKeyId: selectedApi } }));
    }
    setIsClosingPosition(true);
    try {
      const res = await manualTradeService.closePosition(Number(selectedApi), activeSymbol);
      toast.success(res?.message || `🚨 Position closed successfully at Market price.`);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      fetchActiveBrackets(true);
      fetchBalance(true);
    } catch (err: any) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('rollbackRemoveOpenOrder'));
      }
      fetchActiveBrackets(true);
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

      const isRiskSizedCustom = !targetObj && sizingMode !== 'standard';
      if (isRiskSizedCustom && riskSizing.baseAmount <= 0) {
        toast.error(riskSizing.warning || 'Please set a valid Stop-Loss and Risk amount.');
        return;
      }

      const hasCustomTypedSize = !targetObj && (isRiskSizedCustom || (!selectedPercent && Boolean(size) && Number(size) > 0));
      // When a specific open order / bracket is targeted, the button displays and force-executes
      // 100% of that cancelled order rather than scaling it by the HUD entry-size percentage.
      const effectivePct = targetObj
        ? 100
        : hasCustomTypedSize
          ? 0
          : selectedPercent
            ? Math.max(1, Math.min(100, Number(selectedPercent.replace('%', '')) || 100))
            : 100;
      const refOrderPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
      const forceRiskCalc = isRiskSizedCustom
        ? calculateRiskBasedPositionSize({
          riskValue: parseFloat(riskAmountInput) || 0,
          riskMode: sizingMode === 'risk_pct' ? 'risk_pct' : 'risk_usd',
          entryPrice: refOrderPrice,
          side,
          slConfig,
          balance: balanceData,
          isFutures,
          leverage,
          reduceOnly,
          positionData,
          isInverseFutures,
          contractSize,
        })
        : null;
      if (forceRiskCalc && forceRiskCalc.baseAmount <= 0) {
        toast.error(forceRiskCalc.warning || 'Please set a valid Stop-Loss and Risk amount.');
        return;
      }
      const customBaseAmt = hasCustomTypedSize
        ? (forceRiskCalc
          ? (isInverseFutures && contractSize > 0
            ? Math.max(1, Math.round((forceRiskCalc.baseAmount * refOrderPrice) / contractSize))
            : forceRiskCalc.baseAmount)
          : (isInverseFutures && contractSize > 0
            ? (sizeMode === 'quote'
              ? Math.max(1, Math.floor(Number(size) / contractSize))
              : Math.max(1, Math.round((Number(size) * refOrderPrice) / contractSize)))
            : (sizeMode === 'quote' && refOrderPrice > 0 ? Number(size) / refOrderPrice : Number(size))))
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
          ? buildAttachedSlPayload()
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
        }
      }, 450);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
        }
      }, 1500);
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

  // Fetch API Keys on component mount (hydrated immediately from localStorage cache)
  React.useEffect(() => {
    if (selectedApi) {
      onApiKeyChange?.(selectedApi);
    }
    const fetchKeys = async () => {
      try {
        const keys = await manualTradeService.getApiKeys();
        setApiKeys(keys);
        try {
          localStorage.setItem('cosmo_manual_api_keys_cache_v1', JSON.stringify(keys));
        } catch { }
        if (keys.length > 0) {
          const validSaved = selectedApi && keys.some(k => String(k.id) === String(selectedApi));
          const resolvedId = validSaved ? String(selectedApi) : keys[0].id.toString();
          if (resolvedId !== selectedApi) {
            setSelectedApi(resolvedId);
            onApiKeyChange?.(resolvedId);
          }
          try {
            localStorage.setItem('cosmo_manual_selected_api_v1', resolvedId);
          } catch { }
        }
      } catch (e) {
        console.error("Failed to load APIs", e);
      }
    };
    fetchKeys();
  }, [onApiKeyChange]);

  // BUG-12 fix: Reset size and mode when symbol changes; restore cached balance immediately (0ms) while live sync refreshes
  React.useEffect(() => {
    setSize('');
    setSizeMode('base');
    setSmartPegAnchorPrice('');
    setFetchedWalls([]);
    setBalanceData(readCachedBalance(selectedApi, activeSymbol));
    setIcebergCustomQty('250');
  }, [activeSymbol, selectedApi, readCachedBalance]);

  const isFetchingBalanceRef = React.useRef(false);

  // Fetch balance and position (supports silent background polling and explicit refresh)
  const fetchBalance = React.useCallback(async (isSilent = false, forceRefresh = false) => {
    if (!selectedApi || !isOpen) return;
    if (isFetchingBalanceRef.current) return; // Prevent concurrent/overlapping requests
    isFetchingBalanceRef.current = true;

    if (!isSilent) {
      setIsLoadingBalance(true);
      setIsLoadingPosition(true);
    }
    setIsRefreshing(true);
    try {
      const balancePromise = manualTradeService.getFastBalance(Number(selectedApi), activeSymbol, forceRefresh);
      const positionPromise = activeSymbol.includes(':')
        ? manualTradeService.getActivePosition(Number(selectedApi), activeSymbol).catch(() => null)
        : Promise.resolve(null);

      const [data, pos] = await Promise.all([balancePromise, positionPromise]);
      setBalanceData(data);
      writeCachedBalance(selectedApi, activeSymbol, data);
      if (activeSymbol.includes(':')) {
        setPositionData(pos);
      }
    } catch (e) {
      if (!isSilent && !readCachedBalance(selectedApi, activeSymbol)) {
        setBalanceData(null);
        setPositionData(null);
      }
    } finally {
      isFetchingBalanceRef.current = false;
      setIsLoadingBalance(false);
      setIsLoadingPosition(false);
      setIsRefreshing(false);
    }
  }, [selectedApi, activeSymbol, isOpen, writeCachedBalance, readCachedBalance]);

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
          y: Math.max(16, winH - 104 - 778)
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
    const modalW = modalEl?.offsetWidth || (isMin ? 474 : 620);
    const modalH = modalEl?.offsetHeight || (isMin ? 216 : 778);

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
    const modalW = modalEl?.offsetWidth || (isMinimized ? 474 : 620);
    const modalH = modalEl?.offsetHeight || (isMinimized ? 216 : 778);
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

    beginFloatingModalDrag(modalEl);

    const applyMove = (clientX: number, clientY: number) => {
      if (!drag.isDragging) return;
      const rawX = drag.originX + (clientX - drag.startX);
      const rawY = drag.originY + (clientY - drag.startY);

      const clampedX = Math.round(Math.max(drag.minX, Math.min(drag.maxX, rawX)));
      const clampedY = Math.round(Math.max(drag.minY, Math.min(drag.maxY, rawY)));
      if (clampedX === drag.currentX && clampedY === drag.currentY) return;

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

    let cleanedUp = false;
    const cleanupDrag = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      drag.isDragging = false;
      endFloatingModalDrag(modalContainerRef.current);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('blur', onUp);
    };

    const onUp = () => {
      if (!drag.isDragging) {
        cleanupDrag();
        return;
      }
      const finalPos = { x: drag.currentX, y: drag.currentY };
      cleanupDrag();

      if (isMinimized) {
        hasUserDraggedHudRef.current = true;
        setHudPos(finalPos);
        try {
          localStorage.setItem('cosmo_manual_trade_hud_pos_v2', JSON.stringify(finalPos));
        } catch { }
      } else {
        hasUserDraggedModalRef.current = true;
        setModalPos(finalPos);
        try {
          localStorage.setItem('cosmo_manual_trade_full_pos_v2', JSON.stringify(finalPos));
        } catch { }
      }
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
      endFloatingModalDrag(modalContainerRef.current);
    }
    return () => {
      if (dragRef.current.isDragging) {
        dragRef.current.isDragging = false;
        endFloatingModalDrag(modalContainerRef.current);
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

  // Liquidity-Wall Magnet & Front-Run Live Sync
  const activeExchangeId = React.useMemo(() => {
    const keyEx = apiKeys.find(k => k.id.toString() === selectedApi)?.exchange;
    return activePair?.exchange || keyEx || 'binance';
  }, [apiKeys, selectedApi, activePair?.exchange]);

  const fetchNearestWalls = React.useCallback(async () => {
    if (!activeSymbol) return;
    setIsFetchingWalls(true);
    try {
      const res = await manualTradeService.getNearestWalls(
        activeSymbol,
        activeExchangeId,
        smartPegWallMultiplier,
        smartPegFrontRunTicks,
        selectedApi ? Number(selectedApi) : undefined
      );
      if (res) {
        const merged: OrderbookWall[] = [
          ...(Array.isArray(res.buy_walls) ? res.buy_walls : []),
          ...(Array.isArray(res.sell_walls) ? res.sell_walls : []),
        ];
        setFetchedWalls(merged);
      }
    } catch {
      // ignore silently
    } finally {
      setIsFetchingWalls(false);
    }
  }, [activeSymbol, activeExchangeId, smartPegWallMultiplier, smartPegFrontRunTicks, selectedApi]);

  // Auto-fetch walls if modal is open and parent orderbookWalls lacks either buy or sell side
  React.useEffect(() => {
    if (!isOpen) return;
    const hasBuy = Boolean(orderbookWalls?.some((w) => w.type === 'buy'));
    const hasSell = Boolean(orderbookWalls?.some((w) => w.type === 'sell'));
    if (hasBuy && hasSell) return;
    fetchNearestWalls();
    const tId = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        fetchNearestWalls();
      }
    }, 3500);
    return () => clearInterval(tId);
  }, [isOpen, orderbookWalls, fetchNearestWalls]);

  // Persist Wall Magnet & SmartPeg strategy preferences across reloads
  React.useEffect(() => {
    try {
      localStorage.setItem(
        'cosmo_manual_wall_magnet_cfg_v1',
        JSON.stringify({
          wallMagnetEnabled,
          pegStrategy: smartPegStrategy,
          wallMultiplier: smartPegWallMultiplier,
          frontRunTicks: smartPegFrontRunTicks,
          antiSpoof: smartPegAntiSpoof,
        })
      );
    } catch { }
  }, [wallMagnetEnabled, smartPegStrategy, smartPegWallMultiplier, smartPegFrontRunTicks, smartPegAntiSpoof]);

  // Persist Risk Sizing preference across reloads
  React.useEffect(() => {
    try {
      localStorage.setItem(
        'cosmo_manual_risk_cfg_v1',
        JSON.stringify({
          sizingMode,
          riskAmountInput,
        })
      );
    } catch { }
  }, [sizingMode, riskAmountInput]);

  const effectiveWalls = React.useMemo<OrderbookWall[]>(() => {
    const parentWalls = orderbookWalls || [];
    if (parentWalls.length === 0) return fetchedWalls;
    const hasBuy = parentWalls.some((w) => w.type === 'buy');
    const hasSell = parentWalls.some((w) => w.type === 'sell');
    if (hasBuy && hasSell) return parentWalls;
    const supplemented = [...parentWalls];
    for (const fw of fetchedWalls) {
      if ((fw.type === 'buy' && !hasBuy) || (fw.type === 'sell' && !hasSell)) {
        supplemented.push(fw);
      }
    }
    return supplemented;
  }, [orderbookWalls, fetchedWalls]);

  const wallTargets = React.useMemo(
    () => findBestWallsForTrade(effectiveWalls, effectiveCurrentPrice, smartPegFrontRunTicks),
    [effectiveWalls, effectiveCurrentPrice, smartPegFrontRunTicks]
  );

  // Track Shift key during drag for temporary Wall Magnet override
  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };
    const onBlur = () => setIsShiftPressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [isOpen]);

  // Sync Drag-to-Chart Wall Magnet config for OrderFlowChart ghost lines
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isOpen) {
      delete (window as any)._cosmoWallMagnetConfig;
      return;
    }
    (window as any)._cosmoWallMagnetConfig = {
      active: Boolean(wallMagnetEnabled || isShiftPressed),
      frontRunTicks: smartPegFrontRunTicks,
    };
    return () => {
      delete (window as any)._cosmoWallMagnetConfig;
    };
  }, [isOpen, wallMagnetEnabled, isShiftPressed, smartPegFrontRunTicks]);

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

  // Unified eligibility check for Native Binance Spot OTO/OTOCO (supports both Full 3-Leg OTOCO and Hybrid 2-Leg OTO + Smart Chase SL)
  const canConfigureNativeTpSl = React.useMemo(() => {
    if (isFutures) return false;
    if (orderType !== 'Limit') return false;
    if (!tpConfig.enabled && !slConfig.enabled) return false;
    const hasNativeTpLeg = tpConfig.enabled && tpConfig.orderType !== 'Market';
    const isSmartChaseSl = slConfig.enabled && (slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase');
    const isExchangeNativeSl = slConfig.enabled && (slConfig.type === 'fixed' || slConfig.type === 'trailing');
    // Note: Exchange Native Trailing / ATR / Auto-BE automatically snap to Fixed Stop once Native OTO/OTOCO is active
    if (hasNativeTpLeg && (!slConfig.enabled || isSmartChaseSl || isExchangeNativeSl)) {
      return true;
    }
    if (!tpConfig.enabled && isExchangeNativeSl) {
      return true;
    }
    return false;
  }, [isFutures, orderType, tpConfig.enabled, tpConfig.orderType, slConfig.enabled, slConfig.type]);

  const isNativeTpSlSupported = React.useMemo(() => {
    return canConfigureNativeTpSl && !isAutoLimit;
  }, [canConfigureNativeTpSl, isAutoLimit]);

  const isNativeExchangeSlLockedToFixed = Boolean(!isFutures && orderType === 'Limit' && useNativeTpSl && !isAutoLimit);

  // When Native Binance OTO/OTOCO is active and Exchange Native SL is selected, keep only Fixed Stop active (auto-snap from Trailing/ATR/Auto-BE)
  React.useEffect(() => {
    if (!isNativeExchangeSlLockedToFixed || !slConfig.enabled) return;
    if (
      slConfig.type === 'trailing' ||
      (slConfig.type === 'fixed' &&
        (slConfig.mode === 'atr' || slConfig.autoBreakevenEnabled))
    ) {
      setSlConfig(prev => ({
        ...prev,
        type: 'fixed',
        mode: prev.mode === 'atr' ? 'percentage' : prev.mode,
        value: prev.mode === 'atr' ? getSmartGapValue('percentage', false) : prev.value,
        autoBreakevenEnabled: false,
      }));
    }
  }, [
    isNativeExchangeSlLockedToFixed,
    slConfig.enabled,
    slConfig.type,
    slConfig.mode,
    slConfig.autoBreakevenEnabled,
    getSmartGapValue
  ]);

  const buildAttachedSlPayload = React.useCallback((overrideValue?: number) => ({
    ...slConfig,
    enabled: true,
    type: slConfig.type,
    mode: slConfig.mode,
    value: overrideValue !== undefined ? overrideValue : Number(slConfig.value || 0),
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
    autoBreakevenBufferPct: slConfig.autoBreakevenBufferPct ?? 0.05,
    anti_wick_mode: slConfig.antiWickMode || 'instant',
    antiWickMode: slConfig.antiWickMode || 'instant',
    anti_wick_dwell_seconds: slConfig.antiWickDwellSeconds ?? 3,
    antiWickDwellSeconds: slConfig.antiWickDwellSeconds ?? 3,
    anti_wick_timeframe: slConfig.antiWickTimeframe || '1m',
    antiWickTimeframe: slConfig.antiWickTimeframe || '1m',
    anti_wick_disaster_pct: slConfig.antiWickDisasterPct ?? 2.0,
    antiWickDisasterPct: slConfig.antiWickDisasterPct ?? 2.0,
  }), [slConfig]);

  const handleMoveToBreakeven = React.useCallback(async () => {
    if (!selectedApi || !activeSymbol) return;
    setIsMovingBreakeven(true);
    try {
      const res = await manualTradeService.moveSlToBreakeven(
        Number(selectedApi),
        activeSymbol,
        slConfig.autoBreakevenBufferPct ?? 0.05,
        Number(positionData?.entry_price || 0)
      );
      toast.success(res?.message || `🛡️ SL moved to Breakeven!`);
      fetchActiveBrackets(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Could not move SL to Breakeven');
    } finally {
      setIsMovingBreakeven(false);
    }
  }, [selectedApi, activeSymbol, slConfig.autoBreakevenBufferPct, positionData?.entry_price, fetchActiveBrackets]);

  const riskSizing = React.useMemo(() => {
    const mode = sizingMode === 'risk_pct' ? 'risk_pct' : 'risk_usd';
    const refPx = effectiveOrderPrice || effectiveCurrentPrice || Number(limitPrice) || 0;
    return calculateRiskBasedPositionSize({
      riskValue: parseFloat(riskAmountInput) || 0,
      riskMode: mode,
      entryPrice: refPx,
      side: tradeSide,
      slConfig,
      balance: balanceData,
      isFutures,
      leverage,
      reduceOnly,
      positionData,
      isInverseFutures,
      contractSize,
    });
  }, [
    sizingMode,
    riskAmountInput,
    effectiveOrderPrice,
    effectiveCurrentPrice,
    limitPrice,
    tradeSide,
    slConfig,
    balanceData,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    isInverseFutures,
    contractSize,
  ]);

  // Keep `size` synced in Base units whenever Risk Sizing mode is active
  React.useEffect(() => {
    if (sizingMode === 'standard') return;
    if (sizeMode !== 'base') {
      setSizeMode('base');
    }
    if (riskSizing.baseAmount > 0) {
      const dec = riskSizing.baseAmount < 1 ? 6 : 4;
      const nextStr = Number(riskSizing.baseAmount.toFixed(dec)).toString();
      setSize(nextStr);
      setSelectedPercent(null);
    } else {
      setSize('');
      setSelectedPercent(null);
    }
  }, [sizingMode, riskSizing.baseAmount, sizeMode]);

  // Derived total base amount currently configured (falls back to 100% available balance if size input is empty)
  const currentBaseAmount = React.useMemo(() => {
    if (sizingMode !== 'standard') {
      return riskSizing.baseAmount;
    }
    const p = effectiveOrderPrice || effectiveCurrentPrice || Number(limitPrice) || 0;
    const raw = parseFloat(size);
    if (!isNaN(raw) && raw > 0) {
      return sizeMode === 'quote' ? (p > 0 ? raw / p : 0) : raw;
    }
    if (balanceData && p > 0) {
      const pctNum = parseFloat((selectedPercent || '100%').replace('%', '')) / 100;
      const pctFactor = !isNaN(pctNum) && pctNum > 0 ? pctNum : 1;
      if (!isFutures) {
        return tradeSide === 'Buy'
          ? ((balanceData.quote_free || 0) * pctFactor) / p
          : (balanceData.base_free || 0) * pctFactor;
      }
    }
    return 0;
  }, [sizingMode, riskSizing.baseAmount, size, sizeMode, effectiveOrderPrice, effectiveCurrentPrice, limitPrice, balanceData, selectedPercent, isFutures, tradeSide]);

  const tradePnlPreview = React.useMemo(() => {
    const refPx = effectiveOrderPrice || effectiveCurrentPrice || Number(limitPrice) || 0;
    return calculateTradePnlAndRRPreview({
      baseAmount: currentBaseAmount,
      entryPrice: refPx,
      side: tradeSide,
      tpConfig,
      slConfig,
      orderType,
      isFutures,
    });
  }, [currentBaseAmount, effectiveOrderPrice, effectiveCurrentPrice, limitPrice, tradeSide, tpConfig, slConfig, orderType, isFutures]);

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

    // Apply a 1.5% safety cushion at 100% on Futures opening orders so Binance's
    // initial-margin + assumed open-loss/taker-fee reserve never rejects with -2019.
    const effectivePct = (futures && !redOnly) ? Math.min(percentage, 0.985) : percentage;
    const val = maxValue * effectivePct;
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
    setSizingMode('standard');
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

  // Synchronized Side Switch Handler (Keeps Full Modal and Minimized HUD 100% aligned)
  const handleSideChange = React.useCallback((newSide: 'Buy' | 'Sell') => {
    if (newSide === tradeSide) return;
    setTradeSide(newSide);

    if (selectedPercent && balanceData && effectiveOrderPrice > 0) {
      const recalculated = calculateSize(
        selectedPercent,
        balanceData,
        effectiveOrderPrice,
        sizeMode,
        newSide,
        isFutures,
        leverage,
        reduceOnly,
        positionData
      );
      if (recalculated && Number(recalculated) > 0) {
        setSize(recalculated);
      }
    }

    if (tpConfig.enabled && tpConfig.mode === 'absolute') {
      setTpConfig(prev => ({
        ...prev,
        value: getSmartGapValue('absolute', true, newSide)
      }));
    }

    if (slConfig.enabled && slConfig.mode === 'absolute') {
      setSlConfig(prev => ({
        ...prev,
        value: getSmartGapValue('absolute', false, newSide)
      }));
    }
  }, [
    tradeSide,
    selectedPercent,
    balanceData,
    effectiveOrderPrice,
    sizeMode,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize,
    tpConfig.enabled,
    tpConfig.mode,
    slConfig.enabled,
    slConfig.mode,
    getSmartGapValue
  ]);

  const handleSnapLimitToWall = React.useCallback((wall: OrderbookWall, frontRunPrice: number, side: 'Buy' | 'Sell') => {
    handleSideChange(side);
    if (orderType === 'SmartPeg') {
      setSmartPegStrategy('wall_aware');
      setSmartPegAnchorPrice(frontRunPrice.toString());
      toast.success(
        `⚓ SmartPeg Wall-Aware capped at ${wall.type.toUpperCase()} Wall Front-Run @ $${formatDisplayPrice(frontRunPrice)}`,
        { duration: 2200 }
      );
    } else {
      setOrderType('Limit');
      setIsAutoLimit(false);
      setLimitPrice(frontRunPrice.toString());
      toast.success(
        `🧲 Snapped ${side} Limit front-running ${wall.type.toUpperCase()} Wall @ $${formatDisplayPrice(frontRunPrice)}`,
        { duration: 2200 }
      );
    }
  }, [handleSideChange, orderType]);

  const handleClearPinnedPrice = React.useCallback(() => {
    if (orderType === 'SmartPeg') {
      setSmartPegAnchorPrice('');
      toast('SmartPeg Wall Anchor cleared (Free BBO/Wall Chase)', { icon: '⚓', duration: 1800 });
    } else {
      setIsAutoLimit(true);
      toast('Reset to Auto Best Limit (BBO)', { icon: '⚡', duration: 1800 });
    }
  }, [orderType]);

  const handleSnapTpToWall = React.useCallback((frontRunPrice: number, wall: OrderbookWall) => {
    setTpConfig(prev => ({
      ...prev,
      enabled: true,
      mode: 'absolute',
      value: frontRunPrice.toString(),
    }));
    toast.success(
      `🎯 TP snapped before ${wall.type.toUpperCase()} Wall @ $${formatDisplayPrice(frontRunPrice)}`,
      { duration: 2200 }
    );
  }, []);

  const handleCyclePegStrategy = React.useCallback(() => {
    setSmartPegStrategy(prev => {
      const next: 'bbo' | 'inside_spread' | 'wall_aware' =
        prev === 'bbo' ? 'inside_spread' : prev === 'inside_spread' ? 'wall_aware' : 'bbo';
      toast(
        `Smart Peg Strategy: ${next === 'wall_aware' ? '🧱 Wall-Aware' : next === 'inside_spread' ? '🎯 Inside-Spread' : '⚡ Top BBO'}`,
        { duration: 1800 }
      );
      return next;
    });
  }, []);

  const lastTriggerRef = React.useRef<number>(0);

  // Update limit price when clickedPrice from chart changes via an explicit trigger, or open modal directly when openTrigger fires
  React.useEffect(() => {
    // Only auto-open if a new valid trigger has been dispatched after mounting
    if (openTrigger && openTrigger > 0 && openTrigger !== lastTriggerRef.current) {
      lastTriggerRef.current = openTrigger;
      if (clickedPrice && clickedPrice > 0) {
        setOrderType('Limit');
        setIsAutoLimit(false); // Disable auto best limit since user manually picked a price
        setLimitPrice(clickedPrice.toString());
        const inferredSide: 'Buy' | 'Sell' = (effectiveCurrentPrice && clickedPrice < effectiveCurrentPrice) ? 'Buy' : 'Sell';
        handleSideChange(inferredSide);
      }
      setIsOpen(true); // Auto-open modal whether triggered by top button or chart price click
      setIsMinimized(false);
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
    } catch { }

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
      } catch { }

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

        const attachedSlPayload = buildAttachedSlPayload(dropPrice);

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
      activeOrderDragCleanupRef.current?.();
    }
  }, [isOpen]);

  React.useEffect(() => () => {
    activeDragCleanupRef.current?.();
    activeOrderDragCleanupRef.current?.();
  }, []);

  // Dedicated Drag-to-Chart Order Placement (Limit & SmartPeg Anchor)
  const didOrderDragRef = React.useRef<boolean>(false);
  const activeOrderDragCleanupRef = React.useRef<(() => void) | null>(null);

  const handleDragOrderExecute = React.useCallback(async (side: 'Buy' | 'Sell', dropPrice: number) => {
    if (!selectedApi) {
      toast.error('Please select an API Key first.');
      setIsMinimized(false);
      return;
    }

    // 1. Resolve size (Risk Sizing computes exact qty for dropPrice & side; standard mode uses typed/slider qty)
    let resolvedSizeStr = size;
    let riskOverrideBaseAmt: number | null = null;
    if (sizingMode !== 'standard') {
      const dragRisk = calculateRiskBasedPositionSize({
        riskValue: parseFloat(riskAmountInput) || 0,
        riskMode: sizingMode === 'risk_pct' ? 'risk_pct' : 'risk_usd',
        entryPrice: dropPrice,
        side,
        slConfig,
        balance: balanceData,
        isFutures,
        leverage,
        reduceOnly,
        positionData,
        isInverseFutures,
        contractSize,
      });
      if (dragRisk.baseAmount <= 0) {
        toast.error(dragRisk.warning || 'Please set a valid Stop-Loss and Risk amount.');
        return;
      }
      riskOverrideBaseAmt = dragRisk.baseAmount;
      const dec = dragRisk.baseAmount < 1 ? 6 : 4;
      resolvedSizeStr = Number(dragRisk.baseAmount.toFixed(dec)).toString();
    } else if (!resolvedSizeStr || Number(resolvedSizeStr) <= 0) {
      if (selectedPercent && balanceData && dropPrice > 0) {
        const recalculated = calculateSize(
          selectedPercent,
          balanceData,
          dropPrice,
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
        }
      }
    }

    if (!resolvedSizeStr || isNaN(Number(resolvedSizeStr)) || Number(resolvedSizeStr) <= 0) {
      toast.error('Please set an order size in HUD before placing drag order.');
      return;
    }

    // 2. ML Filter check
    if (mlFilterConfig.enabled && !(isFutures && reduceOnly)) {
      if (!mlFilterConfig.modelId) {
        toast.error('🤖 Please select a trained ML Model for the AI Filter, or turn it off.');
        return;
      }
    }

    // 3. Convert quote/base amount
    let baseAmount = riskOverrideBaseAmt !== null ? riskOverrideBaseAmt : Number(resolvedSizeStr);
    let contractsCount: number | undefined = undefined;

    if (isInverseFutures) {
      const usdVal = riskOverrideBaseAmt !== null
        ? riskOverrideBaseAmt * dropPrice
        : (sizeMode === 'quote' ? Number(resolvedSizeStr) : Number(resolvedSizeStr) * dropPrice);
      contractsCount = Math.max(1, Math.round(usdVal / contractSize));
      if (usdVal < (contractSize * 0.9)) {
        toast.error(`❌ Minimum order size is 1 contract ($${contractSize} USD).`);
        return;
      }
      baseAmount = (contractsCount * contractSize) / dropPrice;
    } else if (riskOverrideBaseAmt === null && sizeMode === 'quote') {
      baseAmount = Number(resolvedSizeStr) / dropPrice;
    }

    // 4. Calculate Attached TP / SL Brackets based on dropPrice
    let attachedTpPayload: any = undefined;
    if (tpConfig.enabled && tpConfig.value && Number(tpConfig.value) > 0) {
      let tpVal = Number(tpConfig.value);
      if (tpConfig.mode === 'absolute') {
        if (side === 'Buy' && tpVal <= dropPrice) {
          tpVal = Number((dropPrice * 1.015).toFixed(4));
        } else if (side === 'Sell' && tpVal >= dropPrice) {
          tpVal = Number((dropPrice * 0.985).toFixed(4));
        }
      }
      attachedTpPayload = {
        enabled: true,
        mode: tpConfig.mode,
        value: tpVal,
        order_type: tpConfig.orderType,
        timeout_mins: tpConfig.timeoutMins
      };
    }

    let attachedSlPayload: any = undefined;
    if (slConfig.enabled) {
      let slVal = Number(slConfig.value || 0);
      if (slConfig.mode === 'absolute') {
        if (side === 'Buy' && slVal >= dropPrice) {
          slVal = Number((dropPrice * 0.99).toFixed(4));
        } else if (side === 'Sell' && slVal <= dropPrice) {
          slVal = Number((dropPrice * 1.01).toFixed(4));
        }
      }
      attachedSlPayload = buildAttachedSlPayload(slVal);
    }

    const isSmartPeg = orderType === 'SmartPeg';
    let dragIcebergQty: number | undefined = undefined;
    if (!isSmartPeg && !isFutures && isIceberg) {
      const rawSlice = icebergMode === 'percent'
        ? (baseAmount * (parseFloat(icebergPercent) || 0)) / 100
        : (parseFloat(icebergCustomQty) || 0);
      if (rawSlice <= 0) {
        toast.error('Please enter a valid visible Iceberg slice quantity.');
        return;
      }
      if (rawSlice >= baseAmount) {
        toast.error(`Iceberg slice (${rawSlice.toFixed(2)}) must be smaller than total order quantity (${baseAmount.toFixed(2)} ${baseCurrency}).`);
        return;
      }
      const sliceNotional = rawSlice * dropPrice;
      if (sliceNotional < 5.0) {
        const minQty = dropPrice > 0 ? Math.ceil(5.05 / dropPrice) : 65;
        toast.error(`❌ Iceberg slice value (~$${sliceNotional.toFixed(2)}) is below Binance minimum $5 notional! Minimum slice is ~${minQty} ${baseCurrency}.`, { duration: 6000 });
        return;
      }
      dragIcebergQty = rawSlice;
    }

    const toastId = toast.loading(
      isSmartPeg
        ? `⚡ Placing Smart Peg ${side} anchored at $${formatDisplayPrice(dropPrice)}...`
        : `🟢 Placing ${side} Limit Order at $${formatDisplayPrice(dropPrice)}...`
    );

    setIsSubmitting(true);
    setSubmittingSide(side);
    const optAmt = (isInverseFutures && contractsCount) ? contractsCount : baseAmount;
    const optTempId = (typeof window !== 'undefined' && dropPrice > 0) ? `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` : '';
    if (optTempId) {
      window.dispatchEvent(
        new CustomEvent('optimisticAddOpenOrder', {
          detail: {
            apiKeyId: selectedApi ? Number(selectedApi) : undefined,
            symbol: activeSymbol,
            order: {
              id: optTempId,
              side: side.toLowerCase(),
              price: Number(dropPrice),
              amount: Number(optAmt),
              filled: 0,
              remaining: Number(optAmt),
              isSoftwareSL: false,
              mode: 'LIMIT',
              isIceberg: Boolean(dragIcebergQty && dragIcebergQty > 0),
              icebergQty: dragIcebergQty,
            },
          },
        })
      );
    }

    try {
      const paramsPayload: any = isFutures ? { leverage, marginMode, reduceOnly } : {};
      if (isInverseFutures && contractsCount) {
        paramsPayload.contracts = contractsCount;
      }
      if (isSmartPeg) {
        paramsPayload.maxChaseDeviationPct = smartPegMaxDev;
        paramsPayload.pegAnchorPrice = dropPrice;
        paramsPayload.pegStrategy = smartPegStrategy;
        paramsPayload.wallMultiplier = smartPegWallMultiplier;
        paramsPayload.wallFrontRunTicks = smartPegFrontRunTicks;
        paramsPayload.antiSpoofGuard = smartPegAntiSpoof;
      } else {
        paramsPayload.autoBestLimit = false;
      }

      const resolvedExchange = apiKeys.find(k => k.id.toString() === selectedApi)?.exchange || 'binance';

      const payload: any = {
        symbol: activeSymbol,
        side,
        type: isSmartPeg ? 'SmartPeg' : 'Limit',
        amount: optAmt,
        price: dropPrice,
        exchange_id: resolvedExchange,
        api_key_id: selectedApi ? Number(selectedApi) : undefined,
        params: Object.keys(paramsPayload).length > 0 ? paramsPayload : undefined,
        client_timestamp: Date.now(),
        use_native_tp_sl: (!isSmartPeg && canConfigureNativeTpSl) ? Boolean(useNativeTpSl) : false,
        iceberg_qty: dragIcebergQty,
        attached_tp: attachedTpPayload,
        attached_sl: attachedSlPayload,
      };

      if (mlFilterConfig.enabled && mlFilterConfig.modelId && !(isFutures && reduceOnly)) {
        payload.enable_ml_filter = true;
        payload.ml_model_id = mlFilterConfig.modelId;
        payload.ml_execution_mode = mlFilterConfig.executionMode;
        payload.ml_bullish_threshold = mlFilterConfig.bullishThreshold;
        payload.ml_bearish_threshold = mlFilterConfig.bearishThreshold;
      }

      const orderRes = await manualTradeService.placeOrder(payload);

      if (orderRes?.rejected_by_ai || orderRes?.status === 'rejected_by_ai') {
        if (optTempId) {
          window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: optTempId, apiKeyId: selectedApi } }));
        }
        triggerAiShieldRejection(orderRes, side);
        toast.dismiss(toastId);
        return;
      }
      setAiRejectNotice(null);
      toast.dismiss(toastId);

      const createdOrderId = orderRes?.id;
      const resStatus = String(orderRes?.status || '').toLowerCase();
      if (typeof window !== 'undefined') {
        if (resStatus === 'closed' || resStatus === 'filled') {
          if (optTempId) {
            window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: optTempId, apiKeyId: selectedApi } }));
          }
        } else if (createdOrderId) {
          window.dispatchEvent(
            new CustomEvent('optimisticAddOpenOrder', {
              detail: {
                apiKeyId: selectedApi ? Number(selectedApi) : undefined,
                symbol: activeSymbol,
                replaceId: optTempId || undefined,
                order: {
                  id: String(createdOrderId),
                  side: side.toLowerCase(),
                  price: Number(orderRes?.price || dropPrice),
                  amount: Number(orderRes?.amount || optAmt),
                  filled: 0,
                  remaining: Number(orderRes?.amount || optAmt),
                  isSoftwareSL: false,
                  mode: 'LIMIT',
                  isIceberg: Boolean(dragIcebergQty && dragIcebergQty > 0),
                  icebergQty: dragIcebergQty,
                },
              },
            })
          );
        }
      }
      const aiNote = orderRes?.ai_filter_info ? ` [🤖 ${orderRes.ai_filter_info}]` : '';

      toast.custom(
        (t) => (
          <div
            className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border font-mono shadow-2xl backdrop-blur-xl ${side === 'Buy'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-200'
              : 'bg-rose-950/95 border-rose-500/60 text-rose-200'
              }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-base shrink-0">{isSmartPeg ? '⚡' : '✅'}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold truncate">
                  {side} {isSmartPeg ? 'Smart Peg' : 'Limit'} Placed {aiNote}
                </span>
                <span className="text-[10px] text-gray-400 font-mono truncate">
                  {activeSymbol} @ ${formatDisplayPrice(dropPrice)} {createdOrderId ? `• #${createdOrderId}` : ''}
                </span>
              </div>
            </div>
          </div>
        ),
        { duration: 4500 }
      );

      fetchBalance(true);
      fetchActiveBrackets(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
    } catch (err: any) {
      if (optTempId) {
        window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: optTempId, apiKeyId: selectedApi } }));
      }
      const errMsg = err?.response?.data?.detail || err?.message || 'Failed to place order';
      toast.error(`❌ Order Failed: ${errMsg}`, { id: toastId, duration: 5000 });
    } finally {
      setIsSubmitting(false);
      setSubmittingSide(null);
    }
  }, [
    selectedApi,
    sizingMode,
    riskAmountInput,
    size,
    selectedPercent,
    balanceData,
    sizeMode,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize,
    mlFilterConfig,
    isInverseFutures,
    contractSize,
    tpConfig,
    slConfig,
    orderType,
    smartPegMaxDev,
    smartPegStrategy,
    smartPegWallMultiplier,
    smartPegFrontRunTicks,
    smartPegAntiSpoof,
    isNativeTpSlSupported,
    useNativeTpSl,
    apiKeys,
    activeSymbol,
    triggerAiShieldRejection,
    fetchBalance,
    fetchActiveBrackets
  ]);

  const handleOrderPointerDown = React.useCallback((e: React.PointerEvent, side: 'Buy' | 'Sell') => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    const targetEl = e.currentTarget as HTMLElement;

    didOrderDragRef.current = false;
    activeOrderDragCleanupRef.current?.();

    const isSmartPeg = orderType === 'SmartPeg';
    const dragType = isSmartPeg ? (side === 'Buy' ? 'peg_buy' : 'peg_sell') : (side === 'Buy' ? 'buy' : 'sell');

    let hasStartedChartDrag = false;

    const onPointerMove = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!hasStartedChartDrag && dist > 7) {
        hasStartedChartDrag = true;
        didOrderDragRef.current = true;

        try {
          targetEl.setPointerCapture(pointerId);
        } catch { }

        const startFn = onChartDragBracketStart || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketStart : null);
        startFn?.(dragType);

        setActiveDragLine({
          type: dragType as any,
          currentPrice: effectiveCurrentPrice || 0,
          pointerPos: { x: ev.clientX, y: ev.clientY }
        });
      }

      if (hasStartedChartDrag) {
        const moveFn = onChartDragBracketMove || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketMove : null);
        const livePrice = moveFn ? moveFn(dragType, ev.clientX, ev.clientY) : null;

        setActiveDragLine({
          type: dragType as any,
          currentPrice: livePrice !== null && livePrice > 0 ? livePrice : (effectiveCurrentPrice || 0),
          pointerPos: { x: ev.clientX, y: ev.clientY }
        });
      }
    };

    const cleanup = (abortGhost: boolean) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerAbort);
      window.removeEventListener('blur', onPointerAbort);
      activeOrderDragCleanupRef.current = null;

      try {
        targetEl.releasePointerCapture(pointerId);
      } catch { }

      if (abortGhost && hasStartedChartDrag) {
        setActiveDragLine(null);
        const endFn = onChartDragBracketEnd || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketEnd : null);
        endFn?.(dragType, -1, -1);
      }
    };

    const onPointerAbort = () => {
      cleanup(true);
    };

    const onPointerUp = async (ev: PointerEvent) => {
      cleanup(false);

      if (hasStartedChartDrag) {
        setActiveDragLine(null);
        const endFn = onChartDragBracketEnd || (typeof window !== 'undefined' ? (window as any)._handleChartDragBracketEnd : null);
        const result = endFn ? endFn(dragType, ev.clientX, ev.clientY) : { inChart: false, price: null };

        if (!result.inChart || !result.price || result.price <= 0) {
          toast('Order drag cancelled (released outside chart)', { icon: '↩️' });
          return;
        }

        await handleDragOrderExecute(side, result.price);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { once: true });
    window.addEventListener('pointercancel', onPointerAbort, { once: true });
    window.addEventListener('blur', onPointerAbort, { once: true });

    activeOrderDragCleanupRef.current = () => cleanup(true);
  }, [
    orderType,
    effectiveCurrentPrice,
    onChartDragBracketStart,
    onChartDragBracketMove,
    onChartDragBracketEnd,
    handleDragOrderExecute
  ]);

  const handleTrade = async (side: 'Buy' | 'Sell') => {
    if (!selectedApi) {
      toast.error('Please select an API Key to execute the trade.');
      setIsMinimized(false);
      return;
    }

    // Sync tradeSide and recalculate percentage/risk-based size when clicking Buy/Sell for the opposite side
    let resolvedSizeStr = size;
    let tradeRiskOverrideBaseAmt: number | null = null;
    if (sizingMode !== 'standard') {
      if (side !== tradeSide) setTradeSide(side);
      const tradeRefPx = effectiveOrderPrice || effectiveCurrentPrice || 0;
      const tradeRisk = calculateRiskBasedPositionSize({
        riskValue: parseFloat(riskAmountInput) || 0,
        riskMode: sizingMode === 'risk_pct' ? 'risk_pct' : 'risk_usd',
        entryPrice: tradeRefPx,
        side,
        slConfig,
        balance: balanceData,
        isFutures,
        leverage,
        reduceOnly,
        positionData,
        isInverseFutures,
        contractSize,
      });
      if (tradeRisk.baseAmount <= 0) {
        toast.error(tradeRisk.warning || 'Please set a valid Stop-Loss and Risk amount.');
        return;
      }
      tradeRiskOverrideBaseAmt = tradeRisk.baseAmount;
      const dec = tradeRisk.baseAmount < 1 ? 6 : 4;
      resolvedSizeStr = Number(tradeRisk.baseAmount.toFixed(dec)).toString();
      setSize(resolvedSizeStr);
    } else if (side !== tradeSide || ((!resolvedSizeStr || Number(resolvedSizeStr) <= 0) && selectedPercent)) {
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
    let baseAmount = tradeRiskOverrideBaseAmt !== null ? tradeRiskOverrideBaseAmt : Number(resolvedSizeStr);
    let contractsCount: number | undefined = undefined;
    const convPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;

    if (isInverseFutures) {
      if (convPrice <= 0) {
        toast.error('Cannot execute COIN-M trade: reference price is unavailable.');
        return;
      }
      const usdVal = tradeRiskOverrideBaseAmt !== null
        ? tradeRiskOverrideBaseAmt * convPrice
        : (sizeMode === 'quote' ? Number(resolvedSizeStr) : Number(resolvedSizeStr) * convPrice);
      contractsCount = Math.max(1, Math.round(usdVal / contractSize));
      if (usdVal < (contractSize * 0.9)) {
        toast.error(`❌ Minimum order size for ${activeSymbol} is 1 contract ($${contractSize} USD). Current order value is ~$${usdVal.toFixed(2)} USD.`);
        return;
      }
      baseAmount = (contractsCount * contractSize) / convPrice;
    } else if (tradeRiskOverrideBaseAmt === null && sizeMode === 'quote') {
      if (convPrice <= 0) {
        toast.error('Cannot convert: reference price is unavailable.');
        return;
      }
      baseAmount = Number(resolvedSizeStr) / convPrice;
    }

    setIsSubmitting(true);
    setSubmittingSide(side);
    let formOptTempId = '';
    try {
      if (orderType === 'Limit' && !isAutoLimit && (!limitPrice || Number(limitPrice) <= 0)) {
        toast.error('Please enter a valid limit price or enable Auto Limit.');
        return; // finally block handles setIsSubmitting(false)
      }

      // Validate Iceberg (Spot Limit only) — compute directly from baseAmount so even empty size input (100% fallback) works
      let resolvedIcebergQty: number | undefined = undefined;
      if (orderType === 'Limit' && !isFutures && isIceberg) {
        const rawSlice = icebergMode === 'percent'
          ? (baseAmount * (parseFloat(icebergPercent) || 0)) / 100
          : (parseFloat(icebergCustomQty) || 0);
        if (rawSlice <= 0) {
          toast.error('Please enter a valid visible Iceberg slice quantity.');
          return;
        }
        if (rawSlice >= baseAmount) {
          toast.error(`Iceberg slice (${rawSlice.toFixed(2)}) must be smaller than total order quantity (${baseAmount.toFixed(2)} ${baseCurrency}).`);
          return;
        }
        const refPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
        const sliceNotional = rawSlice * refPrice;
        if (sliceNotional < 5.0) {
          const minQty = refPrice > 0 ? Math.ceil(5.05 / refPrice) : 65;
          toast.error(`❌ Iceberg slice value (~$${sliceNotional.toFixed(2)}) is below Binance minimum $5 notional! Minimum slice is ~${minQty} ${baseCurrency}.`, { duration: 6000 });
          return;
        }
        resolvedIcebergQty = rawSlice;
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
        paramsPayload.pegStrategy = smartPegStrategy;
        paramsPayload.wallMultiplier = smartPegWallMultiplier;
        paramsPayload.wallFrontRunTicks = smartPegFrontRunTicks;
        paramsPayload.antiSpoofGuard = smartPegAntiSpoof;
        if (smartPegAnchorPrice && Number(smartPegAnchorPrice) > 0) {
          paramsPayload.pegAnchorPrice = Number(smartPegAnchorPrice);
        }
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
        iceberg_qty: resolvedIcebergQty
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
          payload.attached_sl = buildAttachedSlPayload();
        }
      }

      if (mlFilterConfig.enabled && mlFilterConfig.modelId && !(isFutures && reduceOnly)) {
        payload.enable_ml_filter = true;
        payload.ml_model_id = mlFilterConfig.modelId;
        payload.ml_execution_mode = mlFilterConfig.executionMode;
        payload.ml_bullish_threshold = mlFilterConfig.bullishThreshold;
        payload.ml_bearish_threshold = mlFilterConfig.bearishThreshold;
      }

      const formAmt = (isInverseFutures && contractsCount) ? contractsCount : baseAmount;
      const formPreviewPrice =
        orderType === 'Limit' && !isAutoLimit
          ? Number(limitPrice)
          : (effectiveOrderPrice || convPrice || 0);
      if (typeof window !== 'undefined' && orderType !== 'Market' && formPreviewPrice > 0) {
        formOptTempId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        window.dispatchEvent(
          new CustomEvent('optimisticAddOpenOrder', {
            detail: {
              apiKeyId: selectedApi ? Number(selectedApi) : undefined,
              symbol: activeSymbol,
              order: {
                id: formOptTempId,
                side: side.toLowerCase(),
                price: Number(formPreviewPrice),
                amount: Number(formAmt),
                filled: 0,
                remaining: Number(formAmt),
                isSoftwareSL: false,
                mode: 'LIMIT',
                isIceberg: Boolean(resolvedIcebergQty && resolvedIcebergQty > 0),
                icebergQty: resolvedIcebergQty,
              },
            },
          })
        );
      }

      const orderRes = await manualTradeService.placeOrder(payload);
      if (orderRes?.rejected_by_ai || orderRes?.status === 'rejected_by_ai') {
        if (formOptTempId) {
          window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: formOptTempId, apiKeyId: selectedApi } }));
        }
        triggerAiShieldRejection(orderRes, side);
        return;
      }
      setAiRejectNotice(null);

      const createdOrderId = orderRes?.id;
      const resStatus = String(orderRes?.status || '').toLowerCase();
      if (typeof window !== 'undefined') {
        if (orderType === 'Market' || resStatus === 'closed' || resStatus === 'filled') {
          if (formOptTempId) {
            window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: formOptTempId, apiKeyId: selectedApi } }));
          }
        } else if (createdOrderId) {
          const confirmedPx = Number(orderRes?.price || formPreviewPrice || 0);
          if (confirmedPx > 0) {
            window.dispatchEvent(
              new CustomEvent('optimisticAddOpenOrder', {
                detail: {
                  apiKeyId: selectedApi ? Number(selectedApi) : undefined,
                  symbol: activeSymbol,
                  replaceId: formOptTempId || undefined,
                  order: {
                    id: String(createdOrderId),
                    side: side.toLowerCase(),
                    price: confirmedPx,
                    amount: Number(orderRes?.amount || formAmt),
                    filled: 0,
                    remaining: Number(orderRes?.amount || formAmt),
                    isSoftwareSL: false,
                    mode: 'LIMIT',
                    isIceberg: Boolean(resolvedIcebergQty && resolvedIcebergQty > 0),
                    icebergQty: resolvedIcebergQty,
                  },
                },
              })
            );
          }
        }
      }
      const aiNote = orderRes?.ai_filter_info ? ` [🤖 ${orderRes.ai_filter_info}]` : '';

      toast.custom(
        (t) => (
          <div
            className={`${t.visible ? 'animate-enter' : 'animate-leave'
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
      }
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
        }
      }, 450);
      setTimeout(() => {
        fetchActiveBrackets(true);
        fetchBalance(true);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
        }
      }, 1500);
    } catch (error: any) {
      if (formOptTempId) {
        window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: formOptTempId, apiKeyId: selectedApi } }));
      }
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
            }}
            className={`absolute inset-0 w-full h-full rounded-full flex items-center justify-center border text-white ${isThermalGuardActive ? '' : 'backdrop-blur-md'} z-[999] transition-all focus:outline-none group ${activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging')
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
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) {
                  (e.currentTarget as HTMLElement).style.animation = 'none';
                  (e.currentTarget as HTMLElement).style.willChange = 'transform';
                }
              }}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${isMinimized ? hudPos.x : modalPos.x}px, ${isMinimized ? hudPos.y : modalPos.y}px, 0)`,
                maxHeight: isMinimized
                  ? undefined
                  : typeof window !== 'undefined'
                    ? (() => {
                      const vh = window.visualViewport?.height || window.innerHeight;
                      const vw = window.visualViewport?.width || window.innerWidth;
                      const isSmall = vh < 920 || vw < 1200;
                      const cap = isSmall ? 720 : 778;
                      return `${Math.max(300, Math.min(cap, Math.round(vh - (isSmall ? 14 : 28))))}px`;
                    })()
                    : '778px',
                willChange: 'transform',
                contain: 'layout paint style',
                backfaceVisibility: 'hidden',
              }}
              className={`cosmo-theme-modal fixed rounded-xl ${isThermalGuardActive ? 'animate-cosmo-modal-fast' : 'animate-cosmo-modal-cyan'
                } ${isMinimized
                  ? isThermalGuardActive
                    ? 'w-[468px] max-w-[calc(100vw-12px)] bg-[#0B0E14]/95 border-cyan-500/45 shadow-[0_10px_28px_rgba(0,0,0,0.9)]'
                    : 'w-[468px] max-w-[calc(100vw-12px)] bg-[#070b14] bg-gradient-to-b from-[#0b1120]/95 via-[#070b14]/[0.98] to-[#05070d]/[0.98] border-cyan-500/40 shadow-[0_10px_32px_rgba(0,0,0,0.85),0_0_20px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl'
                  : isThermalGuardActive
                    ? 'w-[580px] max-w-[calc(100vw-12px)] flex flex-col bg-[#080c16] border-cyan-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
                    : 'w-[580px] max-w-[calc(100vw-12px)] flex flex-col bg-[#070b14] bg-gradient-to-b from-[#0b1120]/95 via-[#070b14]/[0.98] to-[#05070d]/[0.98] border-cyan-500/40 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_24px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
                } border z-[99999] overflow-hidden select-none`}
            >
              <FloatingModalCyberFX color="cyan" isThermalGuard={isThermalGuardActive} />

              {isMinimized ? (() => {
                const hudActivePeg = activeBrackets.find(b => b.status === 'pegging');
                const hudActiveChase = activeBrackets.find(b => b.status === 'chasing');
                const hudHasFuturesPos = Boolean(isFutures && positionData && positionData.amount > 0 && positionData.side !== 'none');
                return (
                /* ULTRA-SLIM SAAS 2-TIER MINIMIZED QUICK TRADE CYBER-HUD */
                <div
                  key="minimized-hud"
                  onMouseDown={handleStartDrag}
                  onTouchStart={handleStartDrag}
                  style={{ touchAction: 'none' }}
                  className="animate-modal-simple-switch relative select-none overflow-hidden"
                >
                  {/* Top Neon Horizon Accent Line */}
                  <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 opacity-85" />

                  <div className="px-2.5 py-1.5 space-y-1.5 relative z-10">
                    {/* Row 1: Single-Line Ultra-Slim Drag Handle & Header */}
                    <div
                      style={{ touchAction: 'none' }}
                      className="flex items-center justify-between gap-1 cursor-grab active:cursor-grabbing select-none"
                      title="Drag to move HUD"
                    >
                      <div className="flex items-center gap-1 min-w-0 pointer-events-none flex-wrap">
                        <GripVertical className="w-3 h-3 text-cyan-400/80 shrink-0" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse shrink-0" />
                        {availablePairs && availablePairs.length > 1 ? (
                          <select
                            value={activePair?.id || availablePairs[0]?.id || ''}
                            onChange={(e) => {
                              const selected = availablePairs.find(p => p.id === e.target.value);
                              if (selected) {
                                handleSelectPair(selected);
                              }
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className="pointer-events-auto bg-[#0a101d] border border-cyan-500/40 hover:border-cyan-400 rounded px-1 py-0.5 text-white font-mono font-black text-[11px] tracking-tight max-w-[100px] truncate focus:outline-none cursor-pointer shrink-0"
                            title="Switch target chart pair"
                          >
                            {availablePairs.map((p, idx) => (
                              <option key={p.id} value={p.id} className="bg-[#070b14] text-white">
                                {p.symbol}{p.isMain ? ' (Main)' : ` (#${idx + 1})`}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-black text-white text-[12px] tracking-tight truncate max-w-[85px]">{activeSymbol}</span>
                        )}
                        <span
                          className={`text-[9px] uppercase px-1 py-0.2 rounded font-mono font-extrabold border leading-tight shrink-0 ${isFutures
                            ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                            : 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                            }`}
                        >
                          {isFutures ? `${leverage}x` : 'SPOT'}
                        </span>
                        {effectiveCurrentPrice > 0 && (
                          <span className="text-emerald-400 font-mono text-[11px] font-bold tracking-tight shrink-0">
                            ${formatDisplayPrice(effectiveCurrentPrice)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const nextType: 'Limit' | 'Market' | 'SmartPeg' =
                              orderType === 'Limit' ? 'Market' : orderType === 'Market' ? 'SmartPeg' : 'Limit';
                            setOrderType(nextType);
                            toast(`Order Mode: ${nextType === 'SmartPeg' ? '⚡ Smart Peg' : nextType}`, {
                              icon: nextType === 'SmartPeg' ? '⚡' : nextType === 'Market' ? '🚀' : '📝',
                              duration: 1800
                            });
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-black uppercase leading-tight shrink-0 pointer-events-auto cursor-pointer transition-all active:scale-95 border ${orderType === 'SmartPeg'
                            ? 'bg-amber-500/25 border-amber-400/60 text-amber-300 hover:bg-amber-500/40'
                            : orderType === 'Market'
                              ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300 hover:bg-cyan-500/35'
                              : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/10 hover:border-cyan-400/40 text-gray-300 hover:text-white'
                            }`}
                          title="Click to switch Order Type: Limit ➔ Market ➔ Smart Peg"
                        >
                          {orderType === 'SmartPeg' ? (smartPegStrategy === 'wall_aware' ? '🧱PEG' : '⚡PEG') : orderType === 'Market' ? 'MKT' : 'LMT'}
                        </button>
                        {(tpConfig.enabled || slConfig.enabled) && (
                          <span className="text-[8.5px] px-1 py-0.2 rounded bg-white/[0.06] border border-white/15 text-gray-300 font-mono font-bold leading-tight shrink-0">
                            {[tpConfig.enabled && 'TP', slConfig.enabled && 'SL'].filter(Boolean).join('+')}
                          </span>
                        )}
                        {(() => {
                          const holdBr = activeBrackets.find(
                            (b) => b?.anti_wick_state === 'holding_dwell' || b?.anti_wick_state === 'holding_candle'
                          );
                          if (!holdBr) return null;
                          return (
                            <span
                              className="text-[9px] px-1 py-0.2 rounded bg-amber-500/30 border border-amber-400/60 text-amber-200 font-mono font-black leading-tight animate-pulse shrink-0"
                              title={holdBr.anti_wick_reason || 'Anti-Wick Stop Guard actively holding against wick'}
                            >
                              🕯️ {Number(holdBr.anti_wick_remaining_sec || 0).toFixed(1)}s
                            </span>
                          );
                        })()}
                        {openLimitOrders.length > 0 && (
                          <span
                            className="text-[9px] px-1 py-0.2 rounded bg-amber-500/25 border border-amber-500/50 text-amber-300 font-mono font-black leading-tight cursor-pointer hover:bg-amber-500/35 shrink-0 pointer-events-auto"
                            title={`${openLimitOrders.length} open limit orders active. Click to view.`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTerminalTab('orders');
                              setIsMinimized(false);
                            }}
                          >
                            {openLimitOrders.length} OPEN
                          </span>
                        )}
                        {hudHasFuturesPos && positionData && (
                          <div
                            className="pointer-events-auto shrink-0"
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <HudLivePositionPnlChip
                              positionData={positionData}
                              effectiveCurrentPrice={effectiveCurrentPrice}
                              hasActiveSoftwareSl={activeBrackets.some((b) => b?.status === 'monitoring')}
                              isBreakevenActivated={activeBrackets.some((b) => b?.status === 'monitoring' && Boolean(b?.breakeven_activated))}
                              isMovingBe={isMovingBreakeven}
                              onMoveToBreakeven={handleMoveToBreakeven}
                            />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {balanceData && (
                          <span
                            className="text-[9px] font-mono text-gray-400 hidden sm:inline max-w-[78px] truncate"
                            title="Available free balance"
                          >
                            {isInverseFutures
                              ? `${(balanceData.base_free || 0).toFixed(2)} ${baseCurrency}`
                              : sizeMode === 'quote' || isFutures || tradeSide === 'Buy'
                                ? `$${(balanceData.quote_free || 0).toFixed(1)}`
                                : `${(balanceData.base_free || 0).toFixed(2)} ${baseCurrency}`}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchBalance(false, true);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`p-1 rounded bg-white/[0.04] hover:bg-white/10 border border-white/[0.07] text-gray-400 hover:text-cyan-300 transition-all cursor-pointer ${isRefreshing ? 'text-cyan-400' : ''}`}
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

                    {/* Row 2: Compact Order Size + 25/50/75/100% + 0-100% Slide Bar */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="rounded-lg bg-slate-50 dark:bg-[#04070e]/90 border border-slate-200 dark:border-white/[0.08] px-2 py-1 space-y-1 shadow-inner dark:shadow-[inset_0_1px_6px_rgba(0,0,0,0.65)]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center bg-[#0a101d] rounded p-0.5 border border-white/10 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSizingMode('standard');
                              setSizeMode('base');
                              if (!selectedPercent) setSize('');
                            }}
                            className={`px-1 py-0.2 rounded text-[9px] font-extrabold transition-all cursor-pointer leading-tight ${sizingMode === 'standard' && sizeMode === 'base'
                              ? 'bg-cyan-500 text-slate-950'
                              : 'text-gray-400 hover:text-white'
                              }`}
                          >
                            {baseCurrency}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSizingMode('standard');
                              setSizeMode('quote');
                              if (!selectedPercent) setSize('');
                            }}
                            className={`px-1 py-0.2 rounded text-[9px] font-extrabold transition-all cursor-pointer leading-tight ${sizingMode === 'standard' && sizeMode === 'quote'
                              ? 'bg-amber-400 text-slate-950'
                              : 'text-gray-400 hover:text-white'
                              }`}
                          >
                            {quoteCurrency}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSizingMode('risk_usd');
                              setSelectedPercent(null);
                              if (!riskAmountInput || Number(riskAmountInput) <= 0) setRiskAmountInput('10');
                            }}
                            className={`px-1 py-0.2 rounded text-[9px] font-extrabold transition-all cursor-pointer leading-tight ${sizingMode === 'risk_usd'
                              ? 'bg-emerald-400 text-slate-950'
                              : 'text-gray-400 hover:text-emerald-300'
                              }`}
                            title="Risk-Based Auto Position Sizing ($ Max Loss)"
                          >
                            R$
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSizingMode('risk_pct');
                              setSelectedPercent(null);
                              if (!riskAmountInput || Number(riskAmountInput) <= 0 || Number(riskAmountInput) > 25) setRiskAmountInput('1');
                            }}
                            className={`px-1 py-0.2 rounded text-[9px] font-extrabold transition-all cursor-pointer leading-tight ${sizingMode === 'risk_pct'
                              ? 'bg-emerald-400 text-slate-950'
                              : 'text-gray-400 hover:text-emerald-300'
                              }`}
                            title="Risk-Based Auto Position Sizing (% of Balance)"
                          >
                            R%
                          </button>
                        </div>

                        {sizingMode === 'standard' ? (
                          <input
                            type="number"
                            value={size}
                            onChange={(e) => {
                              setSize(e.target.value);
                              setSelectedPercent(null);
                            }}
                            placeholder="0.00"
                            className="w-[72px] bg-[#0a101d]/90 border border-white/10 focus:border-cyan-400/60 rounded py-0.5 px-1.5 text-white font-mono text-[11px] font-bold focus:outline-none transition-colors"
                          />
                        ) : (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={riskAmountInput}
                            onChange={(e) => setRiskAmountInput(e.target.value)}
                            placeholder={sizingMode === 'risk_usd' ? '$10' : '1%'}
                            className="w-[62px] bg-[#0a101d]/90 border border-emerald-500/40 focus:border-emerald-400 rounded py-0.5 px-1.5 text-emerald-200 font-mono text-[11px] font-bold focus:outline-none transition-colors"
                            title={sizingMode === 'risk_usd' ? 'Max USD Loss if SL hits' : 'Max % Wallet Balance Risk if SL hits'}
                          />
                        )}

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
                                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-extrabold border transition-all cursor-pointer active:scale-95 leading-tight ${isSelected
                                  ? 'bg-gradient-to-r from-cyan-500/35 to-emerald-500/30 border-cyan-400 text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.35)]'
                                  : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-cyan-500/40 text-gray-400 hover:text-white'
                                  }`}
                              >
                                {pt}%
                              </button>
                            );
                          })}
                        </div>

                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-mono text-[10px] font-black shrink-0 min-w-[34px] text-center leading-tight">
                          {sliderPercentValue}%
                        </span>
                      </div>

                      {/* 0% to 100% Interactive Slide Bar */}
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
                                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border transition-all duration-150 ${isReached
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

                      {sizingMode !== 'standard' && (
                        <RiskSizingSubBar
                          sizeMode={sizingMode}
                          riskInput={riskAmountInput}
                          onSelectRiskPreset={setRiskAmountInput}
                          riskCalc={riskSizing}
                          baseCurrency={baseCurrency}
                          quoteCurrency={quoteCurrency}
                          formatDisplayPrice={formatDisplayPrice}
                          compact
                        />
                      )}
                    </div>

                    {/* Row 3: Unified Execution + Drag-to-Chart TP/SL Bar */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="flex items-center gap-1"
                    >
                      <div className="flex items-center bg-[#050811] rounded-lg p-0.5 border border-white/10 shrink-0 shadow-inner">
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleOrderPointerDown(e, 'Buy');
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (didOrderDragRef.current) {
                              didOrderDragRef.current = false;
                              return;
                            }
                            handleSideChange('Buy');
                          }}
                          style={{ touchAction: 'none' }}
                          className={`px-2 py-1.5 rounded-md font-mono text-[10px] font-black uppercase tracking-wider transition-all cursor-grab active:cursor-grabbing leading-none select-none ${tradeSide === 'Buy'
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.5)] border border-emerald-400/50'
                            : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                            }`}
                          title="Click to select BUY, or Touch/Drag onto chart to place BUY at price level"
                        >
                          {isFutures ? 'LONG' : 'BUY'}
                        </button>
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleOrderPointerDown(e, 'Sell');
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (didOrderDragRef.current) {
                              didOrderDragRef.current = false;
                              return;
                            }
                            handleSideChange('Sell');
                          }}
                          style={{ touchAction: 'none' }}
                          className={`px-2 py-1.5 rounded-md font-mono text-[10px] font-black uppercase tracking-wider transition-all cursor-grab active:cursor-grabbing leading-none select-none ${tradeSide === 'Sell'
                            ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.5)] border border-rose-400/50'
                            : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                            }`}
                          title="Click to select SELL, or Touch/Drag onto chart to place SELL at price level"
                        >
                          {isFutures ? 'SHORT' : 'SELL'}
                        </button>
                      </div>

                      {/* Primary Execute / Drag Order CTA */}
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handleOrderPointerDown(e, tradeSide);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (didOrderDragRef.current) {
                            didOrderDragRef.current = false;
                            return;
                          }
                          handleTrade(tradeSide);
                        }}
                        style={{ touchAction: 'none' }}
                        className={`relative flex-1 min-w-0 overflow-hidden py-1.5 px-2 rounded-lg font-bold flex items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-50 select-none cursor-grab active:cursor-grabbing group shadow-sm ${tradeSide === 'Buy'
                          ? orderType === 'SmartPeg'
                            ? 'bg-gradient-to-r from-amber-600/35 via-emerald-600/35 to-green-700/40 hover:from-amber-600 hover:to-green-600 text-emerald-300 hover:text-white border border-emerald-400/60'
                            : 'bg-emerald-500/15 dark:bg-gradient-to-b dark:from-emerald-500/30 dark:via-emerald-600/25 dark:to-green-900/40 hover:bg-emerald-500 dark:hover:from-emerald-500 dark:hover:to-green-700 text-emerald-700 dark:text-emerald-300 hover:text-white border border-emerald-500/40 dark:border-emerald-400/50'
                          : orderType === 'SmartPeg'
                            ? 'bg-gradient-to-r from-amber-600/35 via-rose-600/35 to-red-700/40 hover:from-amber-600 hover:to-red-600 text-rose-300 hover:text-white border border-rose-400/60'
                            : 'bg-rose-500/15 dark:bg-gradient-to-b dark:from-rose-500/30 dark:via-rose-600/25 dark:to-red-900/40 hover:bg-rose-500 dark:hover:from-rose-500 dark:hover:to-red-700 text-rose-700 dark:text-rose-300 hover:text-white border border-rose-500/40 dark:border-rose-400/50'
                          }`}
                        title={`Click for instant ${orderType} ${tradeSide}, or Touch/Drag onto chart to place at price level`}
                      >
                        {isSubmitting ? (
                          <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                        ) : orderType === 'SmartPeg' ? (
                          <Zap className="w-3 h-3 text-amber-300 fill-amber-300 shrink-0" />
                        ) : tradeSide === 'Buy' ? (
                          <TrendingUp className="w-3 h-3 text-emerald-600 dark:text-emerald-400 group-hover:text-white shrink-0" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-rose-600 dark:text-rose-400 group-hover:text-white shrink-0" />
                        )}

                        <span className="text-[11px] uppercase tracking-wider font-black leading-none truncate">
                          {isSubmitting
                            ? '...'
                            : orderType === 'SmartPeg'
                              ? `PEG ${tradeSide === 'Buy' ? (isFutures ? 'LONG' : 'BUY') : (isFutures ? 'SHORT' : 'SELL')}`
                              : orderType === 'Market'
                                ? `MKT ${tradeSide === 'Buy' ? (isFutures ? 'LONG' : 'BUY') : (isFutures ? 'SHORT' : 'SELL')}`
                                : `LMT ${tradeSide === 'Buy' ? (isFutures ? 'LONG' : 'BUY') : (isFutures ? 'SHORT' : 'SELL')}`}
                        </span>

                        {size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                          <span className="text-[9.5px] font-mono text-white/90 group-hover:text-white font-semibold truncate shrink-0">
                            • ${sizeMode === 'quote' ? Number(size).toFixed(0) : (Number(size) * effectiveOrderPrice).toFixed(0)}
                          </span>
                        )}
                        <MoveVertical className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
                      </button>

                      {/* Inline Drag-to-Chart TP & SL Handles */}
                      <div
                        data-no-drag="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startLineDrag(e, 'tp');
                        }}
                        style={{ touchAction: 'none' }}
                        className="py-1.5 px-2 rounded-lg border border-emerald-400/45 hover:border-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300 flex items-center gap-1 font-mono text-[9.5px] font-black select-none transition-all cursor-grab active:cursor-grabbing shrink-0"
                        title={`Drag onto chart to place Take Profit (${tpConfig.orderType})`}
                      >
                        <Target className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>TP</span>
                      </div>
                      <div
                        data-no-drag="true"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startLineDrag(e, 'sl');
                        }}
                        style={{ touchAction: 'none' }}
                        className="py-1.5 px-2 rounded-lg border border-rose-400/45 hover:border-rose-300 bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 flex items-center gap-1 font-mono text-[9.5px] font-black select-none transition-all cursor-grab active:cursor-grabbing shrink-0"
                        title={`Drag onto chart to place Stop Loss (${slConfig.type === 'smart_chase' ? 'Smart Chase' : slConfig.type})`}
                      >
                        <ShieldAlert className="w-3 h-3 text-rose-400 shrink-0" />
                        <span>SL</span>
                      </div>
                    </div>

                    <HudCompactPnlStrip preview={tradePnlPreview} />

                    {/* Compact AI Shield Rejection Notice (Visible in Minimized HUD) */}
                    {aiRejectNotice && (
                      <div
                        data-no-drag="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="px-2 py-1 rounded-lg bg-amber-950/60 border border-amber-500/45 flex items-center justify-between gap-2 text-[9.5px] font-mono text-amber-200"
                      >
                        <span className="flex items-center gap-1 min-w-0 truncate">
                          <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
                          <strong className="text-amber-300 shrink-0">{aiRejectNotice.side} Blocked:</strong>
                          <span className="truncate">{aiRejectNotice.calibratedProb.toFixed(0)}% &lt; {aiRejectNotice.threshold.toFixed(0)}% • {aiRejectNotice.reason}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setAiRejectNotice(null)}
                          className="text-amber-300 hover:text-white shrink-0 cursor-pointer"
                          title="Dismiss"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Row 4: Ultra-Slim Tactical Drawer Switcher (Keeps HUD ~145px until expanded) */}
                    <div
                      data-no-drag="true"
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="flex items-center justify-between gap-1 pt-0.5 border-t border-white/[0.06]"
                    >
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setHudDrawer((prev) => (prev === 'wall' ? 'none' : 'wall'));
                            if (!wallMagnetEnabled && effectiveWalls.length === 0) {
                              fetchNearestWalls();
                            }
                          }}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                            hudDrawer === 'wall' || wallMagnetEnabled
                              ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                              : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-400 hover:text-white'
                          }`}
                          title="Toggle Wall Magnet & Limit Price Quick Snap Drawer"
                        >
                          <Magnet className="w-2.5 h-2.5" />
                          <span>Wall</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setHudDrawer((prev) => (prev === 'ai' ? 'none' : 'ai'))}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                            hudDrawer === 'ai' || mlFilterConfig.enabled
                              ? 'bg-blue-500/25 border-blue-400/60 text-blue-200'
                              : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-400 hover:text-white'
                          }`}
                          title="Toggle AI Entry Filter & Live Gauge"
                        >
                          <span>🤖 AI {mlFilterConfig.enabled ? 'ON' : ''}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setHudDrawer((prev) => (prev === 'force' ? 'none' : 'force'))}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                            hudDrawer === 'force'
                              ? 'bg-rose-500/25 border-rose-400/60 text-rose-200'
                              : forceOrderTargets.length > 0
                                ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                                : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 text-gray-400 hover:text-white'
                          }`}
                          title="Toggle Emergency Force Buy/Sell (0% Maker / Market)"
                        >
                          <Zap className="w-2.5 h-2.5 text-amber-400" />
                          <span>Force{forceOrderTargets.length > 0 ? ` (${forceOrderTargets.length})` : ''}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        {hudActivePeg && (
                          <button
                            type="button"
                            disabled={isStoppingPeg}
                            onClick={() => handleStopSmartPeg(hudActivePeg)}
                            className="px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-mono text-[8.5px] font-black uppercase cursor-pointer"
                          >
                            ⏹ Stop Peg
                          </button>
                        )}
                        {!hudActivePeg && hudActiveChase && (
                          <button
                            type="button"
                            disabled={isStoppingChase}
                            onClick={() => handleStopSmartChase(hudActiveChase)}
                            className="px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-mono text-[8.5px] font-black uppercase cursor-pointer"
                          >
                            ⏹ Stop Chase
                          </button>
                        )}
                        {hudDrawer !== 'none' && (
                          <button
                            type="button"
                            onClick={() => setHudDrawer('none')}
                            className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[9px] font-mono cursor-pointer"
                            title="Collapse drawer"
                          >
                            ▲
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable Tactical Drawers inside Minimized HUD */}
                    {hudDrawer === 'wall' && (
                      <div
                        data-no-drag="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="space-y-1.5"
                      >
                        {orderType === 'Limit' && (
                          <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-[#04070e]/90 border border-cyan-500/25">
                            <button
                              type="button"
                              onClick={() => {
                                const nextAuto = !isAutoLimit;
                                setIsAutoLimit(nextAuto);
                                if (nextAuto && !isFutures) setUseNativeTpSl(false);
                                else if (!nextAuto && (!limitPrice || Number(limitPrice) <= 0) && effectiveCurrentPrice > 0) {
                                  setLimitPrice(effectiveCurrentPrice.toString());
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black border cursor-pointer shrink-0 ${isAutoLimit
                                ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                                : 'bg-white/5 border-white/15 text-gray-400 hover:text-white'
                                }`}
                              title="Toggle Auto Best Limit (BBO Post-Only Maker)"
                            >
                              {isAutoLimit ? '⚡ BBO ON' : 'MANUAL PX'}
                            </button>
                            {!isAutoLimit ? (
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <input
                                  type="number"
                                  value={limitPrice}
                                  onChange={(e) => setLimitPrice(e.target.value)}
                                  placeholder="Limit Price"
                                  className="flex-1 min-w-0 bg-[#0a101d] border border-white/15 focus:border-cyan-400 rounded px-1.5 py-0.5 text-white font-mono text-[10.5px] font-bold focus:outline-none"
                                />
                                {effectiveCurrentPrice > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setLimitPrice(effectiveCurrentPrice.toString())}
                                    className="px-1.5 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/35 text-cyan-300 font-mono text-[9px] font-bold cursor-pointer shrink-0"
                                  >
                                    Live
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span className="text-[9.5px] font-mono text-gray-400 truncate">
                                Snipes Best Bid/Ask at 0% Maker Fee
                              </span>
                            )}
                          </div>
                        )}
                        <HudWallMagnetBar
                          wallTargets={wallTargets}
                          frontRunTicks={smartPegFrontRunTicks}
                          orderType={orderType}
                          isAutoLimit={isAutoLimit}
                          limitPrice={limitPrice}
                          smartPegAnchorPrice={smartPegAnchorPrice}
                          smartPegStrategy={smartPegStrategy}
                          smartPegAntiSpoof={smartPegAntiSpoof}
                          isFetchingWalls={isFetchingWalls}
                          formatDisplayPrice={formatDisplayPrice}
                          onSnapLimitToWall={handleSnapLimitToWall}
                          onClearPinnedPrice={handleClearPinnedPrice}
                          onCyclePegStrategy={handleCyclePegStrategy}
                          onRefreshWalls={fetchNearestWalls}
                        />
                      </div>
                    )}

                    {hudDrawer === 'ai' && (
                      <div
                        data-no-drag="true"
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="space-y-1.5"
                      >
                        <div
                          className={`flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border transition-all ${mlFilterConfig.enabled
                            ? 'bg-blue-950/40 border-blue-500/45'
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
                            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-extrabold uppercase tracking-wider border transition-all cursor-pointer shrink-0 ${mlFilterConfig.enabled
                              ? 'bg-blue-600/30 border-blue-400 text-blue-200'
                              : 'bg-black/40 border-white/15 text-gray-400 hover:text-white'
                              }`}
                          >
                            🤖 AI {mlFilterConfig.enabled ? 'ON' : 'OFF'}
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
                              className="w-full appearance-none bg-[#050811]/95 text-blue-200 font-mono text-[10px] font-bold rounded border border-blue-500/30 pl-1.5 pr-4 py-0.5 truncate cursor-pointer focus:outline-none"
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
                            <span className="text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-black/50 border border-blue-500/30 text-blue-300 shrink-0">
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
                            className="p-0.5 rounded bg-white/[0.04] hover:bg-white/10 border border-white/10 text-gray-400 hover:text-blue-300 cursor-pointer shrink-0"
                            title="Refresh ML Models"
                          >
                            <RefreshCw className={`w-2.5 h-2.5 ${isLoadingMlModels ? 'animate-spin text-blue-400' : ''}`} />
                          </button>
                        </div>

                        {mlFilterConfig.enabled && mlLivePreview && (
                          <HudLiveAiMicroGauge
                            preview={mlLivePreview}
                            tradeSide={tradeSide}
                            bullishThreshold={mlFilterConfig.bullishThreshold}
                            bearishThreshold={mlFilterConfig.bearishThreshold}
                            compact
                          />
                        )}
                      </div>
                    )}

                    {hudDrawer === 'force' && (
                      <ForceExecutionPanel
                        forceOrderTargets={forceOrderTargets}
                        selectedForceOrderId={selectedForceOrderId}
                        onSelectForceOrderId={(id, choseAll) => {
                          userChoseAllForceRef.current = choseAll;
                          setSelectedForceOrderId(id);
                        }}
                        selectedForceTarget={selectedForceTarget}
                        emergencyMode={emergencyMode}
                        onChangeEmergencyMode={setEmergencyMode}
                        isEmergencySubmitting={isEmergencySubmitting}
                        emergencySubmittingSide={emergencySubmittingSide}
                        cancellingOrderId={cancellingOrderId}
                        isCancellingAll={isCancellingAll}
                        isClosingPosition={isClosingPosition}
                        isStoppingPeg={isStoppingPeg}
                        isStoppingChase={isStoppingChase}
                        hasActiveFuturesPos={hudHasFuturesPos}
                        positionSide={positionData?.side}
                        positionAmount={positionData?.amount}
                        activePeg={hudActivePeg}
                        activeChase={hudActiveChase}
                        baseCurrency={baseCurrency}
                        effectiveCurrentPrice={effectiveCurrentPrice}
                        sliderPercentValue={sliderPercentValue}
                        onRefreshOrders={() => fetchActiveBrackets(true)}
                        onCancelOrder={handleCancelOrder}
                        onCancelAllOrders={handleCancelAllOrders}
                        onClosePosition={handleClosePosition}
                        onStopSmartPeg={handleStopSmartPeg}
                        onStopSmartChase={handleStopSmartChase}
                        onForceTrade={handleEmergencyForceTrade}
                        compact
                      />
                    )}
                  </div>
                </div>
                );
              })() : (() => {
                const activePeg = activeBrackets.find(b => b.status === 'pegging');
                const activeChase = activeBrackets.find(b => b.status === 'chasing');
                const activeSoftwareSls = activeBrackets.filter(b => b.status === 'monitoring' && (b.type === 'smart_chase' || b.type === 'trailing_chase' || b.type === 'trailing' || b.auto_breakeven_enabled));
                const hasActiveFuturesPos = Boolean(isFutures && positionData && positionData.amount > 0 && positionData.side !== 'none');
                const ordersBadgeCount = openLimitOrders.length + activeSoftwareSls.length + (activePeg ? 1 : 0) + (activeChase ? 1 : 0) + (hasActiveFuturesPos ? 1 : 0);

                return (
                  <div key="full-terminal" className="animate-modal-simple-switch flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Top Neon Horizon Accent Line (matching Minimized Cyber-HUD) */}
                    <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-emerald-400 opacity-85 shrink-0" />

                    {/* Unified SaaS Command Header (Draggable Handle) */}
                    <div
                      onMouseDown={handleStartDrag}
                      onTouchStart={handleStartDrag}
                      style={{ touchAction: 'none' }}
                      className="flex items-center justify-between px-3 py-2 border-b border-cyan-500/20 bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0 gap-2"
                      title="Drag to move terminal"
                    >
                      <div className="flex items-center gap-1.5 pointer-events-none min-w-0 flex-1 overflow-hidden">
                        <GripVertical className="w-3.5 h-3.5 text-cyan-400/80 shrink-0" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)] animate-pulse shrink-0" />
                        {availablePairs && availablePairs.length > 1 ? (
                          <select
                            value={activePair?.id || availablePairs[0]?.id || ''}
                            onChange={(e) => {
                              const selected = availablePairs.find(p => p.id === e.target.value);
                              if (selected) handleSelectPair(selected);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                            className="pointer-events-auto bg-[#0a101d] border border-cyan-500/35 hover:border-cyan-400 rounded-md py-0.5 pl-1.5 pr-5 text-white font-mono font-black text-[13px] tracking-tight max-w-[140px] truncate focus:outline-none cursor-pointer shrink-0"
                            title="Switch active chart symbol"
                          >
                            {availablePairs.map((p, idx) => {
                              const duplicateCount = availablePairs.filter(item => item.symbol === p.symbol).length;
                              const chartSuffix = p.isMain ? ' (Main)' : duplicateCount > 1 ? ` (#${idx + 1})` : '';
                              return (
                                <option key={p.id} value={p.id} className="bg-[#070b14] text-white">
                                  {p.symbol}{chartSuffix}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <span className="font-black text-white text-[14px] tracking-tight truncate max-w-[125px]">
                            {activeSymbol}
                          </span>
                        )}

                        {isFutures ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowFuturesPopover(prev => !prev);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`pointer-events-auto text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-black border leading-tight shrink-0 cursor-pointer transition-all flex items-center gap-1 ${showFuturesPopover
                              ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                              : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/45 text-amber-300'
                              }`}
                            title="Click to configure Margin Mode, Leverage & Reduce-Only"
                          >
                            <span>{leverage}x {marginMode === 'cross' ? 'CROSS' : 'ISO'}</span>
                            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showFuturesPopover ? 'rotate-180' : ''}`} />
                          </button>
                        ) : (
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-black border leading-tight shrink-0 bg-cyan-500/20 border-cyan-400/40 text-cyan-300">
                            SPOT
                          </span>
                        )}

                        {effectiveCurrentPrice > 0 && (
                          <span className="text-emerald-400 font-mono text-[12px] font-extrabold tracking-tight shrink-0">
                            ${formatDisplayPrice(effectiveCurrentPrice)}
                          </span>
                        )}

                        {(() => {
                          const holdBr = activeBrackets.find(
                            (b) => b?.anti_wick_state === 'holding_dwell' || b?.anti_wick_state === 'holding_candle'
                          );
                          if (!holdBr) return null;
                          return (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/30 border border-amber-400/60 text-amber-200 font-mono font-black leading-tight animate-pulse shrink-0"
                              title={holdBr.anti_wick_reason || 'Anti-Wick Stop Guard holding against wick'}
                            >
                              🕯️ {Number(holdBr.anti_wick_remaining_sec || 0).toFixed(1)}s
                            </span>
                          );
                        })()}

                        {hasActiveFuturesPos && positionData && (
                          <div className="pointer-events-auto shrink-0" onPointerDown={(e) => e.stopPropagation()}>
                            <HudLivePositionPnlChip
                              positionData={positionData}
                              effectiveCurrentPrice={effectiveCurrentPrice}
                              hasActiveSoftwareSl={activeBrackets.some((b) => b?.status === 'monitoring')}
                              isBreakevenActivated={activeBrackets.some((b) => b?.status === 'monitoring' && Boolean(b?.breakeven_activated))}
                              isMovingBe={isMovingBreakeven}
                              onMoveToBreakeven={handleMoveToBreakeven}
                            />
                          </div>
                        )}

                        {ordersBadgeCount > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveTerminalTab('orders');
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="text-[8.5px] px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-500/50 text-amber-300 font-mono font-black leading-tight cursor-pointer hover:bg-amber-500/35 shrink-0 pointer-events-auto"
                            title="Jump to Orders & Force Execution"
                          >
                            {ordersBadgeCount} LIVE
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fetchBalance(false, true);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`p-1 rounded-md bg-white/[0.04] hover:bg-white/10 border border-white/[0.08] text-gray-400 hover:text-cyan-300 transition-all cursor-pointer ${isRefreshing ? 'text-cyan-400' : ''}`}
                          title="Refresh Balance, Orders & Position"
                        >
                          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMinimized(true);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="px-1.5 py-1 rounded-md bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 hover:text-white transition-all cursor-pointer flex items-center gap-1 font-mono text-[9.5px] font-black uppercase"
                          title="Minimize to Compact Quick-Trade Cyber-HUD"
                        >
                          <Minus className="w-3 h-3" />
                          <span>HUD</span>
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
                          className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer"
                          title="Close"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Quick Collapsible Futures Leverage & Margin Bar (Toggled from Header Badge) */}
                    {isFutures && showFuturesPopover && (
                      <div className="px-3 py-2 bg-[#060b16] border-b border-amber-500/25 space-y-2 shrink-0 animate-fadeIn">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex bg-black/60 rounded-md p-0.5 border border-white/10">
                            <button
                              type="button"
                              onClick={() => setMarginMode('cross')}
                              className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${marginMode === 'cross' ? 'bg-cyan-500 text-slate-950' : 'text-gray-400 hover:text-white'}`}
                            >
                              CROSS
                            </button>
                            <button
                              type="button"
                              onClick={() => setMarginMode('isolated')}
                              className={`px-2 py-0.5 rounded text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${marginMode === 'isolated' ? 'bg-cyan-500 text-slate-950' : 'text-gray-400 hover:text-white'}`}
                            >
                              ISOLATED
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <label className="flex items-center space-x-1.5 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={reduceOnly}
                                onChange={(e) => setReduceOnly(e.target.checked)}
                                className="form-checkbox bg-black/40 border-white/20 text-cyan-400 rounded focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
                              />
                              <span className="text-[10.5px] font-mono text-gray-300 group-hover:text-white">Reduce-Only</span>
                            </label>
                            <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-400/40 px-2 py-0.5 rounded font-mono font-black">
                              {leverage}x
                            </span>
                          </div>
                        </div>

                        <input
                          type="range"
                          min="1"
                          max="125"
                          value={leverage}
                          onChange={(e) => setLeverage(Number(e.target.value))}
                          className="w-full accent-amber-400 h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer"
                        />
                      </div>
                    )}

                    {/* Slim Account & Live Balance Telemetry Bar */}
                    <div className="px-3 py-1.5 bg-[#04070e]/90 border-b border-white/10 shrink-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        {/* Compact API Key Selector */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-1 max-w-[235px]">
                          <KeyRound className="w-3 h-3 text-cyan-400/80 shrink-0" />
                          <div className="relative flex-1 min-w-0">
                            <select
                              value={selectedApi}
                              onChange={(e) => {
                                const nextId = e.target.value;
                                setSelectedApi(nextId);
                                onApiKeyChange?.(nextId);
                                try {
                                  localStorage.setItem('cosmo_manual_selected_api_v1', nextId);
                                } catch { }
                              }}
                              className="w-full bg-[#0a101d] border border-white/10 hover:border-cyan-500/40 rounded-md py-0.5 pl-2 pr-6 text-white text-[11px] font-mono font-semibold focus:outline-none focus:border-cyan-400/60 transition-colors appearance-none cursor-pointer truncate"
                              title="Active Execution API Account"
                            >
                              {apiKeys.map(k => (
                                <option key={k.id} value={k.id} className="bg-[#070b14]">
                                  {k.name || k.label || k.key_name || `${k.exchange?.toUpperCase()} — Key #${k.id}`}
                                </option>
                              ))}
                              {apiKeys.length === 0 && <option value="" disabled>No API Keys found</option>}
                            </select>
                            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-cyan-400/70 pointer-events-none" />
                          </div>
                        </div>

                        {/* Live Free / Locked / Position Telemetry */}
                        <div className="flex items-center gap-2 text-[10.5px] font-mono ml-auto flex-wrap justify-end">
                          <span className="flex items-center gap-1 text-gray-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title={`Live Auto-Sync Active (${(timings.balancePollMs / 1000).toFixed(1)}s)`} />
                            <span>Bal:</span>
                            <strong className="text-cyan-200">
                              {isLoadingBalance && !balanceData ? "..." : balanceData ? (
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
                            </strong>
                          </span>

                          {balanceData && (() => {
                            const isQuoteTarget = !isInverseFutures && (sizeMode === 'quote' || (isFutures ? true : tradeSide === 'Buy'));
                            const lockedAmount = isQuoteTarget ? (balanceData.quote_used || 0) : (balanceData.base_used || 0);
                            const curr = isQuoteTarget ? quoteCurrency : baseCurrency;
                            if (lockedAmount <= 0) return null;
                            return (
                              <span className="text-amber-400">
                                Lock: <strong>{isQuoteTarget ? lockedAmount.toFixed(2) : lockedAmount.toFixed(4)} {curr}</strong>
                              </span>
                            );
                          })()}

                          {isFutures && reduceOnly && (
                            <span className="text-cyan-300">
                              Pos: {isLoadingPosition ? "..." : (positionData && positionData.amount > 0 ? (
                                isInverseFutures && positionData.contracts
                                  ? `${positionData.contracts} Cont`
                                  : `${positionData.amount} (${positionData.side.toUpperCase()})`
                              ) : "0")}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* COIN-M Wallet Diagnostic Alerts */}
                      {isInverseFutures && (balanceData?.base_free || 0) === 0 && Boolean(balanceData?.usds_futures_free && balanceData.usds_futures_free > 0) && (
                        <div className="text-[10px] text-amber-300 font-mono flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          <span>⚠️ {balanceData?.usds_futures_free?.toFixed(2)} in USDⓈ-M! Transfer to COIN-M</span>
                        </div>
                      )}
                      {isInverseFutures && (balanceData?.base_free || 0) === 0 && Boolean(balanceData?.spot_free && balanceData.spot_free > 0) && (
                        <div className="text-[10px] text-amber-300 font-mono flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          <span>⚠️ {balanceData?.spot_free?.toFixed(2)} in Spot! Transfer to COIN-M</span>
                        </div>
                      )}

                      {/* Active Peg / Chase / Position Quick Banner */}
                      {(activePeg || activeChase || hasActiveFuturesPos) && (
                        <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-cyan-950/30 border border-cyan-500/25 text-[10px] font-mono">
                          {activePeg ? (
                            <>
                              <span className="text-amber-300 font-bold flex items-center gap-1 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                                ⚡ Peg #{activePeg.current_attempt || 1} @ {activePeg.current_maker_price || 'Book'}
                              </span>
                              <button
                                type="button"
                                disabled={isStoppingPeg}
                                onClick={() => handleStopSmartPeg(activePeg)}
                                className="px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-black uppercase text-[9px] cursor-pointer shrink-0 disabled:opacity-50"
                              >
                                {isStoppingPeg ? 'Stopping...' : 'Stop Peg'}
                              </button>
                            </>
                          ) : activeChase ? (
                            <>
                              <span className="text-rose-300 font-bold flex items-center gap-1 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                                ⚡ Chase SL #{activeChase.current_attempt || 1} ({activeChase.amount})
                              </span>
                              <button
                                type="button"
                                disabled={isStoppingChase}
                                onClick={() => handleStopSmartChase(activeChase)}
                                className="px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-black uppercase text-[9px] cursor-pointer shrink-0 disabled:opacity-50"
                              >
                                {isStoppingChase ? 'Stopping...' : 'Stop Chase'}
                              </button>
                            </>
                          ) : hasActiveFuturesPos && positionData ? (
                            <>
                              <span className="text-cyan-200 font-bold flex items-center gap-1 truncate">
                                <span className={`w-1.5 h-1.5 rounded-full ${positionData.side.toLowerCase() === 'long' ? 'bg-emerald-400' : 'bg-rose-400'} animate-pulse`} />
                                POS {positionData.side.toUpperCase()}: {positionData.amount} {baseCurrency}
                              </span>
                              <button
                                type="button"
                                disabled={isClosingPosition}
                                onClick={handleClosePosition}
                                className="px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white font-black uppercase text-[9px] cursor-pointer shrink-0 disabled:opacity-50"
                              >
                                {isClosingPosition ? 'Closing...' : 'Close Pos'}
                              </button>
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>

                    {/* 4-Tab SaaS Navigation Bar */}
                    <div className="flex gap-1 px-3 py-1.5 border-b border-white/10 bg-[#050811]/85 shrink-0 overflow-x-auto hide-scrollbar">
                      <button
                        type="button"
                        onClick={() => setActiveTerminalTab('order')}
                        className={`flex-1 px-2 py-1 text-[10px] font-black tracking-wide uppercase rounded-md transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 ${activeTerminalTab === 'order'
                          ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                          }`}
                      >
                        <span>⚡ Trade</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTerminalTab('brackets')}
                        className={`flex-1 px-2 py-1 text-[10px] font-black tracking-wide uppercase rounded-md transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 ${activeTerminalTab === 'brackets'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                          }`}
                      >
                        <span>🎯 TP / SL</span>
                        {(tpConfig.enabled || slConfig.enabled) && (
                          <span className="flex items-center gap-0.5">
                            {tpConfig.enabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                            {slConfig.enabled && <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTerminalTab('ai')}
                        className={`flex-1 px-2 py-1 text-[10px] font-black tracking-wide uppercase rounded-md transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 ${activeTerminalTab === 'ai'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-400/50 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                          }`}
                      >
                        <span>🤖 AI Shield</span>
                        {mlFilterConfig.enabled && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTerminalTab('orders')}
                        className={`flex-1 px-2 py-1 text-[10px] font-black tracking-wide uppercase rounded-md transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-1 ${activeTerminalTab === 'orders'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                          : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                          }`}
                      >
                        <span>📋 Orders & Force</span>
                        {ordersBadgeCount > 0 && (
                          <span className="px-1 py-0.2 rounded bg-amber-500/30 text-amber-200 font-mono text-[9px] leading-none">
                            {ordersBadgeCount}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Scrollable Tab Workspace */}
                    <div
                      style={{ touchAction: 'pan-y' }}
                      className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 space-y-2.5 cursor-default [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-cyan-500/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-cyan-400/40"
                    >
                      {/* TAB 4: ORDERS, ACTIVE BRACKETS, POSITION & FORCE EXECUTION */}
                      {activeTerminalTab === 'orders' && (
                        <div className="space-y-2.5 animate-fadeIn">
                          <ForceExecutionPanel
                            forceOrderTargets={forceOrderTargets}
                            selectedForceOrderId={selectedForceOrderId}
                            onSelectForceOrderId={(id, choseAll) => {
                              userChoseAllForceRef.current = choseAll;
                              setSelectedForceOrderId(id);
                            }}
                            selectedForceTarget={selectedForceTarget}
                            emergencyMode={emergencyMode}
                            onChangeEmergencyMode={setEmergencyMode}
                            isEmergencySubmitting={isEmergencySubmitting}
                            emergencySubmittingSide={emergencySubmittingSide}
                            cancellingOrderId={cancellingOrderId}
                            isCancellingAll={isCancellingAll}
                            isClosingPosition={isClosingPosition}
                            isStoppingPeg={isStoppingPeg}
                            isStoppingChase={isStoppingChase}
                            hasActiveFuturesPos={hasActiveFuturesPos}
                            positionSide={positionData?.side}
                            positionAmount={positionData?.amount}
                            activePeg={activePeg}
                            activeChase={activeChase}
                            baseCurrency={baseCurrency}
                            effectiveCurrentPrice={effectiveCurrentPrice}
                            sliderPercentValue={sliderPercentValue}
                            onRefreshOrders={() => fetchActiveBrackets(true)}
                            onCancelOrder={handleCancelOrder}
                            onCancelAllOrders={handleCancelAllOrders}
                            onClosePosition={handleClosePosition}
                            onStopSmartPeg={handleStopSmartPeg}
                            onStopSmartChase={handleStopSmartChase}
                            onForceTrade={handleEmergencyForceTrade}
                          />

                          {activePeg && (
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-950/90 via-black to-amber-950/40 border border-amber-500/50 shadow-[0_0_16px_rgba(245,158,11,0.2)] flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                  </span>
                                  <span className="text-[12px] font-black tracking-wide text-amber-200 uppercase flex items-center gap-1">
                                    <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                    Smart Peg Entry Active
                                  </span>
                                  {activePeg.peg_strategy === 'wall_aware' && (
                                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-orange-500/25 text-orange-200 border border-orange-400/45 font-bold">
                                      🧱 Wall Front-Run
                                    </span>
                                  )}
                                  {activePeg.peg_strategy === 'inside_spread' && (
                                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 font-bold">
                                      🎯 Inside-Spread
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                  Attempt {activePeg.current_attempt || 1}/{activePeg.max_attempts ? activePeg.max_attempts : '∞'}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-black/60 p-2 rounded-lg border border-white/5 font-mono">
                                <div className="text-left">
                                  <span className="text-gray-400 block text-[9.5px] uppercase">Side</span>
                                  <span className={`font-bold ${activePeg.side?.toLowerCase() === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                                    {activePeg.side?.toUpperCase()} (Maker)
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-gray-400 block text-[9.5px] uppercase">Best Maker Price</span>
                                  <span className="text-amber-300 font-bold">{activePeg.current_maker_price || 'Active'}</span>
                                </div>
                                <div className="text-left col-span-2 pt-1 border-t border-white/5 flex justify-between text-[10px]">
                                  <span className="text-gray-400">Target Size / Filled:</span>
                                  <span className="text-gray-200 font-semibold">{activePeg.filled_amount || 0} / {activePeg.amount}</span>
                                </div>
                                {activePeg.tracked_wall?.price && (
                                  <div className="text-left col-span-2 pt-1 border-t border-white/5 flex justify-between text-[10px]">
                                    <span className="text-amber-300/90">🧱 Shadowing Whale Wall:</span>
                                    <span className="text-amber-200 font-bold">
                                      ${formatDisplayPrice(activePeg.tracked_wall.price)} ({Number(activePeg.tracked_wall.size || 0).toLocaleString()})
                                    </span>
                                  </div>
                                )}
                              </div>

                              <button
                                type="button"
                                disabled={isStoppingPeg}
                                onClick={() => handleStopSmartPeg(activePeg)}
                                className="w-full py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-[12px] uppercase tracking-wider shadow-[0_0_12px_rgba(239,68,68,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                              >
                                <Square className="w-3 h-3 fill-white" />
                                {isStoppingPeg ? 'Stopping Peg...' : 'Stop Smart Peg Entry'}
                              </button>
                            </div>
                          )}

                          {activeChase && (
                            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-950/90 via-amber-950/70 to-black border border-red-500/50 shadow-[0_0_16px_rgba(239,68,68,0.2)] flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                  </span>
                                  <span className="text-[12px] font-black tracking-wide text-red-200 uppercase flex items-center gap-1">
                                    <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                    {activeChase.chase_mode === 'dynamic_bbo' ? 'Dynamic BBO Peg Chasing' : 'Smart Chase SL Chasing'}
                                  </span>
                                </div>
                                <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                  Attempt {activeChase.current_attempt || 1}/{activeChase.max_attempts ? activeChase.max_attempts : '∞'}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5 text-[11px] bg-black/60 p-2 rounded-lg border border-white/5 font-mono">
                                <div className="text-left">
                                  <span className="text-gray-400 block text-[9.5px] uppercase">SL Trigger</span>
                                  <span className="text-white font-bold">
                                    {activeChase.trigger_price || '—'}
                                    {activeChase.trigger_source && (
                                      <span className="text-[9.5px] text-cyan-300 font-normal ml-1">
                                        ({activeChase.trigger_source === 'bid_ask' ? '⚡ Bid/Ask' : '📊 Last'})
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-gray-400 block text-[9.5px] uppercase">Maker Price</span>
                                  <span className="text-amber-300 font-bold">{activeChase.current_maker_price || 'Active'}</span>
                                </div>
                                <div className="text-left col-span-2 pt-1 border-t border-white/5 flex justify-between text-[10px]">
                                  <span className="text-gray-400">Position Remaining:</span>
                                  <span className="text-gray-200 font-semibold">{activeChase.amount} ({activeChase.side?.toUpperCase()})</span>
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={isStoppingChase}
                                onClick={() => handleStopSmartChase(activeChase)}
                                className="w-full py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-[12px] uppercase tracking-wider shadow-[0_0_12px_rgba(239,68,68,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                              >
                                <Square className="w-3 h-3 fill-white" />
                                {isStoppingChase ? 'Stopping Chase...' : 'Stop Smart Chase SL'}
                              </button>
                            </div>
                          )}

                          {activeSoftwareSls.length > 0 && (
                            <div className="flex flex-col gap-1.5">
                              {activeSoftwareSls.map((activeSoftwareSl, idx) => {
                                const isChase = activeSoftwareSl.type === 'smart_chase';
                                const isTrailChase = activeSoftwareSl.type === 'trailing_chase';
                                const baseLabel = isTrailChase
                                  ? '⚡ Trailing Chase Armed'
                                  : (isChase ? '⚡ Smart Chase Armed' : (activeSoftwareSl.type === 'trailing' ? '⚡ Trailing SL Armed' : '🛡️ Stop-Loss Armed'));
                                const titleLabel = activeSoftwareSls.length > 1 ? `${baseLabel} #${idx + 1}` : baseLabel;

                                return (
                                  <div key={activeSoftwareSl.id || idx} className="p-2.5 rounded-xl bg-blue-950/60 border border-cyan-500/40 shadow-sm flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
                                      <div className="flex flex-col text-left">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[11.5px] font-bold text-cyan-300 uppercase leading-tight">{titleLabel}</span>
                                          {activeSoftwareSl.peg_strategy === 'wall_aware' && (
                                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                                              🧱 Wall-Aware
                                            </span>
                                          )}
                                          {activeSoftwareSl.peg_strategy === 'inside_spread' && (
                                            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                                              🎯 Inside-Spread
                                            </span>
                                          )}
                                          {activeSoftwareSl.auto_breakeven_enabled && (
                                            <span className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold border ${activeSoftwareSl.breakeven_activated ? 'bg-emerald-500/30 text-emerald-300 border-emerald-500/40' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'}`}>
                                              {activeSoftwareSl.breakeven_activated ? '🛡️ BE Active' : '🛡️ Auto-BE'}
                                            </span>
                                          )}
                                          {activeSoftwareSl.anti_wick_mode && activeSoftwareSl.anti_wick_mode !== 'instant' && (
                                            <span className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold border ${activeSoftwareSl.anti_wick_state === 'holding_dwell' || activeSoftwareSl.anti_wick_state === 'holding_candle'
                                                ? 'bg-amber-500/30 text-amber-200 border-amber-400/60 animate-pulse'
                                                : 'bg-indigo-500/20 text-indigo-300 border-indigo-400/35'
                                              }`}>
                                              {activeSoftwareSl.anti_wick_state === 'holding_dwell' || activeSoftwareSl.anti_wick_state === 'holding_candle'
                                                ? `🕯️ Hold ${Number(activeSoftwareSl.anti_wick_remaining_sec || 0).toFixed(1)}s`
                                                : activeSoftwareSl.anti_wick_mode === 'dwell'
                                                  ? `⏱️ ${activeSoftwareSl.anti_wick_dwell_seconds || 3}s Guard`
                                                  : `🕯️ ${activeSoftwareSl.anti_wick_timeframe || '1m'} Close`}
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-[11px] text-gray-300 font-mono">
                                          SL @ {activeSoftwareSl.trigger_price || activeSoftwareSl.price} ({activeSoftwareSl.amount})
                                          {activeSoftwareSl.trigger_source === 'bid_ask' ? ' • ⚡ Bid/Ask' : ' • 📊 Last'}
                                        </span>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isStoppingChase}
                                      onClick={() => handleStopSmartChase(activeSoftwareSl)}
                                      className="py-1 px-2 rounded-md bg-white/5 hover:bg-red-950/80 hover:text-red-300 hover:border-red-500/50 border border-white/10 text-gray-300 text-[10.5px] font-bold tracking-wider transition-all cursor-pointer disabled:opacity-50 shrink-0"
                                    >
                                      {isStoppingChase ? 'Cancelling...' : 'Cancel SL'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {hasActiveFuturesPos && positionData && (
                            <div className="p-2.5 rounded-xl bg-gradient-to-r from-[#170a14] via-[#0e101d] to-[#0a1518] border border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)] flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${positionData.side.toLowerCase() === 'long' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'} animate-pulse`} />
                                <div className="flex flex-col text-left min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-extrabold text-white uppercase tracking-tight">Active Position:</span>
                                    <span className={`text-[10px] font-mono font-black px-1.5 py-0.2 rounded border ${positionData.side.toLowerCase() === 'long' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40'}`}>
                                      {positionData.side.toUpperCase()}
                                    </span>
                                    <span className="text-[11px] font-mono font-bold text-gray-200">
                                      {isInverseFutures && positionData.contracts ? `${positionData.contracts} Cont (~${positionData.amount.toFixed(2)} ${baseCurrency})` : `${positionData.amount} ${baseCurrency}`}
                                    </span>
                                  </div>
                                  <span className="text-[9.5px] text-gray-400 font-mono">
                                    Instant Market Exit / Flatten
                                  </span>
                                </div>
                              </div>

                              <button
                                type="button"
                                disabled={isClosingPosition}
                                onClick={handleClosePosition}
                                className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-mono text-[11px] font-black uppercase tracking-wider shadow-[0_0_12px_rgba(244,63,94,0.35)] transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 active:scale-95 shrink-0"
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

                          {openLimitOrders && openLimitOrders.length > 0 && (
                            <div className="p-2.5 rounded-xl bg-[#04070e]/90 border border-cyan-500/25 shadow-sm flex flex-col gap-2">
                              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                                <div className="flex items-center gap-1.5">
                                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                                  <span className="text-[11.5px] font-bold text-cyan-200 uppercase tracking-wide font-mono">
                                    Open Orders ({openLimitOrders.length})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isCancellingAll}
                                  onClick={handleCancelAllOrders}
                                  className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10.5px] font-mono font-bold tracking-wider transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                  title="Cancel all open orders on this symbol"
                                >
                                  {isCancellingAll ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                                  <span>{isCancellingAll ? 'Cancelling...' : 'Cancel All'}</span>
                                </button>
                              </div>

                              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10">
                                {openLimitOrders.map((ord: any) => {
                                  const isBuy = String(ord.side).toLowerCase() === 'buy';
                                  const mode = ord.mode || 'LIMIT';
                                  const isCancelling = cancellingOrderId === String(ord.id);
                                  return (
                                    <div
                                      key={ord.id}
                                      className="p-1.5 rounded-lg bg-black/50 border border-white/10 flex items-center justify-between text-[11px] font-mono"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span
                                          className={`px-1 py-0.2 rounded text-[9px] font-bold uppercase ${isBuy
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                            }`}
                                        >
                                          {isBuy ? 'BUY' : 'SELL'}
                                        </span>
                                        <span className="text-[9px] text-cyan-300/80 uppercase font-bold">[{mode}]</span>
                                        {ord.isIceberg && ord.icebergQty && (
                                          <span className="text-[8.5px] px-1 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                                            🧊{ord.icebergQty}
                                          </span>
                                        )}
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

                          {ordersBadgeCount === 0 && (
                            <div className="px-3 py-2 rounded-xl bg-[#04070e]/75 border border-cyan-500/15 flex items-center justify-between gap-2">
                              <span className="text-[11px] font-mono text-gray-400">
                                No active orders, Smart Pegs, or positions on <strong className="text-gray-200">{activeSymbol}</strong>
                              </span>
                              <button
                                type="button"
                                onClick={() => fetchBalance(false, true)}
                                className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-300 text-[10px] font-mono font-bold uppercase cursor-pointer shrink-0"
                              >
                                Sync Exchange
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* TAB 1: STREAMLINED SAAS TRADE WORKSPACE */}
                      {activeTerminalTab === 'order' && (
                        <div className="space-y-2.5 animate-fadeIn">

                          {/* Direction & Execution Mode Segmented Switches */}
                          <div className="grid grid-cols-12 gap-1.5">
                            <div className="col-span-6 flex p-0.5 rounded-lg bg-[#0a101d] border border-white/10 gap-1">
                              <button
                                type="button"
                                onClick={() => handleSideChange('Buy')}
                                className={`flex-1 py-1.5 text-[12px] font-black rounded-md transition-all uppercase tracking-wider cursor-pointer ${tradeSide === 'Buy'
                                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/60 shadow-[0_0_12px_rgba(16,185,129,0.28)]'
                                  : 'text-gray-500 hover:text-white border border-transparent'
                                  }`}
                              >
                                {isFutures ? 'Long' : 'Buy'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSideChange('Sell')}
                                className={`flex-1 py-1.5 text-[12px] font-black rounded-md transition-all uppercase tracking-wider cursor-pointer ${tradeSide === 'Sell'
                                  ? 'bg-rose-500/25 text-rose-300 border border-rose-400/60 shadow-[0_0_12px_rgba(244,63,94,0.28)]'
                                  : 'text-gray-500 hover:text-white border border-transparent'
                                  }`}
                              >
                                {isFutures ? 'Short' : 'Sell'}
                              </button>
                            </div>

                            <div className="col-span-6 flex p-0.5 rounded-lg bg-[#0a101d] border border-white/10 gap-1">
                              {(['Market', 'Limit', 'SmartPeg'] as const).map((type) => (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => setOrderType(type)}
                                  className={`flex-1 py-1.5 text-[10.5px] font-black rounded-md transition-all flex items-center justify-center gap-0.5 cursor-pointer ${orderType === type
                                    ? type === 'SmartPeg'
                                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-[0_0_10px_rgba(245,158,11,0.35)]'
                                      : 'bg-cyan-500/25 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                                    }`}
                                >
                                  {type === 'SmartPeg' ? (
                                    <>
                                      <Zap className="w-3 h-3 fill-current" />
                                      <span>PEG</span>
                                    </>
                                  ) : (
                                    <span className="uppercase tracking-wide">{type === 'Market' ? 'MKT' : 'LMT'}</span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Smart Peg Entry Panel */}
                          <AnimatePresence>
                            {orderType === 'SmartPeg' && (
                              <MotionDiv
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="p-2.5 rounded-xl bg-gradient-to-r from-amber-950/40 via-red-950/20 to-[#04070e] border border-amber-500/35 text-[11px] space-y-2 overflow-hidden shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                                    <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                    <span>⚡ Dynamic Maker Peg Entry</span>
                                  </div>
                                  <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                                    Post-Only 0% Fee
                                  </span>
                                </div>
                                <div className="space-y-1">
                                  <div className="flex justify-between items-center text-[10px] text-gray-400">
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
                                </div>
                                <SmartPegWallStrategyPanel
                                  pegStrategy={smartPegStrategy}
                                  setPegStrategy={setSmartPegStrategy}
                                  wallMultiplier={smartPegWallMultiplier}
                                  setWallMultiplier={setSmartPegWallMultiplier}
                                  frontRunTicks={smartPegFrontRunTicks}
                                  setFrontRunTicks={setSmartPegFrontRunTicks}
                                  antiSpoofGuard={smartPegAntiSpoof}
                                  setAntiSpoofGuard={setSmartPegAntiSpoof}
                                  wallTargets={wallTargets}
                                  tradeSide={tradeSide}
                                  formatDisplayPrice={formatDisplayPrice}
                                />
                              </MotionDiv>
                            )}
                          </AnimatePresence>

                          {/* Limit Price & Liquidity-Wall Magnet Card */}
                          <AnimatePresence>
                            {orderType === 'Limit' && (
                              <MotionDiv
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden space-y-2"
                              >
                                <div className="bg-[#04070e]/90 p-2 rounded-xl border border-cyan-500/20 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextAuto = !isAutoLimit;
                                        setIsAutoLimit(nextAuto);
                                        if (nextAuto && !isFutures) {
                                          setUseNativeTpSl(false);
                                        } else if (!nextAuto && (!limitPrice || Number(limitPrice) <= 0) && effectiveCurrentPrice > 0) {
                                          setLimitPrice(effectiveCurrentPrice.toString());
                                        }
                                      }}
                                      className="flex items-center gap-2 cursor-pointer text-left flex-1 min-w-0"
                                    >
                                      <div className={`relative w-7 h-3.5 rounded-full transition-colors shrink-0 ${isAutoLimit ? 'bg-cyan-500' : 'bg-gray-600'}`}>
                                        <MotionDiv
                                          className="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full"
                                          animate={{ x: isAutoLimit ? 14 : 0 }}
                                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <span className="text-[11px] font-bold text-cyan-300 block leading-tight">
                                          Auto Best Limit (BBO Maker)
                                        </span>
                                        <span className="text-[9.5px] text-gray-400 block truncate">
                                          {isAutoLimit && !isFutures
                                            ? '0% Maker Fee (Turn OFF for Native OTO/OTOCO)'
                                            : 'Manual custom price / Wall-Magnet Limit'}
                                        </span>
                                      </div>
                                    </button>

                                    {!isAutoLimit && effectiveCurrentPrice > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setLimitPrice(effectiveCurrentPrice.toString())}
                                        className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/30 border border-cyan-500/35 text-cyan-300 font-mono text-[10px] font-bold cursor-pointer shrink-0"
                                        title="Snap Limit Price to current live price"
                                      >
                                        Live ${formatDisplayPrice(effectiveCurrentPrice)}
                                      </button>
                                    )}
                                  </div>

                                  {!isAutoLimit && (
                                    <div className="relative">
                                      <input
                                        type="number"
                                        value={limitPrice}
                                        onChange={(e) => setLimitPrice(e.target.value)}
                                        placeholder="Enter Limit Price"
                                        className="w-full bg-[#0a101d] border border-white/15 focus:border-cyan-400/60 rounded-lg py-1.5 px-2.5 pl-6 text-white font-mono font-bold text-[13px] focus:outline-none transition-colors"
                                      />
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-cyan-400/80 font-mono text-[12.5px]">$</span>
                                    </div>
                                  )}
                                </div>

                                <FullModalLimitWallPanel
                                  wallTargets={wallTargets}
                                  frontRunTicks={smartPegFrontRunTicks}
                                  setFrontRunTicks={setSmartPegFrontRunTicks}
                                  wallMagnetEnabled={wallMagnetEnabled}
                                  setWallMagnetEnabled={setWallMagnetEnabled}
                                  isFetchingWalls={isFetchingWalls}
                                  currentPrice={effectiveCurrentPrice}
                                  formatDisplayPrice={formatDisplayPrice}
                                  onSnapLimitToWall={handleSnapLimitToWall}
                                  onRefreshWalls={fetchNearestWalls}
                                />
                              </MotionDiv>
                            )}
                          </AnimatePresence>

                          {/* Unified Order Size & 0-100% Interactive Slider Card */}
                          <div className="space-y-2 rounded-xl bg-[#04070e]/90 border border-cyan-500/20 p-2.5 shadow-[inset_0_1px_6px_rgba(0,0,0,0.65)]">
                            <div className="flex justify-between items-center gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <label className="text-[10.5px] font-mono uppercase tracking-wider text-gray-400 font-bold">
                                  Size
                                </label>
                                <div className="flex items-center gap-0.5 bg-[#0a101d] rounded p-0.5 border border-white/10">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSizingMode('standard');
                                      setSizeMode('base');
                                      if (!selectedPercent) setSize('');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${sizingMode === 'standard' && sizeMode === 'base'
                                      ? 'bg-cyan-500 text-slate-950 shadow'
                                      : 'text-gray-400 hover:text-white'
                                      }`}
                                  >
                                    {baseCurrency}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSizingMode('standard');
                                      setSizeMode('quote');
                                      if (!selectedPercent) setSize('');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${sizingMode === 'standard' && sizeMode === 'quote'
                                      ? 'bg-amber-400 text-slate-950 shadow'
                                      : 'text-gray-400 hover:text-white'
                                      }`}
                                  >
                                    {quoteCurrency}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSizingMode('risk_usd');
                                      setSelectedPercent(null);
                                      if (!riskAmountInput || Number(riskAmountInput) <= 0) setRiskAmountInput('10');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${sizingMode === 'risk_usd'
                                      ? 'bg-emerald-400 text-slate-950 shadow'
                                      : 'text-gray-400 hover:text-emerald-300'
                                      }`}
                                    title="Auto-compute Position Size from max USD ($) risk to SL"
                                  >
                                    RISK $
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSizingMode('risk_pct');
                                      setSelectedPercent(null);
                                      if (!riskAmountInput || Number(riskAmountInput) <= 0 || Number(riskAmountInput) > 25) setRiskAmountInput('1');
                                    }}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold transition-all cursor-pointer ${sizingMode === 'risk_pct'
                                      ? 'bg-emerald-400 text-slate-950 shadow'
                                      : 'text-gray-400 hover:text-emerald-300'
                                      }`}
                                    title="Auto-compute Position Size from % wallet balance risk to SL"
                                  >
                                    RISK %
                                  </button>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {sizingMode === 'standard' && size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                                  <span className="text-[10.5px] font-mono text-amber-300 font-semibold">
                                    ≈ {sizeMode === 'quote'
                                      ? `${(Number(size) / effectiveOrderPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${baseCurrency}`
                                      : `$${(Number(size) * effectiveOrderPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                  </span>
                                )}
                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-400/40 text-cyan-300 font-mono text-[10px] font-black min-w-[36px] text-center">
                                  {sliderPercentValue}%
                                </span>
                              </div>
                            </div>

                            {/* Order Amount Input */}
                            <div className="relative">
                              {sizingMode === 'standard' ? (
                                <>
                                  <input
                                    type="number"
                                    value={size}
                                    onChange={(e) => {
                                      setSize(e.target.value);
                                      setSelectedPercent(null);
                                    }}
                                    placeholder={isInverseFutures ? `Min 1 Cont ($${contractSize})` : "0.00"}
                                    className={`w-full bg-[#0a101d]/90 border border-white/10 focus:border-cyan-400/60 rounded-lg py-1.5 px-3 ${sizeMode === 'quote' ? 'pl-7' : 'pl-12'} text-white font-mono font-bold text-[13px] focus:outline-none transition-colors`}
                                  />
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11.5px] font-mono font-bold text-cyan-400/80 pointer-events-none">
                                    {sizeMode === 'quote' ? '$' : baseCurrency.slice(0, 4)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    value={riskAmountInput}
                                    onChange={(e) => setRiskAmountInput(e.target.value)}
                                    placeholder={sizingMode === 'risk_usd' ? 'Max Loss in $ (e.g. 10)' : 'Max Risk % (e.g. 1)'}
                                    className="w-full bg-[#0a101d]/90 border border-emerald-500/40 focus:border-emerald-400 rounded-lg py-1.5 px-3 pl-14 text-emerald-200 font-mono font-bold text-[13px] focus:outline-none transition-colors"
                                  />
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono font-bold text-emerald-400 pointer-events-none">
                                    {sizingMode === 'risk_usd' ? 'RISK$' : 'RISK%'}
                                  </span>
                                </>
                              )}
                            </div>

                            {sizingMode === 'standard' && size && Number(size) > 0 && effectiveOrderPrice > 0 && isInverseFutures && (
                              <div className="flex items-center gap-1.5 px-1 font-mono">
                                <span className="text-[10.5px] bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.2 rounded font-mono font-semibold">
                                  {Math.max(1, Math.round(((sizeMode === 'quote' ? Number(size) : Number(size) * effectiveOrderPrice)) / contractSize))} Cont (${contractSize}/Cont)
                                </span>
                              </div>
                            )}

                            {sizingMode !== 'standard' && (
                              <RiskSizingSubBar
                                sizeMode={sizingMode}
                                riskInput={riskAmountInput}
                                onSelectRiskPreset={setRiskAmountInput}
                                riskCalc={riskSizing}
                                baseCurrency={baseCurrency}
                                quoteCurrency={quoteCurrency}
                                formatDisplayPrice={formatDisplayPrice}
                              />
                            )}

                            {/* 0% to 100% Interactive Milestone Slide Bar */}
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
                                      className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border transition-all duration-150 ${isReached
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
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                title={`Order Size: ${sliderPercentValue}%`}
                              />
                            </div>

                            {/* % quick-fill buttons */}
                            <div className="flex justify-between gap-1.5">
                              {['25%', '50%', '75%', '100%'].map(pct => {
                                const isSelected = sizingMode === 'standard' && selectedPercent === pct;
                                return (
                                  <button
                                    key={pct}
                                    type="button"
                                    className={`flex-1 py-1 text-[10.5px] font-mono font-extrabold rounded border transition-all cursor-pointer active:scale-95 ${isSelected
                                      ? 'bg-gradient-to-r from-cyan-500/35 to-emerald-500/30 border-cyan-400 text-cyan-200 shadow-[0_0_8px_rgba(6,182,212,0.35)]'
                                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-cyan-500/40 text-gray-400 hover:text-white'
                                      }`}
                                    onClick={() => {
                                      setSizingMode('standard');
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

                          {/* Inline Quick TP & SL Brackets Strip */}
                          <QuickTpSlInlineStrip
                            tpEnabled={tpConfig.enabled}
                            tpMode={tpConfig.mode}
                            tpValue={tpConfig.value}
                            tpOrderType={tpConfig.orderType}
                            onToggleTp={() => setTpConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                            onChangeTpValue={(val) => setTpConfig(prev => ({ ...prev, value: val }))}
                            onChangeTpMode={(m) => setTpConfig(prev => ({ ...prev, mode: m }))}
                            onToggleTpOrderType={() => setTpConfig(prev => ({ ...prev, orderType: prev.orderType === 'Limit' ? 'Market' : 'Limit' }))}
                            slEnabled={slConfig.enabled}
                            slType={slConfig.type}
                            slMode={slConfig.mode}
                            slValue={slConfig.value}
                            onToggleSl={() => setSlConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                            onChangeSlValue={(val) => setSlConfig(prev => ({ ...prev, value: val }))}
                            onChangeSlMode={(m) => setSlConfig(prev => ({ ...prev, mode: m }))}
                            tradeSide={tradeSide}
                            wallTargets={wallTargets}
                            frontRunTicks={smartPegFrontRunTicks}
                            formatDisplayPrice={formatDisplayPrice}
                            onSnapTpToWall={handleSnapTpToWall}
                            onOpenBracketsTab={() => setActiveTerminalTab('brackets')}
                            isNativeExchangeSlLockedToFixed={isNativeExchangeSlLockedToFixed}
                          />

                          {/* Compact Inline AI Shield & Model Strip */}
                          <div className={`rounded-xl border p-2 transition-all space-y-1.5 ${mlFilterConfig.enabled ? 'bg-blue-500/10 border-blue-500/45' : 'bg-[#04070e]/85 border-white/10'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  hasManualMlOverrideRef.current = true;
                                  setMlFilterConfig(prev => ({
                                    ...prev,
                                    enabled: !prev.enabled,
                                    modelId: !prev.enabled && !prev.modelId && mlModels.length > 0 ? mlModels[0].id : prev.modelId
                                  }));
                                }}
                                className="flex items-center gap-1.5 cursor-pointer shrink-0"
                              >
                                <div className={`relative w-7 h-3.5 rounded-full transition-colors ${mlFilterConfig.enabled ? 'bg-blue-500' : 'bg-gray-600'}`}>
                                  <MotionDiv
                                    className="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full"
                                    animate={{ x: mlFilterConfig.enabled ? 14 : 0 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                  />
                                </div>
                                <span className="text-[11px] font-black uppercase tracking-wide text-blue-300">
                                  🤖 AI Shield
                                </span>
                              </button>

                              <select
                                className="flex-1 min-w-0 bg-black/60 border border-blue-500/30 rounded-md py-0.5 px-2 text-white outline-none focus:border-blue-400 text-[10.5px] font-bold cursor-pointer truncate"
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
                                <option value="">-- Select Model --</option>
                                {mlModels.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({m.modelType})
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => setActiveTerminalTab('ai')}
                                className="px-1.5 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/30 border border-blue-400/35 text-blue-300 text-[9.5px] font-mono font-bold cursor-pointer shrink-0"
                                title="Open Full AI Shield Thresholds & Execution Mode"
                              >
                                ⚙ Tune
                              </button>
                            </div>

                            {mlFilterConfig.enabled && mlLivePreview && (
                              <HudLiveAiMicroGauge
                                preview={mlLivePreview}
                                tradeSide={tradeSide}
                                bullishThreshold={mlFilterConfig.bullishThreshold}
                                bearishThreshold={mlFilterConfig.bearishThreshold}
                                compact
                              />
                            )}
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
                                      <span className="text-[12.5px] font-bold text-cyan-300">Binance Native Iceberg</span>
                                      <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono font-bold uppercase">Spot GTC</span>
                                    </div>
                                    <span className="text-[10.5px] text-gray-400">
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
                                    <div className="flex items-center justify-between gap-2">
                                      <label className="text-[11px] text-gray-400 font-medium">Visible Slice Size</label>
                                      <div className="flex bg-black/40 rounded border border-white/10 p-0.5">
                                        <button
                                          type="button"
                                          onClick={() => setIcebergMode('percent')}
                                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${icebergMode === 'percent' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
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
                                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${icebergMode === 'qty' ? 'bg-cyan-600 text-white font-bold' : 'text-gray-400 hover:text-white'}`}
                                        >
                                          {baseCurrency}
                                        </button>
                                      </div>
                                    </div>

                                    {icebergMode === 'percent' && (
                                      <div className="grid grid-cols-4 gap-1.5">
                                        {['10', '20', '25', '50'].map((pct) => (
                                          <button
                                            key={pct}
                                            type="button"
                                            onClick={() => setIcebergPercent(pct)}
                                            className={`py-1 text-[11px] font-mono rounded border transition-all ${icebergPercent === pct
                                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                              : 'bg-black/30 border-white/5 text-gray-400 hover:text-white hover:bg-white/5'
                                              }`}
                                          >
                                            {pct}%
                                          </button>
                                        ))}
                                      </div>
                                    )}

                                    {icebergMode === 'qty' && (
                                      <div className="grid grid-cols-4 gap-1.5">
                                        {['100', '250', '500', '1000'].map((q) => (
                                          <button
                                            key={q}
                                            type="button"
                                            onClick={() => setIcebergCustomQty(q)}
                                            className={`py-1 text-[11px] font-mono rounded border transition-all ${icebergCustomQty === q
                                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                              : 'bg-black/30 border-white/5 text-gray-400 hover:text-white hover:bg-white/5'
                                              }`}
                                          >
                                            {q} {baseCurrency}
                                          </button>
                                        ))}
                                      </div>
                                    )}

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
                                        className="w-full bg-black/40 border border-cyan-500/30 rounded py-1.5 px-3 pr-14 text-white text-[13px] font-mono focus:outline-none focus:border-cyan-400 transition-colors"
                                      />
                                      <span className="absolute right-3 top-1.5 text-[11px] text-cyan-400 font-bold font-mono">
                                        {icebergMode === 'percent' ? '% SLICE' : baseCurrency}
                                      </span>
                                    </div>

                                    {(() => {
                                      if (effectiveIcebergQty <= 0 || currentBaseAmount <= 0) return null;
                                      const refPrice = effectiveOrderPrice || effectiveCurrentPrice || 0;
                                      const sliceNotional = effectiveIcebergQty * refPrice;
                                      const minRequiredSlice = refPrice > 0 ? Math.ceil(5.05 / refPrice) : 65;

                                      if (effectiveIcebergQty >= currentBaseAmount) {
                                        return (
                                          <div className="p-2 rounded bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-300 flex items-center gap-1.5 font-mono">
                                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                            <span>Slice ({effectiveIcebergQty.toFixed(2)}) must be smaller than total order ({currentBaseAmount.toFixed(2)} {baseCurrency}).</span>
                                          </div>
                                        );
                                      }

                                      if (sliceNotional < 5.0) {
                                        return (
                                          <div className="p-2 rounded bg-red-950/50 border border-red-500/50 flex flex-col gap-1.5 text-[11px] animate-fadeIn">
                                            <div className="flex items-center justify-between text-red-300 font-bold">
                                              <span className="flex items-center gap-1">
                                                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                                Slice value (${sliceNotional.toFixed(2)}) is below Binance $5.00 Min Notional!
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between text-gray-300">
                                              <span className="text-[10px]">Binance requires each slice ≥ $5.00 (~{minRequiredSlice} {baseCurrency})</span>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setIcebergMode('qty');
                                                  setIcebergCustomQty(minRequiredSlice.toString());
                                                }}
                                                className="px-2 py-0.5 rounded bg-red-600/30 hover:bg-red-600/60 text-red-200 border border-red-500/50 font-bold uppercase tracking-wider text-[10px] transition-colors cursor-pointer"
                                              >
                                                Auto-Set Min ({minRequiredSlice} {baseCurrency})
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      }

                                      return (
                                        <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-between text-[11px] font-mono">
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

                          {/* Futures Margin, Leverage & Reduce-Only Card */}
                          {isFutures && (
                            <div className="space-y-2 bg-[#04070e]/90 p-2.5 rounded-xl border border-cyan-500/20">
                              <div className="flex justify-between items-center text-[12px] text-gray-400 font-medium">
                                <div className="flex bg-black/50 rounded p-0.5 border border-white/10">
                                  <button
                                    type="button"
                                    onClick={() => setMarginMode('cross')}
                                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-colors cursor-pointer ${marginMode === 'cross' ? 'bg-cyan-500 text-slate-950' : 'hover:text-white'}`}
                                  >
                                    Cross
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setMarginMode('isolated')}
                                    className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-colors cursor-pointer ${marginMode === 'isolated' ? 'bg-cyan-500 text-slate-950' : 'hover:text-white'}`}
                                  >
                                    Isolated
                                  </button>
                                </div>
                                <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-400/40 px-2 py-0.5 rounded font-mono font-black tracking-wider">
                                  {leverage}x LEVERAGE
                                </span>
                              </div>

                              <input
                                type="range"
                                min="1"
                                max="125"
                                value={leverage}
                                onChange={(e) => setLeverage(Number(e.target.value))}
                                className="w-full accent-cyan-400 h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer"
                              />

                              <label className="flex items-center space-x-2 cursor-pointer group w-max">
                                <input
                                  type="checkbox"
                                  checked={reduceOnly}
                                  onChange={(e) => setReduceOnly(e.target.checked)}
                                  className="form-checkbox bg-black/40 border-white/20 text-cyan-400 rounded focus:ring-0 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
                                />
                                <span className="text-[11.5px] text-gray-400 group-hover:text-white transition-colors font-medium">Reduce Only (Close Position)</span>
                              </label>
                            </div>
                          )}
                        </div>
                      )}

                      {/* TAB 3: AI SHIELD (L2 MACHINE LEARNING FILTER) */}
                      {activeTerminalTab === 'ai' && (
                        <div className="space-y-2.5 animate-fadeIn">
                          {/* L2 / Training Studio Machine Learning Filter Panel */}
                          <div className={`space-y-2.5 p-3 rounded-lg border transition-all ${mlFilterConfig.enabled ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.12)]' : 'bg-[#04070e]/85 border-blue-500/25'}`}>
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
                                    <span className="text-[13px] font-bold text-gray-200 group-hover:text-white transition-colors">
                                      L2 Machine Learning Filter
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-bold uppercase ${mlFilterConfig.enabled ? 'bg-blue-500/30 text-blue-200 border border-blue-400/40' : 'bg-white/5 text-gray-400'}`}>
                                      {mlFilterConfig.enabled ? 'ACTIVE' : 'OFF'}
                                    </span>
                                    {pinnedModelId && mlFilterConfig.modelId === pinnedModelId && (
                                      <span className="text-[9.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/35">
                                        PINNED
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-gray-400">
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
                                <label className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                                  Select Trained Model (ML Registry)
                                </label>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    fetchMlModels();
                                  }}
                                  className="p-1 rounded bg-white/5 hover:bg-blue-500/20 text-gray-400 hover:text-blue-300 transition-colors cursor-pointer flex items-center gap-1 text-[10px]"
                                  title="Refresh Models from ML Registry"
                                >
                                  <RefreshCw className={`w-3 h-3 ${isLoadingMlModels ? 'animate-spin text-blue-400' : ''}`} />
                                  <span>Refresh</span>
                                </button>
                              </div>

                              {mlModels.length === 0 ? (
                                <p className="text-[11px] text-amber-400/90 italic py-1">
                                  No models found in ML Registry. Train & save a model in Training Studio first.
                                </p>
                              ) : (
                                <select
                                  className="w-full bg-black border border-blue-500/30 rounded-lg py-1.5 px-2.5 text-white outline-none focus:border-blue-400 text-[13px] font-bold cursor-pointer"
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

                            {mlFilterConfig.enabled && mlLivePreview && (
                              <HudLiveAiMicroGauge
                                preview={mlLivePreview}
                                tradeSide={tradeSide}
                                bullishThreshold={mlFilterConfig.bullishThreshold}
                                bearishThreshold={mlFilterConfig.bearishThreshold}
                                compact={false}
                              />
                            )}

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
                                    <label className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block">
                                      Execution Mode
                                    </label>
                                    <div className="grid grid-cols-2 gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setMlFilterConfig(prev => ({ ...prev, executionMode: 'basic' }))}
                                        className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-all border cursor-pointer ${mlFilterConfig.executionMode === 'basic'
                                          ? 'bg-blue-600/25 border-blue-500 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.2)]'
                                          : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5'
                                          }`}
                                      >
                                        Signal Only (Filter Entry)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setMlFilterConfig(prev => ({ ...prev, executionMode: 'advanced' }))}
                                        className={`py-1.5 px-2 rounded-lg font-bold text-[11px] transition-all border cursor-pointer ${mlFilterConfig.executionMode === 'advanced'
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
                                              <span className="text-[11px] font-bold text-gray-200">
                                                Smart Auto-Align to Model
                                              </span>
                                              <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-mono font-bold uppercase border ${mlFilterConfig.autoThreshold ? 'bg-amber-500/20 text-amber-300 border-amber-500/35 shadow-[0_0_8px_rgba(245,158,11,0.2)]' : 'bg-white/5 text-gray-400 border-white/5'}`}>
                                                {mlFilterConfig.autoThreshold ? 'AUTO ON' : 'MANUAL'}
                                              </span>
                                            </div>
                                            <span className="text-[10px] text-gray-400 font-mono truncate">
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
                                      <label className="text-[11px] font-bold text-gray-300 uppercase flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${tradeSide === 'Buy' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}></span>
                                        <span>BUY Filter: Bullish Threshold</span>
                                      </label>
                                      <span className="text-[13px] font-mono font-bold text-emerald-400">
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
                                    <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                                      For <span className="text-emerald-400 font-semibold">BUY</span> orders: AI must predict ≥{(mlFilterConfig.bullishThreshold * 100).toFixed(0)}% Bullish probability to permit entry, otherwise it denies the trade.
                                    </p>
                                  </div>

                                  {/* Bearish Threshold (Active for SELL orders — Spot Hold Currency Sell High & Futures Short) */}
                                  <div className={`p-2.5 rounded-lg border transition-colors ${tradeSide === 'Sell' ? 'bg-rose-950/25 border-rose-500/35' : 'bg-black/30 border-white/5 opacity-85'}`}>
                                    <div className="flex justify-between items-center mb-1">
                                      <label className="text-[11px] font-bold text-gray-300 uppercase flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${tradeSide === 'Sell' ? 'bg-rose-400 animate-pulse' : 'bg-gray-500'}`}></span>
                                        <span>SELL Filter: Bearish Threshold</span>
                                      </label>
                                      <span className="text-[13px] font-mono font-bold text-rose-400">
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
                                    <p className="text-[10px] text-gray-400 mt-1 leading-tight">
                                      For <span className="text-rose-400 font-semibold">SELL</span> orders (Spot Hold Sell High → Low TP Buy Back, or Short): AI must predict ≥{(mlFilterConfig.bearishThreshold * 100).toFixed(0)}% Bearish probability to permit selling.
                                    </p>
                                  </div>
                                </MotionDiv>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      )}

                      {/* TAB 2: BRACKETS (TP / SL / NATIVE OTO-OTOCO) */}
                      {activeTerminalTab === 'brackets' && (
                        <div className="animate-fadeIn">
                          <BracketTpSlTabPanel
                            tradeSide={tradeSide}
                            orderType={orderType}
                            isFutures={isFutures}
                            isAutoLimit={isAutoLimit}
                            isIceberg={isIceberg}
                            leverage={leverage}
                            marginMode={marginMode}
                            effectiveOrderPrice={effectiveOrderPrice}
                            effectiveCurrentPrice={effectiveCurrentPrice}
                            limitPrice={limitPrice}
                            tpConfig={tpConfig}
                            setTpConfig={setTpConfig}
                            slConfig={slConfig}
                            setSlConfig={setSlConfig}
                            useNativeTpSl={useNativeTpSl}
                            canConfigureNativeTpSl={canConfigureNativeTpSl}
                            isNativeTpSlSupported={isNativeTpSlSupported}
                            isNativeExchangeSlLockedToFixed={isNativeExchangeSlLockedToFixed}
                            onToggleNativeTpSl={() => {
                              if (!canConfigureNativeTpSl) return;
                              if (isAutoLimit) {
                                setIsAutoLimit(false);
                                if ((!limitPrice || Number(limitPrice) <= 0) && effectiveCurrentPrice > 0) {
                                  setLimitPrice(effectiveCurrentPrice.toString());
                                }
                                setUseNativeTpSl(true);
                              } else {
                                setUseNativeTpSl(!useNativeTpSl);
                              }
                            }}
                            onSwitchToManualLimit={() => {
                              setIsAutoLimit(false);
                              if ((!limitPrice || Number(limitPrice) <= 0) && effectiveCurrentPrice > 0) {
                                setLimitPrice(effectiveCurrentPrice.toString());
                              }
                              setUseNativeTpSl(true);
                            }}
                            getSmartGapValue={getSmartGapValue}
                            wallTargets={wallTargets}
                            frontRunTicks={smartPegFrontRunTicks}
                            formatDisplayPrice={formatDisplayPrice}
                            onSnapTpToWall={handleSnapTpToWall}
                            tradePnlPreview={tradePnlPreview}
                            isThermalGuardActive={isThermalGuardActive}
                          />
                        </div>
                      )}

                    </div> {/* End Scrollable Tab Workspace */}

                    {/* Sticky Sci-Fi Footer */}
                    <div className="px-3 py-2 bg-[#04070e]/95 border-t border-cyan-500/20 shrink-0 space-y-1.5">
                      {/* Inline AI Trade Shield Rejection Card */}
                      <AnimatePresence>
                        {aiRejectNotice && (
                          <MotionDiv
                            initial={{ height: 0, opacity: 0, y: 6 }}
                            animate={{ height: 'auto', opacity: 1, y: 0 }}
                            exit={{ height: 0, opacity: 0, y: 6 }}
                            className="overflow-hidden"
                          >
                            <div className="p-2 rounded-xl bg-gradient-to-br from-amber-950/60 via-[#0d1424] to-black border border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.15)] space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300">
                                    AI Shield Protected ({aiRejectNotice.side} Blocked)
                                  </span>
                                  <span className="text-[9.5px] text-gray-500 font-mono">
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
                              <div className="space-y-1 bg-black/50 p-1.5 rounded-lg border border-white/5">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span className="text-gray-300">
                                    {aiRejectNotice.directionLabel}:{' '}
                                    <strong className="text-amber-300">{aiRejectNotice.calibratedProb.toFixed(1)}%</strong>
                                    {aiRejectNotice.rawProb !== null && aiRejectNotice.rawProb !== undefined && Math.abs(aiRejectNotice.rawProb - aiRejectNotice.calibratedProb) > 3 && (
                                      <span className="text-[9px] text-gray-500 ml-1">(Raw {aiRejectNotice.rawProb.toFixed(1)}%)</span>
                                    )}
                                  </span>
                                  <span className="text-cyan-300 font-bold">
                                    Req ≥{aiRejectNotice.threshold.toFixed(0)}% • {aiRejectNotice.oppositeLabel} {aiRejectNotice.oppositeProb.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="relative h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${aiRejectNotice.side === 'BUY'
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
                                <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[9px] font-mono text-gray-300">
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

                              <div className="text-[10px] text-amber-200/95 leading-tight flex items-start gap-1 px-0.5">
                                <span className="text-amber-400 shrink-0">⚡</span>
                                <span>{aiRejectNotice.reason}</span>
                              </div>
                            </div>
                          </MotionDiv>
                        )}
                      </AnimatePresence>

                      {/* Live Dollar PnL, R:R & Maker Fee Savings Preview */}
                      <LivePnlAndRRBar
                        preview={tradePnlPreview}
                        orderType={orderType}
                        isFutures={isFutures}
                      />

                      {/* Primary Execute + Drag-to-Chart CTA & Inline TP/SL Handles */}
                      <div className="flex items-stretch gap-1.5">
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            handleOrderPointerDown(e, tradeSide);
                          }}
                          onClick={(e) => {
                            if (didOrderDragRef.current) {
                              didOrderDragRef.current = false;
                              return;
                            }
                            handleTrade(tradeSide);
                          }}
                          style={{ touchAction: 'none' }}
                          disabled={isSubmitting}
                          className={`flex-1 min-w-0 py-2 px-3 rounded-lg font-bold flex items-center justify-between transition-all disabled:opacity-50 group border cursor-grab active:cursor-grabbing select-none ${orderType === 'SmartPeg'
                            ? tradeSide === 'Buy'
                              ? 'bg-gradient-to-r from-amber-600/30 to-emerald-600/30 hover:from-amber-600 hover:to-emerald-600 text-amber-200 hover:text-white border-amber-400/60 shadow-[0_0_16px_rgba(245,158,11,0.25)]'
                              : 'bg-gradient-to-r from-amber-600/30 to-rose-600/30 hover:from-amber-600 hover:to-rose-600 text-amber-200 hover:text-white border-amber-400/60 shadow-[0_0_16px_rgba(245,158,11,0.25)]'
                            : tradeSide === 'Buy'
                              ? 'bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-white border-emerald-400/60 shadow-[0_0_14px_rgba(16,185,129,0.2)] hover:shadow-[0_0_18px_rgba(16,185,129,0.45)]'
                              : 'bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border-rose-400/60 shadow-[0_0_14px_rgba(244,63,94,0.2)] hover:shadow-[0_0_18px_rgba(244,63,94,0.45)]'
                            }`}
                          title={`Click to execute ${orderType} ${tradeSide}, or Touch/Drag onto chart to place at price level`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {orderType === 'SmartPeg' ? (
                              <Zap className="w-4 h-4 text-amber-300 fill-amber-300 group-hover:scale-110 transition-transform shrink-0" />
                            ) : tradeSide === 'Buy' ? (
                              <TrendingUp className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform shrink-0" />
                            ) : (
                              <TrendingDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform shrink-0" />
                            )}
                            <span className="text-[12.5px] font-black uppercase tracking-wider font-mono truncate">
                              {isSubmitting
                                ? 'EXECUTING...'
                                : `${orderType === 'SmartPeg' ? 'SMART PEG' : 'EXECUTE'} ${isFutures ? (tradeSide === 'Buy' ? 'LONG' : 'SHORT') : tradeSide.toUpperCase()}`}
                            </span>
                            {currentBaseAmount > 0 && effectiveOrderPrice > 0 && (
                              <span className="text-[10.5px] font-mono opacity-85 hidden sm:inline shrink-0">
                                • ${(currentBaseAmount * effectiveOrderPrice).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </span>
                            )}
                          </div>
                          <span className="text-[9.5px] font-mono text-gray-300/80 group-hover:text-white flex items-center gap-1 shrink-0 ml-2">
                            <span className="hidden sm:inline">Drag Chart</span>
                            <MoveVertical className="w-3 h-3 opacity-80" />
                          </span>
                        </button>

                        {/* Inline Drag-to-Chart TP & SL Handles */}
                        <div
                          data-no-drag="true"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            startLineDrag(e, 'tp');
                          }}
                          style={{ touchAction: 'none' }}
                          className="px-2.5 rounded-lg border border-emerald-400/45 hover:border-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300 flex items-center gap-1 font-mono text-[10px] font-black select-none transition-all cursor-grab active:cursor-grabbing shrink-0"
                          title={`Drag onto chart to place Take Profit (${tpConfig.orderType})`}
                        >
                          <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>TP</span>
                        </div>

                        <div
                          data-no-drag="true"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            startLineDrag(e, 'sl');
                          }}
                          style={{ touchAction: 'none' }}
                          className="px-2.5 rounded-lg border border-rose-400/45 hover:border-rose-300 bg-rose-500/10 hover:bg-rose-500/25 text-rose-300 flex items-center gap-1 font-mono text-[10px] font-black select-none transition-all cursor-grab active:cursor-grabbing shrink-0"
                          title={`Drag onto chart to place Stop Loss (${slConfig.type === 'smart_chase' || slConfig.type === 'trailing_chase' ? 'Smart Chase' : 'Exchange Native'})`}
                        >
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span>SL</span>
                        </div>
                      </div>

                      {/* Footer Telemetry Status Strip */}
                      <div className="flex items-center justify-between text-[9.5px] font-mono text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
                          Secure API Execution
                        </span>
                        {isTelegramConnected === true ? (
                          <span className="text-cyan-400/90 flex items-center gap-1 font-medium" title="Telegram alerts are active and verified">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.8)]"></span>
                            Telegram Alerts Active
                          </span>
                        ) : isTelegramConnected === false ? (
                          <a
                            href="/settings"
                            className="text-amber-400/90 hover:text-amber-300 flex items-center gap-1 font-medium underline cursor-pointer"
                            title="Manual trade alerts are disabled in Settings or Telegram bot is not connected. Click to configure in Settings."
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                            Manual Alerts Disabled
                          </a>
                        ) : (
                          <span className="text-gray-500">Drag header to move</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
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
            left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 1000) - 210, Math.max(10, activeDragLine.pointerPos.x + 16)),
            top: Math.max(10, activeDragLine.pointerPos.y - 42),
            pointerEvents: 'none',
            zIndex: 999999,
          }}
          className={`px-2.5 py-1 rounded-lg border font-mono text-[12px] font-black shadow-2xl ${isThermalGuardActive ? '' : 'backdrop-blur-md'} flex items-center gap-2 select-none animate-fadeIn ${activeDragLine.type === 'peg_buy'
            ? 'bg-cyan-950/95 border-cyan-400 text-cyan-200 shadow-[0_0_18px_rgba(6,182,212,0.55)]'
            : activeDragLine.type === 'peg_sell'
              ? 'bg-amber-950/95 border-amber-400 text-amber-200 shadow-[0_0_18px_rgba(245,158,11,0.55)]'
              : activeDragLine.type === 'buy' || activeDragLine.type === 'tp'
                ? 'bg-emerald-950/95 border-emerald-400 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.55)]'
                : 'bg-rose-950/95 border-rose-400 text-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.55)]'
            }`}
        >
          {activeDragLine.type === 'peg_buy' || activeDragLine.type === 'peg_sell' ? (
            <Zap className={`w-3.5 h-3.5 ${activeDragLine.type === 'peg_buy' ? 'text-cyan-400 fill-cyan-400' : 'text-amber-400 fill-amber-400'} shrink-0`} />
          ) : activeDragLine.type === 'buy' ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : activeDragLine.type === 'sell' ? (
            <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : activeDragLine.type === 'tp' ? (
            <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          )}
          <span>
            {activeDragLine.type === 'peg_buy'
              ? 'PEG BUY'
              : activeDragLine.type === 'peg_sell'
                ? 'PEG SELL'
                : activeDragLine.type === 'buy'
                  ? 'BUY LMT'
                  : activeDragLine.type === 'sell'
                    ? 'SELL LMT'
                    : activeDragLine.type === 'tp'
                      ? 'TP'
                      : 'SL'}{' '}
            @ ${formatDisplayPrice(activeDragLine.currentPrice)}
          </span>
          {effectiveCurrentPrice > 0 && activeDragLine.currentPrice > 0 && (() => {
            const dragPct = ((activeDragLine.currentPrice - effectiveCurrentPrice) / effectiveCurrentPrice) * 100;
            const refEntry = Number(positionData?.entry_price || effectiveOrderPrice || effectiveCurrentPrice || 0);
            const dragAmt = positionData && positionData.amount > 0 ? positionData.amount : currentBaseAmount;
            const dragUsd = calculateDragLineDeltaUsd({
              dragType: activeDragLine.type,
              dropPrice: activeDragLine.currentPrice,
              refEntryPrice: refEntry,
              baseAmount: dragAmt,
              tradeSide,
            });
            return (
              <span
                className={`text-[10px] font-extrabold ${activeDragLine.currentPrice >= effectiveCurrentPrice ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                ({dragPct >= 0 ? '+' : ''}
                {dragPct.toFixed(2)}%
                {dragUsd ? ` • ${dragUsd.isProfit ? '+' : '-'}$${dragUsd.usd.toFixed(2)}` : ''})
              </span>
            );
          })()}
          {typeof window !== 'undefined' && (window as any)._cosmoLastMagnetSnap?.wall && (
            <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-amber-500/30 border border-amber-300/60 text-amber-200 font-black uppercase">
              🧲 WALL
            </span>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

export const ManualTradeModal = React.memo(ManualTradeModalBase);
