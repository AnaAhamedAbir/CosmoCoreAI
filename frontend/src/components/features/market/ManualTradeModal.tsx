import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, ChevronDown, RefreshCw, Square, ShieldAlert, Zap, Layers, AlertTriangle, Minus, Maximize2, GripVertical } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { manualTradeService, ApiKey, FastBalanceResponse, FastPositionResponse } from '../../../services/manualTradeService';
import { notificationService } from '../../../services/notification';

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
}

export const ManualTradeModal: React.FC<ManualTradeModalProps> = ({ 
  symbol, 
  currentPrice, 
  availablePairs,
  onSelectPair,
  onApiKeyChange, 
  clickedPrice, 
  openTrigger, 
  buttonSize = 'md', 
  onClose 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [submittingSide, setSubmittingSide] = useState<'Buy' | 'Sell' | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<string>(symbol);

  // Floating Modal Drag Position State (Zero-React-Re-render Direct GPU Transform Pattern)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = React.useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
    minX: -100,
    maxX: 1500,
    minY: -800,
    maxY: 92
  });
  const modalContainerRef = React.useRef<HTMLDivElement>(null);

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

  const [orderType, setOrderType] = useState<'Market' | 'Limit' | 'SmartPeg'>('SmartPeg');
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
  const [tradeSide, setTradeSide] = useState<'Buy' | 'Sell'>('Buy');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('isolated');
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  const [isAutoLimit, setIsAutoLimit] = useState<boolean>(true);
  const [positionData, setPositionData] = useState<FastPositionResponse | null>(null);
  const [isLoadingPosition, setIsLoadingPosition] = useState(false);
  const [tpConfig, setTpConfig] = useState({
    enabled: true,
    mode: 'price' as 'percentage' | 'price' | 'absolute' | 'atr',
    value: '0.0005',
    orderType: 'Limit' as 'Limit' | 'Market',
    timeoutMins: 0
  });
  const [slConfig, setSlConfig] = useState({
    enabled: true,
    type: 'smart_chase' as 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase',
    mode: 'price' as 'percentage' | 'price' | 'absolute' | 'atr',
    value: '0.0005',
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
  const [useNativeTpSl, setUseNativeTpSl] = useState<boolean>(true);
  const [activeBrackets, setActiveBrackets] = useState<any[]>([]);
  const [isStoppingChase, setIsStoppingChase] = useState(false);
  const [isStoppingPeg, setIsStoppingPeg] = useState(false);
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
  const [isIceberg, setIsIceberg] = useState<boolean>(false);
  const [icebergMode, setIcebergMode] = useState<'percent' | 'qty'>('percent');
  const [icebergPercent, setIcebergPercent] = useState<string>('20');
  const [icebergCustomQty, setIcebergCustomQty] = useState<string>('');

  // Poll active software brackets and actively running smart chases
  const fetchActiveBrackets = React.useCallback(async () => {
    if (!selectedApi) return;
    try {
      const data = await manualTradeService.getActiveSoftwareBrackets(Number(selectedApi), activeSymbol);
      setActiveBrackets(data || []);
    } catch (err) {
      // silent background check
    }
  }, [selectedApi, activeSymbol]);

  React.useEffect(() => {
    if (!selectedApi) return;
    fetchActiveBrackets();
    const interval = setInterval(fetchActiveBrackets, 1500);
    return () => clearInterval(interval);
  }, [selectedApi, activeSymbol, fetchActiveBrackets]);

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
      fetchActiveBrackets();
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
      fetchActiveBrackets();
      fetchBalance(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to stop Smart Peg Entry');
    } finally {
      setIsStoppingPeg(false);
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
    setIcebergCustomQty('');
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

  // Live background auto-refresh every 5.5 seconds while modal is open (safe from Binance rate limits)
  React.useEffect(() => {
    if (!isOpen || !selectedApi) return;

    // Immediate initial fetch
    fetchBalance(false);

    // Periodic live sync (every 5.5s — consumes ~10 req/min, <15% of Binance 1200 weight/min limit)
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchBalance(true);
      }
    }, 5500);

    // Immediate refresh on tab focus / visibility restore
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchBalance(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, selectedApi, activeSymbol, fetchBalance]);

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
      if (aside) {
        const rightEdge = Math.round(aside.getBoundingClientRect().right);
        setModalLeft(Math.max(20, rightEdge + 20));
      } else {
        setModalLeft(20);
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen]);

  // Clamp drag offset using actual rendered modal dimensions so header never goes off-screen
  const clampModalOffset = React.useCallback((rawX: number, rawY: number) => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const modalEl = modalContainerRef.current;
    const modalW = modalEl?.offsetWidth || 320;
    const modalH = modalEl?.offsetHeight || (isMinimized ? 110 : 580);

    const minX = -modalLeft + 10;
    const maxX = Math.max(minX, winW - modalLeft - modalW - 10);

    // Modal base position is `bottom: 104px` + `translate3d(x, y, 0)` => top = winH - (104 - y) - modalH
    // Enforce top >= 12px => y >= -(winH - 104 - modalH - 12)
    // Enforce bottom >= 12px => 104 - y >= 12 => y <= 92
    const minY = -Math.max(0, winH - 104 - modalH - 12);
    const maxY = 92;

    return {
      x: Math.max(minX, Math.min(maxX, rawX)),
      y: Math.max(minY, Math.min(maxY, rawY))
    };
  }, [modalLeft, isMinimized]);

  // Re-clamp modal position whenever it expands/collapses, toggles sections, or window resizes
  React.useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const enforceBounds = () => {
      if (dragRef.current.isDragging) return;
      setDragOffset(prev => {
        const next = clampModalOffset(prev.x, prev.y);
        dragRef.current.currentX = next.x;
        dragRef.current.currentY = next.y;
        if (modalContainerRef.current) {
          modalContainerRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        }
        return (next.x !== prev.x || next.y !== prev.y) ? next : prev;
      });
    };
    const rafId = window.requestAnimationFrame(enforceBounds);
    window.addEventListener('resize', enforceBounds);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', enforceBounds);
    };
  }, [isOpen, isMinimized, modalLeft, tpConfig.enabled, slConfig.enabled, isIceberg, clampModalOffset]);

  // Ultra-Smooth 120fps GPU Mouse & Touch Drag Handler (Zero React re-renders & zero layout thrashing during drag)
  const handleStartDrag = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const isTouch = 'touches' in e;

    // For mouse events, only allow primary mouse button (left-click)
    if (!isTouch && (e as React.MouseEvent).button !== 0) return;

    // Do not initiate drag if clicking/tapping on interactive controls (buttons, inputs, select)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('select')) {
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
    const modalW = modalEl?.offsetWidth || 320;
    const modalH = modalEl?.offsetHeight || (isMinimized ? 110 : 580);

    const drag = dragRef.current;
    drag.isDragging = true;
    drag.startX = startClientX;
    drag.startY = startClientY;
    drag.originX = dragOffset.x;
    drag.originY = dragOffset.y;
    drag.currentX = dragOffset.x;
    drag.currentY = dragOffset.y;
    drag.minX = -modalLeft + 10;
    drag.maxX = Math.max(drag.minX, winW - modalLeft - modalW - 10);
    drag.minY = -Math.max(0, winH - 104 - modalH - 12);
    drag.maxY = 92;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    // Shield underlying LightweightCharts / OrderFlowHeatmap canvas from receiving mousemove / crosshair events during drag
    document.body.style.pointerEvents = 'none';

    // Temporarily suspend expensive 24px Gaussian backdrop-filter blur over live 60fps WebGL/Canvas while dragging
    if (modalEl) {
      modalEl.style.pointerEvents = 'auto';
      modalEl.style.backdropFilter = 'none';
      (modalEl.style as any).webkitBackdropFilter = 'none';
      modalEl.style.backgroundColor = isMinimized ? 'rgba(9, 13, 22, 0.98)' : 'rgba(6, 9, 15, 0.96)';
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

      setDragOffset({ x: drag.currentX, y: drag.currentY });
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
  }, [dragOffset.x, dragOffset.y, modalLeft, isMinimized]);

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

  // Derive base and quote currency from symbol (e.g. DOGE/USDC or DOGE/USDT:USDT)
  const baseCurrency = activeSymbol.split('/')[0] || 'BASE';
  const quoteCurrency = (activeSymbol.split('/')[1] || 'QUOTE').split(':')[0];

  // Determine if it is a futures pair (CCXT futures symbols usually contain a colon, e.g. BTC/USDT:USDT)
  const isFutures = activeSymbol.includes(':');

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
    const defaultPct = isTp ? 0.35 : 0.15;
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

    let maxValue = 0;
    if (mode === 'quote') {
      if (futures) {
        maxValue = (balance.quote_free || 0) * lev;
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
  }, []);

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

  const handleTrade = async (side: 'Buy' | 'Sell') => {
    if (!selectedApi) {
      toast.error('Please select an API Key to execute the trade.');
      setIsMinimized(false);
      return;
    }

    // Sync tradeSide and recalculate percentage-based size when clicking Buy/Sell for the opposite side (e.g. in Minimized mode)
    let resolvedSizeStr = size;
    if (side !== tradeSide) {
      setTradeSide(side);
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

    // Convert quote amount → base amount if needed
    let baseAmount = Number(resolvedSizeStr);
    if (sizeMode === 'quote') {
      const convPrice = effectiveOrderPrice || effectiveCurrentPrice;
      if (!convPrice || convPrice <= 0) {
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
        amount: baseAmount,
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
            smart_chase_deviation_pct: slConfig.smartChaseDeviationPct,
            smart_chase_delay_ms: slConfig.smartChaseDelayMs,
            smart_chase_max_attempts: slConfig.smartChaseMaxAttempts,
            smart_chase_mode: slConfig.smartChaseMode,
            smart_chase_trigger_source: slConfig.smartChaseTriggerSource,
            smart_chase_peg_strategy: slConfig.smartChasePegStrategy,
            smart_chase_wall_multiplier: slConfig.smartChaseWallMultiplier,
            auto_breakeven_enabled: slConfig.autoBreakevenEnabled,
            auto_breakeven_trigger_pct: slConfig.autoBreakevenTriggerPct,
            auto_breakeven_buffer_pct: slConfig.autoBreakevenBufferPct
          };
        }
      }

      await manualTradeService.placeOrder(payload);
      toast.success(orderType === 'SmartPeg' ? `⚡ ${side} Smart Peg Entry active for ${activeSymbol}` : `✅ ${side} ${orderType} order placed for ${activeSymbol}`);

      // Auto-refresh balance immediately after order placement, followed by staggered syncs
      fetchBalance(true);
      setTimeout(() => fetchBalance(true), 1200);
      setTimeout(() => fetchBalance(true), 2500);
    } catch (error: any) {
      // BUG-02 fix: Read FastAPI detail message if available
      const errMsg = error?.response?.data?.detail || error?.message || 'Unknown error occurred';
      toast.error(`❌ Order failed: ${errMsg}`);
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
            className={`absolute inset-0 w-full h-full rounded-full flex items-center justify-center border text-white backdrop-blur-md z-[999] transition-all focus:outline-none group ${
              activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging')
                ? 'bg-gradient-to-r from-red-600 via-amber-600 to-amber-500 border-amber-400 animate-pulse shadow-[0_0_20px_rgba(245,158,11,0.7)]'
                : `bg-brand-primary hover:bg-blue-600 border-blue-400/30 ${buttonSize === 'sm' ? 'shadow-[0_0_12px_rgba(59,130,246,0.4)]' : 'shadow-[0_0_20px_rgba(59,130,246,0.4)]'}`
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
          </MotionButton>
        )}
      </AnimatePresence>

      {/* Floating Emergency Stop Banner when modal is closed */}
      {typeof document !== 'undefined' && !isOpen && activeBrackets.some(b => b.status === 'chasing' || b.status === 'pegging') && createPortal(
        (() => {
          const activePeg = activeBrackets.find(b => b.status === 'pegging');
          const activeChase = activeBrackets.find(b => b.status === 'chasing');
          return (
            <div className="fixed bottom-[104px] right-24 z-[99998] flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-[#0c0204]/95 border border-amber-500/70 shadow-[0_0_25px_rgba(245,158,11,0.35)] backdrop-blur-xl animate-fade-in select-none">
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
              style={{
                left: `${modalLeft}px`,
                bottom: '104px',
                transform: `translate3d(${dragRef.current.isDragging ? dragRef.current.currentX : dragOffset.x}px, ${dragRef.current.isDragging ? dragRef.current.currentY : dragOffset.y}px, 0)`,
                willChange: 'transform'
              }}
              className={`fixed w-80 rounded-2xl ${
                isMinimized
                  ? 'bg-[#090d16]/95 border-cyan-500/40 shadow-[0_8px_32px_rgba(6,182,212,0.25)]'
                  : 'bg-[#000000]/80 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]'
              } backdrop-blur-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none`}
            >
              {isMinimized ? (
                /* MINIMIZED QUICK BUY/SELL VIEW */
                <div
                  onMouseDown={handleStartDrag}
                  onTouchStart={handleStartDrag}
                  style={{ touchAction: 'none' }}
                  className="p-3 select-none"
                >
                  {/* Minimized Drag Handle & Header */}
                  <div
                    onMouseDown={handleStartDrag}
                    onTouchStart={handleStartDrag}
                    style={{ touchAction: 'none' }}
                    className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 cursor-grab active:cursor-grabbing select-none"
                    title="Drag to move"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
                      <GripVertical className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      <div className="flex flex-col min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white text-xs tracking-wide truncate">{activeSymbol}</span>
                          <span className="text-[9px] uppercase px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-400 font-mono font-bold">
                            {isFutures ? 'Futures' : 'Spot'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-mono">
                          {effectiveCurrentPrice > 0 && (
                            <span className="text-emerald-400 font-semibold">${formatDisplayPrice(effectiveCurrentPrice)}</span>
                          )}
                          {size ? (
                            <span className="text-gray-300">
                              • {size} {sizeMode === 'quote' ? quoteCurrency : baseCurrency}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMinimized(false);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                        title="Expand Settings (Size, TP/SL, Leverage)"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
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
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                        title="Close"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Quick Buy & Sell Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrade('Buy');
                      }}
                      className="py-2.5 px-3 rounded-xl font-bold flex flex-col items-center justify-center bg-gradient-to-br from-emerald-500/25 to-green-600/30 hover:from-emerald-500 hover:to-green-600 text-emerald-400 hover:text-white border border-emerald-500/40 hover:border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer group"
                    >
                      <div className="flex items-center gap-1.5">
                        {isSubmitting && submittingSide === 'Buy' ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                        ) : (
                          <TrendingUp className="w-4 h-4 text-emerald-400 group-hover:text-white group-hover:-translate-y-0.5 transition-transform" />
                        )}
                        <span className="text-xs uppercase tracking-wider font-extrabold">
                          {isSubmitting && submittingSide === 'Buy' ? 'Buying...' : isFutures ? 'BUY / LONG' : 'BUY'}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-emerald-300/80 group-hover:text-white/90">
                        {orderType === 'SmartPeg' ? 'Smart Peg' : orderType}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTrade('Sell');
                      }}
                      className="py-2.5 px-3 rounded-xl font-bold flex flex-col items-center justify-center bg-gradient-to-br from-rose-500/25 to-red-600/30 hover:from-rose-500 hover:to-red-600 text-rose-400 hover:text-white border border-rose-500/40 hover:border-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] hover:shadow-[0_0_20px_rgba(244,63,94,0.5)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer group"
                    >
                      <div className="flex items-center gap-1.5">
                        {isSubmitting && submittingSide === 'Sell' ? (
                          <RefreshCw className="w-4 h-4 animate-spin text-rose-400" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-rose-400 group-hover:text-white group-hover:translate-y-0.5 transition-transform" />
                        )}
                        <span className="text-xs uppercase tracking-wider font-extrabold">
                          {isSubmitting && submittingSide === 'Sell' ? 'Selling...' : isFutures ? 'SELL / SHORT' : 'SELL'}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-rose-300/80 group-hover:text-white/90">
                        {orderType === 'SmartPeg' ? 'Smart Peg' : orderType}
                      </span>
                    </button>
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
                const activeSoftwareSl = activeBrackets.find(b => b.status === 'monitoring' && (b.type === 'smart_chase' || b.type === 'trailing_chase' || b.type === 'trailing' || b.auto_breakeven_enabled));

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

                if (activeSoftwareSl) {
                  const isChase = activeSoftwareSl.type === 'smart_chase';
                  const isTrailChase = activeSoftwareSl.type === 'trailing_chase';
                  const titleLabel = isTrailChase 
                    ? '⚡ Trailing Chase Armed' 
                    : (isChase ? '⚡ Smart Chase Armed' : (activeSoftwareSl.type === 'trailing' ? '⚡ Trailing SL Armed' : '🛡️ Stop-Loss Armed'));

                  return (
                    <div className="p-2.5 rounded-xl bg-blue-950/60 border border-blue-500/40 shadow-sm flex items-center justify-between gap-2 animate-fadeIn">
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
                }

                return null;
              })()}

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
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Live Auto-Sync Active (5.5s)" />
                      <span>Balance:</span>
                      <span className="text-gray-200 font-semibold font-mono">
                        {isLoadingBalance ? "..." : balanceData ? (
                          sizeMode === 'quote'
                            ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                            : isFutures
                              ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                              : tradeSide === 'Buy'
                                ? `${(balanceData.quote_free || 0).toFixed(2)} ${quoteCurrency}`
                                : `${(balanceData.base_free || 0).toFixed(4)} ${baseCurrency}`
                        ) : "N/A"}
                      </span>
                    </div>

                    {/* Show Locked / In-Orders Balance if any */}
                    {balanceData && (
                      (() => {
                        const isQuoteTarget = sizeMode === 'quote' || (isFutures ? true : tradeSide === 'Buy');
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
                        Pos: {isLoadingPosition ? "..." : (positionData && positionData.amount > 0 ? `${positionData.amount} (${positionData.side.toUpperCase()})` : "0")}
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
                    placeholder="0.00"
                    className="w-full bg-black/30 border border-white/10 rounded-lg py-2 px-3 pl-8 text-white text-sm focus:outline-none focus:border-brand-primary/50 transition-colors"
                  />
                  {/* Currency symbol badge */}
                  <span className="absolute left-2.5 top-2 text-[11px] font-bold text-gray-500">
                    {sizeMode === 'quote' ? '$' : baseCurrency.slice(0, 3)}
                  </span>
                </div>

                {/* Live conversion estimate */}
                {size && Number(size) > 0 && effectiveOrderPrice > 0 && (
                  <div className="flex items-center gap-1 px-1 pt-0.5">
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
                              onClick={() => setIcebergMode('qty')}
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
                            placeholder={icebergMode === 'percent' ? 'e.g. 20' : `e.g. 100 ${baseCurrency}`}
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
                          <span className="text-[10px] text-gray-500">Auto-trigger market stop to manage risk</span>
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
                            {/* Layout Grid */}
                            <div className="grid grid-cols-2 gap-2">
                                {/* SL Type */}
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">SL Type</label>
                                    <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                        <button
                                            onClick={() => setSlConfig({
                                                ...slConfig,
                                                type: 'fixed',
                                                mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                                                value: slConfig.mode === 'atr' ? getSmartGapValue('percentage', false) : slConfig.value
                                            })}
                                            className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'fixed' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            Fixed
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({
                                                ...slConfig,
                                                type: 'trailing',
                                                mode: slConfig.mode === 'absolute' ? 'percentage' : slConfig.mode,
                                                value: slConfig.mode === 'absolute' ? getSmartGapValue('percentage', false) : slConfig.value
                                            })}
                                            className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'trailing' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            Trailing
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({
                                                ...slConfig,
                                                type: 'smart_chase',
                                                mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode,
                                                value: slConfig.mode === 'atr' ? getSmartGapValue('percentage', false) : slConfig.value
                                            })}
                                            className={`flex-1 text-[8.5px] py-1 rounded transition-colors ${slConfig.type === 'smart_chase' ? 'bg-gradient-to-r from-red-500 to-amber-500 text-white font-bold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                                            title="Smart Chase Limit (Maker Post-Only Exit with Circuit Breaker)"
                                        >
                                            Smart Chase
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({
                                                ...slConfig,
                                                type: 'trailing_chase',
                                                mode: (slConfig.mode === 'absolute' || slConfig.mode === 'atr') ? 'percentage' : slConfig.mode,
                                                value: (slConfig.mode === 'absolute' || slConfig.mode === 'atr') ? getSmartGapValue('percentage', false) : slConfig.value
                                            })}
                                            className={`flex-1 text-[8px] py-1 rounded transition-colors ${slConfig.type === 'trailing_chase' ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-cyan-500 text-white font-bold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                                            title="Trailing Smart Chase (Trails in profit + exits via Zero-Fee Maker Limit order)"
                                        >
                                            ⚡ Trail Chase
                                        </button>
                                    </div>
                                </div>

                                {/* Gap Mode */}
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">Mode</label>
                                    <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                        <button
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
                                                onClick={() => setSlConfig({...slConfig, mode: 'atr', type: 'trailing'})}
                                                className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'atr' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                            >
                                                ATR
                                            </button>
                                        )}
                                    </div>
                                </div>
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
    </>
  );
};
