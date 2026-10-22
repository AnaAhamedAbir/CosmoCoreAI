import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, ChevronDown, RefreshCw, Square, ShieldAlert, Zap } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { manualTradeService, ApiKey, FastBalanceResponse, FastPositionResponse } from '../../../services/manualTradeService';

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
  const dragControls = useDragControls();
  const [isOpen, setIsOpen] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState<string>(symbol);

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

  const [orderType, setOrderType] = useState<'Market' | 'Limit'>('Limit');
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
    value: '0.0003',
    orderType: 'Limit' as 'Limit' | 'Market',
    timeoutMins: 60
  });
  const [slConfig, setSlConfig] = useState({
    enabled: true,
    type: 'fixed' as 'fixed' | 'trailing' | 'smart_chase',
    mode: 'price' as 'percentage' | 'price' | 'absolute' | 'atr',
    value: '0.0001',
    atrPeriod: 10,
    atrMultiplier: 2.0,
    atrTimeframe: '15m',
    timeoutMins: 60,
    smartChaseDeviationPct: 1.0,
    smartChaseDelayMs: 1500,
    smartChaseMaxAttempts: 15
  });
  const [useNativeTpSl, setUseNativeTpSl] = useState<boolean>(true);
  const [activeBrackets, setActiveBrackets] = useState<any[]>([]);
  const [isStoppingChase, setIsStoppingChase] = useState(false);

  // Poll active software brackets and actively running smart chases
  const fetchActiveBrackets = React.useCallback(async () => {
    if (!selectedApi || !isOpen) return;
    try {
      const data = await manualTradeService.getActiveSoftwareBrackets(Number(selectedApi), activeSymbol);
      setActiveBrackets(data || []);
    } catch (err) {
      // silent background check
    }
  }, [selectedApi, activeSymbol, isOpen]);

  React.useEffect(() => {
    if (!isOpen || !selectedApi) return;
    fetchActiveBrackets();
    const interval = setInterval(fetchActiveBrackets, 1500);
    return () => clearInterval(interval);
  }, [isOpen, selectedApi, activeSymbol, fetchActiveBrackets]);

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

  // Fetch API Keys
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
    if (isOpen) fetchKeys();
  }, [isOpen, onApiKeyChange]); // BUG-04 fixed: onApiKeyChange added to deps

  // BUG-12 fix: Reset size and mode when symbol changes to avoid stale amounts on wrong pair
  React.useEffect(() => {
    setSize('');
    setSizeMode('base');
    setBalanceData(null);
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

  // Size mode: 'base' = in token (DOGE), 'quote' = in USD (USDC/USDT)
  const [sizeMode, setSizeMode] = useState<'base' | 'quote'>('base');

  // Derive base and quote currency from symbol (e.g. DOGE/USDC or DOGE/USDT:USDT)
  const baseCurrency = activeSymbol.split('/')[0] || 'BASE';
  const quoteCurrency = (activeSymbol.split('/')[1] || 'QUOTE').split(':')[0];

  // Determine if it is a futures pair (CCXT futures symbols usually contain a colon, e.g. BTC/USDT:USDT)
  const isFutures = activeSymbol.includes(':');

  // For Limit orders
  const [limitPrice, setLimitPrice] = useState<string>(effectiveCurrentPrice ? effectiveCurrentPrice.toString() : '');

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
    if (selectedPercent && balanceData && effectiveCurrentPrice > 0) {
      const calculated = calculateSize(
        selectedPercent,
        balanceData,
        effectiveCurrentPrice,
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
    effectiveCurrentPrice,
    sizeMode,
    tradeSide,
    isFutures,
    leverage,
    reduceOnly,
    positionData,
    calculateSize
  ]);

  const lastTriggerRef = React.useRef<number>(openTrigger || 0);

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
      return;
    }

    if (!size || isNaN(Number(size)) || Number(size) <= 0) {
      toast.error('Please enter a valid size');
      return;
    }

    if (tpConfig.enabled && (!tpConfig.value || isNaN(Number(tpConfig.value)) || Number(tpConfig.value) <= 0)) {
      toast.error('Please enter a valid target gap for the Attached TP.');
      return;
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
      if (slConfig.type === 'smart_chase' && (!slConfig.smartChaseDeviationPct || slConfig.smartChaseDeviationPct <= 0)) {
        toast.error('Please enter a valid Max Deviation (%) for Smart Chase.');
        return;
      }
    }

    // Convert quote amount → base amount if needed
    let baseAmount = Number(size);
    if (sizeMode === 'quote') {
      if (!effectiveCurrentPrice || effectiveCurrentPrice <= 0) {
        toast.error('Cannot convert: current price is unavailable.');
        return;
      }
      baseAmount = Number(size) / effectiveCurrentPrice;
    }
    
    setIsSubmitting(true);
    try {
      if (orderType === 'Limit' && !isAutoLimit && (!limitPrice || Number(limitPrice) <= 0)) {
        toast.error('Please enter a valid limit price or enable Auto Limit.');
        return; // finally block handles setIsSubmitting(false)
      }

      const paramsPayload: any = isFutures ? { leverage, marginMode, reduceOnly } : {};
      if (orderType === 'Limit' && isAutoLimit) {
        paramsPayload.autoBestLimit = true;
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
        use_native_tp_sl: (!isFutures && !(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr'))) ? Boolean(useNativeTpSl) : false
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
            smart_chase_max_attempts: slConfig.smartChaseMaxAttempts
          };
        }
      }

      await manualTradeService.placeOrder(payload);
      toast.success(`✅ ${side} ${orderType} order placed for ${activeSymbol}`);

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
            onClick={() => setIsOpen(true)}
            className={`absolute inset-0 w-full h-full rounded-full flex items-center justify-center bg-brand-primary hover:bg-blue-600 border border-blue-400/30 text-white ${buttonSize === 'sm' ? 'shadow-[0_0_12px_rgba(59,130,246,0.4)]' : 'shadow-[0_0_20px_rgba(59,130,246,0.4)]'} backdrop-blur-md z-[999] transition-colors focus:outline-none group`}
            title="Manual Trade"
          >
            <DollarSign className={`${buttonSize === 'sm' ? 'w-5 h-5' : 'w-8 h-8'} group-hover:scale-110 transition-transform`} />
          </MotionButton>
        )}
      </AnimatePresence>

      {/* Glassmorphism Modal */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {isOpen && (
            <MotionDiv
              drag
              dragControls={dragControls}
              dragListener={false}
              dragMomentum={false}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ touchAction: 'none' }}
              className="fixed bottom-[104px] right-8 w-80 rounded-2xl bg-[#000000]/80 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-[99999] overflow-hidden"
            >
              {/* Header (Drag area) */}
              <div 
                onPointerDown={(e: React.PointerEvent) => {
                  dragControls.start(e);
                }}
                className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/5 cursor-grab active:cursor-grabbing select-none"
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
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setIsOpen(false); 
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
              <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1 pb-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/20">

              {/* ACTIVE SMART CHASE / SOFTWARE SL LIVE STATUS & CANCEL BUTTON */}
              {(() => {
                const activeChase = activeBrackets.find(b => b.status === 'chasing');
                const activeSoftwareSl = activeBrackets.find(b => b.status === 'monitoring' && b.type === 'smart_chase');

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
                            Smart Chase SL Chasing
                          </span>
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          Attempt {activeChase.current_attempt || 1}/{activeChase.max_attempts || 15}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] bg-black/60 p-2 rounded-lg border border-white/5 font-mono">
                        <div className="text-left">
                          <span className="text-gray-400 block text-[9px] uppercase">SL Trigger</span>
                          <span className="text-white font-bold">{activeChase.trigger_price || '—'}</span>
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
                  return (
                    <div className="p-2.5 rounded-xl bg-blue-950/60 border border-blue-500/40 shadow-sm flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0" />
                        <div className="flex flex-col text-left">
                          <span className="text-[11px] font-bold text-cyan-300 uppercase leading-tight">Smart Chase Armed</span>
                          <span className="text-[10px] text-gray-300 font-mono">
                            SL @ {activeSoftwareSl.trigger_price || activeSoftwareSl.price} ({activeSoftwareSl.amount})
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

              {/* Order Type Toggle */}
              <div className="flex p-1 rounded-lg bg-black/40 border border-white/5">
                {(['Market', 'Limit'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setOrderType(type)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all uppercase tracking-wider ${
                      orderType === type 
                        ? 'bg-brand-primary text-white shadow-sm' 
                        : 'text-gray-500 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

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
                {size && Number(size) > 0 && effectiveCurrentPrice > 0 && (
                  <div className="flex items-center gap-1 px-1 pt-0.5">
                    <span className="text-[10px] text-gray-600">≈</span>
                    {sizeMode === 'quote' ? (
                      <span className="text-[10px] text-yellow-400 font-semibold">
                        {(Number(size) / effectiveCurrentPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })} {baseCurrency}
                      </span>
                    ) : (
                      <span className="text-[10px] text-yellow-400 font-semibold">
                        ${(Number(size) * effectiveCurrentPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })} {quoteCurrency}
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
                          if (balanceData && effectiveCurrentPrice > 0) {
                            const newSize = calculateSize(
                              pct,
                              balanceData,
                              effectiveCurrentPrice,
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

              {/* Native Binance TP/SL Toggle */}
              {(tpConfig.enabled || slConfig.enabled) && !isFutures && (
                <div className={`flex justify-between items-center bg-brand-primary/10 p-2 rounded border border-brand-primary/30 transition-opacity ${(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr')) ? 'opacity-30 pointer-events-none' : ''}`}>
                  <div className="flex flex-col">
                      <span className="text-xs font-bold text-brand-primary">Use Native Binance OTO/OTOCO</span>
                      <span className="text-[9px] text-brand-primary/80">{(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr')) ? '⚠️ Auto-disabled: Trailing/Smart Chase/ATR SL is active' : 'Exchange atomic bracket (100% crash proof)'}</span>
                  </div>
                  <div className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${useNativeTpSl && !(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr')) ? 'bg-brand-primary' : 'bg-gray-600'}`} onClick={() => {
                      if (!(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr'))) {
                          setUseNativeTpSl(!useNativeTpSl);
                      }
                  }}>
                      <MotionDiv 
                          className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full"
                          animate={{ x: (useNativeTpSl && !(slConfig.enabled && (slConfig.type === 'trailing' || slConfig.type === 'smart_chase' || slConfig.mode === 'atr'))) ? 16 : 0 }}
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
                                            onClick={() => setTpConfig({...tpConfig, mode: 'percentage'})}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.mode === 'percentage' ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            %
                                        </button>
                                        <button
                                            onClick={() => setTpConfig({...tpConfig, mode: 'price'})}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${tpConfig.mode === 'price' ? 'bg-brand-primary text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            $
                                        </button>
                                        <button
                                            onClick={() => setTpConfig({...tpConfig, mode: 'absolute'})}
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
                                    <label className="text-[10px] text-gray-400 font-medium">Monitor Limit (Mins)</label>
                                    <div className="flex items-center space-x-2">
                                        <input 
                                            type="range"
                                            min="0" max="60" step="1"
                                            value={tpConfig.timeoutMins}
                                            onChange={(e) => setTpConfig({...tpConfig, timeoutMins: Number(e.target.value)})}
                                            className="w-full accent-brand-primary h-1 bg-black/50 rounded appearance-none"
                                        />
                                        <span className="text-[10px] text-gray-300 w-4 text-right">{tpConfig.timeoutMins === 0 ? '∞' : tpConfig.timeoutMins}</span>
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
                                            onClick={() => setSlConfig({...slConfig, type: 'fixed', mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode})}
                                            className={`flex-1 text-[9px] py-1 rounded transition-colors ${slConfig.type === 'fixed' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            Fixed
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({...slConfig, type: 'trailing', mode: slConfig.mode === 'absolute' ? 'percentage' : slConfig.mode})}
                                            className={`flex-1 text-[9px] py-1 rounded transition-colors ${slConfig.type === 'trailing' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            Trailing
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({...slConfig, type: 'smart_chase', mode: slConfig.mode === 'atr' ? 'percentage' : slConfig.mode})}
                                            className={`flex-1 text-[9px] py-1 rounded transition-colors ${slConfig.type === 'smart_chase' ? 'bg-gradient-to-r from-red-500 to-amber-500 text-white font-bold shadow-sm' : 'text-gray-500 hover:text-white'}`}
                                            title="Smart Chase Limit (Maker Post-Only Exit with Circuit Breaker)"
                                        >
                                            Smart Chase
                                        </button>
                                    </div>
                                </div>

                                {/* Gap Mode */}
                                <div className="space-y-1">
                                    <label className="text-[10px] text-gray-400 font-medium">Mode</label>
                                    <div className="flex bg-black/40 rounded border border-white/5 p-0.5">
                                        <button
                                            onClick={() => setSlConfig({...slConfig, mode: 'percentage'})}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'percentage' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            %
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({...slConfig, mode: 'price'})}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'price' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            $
                                        </button>
                                        <button
                                            onClick={() => setSlConfig({...slConfig, mode: 'absolute', type: slConfig.type === 'trailing' ? 'fixed' : slConfig.type})}
                                            className={`flex-1 text-[10px] py-1 rounded transition-colors ${slConfig.mode === 'absolute' ? 'bg-red-500 text-white font-bold' : 'text-gray-500 hover:text-white'}`}
                                        >
                                            🎯
                                        </button>
                                        {slConfig.type !== 'smart_chase' && (
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
                                            {slConfig.mode === 'absolute' ? 'Exact Price' : (slConfig.type === 'smart_chase' ? 'Chase Trigger Gap' : (slConfig.type === 'trailing' ? 'Callback Rate/Distance' : 'Stop Gap'))}
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
                                    <label className="text-[10px] text-gray-400 font-medium">Monitor Limit (Mins)</label>
                                    <div className="flex items-center space-x-2">
                                        <input 
                                            type="range"
                                            min="0" max="60" step="1"
                                            value={slConfig.timeoutMins}
                                            onChange={(e) => setSlConfig({...slConfig, timeoutMins: Number(e.target.value)})}
                                            className="w-full accent-red-500 h-1 bg-black/50 rounded appearance-none"
                                        />
                                        <span className="text-[10px] text-gray-300 w-4 text-right">{slConfig.timeoutMins === 0 ? '∞' : slConfig.timeoutMins}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Smart Chase Detailed Controls */}
                            {slConfig.type === 'smart_chase' && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5 space-y-2 mt-1 animate-fadeIn">
                                    <div className="flex items-center justify-between text-[10px]">
                                        <span className="font-bold text-red-400 flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                            Smart Chase Settings (Maker Post-Only)
                                        </span>
                                        <span className="text-[9px] text-amber-400 font-mono font-bold">Circuit: {slConfig.smartChaseDeviationPct}%</span>
                                    </div>

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
                                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                                        <div className="space-y-1">
                                            <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                <span>Retries</span>
                                                <span className="text-[8px] text-gray-500">0 = ∞</span>
                                            </label>
                                            <input 
                                                type="number"
                                                min="0" max="999" step="1"
                                                value={slConfig.smartChaseMaxAttempts}
                                                onChange={(e) => setSlConfig({...slConfig, smartChaseMaxAttempts: parseInt(e.target.value) || 0})}
                                                placeholder="15"
                                                className="w-full bg-black/40 border border-white/10 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-red-500/50"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[9px] text-gray-400 font-medium flex justify-between">
                                                <span>Delay (ms)</span>
                                                <span className="text-[8px] text-gray-500">Throttle</span>
                                            </label>
                                            <input 
                                                type="number"
                                                min="200" max="2000" step="100"
                                                value={slConfig.smartChaseDelayMs}
                                                onChange={(e) => setSlConfig({...slConfig, smartChaseDelayMs: parseInt(e.target.value) || 1500})}
                                                placeholder="1500"
                                                className="w-full bg-black/40 border border-white/10 rounded py-1 px-2 text-white text-[10px] text-center font-mono focus:outline-none focus:border-red-500/50"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
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
                     tradeSide === 'Buy' 
                       ? 'bg-green-500/20 hover:bg-green-500 text-green-400 hover:text-white border-green-500/50 hover:shadow-[0_0_15px_rgba(34,197,94,0.4)]'
                       : 'bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {tradeSide === 'Buy' ? <TrendingUp className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" /> : <TrendingDown className="w-5 h-5 group-hover:translate-y-0.5 transition-transform" />}
                    <span className="text-sm uppercase tracking-wider">Execute {isFutures ? (tradeSide === 'Buy' ? 'Long' : 'Short') : tradeSide}</span>
                  </div>
                </button>
              </div>
            </div>
            
            {/* Footer Status */}
            <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center justify-center">
              <span className="text-[10px] text-gray-500 flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2 animate-pulse shadow-[0_0_5px_rgba(34,197,94,0.8)]"></span>
                Secure Execution via API
              </span>
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>,
      document.body
    )}
    </>
  );
};
