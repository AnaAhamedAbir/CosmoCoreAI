import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { createChart, ISeriesApi, CandlestickData, CandlestickSeries, LineSeries, HistogramSeries, HistogramData, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import { WickSRRenderer } from '../../components/features/market/WickSRRenderer';
import { LiquiditySweepAbsorptionRenderer } from '../../components/features/market/LiquiditySweepAbsorptionRenderer';
import { useLiquiditySweepAbsorption } from '../../hooks/useLiquiditySweepAbsorption';
import { useLevel2MarketData, subscribeLiveTradeTicks, subscribeLiveBbo, subscribeLiveMarkPrice, getLatestLiveBbo, getLatestLiveTick, getLatestMarkPrice } from '@/hooks/useLevel2MarketData';
import { SpreadCorridorPrimitive } from '../../components/features/market/SpreadCorridorPrimitive';
import { LiveFeedHealthBadge } from '../../components/features/market/LiveFeedHealthBadge';
import { SweepMomentumTracker } from '../../utils/sweepMomentumTracker';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { useOrderFlowData } from '../../hooks/useOrderFlowData';
import { useHeatmapData } from '../../hooks/useHeatmapData';
import { useIcebergEvents } from '../../hooks/useIcebergEvents.tsx';
import { useMLSetupEvents } from '../../hooks/useMLSetupEvents';
import { useVolumeFilter } from '../../hooks/useVolumeFilter';
import { marketDepthService } from '../../services/marketDepthService';
import { HeatmapSymbolSelector } from '../../components/features/market/HeatmapSymbolSelector';
import { TimeframeSelector } from '../../components/features/market/TimeframeSelector';
import { VolumeFilterControl } from '../../components/features/market/VolumeFilterControl';
import { LiquidityHeatmapRenderer, HeatmapDataPoint, HeatmapPalette } from '../../components/features/market/LiquidityHeatmapRenderer';
import { ChartWatermark } from '../../components/features/market/ChartWatermark';
import { VolumeProfileWidget, VPVRData } from '../../components/features/market/VolumeProfileWidget';
import { CVDChart, CVDDataPoint } from '../../components/features/market/CVDChart';
import { FootprintRenderer, FootprintCandleData, FootprintDataTick, FootprintMode } from '../../components/features/market/FootprintRenderer';
import { LiquidationRenderer } from '../../components/features/market/LiquidationRenderer';
import { SmartMoneyHUD } from '../../components/features/market/SmartMoneyHUD';
import { useGodModeData } from '../../hooks/useGodModeData';
import { FibonacciCloudRenderer, FibonacciData } from '../../components/features/market/FibonacciCloudRenderer';
import { IchimokuRenderer } from '../../components/features/market/IchimokuRenderer';
import { calculateQuantumAi, QuantumAiResult } from '../../utils/quantumAi';
import { calculateGodModeSignal } from '../../utils/godModeSignal';
import { safeRemoveChart } from '@/utils/chartLifecycle';
import { IndicatorSelector, IndicatorSettings } from '../../components/features/market/IndicatorSelector';
import { MACDRenderer } from '../../components/features/market/MACDRenderer';
import { calculateEMA, calculateBollingerBands, BollingerBandsDataPoint, calculateMACD, calculateRSI, updateEMA, updateBollingerBands, updateRSI, calculateIchimoku, IchimokuDataPoint, calculateAdaptiveTrendFinder, TrendFinderResult, calculateUTBotAlerts, UTBotDataPoint, calculateSessions, SessionData, calculateSupertrend, SupertrendDataPoint, calculateMsbOb, MsbObResult, calculateWickRejectionSR, WickSRResult, calculateVWAPSD, VWAPSDDataPoint, calculateMTFEMA, DEFAULT_EMA_TIMEFRAMES, intervalToSeconds } from '../../utils/indicators';
import { TrendFinderRenderer } from '../../components/features/market/TrendFinderRenderer';
import { SessionsRenderer } from '../../components/features/market/SessionsRenderer';
import { SupertrendRenderer } from '../../components/features/market/SupertrendRenderer';
import { UTBotPrimitive } from '../../components/features/market/UTBotPrimitive';
import { UTBotHUD, playUTBotSignalSound } from '../../components/features/market/UTBotHUD';
import { calculateUTBotPro, UTBotProResult } from '../../utils/utBotPro';
import { MsbObRenderer } from '../../components/features/market/MsbObRenderer';
import { SMCRenderer } from '../../components/features/market/SMCRenderer';
import { calculateSMC, SMCResult, DEFAULT_SMC_SETTINGS } from '../../utils/smartMoneyConcepts';
import { calculateICTSuite, ICTResult } from '../../utils/ictKillzones';
import { ICTKillzonesRenderer } from '../../components/features/market/ICTKillzonesRenderer';
import { calculateLuxIctConcepts, LuxIctResult } from '../../utils/luxIctConcepts';
import { LuxIctRenderer } from '../../components/features/market/LuxIctRenderer';
import { BollingerBandsRenderer } from '../../components/features/market/BollingerBandsRenderer';
import { ICTPO3Renderer, ICTPO3Data } from '../../components/features/market/ICTPO3Renderer';
import { SessionsDashboard, SessionStatus } from '../../components/features/market/SessionsDashboard';
import { HeatmapSubNav } from '../../components/features/market/HeatmapSubNav';
import { useTheme } from '@/context/ThemeContext';
import { BotLogsFloatingModal } from '../../components/features/market/BotLogsFloatingModal';
import { WallHunterModal } from '../../components/features/market/WallHunterModal';
import { ForexWallHunterModal } from '../../components/features/market/ForexWallHunterModal';
import { OrderBookFloatingModal } from '../../components/features/market/OrderBookFloatingModal';
import { TechnicalIndicatorModal } from '../../components/features/market/TechnicalIndicators/TechnicalIndicatorModal';
import { ManualTradeModal, AvailablePair } from '../../components/features/market/ManualTradeModal';
import { snapPriceToWallMagnet, formatWallSizeCompact, OrderbookWall } from '../../utils/liquidityWallMagnet';
import { FloatingTVChartButton } from '../../components/features/market/FloatingTVChartButton';
import { AetherFlowRenderer } from '../../components/features/market/AetherFlowRenderer';
import { useAetherFlowData } from '../../hooks/useAetherFlowData';
import { AIModelDeploymentModal } from '../../components/features/market/AIModelDeploymentModal';
import { ModelPredictorModal, PredictionResult } from '../../components/features/market/ModelPredictorModal';
import { MLPredictionRenderer } from '../../components/features/market/MLPredictionRenderer';
import { DualEngineDashboard } from '../../components/features/market/DualEngineDashboard';
import { WatchlistScanner } from '../../components/features/market/WatchlistScanner';
import { DeltaProfileRenderer } from '../../components/features/market/AdvancedMetrics/DeltaProfileRenderer';
import { FootprintImbalanceRenderer } from '../../components/features/market/AdvancedMetrics/FootprintImbalanceRenderer';
import { TradeBubbleChartRenderer } from '../../components/features/market/AdvancedMetrics/TradeBubbleChartRenderer';
import { SpoofingDetectionRenderer } from '../../components/features/market/AdvancedMetrics/SpoofingDetectionRenderer';
import { AnchoredVWAPRenderer } from '../../components/features/market/AdvancedMetrics/AnchoredVWAPRenderer';
import { VWAPSDRenderer } from '../../components/features/market/AdvancedMetrics/VWAPSDRenderer';
import { OIBOscillatorRenderer } from '../../components/features/market/AdvancedMetrics/OIBOscillatorRenderer';
import { TPOProfileRenderer } from '../../components/features/market/AdvancedMetrics/TPOProfileRenderer';
import { DeltaDivergenceRenderer } from '../../components/features/market/AdvancedMetrics/DeltaDivergenceRenderer';
import { MLPredictionCloudRenderer } from '../../components/features/market/AdvancedMetrics/MLPredictionCloudRenderer';
import { botService } from '../../services/botService';
import { manualTradeService, FastPositionResponse } from '../../services/manualTradeService';
import { useWallHunterStatus } from '@/hooks/useWallHunterStatus';
import { beginFloatingModalDrag, endFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { toast } from 'react-hot-toast';
import { useMarketStore } from '@/store/marketStore';
import { useBotStore, CLEAN_INDICATOR_SETTINGS } from '@/store/botStore';
import { useUIStore } from '@/store/uiStore';
import { useOpenOrders, OpenLimitOrder } from '../../hooks/useOpenOrders';
import { useActivePosition } from '../../hooks/useActivePosition';
import { TradePositionOverlay, DragPnlPreview } from '../../components/features/market/TradePositionOverlay';
import {
    computeTradePnl,
    formatCompactPnl,
    resolveEffectiveEntryContext,
    resolveOrderEntryContext,
} from '../../utils/positionPnl';
import { useAdvancedMetricsSettings, AdvancedMetricsSettings } from '../../hooks/useAdvancedMetricsSettings';
import { useAdvancedMetrics } from '../../hooks/useAdvancedMetrics';
import { TradingViewWidget } from '../../components/features/market/TradingViewWidget';
import { TopTokensModal } from '../../components/TopTokensModal';
import { CandlestickTooltip, TooltipCandleData } from '../../components/features/market/CandlestickTooltip';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, SlidersHorizontal, Zap, X } from 'lucide-react';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import {
    intervalToMs,
    alignCandleBucketSec,
    alignCandleBucketMs,
    getNextCandleCloseMs,
    sanitizeAndSortCandles,
} from '../../utils/candleTime';

// Helper to convert interval string to ms (delegated to modular calendar-aware candleTime utility)
const parseIntervalToMs = (interval: string): number => intervalToMs(interval);

const formatDisplayPrice = (price: number | undefined | null): string => {
    if (price === undefined || price === null || !Number.isFinite(price)) return '---';
    const abs = Math.abs(price);
    if (abs === 0) return '0.00';
    if (abs < 0.000001) return price.toFixed(12);
    if (abs < 0.00001) return price.toFixed(10);
    if (abs < 0.0001) return price.toFixed(8);
    if (abs < 0.001) return price.toFixed(7);
    if (abs < 1) return price.toFixed(5);
    if (abs < 10) return price.toFixed(4);
    return price.toFixed(2);
};

const CandleCountdown = React.memo<{
    interval: string;
    lastCandleRef: React.MutableRefObject<CandlestickData | null>;
    compact?: boolean;
}>(({ interval, lastCandleRef, compact = false }) => {
    const [countdownFormatted, setCountdownFormatted] = useState<string>('');

    useEffect(() => {
        const intervalMs = parseIntervalToMs(interval);

        const tick = () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            const now = Date.now();
            const nextCloseMs = getNextCandleCloseMs(
                lastCandleRef.current ? Number(lastCandleRef.current.time) : null,
                interval,
                now
            );
            const remaining = Math.max(0, nextCloseMs - now);

            const isSubMinute = intervalMs < 60000;
            const totalSec = isSubMinute ? Math.ceil(remaining / 1000) : Math.floor(remaining / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;

            if (h > 0) {
                setCountdownFormatted(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
            } else {
                setCountdownFormatted(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
            }
        };

        tick();
        const timerId = setInterval(tick, intervalMs < 60000 ? 200 : 1000);
        const handleVisibility = () => {
            if (!document.hidden) tick();
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => {
            clearInterval(timerId);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [interval, lastCandleRef]);

    if (!countdownFormatted) return null;

    return (
        <div className={`bg-black/60 dark:bg-black/60 border border-white/10 text-[#d1d5db] font-mono font-bold rounded shadow-lg ${compact || isThermalGuardActive() ? '' : 'backdrop-blur-md'} ${compact ? 'text-[11px] px-2 py-0.5' : 'text-[20px] px-3 py-1.5'}`}>
            {countdownFormatted}
        </div>
    );
});

const startStaggeredInterval = (fn: () => void, intervalMs: number, staggerMs: number): (() => void) => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startTimer = setTimeout(() => {
        fn();
        intervalId = setInterval(fn, intervalMs);
    }, Math.max(0, staggerMs));
    return () => {
        clearTimeout(startTimer);
        if (intervalId) clearInterval(intervalId);
    };
};

interface ChartDragBracketEntry {
    chartId: string;
    symbol: string;
    start: (type: any) => void;
    move: (type: any, clientX: number, clientY: number) => number | null;
    end: (type: any, clientX: number, clientY: number) => { inChart: boolean; price: number | null };
    clearGhost: () => void;
    containsPoint: (clientX: number, clientY: number) => boolean;
}

const chartDragBracketRegistry = new Map<string, ChartDragBracketEntry>();

// Chart Component
const OrderFlowChart = React.memo<{ chartId?: string; exchange: string; symbol: string; interval: string; walls: { price: number, type: 'buy' | 'sell', size?: number }[]; bids?: any[]; asks?: any[]; currentPrice: number; showFootprint: boolean; showCVD: boolean; showVPVR: boolean; indicatorSettings: IndicatorSettings; tradeEvent: any; botStatus: any; openOrders: OpenLimitOrder[]; activePosition?: FastPositionResponse | null; advancedMetrics: AdvancedMetricsSettings; advancedMetricsData: any; selectedApiKeyId: string | null; predictionResult: PredictionResult | null; activeMLModelId: string | null; onAIPredictClick?: (price: number) => void; onChartBackgroundClick?: (price: number) => void; showCrosshairAIPredict?: boolean; bestBid?: number; bestAsk?: number; showLastPriceLine?: boolean; showBidAsk?: boolean; showMarkPrice?: boolean; isActiveChart?: boolean; totalChartsCount?: number; chartSlotIndex?: number; onToggleUTBotAlerts?: () => void; onSyncUTBotToBot?: () => void }>(({ chartId = 'main', exchange, symbol, interval, walls, bids = [], asks = [], currentPrice, showFootprint, showCVD, showVPVR, indicatorSettings, tradeEvent, botStatus, openOrders, activePosition = null, advancedMetrics, advancedMetricsData, selectedApiKeyId, predictionResult, activeMLModelId, onAIPredictClick, onChartBackgroundClick, showCrosshairAIPredict = false, bestBid = 0, bestAsk = 0, showLastPriceLine = true, showBidAsk = false, showMarkPrice = true, isActiveChart = true, totalChartsCount = 1, chartSlotIndex = 0, onToggleUTBotAlerts, onSyncUTBotToBot }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const quickTradeGhostLineRef = useRef<any>(null);
    const chartBracketGhostLineRef = useRef<any>(null);
    const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const emaSeriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
    const htfCandlesCacheRef = useRef<Record<string, { candles: any[]; lastFetch: number }>>({});
    const [mtfEmaValues, setMtfEmaValues] = useState<Record<string, number>>({});
    const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const utBotPrimitiveRef = useRef<UTBotPrimitive | null>(null);
    const prevUTBotStateRef = useRef<boolean>(false);
    const utBotMarkersRef = useRef<any[]>([]);
    const lastAlertedUtBotSigRef = useRef<string>('');
    const lastUtBotHudSigRef = useRef<string>('');
    const lastUtBotCandleCountRef = useRef<number>(0);
    const [utBotHudData, setUtBotHudData] = useState<Pick<UTBotProResult, 'marketBias' | 'backtest' | 'activeSetup' | 'latestAdx' | 'latestRsi'> | null>(null);
    const syncUTBotOverlayRef = useRef<(candles: any[], settings: IndicatorSettings, liveLastOnly?: boolean, isInitialLoad?: boolean) => void>(() => {});
    const mlPredictionMarkersRef = useRef<any[]>([]);
    const quantumAiMarkersRef = useRef<any[]>([]);
    const botTradeMarkersRef = useRef<any[]>([]);
    const patternMarkersRef = useRef<any[]>([]);
    const aetherMarkersRef = useRef<any[]>([]);
    const godModeMarkersRef = useRef<any[]>([]);
    const botStatusIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const wallLinesRef = useRef<Map<string, any>>(new Map());
    const currentPriceLineRef = useRef<any>(null);
    const liquidationLineRef = useRef<any>(null);
    const bidLineRef = useRef<any>(null);
    const askLineRef = useRef<any>(null);
    const markLineRef = useRef<any>(null);
    const spreadCorridorPrimitiveRef = useRef<SpreadCorridorPrimitive | null>(null);
    const lastPriceLineRenderedRef = useRef<{ price: number; side: 'buy' | 'sell' | null; title: string; lineWidth: number }>({
        price: 0,
        side: null,
        title: '',
        lineWidth: 1,
    });
    const lastBidPriceRenderedRef = useRef<number>(0);
    const lastAskPriceRenderedRef = useRef<number>(0);
    const lastMarkPriceRenderedRef = useRef<number>(0);
    const lastBidLabelVisibleRef = useRef<boolean>(true);
    const lastAskLabelVisibleRef = useRef<boolean>(true);
    const lastMarkLabelVisibleRef = useRef<boolean>(true);
    const hasLiveBboRef = useRef<boolean>(false);
    const showLastPriceLineRef = useRef<boolean>(showLastPriceLine);
    showLastPriceLineRef.current = showLastPriceLine;
    const showBidAskRef = useRef<boolean>(showBidAsk);
    showBidAskRef.current = showBidAsk;
    const bestBidPropRef = useRef<number>(bestBid);
    const bestAskPropRef = useRef<number>(bestAsk);
    bestBidPropRef.current = bestBid;
    bestAskPropRef.current = bestAsk;
    const sweepTrackerRef = useRef<SweepMomentumTracker>(new SweepMomentumTracker());
    const sweepDecayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconcileAxisLabelCollisionsRef = useRef<() => void>(() => {});
    const mlEntryLineRef = useRef<any>(null);
    const mlSlLineRef = useRef<any>(null);
    const mlTpLineRef = useRef<any>(null);
    const aiClickPriceLineRef = useRef<any>(null);
    const showCrosshairAIPredictRef = useRef<boolean>(showCrosshairAIPredict);
    const crosshairBtnRef = useRef<HTMLButtonElement>(null);
    const crosshairPriceRef = useRef<number | null>(null);
    const lastCandleRef = useRef<CandlestickData | null>(null);
    const historyLoadedRef = useRef<boolean>(false);
    const allCandlesRef = useRef<any[]>([]);
    const candlesVersionRef = useRef<number>(0);
    const [candlesReadyTick, setCandlesReadyTick] = useState(0);
    const lastTooltipUpdateAtRef = useRef<number>(0);
    const lastTooltipTimeRef = useRef<number | string | null>(null);
    const lastTradeEventRef = useRef<any>(null);
    const lastProcessedPriceRef = useRef<number>(0);
    const prevPositionRef = useRef<boolean>(false);
    const markersPluginRef = useRef<any>(null);
    const deviceProfile = useDeviceProfile();
    const isThermalGuard = deviceProfile.isThermalGuardActive;
    // Scale & stagger indicator recalculation intervals under mobile/tablet thermal guard
    // when multiple charts (2-4) are open so Samsung A34 / Redmi Pad 2 Pro avoid CPU spikes.
    const thermalIntervalScale = useMemo(() => {
        if (!isThermalGuard || totalChartsCount <= 1) return 1;
        if (isActiveChart) return totalChartsCount >= 3 ? 1.25 : 1;
        return totalChartsCount >= 3 ? 2.0 : 1.5;
    }, [isThermalGuard, totalChartsCount, isActiveChart]);
    const staggerDelayMs = (isThermalGuard && totalChartsCount > 1) ? chartSlotIndex * 350 : 0;
    const indicatorIntervalMs = Math.round(deviceProfile.timings.indicatorIntervalMs * thermalIntervalScale);
    const [fiboData, setFiboData] = useState<FibonacciData | null>(null);
    const [ichimokuData, setIchimokuData] = useState<IchimokuDataPoint[]>([]);
    const [trendFinderData, setTrendFinderData] = useState<TrendFinderResult | null>(null);
    const indicatorSettingsRef = useRef(indicatorSettings);
    indicatorSettingsRef.current = indicatorSettings;
    const isOrderFlowOverlayActive = Boolean(showVPVR || showCVD || showFootprint || indicatorSettings.showQuantumAI || (indicatorSettings.showUTBot && indicatorSettings.utBotOrderFlowConfirm));
    const { vpvrData, cvdData, cvdMeta, footprintData, loading: orderFlowLoading } = useOrderFlowData(symbol, exchange, interval, isOrderFlowOverlayActive, showFootprint);
    const chartSplitContainerRef = useRef<HTMLDivElement>(null);
    const [cvdPaneHeightPct, setCvdPaneHeightPct] = useState<number>(() => {
        try {
            const raw = localStorage.getItem('cosmo_cvd_pane_height_pct');
            const parsed = raw ? Number(raw) : NaN;
            if (Number.isFinite(parsed) && parsed >= 14 && parsed <= 48) return parsed;
        } catch {}
        return 24;
    });
    const [isResizingCvdPane, setIsResizingCvdPane] = useState<boolean>(false);
    const cvdSplitterCleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        return () => {
            cvdSplitterCleanupRef.current?.();
        };
    }, []);
    const handleCvdSplitterPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const container = chartSplitContainerRef.current;
        if (!container) return;
        cvdSplitterCleanupRef.current?.();
        setIsResizingCvdPane(true);
        let latestPct = cvdPaneHeightPct;

        const onMove = (moveEvent: PointerEvent) => {
            const rect = container.getBoundingClientRect();
            if (rect.height <= 0) return;
            const rawPct = ((rect.bottom - moveEvent.clientY) / rect.height) * 100;
            latestPct = Math.max(14, Math.min(48, Math.round(rawPct * 10) / 10));
            setCvdPaneHeightPct(latestPct);
        };
        const cleanup = () => {
            setIsResizingCvdPane(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            cvdSplitterCleanupRef.current = null;
        };
        const onUp = () => {
            cleanup();
            try {
                localStorage.setItem('cosmo_cvd_pane_height_pct', String(latestPct));
            } catch {}
        };
        cvdSplitterCleanupRef.current = cleanup;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
    }, [cvdPaneHeightPct]);
    const handleCvdSplitterDoubleClick = useCallback(() => {
        setCvdPaneHeightPct(24);
        try {
            localStorage.setItem('cosmo_cvd_pane_height_pct', '24');
        } catch {}
    }, []);
    const wallsRef = useRef(walls);
    wallsRef.current = walls;
    const footprintDataRef = useRef(footprintData);
    footprintDataRef.current = footprintData;
    const cvdDataRef = useRef(cvdData);
    cvdDataRef.current = cvdData;
    const showHeatmapOverlay = Boolean(showVPVR || indicatorSettings.showHeatmap);
    const { heatmapData: realHeatmapData, bucketSize: heatmapBucketSize } = useHeatmapData(symbol, exchange, showHeatmapOverlay, interval, bids, asks);
    useIcebergEvents(symbol);
    const mlSetup = useMLSetupEvents(symbol);
    const showGodMode = Boolean(indicatorSettings.showLiquidationHeatmap);
    const godModeData = useGodModeData(
        symbol,
        showGodMode,
        exchange,
        indicatorSettings.liquidationPoolHorizon || '24h'
    );
    const [sessionsData, setSessionsData] = useState<{ a: SessionData[]; b: SessionData[]; c: SessionData[]; d: SessionData[]; }>({
        a: [], b: [], c: [], d: []
    });
    const [sessionStatuses, setSessionStatuses] = useState<SessionStatus[]>([]);
    const [smcData, setSmcData] = useState<SMCResult | null>(null);
    const [ictData, setIctData] = useState<ICTResult | null>(null);
    const [ictPO3Data, setIctPO3Data] = useState<ICTPO3Data | null>(null);
    const [luxIctData, setLuxIctData] = useState<LuxIctResult | null>(null);
    const [quantumAiData, setQuantumAiData] = useState<QuantumAiResult[]>([]);
    const [supertrendData, setSupertrendData] = useState<SupertrendDataPoint[]>([]);
    const [msbObData, setMsbObData] = useState<MsbObResult | null>(null);
    const [patternData, setPatternData] = useState<any[]>([]); // Added for patterns
    const [wickSRData, setWickSRData] = useState<WickSRResult | null>(null);
    const [wickSRCandles, setWickSRCandles] = useState<any[]>([]);
    const [bbData, setBbData] = useState<BollingerBandsDataPoint[]>([]);
    const [vwapSDData, setVwapSDData] = useState<VWAPSDDataPoint[]>([]);
    const [tooltipData, setTooltipData] = useState<TooltipCandleData | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ x: number, y: number } | null>(null);

    const { data: aetherFlowData } = useAetherFlowData(symbol, exchange, interval, indicatorSettings.showAetherFlow);
    const { zones: liquidityAbsorptionZones } = useLiquiditySweepAbsorption(
        symbol,
        exchange,
        interval,
        indicatorSettings,
        Boolean(indicatorSettings.showLiquiditySweepAbsorption),
        currentPrice
    );

    // Default to the right side (rough estimate, can be adjusted by screen size)
    const [quantumAiHudPos, setQuantumAiHudPos] = useState(() => {
        const savedPos = localStorage.getItem('quantumAiHudPos');
        if (savedPos) {
            try {
                return JSON.parse(savedPos);
            } catch (e) {
                return { x: window.innerWidth - 320, y: 150 };
            }
        }
        return { x: window.innerWidth - 320, y: 150 };
    });

    const [isDraggingQuantumAi, setIsDraggingQuantumAi] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const quantumAiHudPosRef = useRef(quantumAiHudPos);
    quantumAiHudPosRef.current = quantumAiHudPos;

    // Live identity refs for async stale-response guards (syncMtfEma, tab-resume backfill, scrollback)
    const activeSymbolRef = useRef(symbol);
    activeSymbolRef.current = symbol;
    const activeExchangeRef = useRef(exchange);
    activeExchangeRef.current = exchange;
    const activeIntervalRef = useRef(interval);
    activeIntervalRef.current = interval;

    // Order Flow Pro View Controls (Heatmap Palette & Footprint Mode) + dynamic axis widths
    const [heatmapPalette, setHeatmapPalette] = useState<HeatmapPalette>(() => {
        try {
            const saved = localStorage.getItem('cosmo_heatmap_palette') as HeatmapPalette | null;
            if (saved && ['emerald-amber', 'bookmap', 'ice-fire', 'viridis'].includes(saved)) return saved;
        } catch {}
        return 'emerald-amber';
    });
    const [footprintMode, setFootprintMode] = useState<FootprintMode>(() => {
        try {
            const saved = localStorage.getItem('cosmo_footprint_mode') as FootprintMode | null;
            if (saved && ['bid-ask', 'delta', 'imbalance'].includes(saved)) return saved;
        } catch {}
        return 'bid-ask';
    });
    const [axisOffsets, setAxisOffsets] = useState<{ left: number; right: number }>({ left: 0, right: 64 });
    const measureAxisOffsetsRef = useRef<() => void>(() => {});
    const showHeatmapOverlayRef = useRef<boolean>(showHeatmapOverlay);
    showHeatmapOverlayRef.current = showHeatmapOverlay;

    // Keep global quick-trade drag handlers bound to whichever split chart is currently active
    useEffect(() => {
        if (!isActiveChart) return;
        const quickDragKey = chartId || 'main';
        const handlerSet = (window as any)._quickTradeDragHandlers?.[quickDragKey];
        if (handlerSet) {
            (window as any)._handleQuickTradeDragStart = handlerSet.start;
            (window as any)._handleQuickTradeDragMove = handlerSet.move;
            (window as any)._handleQuickTradeDragEnd = handlerSet.end;
        }
    }, [isActiveChart, chartId]);

    // Handle window resize to keep HUD in view if needed
    useEffect(() => {
        const handleResize = () => {
            setQuantumAiHudPos(prev => ({
                ...prev,
                x: Math.min(prev.x, window.innerWidth - 280)
            }));
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // ── Quantum AI HUD Draggable Logic (only attaches listeners while dragging; persists on drop) ──
    const handleHudMouseDown = (e: React.MouseEvent) => {
        setIsDraggingQuantumAi(true);
        dragStartRef.current = {
            x: e.clientX - quantumAiHudPosRef.current.x,
            y: e.clientY - quantumAiHudPosRef.current.y
        };
    };

    useEffect(() => {
        if (!isDraggingQuantumAi) return;
        const handleMouseMove = (e: MouseEvent) => {
            const newPos = {
                x: e.clientX - dragStartRef.current.x,
                y: e.clientY - dragStartRef.current.y
            };
            quantumAiHudPosRef.current = newPos;
            setQuantumAiHudPos(newPos);
        };

        const handleMouseUp = () => {
            setIsDraggingQuantumAi(false);
            try {
                localStorage.setItem('quantumAiHudPos', JSON.stringify(quantumAiHudPosRef.current));
            } catch {}
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingQuantumAi]);

    // Throttling State
    const marketDataBufferRef = useRef<{ price: number; trade: any } | null>(null);
    const lastIndicatorStateRef = useRef<{
        prevEMA: number;
        prevRSI: { avgUp: number; avgDown: number; prevClose: number };
    } | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const isTouchScreen = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

        const chart = createChart(chartContainerRef.current, {
            layout: {
                // Keep transparent so Binance-style CosmoQuant watermark (z-[1]) and L2 Heatmap (z-[2]) render strictly behind candles
                background: {
                    type: 'solid',
                    color: 'transparent',
                } as any,
                textColor: isDark ? '#94a3b8' : '#334155',
                fontSize: 14, // larger price-scale tags (live price tag etc.)
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.06)' },
                horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.06)' },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
                timeVisible: true,
                secondsVisible: interval.endsWith('s'),
            },
            rightPriceScale: {
                visible: true,
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
                scaleMargins: { top: 0.1, bottom: 0.2 }, // Leave bottom 20% for RSI
            },
            leftPriceScale: {
                visible: false,
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
                scaleMargins: { top: 0.8, bottom: 0 }, // RSI takes bottom 20%
            },
            handleScroll: {
                mouseWheel: true,
                pressedMouseMove: true,
                horzTouchDrag: true,
                // MUST be true in Lightweight Charts v5 so 1-finger vertical touch drag on the right price axis stretches/compresses candles!
                vertTouchDrag: true,
            },
            handleScale: {
                axisPressedMouseMove: { time: true, price: true },
                axisDoubleClickReset: { time: true, price: true },
                mouseWheel: true,
                pinch: true,
            },
            kineticScroll: {
                touch: isTouchScreen,
                mouse: false,
            },
        });

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            priceScaleId: 'right',
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: {
                type: 'custom',
                minMove: 0.0000000001,
                formatter: (price: number) => {
                    const abs = Math.abs(price);
                    if (abs === 0) return '0.00';
                    if (abs < 0.000001) return price.toFixed(12);
                    if (abs < 0.00001) return price.toFixed(10);
                    if (abs < 0.0001) return price.toFixed(8);
                    if (abs < 0.001) return price.toFixed(7);
                    if (abs < 1) return price.toFixed(5);
                    if (abs < 10) return price.toFixed(4);
                    return price.toFixed(2);
                }
            }
        });

        const emaSeries = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceScaleId: 'right', visible: false });
        const bbUpperSeries = chart.addSeries(LineSeries, { color: isDark ? '#22c55e' : '#16a34a', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'right', visible: indicatorSettings.showBB });
        const bbMiddleSeries = chart.addSeries(LineSeries, { color: isDark ? '#3b82f6' : '#2563eb', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'right', visible: indicatorSettings.showBB });
        const bbLowerSeries = chart.addSeries(LineSeries, { color: isDark ? '#ef4444' : '#dc2626', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'right', visible: indicatorSettings.showBB });
        const rsiSeries = chart.addSeries(LineSeries, { color: '#db2777', lineWidth: 2, priceScaleId: 'left', crosshairMarkerVisible: false, lastValueVisible: false, visible: indicatorSettings.showRSI });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: 'volume', // Give it a separate scale
            visible: indicatorSettings.showVolume,
        });

        // Configure the volume price scale
        chart.priceScale('volume').applyOptions({
            scaleMargins: {
                top: 0.8, // dock to bottom 20%
                bottom: 0,
            },
            visible: false, // Don't show volume numbers on the axis to reduce clutter
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;
        setCandlesReadyTick(t => t + 1);
        
        chart.subscribeCrosshairMove((param) => {
            if (crosshairBtnRef.current && crosshairBtnRef.current.matches(':hover')) {
                // If the user is hovering the button, freeze its position so they can click it
                if (!showCrosshairAIPredictRef.current) {
                    crosshairBtnRef.current.style.display = 'none';
                    crosshairPriceRef.current = null;
                }
                return;
            }
            
            // Tooltip Modal Logic
            if (!param.point || !param.time || param.point.x < 0 || param.point.x > (chartContainerRef.current?.clientWidth || 0) || param.point.y < 0 || param.point.y > (chartContainerRef.current?.clientHeight || 0)) {
                if (lastTooltipTimeRef.current !== null) {
                    lastTooltipTimeRef.current = null;
                    setTooltipData(null);
                    setTooltipPos(null);
                }
            } else {
                const nowMs = Date.now();
                const tooltipThrottleMs = isThermalGuardActive() ? 90 : 0;
                const timeChanged = lastTooltipTimeRef.current !== (param.time as any);
                if (tooltipThrottleMs > 0 && !timeChanged && nowMs - lastTooltipUpdateAtRef.current < tooltipThrottleMs) {
                    // Skip rapid touch-pan React state updates on same bar
                } else {
                    let candleData = null;
                    
                    // 1. Primary method: Get exact internal data point used by TradingView chart
                    if (candlestickSeriesRef.current && param.seriesData) {
                        const cData = param.seriesData.get(candlestickSeriesRef.current) as any;
                        const vData = volumeSeriesRef.current ? param.seriesData.get(volumeSeriesRef.current) as any : null;
                        if (cData && cData.open !== undefined) {
                            candleData = {
                                time: cData.time as number,
                                open: cData.open,
                                high: cData.high,
                                low: cData.low,
                                close: cData.close,
                                volume: vData?.value || 0
                            };
                        }
                    }
                    
                    // 2. Fallback method: Search raw CCXT data (accounting for JS string/number mismatches)
                    if (!candleData) {
                        const fallbackCandle = allCandlesRef.current.find(c => {
                            return c.time === param.time || String(c.time) === String(param.time) || Number(c.time) === Number(param.time);
                        });
                        if (fallbackCandle) {
                            candleData = {
                                time: fallbackCandle.time,
                                open: fallbackCandle.open,
                                high: fallbackCandle.high,
                                low: fallbackCandle.low,
                                close: fallbackCandle.close,
                                volume: fallbackCandle.volume || 0
                            };
                        }
                    }

                    if (candleData) {
                        // Enrich tooltip with per-bar Order Flow metrics (Delta, Buy%, POC) when available
                        const tNum = Number(candleData.time);
                        const fpMatch = footprintDataRef.current.find((f) => Number(f.time) === tNum);
                        const cvdMatch = cvdDataRef.current.find((c) => Number(c.time) === tNum);
                        const enrichedTooltip: TooltipCandleData = { ...candleData };
                        if (cvdMatch && cvdMatch.delta !== undefined) {
                            enrichedTooltip.delta = cvdMatch.delta;
                            const b = cvdMatch.buyVolume || 0;
                            const s = cvdMatch.sellVolume || 0;
                            if (b + s > 0) enrichedTooltip.buyPct = (b / (b + s)) * 100;
                        } else if (fpMatch && fpMatch.totalDelta !== undefined) {
                            enrichedTooltip.delta = fpMatch.totalDelta;
                        }
                        if (fpMatch && fpMatch.pocPrice && fpMatch.pocPrice > 0) {
                            enrichedTooltip.pocPrice = fpMatch.pocPrice;
                        }
                        lastTooltipUpdateAtRef.current = nowMs;
                        lastTooltipTimeRef.current = candleData.time as any;
                        setTooltipData(enrichedTooltip);
                        setTooltipPos({ x: param.point.x, y: param.point.y });
                    } else if (lastTooltipTimeRef.current !== null) {
                        lastTooltipTimeRef.current = null;
                        setTooltipData(null);
                        setTooltipPos(null);
                    }
                }
            }

            // Quick Trade / AI Predict Button Logic
            if (showCrosshairAIPredictRef.current && param.point && param.point.y !== undefined && candlestickSeriesRef.current && crosshairBtnRef.current) {
                const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y as any);
                if (price !== null) {
                    crosshairPriceRef.current = price as number;
                    crosshairBtnRef.current.style.display = 'flex';
                    crosshairBtnRef.current.style.left = `auto`;
                    crosshairBtnRef.current.style.right = `65px`; // Place it firmly near the price axis
                    crosshairBtnRef.current.style.top = `${param.point.y}px`; // Centered vertically on the crosshair line
                }
            } else if (crosshairBtnRef.current) {
                crosshairBtnRef.current.style.display = 'none';
                crosshairPriceRef.current = null;
            }
        });
        markersPluginRef.current = createSeriesMarkers(candlestickSeries, []);
        const utBotPrimitive = new UTBotPrimitive(indicatorSettingsRef.current.showUTBot);
        candlestickSeries.attachPrimitive(utBotPrimitive);
        utBotPrimitiveRef.current = utBotPrimitive;
        const spreadCorridorPrimitive = new SpreadCorridorPrimitive(showBidAskRef.current);
        candlestickSeries.attachPrimitive(spreadCorridorPrimitive);
        spreadCorridorPrimitiveRef.current = spreadCorridorPrimitive;
        const handleScaleCollisionCheck = () => {
            reconcileAxisLabelCollisionsRef.current();
        };
        const handlePriceAxisGesture = () => {
            requestAnimationFrame(() => reconcileAxisLabelCollisionsRef.current());
        };
        const containerEl = chartContainerRef.current;
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleScaleCollisionCheck);
        chart.timeScale().subscribeSizeChange(handleScaleCollisionCheck);
        containerEl?.addEventListener('wheel', handlePriceAxisGesture, { passive: true });
        containerEl?.addEventListener('pointerup', handlePriceAxisGesture, { passive: true });
        containerEl?.addEventListener('touchmove', handlePriceAxisGesture, { passive: true });
        containerEl?.addEventListener('touchend', handlePriceAxisGesture, { passive: true });
        emaSeriesRef.current = emaSeries;
        bbUpperSeriesRef.current = bbUpperSeries;
        bbMiddleSeriesRef.current = bbMiddleSeries;
        bbLowerSeriesRef.current = bbLowerSeries;
        rsiSeriesRef.current = rsiSeries;
        volumeSeriesRef.current = volumeSeries;

        // Fetch real historical data
        let isMounted = true;
        historyLoadedRef.current = false;
        const fetchKlines = async () => {
            try {
                const data = await marketDepthService.getOHLCV(
                    symbol.toUpperCase(),
                    exchange,
                    interval,
                    1000
                );

                if (!isMounted) return;

                const candles = sanitizeAndSortCandles(Array.isArray(data) ? data : []);
                if (candlestickSeriesRef.current && isMounted) {
                    candlestickSeriesRef.current.setData(candles as any);
                    allCandlesRef.current = candles;
                    candlesVersionRef.current += 1;
                    if (candles.length > 0) {
                        lastCandleRef.current = { ...candles[candles.length - 1] } as any;
                        // Reconcile stale REST history against the freshest live WS trade tick immediately
                        // so initial load / timeframe switch never snaps the last candle or price line backwards.
                        const liveTick = getLatestLiveTick(symbol, exchange);
                        if (liveTick && liveTick.price > 0) {
                            const lastC = lastCandleRef.current as any;
                            let candleTimeMs = Number(lastC.time);
                            const isSec = candleTimeMs < 10000000000;
                            if (isSec) candleTimeMs *= 1000;
                            const rawTs = liveTick.timestamp || Date.now();
                            const tickMs = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
                            const intervalMs = parseIntervalToMs(interval);
                            if (tickMs >= candleTimeMs) {
                                const side: 'buy' | 'sell' = liveTick.side || (liveTick.isBuyerMaker ? 'sell' : 'buy');
                                lastTradeSideRef.current = side;
                                lastTickPriceRef.current = liveTick.price;
                                let reconciled: any;
                                const nextBoundaryMs = getNextCandleCloseMs(candleTimeMs, interval, candleTimeMs);
                                if (tickMs >= nextBoundaryMs) {
                                    const nextMs = alignCandleBucketMs(tickMs, interval);
                                    const nextTime = isSec ? Math.floor(nextMs / 1000) : nextMs;
                                    reconciled = {
                                        time: nextTime,
                                        open: lastC.close,
                                        high: Math.max(lastC.close, liveTick.price, liveTick.high ?? liveTick.price),
                                        low: Math.min(lastC.close, liveTick.price, liveTick.low ?? liveTick.price),
                                        close: liveTick.price,
                                        volume: liveTick.volume || 0,
                                    };
                                    allCandlesRef.current.push(reconciled);
                                } else {
                                    reconciled = {
                                        ...lastC,
                                        close: liveTick.price,
                                        high: Math.max(lastC.high, liveTick.price, liveTick.high ?? liveTick.price),
                                        low: Math.min(lastC.low, liveTick.price, liveTick.low ?? liveTick.price),
                                    };
                                    allCandlesRef.current[allCandlesRef.current.length - 1] = reconciled;
                                }
                                candlestickSeriesRef.current.update(reconciled);
                                lastCandleRef.current = reconciled;
                                syncCurrentPriceLineRef.current(reconciled.close, side);
                                lastDirectTickTimestampRef.current = Math.max(lastDirectTickTimestampRef.current, tickMs);
                                hasDirectTicksRef.current = true;
                                lastDirectTickAtRef.current = Date.now();
                            }
                        }
                    } else {
                        // Empty historical array (e.g. quiet sub-minute pair): seed immediately if a live tick already exists
                        const liveTick = getLatestLiveTick(symbol, exchange);
                        if (liveTick && liveTick.price > 0) {
                            const rawTs = liveTick.timestamp || Date.now();
                            const tickMs = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
                            const bucketSec = alignCandleBucketSec(Math.floor(tickMs / 1000), interval);
                            const seeded: any = {
                                time: bucketSec,
                                open: liveTick.price,
                                high: Math.max(liveTick.price, liveTick.high ?? liveTick.price),
                                low: Math.min(liveTick.price, liveTick.low ?? liveTick.price),
                                close: liveTick.price,
                                volume: liveTick.volume || 0,
                            };
                            candlestickSeriesRef.current.setData([seeded]);
                            allCandlesRef.current = [seeded];
                            lastCandleRef.current = seeded;
                            const side: 'buy' | 'sell' = liveTick.side || (liveTick.isBuyerMaker ? 'sell' : 'buy');
                            syncCurrentPriceLineRef.current(seeded.close, side);
                        }
                    }

                    // Format and set volume data
                    if (volumeSeriesRef.current && isMounted) {
                        const volumeData = allCandlesRef.current.map((k: any) => ({
                            time: k.time,
                            value: k.volume,
                            color: k.close >= k.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                        }));
                        volumeSeriesRef.current.setData(volumeData);
                    }

                    if (allCandlesRef.current.length > 200) {
                        chart.timeScale().setVisibleLogicalRange({
                            from: allCandlesRef.current.length - 200,
                            to: allCandlesRef.current.length - 1,
                        });
                    } else {
                        chart.timeScale().fitContent();
                    }

                    // Initialize Indicators immediately after fetching history
                    if (allCandlesRef.current.length > 0) {
                        const readyCandles = allCandlesRef.current;
                        setCandlesReadyTick(t => t + 1);
                        const curInd = indicatorSettingsRef.current;
                        const bbP = Math.max(1, Math.floor(Number(curInd.bbPeriod) || 20));
                        const bbDev = Number.isFinite(Number(curInd.bbStdDev)) && Number(curInd.bbStdDev) > 0 ? Number(curInd.bbStdDev) : 2;
                        const rsiP = Math.max(1, Math.floor(Number(curInd.rsiPeriod) || 14));

                        syncMtfEma(readyCandles);
                        if (curInd.showBB && bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current) {
                            const bbResult = calculateBollingerBands(readyCandles, bbP, bbDev);
                            bbUpperSeriesRef.current.setData(bbResult.map((d: any) => ({ time: d.time, value: d.upper })) as any);
                            bbMiddleSeriesRef.current.setData(bbResult.map((d: any) => ({ time: d.time, value: d.middle })) as any);
                            bbLowerSeriesRef.current.setData(bbResult.map((d: any) => ({ time: d.time, value: d.lower })) as any);
                            setBbData(bbResult);
                        }
                        if (curInd.showRSI && rsiSeriesRef.current) {
                            rsiSeriesRef.current.setData(calculateRSI(readyCandles, rsiP) as any);
                        }
                        if (curInd.showUTBot && utBotPrimitiveRef.current) {
                            syncUTBotOverlayRef.current(readyCandles, curInd, false, true);
                        }
                    }
                }
            } catch (err: any) {
                if (isMounted) {
                    console.error("Failed to fetch klines for heatmap:", err);
                    const detail = err?.response?.data?.detail || err?.message || 'Failed to load candles';
                    toast.error(`${exchange.toUpperCase()} ${symbol} (${interval}): ${detail}`, {
                        id: `ohlcv-err-${chartId}`,
                        duration: 3500,
                    });
                }
            } finally {
                if (isMounted) {
                    historyLoadedRef.current = true;
                    requestAnimationFrame(measureAxisOffsets);
                }
            }
        };

        const handleQuickTradeDragStart = (side: 'Buy' | 'Sell') => {
            // we don't strictly need state for this, ghost line creation happens on move
        };

        const handleQuickTradeDragMove = (y: number) => {
            if (!candlestickSeriesRef.current || !chartContainerRef.current) return;
            const rect = chartContainerRef.current.getBoundingClientRect();
            // y is clientY. Get chart-relative coordinate
            const coordinate = y - rect.top;
            
            // If mouse is outside chart vertically, remove line
            if (coordinate < 0 || coordinate > rect.height) {
                if (quickTradeGhostLineRef.current && candlestickSeriesRef.current) {
                    try { candlestickSeriesRef.current.removePriceLine(quickTradeGhostLineRef.current); } catch {}
                    quickTradeGhostLineRef.current = null;
                }
                return;
            }

            const rawPrice = candlestickSeriesRef.current.coordinateToPrice(coordinate as any);
            const price = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice as any);
            if (isNaN(price)) return;

            if (!quickTradeGhostLineRef.current) {
                quickTradeGhostLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: price,
                    color: '#6366f1', // Indigo color for drag
                    lineWidth: 1,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'DROP TO LIMIT',
                });
            } else {
                quickTradeGhostLineRef.current.applyOptions({ price: price, lineWidth: 1, lineStyle: LineStyle.Solid });
            }
        };

        const handleQuickTradeDragEnd = async (side: 'Buy' | 'Sell', y: number, size: string, apiId: string) => {
            if (quickTradeGhostLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(quickTradeGhostLineRef.current); } catch {}
                quickTradeGhostLineRef.current = null;
            }

            if (!candlestickSeriesRef.current || !chartContainerRef.current) return;
            if (Number(size) <= 0) {
                toast.error("Size must be greater than 0");
                return;
            }

            const rect = chartContainerRef.current.getBoundingClientRect();
            const coordinate = y - rect.top;
            if (coordinate < 0 || coordinate > rect.height) {
                // dropped outside chart
                return;
            }

            const rawPrice = candlestickSeriesRef.current.coordinateToPrice(coordinate as any);
            let dropPrice = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice as any);
            if (isNaN(dropPrice)) return;

            // Cap/Floor for PostOnly logic
            // We calculate 1 tick = smallest price unit to ensure we stay maker side
            // Use smcDataRef to avoid stale closure (always has the latest live price)
            const currentMarketPrice = smcDataRef.current.currentPrice || currentPrice || dropPrice;
            let priceWasCapped = false;

            if (side === 'Buy' && dropPrice >= currentMarketPrice) {
                // BUY above or at market price → snap to just below current price (Best Bid)
                const tick = currentMarketPrice >= 1 ? 0.0001 : 0.00001;
                dropPrice = currentMarketPrice - tick;
                priceWasCapped = true;
            } else if (side === 'Sell' && dropPrice <= currentMarketPrice) {
                // SELL below or at market price → snap to just above current price (Best Ask)
                const tick = currentMarketPrice >= 1 ? 0.0001 : 0.00001;
                dropPrice = currentMarketPrice + tick;
                priceWasCapped = true;
            }

            if (priceWasCapped) {
                toast(`⚠️ Price capped for PostOnly — placing at ${dropPrice.toFixed(5)}`, {
                    icon: '🔒',
                    duration: 2000,
                    style: { background: '#1e293b', color: '#fbbf24', border: '1px solid #f59e0b' }
                });
            }

            toast.loading(`Placing ${side} Limit at ${dropPrice.toFixed(5)}...`, { id: 'quick-trade' });
            const quickOptId = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            window.dispatchEvent(
                new CustomEvent('optimisticAddOpenOrder', {
                    detail: {
                        apiKeyId: Number(apiId),
                        symbol: symbol,
                        order: {
                            id: quickOptId,
                            side: side.toLowerCase() as 'buy' | 'sell',
                            price: Number(dropPrice),
                            amount: Number(size),
                            filled: 0,
                            remaining: Number(size),
                            isSoftwareSL: false,
                            mode: 'LIMIT',
                        },
                    },
                })
            );

            try {
                // Place Order
                const quickRes = await manualTradeService.placeOrder({
                    symbol: symbol,
                    side: side,
                    type: 'Limit',
                    amount: Number(size),
                    price: dropPrice,
                    exchange_id: exchange,
                    api_key_id: Number(apiId),
                    params: { timeInForce: 'PostOnly' } as any,
                    client_timestamp: Date.now()
                });

                if (quickRes?.id) {
                    window.dispatchEvent(
                        new CustomEvent('optimisticAddOpenOrder', {
                            detail: {
                                apiKeyId: Number(apiId),
                                symbol: symbol,
                                replaceId: quickOptId,
                                order: {
                                    id: String(quickRes.id),
                                    side: side.toLowerCase() as 'buy' | 'sell',
                                    price: Number(quickRes.price || dropPrice),
                                    amount: Number(quickRes.amount || size),
                                    filled: 0,
                                    remaining: Number(quickRes.amount || size),
                                    isSoftwareSL: false,
                                    mode: 'LIMIT',
                                },
                            },
                        })
                    );
                }
                window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
                toast.success(`✅ Quick ${side} Limit Placed at ${dropPrice.toFixed(4)}`, { id: 'quick-trade' });
            } catch (error: any) {
                window.dispatchEvent(new CustomEvent('optimisticRemoveOpenOrder', { detail: { orderId: quickOptId, apiKeyId: Number(apiId) } }));
                toast.error(`❌ Order Failed: ${error.message || 'Unknown Error'}`, { id: 'quick-trade' });
            }
        };

        // Attach handlers to window for access inside QuickTradeToolbar and ManualTradeModal (scoped per chartId + active chart)
        const quickDragKey = chartId || 'main';
        if (!(window as any)._quickTradeDragHandlers) {
            (window as any)._quickTradeDragHandlers = {};
        }
        (window as any)._quickTradeDragHandlers[quickDragKey] = {
            start: handleQuickTradeDragStart,
            move: handleQuickTradeDragMove,
            end: handleQuickTradeDragEnd,
        };
        if (isActiveChart || quickDragKey === 'main') {
            (window as any)._handleQuickTradeDragStart = handleQuickTradeDragStart;
            (window as any)._handleQuickTradeDragMove = handleQuickTradeDragMove;
            (window as any)._handleQuickTradeDragEnd = handleQuickTradeDragEnd;
        }

        const clearChartBracketGhostLine = () => {
            if (typeof window !== 'undefined') {
                (window as any)._cosmoLastMagnetSnap = null;
            }
            if (chartBracketGhostLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(chartBracketGhostLineRef.current); } catch {}
                chartBracketGhostLineRef.current = null;
            }
        };

        const containsChartBracketPoint = (clientX: number, clientY: number): boolean => {
            if (!candlestickSeriesRef.current || !chartContainerRef.current) return false;
            const rect = chartContainerRef.current.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                clientX >= rect.left &&
                clientX <= rect.right &&
                clientY >= rect.top &&
                clientY <= rect.bottom
            );
        };

        const handleChartDragBracketStart = (type: any) => {
            clearChartBracketGhostLine();
        };

        const resolveChartBracketPrice = (clientX: number, clientY: number): { inChart: boolean; price: number | null } => {
            if (!candlestickSeriesRef.current || !chartContainerRef.current) return { inChart: false, price: null };
            const rect = chartContainerRef.current.getBoundingClientRect();
            const coordinate = clientY - rect.top;

            if (coordinate < 0 || coordinate > rect.height || clientX < rect.left || clientX > rect.right) {
                return { inChart: false, price: null };
            }

            let rawPrice = candlestickSeriesRef.current.coordinateToPrice(coordinate as any);
            if (rawPrice === null || rawPrice === undefined) {
                const timeScaleHeight = chartRef.current?.timeScale?.().height?.() || 0;
                const effectiveTimeScaleHeight = Math.max(timeScaleHeight, 28);
                if (coordinate > rect.height - effectiveTimeScaleHeight - 2) {
                    const clampedCoordinate = Math.max(0, rect.height - effectiveTimeScaleHeight - 2);
                    rawPrice = candlestickSeriesRef.current.coordinateToPrice(clampedCoordinate as any);
                }
            }
            const price = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice as any);
            if (!Number.isFinite(price) || price <= 0) return { inChart: false, price: null };

            return { inChart: true, price };
        };

        const resolveMagnetPrice = (type: any, rawPrice: number): { price: number; snappedWall: OrderbookWall | null } => {
            const magnetCfg = typeof window !== 'undefined' ? (window as any)._cosmoWallMagnetConfig : null;
            if (!magnetCfg?.active) {
                return { price: rawPrice, snappedWall: null };
            }
            const liveRef = smcDataRef.current?.currentPrice || currentPrice || 0;
            const liveWalls = smcDataRef.current?.walls || [];
            const snapped = snapPriceToWallMagnet(
                rawPrice,
                type,
                liveWalls,
                liveRef,
                Number(magnetCfg.frontRunTicks || 1),
                0.75
            );
            return { price: snapped.price, snappedWall: snapped.snappedWall };
        };

        const handleChartDragBracketMove = (type: any, clientX: number, clientY: number): number | null => {
            const { inChart, price: rawPrice } = resolveChartBracketPrice(clientX, clientY);
            if (!inChart || rawPrice === null) {
                clearChartBracketGhostLine();
                return null;
            }

            const { price, snappedWall } = resolveMagnetPrice(type, rawPrice);
            if (typeof window !== 'undefined') {
                (window as any)._cosmoLastMagnetSnap = snappedWall ? { price, wall: snappedWall } : null;
            }
            const formattedPrice = price < 1 ? price.toFixed(6) : price.toFixed(4);
            const liveRefPrice = smcDataRef.current?.currentPrice || currentPrice || 0;

            let color = '#22c55e';
            let title = '';

            if (snappedWall) {
                const szLbl = formatWallSizeCompact(snappedWall.size);
                color = type === 'sl' ? '#ef4444' : snappedWall.type === 'buy' ? '#10b981' : '#f59e0b';
                title = `🧲 WALL FRONT-RUN ${String(type).toUpperCase()} (${formattedPrice})${szLbl ? ` • Wall ${szLbl}` : ''}`;
            } else if (type === 'tp') {
                color = '#22c55e';
                const isDipBuyTP = liveRefPrice > 0 && price < liveRefPrice;
                title = isDipBuyTP ? `🎯 DROP TO SET DIP BUY-BACK TP (${formattedPrice})` : `🎯 DROP TO SET TP (${formattedPrice})`;
            } else if (type === 'sl') {
                color = '#ef4444';
                const isBuyBackSL = liveRefPrice > 0 && price > liveRefPrice;
                title = isBuyBackSL ? `🛡️ DROP TO SET BUY-BACK SL (${formattedPrice})` : `🛡️ DROP TO SET SL (${formattedPrice})`;
            } else if (type === 'peg_buy') {
                color = '#06b6d4';
                title = `⚡ DROP TO ANCHOR SMART PEG BUY (${formattedPrice})`;
            } else if (type === 'peg_sell') {
                color = '#f59e0b';
                title = `⚡ DROP TO ANCHOR SMART PEG SELL (${formattedPrice})`;
            } else if (type === 'buy') {
                color = '#10b981';
                const isStop = liveRefPrice > 0 && price > liveRefPrice;
                title = isStop ? `🟢 DROP TO PLACE BUY STOP (${formattedPrice})` : `🟢 DROP TO PLACE BUY LIMIT (${formattedPrice})`;
            } else if (type === 'sell') {
                color = '#f43f5e';
                const isStop = liveRefPrice > 0 && price < liveRefPrice;
                title = isStop ? `🔴 DROP TO PLACE SELL STOP (${formattedPrice})` : `🔴 DROP TO PLACE SELL LIMIT (${formattedPrice})`;
            } else {
                color = '#38bdf8';
                title = `DROP ORDER (${formattedPrice})`;
            }

            const lineWidth = snappedWall ? 2 : 1;
            const lineStyle = snappedWall ? LineStyle.Dashed : LineStyle.Solid;

            if (!chartBracketGhostLineRef.current) {
                chartBracketGhostLineRef.current = candlestickSeriesRef.current?.createPriceLine({
                    price: price,
                    color: color,
                    lineWidth,
                    lineStyle,
                    axisLabelVisible: true,
                    title: title,
                });
            } else {
                chartBracketGhostLineRef.current.applyOptions({
                    price: price,
                    color: color,
                    title: title,
                    lineWidth,
                    lineStyle,
                });
            }
            return price;
        };

        const handleChartDragBracketEnd = (type: any, clientX: number, clientY: number): { inChart: boolean; price: number | null } => {
            clearChartBracketGhostLine();

            const raw = resolveChartBracketPrice(clientX, clientY);
            if (!raw.inChart || raw.price === null) return raw;
            const { price } = resolveMagnetPrice(type, raw.price);
            return { inChart: true, price };
        };

        const registryKey = chartId || 'main';
        const registryEntry: ChartDragBracketEntry = {
            chartId: registryKey,
            symbol,
            start: handleChartDragBracketStart,
            move: handleChartDragBracketMove,
            end: handleChartDragBracketEnd,
            clearGhost: clearChartBracketGhostLine,
            containsPoint: containsChartBracketPoint,
        };
        chartDragBracketRegistry.set(registryKey, registryEntry);

        fetchKlines();

        const measureAxisOffsets = () => {
            try {
                const leftW = Math.round(chart.priceScale('left')?.width?.() || 0);
                const rightW = Math.max(54, Math.round(chart.priceScale('right')?.width?.() || 64));
                setAxisOffsets((prev) =>
                    prev.left === leftW && prev.right === rightW ? prev : { left: leftW, right: rightW }
                );
            } catch {}
        };
        measureAxisOffsetsRef.current = measureAxisOffsets;

        // Re-measure axis widths whenever Lightweight Charts resizes timeScale (e.g. price digit width or left scale toggle)
        chart.timeScale().subscribeSizeChange(measureAxisOffsets);

        // Left-Edge Historical Scrollback Pagination (leaner 1800-bar RAM cap on mobile/tablet Chrome, 3500 on PC)
        const maxScrollbackBars = isThermalGuardActive() ? 1800 : 3500;
        let isLoadingOlderHistory = false;
        let olderHistoryExhausted = false;
        const handleHistoricalScrollback = (logicalRange: any) => {
            if (
                !isMounted ||
                !historyLoadedRef.current ||
                isLoadingOlderHistory ||
                olderHistoryExhausted ||
                !logicalRange ||
                typeof logicalRange.from !== 'number' ||
                logicalRange.from > 12 ||
                allCandlesRef.current.length === 0 ||
                allCandlesRef.current.length >= maxScrollbackBars
            ) {
                return;
            }
            const oldestSec = Number(allCandlesRef.current[0]?.time || 0);
            if (!Number.isFinite(oldestSec) || oldestSec <= 0) return;

            isLoadingOlderHistory = true;
            marketDepthService
                .getOHLCV(symbol.toUpperCase(), exchange, interval, 500, oldestSec)
                .then((olderRaw) => {
                    if (!isMounted || !candlestickSeriesRef.current) return;
                    const olderSanitized = sanitizeAndSortCandles(Array.isArray(olderRaw) ? olderRaw : []).filter(
                        (c) => Number(c.time) < oldestSec
                    );
                    if (olderSanitized.length === 0) {
                        olderHistoryExhausted = true;
                        return;
                    }
                    const currentRange = chart.timeScale().getVisibleLogicalRange();
                    const prevCount = allCandlesRef.current.length;
                    const merged = sanitizeAndSortCandles([...olderSanitized, ...allCandlesRef.current]).slice(-maxScrollbackBars);
                    const addedCount = merged.length - prevCount;
                    if (addedCount <= 0) {
                        olderHistoryExhausted = true;
                        return;
                    }
                    allCandlesRef.current = merged;
                    candlesVersionRef.current += 1;
                    candlestickSeriesRef.current.setData(merged as any);
                    if (volumeSeriesRef.current) {
                        volumeSeriesRef.current.setData(
                            merged.map((k: any) => ({
                                time: k.time,
                                value: k.volume,
                                color: k.close >= k.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
                            })) as any
                        );
                    }
                    // Preserve user's exact viewport position cleanly across prepended bars
                    if (currentRange && typeof currentRange.from === 'number' && typeof currentRange.to === 'number') {
                        chart.timeScale().setVisibleLogicalRange({
                            from: currentRange.from + addedCount,
                            to: currentRange.to + addedCount,
                        });
                    }
                    setCandlesReadyTick((t) => t + 1);
                    requestAnimationFrame(measureAxisOffsets);
                })
                .catch(() => {})
                .finally(() => {
                    isLoadingOlderHistory = false;
                });
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleHistoricalScrollback);

        const resizeObserver = new ResizeObserver(entries => {
            if (entries.length === 0 || entries[0].target !== chartContainerRef.current) { return; }
            const newRect = entries[0].contentRect;
            chart.applyOptions({ height: newRect.height, width: newRect.width });
            measureAxisOffsets();
        });

        if (chartContainerRef.current) {
            resizeObserver.observe(chartContainerRef.current);
        }
        const axisInitTimer = setTimeout(measureAxisOffsets, 120);

        // Automatic Tab-Resume Gap Backfill: when user returns after tab suspension, backfill any missed candles seamlessly
        let hiddenAtMs = 0;
        let isBackfilling = false;
        const handleVisibilityBackfill = async () => {
            if (typeof document === 'undefined') return;
            if (document.hidden) {
                hiddenAtMs = Date.now();
                return;
            }
            const awayMs = hiddenAtMs > 0 ? Date.now() - hiddenAtMs : 0;
            hiddenAtMs = 0;
            const thresholdMs = Math.max(parseIntervalToMs(interval), 15000);
            if (awayMs < thresholdMs || isBackfilling || !isMounted || !candlestickSeriesRef.current) return;
            isBackfilling = true;
            try {
                const missedBars = Math.min(500, Math.max(60, Math.ceil(awayMs / Math.max(1000, parseIntervalToMs(interval))) + 20));
                const fresh = await marketDepthService.getOHLCV(symbol.toUpperCase(), exchange, interval, missedBars);
                if (!isMounted || !candlestickSeriesRef.current || !Array.isArray(fresh) || fresh.length === 0) return;
                const sanitized = sanitizeAndSortCandles(fresh);
                if (sanitized.length === 0) return;
                const mergedMap = new Map<number, any>();
                for (let i = 0; i < allCandlesRef.current.length; i++) {
                    mergedMap.set(Number(allCandlesRef.current[i].time), allCandlesRef.current[i]);
                }
                for (let i = 0; i < sanitized.length; i++) {
                    mergedMap.set(Number(sanitized[i].time), sanitized[i]);
                }
                const merged = Array.from(mergedMap.values())
                    .sort((a, b) => Number(a.time) - Number(b.time))
                    .slice(-2000);
                allCandlesRef.current = merged;
                candlesVersionRef.current += 1;
                candlestickSeriesRef.current.setData(merged as any);
                if (volumeSeriesRef.current) {
                    volumeSeriesRef.current.setData(
                        merged.map((k: any) => ({
                            time: k.time,
                            value: k.volume,
                            color: k.close >= k.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
                        })) as any
                    );
                }
                lastCandleRef.current = { ...merged[merged.length - 1] };
                setCandlesReadyTick((t) => t + 1);
            } catch {
                // ignore transient network failure on resume
            } finally {
                isBackfilling = false;
            }
        };
        const handleOnlineBackfill = () => {
            hiddenAtMs = Date.now() - Math.max(parseIntervalToMs(interval) * 3, 20000);
            handleVisibilityBackfill();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityBackfill);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('online', handleOnlineBackfill);
        }

        return () => {
            isMounted = false;
            clearTimeout(axisInitTimer);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityBackfill);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('online', handleOnlineBackfill);
            }
            if ((window as any)._quickTradeDragHandlers?.[quickDragKey]?.start === handleQuickTradeDragStart) {
                delete (window as any)._quickTradeDragHandlers[quickDragKey];
            }
            if ((window as any)._handleQuickTradeDragStart === handleQuickTradeDragStart) {
                (window as any)._handleQuickTradeDragStart = undefined;
                (window as any)._handleQuickTradeDragMove = undefined;
                (window as any)._handleQuickTradeDragEnd = undefined;
            }
            clearChartBracketGhostLine();
            if (chartDragBracketRegistry.get(registryKey) === registryEntry) {
                chartDragBracketRegistry.delete(registryKey);
            }
            resizeObserver.disconnect();
            containerEl?.removeEventListener('wheel', handlePriceAxisGesture);
            containerEl?.removeEventListener('pointerup', handlePriceAxisGesture);
            containerEl?.removeEventListener('touchmove', handlePriceAxisGesture);
            containerEl?.removeEventListener('touchend', handlePriceAxisGesture);
            try {
                chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleScaleCollisionCheck);
                chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleHistoricalScrollback);
                chart.timeScale().unsubscribeSizeChange(handleScaleCollisionCheck);
                chart.timeScale().unsubscribeSizeChange(measureAxisOffsets);
            } catch {}
            measureAxisOffsetsRef.current = () => {};
            if (sweepDecayTimerRef.current) {
                clearTimeout(sweepDecayTimerRef.current);
                sweepDecayTimerRef.current = null;
            }
            sweepTrackerRef.current.reset();
            if (utBotPrimitiveRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.detachPrimitive(utBotPrimitiveRef.current); } catch {}
            }
            if (spreadCorridorPrimitiveRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.detachPrimitive(spreadCorridorPrimitiveRef.current); } catch {}
            }
            emaSeriesMapRef.current.forEach((s) => {
                try { chart.removeSeries(s); } catch {}
            });
            emaSeriesMapRef.current.clear();
            safeRemoveChart(chart);

            // Cleanup refs so they respawn cleanly on the newly created chart instance
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            markersPluginRef.current = null;
            currentPriceLineRef.current = null;
            liquidationLineRef.current = null;
            bidLineRef.current = null;
            askLineRef.current = null;
            markLineRef.current = null;
            spreadCorridorPrimitiveRef.current = null;
            lastPriceLineRenderedRef.current = { price: 0, side: null, title: '', lineWidth: 1 };
            lastBidPriceRenderedRef.current = 0;
            lastAskPriceRenderedRef.current = 0;
            lastMarkPriceRenderedRef.current = 0;
            lastBidLabelVisibleRef.current = true;
            lastAskLabelVisibleRef.current = true;
            lastMarkLabelVisibleRef.current = true;
            hasLiveBboRef.current = false;
            mlEntryLineRef.current = null;
            mlSlLineRef.current = null;
            mlTpLineRef.current = null;
            wallLinesRef.current.clear();
            lastCandleRef.current = null;
            historyLoadedRef.current = false;
            allCandlesRef.current = [];
            emaSeriesRef.current = null;
            htfCandlesCacheRef.current = {};
            bbUpperSeriesRef.current = null;
            bbMiddleSeriesRef.current = null;
            bbLowerSeriesRef.current = null;
            utBotPrimitiveRef.current = null;
            prevUTBotStateRef.current = false;
            utBotMarkersRef.current = [];
            lastAlertedUtBotSigRef.current = '';
            lastUtBotHudSigRef.current = '';
            lastUtBotCandleCountRef.current = 0;
            setUtBotHudData(null);
            rsiSeriesRef.current = null;
            volumeSeriesRef.current = null;
        };
    }, [symbol, interval, exchange, chartId]);

    // Dynamically apply theme changes while preserving transparent canvas background for CosmoQuant watermark + L2 Heatmap
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: {
                background: {
                    type: 'solid',
                    color: 'transparent',
                } as any,
                textColor: isDark ? '#94a3b8' : '#334155',
            },
            grid: {
                vertLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.06)' },
                horzLines: { color: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(15, 23, 42, 0.06)' },
            },
            timeScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
            },
            rightPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
            },
            leftPriceScale: {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.15)',
            },
        });
        if (bbUpperSeriesRef.current) bbUpperSeriesRef.current.applyOptions({ color: isDark ? '#22c55e' : '#16a34a' });
        if (bbMiddleSeriesRef.current) bbMiddleSeriesRef.current.applyOptions({ color: isDark ? '#3b82f6' : '#2563eb' });
        if (bbLowerSeriesRef.current) bbLowerSeriesRef.current.applyOptions({ color: isDark ? '#ef4444' : '#dc2626' });
    }, [isDark, showHeatmapOverlay]);

    // Keep showCrosshairAIPredictRef in sync and cleanup crosshair button / line when toggled off
    useEffect(() => {
        showCrosshairAIPredictRef.current = showCrosshairAIPredict;
        if (!showCrosshairAIPredict) {
            if (crosshairBtnRef.current) {
                crosshairBtnRef.current.style.display = 'none';
            }
            crosshairPriceRef.current = null;
            if (aiClickPriceLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(aiClickPriceLineRef.current); } catch {}
                aiClickPriceLineRef.current = null;
            }
        }
    }, [showCrosshairAIPredict]);

    // ── Multi-Timeframe EMA Synchronizer ──
    const syncMtfEma = useCallback(async (customCandles?: any[]) => {
        if (!chartRef.current) return;
        const chart = chartRef.current;
        const candles = customCandles || allCandlesRef.current;
        if (!candles || candles.length === 0) return;

        const showEMA = indicatorSettings.showEMA;
        const activeTfs = indicatorSettings.emaTimeframes && indicatorSettings.emaTimeframes.length > 0
            ? indicatorSettings.emaTimeframes
            : ['1m'];
        const period = Math.max(1, Math.floor(Number(indicatorSettings.emaPeriod) || 7));
        const mode = indicatorSettings.emaRenderMode || 'smooth';

        if (!showEMA) {
            emaSeriesMapRef.current.forEach((series) => {
                try { series.applyOptions({ visible: false, lastValueVisible: false, title: '' }); } catch {}
            });
            if (emaSeriesRef.current) {
                try { emaSeriesRef.current.applyOptions({ visible: false, lastValueVisible: false, title: '' }); } catch {}
            }
            setMtfEmaValues({});
            return;
        }

        if (emaSeriesRef.current) {
            try { emaSeriesRef.current.applyOptions({ visible: false, lastValueVisible: false, title: '' }); } catch {}
        }

        // Clean up series for removed timeframes
        emaSeriesMapRef.current.forEach((series, tf) => {
            if (!activeTfs.includes(tf)) {
                try { chart.removeSeries(series); } catch {}
                emaSeriesMapRef.current.delete(tf);
            }
        });

        const showPriceLabels = indicatorSettings.emaShowPriceLabels !== false;
        const newLatestValues: Record<string, number> = {};

        for (const tf of activeTfs) {
            const tfStyle = DEFAULT_EMA_TIMEFRAMES[tf] || { timeframe: tf, label: tf, color: '#f59e0b', lineWidth: 1 };
            const color = (indicatorSettings.emaCustomColors && indicatorSettings.emaCustomColors[tf]) || tfStyle.color;

            let series = emaSeriesMapRef.current.get(tf);
            if (!series) {
                series = chart.addSeries(LineSeries, {
                    color,
                    lineWidth: 1,
                    priceScaleId: 'right',
                    title: showPriceLabels ? `EMA ${period} (${tf})` : '',
                    lastValueVisible: showPriceLabels,
                    priceLineVisible: false,
                    crosshairMarkerVisible: true,
                    visible: true,
                    priceFormat: {
                        type: 'custom',
                        minMove: 0.0000000001,
                        formatter: formatDisplayPrice,
                    },
                });
                emaSeriesMapRef.current.set(tf, series);
            } else {
                series.applyOptions({
                    color,
                    lineWidth: 1,
                    title: showPriceLabels ? `EMA ${period} (${tf})` : '',
                    visible: true,
                    lastValueVisible: showPriceLabels,
                    priceLineVisible: false,
                });
            }

            // If tf matches current chart interval, calculate directly
            if (tf === interval) {
                const pts = calculateEMA(candles, period);
                if (pts.length > 0) {
                    series.setData(pts as any);
                    newLatestValues[tf] = pts[pts.length - 1].value;
                }
                continue;
            }

            // If tf is different from chart interval, check cached authentic candles
            const cacheKey = `${exchange}:${symbol.toUpperCase()}:${tf}`;
            const cached = htfCandlesCacheRef.current[cacheKey];
            const now = Date.now();
            let tfCandles = (cached && now - cached.lastFetch < 30000 && cached.candles.length >= period)
                ? cached.candles
                : null;

            // Fetch authentic candles for tf whenever needed (guarded via live refs to prevent stale symbol bleed)
            const currentSymbol = symbol.toUpperCase();
            const currentExchange = exchange;
            const currentInterval = interval;
            if (!tfCandles) {
                marketDepthService.getOHLCV(currentSymbol, currentExchange, tf, 300)
                    .then((fetched) => {
                        if (
                            activeSymbolRef.current.toUpperCase() !== currentSymbol ||
                            activeExchangeRef.current !== currentExchange ||
                            activeIntervalRef.current !== currentInterval
                        ) return;
                        if (Array.isArray(fetched) && fetched.length > 0) {
                            const formatted = sanitizeAndSortCandles(fetched);
                            htfCandlesCacheRef.current[cacheKey] = { candles: formatted, lastFetch: Date.now() };
                            const refinedPts = calculateMTFEMA(allCandlesRef.current, currentInterval, tf, period, mode, formatted);
                            const s = emaSeriesMapRef.current.get(tf);
                            if (s && refinedPts.length > 0) {
                                s.setData(refinedPts as any);
                                const lastVal = refinedPts[refinedPts.length - 1].value;
                                setMtfEmaValues(prev => ({ ...prev, [tf]: lastVal }));
                            }
                        }
                    })
                    .catch(() => {});
            }

            const pts = calculateMTFEMA(candles, interval, tf, period, mode, tfCandles);
            if (pts.length > 0) {
                series.setData(pts as any);
                newLatestValues[tf] = pts[pts.length - 1].value;
            }
        }

        setMtfEmaValues(prev => {
            const next: Record<string, number> = {};
            activeTfs.forEach(t => {
                if (newLatestValues[t] !== undefined) {
                    next[t] = newLatestValues[t];
                } else if (prev[t] !== undefined) {
                    next[t] = prev[t];
                }
            });
            return next;
        });
    }, [
        interval, symbol, exchange,
        indicatorSettings.showEMA,
        indicatorSettings.emaPeriod,
        indicatorSettings.emaTimeframes,
        indicatorSettings.emaRenderMode,
        indicatorSettings.emaShowPriceLabels,
        indicatorSettings.emaCustomColors,
        candlesReadyTick
    ]);

    // Update Indicators
    useEffect(() => {
        if (!emaSeriesRef.current || !bbUpperSeriesRef.current || !bbMiddleSeriesRef.current || !bbLowerSeriesRef.current || !rsiSeriesRef.current) return;

        const data = allCandlesRef.current;

        syncMtfEma(data);
        const showBB = indicatorSettings.showBB;
        bbUpperSeriesRef.current.applyOptions({ visible: showBB, priceLineVisible: false, lastValueVisible: false });
        bbMiddleSeriesRef.current.applyOptions({ visible: showBB, priceLineVisible: false, lastValueVisible: false });
        bbLowerSeriesRef.current.applyOptions({ visible: showBB, priceLineVisible: false, lastValueVisible: false });
        rsiSeriesRef.current.applyOptions({ visible: indicatorSettings.showRSI, priceLineVisible: false, lastValueVisible: false });
        if (utBotPrimitiveRef.current) utBotPrimitiveRef.current.setVisible(indicatorSettings.showUTBot);

        if (chartRef.current) {
            chartRef.current.priceScale('left').applyOptions({ visible: indicatorSettings.showRSI || indicatorSettings.showMACD });
            requestAnimationFrame(() => measureAxisOffsetsRef.current());
        }

        if (volumeSeriesRef.current) {
            volumeSeriesRef.current.applyOptions({ visible: indicatorSettings.showVolume });
        }

        if (data.length === 0) return;

        const bbP = Math.max(1, Math.floor(Number(indicatorSettings.bbPeriod) || 20));
        const bbDev = Number.isFinite(Number(indicatorSettings.bbStdDev)) && Number(indicatorSettings.bbStdDev) > 0 ? Number(indicatorSettings.bbStdDev) : 2;
        const rsiP = Math.max(1, Math.floor(Number(indicatorSettings.rsiPeriod) || 14));

        if (showBB && bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current) {
            const bbResult = calculateBollingerBands(data, bbP, bbDev);
            bbUpperSeriesRef.current.setData(bbResult.map(d => ({ time: d.time, value: d.upper })) as any);
            bbMiddleSeriesRef.current.setData(bbResult.map(d => ({ time: d.time, value: d.middle })) as any);
            bbLowerSeriesRef.current.setData(bbResult.map(d => ({ time: d.time, value: d.lower })) as any);
            setBbData(bbResult);
        } else if (!showBB && bbData.length > 0) {
            setBbData([]);
        }
        if (indicatorSettings.showRSI && rsiSeriesRef.current) {
            rsiSeriesRef.current.setData(calculateRSI(data, rsiP) as any);
        }

        syncUTBotOverlayRef.current(data, indicatorSettings, false);

    }, [
        syncMtfEma,
        indicatorSettings.showBB,
        indicatorSettings.bbPeriod,
        indicatorSettings.bbStdDev,
        indicatorSettings.showRSI,
        indicatorSettings.rsiPeriod,
        indicatorSettings.showUTBot,
        indicatorSettings.utBotSensitivity,
        indicatorSettings.utBotAtrPeriod,
        indicatorSettings.utBotUseHeikinAshi,
        indicatorSettings.utBotTrendFilter,
        indicatorSettings.utBotEmaPeriod,
        indicatorSettings.utBotChopFilter,
        indicatorSettings.utBotAdxThreshold,
        indicatorSettings.utBotCandleClose,
        indicatorSettings.utBotCooldownBars,
        indicatorSettings.utBotOrderFlowConfirm,
        indicatorSettings.utBotHideWeakSignals,
        indicatorSettings.utBotShowSLTP,
        indicatorSettings.utBotTp1RR,
        indicatorSettings.utBotTp2RR,
        indicatorSettings.utBotRetestSniper,
        indicatorSettings.utBotDualMode,
        indicatorSettings.utBotSlowSensitivity,
        indicatorSettings.utBotSlowAtrPeriod,
        indicatorSettings.utBotClimaxGuard,
        indicatorSettings.utBotMaxExtensionAtr,
        indicatorSettings.utBotPullbackEntry,
        indicatorSettings.utBotFakeoutReversal,
        indicatorSettings.utBotShowHud,
        indicatorSettings.utBotEnableAlerts,
        indicatorSettings.showVolume,
        indicatorSettings.showMACD,
        indicatorSettings.showEMA,
        indicatorSettings.emaPeriod,
        indicatorSettings.emaTimeframes,
        indicatorSettings.emaRenderMode,
        indicatorSettings.emaShowPriceLabels,
        indicatorSettings.emaCustomColors,
        candlesReadyTick
    ]);

    // ML Prediction Lines handled by MLPredictionRenderer component in JSX

    // Reference live order flow data to avoid React dependency array thrashing
    const smcDataRef = useRef({ walls, cvdData, footprintData, currentPrice });
    smcDataRef.current = { walls, cvdData, footprintData, currentPrice };

    // SMC Calculation Effect (Throttled)
    useEffect(() => {
        if (!indicatorSettings.showSMC) {
            setSmcData(null);
            return;
        }

        const smcSettings = {
            mode: indicatorSettings.smcMode,
            style: indicatorSettings.smcStyle,
            showInternals: indicatorSettings.smcShowInternals,
            internalBullFilter: indicatorSettings.smcInternalBullFilter,
            internalBearFilter: indicatorSettings.smcInternalBearFilter,
            confluenceFilter: indicatorSettings.smcConfluenceFilter,
            showSwing: indicatorSettings.smcShowSwing,
            swingBullFilter: indicatorSettings.smcSwingBullFilter,
            swingBearFilter: indicatorSettings.smcSwingBearFilter,
            showSwingPoints: false,
            swingLength: indicatorSettings.smcSwingLength,
            showStrongWeakHL: indicatorSettings.smcShowStrongWeakHL,
            showInternalOB: indicatorSettings.smcShowInternalOB,
            internalOBCount: indicatorSettings.smcInternalOBCount,
            showSwingOB: indicatorSettings.smcShowSwingOB,
            swingOBCount: indicatorSettings.smcSwingOBCount,
            obFilter: indicatorSettings.smcOBFilter,
            obMitigation: indicatorSettings.smcOBMitigation,
            showEqualHL: indicatorSettings.smcShowEqualHL,
            equalHLLength: indicatorSettings.smcEqualHLLength,
            equalHLThreshold: indicatorSettings.smcEqualHLThreshold,
            showFVG: indicatorSettings.smcShowFVG,
            fvgAutoThreshold: indicatorSettings.smcFVGAutoThreshold,
            fvgExtendBars: indicatorSettings.smcFVGExtendBars,
            showPDZones: indicatorSettings.smcShowPDZones,
            smcL2Validation: indicatorSettings.smcL2Validation,
            smcCVDTrap: indicatorSettings.smcCVDTrap,
            smcMicroFVG: indicatorSettings.smcMicroFVG,
            smcSweepDetection: indicatorSettings.smcSweepDetection,
            smcShowSwingPatterns: indicatorSettings.smcShowSwingPatterns,
        };

        let isCancelled = false;
        let lastVersion = -1;

        const runCalc = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (candles.length < 10) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            const { walls: liveWalls, cvdData: liveCvd, footprintData: liveFp, currentPrice: livePx } = smcDataRef.current;
            try {
                const result = calculateSMC(candles, smcSettings as any, liveWalls as any, liveCvd, liveFp as any, livePx);
                if (!isCancelled) setSmcData(result);
            } catch (err) {
                console.warn('SMC calculation error:', err);
            }
        };

        // Throttle updates to 4s desktop / 6s mobile thermal guard (scaled & staggered per chart when multi-chart active)
        const cleanup = startStaggeredInterval(
            runCalc,
            Math.round((isThermalGuard ? 6000 : 4000) * thermalIntervalScale),
            staggerDelayMs
        );

        return () => {
            isCancelled = true;
            cleanup();
        };
    }, [
        indicatorSettings.showSMC,
        indicatorSettings.smcMode,
        indicatorSettings.smcStyle,
        indicatorSettings.smcShowInternals,
        indicatorSettings.smcInternalBullFilter,
        indicatorSettings.smcInternalBearFilter,
        indicatorSettings.smcConfluenceFilter,
        indicatorSettings.smcShowSwing,
        indicatorSettings.smcSwingBullFilter,
        indicatorSettings.smcSwingBearFilter,
        indicatorSettings.smcSwingLength,
        indicatorSettings.smcShowStrongWeakHL,
        indicatorSettings.smcShowInternalOB,
        indicatorSettings.smcInternalOBCount,
        indicatorSettings.smcShowSwingOB,
        indicatorSettings.smcSwingOBCount,
        indicatorSettings.smcOBFilter,
        indicatorSettings.smcOBMitigation,
        indicatorSettings.smcShowEqualHL,
        indicatorSettings.smcEqualHLLength,
        indicatorSettings.smcEqualHLThreshold,
        indicatorSettings.smcShowFVG,
        indicatorSettings.smcFVGAutoThreshold,
        indicatorSettings.smcFVGExtendBars,
        indicatorSettings.smcShowPDZones,
        indicatorSettings.smcL2Validation,
        indicatorSettings.smcCVDTrap,
        indicatorSettings.smcMicroFVG,
        indicatorSettings.smcSweepDetection,
        indicatorSettings.smcShowSwingPatterns,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // ICT Killzones Calculation Effect (Throttled)
    useEffect(() => {
        if (!indicatorSettings.showICTKillzones) {
            setIctData(null);
            return;
        }

        const ictConfigs = {
            sessions: [
                { id: 'asia', name: 'Asia', session: indicatorSettings.ictAsiaSession, color: '#3b82f6', enabled: true },
                { id: 'london', name: 'London', session: indicatorSettings.ictLondonSession, color: '#ef4444', enabled: true },
                { id: 'nyam', name: 'NY AM', session: indicatorSettings.ictNyAmSession, color: '#089981', enabled: true },
                { id: 'nylu', name: 'NY Lunch', session: indicatorSettings.ictNyLunchSession, color: '#f59e0b', enabled: true },
                { id: 'nypm', name: 'NY PM', session: indicatorSettings.ictNyPmSession, color: '#a855f7', enabled: true },
            ],
            openingPrices: [
                { id: 'h1', label: 'Midnight', session: '0000-0001', color: '#ffffff', enabled: indicatorSettings.ictShowMidnightOpen },
                { id: 'h2', label: '06:00', session: '0600-0601', color: '#94a3b8', enabled: true },
                { id: 'h3', label: '10:00', session: '1000-1001', color: '#94a3b8', enabled: true },
                { id: 'h4', label: '14:00', session: '1400-1401', color: '#94a3b8', enabled: true },
            ],
            timestamps: [
                { id: 'v1', session: '0000-0001', color: '#334155', enabled: true },
                { id: 'v2', session: '0830-0831', color: '#334155', enabled: true },
                { id: 'v3', session: '1000-1001', color: '#334155', enabled: true },
                { id: 'v4', session: '1200-1201', color: '#334155', enabled: true },
            ],
            showPivots: indicatorSettings.ictShowPivots,
            showDWM: indicatorSettings.ictShowDWM,
            showOpeningPrices: indicatorSettings.ictShowOpeningPrices,
            showTimestamps: indicatorSettings.ictShowTimestamps,
            pivotsExtend: indicatorSettings.ictPivotsExtend,
            showSilverBullet: indicatorSettings.ictShowSilverBullet,
            showConfluence: indicatorSettings.ictShowConfluence,
            showAMD: indicatorSettings.ictShowAMD,
            showGaps: indicatorSettings.ictShowGaps,
            showVolatility: indicatorSettings.ictShowVolatility,
            showEquilibrium: indicatorSettings.ictShowEquilibrium,
        };

        let lastVersion = -1;
        const runIctCalc = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (candles.length < 10) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            try {
                const result = calculateICTSuite(candles, ictConfigs);
                setIctData(result);
            } catch (err) {
                console.warn('ICT calculation error:', err);
            }
        };

        return startStaggeredInterval(
            runIctCalc,
            Math.round((isThermalGuard ? 6000 : 4000) * thermalIntervalScale),
            staggerDelayMs
        );
    }, [
        indicatorSettings.showICTKillzones,
        indicatorSettings.ictAsiaSession,
        indicatorSettings.ictLondonSession,
        indicatorSettings.ictNyAmSession,
        indicatorSettings.ictNyLunchSession,
        indicatorSettings.ictNyPmSession,
        indicatorSettings.ictShowMidnightOpen,
        indicatorSettings.ictShowPivots,
        indicatorSettings.ictShowDWM,
        indicatorSettings.ictShowOpeningPrices,
        indicatorSettings.ictShowTimestamps,
        indicatorSettings.ictPivotsExtend,
        indicatorSettings.ictShowSilverBullet,
        indicatorSettings.ictShowConfluence,
        indicatorSettings.ictShowAMD,
        indicatorSettings.ictShowGaps,
        indicatorSettings.ictShowVolatility,
        indicatorSettings.ictShowEquilibrium,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // LuxAlgo ICT Concepts Engine
    useEffect(() => {
        if (!indicatorSettings.luxShowIndicator) {
            setLuxIctData(null);
            return;
        }

        const luxConfigs = {
            mode: indicatorSettings.luxMode,
            showMS: indicatorSettings.luxShowMS,
            swingLength: indicatorSettings.luxSwingLength,
            showMSS: indicatorSettings.luxShowMSS,
            showBOS: indicatorSettings.luxShowBOS,
            showDisplacement: indicatorSettings.luxShowDisplacement,
            percBody: indicatorSettings.luxPercBody,
            showVIMB: indicatorSettings.luxShowVIMB,
            vimbThreshold: indicatorSettings.luxVIMBThreshold,
            showOB: indicatorSettings.luxShowOB,
            obLookback: indicatorSettings.luxOBLookback,
            showBullOB: indicatorSettings.luxShowBullOB,
            showBearOB: indicatorSettings.luxShowBearOB,
            showOBLabels: indicatorSettings.luxShowOBLabels,
            showLiq: indicatorSettings.luxShowLiq,
            liqMargin: indicatorSettings.luxLiqMargin,
            liqVisibleCount: indicatorSettings.luxLiqVisibleCount,
            showFVG: indicatorSettings.luxShowFVG,
            bpr: indicatorSettings.luxBPR,
            fvgType: indicatorSettings.luxFVGType,
            fvgVisibleCount: indicatorSettings.luxFVGVisibleCount,
            showNWOG: indicatorSettings.luxShowNWOG,
            nwogMax: indicatorSettings.luxNWOGMax,
            showNDOG: indicatorSettings.luxShowNDOG,
            ndogMax: indicatorSettings.luxNDOGMax,
            fibMode: indicatorSettings.luxFibMode,
            fibExtend: indicatorSettings.luxFibExtend,
            showKillzones: indicatorSettings.luxShowKillzones,
        };

        const runLux = () => {
            const candles = allCandlesRef.current;
            if (candles.length < 10) return;
            try {
                // @ts-ignore
                const result = calculateLuxIctConcepts(candles, luxConfigs);
                setLuxIctData(result);
            } catch (err) {
                console.warn('LuxAlgo ICT calculation error:', err);
            }
        };

        const timer = setTimeout(runLux, 400);
        return () => clearTimeout(timer);
    }, [
        indicatorSettings.luxShowIndicator,
        indicatorSettings.luxMode,
        indicatorSettings.luxShowMS,
        indicatorSettings.luxSwingLength,
        indicatorSettings.luxShowMSS,
        indicatorSettings.luxShowBOS,
        indicatorSettings.luxShowDisplacement,
        indicatorSettings.luxPercBody,
        indicatorSettings.luxShowVIMB,
        indicatorSettings.luxVIMBThreshold,
        indicatorSettings.luxShowOB,
        indicatorSettings.luxOBLookback,
        indicatorSettings.luxShowBullOB,
        indicatorSettings.luxShowBearOB,
        indicatorSettings.luxShowOBLabels,
        indicatorSettings.luxShowLiq,
        indicatorSettings.luxLiqMargin,
        indicatorSettings.luxLiqVisibleCount,
        indicatorSettings.luxShowFVG,
        indicatorSettings.luxBPR,
        indicatorSettings.luxFVGType,
        indicatorSettings.luxFVGVisibleCount,
        indicatorSettings.luxShowNWOG,
        indicatorSettings.luxNWOGMax,
        indicatorSettings.luxShowNDOG,
        indicatorSettings.luxNDOGMax,
        indicatorSettings.luxFibMode,
        indicatorSettings.luxFibExtend,
        indicatorSettings.luxShowKillzones,
        candlesReadyTick
    ]);

    // Fetch ICT PO3 Data from Backend API
    useEffect(() => {
        if (!symbol || !indicatorSettings.showICTPO3) return;
        const fetchPO3 = async () => {
            if (document.hidden) return;
            try {
                const formattedSymbol = symbol.replace('/', '-');
                // Adjust base URL as needed for your env. Assuming proxy or relative route is working.
                const response = await fetch(`/api/v1/indicators/po3/${formattedSymbol}?timeframe=${interval}`);
                const resData = await response.json();
                if (resData.status === 'success') {
                    setIctPO3Data(resData.data);
                }
            } catch (err) {
                console.warn('Error fetching PO3 data:', err);
            }
        };
        fetchPO3();
        const intervalId = setInterval(fetchPO3, 60000); // refresh every minute
        return () => clearInterval(intervalId);
    }, [symbol, interval, indicatorSettings.showICTPO3]);

    // Supertrend Calculation Effect (Throttled)
    useEffect(() => {
        if (!indicatorSettings.showSupertrend) {
            setSupertrendData([]);
            return;
        }

        let lastVersion = -1;
        const runSupertrendCalc = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (candles.length < 10) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            try {
                const result = calculateSupertrend(
                    candles,
                    indicatorSettings.supertrendAtrPeriod,
                    indicatorSettings.supertrendMultiplier,
                    indicatorSettings.supertrendChangeATR
                );
                setSupertrendData(result);
            } catch (err) {
                console.warn('Supertrend calculation error:', err);
            }
        };

        return startStaggeredInterval(
            runSupertrendCalc,
            Math.round((isThermalGuard ? 7500 : 5000) * thermalIntervalScale),
            staggerDelayMs
        );
    }, [
        indicatorSettings.showSupertrend,
        indicatorSettings.supertrendAtrPeriod,
        indicatorSettings.supertrendMultiplier,
        indicatorSettings.supertrendChangeATR,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // MSB-OB Calculation Effect (Throttled)
    useEffect(() => {
        if (!indicatorSettings.showMsbOb) {
            setMsbObData(null);
            return;
        }

        let isCancelled = false;
        let lastVersion = -1;
        const runMsbObCalc = () => {
            if (document.hidden || isCancelled) return;
            const candles = allCandlesRef.current;
            if (!candles || candles.length < 10) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            try {
                const result = calculateMsbOb(
                    candles,
                    indicatorSettings.msbObZigzagLen,
                    indicatorSettings.msbObFibFactor,
                    indicatorSettings.msbObDeleteBroken
                );
                if (!isCancelled) {
                    setMsbObData(result);
                }
            } catch (err) {
                console.warn('MSB-OB calculation error:', err);
            }
        };

        const cleanup = startStaggeredInterval(
            runMsbObCalc,
            Math.round((isThermalGuard ? 6000 : 4000) * thermalIntervalScale),
            staggerDelayMs
        );

        return () => {
            isCancelled = true;
            cleanup();
        };
    }, [
        indicatorSettings.showMsbOb,
        indicatorSettings.msbObZigzagLen,
        indicatorSettings.msbObFibFactor,
        indicatorSettings.msbObDeleteBroken,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // ── Wick Rejection S/R Calculation Effect ──
    useEffect(() => {
        let isMounted = true;
        if (!indicatorSettings.showWickSR) {
            setWickSRData(null);
            setWickSRCandles([]);
            return;
        }

        const runWickSRCalc = async () => {
            if (document.hidden) return;
            try {
                const tf = indicatorSettings.wickSRTimeframe || '15m';
                // If it's 1m, and chart is 1m, we could reuse allCandlesRef, but for true generic support, we fetch independent data series for Wick SR
                const data = await marketDepthService.getOHLCV(symbol.toUpperCase(), exchange, tf, 500);
                if (!isMounted) return;

                const formatted = sanitizeAndSortCandles(Array.isArray(data) ? data : []);
                setWickSRCandles(formatted);

                const result = calculateWickRejectionSR(
                    formatted,
                    indicatorSettings.wickSRLookback,
                    indicatorSettings.wickSRMinTouches,
                    indicatorSettings.wickSRAtrPeriod,
                    indicatorSettings.wickSRAtrMultiplier,
                );
                setWickSRData(result);
            } catch (err) {
                console.warn('[WickSR] Calculation error:', err);
            }
        };

        const cleanup = startStaggeredInterval(
            runWickSRCalc,
            Math.round((isThermalGuard ? 15000 : 10000) * thermalIntervalScale),
            staggerDelayMs
        );
        return () => {
            isMounted = false;
            cleanup();
        };
    }, [indicatorSettings.showWickSR, indicatorSettings.wickSRTimeframe, indicatorSettings.wickSRLookback, indicatorSettings.wickSRMinTouches, indicatorSettings.wickSRAtrPeriod, indicatorSettings.wickSRAtrMultiplier, symbol, exchange, isThermalGuard, thermalIntervalScale, staggerDelayMs]);

    // ── Quantum AI v8 Calculation Effect ──
    useEffect(() => {
        if (!indicatorSettings.showQuantumAI) {
            setQuantumAiData([]);
            return;
        }

        let lastVersion = -1;
        const runQuantumCalc = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (!candles || candles.length < 50) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            try {
                const pocPrice = vpvrData && vpvrData.length > 0 ? vpvrData.reduce((max, row) => (row.volume > max.volume ? row : max), vpvrData[0]).price : 0;
                const results = calculateQuantumAi(candles, {
                    showQuantumAI: indicatorSettings.showQuantumAI,
                    quantumMinConf: indicatorSettings.quantumMinConf,
                    quantumVolatilityFilter: indicatorSettings.quantumVolatilityFilter,
                    quantumVolThreshold: indicatorSettings.quantumVolThreshold,
                }, pocPrice);
                setQuantumAiData(results);
            } catch (err) {
                console.warn('Quantum AI calculation error:', err);
            }
        };

        return startStaggeredInterval(
            runQuantumCalc,
            Math.round((isThermalGuard ? 7500 : 5000) * thermalIntervalScale),
            staggerDelayMs
        );
    }, [
        indicatorSettings.showQuantumAI,
        indicatorSettings.quantumMinConf,
        indicatorSettings.quantumVolatilityFilter,
        indicatorSettings.quantumVolThreshold,
        symbol,
        interval,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // ── VWAP Standard Deviation Bands Effect ──
    useEffect(() => {
        if (!indicatorSettings.showVWAPSD) {
            setVwapSDData([]);
            return;
        }

        let lastVersion = -1;
        const runVwapSDCalc = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (!candles || candles.length < 5) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            try {
                const results = calculateVWAPSD(
                    candles,
                    indicatorSettings.vwapAnchor,
                    indicatorSettings.timezoneOffset || 0,
                    indicatorSettings.vwapSDMultiplier1,
                    indicatorSettings.vwapSDMultiplier2,
                    indicatorSettings.vwapSDMultiplier3
                );
                setVwapSDData(results);
            } catch (err) {
                console.warn('[VWAP SD] calculation error:', err);
            }
        };

        return startStaggeredInterval(
            runVwapSDCalc,
            Math.round((isThermalGuard ? 7500 : 5000) * thermalIntervalScale),
            staggerDelayMs
        );
    }, [
        indicatorSettings.showVWAPSD,
        indicatorSettings.vwapAnchor,
        indicatorSettings.timezoneOffset,
        indicatorSettings.vwapSDMultiplier1,
        indicatorSettings.vwapSDMultiplier2,
        indicatorSettings.vwapSDMultiplier3,
        symbol,
        interval,
        isThermalGuard,
        thermalIntervalScale,
        staggerDelayMs
    ]);

    // ── Safe Marker Setter Utility ──
    const safeSetMarkers = () => {
        if (!markersPluginRef.current) return;
        const allMarkers = [
            ...botTradeMarkersRef.current,
            ...utBotMarkersRef.current,
            ...quantumAiMarkersRef.current,
            ...patternMarkersRef.current,
            ...aetherMarkersRef.current,
            ...mlPredictionMarkersRef.current,
            ...godModeMarkersRef.current,
        ];

        const grouped = allMarkers.reduce((acc, curr) => {
            if (!acc[curr.time]) acc[curr.time] = [];
            acc[curr.time].push(curr);
            return acc;
        }, {} as Record<string, any[]>);

        const deduplicatedMarkers = Object.keys(grouped).map(timeStr => {
            const items = grouped[timeStr];
            const bullItems = items.filter(i => i.position === 'belowBar');
            const bearItems = items.filter(i => i.position === 'aboveBar');
            const inItems = items.filter(i => i.position === 'inBar');

            const final = [];
            if (bullItems.length > 0) final.push({ ...bullItems[0], text: Array.from(new Set(bullItems.map(i => i.text))).filter(t => t).join(', ') });
            if (bearItems.length > 0) final.push({ ...bearItems[0], text: Array.from(new Set(bearItems.map(i => i.text))).filter(t => t).join(', ') });
            if (inItems.length > 0) final.push({ ...inItems[0], text: Array.from(new Set(inItems.map(i => i.text))).filter(t => t).join(', ') });
            return final;
        }).flat().sort((a, b) => a.time - b.time);

        try {
            markersPluginRef.current.setMarkers(deduplicatedMarkers);
        } catch (err) {
            console.error('Failed to set markers:', err);
        }
    };

    // Unified UT Bot Pro overlay updater used by initial history load, setting toggles, and live ticks
    syncUTBotOverlayRef.current = (
        candles: any[],
        settings: IndicatorSettings,
        liveLastOnly: boolean = false,
        isInitialLoad: boolean = false
    ) => {
        if (!candlestickSeriesRef.current || !utBotPrimitiveRef.current) return;

        if (!settings.showUTBot) {
            utBotPrimitiveRef.current.setPayload({
                fastPoints: [],
                slowPoints: [],
                activeSetup: null,
                showSLTP: false,
                tp1RR: settings.utBotTp1RR || 1.5,
                tp2RR: settings.utBotTp2RR || 2.5,
                visible: false,
            });
            if (lastUtBotHudSigRef.current !== '') {
                lastUtBotHudSigRef.current = '';
                setUtBotHudData(null);
            }
            lastAlertedUtBotSigRef.current = '';

            if (prevUTBotStateRef.current) {
                prevUTBotStateRef.current = false;
                if (candles.length > 0) {
                    const cleanedCandles = candles.map(c => ({ ...c, color: undefined, wickColor: undefined }));
                    candlestickSeriesRef.current.setData(cleanedCandles);
                    allCandlesRef.current = cleanedCandles;
                }
                if (lastCandleRef.current) {
                    const { color: _c, wickColor: _wc, ...rest } = lastCandleRef.current as any;
                    lastCandleRef.current = rest;
                }
                if (utBotMarkersRef.current.length > 0) {
                    utBotMarkersRef.current = [];
                    safeSetMarkers();
                }
            }
            return;
        }

        prevUTBotStateRef.current = true;
        const pro = calculateUTBotPro({
            candles,
            sensitivity: settings.utBotSensitivity,
            atrPeriod: settings.utBotAtrPeriod,
            useHeikinAshi: settings.utBotUseHeikinAshi,
            trendFilter: settings.utBotTrendFilter,
            emaPeriod: settings.utBotEmaPeriod,
            chopFilter: settings.utBotChopFilter,
            adxThreshold: settings.utBotAdxThreshold,
            candleClose: settings.utBotCandleClose,
            cooldownBars: settings.utBotCooldownBars,
            orderFlowConfirm: settings.utBotOrderFlowConfirm,
            hideWeakSignals: settings.utBotHideWeakSignals,
            tp1RR: settings.utBotTp1RR,
            tp2RR: settings.utBotTp2RR,
            retestSniper: settings.utBotRetestSniper,
            dualMode: settings.utBotDualMode,
            slowSensitivity: settings.utBotSlowSensitivity,
            slowAtrPeriod: settings.utBotSlowAtrPeriod,
            climaxGuard: settings.utBotClimaxGuard !== false,
            maxExtensionAtr: settings.utBotMaxExtensionAtr || 1.6,
            pullbackEntry: settings.utBotPullbackEntry !== false,
            fakeoutReversal: settings.utBotFakeoutReversal !== false,
            walls: wallsRef.current,
            footprintData: footprintDataRef.current,
        });

        utBotPrimitiveRef.current.setPayload({
            fastPoints: pro.fastPoints,
            slowPoints: pro.slowPoints,
            activeSetup: pro.activeSetup,
            showSLTP: Boolean(settings.utBotShowSLTP),
            tp1RR: settings.utBotTp1RR || 1.5,
            tp2RR: settings.utBotTp2RR || 2.5,
            visible: true,
        });

        // Update HUD state only when meaningful metrics change to prevent 200ms tick re-render churn
        const hudSig = `${pro.marketBias}|${pro.backtest.wins}/${pro.backtest.losses}/${pro.backtest.netR}|${pro.latestAdx}|${pro.latestRsi}|${pro.activeSetup?.time}:${pro.activeSetup?.kind}:${pro.activeSetup?.grade}:${pro.activeSetup?.sl}:${pro.activeSetup?.isInvalidated}`;
        if (settings.utBotShowHud !== false) {
            if (hudSig !== lastUtBotHudSigRef.current) {
                lastUtBotHudSigRef.current = hudSig;
                setUtBotHudData({
                    marketBias: pro.marketBias,
                    backtest: pro.backtest,
                    activeSetup: pro.activeSetup,
                    latestAdx: pro.latestAdx,
                    latestRsi: pro.latestRsi,
                });
            }
        } else if (lastUtBotHudSigRef.current !== '') {
            lastUtBotHudSigRef.current = '';
            setUtBotHudData(null);
        }

        const nextMarkers = pro.signals.map(s => {
            if (!s.isConfirmed) {
                return {
                    time: s.time,
                    position: s.side === 'buy' ? 'belowBar' : 'aboveBar',
                    color: '#f59e0b',
                    shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: s.side === 'buy' ? 'PRE BUY' : 'PRE SELL',
                };
            }
            if (s.kind === 'SWEEP_BUY' || s.kind === 'SWEEP_SELL') {
                return {
                    time: s.time,
                    position: s.side === 'buy' ? 'belowBar' : 'aboveBar',
                    color: s.side === 'buy' ? '#a855f7' : '#ec4899',
                    shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: s.side === 'buy'
                        ? (settings.utBotOrderFlowConfirm ? `SWEEP L ${s.grade}` : 'SWEEP L')
                        : (settings.utBotOrderFlowConfirm ? `SWEEP S ${s.grade}` : 'SWEEP S'),
                };
            }
            if (s.kind === 'DIP_BUY' || s.kind === 'DIP_SELL') {
                return {
                    time: s.time,
                    position: s.side === 'buy' ? 'belowBar' : 'aboveBar',
                    color: s.side === 'buy' ? '#06b6d4' : '#f43f5e',
                    shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: s.side === 'buy'
                        ? (settings.utBotOrderFlowConfirm ? `DIP BUY ${s.grade}` : 'DIP BUY')
                        : (settings.utBotOrderFlowConfirm ? `DIP SELL ${s.grade}` : 'DIP SELL'),
                };
            }
            if (s.isSnipe) {
                return {
                    time: s.time,
                    position: s.side === 'buy' ? 'belowBar' : 'aboveBar',
                    color: s.side === 'buy' ? '#10b981' : '#f97316',
                    shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: s.side === 'buy'
                        ? (settings.utBotOrderFlowConfirm ? `SNIPE L ${s.grade}` : 'SNIPE L')
                        : (settings.utBotOrderFlowConfirm ? `SNIPE S ${s.grade}` : 'SNIPE S'),
                };
            }
            return {
                time: s.time,
                position: s.side === 'buy' ? 'belowBar' : 'aboveBar',
                color: s.side === 'buy' ? '#22c55e' : '#ef4444',
                shape: s.side === 'buy' ? 'arrowUp' : 'arrowDown',
                text: s.side === 'buy'
                    ? (settings.utBotOrderFlowConfirm ? `BUY ${s.grade}` : 'BUY')
                    : (settings.utBotOrderFlowConfirm ? `SELL ${s.grade}` : 'SELL'),
            };
        });

        const prevMarkers = utBotMarkersRef.current;
        const markersChanged =
            prevMarkers.length !== nextMarkers.length ||
            nextMarkers.some((m, idx) => prevMarkers[idx]?.time !== m.time || prevMarkers[idx]?.text !== m.text);
        if (markersChanged) {
            utBotMarkersRef.current = nextMarkers;
            safeSetMarkers();
        }

        // Fire real-time sound + toast alert once per newly confirmed live signal
        if (settings.utBotEnableAlerts && candles.length > 0 && pro.signals.length > 0) {
            const latestConfirmed = [...pro.signals].reverse().find(s => s.isConfirmed);
            const liveThresholdIdx = settings.utBotCandleClose ? candles.length - 2 : candles.length - 1;
            if (latestConfirmed && latestConfirmed.barIndex >= liveThresholdIdx) {
                const alertKey = `${latestConfirmed.time}:${latestConfirmed.kind}`;
                if (isInitialLoad) {
                    // Seed without firing historical sound on initial page load
                    lastAlertedUtBotSigRef.current = alertKey;
                } else if (lastAlertedUtBotSigRef.current !== alertKey) {
                    lastAlertedUtBotSigRef.current = alertKey;
                    playUTBotSignalSound(latestConfirmed.side, latestConfirmed.grade);
                    const label = latestConfirmed.kind.replace('_', ' ');
                    const msg = `${symbol.toUpperCase()} (${interval}) · UT Bot ${label} [${latestConfirmed.grade}] @ ${formatDisplayPrice(latestConfirmed.price)}`;
                    if (latestConfirmed.side === 'buy') {
                        toast.success(msg, { duration: 4000 });
                    } else {
                        toast.error(msg, { duration: 4000 });
                    }
                }
            }
        }

        const utData = pro.fastPoints;
        if (candles.length === 0) return;

        // Only call full setData when a new bar closed AND its final trend color actually changed (prevents 1,000-bar flash on every close!)
        const barCountChanged = candles.length !== lastUtBotCandleCountRef.current;
        lastUtBotCandleCountRef.current = candles.length;

        const prevClosedColorUnchanged = (() => {
            if (!liveLastOnly || !barCountChanged || candles.length < 2 || utData.length < 2) return false;
            const prevBar = candles[candles.length - 2];
            const prevUt = utData[utData.length - 2];
            if (!prevBar || !prevUt || prevBar.time !== prevUt.time) return false;
            const expectedColor = prevUt.color === 'green' ? '#22c55e' : prevUt.color === 'red' ? '#ef4444' : '#3b82f6';
            return prevBar.color === expectedColor;
        })();

        if (liveLastOnly && (!barCountChanged || prevClosedColorUnchanged)) {
            if (utData.length === 0) return;
            const lastUT = utData[utData.length - 1];
            const lastIdx = candles.length - 1;
            const baseCandle = candles[lastIdx];
            if (baseCandle && baseCandle.time === lastUT.time) {
                const candleColor = lastUT.color === 'green' ? '#22c55e' : lastUT.color === 'red' ? '#ef4444' : '#3b82f6';
                const coloredBar = { ...baseCandle, color: candleColor, wickColor: candleColor };
                allCandlesRef.current[lastIdx] = coloredBar;
                if (lastCandleRef.current && lastCandleRef.current.time === coloredBar.time) {
                    lastCandleRef.current = { ...lastCandleRef.current, color: candleColor, wickColor: candleColor };
                }
                candlestickSeriesRef.current.update(coloredBar);
            }
            return;
        }

        const utMap = new Map<any, UTBotDataPoint>();
        for (let i = 0; i < utData.length; i++) utMap.set(utData[i].time, utData[i]);

        const newCandles = candles.map(c => {
            const utPoint = utMap.get(c.time);
            if (utPoint) {
                const color = utPoint.color === 'green' ? '#22c55e' : utPoint.color === 'red' ? '#ef4444' : '#3b82f6';
                return { ...c, color, wickColor: color };
            }
            return { ...c, color: undefined, wickColor: undefined };
        });
        candlestickSeriesRef.current.setData(newCandles);
        allCandlesRef.current = newCandles;
        if (newCandles.length > 0) {
            const lastColored = newCandles[newCandles.length - 1];
            lastCandleRef.current = lastCandleRef.current && lastCandleRef.current.time === lastColored.time
                ? { ...lastCandleRef.current, color: lastColored.color, wickColor: lastColored.wickColor }
                : { ...lastColored };
        }
    };

    // ── Quantum AI Marker Rendering Effect ──
    useEffect(() => {
        if (!markersPluginRef.current) return;
        if (!indicatorSettings.showQuantumAI || quantumAiData.length === 0) {
            quantumAiMarkersRef.current = [];
        } else {
            quantumAiMarkersRef.current = quantumAiData
                .filter(d => d.bullEntry || d.bearEntry)
                .map(d => ({
                    time: d.time,
                    position: d.bullEntry ? 'belowBar' : 'aboveBar',
                    color: d.bullEntry ? '#a855f7' : '#ec4899', // purple for bull, pink for bear
                    shape: d.bullEntry ? 'arrowUp' : 'arrowDown',
                    text: d.bullEntry
                        ? `⚡ ${Math.round(d.bullConfidence)}%`
                        : `⚡ ${Math.round(d.bearConfidence)}%`,
                }));
        }
        safeSetMarkers();
    }, [quantumAiData, indicatorSettings.showQuantumAI]);

    // ── God Mode Signal Marker Rendering Effect ──
    useEffect(() => {
        if (!markersPluginRef.current || !lastCandleRef.current) return;
        if (!indicatorSettings.showLiquidationHeatmap || !indicatorSettings.liquidationShowSignalArrow || !godModeData) {
            godModeMarkersRef.current = [];
        } else {
            const result = calculateGodModeSignal(godModeData as any);
            if (result.signal !== 'NEUTRAL') {
                const isBuy = result.signal === 'BUY';
                godModeMarkersRef.current = [{
                    time: lastCandleRef.current.time,
                    position: isBuy ? 'belowBar' : 'aboveBar',
                    color: isBuy ? '#10b981' : '#ef4444',
                    shape: isBuy ? 'arrowUp' : 'arrowDown',
                    text: `GM ${result.signal} (${result.score})`
                }];
            } else {
                godModeMarkersRef.current = [];
            }
        }
        safeSetMarkers();
    }, [godModeData, indicatorSettings.showLiquidationHeatmap, indicatorSettings.liquidationShowSignalArrow, candlesReadyTick]);

    // ── SMC Flow / Aether Flow Marker Rendering Effect ──
    useEffect(() => {
        if (!markersPluginRef.current) return;
        if (!indicatorSettings.showAetherFlow || !aetherFlowData) {
            aetherMarkersRef.current = [];
        } else {
            let markers: any[] = [];
            if (indicatorSettings.aetherUtBot && aetherFlowData.ut_bot?.length > 0) {
                aetherFlowData.ut_bot.forEach(d => {
                    const isBuy = indicatorSettings.aetherSupertrend ? d.filtered_buy : d.buy_signal;
                    const isSell = indicatorSettings.aetherSupertrend ? d.filtered_sell : d.sell_signal;
                    if (isBuy) markers.push({ time: d.time, position: 'belowBar', color: '#22c55e', shape: 'arrowUp', text: 'BUY' });
                    if (isSell) markers.push({ time: d.time, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'SELL' });
                });
            }
            if (indicatorSettings.aetherSmc && aetherFlowData.smc) {
                aetherFlowData.smc.swing_highs?.forEach((d: any) => {
                    markers.push({ time: d.time, position: 'aboveBar', color: '#f59e0b', shape: 'circle', text: 'HH' });
                });
                aetherFlowData.smc.swing_lows?.forEach((d: any) => {
                    markers.push({ time: d.time, position: 'belowBar', color: '#3b82f6', shape: 'circle', text: 'LL' });
                });
            }
            if (indicatorSettings.aether3BarReversal && aetherFlowData.three_bar_reversal) {
                aetherFlowData.three_bar_reversal.forEach((d: any) => {
                    if (d.type === 'bullish') markers.push({ time: d.time, position: 'belowBar', color: '#10b981', shape: 'arrowUp', text: '3BR Bull' });
                    if (d.type === 'bearish') markers.push({ time: d.time, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: '3BR Bear' });
                });
            }
            if (indicatorSettings.aetherSupertrend && aetherFlowData.supertrend && aetherFlowData.supertrend.length > 0) {
                let lastTrend = aetherFlowData.supertrend[0].trend;
                for (let i = 1; i < aetherFlowData.supertrend.length; i++) {
                    const d = aetherFlowData.supertrend[i];
                    if (d.trend !== lastTrend) {
                        if (d.trend === 'bullish') markers.push({ time: d.time, position: 'belowBar', color: '#10b981', shape: 'arrowUp', text: 'ST Buy' });
                        if (d.trend === 'bearish') markers.push({ time: d.time, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'ST Sell' });
                        lastTrend = d.trend;
                    }
                }
            }
            aetherMarkersRef.current = markers;
        }
        safeSetMarkers();
    }, [aetherFlowData, indicatorSettings.showAetherFlow, indicatorSettings.aetherUtBot, indicatorSettings.aetherSupertrend, indicatorSettings.aetherSmc, indicatorSettings.aether3BarReversal]);

    // ── Candlestick Pattern Interval & Marker Data ──
    useEffect(() => {
        if (!indicatorSettings.showCandlestickPatterns) {
            setPatternData([]);
            return;
        }

        let lastVersion = -1;
        const runPatternExtraction = () => {
            if (document.hidden) return;
            const candles = allCandlesRef.current;
            if (candles.length === 0) return;
            if (lastVersion === candlesVersionRef.current) return;
            lastVersion = candlesVersionRef.current;
            const markers: any[] = [];
            candles.forEach(c => {
                if (c.patterns && c.patterns.length > 0) {
                    c.patterns.forEach((p: any) => {
                        const isBullish = p.direction === 'bullish';
                        markers.push({
                            time: c.time,
                            position: isBullish ? 'belowBar' : 'aboveBar',
                            color: isBullish ? '#22c55e' : '#ef4444',
                            shape: isBullish ? 'arrowUp' : 'arrowDown',
                            text: p.name
                        });
                    });
                }
            });
            setPatternData(markers);
        };

        return startStaggeredInterval(
            runPatternExtraction,
            Math.round((isThermalGuard ? 7500 : 5000) * thermalIntervalScale),
            staggerDelayMs
        );
    }, [indicatorSettings.showCandlestickPatterns, isThermalGuard, thermalIntervalScale, staggerDelayMs]);

    useEffect(() => {
        if (!markersPluginRef.current) return;
        if (!indicatorSettings.showCandlestickPatterns) {
            patternMarkersRef.current = [];
        } else {
            patternMarkersRef.current = patternData;
        }
        safeSetMarkers();
    }, [patternData, indicatorSettings.showCandlestickPatterns]);

    // Refs to track last applied events to avoid redundant calculations
    const lastAppliedTradeRef = useRef<any>(null);
    const lastAppliedPriceRef = useRef<number>(0);
    const hasDirectTicksRef = useRef<boolean>(false);
    const lastDirectTickAtRef = useRef<number>(0);
    const lastDirectTickTimestampRef = useRef<number>(0);
    const lastProcessedCandleKeyRef = useRef<string>('');
    const lastSessionsKeyRef = useRef<string>('');
    // Aggressor side of the last trade ('buy' = green ▲, 'sell' = red ▼)
    const lastTradeSideRef = useRef<'buy' | 'sell'>('buy');
    const lastTickPriceRef = useRef<number>(0);

    // Smart Y-axis collision helper: ALWAYS keeps right-axis price pills visible (axisLabelVisible: true)
    // on BID, ASK, and MARK lines, while compacting the inline title text ('BID'->'B', 'ASK'->'A', 'MARK'->'M')
    // when lines sit close together on zoomed-out / tight-spread charts so nothing looks cluttered.
    const reconcileAxisLabelCollisions = useCallback(() => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        const lastPrice = lastPriceLineRenderedRef.current.price;
        const bidPrice = lastBidPriceRenderedRef.current;
        const askPrice = lastAskPriceRenderedRef.current;
        const markPrice = lastMarkPriceRenderedRef.current;

        const yLast = lastPrice > 0 ? series.priceToCoordinate(lastPrice) : null;
        const yBid = bidPrice > 0 && bidLineRef.current ? series.priceToCoordinate(bidPrice) : null;
        const yAsk = askPrice > 0 && askLineRef.current ? series.priceToCoordinate(askPrice) : null;
        const yMark = markPrice > 0 && markLineRef.current ? series.priceToCoordinate(markPrice) : null;

        const MIN_LABEL_GAP_PX = 16;
        const MIN_SPREAD_GAP_PX = 18;

        const spreadTooTight = yBid !== null && yAsk !== null && Math.abs(yBid - yAsk) < MIN_SPREAD_GAP_PX;
        const bidHitsLast = yBid !== null && yLast !== null && Math.abs(yBid - yLast) < MIN_LABEL_GAP_PX;
        const askHitsLast = yAsk !== null && yLast !== null && Math.abs(yAsk - yLast) < MIN_LABEL_GAP_PX;

        const useFullBidTitle = !(bidHitsLast || spreadTooTight);
        const useFullAskTitle = !(askHitsLast || spreadTooTight);

        if (bidLineRef.current && lastBidLabelVisibleRef.current !== useFullBidTitle) {
            try {
                bidLineRef.current.applyOptions({
                    axisLabelVisible: true,
                    title: useFullBidTitle ? 'BID' : 'B',
                });
                lastBidLabelVisibleRef.current = useFullBidTitle;
            } catch {}
        }

        if (askLineRef.current && lastAskLabelVisibleRef.current !== useFullAskTitle) {
            try {
                askLineRef.current.applyOptions({
                    axisLabelVisible: true,
                    title: useFullAskTitle ? 'ASK' : 'A',
                });
                lastAskLabelVisibleRef.current = useFullAskTitle;
            } catch {}
        }

        if (markLineRef.current && yMark !== null) {
            const markHitsLast = yLast !== null && Math.abs(yMark - yLast) < MIN_LABEL_GAP_PX;
            const markHitsBid = yBid !== null && Math.abs(yMark - yBid) < MIN_LABEL_GAP_PX;
            const markHitsAsk = yAsk !== null && Math.abs(yMark - yAsk) < MIN_LABEL_GAP_PX;
            const useFullMarkTitle = !(markHitsLast || markHitsBid || markHitsAsk);
            if (lastMarkLabelVisibleRef.current !== useFullMarkTitle) {
                try {
                    markLineRef.current.applyOptions({
                        axisLabelVisible: true,
                        title: useFullMarkTitle ? 'MARK' : 'M',
                    });
                    lastMarkLabelVisibleRef.current = useFullMarkTitle;
                } catch {}
            }
        }
    }, []);
    reconcileAxisLabelCollisionsRef.current = reconcileAxisLabelCollisions;

    const syncCurrentPriceLineRef = useRef<(price: number, side: 'buy' | 'sell', sweepLabel?: string, isSweep?: boolean) => void>(() => {});
    const syncCurrentPriceLine = useCallback((
        price: number,
        side: 'buy' | 'sell',
        sweepLabel?: string,
        isSweep: boolean = false
    ) => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        if (!showLastPriceLineRef.current) {
            if (currentPriceLineRef.current) {
                try { series.removePriceLine(currentPriceLineRef.current); } catch {}
                currentPriceLineRef.current = null;
                lastPriceLineRenderedRef.current = { price: 0, side: null, title: '', lineWidth: 1 };
                reconcileAxisLabelCollisions();
            }
            return;
        }

        if (!Number.isFinite(price) || price <= 0) return;

        const isBuy = side === 'buy';
        const lineColor = isBuy ? '#16a34a' : '#dc2626';
        const title = isSweep && sweepLabel ? sweepLabel : (isBuy ? '▲' : '▼');
        const lineWidth = isSweep ? 2 : 1;

        const prev = lastPriceLineRenderedRef.current;
        if (
            currentPriceLineRef.current &&
            prev.price === price &&
            prev.side === side &&
            prev.title === title &&
            prev.lineWidth === lineWidth
        ) {
            return;
        }

        try {
            if (!currentPriceLineRef.current) {
                currentPriceLineRef.current = series.createPriceLine({
                    price,
                    color: lineColor,
                    lineWidth: lineWidth as any,
                    lineStyle: 1, // Dotted
                    axisLabelVisible: true,
                    title,
                    axisLabelColor: lineColor,
                    axisLabelTextColor: '#ffffff',
                });
            } else {
                currentPriceLineRef.current.applyOptions({
                    price,
                    color: lineColor,
                    lineWidth: lineWidth as any,
                    axisLabelColor: lineColor,
                    title,
                });
            }
            lastPriceLineRenderedRef.current = { price, side, title, lineWidth };
            reconcileAxisLabelCollisions();
        } catch {
            currentPriceLineRef.current = null;
            lastPriceLineRenderedRef.current = { price: 0, side: null, title: '', lineWidth: 1 };
        }
    }, [reconcileAxisLabelCollisions]);
    syncCurrentPriceLineRef.current = syncCurrentPriceLine;

    // Light-Speed Realtime Candle & Price Line Update (Synchronous 0ms execution)
    const applyLivePriceTick = useCallback((
        livePrice: number,
        trade?: { price: number; high?: number; low?: number; volume?: number; timestamp?: number; side?: 'buy' | 'sell' | null } | null
    ) => {
        if (!candlestickSeriesRef.current || !livePrice || livePrice <= 0 || isNaN(livePrice)) return;

        // Resolve last trade side: exchange-provided side first, else tick rule (uptick = buy, downtick = sell)
        if (trade?.side === 'buy' || trade?.side === 'sell') {
            lastTradeSideRef.current = trade.side;
        } else if (lastTickPriceRef.current > 0 && livePrice !== lastTickPriceRef.current) {
            lastTradeSideRef.current = livePrice > lastTickPriceRef.current ? 'buy' : 'sell';
        }
        lastTickPriceRef.current = livePrice;

        // Detect aggressive market sweep bursts on real trades and schedule smooth decay back to 1px line
        const tradeVolRaw = trade?.volume || 0;
        const activePulse = tradeVolRaw > 0
            ? sweepTrackerRef.current.record(livePrice, tradeVolRaw, lastTradeSideRef.current)
            : sweepTrackerRef.current.getActive();

        const isSweepActive = Boolean(activePulse?.active);
        const displaySide = isSweepActive && activePulse ? activePulse.side : lastTradeSideRef.current;
        const sweepLabel = isSweepActive && activePulse ? activePulse.label : undefined;

        if (isSweepActive && activePulse) {
            if (sweepDecayTimerRef.current) {
                clearTimeout(sweepDecayTimerRef.current);
            }
            const decayDelay = Math.max(120, activePulse.expiresAt - Date.now() + 25);
            sweepDecayTimerRef.current = setTimeout(() => {
                sweepDecayTimerRef.current = null;
                const latestPx = lastCandleRef.current?.close || lastTickPriceRef.current;
                if (latestPx > 0) {
                    syncCurrentPriceLineRef.current(latestPx, lastTradeSideRef.current, undefined, false);
                }
            }, decayDelay);
        }

        // Even while REST klines are still loading, keep the horizontal price line live and in lockstep with BBO.
        // Once REST history finishes empty (e.g. quiet sub-minute pair or OANDA 1s), seed the first live candle directly from ticks!
        if (!lastCandleRef.current) {
            if (historyLoadedRef.current) {
                const rawTsSeed = (trade && trade.timestamp) ? trade.timestamp : Date.now();
                const eventTsSeed = rawTsSeed < 10000000000 ? rawTsSeed * 1000 : rawTsSeed;
                const bucketSec = alignCandleBucketSec(Math.floor(eventTsSeed / 1000), interval);
                const tradeHighSeed = trade?.high !== undefined ? trade.high : livePrice;
                const tradeLowSeed = trade?.low !== undefined ? trade.low : livePrice;
                const seededCandle: any = {
                    time: bucketSec,
                    open: livePrice,
                    high: Math.max(livePrice, tradeHighSeed),
                    low: Math.min(livePrice, tradeLowSeed),
                    close: livePrice,
                    volume: tradeVolRaw,
                };
                try {
                    candlestickSeriesRef.current.update(seededCandle);
                    lastCandleRef.current = seededCandle;
                    allCandlesRef.current = [seededCandle];
                    candlesVersionRef.current += 1;
                    if (volumeSeriesRef.current) {
                        volumeSeriesRef.current.update({
                            time: seededCandle.time,
                            value: seededCandle.volume,
                            color: 'rgba(34, 197, 94, 0.5)',
                        });
                    }
                    setCandlesReadyTick(t => t + 1);
                } catch {}
            }
            syncCurrentPriceLine(livePrice, displaySide, sweepLabel, isSweepActive);
            return;
        }

        const lastCandle = lastCandleRef.current as any;
        let candleTimeMs = Number(lastCandle.time);
        const isSeconds = candleTimeMs < 10000000000;
        if (isSeconds) candleTimeMs *= 1000;

        const tradeHigh = trade?.high !== undefined ? trade.high : livePrice;
        const tradeLow = trade?.low !== undefined ? trade.low : livePrice;
        const tradeVol = tradeVolRaw;
        const rawTimestamp = (trade && trade.timestamp) ? trade.timestamp : Date.now();
        const eventTimestamp = rawTimestamp < 10000000000 ? rawTimestamp * 1000 : rawTimestamp;

        // Guard against out-of-order older candles arriving after newer candles
        if (eventTimestamp < candleTimeMs) {
            return;
        }

        let updatedCandle: any;
        let isNewCandle = false;
        const nextBoundaryMs = getNextCandleCloseMs(candleTimeMs, interval, candleTimeMs);

        if (eventTimestamp >= nextBoundaryMs) {
            // Crossed calendar-aware timeframe boundary (handles 1w Monday & 1M 1st-of-month cleanly)
            const nextCandleTimeMs = alignCandleBucketMs(eventTimestamp, interval);
            const nextCandleTime = isSeconds ? Math.floor(nextCandleTimeMs / 1000) : nextCandleTimeMs;

            if (nextCandleTime > (isSeconds ? Math.floor(candleTimeMs / 1000) : candleTimeMs)) {
                const startPrice = lastCandle.close;
                updatedCandle = {
                    time: nextCandleTime,
                    open: startPrice,
                    high: Math.max(startPrice, livePrice, tradeHigh),
                    low: Math.min(startPrice, livePrice, tradeLow),
                    close: livePrice,
                    volume: tradeVol,
                };
                if (lastCandle.color) updatedCandle.color = lastCandle.color;
                if (lastCandle.wickColor) updatedCandle.wickColor = lastCandle.wickColor;
                isNewCandle = true;
            } else {
                updatedCandle = {
                    ...lastCandle,
                    close: livePrice,
                    high: Math.max(lastCandle.high, livePrice, tradeHigh),
                    low: Math.min(lastCandle.low, livePrice, tradeLow),
                    volume: (lastCandle.volume || 0) + tradeVol,
                };
            }
        } else {
            // Live candle tick: dynamically update body & wicks with exact live price
            updatedCandle = {
                ...lastCandle,
                close: livePrice,
                high: Math.max(lastCandle.high, livePrice, tradeHigh),
                low: Math.min(lastCandle.low, livePrice, tradeLow),
                volume: (lastCandle.volume || 0) + tradeVol,
            };
        }

        try {
            candlestickSeriesRef.current.update(updatedCandle);
            lastCandleRef.current = updatedCandle;

            if (volumeSeriesRef.current) {
                volumeSeriesRef.current.update({
                    time: updatedCandle.time,
                    value: updatedCandle.volume,
                    color: updatedCandle.close >= updatedCandle.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                });
            }

            const len = allCandlesRef.current.length;
            const MAX_CANDLES = 2000;

            if (isNewCandle) {
                allCandlesRef.current.push(updatedCandle);
                if (allCandlesRef.current.length > MAX_CANDLES) {
                    allCandlesRef.current = allCandlesRef.current.slice(-MAX_CANDLES);
                }
                candlesVersionRef.current += 1;
            } else if (len > 0 && allCandlesRef.current[len - 1].time === updatedCandle.time) {
                allCandlesRef.current[len - 1] = updatedCandle;
                candlesVersionRef.current += 1;
            }

            // Sync (or create on-the-fly) horizontal live price line with exact candle close at zero lag
            syncCurrentPriceLine(updatedCandle.close, displaySide, sweepLabel, isSweepActive);
        } catch {
            // Safe guard against unmount
        }
    }, [interval, syncCurrentPriceLine]);

    // Reset tracker refs when symbol or interval changes
    useEffect(() => {
        lastAppliedTradeRef.current = null;
        lastAppliedPriceRef.current = 0;
        hasDirectTicksRef.current = false;
        lastDirectTickAtRef.current = 0;
        lastDirectTickTimestampRef.current = 0;
        lastProcessedCandleKeyRef.current = '';
        lastSessionsKeyRef.current = '';
        sweepTrackerRef.current.reset();
        if (sweepDecayTimerRef.current) {
            clearTimeout(sweepDecayTimerRef.current);
            sweepDecayTimerRef.current = null;
        }
    }, [symbol, interval, exchange]);

    // Direct canvas live trade tick subscription (synced frame cadence with BBO on mobile/tablet, 0ms on PC)
    // bypasses full React page re-renders for smooth live candlestick & price line updates.
    useEffect(() => {
        if (!symbol || !exchange) return;
        const unsubscribe = subscribeLiveTradeTicks(symbol, exchange, (tick) => {
            if (!tick || !tick.price || tick.price <= 0 || Number.isNaN(tick.price)) return;
            const rawTs = tick.timestamp || Date.now();
            const ts = rawTs < 10000000000 ? rawTs * 1000 : rawTs;
            const now = Date.now();
            const streamSilent = lastDirectTickAtRef.current > 0 && (now - lastDirectTickAtRef.current) > 2500;
            if (!streamSilent && ts < lastDirectTickTimestampRef.current) return;
            hasDirectTicksRef.current = true;
            lastDirectTickAtRef.current = now;
            lastDirectTickTimestampRef.current = ts;
            applyLivePriceTick(tick.price, {
                price: tick.price,
                high: tick.high,
                low: tick.low,
                volume: tick.quantity ?? tick.volume,
                timestamp: ts,
                side: tick.side || (tick.isBuyerMaker ? 'sell' : 'buy'),
            });
        });
        return () => {
            unsubscribe();
        };
    }, [symbol, exchange, applyLivePriceTick]);

    // Fallback reaction on React tradeEvent/currentPrice ONLY before direct live ticks are active
    // or if the live trade channel has been silent > 2.5s (e.g. illiquid pair with only OB snapshots).
    useEffect(() => {
        const directStreamActive = hasDirectTicksRef.current && (Date.now() - lastDirectTickAtRef.current) < 2500;
        if (directStreamActive) return;

        if (tradeEvent && tradeEvent.price > 0 && !isNaN(tradeEvent.price) && tradeEvent !== lastAppliedTradeRef.current) {
            const rawTs = tradeEvent.timestamp || 0;
            const ts = rawTs > 0 && rawTs < 10000000000 ? rawTs * 1000 : rawTs;
            if (ts > 0 && ts <= lastDirectTickTimestampRef.current) return;
            lastAppliedTradeRef.current = tradeEvent;
            lastAppliedPriceRef.current = tradeEvent.price;
            applyLivePriceTick(tradeEvent.price, tradeEvent);
        } else if (!hasDirectTicksRef.current && currentPrice && currentPrice > 0 && !isNaN(currentPrice) && currentPrice !== lastAppliedPriceRef.current) {
            lastAppliedPriceRef.current = currentPrice;
            applyLivePriceTick(currentPrice, null);
        }
    }, [tradeEvent, currentPrice, applyLivePriceTick]);

    // Throttled Technical Indicator Engine (200ms PC / 500ms mobile thermal guard, skips unchanged candles & hidden tabs)
    useEffect(() => {
        const anyFastIndicatorActive = Boolean(
            indicatorSettings.showEMA ||
            indicatorSettings.showBB ||
            indicatorSettings.showRSI ||
            indicatorSettings.showUTBot ||
            indicatorSettings.showSessions
        );
        if (!anyFastIndicatorActive) return;

        const runFastIndicators = () => {
            if (document.hidden) return;
            if (!candlestickSeriesRef.current || !lastCandleRef.current || allCandlesRef.current.length === 0) return;

            try {
                const curData = allCandlesRef.current;
                const lastCandle = lastCandleRef.current as any;
                const currentSettings = indicatorSettingsRef.current;
                if (curData && curData.length > 0) {
                    const emaTfsKey = (currentSettings.emaTimeframes || ['1m']).join(',');
                    const utSig = `${currentSettings.showUTBot ? 1 : 0}:${currentSettings.utBotSensitivity}:${currentSettings.utBotAtrPeriod}:${currentSettings.utBotUseHeikinAshi ? 1 : 0}:${currentSettings.utBotTrendFilter ? 1 : 0}:${currentSettings.utBotEmaPeriod}:${currentSettings.utBotChopFilter ? 1 : 0}:${currentSettings.utBotAdxThreshold}:${currentSettings.utBotCandleClose ? 1 : 0}:${currentSettings.utBotCooldownBars}:${currentSettings.utBotOrderFlowConfirm ? 1 : 0}:${currentSettings.utBotHideWeakSignals ? 1 : 0}:${currentSettings.utBotShowSLTP ? 1 : 0}:${currentSettings.utBotTp1RR}:${currentSettings.utBotTp2RR}:${currentSettings.utBotRetestSniper ? 1 : 0}:${currentSettings.utBotDualMode ? 1 : 0}:${currentSettings.utBotSlowSensitivity}:${currentSettings.utBotSlowAtrPeriod}:${currentSettings.utBotClimaxGuard !== false ? 1 : 0}:${currentSettings.utBotMaxExtensionAtr}:${currentSettings.utBotPullbackEntry !== false ? 1 : 0}:${currentSettings.utBotFakeoutReversal !== false ? 1 : 0}:${currentSettings.utBotShowHud ? 1 : 0}:${currentSettings.utBotEnableAlerts ? 1 : 0}`;
                    const toggleSig = `${currentSettings.showEMA ? 1 : 0}:${currentSettings.emaPeriod}:${currentSettings.emaRenderMode}:${emaTfsKey}|${currentSettings.showBB ? 1 : 0}:${currentSettings.bbPeriod}:${currentSettings.bbStdDev}|${currentSettings.showRSI ? 1 : 0}:${currentSettings.rsiPeriod}|${utSig}|${currentSettings.showSessions ? 1 : 0}:${currentSettings.timezoneOffset || 0}:${currentSettings.sessionA?.session}:${currentSettings.sessionB?.session}:${currentSettings.sessionC?.session}:${currentSettings.sessionD?.session}`;
                    const candleKey = `${curData.length}:${lastCandle?.time}:${lastCandle?.high}:${lastCandle?.low}:${lastCandle?.close}:${lastCandle?.volume}|${toggleSig}`;
                    if (candleKey === lastProcessedCandleKeyRef.current) return;
                    lastProcessedCandleKeyRef.current = candleKey;

                    const bbP = Math.max(1, Math.floor(Number(currentSettings.bbPeriod) || 20));
                    const bbDev = Number.isFinite(Number(currentSettings.bbStdDev)) && Number(currentSettings.bbStdDev) > 0 ? Number(currentSettings.bbStdDev) : 2;
                    const rsiP = Math.max(1, Math.floor(Number(currentSettings.rsiPeriod) || 14));

                    if (currentSettings.showEMA && emaSeriesMapRef.current.size > 0) {
                        const activeTfs = currentSettings.emaTimeframes && currentSettings.emaTimeframes.length > 0
                            ? currentSettings.emaTimeframes
                            : ['1m'];
                        const period = Math.max(1, Math.floor(Number(currentSettings.emaPeriod) || 7));
                        const mode = currentSettings.emaRenderMode || 'smooth';
                        const newLatestValues: Record<string, number> = {};
                        const emaInput = isThermalGuard && curData.length > Math.max(200, period * 6)
                            ? curData.slice(-Math.max(200, period * 6))
                            : curData;

                        activeTfs.forEach((tf) => {
                            const series = emaSeriesMapRef.current.get(tf);
                            if (!series) return;
                            if (tf === interval) {
                                const pts = calculateEMA(emaInput, period);
                                if (pts.length > 0) {
                                    const lastPt = pts[pts.length - 1];
                                    series.update(lastPt as any);
                                    newLatestValues[tf] = lastPt.value;
                                }
                            } else {
                                const cacheKey = `${exchange}:${symbol.toUpperCase()}:${tf}`;
                                const cachedEntry = htfCandlesCacheRef.current[cacheKey];
                                const cached = cachedEntry?.candles;
                                if (cached && cached.length > 0 && lastCandle?.close) {
                                    const lastCached = cached[cached.length - 1];
                                    lastCached.close = lastCandle.close;
                                    if (lastCandle.close > lastCached.high) lastCached.high = lastCandle.close;
                                    if (lastCandle.close < lastCached.low) lastCached.low = lastCandle.close;
                                }
                                const pts = calculateMTFEMA(emaInput, interval, tf, period, mode, cached);
                                if (pts.length > 0) {
                                    const lastPt = pts[pts.length - 1];
                                    series.update(lastPt as any);
                                    newLatestValues[tf] = lastPt.value;
                                }
                            }
                        });
                        if (Object.keys(newLatestValues).length > 0) {
                            setMtfEmaValues(prev => {
                                const next: Record<string, number> = {};
                                let changed = false;
                                activeTfs.forEach(t => {
                                    if (newLatestValues[t] !== undefined) {
                                        next[t] = newLatestValues[t];
                                    } else if (prev[t] !== undefined) {
                                        next[t] = prev[t];
                                    }
                                    if (next[t] !== prev[t]) changed = true;
                                });
                                if (!changed && Object.keys(next).length === Object.keys(prev).length) {
                                    return prev;
                                }
                                return next;
                            });
                        }
                    }
                    if (currentSettings.showBB && bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current && curData.length >= bbP) {
                        const recentSlice = curData.slice(-bbP);
                        let sum = 0;
                        for (let i = 0; i < bbP; i++) sum += recentSlice[i].close;
                        const middle = sum / bbP;
                        let varSum = 0;
                        for (let i = 0; i < bbP; i++) varSum += Math.pow(recentSlice[i].close - middle, 2);
                        const sd = Math.sqrt(varSum / bbP);
                        const upper = middle + bbDev * sd;
                        const lower = middle - bbDev * sd;
                        const lastTime = recentSlice[recentSlice.length - 1].time;
                        bbUpperSeriesRef.current.update({ time: lastTime, value: upper } as any);
                        bbMiddleSeriesRef.current.update({ time: lastTime, value: middle } as any);
                        bbLowerSeriesRef.current.update({ time: lastTime, value: lower } as any);
                    }
                    if (currentSettings.showRSI && rsiSeriesRef.current) {
                        const rsiInput = isThermalGuard && curData.length > Math.max(200, rsiP * 8)
                            ? curData.slice(-Math.max(200, rsiP * 8))
                            : curData;
                        const rsiData = calculateRSI(rsiInput, rsiP);
                        if (rsiData.length > 0) rsiSeriesRef.current.update(rsiData[rsiData.length - 1] as any);
                    }
                    if (currentSettings.showUTBot && utBotPrimitiveRef.current) {
                        syncUTBotOverlayRef.current(curData, currentSettings, true);
                    }

                    // --- SESSIONS CALCULATION (Only recalculates when candle count or minute bucket changes) ---
                    if (currentSettings.showSessions) {
                        const tz = currentSettings.timezoneOffset || 0;
                        let rawTime = Number(lastCandle?.time || 0);
                        if (rawTime > 0 && rawTime < 10000000000) rawTime *= 1000;
                        const minuteBucket = Math.floor((rawTime || Date.now()) / 60000);
                        const sessionsKey = `${curData.length}:${minuteBucket}:${tz}:${currentSettings.sessionA.session}:${currentSettings.sessionB.session}:${currentSettings.sessionC.session}:${currentSettings.sessionD.session}:${currentSettings.sessionA.name}:${currentSettings.sessionB.name}:${currentSettings.sessionC.name}:${currentSettings.sessionD.name}`;

                        if (sessionsKey !== lastSessionsKeyRef.current) {
                            lastSessionsKeyRef.current = sessionsKey;
                            const sessData = allCandlesRef.current;

                            const sa = calculateSessions(sessData, currentSettings.sessionA.session, tz);
                            const sb = calculateSessions(sessData, currentSettings.sessionB.session, tz);
                            const sc = calculateSessions(sessData, currentSettings.sessionC.session, tz);
                            const sd = calculateSessions(sessData, currentSettings.sessionD.session, tz);

                            setSessionsData({ a: sa, b: sb, c: sc, d: sd });

                            const lastA = sa[sa.length - 1];
                            const lastB = sb[sb.length - 1];
                            const lastC = sc[sc.length - 1];
                            const lastD = sd[sd.length - 1];

                            setSessionStatuses([
                                { name: currentSettings.sessionA.name, isActive: lastA?.isSession || false, color: currentSettings.sessionA.color, r2: lastA?.linReg?.r2 || null, stdev: lastA?.linReg?.stdev || null, volume: null },
                                { name: currentSettings.sessionB.name, isActive: lastB?.isSession || false, color: currentSettings.sessionB.color, r2: lastB?.linReg?.r2 || null, stdev: lastB?.linReg?.stdev || null, volume: null },
                                { name: currentSettings.sessionC.name, isActive: lastC?.isSession || false, color: currentSettings.sessionC.color, r2: lastC?.linReg?.r2 || null, stdev: lastC?.linReg?.stdev || null, volume: null },
                                { name: currentSettings.sessionD.name, isActive: lastD?.isSession || false, color: currentSettings.sessionD.color, r2: lastD?.linReg?.r2 || null, stdev: lastD?.linReg?.stdev || null, volume: null },
                            ]);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to update indicators", e);
            }
        };

        return startStaggeredInterval(runFastIndicators, indicatorIntervalMs, staggerDelayMs);
    }, [
        indicatorIntervalMs,
        staggerDelayMs,
        isThermalGuard,
        interval,
        exchange,
        symbol,
        indicatorSettings.showEMA,
        indicatorSettings.showBB,
        indicatorSettings.showRSI,
        indicatorSettings.showUTBot,
        indicatorSettings.showSessions
    ]);

    // Auto Fibonacci Indicator
    useEffect(() => {
        if (!indicatorSettings.showAutoFibo || allCandlesRef.current.length === 0) {
            setFiboData(null);
            return;
        }

        const data = allCandlesRef.current;
        const lookback = Math.min(indicatorSettings.autoFiboLookback, data.length);
        const windowData = data.slice(-lookback);

        let highest = -Infinity;
        let lowest = Infinity;
        let highTime = 0;
        let lowTime = 0;

        for (let i = 0; i < windowData.length; i++) {
            if (windowData[i].high > highest) {
                highest = windowData[i].high;
                highTime = windowData[i].time;
            }
            if (windowData[i].low < lowest) {
                lowest = windowData[i].low;
                lowTime = windowData[i].time;
            }
        }

        if (highest === lowest) {
            setFiboData(null);
            return;
        }

        const diff = highest - lowest;
        // Match the colors and levels from standard premium trading tools (like the user image)
        const levels = [
            { level: 0, title: '0% (Low)', color: '#ffffff', cloudColor: 'rgba(239, 68, 68, 0.15)' },
            { level: 0.236, title: '23.6%', color: '#ef4444', cloudColor: 'rgba(132, 204, 22, 0.15)' },
            { level: 0.382, title: '38.2%', color: '#84cc16', cloudColor: 'rgba(34, 197, 94, 0.15)' },
            { level: 0.5, title: '50.0%', color: '#22c55e', cloudColor: 'rgba(20, 184, 166, 0.15)' },
            { level: 0.618, title: '61.8%', color: '#14b8a6', cloudColor: 'rgba(59, 130, 246, 0.15)' },
            { level: 0.786, title: '78.6%', color: '#3b82f6', cloudColor: 'rgba(156, 163, 175, 0.15)' },
            { level: 1, title: '100% (High)', color: '#ffffff', cloudColor: 'rgba(0,0,0,0)' },
            { level: 1.272, title: '1.272 (Cons)', color: '#d946ef', cloudColor: 'rgba(0,0,0,0)' },
            { level: 1.618, title: '1.618 (Golden)', color: '#a855f7', cloudColor: 'rgba(0,0,0,0)' },
            { level: 2.000, title: '2.0 (Double)', color: '#ec4899', cloudColor: 'rgba(0,0,0,0)' },
            { level: 2.618, title: '2.618 (Aggr)', color: '#f43f5e', cloudColor: 'rgba(0,0,0,0)' },
            { level: 3.618, title: '3.618 (Extr)', color: '#fb923c', cloudColor: 'rgba(0,0,0,0)' },
            { level: 4.236, title: '4.236 (Max)', color: '#f59e0b', cloudColor: 'rgba(0,0,0,0)' }
        ].map(l => ({
            ...l,
            price: lowest + diff * l.level
        }));

        setFiboData({
            highest,
            lowest,
            highTime,
            lowTime,
            levels
        });

    }, [indicatorSettings.showAutoFibo, indicatorSettings.autoFiboLookback, candlesReadyTick]);

    // Ichimoku Cloud Calculation
    useEffect(() => {
        if (!indicatorSettings.showIchimoku || allCandlesRef.current.length === 0) {
            setIchimokuData([]);
            return;
        }

        const data = allCandlesRef.current;
        const result = calculateIchimoku(
            data,
            indicatorSettings.tenkanPeriod,
            indicatorSettings.kijunPeriod,
            indicatorSettings.senkouBPeriod,
            indicatorSettings.displacement
        );
        setIchimokuData(result);
    }, [
        indicatorSettings.showIchimoku,
        indicatorSettings.tenkanPeriod,
        indicatorSettings.kijunPeriod,
        indicatorSettings.senkouBPeriod,
        indicatorSettings.displacement,
        candlesReadyTick
    ]);

    // Adaptive Trend Finder Calculation
    useEffect(() => {
        if (!indicatorSettings.showTrendFinder || allCandlesRef.current.length === 0) {
            setTrendFinderData(null);
            return;
        }

        const result = calculateAdaptiveTrendFinder(
            allCandlesRef.current,
            indicatorSettings.trendFinderLookback,
            indicatorSettings.trendFinderDev,
            indicatorSettings.trendFinderThreshold,
            indicatorSettings.enableTrendFinderVolumeFilter,
            indicatorSettings.trendFinderVolumeMultiplier
        );
        setTrendFinderData(result);
    }, [
        indicatorSettings.showTrendFinder,
        indicatorSettings.trendFinderLookback,
        indicatorSettings.trendFinderDev,
        indicatorSettings.trendFinderThreshold,
        indicatorSettings.enableTrendFinderVolumeFilter,
        indicatorSettings.trendFinderVolumeMultiplier,
        candlesReadyTick
    ]);

    // Update horizontal price lines for walls intelligently without blindly clearing
    const lastWallLinesSyncRef = useRef<number>(0);
    useEffect(() => {
        if (!candlestickSeriesRef.current || !chartRef.current) return;

        const syncWallAndBotLines = () => {
            if (!candlestickSeriesRef.current || !chartRef.current) return;
            const currentLineKeys = new Set<string>();

            // On mobile/tablet thermal guard, cap to top 16 largest walls to prevent canvas PriceLine overdraw;
            // on desktop PCs, render all walls with zero cap.
            const wallsToRender = (isThermalGuard && walls.length > 16)
                ? [...walls].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)).slice(0, 16)
                : walls;

            // 1. Process Order Book Walls
            wallsToRender.forEach(wall => {
                const key = `wall-${wall.type}-${wall.price}`;
                currentLineKeys.add(key);

                const isBuy = wall.type === 'buy';
                const wallVolume = wall.size ?? 0;
                const showLabel = wallVolume >= 5_000_000;

                if (!wallLinesRef.current.has(key)) {
                    // Create new line
                    const priceLine = candlestickSeriesRef.current?.createPriceLine({
                        price: wall.price,
                        color: isBuy ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)',
                        lineWidth: 1,
                        lineStyle: 1, // Dotted
                        axisLabelVisible: showLabel,
                        title: showLabel ? `${(wallVolume / 1_000_000).toFixed(1)}M` : '',
                    });
                    if (priceLine) wallLinesRef.current.set(key, priceLine);
                } else {
                    // Update label visibility on existing line (e.g. after volume threshold change)
                    const existingLine = wallLinesRef.current.get(key);
                    existingLine?.applyOptions({
                        axisLabelVisible: showLabel,
                        title: showLabel ? `${(wallVolume / 1_000_000).toFixed(1)}M` : '',
                    });
                }
            });

            // 2. Process Bot Status Lines
            if (botStatus && botStatus.position) {
                if (botStatus.entry_price && botStatus.entry_price > 0) {
                    const epKey = 'bot-entry';
                    currentLineKeys.add(epKey);
                    if (!wallLinesRef.current.has(epKey)) {
                        const epLine = candlestickSeriesRef.current?.createPriceLine({
                            price: botStatus.entry_price,
                            color: '#f59e0b', // Golden
                            lineWidth: 1,
                            lineStyle: LineStyle.Solid,
                            axisLabelVisible: true,
                            title: 'BOT ENTRY',
                        });
                        if (epLine) wallLinesRef.current.set(epKey, epLine);
                    } else {
                        // Update price if trailing/changed
                        const line = wallLinesRef.current.get(epKey);
                        line.applyOptions({ price: botStatus.entry_price, lineWidth: 1, lineStyle: LineStyle.Solid });
                    }
                }

                if (botStatus.tp_price && botStatus.tp_price > 0) {
                    const tpKey = 'bot-tp';
                    currentLineKeys.add(tpKey);
                    if (!wallLinesRef.current.has(tpKey)) {
                        const tpLine = candlestickSeriesRef.current?.createPriceLine({
                            price: botStatus.tp_price,
                            color: '#22c55e', // Green
                            lineWidth: 1,
                            lineStyle: LineStyle.Solid, // Plain Solid Line
                            axisLabelVisible: true,
                            title: 'BOT TP',
                        });
                        if (tpLine) wallLinesRef.current.set(tpKey, tpLine);
                    } else {
                        const line = wallLinesRef.current.get(tpKey);
                        line.applyOptions({ price: botStatus.tp_price, lineWidth: 1, lineStyle: LineStyle.Solid });
                    }
                }

                if (botStatus.sl_price && botStatus.sl_price > 0) {
                    const slKey = 'bot-sl';
                    currentLineKeys.add(slKey);
                    if (!wallLinesRef.current.has(slKey)) {
                        const slLine = candlestickSeriesRef.current?.createPriceLine({
                            price: botStatus.sl_price,
                            color: '#ef4444', // Red
                            lineWidth: 1,
                            lineStyle: LineStyle.Solid, // Plain Solid Line
                            axisLabelVisible: true,
                            title: 'BOT TSL',
                        });
                        if (slLine) wallLinesRef.current.set(slKey, slLine);
                    } else {
                        const line = wallLinesRef.current.get(slKey);
                        line.applyOptions({ price: botStatus.sl_price, lineWidth: 1, lineStyle: LineStyle.Solid });
                    }
                }
            }

            // 3. Cleanup Stale Lines (Lines that exist in Map but aren't in currentLineKeys)
            for (const [key, line] of wallLinesRef.current.entries()) {
                // Ignore order lines, they are managed by the next useEffect
                if (key.startsWith('order-')) continue;

                if (!currentLineKeys.has(key)) {
                    try {
                        candlestickSeriesRef.current?.removePriceLine(line);
                    } catch (e) {
                        // Ignore errors if line was already removed internally
                    }
                    wallLinesRef.current.delete(key);
                }
            }
        };

        if (!isThermalGuard) {
            syncWallAndBotLines();
            return;
        }

        const now = Date.now();
        const elapsed = now - lastWallLinesSyncRef.current;
        if (elapsed >= 1000) {
            lastWallLinesSyncRef.current = now;
            syncWallAndBotLines();
            return;
        }
        const timer = setTimeout(() => {
            lastWallLinesSyncRef.current = Date.now();
            syncWallAndBotLines();
        }, 1000 - elapsed);
        return () => clearTimeout(timer);
    }, [walls, botStatus, isThermalGuard]);

    // ML Setup Ghost Lines
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;

        if (mlSetup && mlSetup.symbol === symbol) {
            // Draw ML SL Line
            if (mlSetup.sl_price && mlSetup.sl_price > 0) {
                if (!mlSlLineRef.current) {
                    mlSlLineRef.current = candlestickSeriesRef.current.createPriceLine({
                        price: mlSetup.sl_price,
                        color: '#ef4444', // Red for SL
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid, // Plain Solid
                        axisLabelVisible: true,
                        title: `🤖 AI SL (${mlSetup.confidence * 100}%)`,
                    });
                } else {
                    mlSlLineRef.current.applyOptions({ 
                        price: mlSetup.sl_price,
                        color: '#ef4444',
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid,
                        title: `🤖 AI SL (${mlSetup.confidence * 100}%)`
                    });
                }
            } else if (mlSlLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(mlSlLineRef.current); } catch {}
                mlSlLineRef.current = null;
            }

            // Draw ML TP Line
            if (mlSetup.tp_price && mlSetup.tp_price > 0) {
                if (!mlTpLineRef.current) {
                    mlTpLineRef.current = candlestickSeriesRef.current.createPriceLine({
                        price: mlSetup.tp_price,
                        color: '#22c55e', // Green for TP
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid, // Plain Solid
                        axisLabelVisible: true,
                        title: `🤖 AI TP (RR: ${mlSetup.rr_ratio})`,
                    });
                } else {
                    mlTpLineRef.current.applyOptions({ 
                        price: mlSetup.tp_price,
                        color: '#22c55e',
                        lineWidth: 1,
                        lineStyle: LineStyle.Solid,
                        title: `🤖 AI TP (RR: ${mlSetup.rr_ratio})`
                    });
                }
            } else if (mlTpLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(mlTpLineRef.current); } catch {}
                mlTpLineRef.current = null;
            }
        } else {
            // Remove lines if mlSetup is null
            if (mlSlLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(mlSlLineRef.current); } catch {}
                mlSlLineRef.current = null;
            }
            if (mlTpLineRef.current && candlestickSeriesRef.current) {
                try { candlestickSeriesRef.current.removePriceLine(mlTpLineRef.current); } catch {}
                mlTpLineRef.current = null;
            }
        }
    }, [mlSetup, symbol]);

    // ── Drag & Drop Open Orders Logic & Confirmation Modal ──
    interface PendingOrderModification {
        orderId: string;
        targetOrder: OpenLimitOrder;
        newPrice: number;
        originalPrice: number;
        livePrice: number;
        symbol: string;
        isSL: boolean;
        modeName: string;
        side: 'buy' | 'sell';
        amount: number;
    }

    const formatOrderLabel = (order: OpenLimitOrder, price: number) => {
        const isBuy = order.side === 'buy';
        if (order.isSoftwareSL) {
            const modeName = order.mode ? order.mode.toUpperCase() : 'SL';
            const typeName = order.type ? order.type.toUpperCase() : '';
            const isTrailingChase = modeName === 'TRAILING_CHASE' || typeName === 'TRAILING_CHASE';
            const formattedMode = isTrailingChase ? 'TRAILING CHASE' : (modeName === 'SMART_CHASE' ? 'SMART CHASE' : (modeName === 'TRAILING' ? 'TRAILING' : (modeName === 'STOP' ? 'FIXED' : modeName)));
            const slAmt = order.remaining > 0 ? order.remaining : order.amount;
            const amtText = slAmt > 0 ? ` ${slAmt >= 1 ? slAmt.toFixed(2) : slAmt.toFixed(4)}` : '';
            return `🛑 ${formattedMode} SL${amtText} (${price < 1 ? price.toFixed(6) : price.toFixed(4)})`;
        }
        if (order.mode === 'TP') {
            const tpAmt = order.remaining > 0 ? order.remaining : order.amount;
            const amtStr = tpAmt >= 1 ? tpAmt.toFixed(2) : tpAmt.toFixed(4);
            return `🎯 TP ${isBuy ? '▲ BUY' : '▼ SELL'} ${amtStr} (${price < 1 ? price.toFixed(6) : price.toFixed(4)})`;
        }
        if (order.isIceberg) {
            const sliceText = order.icebergQty ? `${order.icebergQty.toFixed(2)}/` : '';
            return `🧊 ${isBuy ? '▲ BUY' : '▼ SELL'} [ICEBERG: ${sliceText}${order.amount.toFixed(2)}]`;
        }
        return `${isBuy ? '▲ BUY' : '▼ SELL'} ${order.remaining > 0 ? order.remaining.toFixed(4) : order.amount.toFixed(4)}`;
    };

    const [isModifyingOrder, setIsModifyingOrder] = useState<boolean>(false);
    const [pendingModification, setPendingModification] = useState<PendingOrderModification | null>(null);
    const pendingModificationRef = useRef<PendingOrderModification | null>(null);
    const [orderLineSyncTick, setOrderLineSyncTick] = useState<number>(0);
    const initialDontAsk = (() => {
        try {
            return localStorage.getItem('dontAskDragConfirm') === 'true';
        } catch {
            return false;
        }
    })();
    const [dontAskDragConfirm, setDontAskDragConfirm] = useState<boolean>(initialDontAsk);
    const dontAskDragConfirmRef = useRef<boolean>(initialDontAsk);

    useEffect(() => {
        dontAskDragConfirmRef.current = dontAskDragConfirm;
    }, [dontAskDragConfirm]);
    const draggingOrderIdRef = useRef<string | null>(null);
    const ghostLineRef = useRef<any>(null);
    const openOrdersRef = useRef<OpenLimitOrder[]>([]);
    const activePositionRef = useRef<FastPositionResponse | null>(activePosition ?? null);
    const dragPreviewRef = useRef<DragPnlPreview | null>(null);
    const dragOverlaySyncRef = useRef<(() => void) | null>(null);
    const isModifyingRef = useRef<boolean>(false);
    const currentPriceRef = useRef<number>(currentPrice);
    
    // Keep a fresh ref to live market price
    useEffect(() => {
        currentPriceRef.current = currentPrice;
    }, [currentPrice]);

    useEffect(() => {
        activePositionRef.current = activePosition ?? null;
    }, [activePosition]);

    // Keep a fresh ref to openOrders so DOM events can access it
    useEffect(() => {
        openOrdersRef.current = openOrders;
    }, [openOrders]);

    // Open Limit Orders — color-coded horizontal price lines
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;

        const orderKeys = new Set<string>();

        const effectiveEntryCtx = resolveEffectiveEntryContext(activePosition, openOrders, symbol);

        openOrders.forEach(order => {
            if (!order.price || order.price <= 0) return;
            const key = `order-${order.id}`;
            orderKeys.add(key);

            // Guard: If this order is currently being dragged or is pending confirmation, do NOT overwrite its position/styling
            if (draggingOrderIdRef.current === order.id || pendingModificationRef.current?.orderId === order.id) {
                return;
            }

            const isBuy = order.side === 'buy';
            let color = isBuy ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)';
            let style: any = LineStyle.Solid; // Plain Solid line for all orders including normal pending orders
            let width = 1; // Sleek 1px line

            if (order.isSoftwareSL) {
                color = '#ef4444'; // Red for SL
                style = LineStyle.Solid;
                width = 1;
            } else if (order.mode === 'TP') {
                color = '#22c55e'; // Green for TP
                style = LineStyle.Solid;
                width = 1;
            } else if (order.isIceberg) {
                color = isBuy ? '#06b6d4' : '#f43f5e'; // Cyan for buy iceberg, Rose for sell iceberg
                style = LineStyle.Solid;
                width = 1;
            }

            // Omit redundant canvas title when TradePositionOverlay renders the combined P/L pill for this SL/TP
            const hasOverlayCard = Boolean(
                (order.isSoftwareSL || order.mode === 'TP')
                && effectiveEntryCtx
                && resolveOrderEntryContext(order, effectiveEntryCtx)
            );
            const label = hasOverlayCard ? '' : formatOrderLabel(order, order.price);

            if (!wallLinesRef.current.has(key)) {
                const line = candlestickSeriesRef.current?.createPriceLine({
                    price: order.price,
                    color,
                    lineWidth: width as any,
                    lineStyle: style as any,
                    axisLabelVisible: true,
                    title: label,
                });
                if (line) wallLinesRef.current.set(key, line);
            } else {
                wallLinesRef.current.get(key)?.applyOptions({
                    price: order.price,
                    title: label,
                    color,
                    lineWidth: width as any,
                    lineStyle: style as any
                });
            }
        });

        // Cleanup stale order lines
        for (const [key, line] of wallLinesRef.current.entries()) {
            if (key.startsWith('order-')) {
                const orderId = key.replace('order-', '').replace('-modifying', '');
                // Do not delete lines that are currently being optimistically modified or actively dragged
                if (draggingOrderIdRef.current === orderId || pendingModificationRef.current?.orderId === orderId) {
                    continue;
                }
                // If it's a legacy '-modifying' key or not in active orderKeys, safely remove from chart
                if (key.endsWith('-modifying') || !orderKeys.has(`order-${orderId}`)) {
                    try { candlestickSeriesRef.current?.removePriceLine(line); } catch { /* ignore */ }
                    wallLinesRef.current.delete(key);
                }
            }
        }
    }, [openOrders, activePosition, symbol, orderLineSyncTick, candlesReadyTick]);

    const getOrderLineVisualStyle = (order: OpenLimitOrder, price: number) => {
        const isBuy = order.side === 'buy';
        let color = isBuy ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)';
        if (order.isSoftwareSL) {
            color = '#ef4444';
        } else if (order.mode === 'TP') {
            color = '#22c55e';
        } else if (order.isIceberg) {
            color = isBuy ? '#06b6d4' : '#f43f5e';
        }
        const effectiveEntryCtx = resolveEffectiveEntryContext(activePositionRef.current, openOrdersRef.current, symbol);
        const hasOverlayCard = Boolean(
            (order.isSoftwareSL || order.mode === 'TP')
            && effectiveEntryCtx
            && resolveOrderEntryContext(order, effectiveEntryCtx)
        );
        return {
            color,
            label: hasOverlayCard ? '' : formatOrderLabel(order, price),
        };
    };

    const migrateOrderPriceLine = (oldOrderId: string, newOrderId: string, activeLine: any) => {
        if (!oldOrderId || !newOrderId || oldOrderId === newOrderId) return;
        const oldKey = `order-${oldOrderId}`;
        const newKey = `order-${newOrderId}`;
        const collidingLine = wallLinesRef.current.get(newKey);
        if (collidingLine && collidingLine !== activeLine) {
            try { candlestickSeriesRef.current?.removePriceLine(collidingLine); } catch { /* ignore */ }
            wallLinesRef.current.delete(newKey);
        }
        wallLinesRef.current.delete(oldKey);
        if (activeLine) {
            wallLinesRef.current.set(newKey, activeLine);
        }
    };

    const executeOrderModification = async (mod: PendingOrderModification) => {
        if (!selectedApiKeyId) return;
        setIsModifyingOrder(true);
        isModifyingRef.current = true;
        pendingModificationRef.current = mod;
        const oldId = String(mod.orderId);
        const key = `order-${oldId}`;
        const line = wallLinesRef.current.get(key);

        try {
            let resolvedOrderId = oldId;
            let resolvedPrice = mod.newPrice;

            if (mod.isSL) {
                const res = await manualTradeService.updateSoftwareSL(
                    parseInt(selectedApiKeyId),
                    mod.orderId,
                    {
                        symbol: mod.symbol,
                        side: mod.targetOrder.side,
                        new_price: mod.newPrice,
                        amount: mod.targetOrder.amount
                    }
                );
                resolvedOrderId = res?.id ? String(res.id) : (res?.sl_id ? String(res.sl_id) : oldId);
                const backendPx = Number(res?.price || res?.new_price || 0);
                if (Number.isFinite(backendPx) && backendPx > 0) {
                    resolvedPrice = backendPx;
                }
                migrateOrderPriceLine(oldId, resolvedOrderId, line);
                const speedText = res?.execution_speed_ms !== undefined ? ` (${res.execution_speed_ms}ms ⚡)` : '';
                window.dispatchEvent(new CustomEvent('optimisticSwapOpenOrder', {
                    detail: {
                        oldOrderId: oldId,
                        newOrderId: resolvedOrderId,
                        newPrice: resolvedPrice
                    }
                }));
                toast.success(`🎯 ${mod.modeName} Stop-Loss updated to ${resolvedPrice < 1 ? resolvedPrice.toFixed(6) : resolvedPrice.toFixed(4)}${speedText}`);
            } else {
                const editAmount = mod.targetOrder.remaining > 0 ? mod.targetOrder.remaining : mod.targetOrder.amount;
                const res = await manualTradeService.editOrder(
                    parseInt(selectedApiKeyId),
                    mod.orderId,
                    {
                        symbol: mod.symbol,
                        side: mod.targetOrder.side,
                        amount: editAmount,
                        new_price: mod.newPrice
                    }
                );
                resolvedOrderId = res?.id ? String(res.id) : oldId;
                const backendPx = Number(res?.price || 0);
                if (Number.isFinite(backendPx) && backendPx > 0) {
                    resolvedPrice = backendPx;
                }
                migrateOrderPriceLine(oldId, resolvedOrderId, line);
                window.dispatchEvent(new CustomEvent('optimisticSwapOpenOrder', {
                    detail: {
                        oldOrderId: oldId,
                        newOrderId: resolvedOrderId,
                        newPrice: resolvedPrice
                    }
                }));
                const speedText = res?.execution_speed_ms ? ` (${res.execution_speed_ms}ms ⚡)` : '';
                toast.success(`Order price updated to ${resolvedPrice < 1 ? resolvedPrice.toFixed(6) : resolvedPrice.toFixed(4)}${speedText}`);
            }

            const updatedOrderSnap: OpenLimitOrder = {
                ...mod.targetOrder,
                id: resolvedOrderId,
                price: resolvedPrice,
            };
            const { color, label } = getOrderLineVisualStyle(updatedOrderSnap, resolvedPrice);
            line?.applyOptions({
                price: resolvedPrice,
                title: label,
                color,
                lineWidth: 1,
                lineStyle: LineStyle.Solid
            });
        } catch (err: any) {
            console.error('Edit order failed', err);
            toast.error('Failed to update: ' + (err.response?.data?.detail || err.message));
            const { color, label } = getOrderLineVisualStyle(mod.targetOrder, mod.originalPrice);
            line?.applyOptions({
                price: mod.originalPrice,
                title: label,
                color,
                lineWidth: 1,
                lineStyle: LineStyle.Solid
            });
        } finally {
            pendingModificationRef.current = null;
            setIsModifyingOrder(false);
            isModifyingRef.current = false;
            setPendingModification(null);
            setOrderLineSyncTick(t => t + 1);
        }
    };

    const cancelOrderModification = (mod: PendingOrderModification) => {
        const key = `order-${mod.orderId}`;
        const line = wallLinesRef.current.get(key);

        const { color, label } = getOrderLineVisualStyle(mod.targetOrder, mod.originalPrice);
        line?.applyOptions({
            price: mod.originalPrice,
            title: label,
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Solid
        });

        pendingModificationRef.current = null;
        setPendingModification(null);
        setOrderLineSyncTick(t => t + 1);
        toast('Modification cancelled', { icon: '↩️' });
    };

    // Keyboard shortcuts for Confirmation Modal (Escape = Cancel, Enter = Confirm)
    useEffect(() => {
        if (!pendingModification) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                cancelOrderModification(pendingModification);
            } else if (e.key === 'Enter' && !isModifyingOrder) {
                executeOrderModification(pendingModification);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [pendingModification, isModifyingOrder]);

    useEffect(() => {
        const container = chartContainerRef.current;
        if (!container || !chartRef.current || !candlestickSeriesRef.current) return;

        let isDown = false;

        const findClosestOrderAtY = (y: number, hitRadiusPx: number): OpenLimitOrder | undefined => {
            const series = candlestickSeriesRef.current;
            if (!series) return undefined;

            const clickedPrice = series.coordinateToPrice(y);
            if (clickedPrice === null || clickedPrice === undefined) return undefined;

            const thresholdPrice1 = series.coordinateToPrice(y - hitRadiusPx);
            const thresholdPrice2 = series.coordinateToPrice(y + hitRadiusPx);
            const fallbackPriceDiff = Math.abs((thresholdPrice1 || 0) - (thresholdPrice2 || 0)) / 2;

            let bestOrder: OpenLimitOrder | undefined;
            let bestDistPx = Infinity;

            for (const o of openOrdersRef.current) {
                const orderY = series.priceToCoordinate(o.price);
                if (orderY !== null && orderY !== undefined) {
                    const distPx = Math.abs(orderY - y);
                    if (distPx <= hitRadiusPx && distPx < bestDistPx) {
                        bestDistPx = distPx;
                        bestOrder = o;
                    }
                } else if (fallbackPriceDiff > 0) {
                    const priceDist = Math.abs(o.price - clickedPrice);
                    if (priceDist <= fallbackPriceDiff && priceDist < bestDistPx) {
                        bestDistPx = priceDist;
                        bestOrder = o;
                    }
                }
            }
            return bestOrder;
        };

        const computeDragPnlSuffix = (order: OpenLimitOrder | undefined, targetPx: number): string => {
            if (!order || (!order.isSoftwareSL && order.mode !== 'TP') || targetPx <= 0) return '';
            const fallback = resolveEffectiveEntryContext(activePositionRef.current, openOrdersRef.current, symbol);
            const ctx = resolveOrderEntryContext(order, fallback);
            if (!ctx) return '';
            const pnl = computeTradePnl({
                entryPrice: ctx.entryPrice,
                targetPrice: targetPx,
                amount: ctx.amount,
                side: ctx.side,
                isInverse: ctx.isInverse,
                contracts: ctx.contracts,
                contractSize: ctx.contractSize,
            });
            return pnl ? ` | ${formatCompactPnl(pnl.pnlUsd, pnl.pnlPct)}` : '';
        };

        const startDragAt = (clientX: number, clientY: number, isTouch: boolean, rawEvent: Event): boolean => {
            if (isModifyingRef.current || pendingModificationRef.current || !selectedApiKeyId) return false;
            const chartRect = container.getBoundingClientRect();
            const x = clientX - chartRect.left;
            const y = clientY - chartRect.top;
            if (x < 0 || x > chartRect.width || y < 0 || y > chartRect.height) return false;

            // Never hijack clicks/touches on the right or left price-axis columns so mouse & 1-finger vertical candle zoom ALWAYS works!
            const rightAxisW = Math.max(54, chartRef.current?.priceScale('right')?.width?.() || 68);
            const leftAxisW = chartRef.current?.priceScale('left')?.width?.() || 0;
            if (x >= chartRect.width - rightAxisW || (leftAxisW > 0 && x <= leftAxisW)) {
                return false;
            }

            const clickedOrder = findClosestOrderAtY(y, isTouch ? 24 : 10);
            if (!clickedOrder) return false;

            isDown = true;
            draggingOrderIdRef.current = clickedOrder.id;

            // Disable chart panning/pinch and page scrolling while dragging the order line
            chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
            rawEvent.stopPropagation();
            if (rawEvent.cancelable) {
                rawEvent.preventDefault();
            }

            if (!ghostLineRef.current && candlestickSeriesRef.current) {
                const isBuy = clickedOrder.side === 'buy';
                const isSL = Boolean(clickedOrder.isSoftwareSL);
                const isTP = clickedOrder.mode === 'TP';
                const color = isSL ? '#ef4444' : (isTP ? '#22c55e' : (isBuy ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)'));
                const modeName = clickedOrder.mode ? clickedOrder.mode.toUpperCase() : 'SL';
                const labelPrefix = isSL ? `DRAG TO EDIT ${modeName} SL` : (isTP ? `DRAG TO EDIT TP` : `DRAG TO EDIT ${clickedOrder.side.toUpperCase()}`);
                const effEntryCtx = resolveEffectiveEntryContext(activePositionRef.current, openOrdersRef.current, symbol);
                const dragUsesOverlay = Boolean((isSL || isTP) && effEntryCtx && resolveOrderEntryContext(clickedOrder, effEntryCtx));
                const pnlSuffix = computeDragPnlSuffix(clickedOrder, clickedOrder.price);

                ghostLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: clickedOrder.price,
                    color,
                    lineWidth: 1,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: dragUsesOverlay ? '' : `${labelPrefix} (${clickedOrder.price < 1 ? clickedOrder.price.toFixed(6) : clickedOrder.price.toFixed(4)})${pnlSuffix}`,
                });

                if (isSL || isTP) {
                    dragPreviewRef.current = {
                        orderId: clickedOrder.id,
                        price: clickedOrder.price,
                        isSL,
                        isTP,
                        side: clickedOrder.side,
                        amount: clickedOrder.remaining > 0 ? clickedOrder.remaining : clickedOrder.amount,
                        entryPrice: clickedOrder.entryPrice,
                    };
                    dragOverlaySyncRef.current?.();
                }
            }
            return true;
        };

        const moveDragAt = (clientY: number, isTouch: boolean, rawEvent?: Event) => {
            const chartRect = container.getBoundingClientRect();
            const clampedY = Math.max(0, Math.min(chartRect.height, clientY - chartRect.top));
            const pointerPrice = candlestickSeriesRef.current?.coordinateToPrice(clampedY);
            if (pointerPrice === null || pointerPrice === undefined) return;

            if (isDown && draggingOrderIdRef.current && ghostLineRef.current) {
                if (rawEvent) {
                    rawEvent.stopPropagation();
                    if (rawEvent.cancelable) rawEvent.preventDefault();
                }
                const targetOrder = openOrdersRef.current.find(o => o.id === draggingOrderIdRef.current);
                const isSL = Boolean(targetOrder?.isSoftwareSL);
                const isTP = targetOrder?.mode === 'TP';
                const modeName = targetOrder?.mode ? targetOrder.mode.toUpperCase() : 'SL';
                const labelPrefix = isSL ? `DRAG TO EDIT ${modeName} SL` : (isTP ? `DRAG TO EDIT TP` : `DRAG TO EDIT ${targetOrder?.side?.toUpperCase()}`);
                const effEntryCtx = resolveEffectiveEntryContext(activePositionRef.current, openOrdersRef.current, symbol);
                const dragUsesOverlay = Boolean(targetOrder && (isSL || isTP) && effEntryCtx && resolveOrderEntryContext(targetOrder, effEntryCtx));
                const pnlSuffix = computeDragPnlSuffix(targetOrder, Number(pointerPrice));

                ghostLineRef.current.applyOptions({
                    price: pointerPrice,
                    title: dragUsesOverlay ? '' : `${labelPrefix} (${pointerPrice < 1 ? pointerPrice.toFixed(6) : pointerPrice.toFixed(4)})${pnlSuffix}`
                });
                if (targetOrder && (isSL || isTP)) {
                    dragPreviewRef.current = {
                        orderId: targetOrder.id,
                        price: Number(pointerPrice),
                        isSL,
                        isTP,
                        side: targetOrder.side,
                        amount: targetOrder.remaining > 0 ? targetOrder.remaining : targetOrder.amount,
                        entryPrice: targetOrder.entryPrice,
                    };
                    dragOverlaySyncRef.current?.();
                }
                if (!isTouch) container.style.cursor = 'ns-resize';
            } else if (!isDown && !isTouch) {
                const hoverOrder = findClosestOrderAtY(clientY - chartRect.top, 8);
                if (hoverOrder && !isModifyingRef.current && !pendingModificationRef.current && selectedApiKeyId) {
                    container.style.cursor = 'ns-resize';
                } else {
                    container.style.cursor = 'crosshair';
                }
            }
        };

        const restoreChartInteractionOptions = () => {
            chartRef.current?.applyOptions({
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true,
                },
                handleScale: {
                    axisPressedMouseMove: { time: true, price: true },
                    axisDoubleClickReset: { time: true, price: true },
                    mouseWheel: true,
                    pinch: true,
                },
            });
        };

        const finishDragAt = async (clientY: number | null) => {
            if (!isDown || !draggingOrderIdRef.current || !ghostLineRef.current) {
                if (isDown) {
                    isDown = false;
                    draggingOrderIdRef.current = null;
                    dragPreviewRef.current = null;
                    dragOverlaySyncRef.current?.();
                    restoreChartInteractionOptions();
                }
                return;
            }

            dragPreviewRef.current = null;
            dragOverlaySyncRef.current?.();
            isDown = false;
            restoreChartInteractionOptions();
            container.style.cursor = 'crosshair';

            const chartRect = container.getBoundingClientRect();
            const clampedY = clientY !== null ? Math.max(0, Math.min(chartRect.height, clientY - chartRect.top)) : null;
            let newPrice = clampedY !== null
                ? (candlestickSeriesRef.current?.coordinateToPrice(clampedY as any) as number | null | undefined)
                : undefined;

            const orderId = draggingOrderIdRef.current;
            const targetOrder = openOrdersRef.current.find(o => o.id === orderId);
            draggingOrderIdRef.current = null;

            try {
                candlestickSeriesRef.current?.removePriceLine(ghostLineRef.current);
                ghostLineRef.current = null;
            } catch (err) {}

            if (!newPrice || newPrice <= 0 || !targetOrder || !selectedApiKeyId) {
                setOrderLineSyncTick(t => t + 1);
                return;
            }

            const livePrice = currentPriceRef.current || currentPrice;
            const livePriceStr = livePrice < 1 ? livePrice.toFixed(6) : livePrice.toFixed(4);
            const isTpOrder = targetOrder.mode?.toUpperCase() === 'TP';

            // Stop-Loss / Take-Profit Direction Validation vs Regular Limit Order PostOnly Capping
            if (livePrice > 0) {
                if (targetOrder.isSoftwareSL) {
                    // For Long position, SL is SELL side, and trigger price MUST be below current market price
                    if (targetOrder.side === 'sell' && newPrice >= livePrice) {
                        toast.error(`⚠️ Long Stop-Loss must be placed below market price (${livePriceStr})`);
                        setOrderLineSyncTick(t => t + 1);
                        return;
                    }
                    // For Short position, SL is BUY side, and trigger price MUST be above current market price
                    if (targetOrder.side === 'buy' && newPrice <= livePrice) {
                        toast.error(`⚠️ Short Stop-Loss must be placed above market price (${livePriceStr})`);
                        setOrderLineSyncTick(t => t + 1);
                        return;
                    }
                } else if (isTpOrder) {
                    // For Long TP (SELL exit), target price MUST stay above current market price
                    if (targetOrder.side === 'sell' && newPrice <= livePrice) {
                        toast.error(`⚠️ Long Take-Profit must be placed above market price (${livePriceStr})`);
                        setOrderLineSyncTick(t => t + 1);
                        return;
                    }
                    // For Short TP (BUY exit), target price MUST stay below current market price
                    if (targetOrder.side === 'buy' && newPrice >= livePrice) {
                        toast.error(`⚠️ Short Take-Profit must be placed below market price (${livePriceStr})`);
                        setOrderLineSyncTick(t => t + 1);
                        return;
                    }
                } else {
                    // Auto-adjust price to prevent PostOnly rejection (Capping at current market price for limit orders)
                    if (targetOrder.side === 'buy' && newPrice > livePrice) {
                        newPrice = livePrice;
                        toast.success('Buy price capped at current market price (PostOnly)');
                    } else if (targetOrder.side === 'sell' && newPrice < livePrice) {
                        newPrice = livePrice;
                        toast.success('Sell price floored at current market price (PostOnly)');
                    }
                }
            }

            // Skip if moved less than a fraction
            if (Math.abs(targetOrder.price - newPrice) < (targetOrder.price * 0.0001)) {
                setOrderLineSyncTick(t => t + 1);
                return;
            }

            const modeName = targetOrder.mode ? targetOrder.mode.toUpperCase() : (targetOrder.isSoftwareSL ? 'SL' : 'LIMIT');
            const resolvedAmount = !targetOrder.isSoftwareSL && targetOrder.remaining > 0
                ? targetOrder.remaining
                : targetOrder.amount;
            const modData: PendingOrderModification = {
                orderId,
                targetOrder,
                newPrice,
                originalPrice: targetOrder.price,
                livePrice,
                symbol,
                isSL: Boolean(targetOrder.isSoftwareSL),
                modeName,
                side: targetOrder.side,
                amount: resolvedAmount
            };

            const key = `order-${orderId}`;
            const existingLine = wallLinesRef.current.get(key);
            if (existingLine) {
                // Keep the exact same line and key in wallLinesRef; update to amber pending state
                existingLine.applyOptions({
                    price: newPrice,
                    title: `Pending Confirmation (${newPrice < 1 ? newPrice.toFixed(6) : newPrice.toFixed(4)})...`,
                    color: '#f59e0b', // Amber/Orange
                    lineWidth: 1,
                    lineStyle: LineStyle.Solid
                });
            }

            const skipConfirm = dontAskDragConfirmRef.current || (typeof localStorage !== 'undefined' && localStorage.getItem('dontAskDragConfirm') === 'true');
            if (skipConfirm) {
                executeOrderModification(modData);
            } else {
                pendingModificationRef.current = modData;
                setPendingModification(modData);
            }
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            startDragAt(e.clientX, e.clientY, false, e);
        };

        const handleMouseMove = (e: MouseEvent) => {
            moveDragAt(e.clientY, false);
        };

        const handleMouseUp = (e: MouseEvent) => {
            finishDragAt(e.clientY);
        };

        let isPinchingChart = false;
        let pinchStartDist = 0;
        let pinchStartRange: { from: number; to: number } | null = null;
        let pinchMidRatio = 0.5;

        const cancelActiveLineDrag = () => {
            dragPreviewRef.current = null;
            dragOverlaySyncRef.current?.();
            if (!isDown) return;
            isDown = false;
            draggingOrderIdRef.current = null;
            if (ghostLineRef.current && candlestickSeriesRef.current) {
                try {
                    candlestickSeriesRef.current.removePriceLine(ghostLineRef.current);
                } catch {}
                ghostLineRef.current = null;
            }
            restoreChartInteractionOptions();
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                // Cancel any 1-finger line drag and switch to 2-finger chart pinch zoom
                cancelActiveLineDrag();
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();

                const t0 = e.touches[0];
                const t1 = e.touches[1];
                const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                const visibleRange = chartRef.current?.timeScale()?.getVisibleLogicalRange?.();
                if (dist > 5 && visibleRange && typeof visibleRange.from === 'number' && typeof visibleRange.to === 'number') {
                    isPinchingChart = true;
                    pinchStartDist = dist;
                    pinchStartRange = { from: visibleRange.from, to: visibleRange.to };
                    const chartRect = container.getBoundingClientRect();
                    const midX = (t0.clientX + t1.clientX) / 2 - chartRect.left;
                    pinchMidRatio = chartRect.width > 0 ? Math.max(0.05, Math.min(0.95, midX / chartRect.width)) : 0.5;
                    chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
                }
                return;
            }
            if (e.touches.length !== 1 || isPinchingChart) return;
            const touch = e.touches[0];
            startDragAt(touch.clientX, touch.clientY, true, e);
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (isPinchingChart && e.touches.length >= 2 && pinchStartRange && pinchStartDist > 0) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();

                const t0 = e.touches[0];
                const t1 = e.touches[1];
                const currentDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                if (currentDist > 5) {
                    const scale = currentDist / pinchStartDist;
                    const startSpan = Math.max(5, pinchStartRange.to - pinchStartRange.from);
                    const newSpan = Math.max(10, Math.min(1500, startSpan / scale));
                    const anchorLogical = pinchStartRange.from + startSpan * pinchMidRatio;
                    const newFrom = anchorLogical - newSpan * pinchMidRatio;
                    const newTo = anchorLogical + newSpan * (1 - pinchMidRatio);
                    chartRef.current?.timeScale()?.setVisibleLogicalRange?.({ from: newFrom, to: newTo });
                }
                return;
            }
            if (!isDown) return;
            const touch = e.touches[0] || e.changedTouches[0];
            if (!touch) return;
            moveDragAt(touch.clientY, true, e);
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (isPinchingChart) {
                if (e.touches.length < 2) {
                    isPinchingChart = false;
                    pinchStartDist = 0;
                    pinchStartRange = null;
                    restoreChartInteractionOptions();
                }
                return;
            }
            if (!isDown) return;
            const touch = e.changedTouches[0] || e.touches[0];
            finishDragAt(touch ? touch.clientY : null);
        };

        container.addEventListener('mousedown', handleMouseDown, { capture: true });
        container.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd);
        window.addEventListener('touchcancel', handleTouchEnd);

        return () => {
            cancelActiveLineDrag();
            container.removeEventListener('mousedown', handleMouseDown, { capture: true });
            container.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);

            container.removeEventListener('touchstart', handleTouchStart, { capture: true });
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
            window.removeEventListener('touchcancel', handleTouchEnd);
        };
    }, [symbol, selectedApiKeyId]);

    // Active Futures Position Liquidation Price Line (non-draggable exchange warning line)
    useEffect(() => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        const isFuturesSym = Boolean(symbol && symbol.includes(':'));
        const liqPrice = Number(activePosition?.liquidation_price || 0);
        const posAmt = Number(activePosition?.amount || 0);
        const posSide = String(activePosition?.side || 'none').toLowerCase();
        const shouldShow = isFuturesSym && posAmt > 0 && (posSide === 'long' || posSide === 'short') && Number.isFinite(liqPrice) && liqPrice > 0;

        if (!shouldShow) {
            if (liquidationLineRef.current) {
                try { series.removePriceLine(liquidationLineRef.current); } catch {}
                liquidationLineRef.current = null;
            }
            return;
        }

        const sideLabel = posSide === 'long' ? 'LONG' : 'SHORT';
        const levLabel = activePosition?.leverage ? ` ${activePosition.leverage}x` : '';
        const title = `💀 LIQ ${sideLabel}${levLabel}`;

        if (!liquidationLineRef.current) {
            liquidationLineRef.current = series.createPriceLine({
                price: liqPrice,
                color: '#f97316',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title,
                axisLabelColor: '#f97316',
                axisLabelTextColor: '#ffffff',
            });
        } else {
            liquidationLineRef.current.applyOptions({
                price: liqPrice,
                color: '#f97316',
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title,
                axisLabelColor: '#f97316',
                axisLabelTextColor: '#ffffff',
            });
        }
    }, [activePosition, symbol, candlesReadyTick]);



    // Custom Current Price Line (toggleable via showLastPriceLine; seed/recreate on mount, symbol/timeframe change,
    // or when live ticks aren't active). While live trade ticks are actively streaming, applyLivePriceTick updates
    // this line directly at 0-lag so 200ms-throttled React currentPrice flushes can never overwrite it.
    useEffect(() => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        if (!showLastPriceLine) {
            if (sweepDecayTimerRef.current) {
                clearTimeout(sweepDecayTimerRef.current);
                sweepDecayTimerRef.current = null;
            }
            if (currentPriceLineRef.current) {
                try { series.removePriceLine(currentPriceLineRef.current); } catch {}
                currentPriceLineRef.current = null;
            }
            lastPriceLineRenderedRef.current = { price: 0, side: null, title: '', lineWidth: 1 };
            reconcileAxisLabelCollisions();
            return;
        }

        const directStreamActive =
            Boolean(currentPriceLineRef.current) &&
            hasDirectTicksRef.current &&
            (Date.now() - lastDirectTickAtRef.current) < 2500;
        if (directStreamActive) return;

        const lastCandle = lastCandleRef.current;
        const liveTick = getLatestLiveTick(symbol, exchange);
        const targetPrice =
            (lastCandle && lastCandle.close > 0)
                ? lastCandle.close
                : (liveTick && liveTick.price > 0 ? liveTick.price : currentPrice);
        if (!targetPrice || targetPrice <= 0) return;

        syncCurrentPriceLine(targetPrice, lastTradeSideRef.current);
    }, [showLastPriceLine, currentPrice, symbol, exchange, interval, candlesReadyTick, syncCurrentPriceLine, reconcileAxisLabelCollisions]);

    const syncBidAskLine = useCallback((
        ref: React.MutableRefObject<any>,
        lastRenderedRef: React.MutableRefObject<number>,
        price: number,
        color: string,
        title: string,
        visible: boolean
    ) => {
        const series = candlestickSeriesRef.current;
        if (!series) return;
        try {
            if (!visible || !Number.isFinite(price) || price <= 0) {
                if (ref.current) {
                    series.removePriceLine(ref.current);
                    ref.current = null;
                    lastRenderedRef.current = 0;
                }
                return;
            }
            if (!ref.current) {
                ref.current = series.createPriceLine({
                    price,
                    color,
                    lineWidth: 1,
                    lineStyle: 2, // Dashed
                    axisLabelVisible: true,
                    title, // Shows 'BID' or 'ASK'
                    axisLabelColor: color,
                    axisLabelTextColor: '#ffffff',
                });
                lastRenderedRef.current = price;
            } else if (lastRenderedRef.current !== price) {
                ref.current.applyOptions({ price });
                lastRenderedRef.current = price;
            }
        } catch {
            ref.current = null;
            lastRenderedRef.current = 0;
        }
    }, []);

    // Best Bid / Best Ask lines + Spread Corridor Primitive — driven continuously by subscribeLiveBbo
    // (same unified rAF frame cadence as live trade ticks). Intentionally excludes bestBid/bestAsk/currentPrice
    // from deps so throttled React flushes NEVER tear down BBO or overwrite live lines with stale props.
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;

        if (!showBidAsk) {
            hasLiveBboRef.current = false;
            lastBidLabelVisibleRef.current = true;
            lastAskLabelVisibleRef.current = true;
            spreadCorridorPrimitiveRef.current?.setVisible(false);
            spreadCorridorPrimitiveRef.current?.clear();
            syncBidAskLine(bidLineRef, lastBidPriceRenderedRef, 0, '#16a34a', 'BID', false);
            syncBidAskLine(askLineRef, lastAskPriceRenderedRef, 0, '#dc2626', 'ASK', false);
            reconcileAxisLabelCollisions();
            return;
        }

        spreadCorridorPrimitiveRef.current?.setVisible(true);
        hasLiveBboRef.current = false;
        lastBidLabelVisibleRef.current = true;
        lastAskLabelVisibleRef.current = true;
        const cachedBbo = getLatestLiveBbo(symbol, exchange);
        if (cachedBbo && cachedBbo.bestBid > 0 && cachedBbo.bestAsk > 0) {
            hasLiveBboRef.current = true;
            syncBidAskLine(bidLineRef, lastBidPriceRenderedRef, cachedBbo.bestBid, '#16a34a', 'BID', true);
            syncBidAskLine(askLineRef, lastAskPriceRenderedRef, cachedBbo.bestAsk, '#dc2626', 'ASK', true);
            spreadCorridorPrimitiveRef.current?.updateSpread(
                cachedBbo.bestBid,
                cachedBbo.bestAsk,
                cachedBbo.bidQty || 0,
                cachedBbo.askQty || 0
            );
            reconcileAxisLabelCollisions();
        } else {
            if (bestBidPropRef.current > 0) {
                syncBidAskLine(bidLineRef, lastBidPriceRenderedRef, bestBidPropRef.current, '#16a34a', 'BID', true);
            }
            if (bestAskPropRef.current > 0) {
                syncBidAskLine(askLineRef, lastAskPriceRenderedRef, bestAskPropRef.current, '#dc2626', 'ASK', true);
            }
            if (bestBidPropRef.current > 0 && bestAskPropRef.current >= bestBidPropRef.current) {
                spreadCorridorPrimitiveRef.current?.updateSpread(bestBidPropRef.current, bestAskPropRef.current, 0, 0);
            }
            reconcileAxisLabelCollisions();
        }

        const unsubBbo = subscribeLiveBbo(symbol, exchange, ({ bestBid: liveB, bestAsk: liveA, bidQty, askQty }) => {
            hasLiveBboRef.current = true;
            syncBidAskLine(bidLineRef, lastBidPriceRenderedRef, liveB, '#16a34a', 'BID', true);
            syncBidAskLine(askLineRef, lastAskPriceRenderedRef, liveA, '#dc2626', 'ASK', true);
            spreadCorridorPrimitiveRef.current?.updateSpread(liveB, liveA, bidQty || 0, askQty || 0);
            reconcileAxisLabelCollisions();
        });
        return () => unsubBbo();
    }, [showBidAsk, symbol, exchange, interval, candlesReadyTick, syncBidAskLine, reconcileAxisLabelCollisions]);

    // One-time initial seed from React bestBid/bestAsk props ONLY while waiting for the very first live WS BBO frame
    useEffect(() => {
        if (!showBidAsk || hasLiveBboRef.current || !candlestickSeriesRef.current) return;
        if (bestBid > 0) {
            syncBidAskLine(bidLineRef, lastBidPriceRenderedRef, bestBid, '#16a34a', 'BID', true);
        }
        if (bestAsk > 0) {
            syncBidAskLine(askLineRef, lastAskPriceRenderedRef, bestAsk, '#dc2626', 'ASK', true);
        }
        if (bestBid > 0 && bestAsk >= bestBid) {
            spreadCorridorPrimitiveRef.current?.updateSpread(bestBid, bestAsk, 0, 0);
        }
        reconcileAxisLabelCollisions();
    }, [showBidAsk, bestBid, bestAsk, syncBidAskLine, reconcileAxisLabelCollisions]);

    // Futures Mark Price line (purple dashed, driven by @markPrice@1s in shared liveMarketHub)
    useEffect(() => {
        const series = candlestickSeriesRef.current;
        if (!series) return;

        const isFutures = symbol.includes(':');
        const removeMarkLine = () => {
            if (markLineRef.current) {
                try { series.removePriceLine(markLineRef.current); } catch {}
                markLineRef.current = null;
            }
            lastMarkPriceRenderedRef.current = 0;
            lastMarkLabelVisibleRef.current = true;
        };

        if (!showMarkPrice || !isFutures) {
            removeMarkLine();
            return;
        }

        const applyMark = (markPrice: number) => {
            if (!candlestickSeriesRef.current || !Number.isFinite(markPrice) || markPrice <= 0) return;
            try {
                if (!markLineRef.current) {
                    markLineRef.current = candlestickSeriesRef.current.createPriceLine({
                        price: markPrice,
                        color: '#a855f7',
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        axisLabelVisible: true,
                        title: 'MARK',
                        axisLabelColor: '#9333ea',
                        axisLabelTextColor: '#ffffff',
                    });
                    lastMarkPriceRenderedRef.current = markPrice;
                    lastMarkLabelVisibleRef.current = true;
                } else if (lastMarkPriceRenderedRef.current !== markPrice) {
                    markLineRef.current.applyOptions({ price: markPrice });
                    lastMarkPriceRenderedRef.current = markPrice;
                }
                reconcileAxisLabelCollisions();
            } catch {
                markLineRef.current = null;
                lastMarkPriceRenderedRef.current = 0;
            }
        };

        const cachedMark = getLatestMarkPrice(symbol, exchange);
        if (cachedMark && cachedMark.markPrice > 0) {
            applyMark(cachedMark.markPrice);
        }

        const unsubMark = subscribeLiveMarkPrice(symbol, exchange, ({ markPrice }) => {
            applyMark(markPrice);
        });

        return () => {
            unsubMark();
        };
    }, [showMarkPrice, symbol, exchange, interval, candlesReadyTick, reconcileAxisLabelCollisions]);

    // Update Trade & Absorption Markers
    useEffect(() => {
        if (!botStatus || !candlestickSeriesRef.current || !lastCandleRef.current) return;

        const isPositionOpen = botStatus.position;
        const wasPositionOpen = prevPositionRef.current;
        let markersChanged = false;

        // 1. Position Markers (BUY/SELL)
        if (isPositionOpen && !wasPositionOpen) {
            botTradeMarkersRef.current.push({
                time: lastCandleRef.current.time,
                position: 'belowBar',
                color: '#f59e0b',
                shape: 'arrowUp',
                text: 'BOT ENTRY',
            });
            markersChanged = true;
        } else if (!isPositionOpen && wasPositionOpen) {
            botTradeMarkersRef.current.push({
                time: lastCandleRef.current.time,
                position: 'aboveBar',
                color: '#3b82f6',
                shape: 'arrowDown',
                text: 'BOT CLOSE',
            });
            markersChanged = true;
        }

        // 2. Absorption Markers (CVD Confirmation)
        if (botStatus.is_absorbing) {
            // Only add if not recently added for the same candle to avoid spam
            const lastMarker = botTradeMarkersRef.current[botTradeMarkersRef.current.length - 1];
            if (!lastMarker || lastMarker.time !== lastCandleRef.current.time || lastMarker.text !== 'ABSORPTION') {
                botTradeMarkersRef.current.push({
                    time: lastCandleRef.current.time,
                    position: 'inBar',
                    color: '#f59e0b',
                    shape: 'circle',
                    text: 'ABSORPTION',
                });
                markersChanged = true;
            }
        }

        if (markersChanged) {
            botTradeMarkersRef.current.sort((a, b) => a.time - b.time);
            if (botTradeMarkersRef.current.length > 100) {
                botTradeMarkersRef.current = botTradeMarkersRef.current.slice(-100);
            }
            safeSetMarkers();
        }

        prevPositionRef.current = isPositionOpen;
    }, [botStatus]);

    return (
        <div ref={chartSplitContainerRef} className="w-full h-full flex flex-col absolute inset-0 bg-white dark:bg-[#000000]">
            <div className="flex-1 min-h-0 relative bg-white dark:bg-[#000000]">
                {/* Binance-style bottom-left CosmoQuantAI watermark strictly behind Heatmap & Candlesticks */}
                <ChartWatermark
                    leftAxisOffset={axisOffsets.left}
                    rightAxisOffset={axisOffsets.right}
                    compact={deviceProfile.isPhoneMobileUI}
                />
                {/* Bookmap-style L2 Heatmap Layer rendered strictly BEHIND transparent-background Candlesticks */}
                {showHeatmapOverlay && (
                    <div
                        className="absolute inset-0 z-[2] pointer-events-none overflow-hidden"
                        style={{ right: axisOffsets.right, bottom: 26 }}
                    >
                        <LiquidityHeatmapRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={realHeatmapData}
                            bucketSize={heatmapBucketSize}
                            palette={heatmapPalette}
                            leftAxisOffset={axisOffsets.left}
                        />
                    </div>
                )}
                <div
                    ref={chartContainerRef}
                    className="w-full h-full absolute inset-0 z-[5] touch-none select-none bg-transparent"
                />
                <CandlestickTooltip
                    candle={tooltipData}
                    position={tooltipPos}
                    chartContainerRef={chartContainerRef}
                    leftAxisOffset={axisOffsets.left}
                    rightAxisOffset={axisOffsets.right}
                />
                {/* Compact Pro Order Flow Controls (only shown when Heatmap or Footprint is active; avoids BB HUD overlap) */}
                {(showHeatmapOverlay || showFootprint) && (
                    <div
                        className={`absolute z-30 flex flex-wrap items-center ${deviceProfile.isPhoneMobileUI ? 'gap-1 max-w-[75%]' : 'gap-1.5'} pointer-events-auto`}
                        style={{
                            left: Math.max(8, axisOffsets.left + 8),
                            top: indicatorSettings.showBB && bbData.length > 0 ? 78 : 8,
                        }}
                    >
                        {showHeatmapOverlay && (
                            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg bg-white/90 dark:bg-[#070b14]/88 border border-slate-200 dark:border-white/10 shadow-sm text-[9.5px] font-mono">
                                <span className="text-slate-400 font-bold uppercase pr-1">L2</span>
                                {(
                                    [
                                        { id: 'emerald-amber', label: 'Std' },
                                        { id: 'bookmap', label: 'Bookmap' },
                                        { id: 'ice-fire', label: 'Ice/Fire' },
                                        { id: 'viridis', label: 'Viridis' },
                                    ] as Array<{ id: HeatmapPalette; label: string }>
                                ).map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                            setHeatmapPalette(p.id);
                                            try { localStorage.setItem('cosmo_heatmap_palette', p.id); } catch {}
                                        }}
                                        className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                                            heatmapPalette === p.id
                                                ? 'bg-cyan-500 text-slate-950'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {showFootprint && (
                            <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg bg-white/90 dark:bg-[#070b14]/88 border border-slate-200 dark:border-white/10 shadow-sm text-[9.5px] font-mono">
                                <span className="text-slate-400 font-bold uppercase pr-1">FP</span>
                                {(
                                    [
                                        { id: 'bid-ask', label: 'Bid×Ask' },
                                        { id: 'delta', label: 'Delta' },
                                        { id: 'imbalance', label: 'Imb' },
                                    ] as Array<{ id: FootprintMode; label: string }>
                                ).map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => {
                                            setFootprintMode(m.id);
                                            try { localStorage.setItem('cosmo_footprint_mode', m.id); } catch {}
                                        }}
                                        className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                                            footprintMode === m.id
                                                ? 'bg-amber-500 text-slate-950'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {showCrosshairAIPredict && (
                    <button
                        ref={crosshairBtnRef}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (crosshairPriceRef.current !== null && onAIPredictClick) {
                                onAIPredictClick(crosshairPriceRef.current);
                                if (aiClickPriceLineRef.current && candlestickSeriesRef.current) {
                                    try { candlestickSeriesRef.current.removePriceLine(aiClickPriceLineRef.current); } catch {}
                                    aiClickPriceLineRef.current = null;
                                }
                                if (candlestickSeriesRef.current) {
                                    aiClickPriceLineRef.current = candlestickSeriesRef.current.createPriceLine({
                                        price: crosshairPriceRef.current,
                                        color: '#c084fc',
                                        lineWidth: 2,
                                        lineStyle: 3,
                                        axisLabelVisible: true,
                                        title: '🤖 Algo Target',
                                    });
                                }
                            }
                        }}
                        className={`absolute hidden z-50 px-3 h-7 rounded-full bg-gradient-to-br from-purple-600/95 to-indigo-600/95 hover:from-purple-500 hover:to-indigo-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.8)] flex items-center justify-center gap-1.5 ${isThermalGuard ? '' : 'backdrop-blur-md'} border border-white/20 cursor-pointer pointer-events-auto`}
                        title="Predict with AI at this price"
                        style={{ transform: 'translateY(-50%)', transition: 'none' }} // NO CSS transition so it tracks instantly
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        <span className="text-[10px] font-bold tracking-wider uppercase whitespace-nowrap">AI Predict</span>
                    </button>
                )}
                <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden" style={{ bottom: 26 }}>
                    <TradePositionOverlay
                        chart={chartRef.current}
                        series={candlestickSeriesRef.current}
                        symbol={symbol}
                        exchange={exchange}
                        currentPrice={currentPrice}
                        activePosition={activePosition}
                        openOrders={openOrders}
                        candlesReadyTick={candlesReadyTick}
                        isDark={isDark}
                        pendingModification={pendingModification}
                        dragPreviewRef={dragPreviewRef}
                        registerDragSyncRef={dragOverlaySyncRef}
                        formatPrice={formatDisplayPrice}
                    />
                </div>
                <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden" style={{ right: axisOffsets.right, bottom: 26 }}>
                    {indicatorSettings.showDualEngine && <DualEngineDashboard settings={indicatorSettings} candles={allCandlesRef.current} currentPrice={currentPrice} />}
                    {indicatorSettings.showWatchlistScanner && <WatchlistScanner settings={indicatorSettings} exchange={exchange} interval={interval} />}
                    {/* ── Advanced Metrics ── */}
                    {activeMLModelId && (
                        <MLPredictionCloudRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            modelId={activeMLModelId}
                            exchange={exchange}
                            symbol={symbol}
                            currentPrice={currentPrice}
                        />
                    )}
                    {advancedMetrics.showDeltaProfile && <DeltaProfileRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showDeltaProfile} data={advancedMetricsData?.deltaProfile} />}
                    {advancedMetrics.showFootprintImbalance && <FootprintImbalanceRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showFootprintImbalance} data={advancedMetricsData?.footprintData} />}
                    {advancedMetrics.showTradeBubbles && <TradeBubbleChartRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showTradeBubbles} data={advancedMetricsData?.tradeBubbles} />}
                    {advancedMetrics.showSpoofingDetection && <SpoofingDetectionRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showSpoofingDetection} data={advancedMetricsData?.spoofingData} />}
                    {advancedMetrics.showAnchoredVWAP && <AnchoredVWAPRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showAnchoredVWAP} data={advancedMetricsData?.vwapData} />}
                    {advancedMetrics.showOIBOscillator && <OIBOscillatorRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showOIBOscillator} data={advancedMetricsData?.oibData} />}
                    {advancedMetrics.showTPOProfile && <TPOProfileRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showTPOProfile} data={advancedMetricsData?.tpoData} />}
                    {advancedMetrics.showDeltaDivergence && <DeltaDivergenceRenderer chart={chartRef.current} series={candlestickSeriesRef.current} visible={advancedMetrics.showDeltaDivergence} data={advancedMetricsData?.divergenceData} />}
                    {indicatorSettings.showAetherFlow && <AetherFlowRenderer chart={chartRef.current} series={candlestickSeriesRef.current!} data={aetherFlowData} settings={indicatorSettings} />}

                    {indicatorSettings.showAutoFibo && <FibonacciCloudRenderer chart={chartRef.current} series={candlestickSeriesRef.current} data={fiboData} />}
                    {indicatorSettings.showBB && <BollingerBandsRenderer chart={chartRef.current} series={candlestickSeriesRef.current} data={bbData} visible={indicatorSettings.showBB} />}
                    {indicatorSettings.showMACD && (
                        <MACDRenderer
                            chart={chartRef.current}
                            data={allCandlesRef.current}
                            visible={indicatorSettings.showMACD}
                            fast={indicatorSettings.macdFast}
                            slow={indicatorSettings.macdSlow}
                            signal={indicatorSettings.macdSignal}
                        />
                    )}
                    {indicatorSettings.showIchimoku && <IchimokuRenderer chart={chartRef.current} series={candlestickSeriesRef.current} data={ichimokuData} displacement={indicatorSettings.displacement} />}
                    {indicatorSettings.showTrendFinder && (
                        <TrendFinderRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={trendFinderData}
                            visible={indicatorSettings.showTrendFinder}
                            threshold={indicatorSettings.trendFinderThreshold}
                            hideLowConfidenceTrend={indicatorSettings.hideLowConfidenceTrend}
                        />
                    )}
                    {showFootprint && (
                        <FootprintRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={footprintData}
                            visible={showFootprint}
                            mode={footprintMode}
                            leftAxisOffset={axisOffsets.left}
                        />
                    )}
                    {indicatorSettings.showLiquidationHeatmap && (
                        <LiquidationRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={godModeData}
                            symbol={symbol}
                            showBubbles={indicatorSettings.liquidationShowBubbles}
                            intensityScale={indicatorSettings.liquidationHeatmapIntensity}
                            useTrailingLiquidity={indicatorSettings.liquidationShowTrailingCloud}
                            showTrueCVD={indicatorSettings.liquidationShowTrueCVD}
                            showBiasTag={indicatorSettings.liquidationShowBiasTag !== false}
                            showDeltaStrip={indicatorSettings.liquidationShowDeltaStrip !== false}
                            showSpoofing={indicatorSettings.liquidationShowSpoofing}
                            showGEX={indicatorSettings.liquidationShowGEX}
                            showBookmap={indicatorSettings.liquidationShowBookmap}
                            bookmapIntensity={indicatorSettings.liquidationBookmapIntensity}
                            bookmapHistoryMinutes={indicatorSettings.liquidationBookmapHistoryMin || 120}
                            spoofingThreshold={indicatorSettings.liquidationSpoofingThreshold}
                            smartMoneyBias={indicatorSettings.liquidationSmartMoneyBias}
                            showMagnetZones={indicatorSettings.liquidationShowMagnetZones !== false}
                            showDeepWalls={indicatorSettings.liquidationShowDeepWalls !== false}
                            deepRangePct={indicatorSettings.liquidationDeepRangePct || 10}
                            showLeveragePools={indicatorSettings.liquidationShowLeveragePools !== false}
                            showTrajectory={indicatorSettings.liquidationShowTrajectory !== false}
                            isDark={isDark}
                            onZoneClick={onChartBackgroundClick}
                            candlesRef={allCandlesRef}
                        />
                    )}
                    {indicatorSettings.showLiquidationHeatmap && isActiveChart && indicatorSettings.liquidationShowSmartMoneyHUD !== false && godModeData && (godModeData.smart_trajectory || godModeData.pain_threshold) && (
                        <SmartMoneyHUD
                            symbol={symbol}
                            data={godModeData.smart_trajectory as any}
                            godModeData={godModeData}
                            currentPrice={godModeData.current_price}
                            icebergEvents={godModeData.iceberg_events}
                            magnetZones={godModeData.magnet_zones}
                            deepRangePct={indicatorSettings.liquidationDeepRangePct || 10}
                            visible={true}
                        />
                    )}
                    {indicatorSettings.showSessions && (
                        <SessionsRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            sessionsData={sessionsData}
                            settings={indicatorSettings}
                        />
                    )}
                    <SMCRenderer
                        chart={chartRef.current}
                        series={candlestickSeriesRef.current}
                        data={smcData}
                        settings={{
                            mode: indicatorSettings.smcMode,
                            style: indicatorSettings.smcStyle,
                            showInternals: indicatorSettings.smcShowInternals,
                            internalBullFilter: indicatorSettings.smcInternalBullFilter,
                            internalBearFilter: indicatorSettings.smcInternalBearFilter,
                            confluenceFilter: indicatorSettings.smcConfluenceFilter,
                            showSwing: indicatorSettings.smcShowSwing,
                            swingBullFilter: indicatorSettings.smcSwingBullFilter,
                            swingBearFilter: indicatorSettings.smcSwingBearFilter,
                            showSwingPoints: false,
                            swingLength: indicatorSettings.smcSwingLength,
                            showStrongWeakHL: indicatorSettings.smcShowStrongWeakHL,
                            showInternalOB: indicatorSettings.smcShowInternalOB,
                            internalOBCount: indicatorSettings.smcInternalOBCount,
                            showSwingOB: indicatorSettings.smcShowSwingOB,
                            swingOBCount: indicatorSettings.smcSwingOBCount,
                            obFilter: indicatorSettings.smcOBFilter,
                            obMitigation: indicatorSettings.smcOBMitigation,
                            showEqualHL: indicatorSettings.smcShowEqualHL,
                            equalHLLength: indicatorSettings.smcEqualHLLength,
                            equalHLThreshold: indicatorSettings.smcEqualHLThreshold,
                            showFVG: indicatorSettings.smcShowFVG,
                            fvgAutoThreshold: indicatorSettings.smcFVGAutoThreshold,
                            fvgExtendBars: indicatorSettings.smcFVGExtendBars,
                            showPDZones: indicatorSettings.smcShowPDZones,
                        }}
                        visible={indicatorSettings.showSMC}
                    />
                    {(indicatorSettings.showICTKillzones || indicatorSettings.luxShowKillzones) && (
                        <ICTKillzonesRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={ictData}
                            visible={indicatorSettings.showICTKillzones || indicatorSettings.luxShowIndicator}
                            settings={indicatorSettings}
                        />
                    )}
                    <ICTPO3Renderer
                        chart={chartRef.current}
                        series={candlestickSeriesRef.current}
                        data={ictPO3Data}
                        visible={indicatorSettings.showICTPO3}
                    />
                    <LuxIctRenderer
                        chart={chartRef.current}
                        series={candlestickSeriesRef.current}
                        luxIctData={luxIctData}
                        configs={{
                            mode: indicatorSettings.luxMode,
                            showMS: indicatorSettings.luxShowMS,
                            swingLength: indicatorSettings.luxSwingLength,
                            showMSS: indicatorSettings.luxShowMSS,
                            showBOS: indicatorSettings.luxShowBOS,
                            showDisplacement: indicatorSettings.luxShowDisplacement,
                            percBody: indicatorSettings.luxPercBody,
                            showVIMB: indicatorSettings.luxShowVIMB,
                            vimbThreshold: indicatorSettings.luxVIMBThreshold,
                            showOB: indicatorSettings.luxShowOB,
                            obLookback: indicatorSettings.luxOBLookback,
                            showBullOB: indicatorSettings.luxShowBullOB,
                            showBearOB: indicatorSettings.luxShowBearOB,
                            showOBLabels: indicatorSettings.luxShowOBLabels,
                            showLiq: indicatorSettings.luxShowLiq,
                            liqMargin: indicatorSettings.luxLiqMargin,
                            liqVisibleCount: indicatorSettings.luxLiqVisibleCount,
                            showFVG: indicatorSettings.luxShowFVG,
                            bpr: indicatorSettings.luxBPR,
                            fvgType: indicatorSettings.luxFVGType,
                            fvgVisibleCount: indicatorSettings.luxFVGVisibleCount,
                            showNWOG: indicatorSettings.luxShowNWOG,
                            nwogMax: indicatorSettings.luxNWOGMax,
                            showNDOG: indicatorSettings.luxShowNDOG,
                            ndogMax: indicatorSettings.luxNDOGMax,
                            fibMode: indicatorSettings.luxFibMode,
                            fibExtend: indicatorSettings.luxFibExtend,
                            showKillzones: indicatorSettings.luxShowKillzones,
                            luxShowIndicator: indicatorSettings.luxShowIndicator,
                        } as any}
                        visibleLogicalRange={chartRef.current?.timeScale().getVisibleLogicalRange()}
                    />
                    {indicatorSettings.showBB && bbData.length > 0 && (() => {
                        const last = bbData[bbData.length - 1];
                        const isCompactPhone = deviceProfile.isPhoneMobileUI;
                        return (
                            <div className={`absolute top-2 left-2 z-[10] flex flex-col ${isCompactPhone ? 'gap-0.5' : 'gap-1'} pointer-events-none select-none`}>
                                <div className={`flex items-center ${isCompactPhone ? 'gap-1 px-1.5 py-0.5' : 'gap-2 px-2 py-1'} ${isThermalGuard ? 'bg-white/95 dark:bg-black/85' : 'bg-white/90 dark:bg-black/60 backdrop-blur-md'} rounded border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none`}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-[#22c55e]" />
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-bold text-slate-600 dark:text-gray-400`}>BB UPPER:</span>
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-mono font-bold text-emerald-600 dark:text-[#22c55e]`}>{last.upper.toFixed(5)}</span>
                                </div>
                                <div className={`flex items-center ${isCompactPhone ? 'gap-1 px-1.5 py-0.5' : 'gap-2 px-2 py-1'} ${isThermalGuard ? 'bg-white/95 dark:bg-black/85' : 'bg-white/90 dark:bg-black/60 backdrop-blur-md'} rounded border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none`}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-[#3b82f6]" />
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-bold text-slate-600 dark:text-gray-400`}>BB MIDDLE:</span>
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-mono font-bold text-blue-600 dark:text-[#3b82f6]`}>{last.middle.toFixed(5)}</span>
                                </div>
                                <div className={`flex items-center ${isCompactPhone ? 'gap-1 px-1.5 py-0.5' : 'gap-2 px-2 py-1'} ${isThermalGuard ? 'bg-white/95 dark:bg-black/85' : 'bg-white/90 dark:bg-black/60 backdrop-blur-md'} rounded border border-slate-200 dark:border-white/10 shadow-sm dark:shadow-none`}>
                                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-[#ef4444]" />
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-bold text-slate-600 dark:text-gray-400`}>BB LOWER:</span>
                                    <span className={`${isCompactPhone ? 'text-[8.5px]' : 'text-[10px]'} font-mono font-bold text-rose-600 dark:text-[#ef4444]`}>{last.lower.toFixed(5)}</span>
                                </div>
                            </div>
                        );
                    })()}
                    {/* ── Multi-Timeframe EMA HUD Overlay ── */}
                    {indicatorSettings.showEMA && Object.keys(mtfEmaValues).length > 0 && (
                        <div className={`absolute ${deviceProfile.isPhoneMobileUI ? 'bottom-8 left-2 max-w-[60%] flex-wrap gap-1 px-1.5 py-0.5' : 'top-2 right-14 gap-2 px-2.5 py-1'} z-[10] flex items-center ${isThermalGuard ? 'bg-white/95 dark:bg-black/85' : 'bg-white/90 dark:bg-black/75 backdrop-blur-md'} rounded-lg border border-slate-200 dark:border-white/10 select-none shadow-md dark:shadow-lg`}>
                            <span className={`${deviceProfile.isPhoneMobileUI ? 'text-[8.5px]' : 'text-[10px]'} font-bold text-slate-700 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1`}>
                                <span className={`w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 ${isThermalGuard ? '' : 'animate-pulse'}`} />
                                EMA {indicatorSettings.emaPeriod}:
                            </span>
                            <div className={`flex items-center flex-wrap ${deviceProfile.isPhoneMobileUI ? 'gap-1.5 text-[8.5px]' : 'gap-2 text-[10px]'} font-mono font-bold`}>
                                {(indicatorSettings.emaTimeframes && indicatorSettings.emaTimeframes.length > 0 ? indicatorSettings.emaTimeframes : ['1m']).map((tf) => {
                                    const val = mtfEmaValues[tf];
                                    if (val === undefined) return null;
                                    const tfStyle = DEFAULT_EMA_TIMEFRAMES[tf] || { color: '#f59e0b', label: tf, timeframe: tf, lineWidth: 1 };
                                    const color = (indicatorSettings.emaCustomColors && indicatorSettings.emaCustomColors[tf]) || tfStyle.color;
                                    return (
                                        <div key={tf} className="flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                            <span className="text-slate-500 dark:text-gray-400 font-normal">{tfStyle.label}:</span>
                                            <span style={{ color }}>{formatDisplayPrice(val)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {indicatorSettings.showSupertrend && (
                        <SupertrendRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={supertrendData}
                            ohlcData={allCandlesRef.current}
                            showSignals={indicatorSettings.supertrendShowSignals}
                            highlighter={indicatorSettings.supertrendHighlighting}
                        />
                    )}
                    {indicatorSettings.showMsbOb && msbObData && (
                        <MsbObRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={msbObData}
                            ohlcData={allCandlesRef.current}
                            showZigzag={indicatorSettings.msbObShowZigzag}
                        />
                    )}
                    {/* Wick Rejection Support & Resistance */}
                    {indicatorSettings.showWickSR && (
                        <WickSRRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={wickSRData}
                            showZones={indicatorSettings.wickSRShowZones}
                            showLabels={indicatorSettings.wickSRShowLabels}
                            visible={indicatorSettings.showWickSR}
                        />
                    )}

                    {/* VWAP Standard Deviation Bands */}
                    {indicatorSettings.showVWAPSD && (
                        <VWAPSDRenderer
                            chart={chartRef.current}
                            visible={indicatorSettings.showVWAPSD}
                            data={vwapSDData}
                        />
                    )}

                    {/* Liquidity Sweep, Swap & Iceberg Absorption */}
                    {indicatorSettings.showLiquiditySweepAbsorption && (
                        <LiquiditySweepAbsorptionRenderer
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            zones={liquidityAbsorptionZones}
                            candlesRef={allCandlesRef}
                            visible={Boolean(indicatorSettings.showLiquiditySweepAbsorption)}
                            showIcebergMarkers={indicatorSettings.lsaShowIcebergMarkers !== false}
                            showLiquiditySwap={indicatorSettings.lsaShowLiquiditySwap !== false}
                            showHudSummary={indicatorSettings.lsaShowHudSummary !== false}
                            currentPrice={currentPrice}
                        />
                    )}
                    {indicatorSettings.showUTBot && indicatorSettings.utBotShowHud !== false && utBotHudData && (
                        <UTBotHUD
                            visible={true}
                            marketBias={utBotHudData.marketBias}
                            backtest={utBotHudData.backtest}
                            activeSetup={utBotHudData.activeSetup}
                            latestAdx={utBotHudData.latestAdx}
                            latestRsi={utBotHudData.latestRsi}
                            alertsEnabled={Boolean(indicatorSettings.utBotEnableAlerts)}
                            isThermalGuard={isThermalGuard}
                            isCompactPhone={deviceProfile.isPhoneMobileUI}
                            formatPrice={formatDisplayPrice}
                            onToggleAlerts={() => onToggleUTBotAlerts?.()}
                            onSyncToBot={() => onSyncUTBotToBot?.()}
                        />
                    )}
                </div>
                {indicatorSettings.showSessions && <SessionsDashboard settings={indicatorSettings} statuses={sessionStatuses} />}
                {showVPVR && (
                    <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden" style={{ right: axisOffsets.right, bottom: 26 }}>
                        <VolumeProfileWidget
                            chart={chartRef.current}
                            series={candlestickSeriesRef.current}
                            data={vpvrData}
                            leftAxisOffset={axisOffsets.left}
                        />
                    </div>
                )}

                {/* ── Quantum AI v8 Dashboard HUD ── */}
                {indicatorSettings.showQuantumAI && quantumAiData.length > 0 && (() => {
                    const last = quantumAiData[quantumAiData.length - 1];
                    const hasSignal = last.bullEntry || last.bearEntry;
                    const isBull = last.bullEntry;
                    const conf = isBull ? last.bullConfidence : last.bearConfidence;
                    const qp = Math.round(last.quantumPower);

                    // Helpers
                    const HudDot = ({ color }: { color: string }) => (
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginRight: 4 }} />
                    );
                    const HudSectionHeader = ({ label, color }: { label: string; color: string }) => (
                        <div className="flex items-center gap-1 my-1.5">
                            <div className="flex-1 h-[1px] border-t border-dashed border-gray-300 dark:border-white/10" />
                            <span style={{ color }} className="text-[9px] font-bold tracking-widest uppercase px-1 whitespace-nowrap">{label}</span>
                            <div className="flex-1 h-[1px] border-t border-dashed border-gray-300 dark:border-white/10" />
                        </div>
                    );
                    const HudRow = ({ label, value, dot, valColor }: { label: string; value: string; dot?: string; valColor?: string }) => (
                        <div className="flex justify-between items-center py-0.5 border-b border-gray-100 dark:border-white/5">
                            <span className="text-[10px] text-gray-600 dark:text-gray-400 tracking-wide">{label}</span>
                            <span style={{ color: valColor }} className="flex items-center text-[10px] font-semibold text-gray-800 dark:text-gray-200 font-mono">
                                {dot && <HudDot color={dot} />}{value}
                            </span>
                        </div>
                    );

                    const signalColor = hasSignal ? (isBull ? '#059669' : '#dc2626') : '#64748b';
                    const volLabel = last.isMarketVolatile ? 'Trending' : 'Ranging';
                    const volColor = last.isMarketVolatile ? '#8b5cf6' : '#64748b';
                    const signalLabel = hasSignal ? (isBull ? 'BUY' : 'SELL') : 'NO SIGNAL';
                    const trendColor = last.emaBull ? '#059669' : last.emaBear ? '#dc2626' : '#64748b';
                    const trendLabel = last.emaBull ? 'Bullish' : last.emaBear ? 'Bearish' : 'Neutral';
                    const htfTrendColor = last.htfTrend === 'Bullish' ? '#059669' : '#dc2626';
                    const mtfTrendColor = last.mtfTrend === 'Bullish' ? '#059669' : '#dc2626';
                    const ichiColor = last.ichimokuStatus.includes('Bullish') ? '#059669' : last.ichimokuStatus.includes('Bearish') ? '#dc2626' : '#64748b';
                    const divColor = last.divergenceStatus.includes('Bullish') ? '#059669' : last.divergenceStatus.includes('Bearish') ? '#dc2626' : '#64748b';

                    const quantumHudElement = (
                        <div className="fixed z-[9999] select-none pointer-events-auto" style={{
                            width: 280,
                            fontFamily: "'Inter', sans-serif",
                            left: `${quantumAiHudPos.x}px`,
                            top: `${quantumAiHudPos.y}px`
                        }}>
                            <div className={`bg-white/95 dark:bg-[#0b1220]/95 border border-gray-200 dark:border-indigo-500/30 rounded-xl overflow-hidden shadow-2xl ${isThermalGuard ? '' : 'backdrop-blur-xl'}`}>
                                {/* Header */}
                                <div
                                    onMouseDown={handleHudMouseDown}
                                    className="bg-gray-100 dark:bg-gradient-to-r dark:from-[#1a1f3c] dark:to-[#12192e] border-b border-gray-200 dark:border-indigo-500/30 px-3.5 py-2.5 flex items-center gap-2 select-none"
                                    style={{
                                        cursor: isDraggingQuantumAi ? 'grabbing' : 'grab'
                                    }}
                                >
                                    <span className="text-base">🚀</span>
                                    <span className="text-[11px] font-black tracking-widest uppercase text-indigo-600 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-purple-400 dark:to-pink-400">
                                        QUANTUM AI v8 · {symbol}
                                    </span>
                                    <span className="ml-auto text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-white/10 text-indigo-600 dark:text-indigo-300">
                                        DRAG ME
                                    </span>
                                </div>

                                {/* Body */}
                                <div className="p-3">
                                    {/* Signal rows */}
                                    <HudRow label="SIGNAL" value={signalLabel} dot={signalColor} valColor={signalColor} />
                                    <HudRow label="REASON" value={last.signalReason || 'No Signal'} valColor="#64748b" />
                                    <HudRow label="CONFIDENCE" value={`${Math.round(conf)}%`} valColor={conf >= 80 ? '#7c3aed' : conf >= 60 ? '#d97706' : '#64748b'} />
                                    <HudRow label="STRATEGY" value="Adaptive Quantum" valColor="#64748b" />

                                    {/* Quantum AI Section */}
                                    <HudSectionHeader label="QUANTUM AI" color="#7c3aed" />
                                    <HudRow label="Quantum Power" value={`${qp}%`} valColor={qp >= 70 ? '#7c3aed' : qp >= 40 ? '#d97706' : '#64748b'} />

                                    {/* Multi-Timeframe Section */}
                                    <HudSectionHeader label="MULTI-TIMEFRAME" color="#d97706" />
                                    <HudRow label="HTF Trend" value={`${last.htfTrend || 'N/A'} (240)`} dot={htfTrendColor} valColor={htfTrendColor} />
                                    <HudRow label="MTF Trend" value={`${last.mtfTrend || 'N/A'} (60)`} dot={mtfTrendColor} valColor={mtfTrendColor} />
                                    <HudRow label="Alignment" value={last.alignmentStatus || 'Mixed'} />

                                    {/* Ichimoku Section */}
                                    <HudSectionHeader label="ICHIMOKU" color="#d97706" />
                                    <HudRow label="Cloud Status" value={last.ichimokuStatus || 'N/A'} dot={ichiColor} valColor={ichiColor} />
                                    <HudRow label="TK Cross" value={last.tkCross || 'N/A'} />

                                    {/* Volume Profile Section */}
                                    <HudSectionHeader label="VOLUME PROFILE" color="#d97706" />
                                    <HudRow label="POC" value={`${last.close.toFixed(5)}`} valColor="#64748b" />

                                    {/* Active Patterns Section */}
                                    <HudSectionHeader label="ACTIVE PATTERNS" color="#7c3aed" />
                                    <HudRow label="Chart Pattern" value={last.activePattern || 'None'} valColor={last.activePattern !== 'None' ? '#059669' : '#94a3b8'} />
                                    <HudRow label="Divergence" value={last.divergenceStatus || 'None'} dot={divColor} valColor={divColor} />

                                    {/* Market State Section */}
                                    <HudSectionHeader label="MARKET STATE" color="#d97706" />
                                    <HudRow label="Volatility" value={volLabel} dot={volColor} valColor={volColor} />
                                    <HudRow label="Trend" value={trendLabel} dot={trendColor} valColor={trendColor} />
                                    <HudRow label="Quantum Signal" value={hasSignal ? signalLabel : '—'} valColor={signalColor} />
                                </div>

                                {/* Footer signal badge */}
                                <div className={`border-t border-gray-200 dark:border-white/10 px-3.5 py-2 text-center transition-all ${
                                    hasSignal
                                        ? isBull ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'
                                        : 'bg-gray-50 dark:bg-white/5'
                                }`}>
                                    <span style={{ color: signalColor }} className="text-[11px] font-black tracking-widest uppercase">
                                        {hasSignal ? `⚡ ${signalLabel} SIGNAL` : '○ NO SIGNAL'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );

                    return typeof window !== 'undefined' ? createPortal(quantumHudElement, document.body) : null;
                })()}

                <div className={`absolute ${deviceProfile.isPhoneMobileUI ? 'bottom-[30px] right-[62px] gap-1' : 'bottom-[40px] right-[75px] gap-2'} z-20 pointer-events-none flex flex-col items-end`}>
                    {dontAskDragConfirm && (
                        <button
                            onClick={() => {
                                setDontAskDragConfirm(false);
                                dontAskDragConfirmRef.current = false;
                                try {
                                    localStorage.setItem('dontAskDragConfirm', 'false');
                                } catch (e) {}
                                toast('Drag & Drop confirmation popup re-enabled', { icon: '🛡️' });
                            }}
                            className={`${deviceProfile.isPhoneMobileUI ? 'px-1.5 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'} rounded-lg font-mono font-semibold bg-white/95 dark:bg-black/85 hover:bg-white dark:hover:bg-black/90 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 hover:border-cyan-400 transition-all cursor-pointer pointer-events-auto shadow-md ${isThermalGuard ? '' : 'backdrop-blur-md'} flex items-center gap-1.5 group`}
                            title="Click to require confirmation popup on drag & drop again"
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                            <span>⚡ Instant Drag: ON</span>
                            {!deviceProfile.isPhoneMobileUI && (
                                <span className="text-[9px] text-gray-500 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white underline">Re-enable popup</span>
                            )}
                        </button>
                    )}
                    {botStatus && botStatus.is_absorbing && (
                        <div className="bg-orange-600 border border-orange-400 text-white text-[16px] font-bold px-3 py-1.5 rounded animate-pulse shadow-lg">
                            🧬 ABSORPTION DETECTED
                        </div>
                    )}
                    {botStatus && botStatus.absorption_delta !== undefined && (
                        <div className={`${isThermalGuard ? 'bg-black/85' : 'bg-black/60 backdrop-blur-md'} border border-white/10 text-[14px] font-mono px-3 py-1.5 rounded`}>
                            <span className="text-gray-400 mr-2 text-[11px] uppercase tracking-tighter">Backend CVD</span>
                            <span className={botStatus.absorption_delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                                {botStatus.absorption_delta > 0 ? '+' : ''}{typeof botStatus.absorption_delta === 'number'
                                    ? botStatus.absorption_delta.toLocaleString(undefined, { maximumFractionDigits: 0 })
                                    : botStatus.absorption_delta}
                            </span>
                        </div>
                    )}
                    <LiveFeedHealthBadge
                        symbol={symbol}
                        exchange={exchange}
                        showBidAsk={showBidAsk}
                        showMarkPrice={showMarkPrice}
                        compact={deviceProfile.isPhoneMobileUI}
                        isThermalGuard={isThermalGuard}
                    />
                    <CandleCountdown interval={interval} lastCandleRef={lastCandleRef} compact={deviceProfile.isPhoneMobileUI} />
                </div>
            </div>
            {showCVD && (
                <>
                    {/* Draggable Institutional Pane Splitter (double-click to reset height) */}
                    <div
                        role="separator"
                        aria-orientation="horizontal"
                        onPointerDown={handleCvdSplitterPointerDown}
                        onDoubleClick={handleCvdSplitterDoubleClick}
                        title="Drag to resize CVD pane (double-click to reset)"
                        className={`group relative h-2 shrink-0 cursor-row-resize select-none touch-none flex items-center justify-center border-t border-b transition-colors z-20 ${
                            isResizingCvdPane
                                ? 'bg-cyan-500/20 border-cyan-500/50'
                                : 'bg-slate-100/80 dark:bg-[#0a0f1c] border-slate-200 dark:border-white/10 hover:bg-cyan-500/15 hover:border-cyan-500/40'
                        }`}
                    >
                        <span
                            className={`w-10 h-0.5 rounded-full transition-colors ${
                                isResizingCvdPane
                                    ? 'bg-cyan-400'
                                    : 'bg-slate-400/60 dark:bg-white/25 group-hover:bg-cyan-400'
                            }`}
                        />
                    </div>
                    <div
                        style={{ height: `${cvdPaneHeightPct}%` }}
                        className="shrink-0 relative z-0 bg-white dark:bg-[#000000]"
                    >
                        <CVDChart
                            mainChart={chartRef.current}
                            mainSeries={candlestickSeriesRef.current}
                            data={cvdData}
                            meta={cvdMeta}
                            loading={orderFlowLoading}
                            interval={interval}
                        />
                    </div>
                </>
            )}
            {/* ── DRAG & DROP ORDER CONFIRMATION MODAL ── */}
            <AnimatePresence>
                {pendingModification && (
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 10 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            transition={{ duration: 0.15 }}
                            className="cosmo-theme-modal relative w-full max-w-md bg-white dark:bg-gradient-to-b dark:from-[#131b2e] dark:via-[#0f1524] dark:to-[#0a0e18] border border-gray-200 dark:border-cyan-500/30 rounded-2xl shadow-2xl dark:shadow-[0_0_50px_rgba(0,0,0,0.85)] p-6 overflow-hidden text-gray-900 dark:text-white transition-colors"
                        >
                            {/* Glowing top line */}
                            <div className={`absolute top-0 left-0 right-0 h-[2px] ${pendingModification.isSL ? 'bg-gradient-to-r from-red-500 via-amber-500 to-rose-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]' : 'bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 shadow-[0_0_12px_rgba(6,182,212,0.6)]'}`} />

                            {/* Modal Header */}
                            <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-white/10">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-lg ${pendingModification.isSL ? 'bg-red-500/10 dark:bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25 dark:border-red-500/30' : 'bg-cyan-500/10 dark:bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25 dark:border-cyan-500/30'}`}>
                                        {pendingModification.isSL ? '🛡️' : '🔄'}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-base tracking-wide text-gray-900 dark:text-white">
                                            {pendingModification.isSL ? 'Confirm Stop-Loss Adjustment' : 'Confirm Order Adjustment'}
                                        </h3>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Verify price change before updating
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => cancelOrderModification(pendingModification)}
                                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                                    title="Cancel"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            {/* Order Details Body */}
                            <div className="py-5 space-y-4">
                                {/* Badge & Symbol */}
                                <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/5">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${pendingModification.side === 'buy' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'}`}>
                                            {pendingModification.side}
                                        </span>
                                        <span className="font-mono font-bold text-sm text-gray-800 dark:text-gray-200">
                                            {pendingModification.symbol}
                                        </span>
                                    </div>
                                    <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 border border-cyan-500/20">
                                        {pendingModification.isSL ? `${pendingModification.modeName} SL` : 'LIMIT'}
                                    </span>
                                </div>

                                {/* Price Comparison Grid */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* Original Price */}
                                    <div className="p-3 rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/5 flex flex-col justify-center">
                                        <span className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">Previous Price</span>
                                        <span className="font-mono text-base font-bold text-gray-800 dark:text-gray-300 mt-0.5">
                                            ${pendingModification.originalPrice < 1 ? pendingModification.originalPrice.toFixed(6) : pendingModification.originalPrice.toFixed(4)}
                                        </span>
                                    </div>

                                    {/* New Price */}
                                    <div className={`p-3 rounded-xl border flex flex-col justify-center ${pendingModification.isSL ? 'border-red-500/30 bg-red-50/80 dark:bg-red-950/20' : 'border-cyan-500/30 bg-cyan-50/80 dark:bg-cyan-950/20'}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400 uppercase tracking-wider">New Target</span>
                                            {(() => {
                                                const diff = pendingModification.newPrice - pendingModification.originalPrice;
                                                const pct = (diff / pendingModification.originalPrice) * 100;
                                                const isPositive = diff >= 0;
                                                return (
                                                    <span className={`text-[10px] font-mono font-semibold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                                        {isPositive ? '+' : ''}{pct.toFixed(2)}%
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                        <span className={`font-mono text-base font-bold mt-0.5 ${pendingModification.isSL ? 'text-red-600 dark:text-red-400' : 'text-cyan-600 dark:text-cyan-400'}`}>
                                            ${pendingModification.newPrice < 1 ? pendingModification.newPrice.toFixed(6) : pendingModification.newPrice.toFixed(4)}
                                        </span>
                                    </div>
                                </div>

                                {/* Market Reference */}
                                <div className="flex items-center justify-between text-xs px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 text-gray-500 dark:text-gray-400">
                                    <span>Live Market Price</span>
                                    <span className="font-mono font-medium text-gray-800 dark:text-gray-200">
                                        ${pendingModification.livePrice < 1 ? pendingModification.livePrice.toFixed(6) : pendingModification.livePrice.toFixed(4)}
                                    </span>
                                </div>

                                {(() => {
                                    const order = pendingModification.targetOrder;
                                    if (!order.isSoftwareSL && order.mode !== 'TP') return null;
                                    const fallback = resolveEffectiveEntryContext(activePosition, openOrders, symbol);
                                    const ctx = resolveOrderEntryContext(order, fallback);
                                    if (!ctx) return null;
                                    const pnl = computeTradePnl({
                                        entryPrice: ctx.entryPrice,
                                        targetPrice: pendingModification.newPrice,
                                        amount: ctx.amount,
                                        side: ctx.side,
                                        isInverse: ctx.isInverse,
                                        contracts: ctx.contracts,
                                        contractSize: ctx.contractSize,
                                    });
                                    if (!pnl) return null;
                                    const isProfit = pnl.pnlUsd >= 0;
                                    return (
                                        <div className={`flex items-center justify-between text-xs px-3.5 py-2 rounded-xl border ${isProfit ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50/70 dark:bg-rose-950/25 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'}`}>
                                            <span>Est. P/L vs Entry (${formatDisplayPrice(ctx.entryPrice)})</span>
                                            <span className="font-mono font-bold">
                                                {formatCompactPnl(pnl.pnlUsd, pnl.pnlPct)}
                                            </span>
                                        </div>
                                    );
                                })()}

                                {/* "Don't ask again" Checkbox */}
                                <label className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300 cursor-pointer select-none pt-1">
                                    <input
                                        type="checkbox"
                                        checked={dontAskDragConfirm}
                                        onChange={(e) => {
                                            const val = e.target.checked;
                                            setDontAskDragConfirm(val);
                                            dontAskDragConfirmRef.current = val;
                                            try {
                                                localStorage.setItem('dontAskDragConfirm', String(val));
                                            } catch (e) {}
                                        }}
                                        className="w-4 h-4 rounded bg-white dark:bg-black/40 border border-gray-300 dark:border-white/20 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-cyan-500"
                                    />
                                    <span>Don't ask confirmation for drag & drop again</span>
                                </label>
                            </div>

                            {/* Modal Actions */}
                            <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-white/10">
                                <button
                                    type="button"
                                    disabled={isModifyingOrder}
                                    onClick={() => cancelOrderModification(pendingModification)}
                                    className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-300 dark:border-white/10 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white transition-all disabled:opacity-50 cursor-pointer"
                                    title="Keep order unchanged"
                                >
                                    Cancel
                                </button>
                                {selectedApiKeyId && (
                                    <button
                                        type="button"
                                        disabled={isModifyingOrder}
                                        onClick={async () => {
                                            if (!selectedApiKeyId || !pendingModification) return;
                                            const modSnap = pendingModification;
                                            const key = `order-${modSnap.orderId}`;
                                            const existingLine = wallLinesRef.current.get(key);
                                            // Instant 0ms optimistic line removal before backend/exchange round-trip
                                            if (existingLine) {
                                                try { candlestickSeriesRef.current?.removePriceLine(existingLine); } catch {}
                                                wallLinesRef.current.delete(key);
                                            }
                                            window.dispatchEvent(
                                                new CustomEvent('optimisticRemoveOpenOrder', {
                                                    detail: { orderIds: [modSnap.orderId], apiKeyId: selectedApiKeyId },
                                                })
                                            );
                                            cancelOrderModification(modSnap);
                                            setIsModifyingOrder(true);
                                            try {
                                                const res = await manualTradeService.cancelOrder(parseInt(selectedApiKeyId), modSnap.orderId, modSnap.symbol);
                                                if (Array.isArray(res?.cancelled_ids) && res.cancelled_ids.length > 0) {
                                                    window.dispatchEvent(
                                                        new CustomEvent('optimisticRemoveOpenOrder', {
                                                            detail: { orderIds: res.cancelled_ids, apiKeyId: selectedApiKeyId },
                                                        })
                                                    );
                                                }
                                                window.dispatchEvent(new CustomEvent('refreshOpenOrders'));
                                                toast.success(`🛑 Order #${modSnap.orderId} cancelled.`);
                                            } catch (err: any) {
                                                window.dispatchEvent(
                                                    new CustomEvent('rollbackRemoveOpenOrder', { detail: { orderIds: [modSnap.orderId] } })
                                                );
                                                toast.error('Failed to cancel order: ' + (err.response?.data?.detail || err.message));
                                            } finally {
                                                setIsModifyingOrder(false);
                                            }
                                        }}
                                        className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/20 dark:hover:bg-rose-500 border border-rose-200 dark:border-rose-500/40 text-rose-600 hover:text-rose-700 dark:text-rose-200 dark:hover:text-white transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1"
                                        title="Cancel this order completely from exchange"
                                    >
                                        <span>✕ Delete Order</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={isModifyingOrder}
                                    onClick={() => executeOrderModification(pendingModification)}
                                    className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-white shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${pendingModification.isSL ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-red-500/20' : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 shadow-cyan-500/20'}`}
                                >
                                    {isModifyingOrder ? (
                                        <>
                                            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span>Updating...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Confirm & Update</span>
                                            <span>✓</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <MLPredictionRenderer 
                series={candlestickSeriesRef.current} 
                predictionResult={predictionResult} 
                currentCandleTime={lastCandleRef.current?.time as any}
                onSetMarker={(marker) => {
                    mlPredictionMarkersRef.current = marker ? [marker] : [];
                    safeSetMarkers();
                }}
            />
        </div>
    );
});

// ─── Advanced L2 Order Book ───────────────────────────────────────────────────
type L2Event = {
    id: number;
    time: string;
    type: 'new_wall' | 'removed' | 'absorbed' | 'spoof';
    side: 'bid' | 'ask';
    price: number;
    size: number;
};

const getAdaptiveBuckets = (refPrice: number): number[] => {
    if (!Number.isFinite(refPrice) || refPrice <= 0) return [0, 10, 25, 50, 100, 500];
    if (refPrice >= 10000) return [0, 5, 10, 25, 50, 100];
    if (refPrice >= 500) return [0, 0.5, 1, 2.5, 5, 10];
    if (refPrice >= 10) return [0, 0.05, 0.1, 0.25, 0.5, 1];
    if (refPrice >= 1) return [0, 0.001, 0.005, 0.01, 0.05, 0.1];
    if (refPrice >= 0.01) return [0, 0.0001, 0.0005, 0.001, 0.005, 0.01];
    return [0, 0.0000001, 0.0000005, 0.000001, 0.000005];
};

// ── STEP 2: Depth Chart SVG Sub-component ─────────────────────────────────────
const DepthChart: React.FC<{
    bidPoints: { price: number; vol: number }[];
    askPoints: { price: number; vol: number }[];
    formatPrice: (p: number) => string;
    formatSize: (s: number) => string;
}> = ({ bidPoints, askPoints, formatPrice, formatSize }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<{ x: number; price: number; vol: number; side: 'bid' | 'ask' } | null>(null);
    const allPoints = [...bidPoints, ...askPoints];
    if (allPoints.length === 0) return <div className="text-gray-500 text-center pt-8 text-xs">No data</div>;
    const minPrice = Math.min(...allPoints.map(p => p.price));
    const maxPrice = Math.max(...allPoints.map(p => p.price));
    const maxVol = Math.max(...allPoints.map(p => p.vol), 1);
    const W = 100; const H = 100;
    const PAD = 2;
    const px = (price: number) => PAD + ((price - minPrice) / (maxPrice - minPrice || 1)) * (W - PAD * 2);
    const py = (vol: number) => (H - PAD) - (vol / maxVol) * (H - PAD * 2);
    const buildPath = (points: { price: number; vol: number }[]) => {
        if (points.length === 0) return '';
        let d = `M ${px(points[0].price)} ${H - PAD}`;
        points.forEach(p => { d += ` L ${px(p.price)} ${py(p.vol)}`; });
        d += ` L ${px(points[points.length - 1].price)} ${H - PAD} Z`;
        return d;
    };
    const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const price = minPrice + relX * (maxPrice - minPrice);
        let closest: { price: number; vol: number; side: 'bid' | 'ask' } | null = null;
        let minDist = Infinity;
        bidPoints.forEach(p => { const d = Math.abs(p.price - price); if (d < minDist) { minDist = d; closest = { ...p, side: 'bid' }; } });
        askPoints.forEach(p => { const d = Math.abs(p.price - price); if (d < minDist) { minDist = d; closest = { ...p, side: 'ask' }; } });
        setHover(closest ? { x: relX * 100, ...closest } : null);
    };
    return (
        <div className="relative w-full h-full">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none"
                onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
                <defs>
                    <linearGradient id="bidGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0.05" />
                    </linearGradient>
                    <linearGradient id="askGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
                    </linearGradient>
                </defs>
                <path d={buildPath(bidPoints)} fill="url(#bidGrad)" stroke="#22c55e" strokeWidth="0.5" />
                <path d={buildPath(askPoints)} fill="url(#askGrad)" stroke="#ef4444" strokeWidth="0.5" />
                {hover && <line x1={hover.x} y1="0" x2={hover.x} y2={H} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" strokeDasharray="2,2" />}
            </svg>
            {hover && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/80 border border-white/10 rounded px-2 py-1 text-[9px] font-mono pointer-events-none z-10 whitespace-nowrap">
                    <span className={hover.side === 'bid' ? 'text-green-400' : 'text-red-400'}>{hover.side.toUpperCase()}</span>
                    <span className="text-gray-300 ml-1">@ {formatPrice(hover.price)}</span>
                    <span className="text-white ml-1">Vol: {formatSize(hover.vol)}</span>
                </div>
            )}
        </div>
    );
};

const OrderBook: React.FC<{
    bids: any[];
    asks: any[];
    maxTotal: number;
    volumeThreshold: number;
    onPriceSelect?: (price: number, side?: 'buy' | 'sell') => void;
}> = ({ bids, asks, maxTotal, volumeThreshold, onPriceSelect }) => {
    const [view, setView] = useState<'book' | 'depth'>('book');
    const [bucket, setBucket] = useState<number>(0);
    const [events, setEvents] = useState<L2Event[]>([]);
    const prevBidsRef = useRef<Map<number, number>>(new Map());
    const prevAsksRef = useRef<Map<number, number>>(new Map());
    const wallTimestampsRef = useRef<Map<string, number>>(new Map());
    const eventIdRef = useRef(0);

    const isEmpty = bids.length === 0 && asks.length === 0;

    const refMidPrice = useMemo(() => {
        const b = bids.length > 0 ? Number(bids[0]?.price || 0) : 0;
        const a = asks.length > 0 ? Number(asks[0]?.price || 0) : 0;
        return b > 0 && a > 0 ? (b + a) / 2 : b || a || 0;
    }, [bids, asks]);

    const bucketOptions = useMemo(() => getAdaptiveBuckets(refMidPrice), [refMidPrice]);

    useEffect(() => {
        if (bucket !== 0 && !bucketOptions.includes(bucket)) {
            setBucket(0);
        }
    }, [bucket, bucketOptions]);

    const formatPrice = (price: number) => {
        if (price < 0.000001) return price.toFixed(12);
        if (price < 0.00001) return price.toFixed(10);
        if (price < 0.0001) return price.toFixed(8);
        if (price < 0.001) return price.toFixed(6);
        if (price < 1) return price.toFixed(5);
        if (price < 10) return price.toFixed(4);
        return price.toFixed(2);
    };
    const formatSize = (s: number) => {
        if (s >= 1_000_000_000) return (s / 1_000_000_000).toFixed(2) + 'B';
        if (s >= 1_000_000) return (s / 1_000_000).toFixed(2) + 'M';
        if (s >= 1_000) return (s / 1_000).toFixed(2) + 'k';
        return s.toFixed(2);
    };
    const nowStr = () => new Date().toLocaleTimeString('en-US', { hour12: false });
    const addEvent = (ev: Omit<L2Event, 'id' | 'time'>) =>
        setEvents(prev => [{ ...ev, id: ++eventIdRef.current, time: nowStr() }, ...prev].slice(0, 60));

    // ── STEP 3 + 4 + 5: Absorption, Spoof, Event Detection ───────────────────
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (bids.length === 0 && asks.length === 0) {
            // Reset stateful tracking cleanly on symbol switch / empty book so zero phantom spoof alerts fire
            prevBidsRef.current.clear();
            prevAsksRef.current.clear();
            wallTimestampsRef.current.clear();
            setEvents([]);
            return;
        }
        const sigSize = volumeThreshold > 0 ? volumeThreshold : maxTotal * 0.05;
        const nowMs = Date.now();
        const curBids = new Map<number, number>(bids.map((b: any) => [b.price, b.size * b.price]));
        const curAsks = new Map<number, number>(asks.map((a: any) => [a.price, a.size * a.price]));

        // New large walls appeared (or existing orders sized up into walls)
        curBids.forEach((qv, price) => {
            const key = `bid-${price}`;
            const prevQv = prevBidsRef.current.get(price) || 0;
            if (qv >= sigSize && prevQv < sigSize) {
                wallTimestampsRef.current.set(key, nowMs);
                addEvent({ type: 'new_wall', side: 'bid', price, size: qv });
            }
        });
        curAsks.forEach((qv, price) => {
            const key = `ask-${price}`;
            const prevQv = prevAsksRef.current.get(price) || 0;
            if (qv >= sigSize && prevQv < sigSize) {
                wallTimestampsRef.current.set(key, nowMs);
                addEvent({ type: 'new_wall', side: 'ask', price, size: qv });
            }
        });

        // Walls that disappeared → spoof or removed
        const minBidPrice = bids.length > 0 ? bids[bids.length - 1].price : 0;
        const maxAskPrice = asks.length > 0 ? asks[asks.length - 1].price : Infinity;

        prevBidsRef.current.forEach((qv, price) => {
            const key = `bid-${price}`;
            if (qv >= sigSize && !curBids.has(price)) {
                if (price < minBidPrice) {
                    wallTimestampsRef.current.delete(key);
                    return; // Silently drop, just fell out of depth scope
                }
                const elapsed = nowMs - (wallTimestampsRef.current.get(key) ?? 0);
                wallTimestampsRef.current.delete(key);
                addEvent({ type: elapsed < 6000 ? 'spoof' : 'removed', side: 'bid', price, size: qv });
            }
        });
        prevAsksRef.current.forEach((qv, price) => {
            const key = `ask-${price}`;
            if (qv >= sigSize && !curAsks.has(price)) {
                if (price > maxAskPrice) {
                    wallTimestampsRef.current.delete(key);
                    return; // Silently drop, fell out of depth scope
                }
                const elapsed = nowMs - (wallTimestampsRef.current.get(key) ?? 0);
                wallTimestampsRef.current.delete(key);
                addEvent({ type: elapsed < 6000 ? 'spoof' : 'removed', side: 'ask', price, size: qv });
            }
        });

        // Absorption: existing wall lost ≥50% size without disappearing completely
        prevBidsRef.current.forEach((prevQv, price) => {
            const curQv = curBids.get(price);
            if (prevQv >= sigSize && curQv !== undefined && curQv < prevQv * 0.5)
                addEvent({ type: 'absorbed', side: 'bid', price, size: prevQv - curQv });
        });
        prevAsksRef.current.forEach((prevQv, price) => {
            const curQv = curAsks.get(price);
            if (prevQv >= sigSize && curQv !== undefined && curQv < prevQv * 0.5)
                addEvent({ type: 'absorbed', side: 'ask', price, size: prevQv - curQv });
        });

        prevBidsRef.current = curBids;
        prevAsksRef.current = curAsks;
    }, [bids, asks, maxTotal, volumeThreshold]);

    // ── STEP 1: Imbalance ─────────────────────────────────────────────────────
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const imbalance = useMemo(() => {
        const bidPow = bids.reduce((s: number, b: any) => s + b.size * b.price, 0);
        const askPow = asks.reduce((s: number, a: any) => s + a.size * a.price, 0);
        const total = bidPow + askPow;
        return total === 0 ? 0.5 : bidPow / total;
    }, [bids, asks]);
    const imbalancePct = Math.round(imbalance * 100);
    const imbalanceColor = imbalance > 0.6 ? '#22c55e' : imbalance < 0.4 ? '#ef4444' : '#f59e0b';
    const imbalanceLabel = imbalance > 0.65 ? 'Strong Buy' : imbalance < 0.35 ? 'Strong Sell' : imbalance > 0.55 ? 'Buy Bias' : imbalance < 0.45 ? 'Sell Bias' : 'Balanced';

    // ── STEP 6: Price Bucket Grouping ─────────────────────────────────────────
    const isOrderBookThermalGuard = isThermalGuardActive();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { displayBids, displayAsks, displayMax } = useMemo(() => {
        const rowCap = isOrderBookThermalGuard ? 20 : 60;
        if (bucket === 0) {
            return {
                displayBids: bids.slice(0, rowCap),
                displayAsks: asks.slice(0, rowCap),
                displayMax: maxTotal,
            };
        }
        const group = (levels: any[], side: 'bid' | 'ask') => {
            const map = new Map<number, { price: number; size: number; total: number }>();
            levels.forEach((l: any) => {
                const key = side === 'bid' ? Math.floor(l.price / bucket) * bucket : Math.ceil(l.price / bucket) * bucket;
                const ex = map.get(key);
                if (ex) ex.size += l.size;
                else map.set(key, { price: key, size: l.size, total: 0 });
            });
            const arr = Array.from(map.values()).sort((a, b) => side === 'bid' ? b.price - a.price : a.price - b.price);
            let cum = 0; arr.forEach(l => { cum += l.size; l.total = cum; });
            return arr.slice(0, rowCap);
        };
        const gb = group(bids, 'bid');
        const ga = group(asks, 'ask');
        const mxB = gb.length ? gb[gb.length - 1].total : 0;
        const mxA = ga.length ? ga[ga.length - 1].total : 0;
        return { displayBids: gb, displayAsks: ga, displayMax: Math.max(mxB, mxA, 1) };
    }, [bids, asks, bucket, maxTotal, isOrderBookThermalGuard]);

    // ── STEP 2: Depth Chart data ──────────────────────────────────────────────
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const depthData = useMemo(() => {
        const bidLevels = [...bids].sort((a: any, b: any) => b.price - a.price);
        const askLevels = [...asks].sort((a: any, b: any) => a.price - b.price);
        let c = 0;
        const bidPoints = bidLevels.map((b: any) => { c += b.size; return { price: b.price, vol: c }; }).reverse();
        c = 0;
        const askPoints = askLevels.map((a: any) => { c += a.size; return { price: a.price, vol: c }; });
        return { bidPoints, askPoints };
    }, [bids, asks]);

    const sigSize = volumeThreshold > 0 ? volumeThreshold : maxTotal * 0.05;
    const eventCfg: Record<L2Event['type'], { icon: string; color: string; label: string }> = {
        new_wall: { icon: '🟢', color: '#22c55e', label: 'NEW WALL' },
        removed: { icon: '🔴', color: '#ef4444', label: 'REMOVED ' },
        absorbed: { icon: '⚡', color: '#f59e0b', label: 'ABSORBED' },
        spoof: { icon: '⚠️', color: '#a855f7', label: 'SPOOF?  ' },
    };

    const bestBidPrice = useMemo(
        () => (bids.length > 0 ? Math.max(...bids.map((b: any) => Number(b.price || 0))) : 0),
        [bids]
    );
    const bestAskPrice = useMemo(
        () => (asks.length > 0 ? Math.min(...asks.map((a: any) => Number(a.price || 0))) : 0),
        [asks]
    );
    const spreadInfo = useMemo(() => {
        if (bestBidPrice <= 0 || bestAskPrice <= 0) return null;
        const raw = Math.max(0, bestAskPrice - bestBidPrice);
        const bps = (raw / bestBidPrice) * 10000;
        return { raw, bps };
    }, [bestBidPrice, bestAskPrice]);

    return (
        <div className="flex flex-col h-full font-mono text-[11px] select-none overflow-hidden text-slate-800 dark:text-slate-100">
            {isEmpty ? (
                <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-gray-400 text-xs">Loading Level-2 order book...</div>
            ) : (<>
                {/* ── STEP 1: Imbalance Gauge ─────────────────────────────────── */}
                <div className="px-2.5 pt-2 pb-1.5 flex-shrink-0 border-b border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02]">
                    <div className="flex justify-between items-center mb-1">
                        <span className="text-[9.5px] uppercase tracking-widest font-black" style={{ color: imbalanceColor }}>{imbalanceLabel}</span>
                        <span className="text-[9.5px] text-slate-500 dark:text-gray-400 tabular-nums font-bold">{imbalancePct}% Bid · {100 - imbalancePct}% Ask</span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-rose-500/35 overflow-hidden">
                        <div className={`absolute left-0 top-0 h-full rounded-full ${isOrderBookThermalGuard ? '' : 'transition-all duration-300'}`}
                            style={{ width: `${imbalancePct}%`, background: `linear-gradient(90deg, #22c55e, ${imbalanceColor})` }} />
                        <div className="absolute left-1/2 top-0 h-full w-px bg-white/40" />
                    </div>
                    <div className="flex justify-between text-[8.5px] text-slate-500 dark:text-gray-400 mt-0.5 font-semibold">
                        <span>Bids Dominance</span>
                        <span className="text-cyan-600 dark:text-cyan-400">Click row to snap price</span>
                        <span>Asks Dominance</span>
                    </div>
                </div>

                {/* ── Toolbar ────────────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-200 dark:border-white/10 flex-shrink-0 gap-1">
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 text-[9px]">
                        {(['book', 'depth'] as const).map(v => (
                            <button key={v} type="button" onClick={() => setView(v)}
                                className={`px-2 py-0.5 uppercase tracking-wider font-black transition-all cursor-pointer ${view === v ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{v}
                            </button>
                        ))}
                    </div>
                    {view === 'book' && (
                        <div className="flex items-center gap-0.5 flex-wrap justify-end">
                            <span className="text-[8.5px] text-slate-500 dark:text-gray-400 mr-0.5 font-bold">Grp</span>
                            {bucketOptions.map(b => (
                                <button key={b} type="button" onClick={() => setBucket(b)}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-black transition-all cursor-pointer ${bucket === b ? 'bg-cyan-500 text-slate-950' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>
                                    {b === 0 ? 'Tick' : b}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── STEP 2: Depth Chart ──────────────────────────────────────── */}
                {view === 'depth' ? (
                    <div className="flex-1 p-2 overflow-hidden">
                        <DepthChart bidPoints={depthData.bidPoints} askPoints={depthData.askPoints} formatPrice={formatPrice} formatSize={formatSize} />
                    </div>
                ) : (
                    <>
                        {/* Column headers */}
                        <div className="flex text-slate-500 dark:text-gray-400 py-1 px-2.5 uppercase tracking-wider font-bold flex-shrink-0 text-[9px] border-b border-slate-200 dark:border-white/10">
                            <div className="w-2/5 text-left">Price (USD)</div>
                            <div className="w-[30%] text-right">Size</div>
                            <div className="w-[30%] text-right">Cum. Total</div>
                        </div>

                        {/* Asks */}
                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col-reverse">
                            {displayAsks.map((ask: any, i: number) => {
                                const isWall = ask.size * ask.price >= sigSize;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onPriceSelect?.(ask.price, 'sell')}
                                        title={`Click to snap Manual Trade to Ask @ $${formatPrice(ask.price)}`}
                                        className={`flex items-center px-2.5 py-[2px] leading-tight relative hover:bg-rose-500/10 cursor-pointer shrink-0 transition-colors ${isWall ? 'ring-1 ring-inset ring-rose-500/40 bg-rose-500/5' : ''}`}
                                    >
                                        <div className={`absolute right-0 top-0 h-full bg-rose-500/15 dark:bg-rose-500/20 ${isOrderBookThermalGuard ? '' : 'transition-all duration-300'} pointer-events-none`}
                                            style={{ width: `${Math.min(100, (ask.total / displayMax) * 100)}%` }} />
                                        <div className={`w-2/5 text-left relative z-10 font-bold flex items-center gap-1 ${isWall ? 'text-rose-600 dark:text-rose-300' : 'text-rose-600/85 dark:text-rose-400/90'}`}>
                                            <span>{formatPrice(ask.price)}</span>
                                            {isWall && (
                                                <span className="px-1 py-0.1 rounded bg-rose-500/20 border border-rose-500/40 text-[7.5px] font-black uppercase text-rose-500 dark:text-rose-300">
                                                    WALL
                                                </span>
                                            )}
                                        </div>
                                        <div className={`w-[30%] text-right relative z-10 ${isWall ? 'text-slate-900 dark:text-white font-black' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {formatSize(ask.size)}
                                        </div>
                                        <div className="w-[30%] text-right text-slate-500 dark:text-slate-400 relative z-10">
                                            {formatSize(ask.total)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Spread & Mid Price Bar */}
                        <div className="flex-shrink-0 px-2.5 py-1.5 border-y border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-[#050811]">
                            <div className="flex items-center justify-between text-[10px]">
                                <span className="text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                                    Spread
                                </span>
                                {spreadInfo ? (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-cyan-600 dark:text-cyan-400 font-black">
                                            ${formatPrice(spreadInfo.raw)}
                                        </span>
                                        <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 text-[9px] font-black">
                                            {spreadInfo.bps.toFixed(1)} bps
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-slate-400">--</span>
                                )}
                            </div>
                        </div>

                        {/* Bids */}
                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                            {displayBids.map((bid: any, i: number) => {
                                const isWall = bid.size * bid.price >= sigSize;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => onPriceSelect?.(bid.price, 'buy')}
                                        title={`Click to snap Manual Trade to Bid @ $${formatPrice(bid.price)}`}
                                        className={`flex items-center px-2.5 py-[2px] leading-tight relative hover:bg-emerald-500/10 cursor-pointer transition-colors ${isWall ? 'ring-1 ring-inset ring-emerald-500/40 bg-emerald-500/5' : ''}`}
                                    >
                                        <div className={`absolute right-0 top-0 h-full bg-emerald-500/15 dark:bg-emerald-500/20 ${isOrderBookThermalGuard ? '' : 'transition-all duration-300'} pointer-events-none`}
                                            style={{ width: `${Math.min(100, (bid.total / displayMax) * 100)}%` }} />
                                        <div className={`w-2/5 text-left relative z-10 font-bold flex items-center gap-1 ${isWall ? 'text-emerald-600 dark:text-emerald-300' : 'text-emerald-600/85 dark:text-emerald-400/90'}`}>
                                            <span>{formatPrice(bid.price)}</span>
                                            {isWall && (
                                                <span className="px-1 py-0.1 rounded bg-emerald-500/20 border border-emerald-500/40 text-[7.5px] font-black uppercase text-emerald-600 dark:text-emerald-300">
                                                    WALL
                                                </span>
                                            )}
                                        </div>
                                        <div className={`w-[30%] text-right relative z-10 ${isWall ? 'text-slate-900 dark:text-white font-black' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {formatSize(bid.size)}
                                        </div>
                                        <div className="w-[30%] text-right text-slate-500 dark:text-slate-400 relative z-10">
                                            {formatSize(bid.total)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* ── STEP 5: Activity Feed / Event Log ───────────────────────── */}
                <div className="flex-shrink-0 border-t border-slate-200 dark:border-white/10 mt-1">
                    <div className="flex items-center justify-between px-3 py-1 bg-slate-100 dark:bg-[#050811]">
                        <span className="text-[10px] uppercase tracking-widest text-slate-600 dark:text-gray-300 font-black flex items-center gap-1.5">
                            <span>⚡ Whale & Spoof Tape</span>
                            {events.length > 0 && (
                                <span className="px-1.5 py-0.1 rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 text-[9px]">
                                    {events.length}
                                </span>
                            )}
                        </span>
                        {events.length > 0 && (
                            <button type="button" onClick={() => setEvents([])} className="text-[9px] text-slate-500 hover:text-rose-500 transition-colors uppercase font-bold tracking-wider cursor-pointer">clear</button>
                        )}
                    </div>
                    <div className="h-[68px] overflow-y-auto custom-scrollbar">
                        {events.length === 0 ? (
                            <div className="text-center text-[10px] text-slate-500 dark:text-gray-500 py-6">Monitoring L2 depth for Whale Walls, Absorption & Spoofing...</div>
                        ) : events.map(ev => {
                            const cfg = eventCfg[ev.type];
                            return (
                                <div
                                    key={ev.id}
                                    onClick={() => onPriceSelect?.(ev.price, ev.side === 'bid' ? 'buy' : 'sell')}
                                    title={`Click to snap Manual Trade to ${cfg.label.trim()} @ $${formatPrice(ev.price)}`}
                                    className="flex items-center gap-2 px-3 py-1 hover:bg-cyan-500/10 border-b border-slate-200/60 dark:border-white/5 last:border-0 transition-colors cursor-pointer"
                                >
                                    <span className="text-[9px] text-slate-500 dark:text-gray-400 tabular-nums w-[54px] flex-shrink-0 font-medium">{ev.time}</span>
                                    <span className="text-[10px] font-bold flex-shrink-0" style={{ color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                                    <span className={`text-[10px] font-black flex-shrink-0 ${ev.side === 'bid' ? 'text-emerald-500' : 'text-rose-500'}`}>{ev.side.toUpperCase()}</span>
                                    <span className="text-[10px] text-slate-700 dark:text-gray-200 truncate font-mono tracking-wide">${formatSize(ev.size)} <span className="text-slate-400 text-[9px] mx-0.5">@</span> ${formatPrice(ev.price)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </>)}
        </div>
    );
};


interface ChartConfig {
    id: string;
    symbol: string;
    exchange: string;
    interval: string;
}

const EXTRA_CHART_SLOTS = ['chart-2', 'chart-3', 'chart-4'] as const;

const OrderFlowChartPanel = React.memo<{
    config: ChartConfig;
    isMain: boolean;
    isActive?: boolean;
    chartLabel?: string;
    chartSlotIndex?: number;
    onSelectActive?: (id: string) => void;
    onPriceChange?: (id: string, price: number) => void;
    allChartsCount?: number;
    onUpdate: (id: string, updates: Partial<ChartConfig>) => void;
    onRemove: (id: string) => void;
    showFootprint: boolean;
    showCVD: boolean;
    showVPVR: boolean;
    indicatorSettings: IndicatorSettings;
    onIndicatorSettingsChange: (id: string, settings: IndicatorSettings) => void;
    onResetIndicators?: (id: string) => void;
    advancedMetrics: any;
    selectedApiKeyId: string | null;
    predictionResult: any;
    activeMLModelId: string | null;
    setExternalAIPrice: (price: number) => void;
    setExternalAIOpenTrigger: (trigger: number) => void;
    onManualTradeClick: (id: string, symbol: string, price: number) => void;
    setManualTradeTrigger: (trigger: number) => void;
    volumeThreshold: number;
    volumeMode: string;
    parentL2Data?: any;
    parentBotId?: number | null;
    parentBotStatus?: any;
    parentSymbol?: string;
    parentOpenOrders?: OpenLimitOrder[];
    parentPosition?: FastPositionResponse | null;
    showCrosshairAIPredict?: boolean;
    showLastPriceLine?: boolean;
    showBidAsk?: boolean;
    showMarkPrice?: boolean;
    renderFloatingTools?: React.ReactNode;
    onFullscreenChange?: (isFullscreen: boolean) => void;
    onWallsChange?: (chartId: string, walls: OrderbookWall[]) => void;
}>(({ 
    config, 
    isMain, 
    isActive = false,
    chartLabel,
    chartSlotIndex = 0,
    onSelectActive, 
    onPriceChange, 
    allChartsCount = 1, 
    onUpdate, 
    onRemove, 
    showFootprint, 
    showCVD, 
    showVPVR, 
    indicatorSettings,
    onIndicatorSettingsChange,
    onResetIndicators,
    advancedMetrics, 
    selectedApiKeyId, 
    predictionResult, 
    activeMLModelId, 
    setExternalAIPrice, 
    setExternalAIOpenTrigger, 
    onManualTradeClick, 
    setManualTradeTrigger, 
    volumeThreshold, 
    volumeMode, 
    parentL2Data,
    parentBotId,
    parentBotStatus,
    parentSymbol,
    parentOpenOrders,
    parentPosition,
    showCrosshairAIPredict = false,
    showLastPriceLine = true,
    showBidAsk = false,
    showMarkPrice = true,
    renderFloatingTools,
    onFullscreenChange,
    onWallsChange
}) => {
    const [isFullscreen, setIsFullscreen] = useState(false);

    const handleToggleFullscreen = useCallback((e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setIsFullscreen(prev => {
            const next = !prev;
            onFullscreenChange?.(next);
            return next;
        });
    }, [onFullscreenChange]);

    useEffect(() => {
        if (!isFullscreen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsFullscreen(false);
                onFullscreenChange?.(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen, onFullscreenChange]);
    const [isTradingViewMode, setIsTradingViewMode] = useState(false);
    const [isWallHunterOpen, setIsWallHunterOpen] = useState(false);
    const [isForexWallHunterOpen, setIsForexWallHunterOpen] = useState(false);
    const activeWallHunterId = useBotStore(state => state.activeWallHunterId);
    const setActiveWallHunterId = useBotStore(state => state.setActiveWallHunterId);
    const setBotForChart = useBotStore(state => state.setBotForChart);
    const removeBotForChart = useBotStore(state => state.removeBotForChart);
    const activeBotsByChartId = useBotStore(state => state.activeBotsByChartId);
    const setPendingUtBotSync = useBotStore(state => state.setPendingUtBotSync);

    const panelDeviceProfile = useDeviceProfile();
    const chartBotId = activeBotsByChartId[config.id] || null;
    const usingParentBotStatus = Boolean(chartBotId && parentBotId && chartBotId === parentBotId && parentBotStatus !== undefined);
    const { statusData: ownBotStatus } = useWallHunterStatus(chartBotId, !usingParentBotStatus);
    const botStatus = usingParentBotStatus ? parentBotStatus : ownBotStatus;
    
    const isShared = isMain && !!parentL2Data;
    const fallbackL2 = useLevel2MarketData(isShared ? '' : config.symbol, isShared ? '' : config.exchange);
    const { bids, asks, walls, currentPrice, bestBid: liveBestBid, bestAsk: liveBestAsk, tradeEvent } = isShared ? parentL2Data : fallbackL2;
    const bestBid = useMemo(() => {
        if (panelDeviceProfile.isThermalGuardActive && !showBidAsk) return 0;
        if (liveBestBid && liveBestBid > 0) return liveBestBid;
        return bids && bids.length ? Math.max(...bids.map((b: any) => b.price)) : 0;
    }, [liveBestBid, bids, panelDeviceProfile.isThermalGuardActive, showBidAsk]);
    const bestAsk = useMemo(() => {
        if (panelDeviceProfile.isThermalGuardActive && !showBidAsk) return 0;
        if (liveBestAsk && liveBestAsk > 0) return liveBestAsk;
        return asks && asks.length ? Math.min(...asks.map((a: any) => a.price)) : 0;
    }, [liveBestAsk, asks, panelDeviceProfile.isThermalGuardActive, showBidAsk]);
    const advancedMetricsData = useAdvancedMetrics(config.symbol, config.exchange, config.interval, advancedMetrics);
    const usingParentOpenOrders = Boolean(parentOpenOrders && parentSymbol && config.symbol === parentSymbol);
    const ownOpenOrders = useOpenOrders(selectedApiKeyId, config.symbol, panelDeviceProfile.timings.openOrdersPollMs, !usingParentOpenOrders);
    const openOrders = usingParentOpenOrders ? parentOpenOrders! : ownOpenOrders;
    const usingParentPosition = Boolean(parentPosition !== undefined && parentSymbol && config.symbol === parentSymbol);
    const ownActivePosition = useActivePosition(selectedApiKeyId, config.symbol, panelDeviceProfile.timings.openOrdersPollMs, !usingParentPosition);
    const activePosition = usingParentPosition ? (parentPosition ?? null) : ownActivePosition;

    // Report live currentPrice back up to parent ONLY for secondary split charts (!isMain)
    // so main chart ticks never trigger a duplicate setChartPrices re-render in parent.
    useEffect(() => {
        if (!isMain && currentPrice && currentPrice > 0 && onPriceChange) {
            onPriceChange(config.id, currentPrice);
        }
    }, [isMain, config.id, currentPrice, onPriceChange]);

    const filteredWalls = useMemo(() => {
        if (volumeThreshold <= 0) return walls;
        const newWalls: { price: number; type: 'buy' | 'sell'; size: number }[] = [];
        asks.forEach(ask => {
            const comparisonValue = volumeMode === 'quote' ? ask.size * ask.price : ask.size;
            if (comparisonValue >= volumeThreshold) {
                newWalls.push({ price: ask.price, type: 'sell', size: ask.size });
            }
        });
        bids.forEach(bid => {
            const comparisonValue = volumeMode === 'quote' ? bid.size * bid.price : bid.size;
            if (comparisonValue >= volumeThreshold) {
                newWalls.push({ price: bid.price, type: 'buy', size: bid.size });
            }
        });
        return newWalls;
    }, [walls, bids, asks, volumeThreshold, volumeMode]);

    useEffect(() => {
        onWallsChange?.(config.id, filteredWalls);
    }, [config.id, filteredWalls, onWallsChange]);

    const handlePanelIndicatorChange = useCallback((nextSettings: IndicatorSettings) => {
        onIndicatorSettingsChange(config.id, nextSettings);
    }, [onIndicatorSettingsChange, config.id]);

    const handlePanelResetIndicators = useCallback(() => {
        onResetIndicators?.(config.id);
    }, [onResetIndicators, config.id]);

    const handleAIPredictClick = useCallback((price: number) => {
        setExternalAIPrice(price);
        setExternalAIOpenTrigger(Date.now());
    }, [setExternalAIPrice, setExternalAIOpenTrigger]);

    const handleChartBackgroundClick = useCallback((price: number) => {
        onManualTradeClick(config.id, config.symbol, price);
        setManualTradeTrigger(Date.now());
    }, [onManualTradeClick, config.id, config.symbol, setManualTradeTrigger]);

    const panelContent = (
        <div 
            className={isFullscreen 
                ? 'fixed inset-0 z-[99999] flex flex-col bg-[#050811] p-2 md:p-4 overflow-hidden w-screen h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)]' 
                : `h-full w-full bg-white dark:bg-[#070b14] rounded-2xl border ${panelDeviceProfile.isThermalGuardActive ? '' : 'transition-all duration-200'} overflow-hidden shadow-sm dark:shadow-[0_8px_28px_rgba(0,0,0,0.45)] flex flex-col ${panelDeviceProfile.isPhoneMobileUI ? 'min-h-[380px]' : 'min-h-[240px]'} ${
                    isActive && allChartsCount > 1 
                        ? 'border-cyan-500/75 ring-1 ring-cyan-500/25' 
                        : 'border-slate-200 dark:border-white/10'
                }`
            }
        >
            <div className={`cosmo-heatmap-panel-bar ${panelDeviceProfile.isPhoneMobileUI ? 'px-2 py-1.5 gap-1.5' : 'px-3 py-1.5 gap-2'} border-b border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#050811] flex justify-between items-center`}>
                <div className={`flex ${panelDeviceProfile.isPhoneMobileUI ? 'flex-nowrap overflow-x-auto hide-scrollbar gap-1.5' : 'flex-wrap items-center gap-1.5'} items-center min-w-0`}>
                    {allChartsCount > 1 && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelectActive?.(config.id);
                            }}
                            className={`px-2 py-1 text-[10px] font-mono font-black uppercase rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                                isActive 
                                    ? 'bg-cyan-500 text-slate-950' 
                                    : 'bg-slate-200/70 dark:bg-white/5 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-white/10'
                            }`}
                            title={isActive ? 'Active Trading Chart' : 'Click to select as Active Trading Chart'}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-slate-950' : 'bg-gray-400'}`} />
                            <span>{chartLabel || (isMain ? 'Main' : 'Select')}</span>
                        </button>
                    )}
                    {!isMain && (
                        <>
                            <HeatmapSymbolSelector compact symbol={config.symbol} exchange={config.exchange} onSymbolChange={(s) => onUpdate(config.id, { symbol: s })} onExchangeChange={(e) => onUpdate(config.id, { exchange: e })} />
                            <TimeframeSelector compact interval={config.interval} onIntervalChange={(i) => onUpdate(config.id, { interval: i })} />
                        </>
                    )}

                    {(!isMain || allChartsCount > 1 || isFullscreen) && (
                        <IndicatorSelector
                            compact
                            usePortal
                            chartLabel={chartLabel || (isMain ? 'Main' : 'Chart')}
                            settings={indicatorSettings}
                            onSettingsChange={handlePanelIndicatorChange}
                            onResetAll={onResetIndicators ? handlePanelResetIndicators : undefined}
                        />
                    )}
                    
                    <div className="flex bg-slate-200/70 dark:bg-[#0b101d] p-0.5 rounded-lg border border-slate-200 dark:border-white/10">
                        <button 
                            type="button"
                            onClick={() => setIsTradingViewMode(false)} 
                            className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md transition-colors cursor-pointer ${!isTradingViewMode ? 'bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            ⚡ L2 OrderFlow
                        </button>
                        <button 
                            type="button"
                            onClick={() => setIsTradingViewMode(true)} 
                            className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-md transition-colors flex items-center gap-1 cursor-pointer ${isTradingViewMode ? 'bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}
                        >
                            📈 TradingView
                        </button>
                    </div>

                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[10px] font-mono font-bold">
                        <span>🧱 {filteredWalls.length} Whale {filteredWalls.length === 1 ? 'Wall' : 'Walls'}</span>
                    </span>
                    
                    {chartBotId ? (
                        <button 
                            type="button"
                            onClick={async () => {
                                try {
                                    await botService.controlBot(chartBotId, 'stop');
                                    removeBotForChart(config.id);
                                    if (activeWallHunterId === chartBotId) {
                                        setActiveWallHunterId(null);
                                    }
                                } catch (err) {
                                    console.error("Failed to stop bot from chart panel", err);
                                }
                            }}
                            className="px-2.5 py-1 text-[10px] font-mono font-bold rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-500 hover:text-white border border-rose-500/30 flex items-center gap-1 transition-colors cursor-pointer"
                            title="Stop WallHunter Bot"
                        >
                            <X className="w-3 h-3" />
                            <span>Stop Bot #{chartBotId}</span>
                        </button>
                    ) : (
                        <div className="flex gap-1">
                            <button 
                                type="button"
                                onClick={() => setIsWallHunterOpen(true)}
                                className="px-2.5 py-1 text-[10px] font-mono font-bold rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-slate-950 border border-amber-500/35 flex items-center gap-1 transition-colors cursor-pointer"
                                title="Deploy L2 WallHunter Bot for this pair"
                            >
                                <Zap className="w-3 h-3 fill-current" />
                                <span>Deploy WallBot</span>
                            </button>
                            <button 
                                type="button"
                                onClick={() => setIsForexWallHunterOpen(true)}
                                className="px-2 py-1 text-[10px] font-mono font-bold rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 border border-emerald-500/35 flex items-center gap-1 transition-colors cursor-pointer"
                                title="Deploy Forex WallHunter for this pair"
                            >
                                <span>Forex Bot</span>
                            </button>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <button 
                        type="button"
                        onClick={handleToggleFullscreen}
                        className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors flex items-center gap-1 cursor-pointer ${isFullscreen ? 'bg-cyan-500 text-slate-950' : 'bg-slate-200/70 dark:bg-white/5 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white'}`}
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Chart"}
                    >
                        {isFullscreen ? (
                            <>
                                <X className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Exit</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                </svg>
                                <span className="hidden sm:inline">Expand</span>
                            </>
                        )}
                    </button>
                    {!isMain && (
                        <button type="button" onClick={() => onRemove(config.id)} className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer" title="Close Split Chart">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex-1 relative min-h-0 bg-white dark:bg-[#000000]">
                {isTradingViewMode ? (
                    <TradingViewWidget symbol={config.symbol} interval={config.interval} exchange={config.exchange} />
                ) : (
                    <OrderFlowChart 
                        chartId={config.id}
                        exchange={config.exchange} symbol={config.symbol} interval={config.interval} walls={filteredWalls} bids={bids} asks={asks} currentPrice={currentPrice} showFootprint={showFootprint} showCVD={showCVD} showVPVR={showVPVR} indicatorSettings={indicatorSettings} tradeEvent={tradeEvent} botStatus={botStatus} openOrders={openOrders} activePosition={activePosition} advancedMetrics={advancedMetrics} advancedMetricsData={advancedMetricsData} selectedApiKeyId={selectedApiKeyId} predictionResult={predictionResult} activeMLModelId={activeMLModelId} showCrosshairAIPredict={showCrosshairAIPredict} bestBid={bestBid} bestAsk={bestAsk} showLastPriceLine={showLastPriceLine} showBidAsk={showBidAsk} showMarkPrice={showMarkPrice}
                        isActiveChart={isActive || allChartsCount === 1}
                        totalChartsCount={allChartsCount}
                        chartSlotIndex={chartSlotIndex}
                        onAIPredictClick={handleAIPredictClick}
                        onChartBackgroundClick={handleChartBackgroundClick}
                        onToggleUTBotAlerts={() => handlePanelIndicatorChange({ ...indicatorSettings, utBotEnableAlerts: !indicatorSettings.utBotEnableAlerts })}
                        onSyncUTBotToBot={() => {
                            setPendingUtBotSync({
                                symbol: config.symbol,
                                timeframe: config.interval,
                                sensitivity: indicatorSettings.utBotSensitivity,
                                atrPeriod: indicatorSettings.utBotAtrPeriod,
                                useHeikinAshi: indicatorSettings.utBotUseHeikinAshi,
                                candleClose: indicatorSettings.utBotCandleClose,
                                retestSnipe: indicatorSettings.utBotRetestSniper,
                                timestamp: Date.now(),
                            });
                            setIsWallHunterOpen(true);
                            toast.success(`Synced UT Bot (${indicatorSettings.utBotSensitivity}, ATR ${indicatorSettings.utBotAtrPeriod}) to WallHunter`);
                        }}
                    />
                )}
            </div>

            {isWallHunterOpen && (
                <WallHunterModal
                    isOpen={isWallHunterOpen}
                    onClose={() => setIsWallHunterOpen(false)}
                    symbol={config.symbol}
                    exchange={config.exchange}
                    bids={bids}
                    asks={asks}
                    onDeploySuccess={(botId) => {
                        setActiveWallHunterId(Number(botId));
                        setBotForChart(config.id, Number(botId));
                        setIsWallHunterOpen(false);
                    }}
                />
            )}
            {isForexWallHunterOpen && (
                <ForexWallHunterModal
                    isOpen={isForexWallHunterOpen}
                    onClose={() => setIsForexWallHunterOpen(false)}
                    onDeploySuccess={(botId) => {
                        setActiveWallHunterId(Number(botId));
                        setBotForChart(config.id, Number(botId));
                        setIsForexWallHunterOpen(false);
                    }}
                />
            )}
            {isFullscreen && renderFloatingTools}
        </div>
    );

    // Keep panel mounted in-tree (CSS fixed inset-0 handles Fullscreen cleanly without destroying canvas & WS state!)
    return panelContent;
});

// Main Page Component
const OrderFlowHeatmap: React.FC = () => {
    const { globalExchange: exchange, setGlobalExchange: setExchange, globalSymbol: symbol, setGlobalSymbol: setSymbol, globalInterval: interval, setGlobalInterval: setInterval } = useMarketStore();
    const {
        activeWallHunterId,
        setActiveWallHunterId,
        indicatorSettings,
        indicatorSettingsByChartId,
        setChartIndicatorSettings,
        resetChartIndicatorSettings,
        activeBotsByChartId,
        setBotForChart,
        removeBotForChart,
    } = useBotStore();
    const { orderFlowActiveTab: activeTab, setOrderFlowActiveTab: setActiveTab, setOrderFlowShowFootprint: setShowFootprint } = useUIStore();
    const { settings: advancedMetrics, updateSettings: onAdvancedMetricsChange } = useAdvancedMetricsSettings();

    const [isWallHunterOpen, setIsWallHunterOpen] = useState(false);
    const [isForexWallHunterOpen, setIsForexWallHunterOpen] = useState(false);
    const [isEmergencySelling, setIsEmergencySelling] = useState(false); // NEW STATE
    const [isFloatingToolbarOpen, setIsFloatingToolbarOpen] = useState(false);
    const [hasDiscoveredFloatingTools, setHasDiscoveredFloatingTools] = useState<boolean>(() => {
        try {
            return localStorage.getItem('cosmo_tools_dock_discovered_v1') === '1';
        } catch {
            return false;
        }
    });
    const handleToggleFloatingTools = useCallback(() => {
        setIsFloatingToolbarOpen(prev => !prev);
        if (!hasDiscoveredFloatingTools) {
            setHasDiscoveredFloatingTools(true);
            try {
                localStorage.setItem('cosmo_tools_dock_discovered_v1', '1');
            } catch {}
        }
    }, [hasDiscoveredFloatingTools]);
    const [hasFullscreenChart, setHasFullscreenChart] = useState(false);
    const [showCrosshairAIPredict, setShowCrosshairAIPredict] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('orderflow_show_crosshair_ai_predict');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    const handleToggleCrosshairAIPredict = (enabled: boolean) => {
        setShowCrosshairAIPredict(enabled);
        try {
            localStorage.setItem('orderflow_show_crosshair_ai_predict', JSON.stringify(enabled));
        } catch {}
    };

    const [showLastPriceLine, setShowLastPriceLine] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('orderflow_show_last_price_line');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    });

    const handleToggleLastPriceLine = () => {
        setShowLastPriceLine(prev => {
            const next = !prev;
            try { localStorage.setItem('orderflow_show_last_price_line', JSON.stringify(next)); } catch {}
            return next;
        });
    };

    const [showBidAsk, setShowBidAsk] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('orderflow_show_bid_ask');
            return saved !== null ? JSON.parse(saved) : false;
        } catch {
            return false;
        }
    });

    const handleToggleBidAsk = () => {
        setShowBidAsk(prev => {
            const next = !prev;
            try { localStorage.setItem('orderflow_show_bid_ask', JSON.stringify(next)); } catch {}
            return next;
        });
    };

    const [showMarkPrice, setShowMarkPrice] = useState<boolean>(() => {
        try {
            const saved = localStorage.getItem('orderflow_show_mark_price');
            return saved !== null ? JSON.parse(saved) : true;
        } catch {
            return true;
        }
    });

    const handleToggleMarkPrice = () => {
        setShowMarkPrice(prev => {
            const next = !prev;
            try { localStorage.setItem('orderflow_show_mark_price', JSON.stringify(next)); } catch {}
            return next;
        });
    };
    
    const [additionalCharts, setAdditionalCharts] = useState<ChartConfig[]>([]);
    const [activeChartId, setActiveChartId] = useState<string>('main');
    const [chartPrices, setChartPrices] = useState<Record<string, number>>({});
    const [manualTradeSymbol, setManualTradeSymbol] = useState<string>(symbol);

    const handleChartPriceChange = useCallback((id: string, price: number) => {
        setChartPrices(prev => {
            if (prev[id] === price) return prev;
            return { ...prev, [id]: price };
        });
    }, []);

    const activeBotIds = useMemo(() => Array.from(new Set(Object.values(activeBotsByChartId))), [activeBotsByChartId]);
    const [selectedHudBotId, setSelectedHudBotId] = useState<number | null>(null);

    useEffect(() => {
        if (activeBotIds.length > 0 && (!selectedHudBotId || !activeBotIds.includes(selectedHudBotId))) {
            setSelectedHudBotId(activeBotIds[0]);
        } else if (activeBotIds.length === 0 && selectedHudBotId) {
            setSelectedHudBotId(null);
        }
    }, [activeBotIds, selectedHudBotId]);

    const addChart = useCallback(() => {
        setAdditionalCharts(prev => {
            if (prev.length >= 3) return prev;
            const usedIds = new Set(prev.map(c => c.id));
            const nextSlot = EXTRA_CHART_SLOTS.find(slot => !usedIds.has(slot)) || `chart-${Date.now()}`;
            setActiveChartId(nextSlot);
            return [...prev, {
                id: nextSlot,
                symbol,
                exchange,
                interval,
            }];
        });
    }, [symbol, exchange, interval]);

    const removeChart = useCallback((id: string) => {
        setAdditionalCharts(prev => prev.filter(c => c.id !== id));
        setActiveChartId(prev => (prev === id ? 'main' : prev));
    }, []);

    const updateChart = useCallback((id: string, updates: Partial<ChartConfig>) => {
        if (id === 'main') {
            if (updates.symbol) setSymbol(updates.symbol);
            if (updates.exchange) setExchange(updates.exchange);
            if (updates.interval) setInterval(updates.interval);
        } else {
            setAdditionalCharts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
        }
    }, [setSymbol, setExchange, setInterval]);

    const handleSelectActiveChart = useCallback((id: string) => {
        setActiveChartId(id);
    }, []);

    const handleManualTradeClick = useCallback((id: string, chartSymbol: string, price: number) => {
        setActiveChartId(id);
        setManualTradeSymbol(chartSymbol);
        setManualTradePrice(price);
    }, []);

    const handleChartIndicatorSettingsChange = useCallback((chartId: string, nextSettings: IndicatorSettings) => {
        setChartIndicatorSettings(chartId, nextSettings);
        if (chartId === 'main' && nextSettings.showFootprint !== undefined) {
            setShowFootprint(Boolean(nextSettings.showFootprint));
        }
    }, [setChartIndicatorSettings, setShowFootprint]);

    const handleResetChartIndicators = useCallback((chartId: string) => {
        resetChartIndicatorSettings(chartId);
        if (chartId === 'main') {
            setShowFootprint(false);
        }
    }, [resetChartIndicatorSettings, setShowFootprint]);

    const allCharts = useMemo(() => {
        return [
            { id: 'main', symbol, exchange, interval, isMain: true },
            ...additionalCharts.map(c => ({ ...c, isMain: false }))
        ];
    }, [symbol, exchange, interval, additionalCharts]);

    const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
    const [activeMLModelId, setActiveMLModelId] = useState<string | null>(null);

    // Reset ML model if symbol or exchange changes
    useEffect(() => {
        setActiveMLModelId(null);
    }, [symbol, exchange]);
    const [externalAIPrice, setExternalAIPrice] = useState<number | null>(null);
    const [externalAIOpenTrigger, setExternalAIOpenTrigger] = useState<number>(0);
    const [manualTradePrice, setManualTradePrice] = useState<number | null>(null);
    const [manualTradeTrigger, setManualTradeTrigger] = useState<number>(0);
    const [isTopTokensModalOpen, setIsTopTokensModalOpen] = useState(false);

    // ── Draggable HUD state (Zero-React-Re-render GPU translate3d during drag) ──
    const [hudPos, setHudPos] = useState({ x: 24, y: 24 }); // initial: top-right offset
    const hudContainerRef = useRef<HTMLDivElement>(null);
    const hudDragRef = useRef({ dragging: false, startX: 0, startY: 0, originX: 24, originY: 24, currentX: 24, currentY: 24 });

    const startHudDrag = useCallback((e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const drag = hudDragRef.current;
        drag.dragging = true;
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.originX = hudPos.x;
        drag.originY = hudPos.y;
        drag.currentX = hudPos.x;
        drag.currentY = hudPos.y;

        beginFloatingModalDrag(hudContainerRef.current);

        const onMove = (mv: MouseEvent) => {
            if (!hudDragRef.current.dragging) return;
            const nextX = Math.round(Math.max(0, drag.originX + (mv.clientX - drag.startX)));
            const nextY = Math.round(Math.max(0, drag.originY + (mv.clientY - drag.startY)));
            if (nextX === drag.currentX && nextY === drag.currentY) return;
            drag.currentX = nextX;
            drag.currentY = nextY;
            if (hudContainerRef.current) {
                hudContainerRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
            }
        };
        const onUp = () => {
            if (!hudDragRef.current.dragging) return;
            hudDragRef.current.dragging = false;
            endFloatingModalDrag(hudContainerRef.current);
            setHudPos({ x: drag.currentX, y: drag.currentY });
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove, { passive: true });
        window.addEventListener('mouseup', onUp);
    }, [hudPos.x, hudPos.y]);
    const [showSubNav, setShowSubNav] = useState(() => {
        try {
            if (typeof window !== 'undefined' && document.documentElement.classList.contains('mobile-phone-ui')) {
                return localStorage.getItem('heatmapSubNavVisiblePhone') === 'true';
            }
            return localStorage.getItem('heatmapSubNavVisible') !== 'false';
        } catch {
            return true;
        }
    });
    // Ref to the animated toolbar wrapper — lets us flip overflow:hidden↔visible
    // imperatively so dropdowns (Indicators, SymbolSelector, AdvancedMetrics) are
    // never clipped by the collapsing animation container.
    const toolbarRef = useRef<HTMLDivElement>(null);

    const activeChartSettings = useMemo(() => {
        if (activeChartId === 'main') return indicatorSettings;
        return indicatorSettingsByChartId[activeChartId] || CLEAN_INDICATOR_SETTINGS;
    }, [activeChartId, indicatorSettings, indicatorSettingsByChartId]);

    const activeChartLabel = useMemo(() => {
        if (activeChartId === 'main') return 'Main';
        const idx = allCharts.findIndex(c => c.id === activeChartId);
        return idx >= 0 ? `Chart ${idx + 1}` : 'Chart';
    }, [activeChartId, allCharts]);

    const handleActiveChartSettingsChange = useCallback((nextSettings: IndicatorSettings) => {
        handleChartIndicatorSettingsChange(activeChartId, nextSettings);
    }, [activeChartId, handleChartIndicatorSettingsChange]);

    const handleActiveChartReset = useCallback(() => {
        handleResetChartIndicators(activeChartId);
    }, [activeChartId, handleResetChartIndicators]);

    const [isOrderBookModalOpen, setIsOrderBookModalOpen] = useState(false);
    const [isBotLogsModalOpen, setIsBotLogsModalOpen] = useState(false);
    const [isIndicatorModalOpen, setIsIndicatorModalOpen] = useState(false);
    const [isAIDeploymentModalOpen, setIsAIDeploymentModalOpen] = useState(false);
    const deviceProfile = useDeviceProfile();
    const { bids, asks, walls, currentPrice, bestBid: liveBestBid, bestAsk: liveBestAsk, tradeEvent } = useLevel2MarketData(symbol, exchange);
    const { volumeThreshold, setVolumeThreshold, volumeMode, setVolumeMode } = useVolumeFilter(5000000);
    const mainChartBotId = activeBotsByChartId['main'] || null;
    const { statusData: botStatus, isConnected: botWsConnected } = useWallHunterStatus(selectedHudBotId);
    const [selectedApiKeyId, setSelectedApiKeyId] = useState<string | null>(null);
    const openOrders = useOpenOrders(selectedApiKeyId, symbol, deviceProfile.timings.openOrdersPollMs);
    const activePosition = useActivePosition(selectedApiKeyId, symbol, deviceProfile.timings.openOrdersPollMs, symbol.includes(':'));

    // Zero-extra-render synchronous price side tracking (avoids a 2nd full OrderFlowHeatmap render on every tick)
    const lastPriceSideRef = useRef<'buy' | 'sell'>('buy');
    const prevHeaderPriceRef = useRef<number>(0);
    if (tradeEvent?.side === 'buy' || tradeEvent?.side === 'sell') {
        lastPriceSideRef.current = tradeEvent.side;
    } else if (currentPrice && prevHeaderPriceRef.current && currentPrice !== prevHeaderPriceRef.current) {
        lastPriceSideRef.current = currentPrice > prevHeaderPriceRef.current ? 'buy' : 'sell';
    }
    if (currentPrice) {
        prevHeaderPriceRef.current = currentPrice;
    }
    const lastPriceSide = lastPriceSideRef.current;

    const activeChart = useMemo(() => {
        return allCharts.find(c => c.id === activeChartId) || allCharts[0];
    }, [allCharts, activeChartId]);

    // Keep manualTradeSymbol in sync when active chart changes
    useEffect(() => {
        if (activeChart) {
            setManualTradeSymbol(activeChart.symbol);
        }
    }, [activeChart?.id, activeChart?.symbol]);

    // Available pairs list with prices for Manual Trade and floating tools
    const availablePairs: AvailablePair[] = useMemo(() => {
        return allCharts.map(c => ({
            id: c.id,
            symbol: c.symbol,
            exchange: c.exchange,
            isMain: c.isMain,
            price: c.isMain ? currentPrice : (chartPrices[c.id] || 0)
        }));
    }, [allCharts, chartPrices, currentPrice]);

    // Isolate ManualTradeModal from high-frequency parent price churn on mobile/tablet thermal guard
    const [isManualTradeOpen, setIsManualTradeOpen] = useState(false);
    const chartWallsMapRef = useRef<Record<string, OrderbookWall[]>>({});
    const [chartWallsTick, setChartWallsTick] = useState(0);
    const lastWallsFlushRef = useRef<number>(0);
    const handleChartWallsChange = useCallback((chartId: string, chartWalls: OrderbookWall[]) => {
        chartWallsMapRef.current[chartId] = chartWalls;
        const now = Date.now();
        if (now - lastWallsFlushRef.current >= 450) {
            lastWallsFlushRef.current = now;
            setChartWallsTick(t => t + 1);
        }
    }, []);
    const modalThrottleMs = deviceProfile.timings.modalPriceThrottleMs;
    const rawModalPrice = activeChart?.isMain
        ? (chartPrices[activeChart.id] || currentPrice)
        : (chartPrices[activeChart?.id || ''] || 0);
    const [throttledModalPrice, setThrottledModalPrice] = useState<number>(rawModalPrice);
    const [throttledChartPrices, setThrottledChartPrices] = useState<Record<string, number>>(chartPrices);
    const lastModalPriceFlushRef = useRef<number>(0);

    useEffect(() => {
        if (!deviceProfile.isThermalGuardActive || modalThrottleMs <= 0) return;
        if (!isManualTradeOpen && manualTradeTrigger === 0) return;
        const now = Date.now();
        const elapsed = now - lastModalPriceFlushRef.current;
        if (elapsed >= modalThrottleMs) {
            lastModalPriceFlushRef.current = now;
            setThrottledModalPrice(rawModalPrice);
            setThrottledChartPrices(chartPrices);
            return;
        }
        const timer = setTimeout(() => {
            lastModalPriceFlushRef.current = Date.now();
            setThrottledModalPrice(rawModalPrice);
            setThrottledChartPrices(chartPrices);
        }, modalThrottleMs - elapsed);
        return () => clearTimeout(timer);
    }, [deviceProfile.isThermalGuardActive, modalThrottleMs, isManualTradeOpen, manualTradeTrigger, rawModalPrice, chartPrices]);

    useEffect(() => {
        if (!deviceProfile.isThermalGuardActive || modalThrottleMs <= 0) return;
        if (isManualTradeOpen || manualTradeTrigger > 0) {
            lastModalPriceFlushRef.current = Date.now();
            setThrottledModalPrice(rawModalPrice);
            setThrottledChartPrices(chartPrices);
        }
    }, [deviceProfile.isThermalGuardActive, modalThrottleMs, isManualTradeOpen, manualTradeTrigger, activeChartId]);

    const throttledModalAvailablePairs: AvailablePair[] = useMemo(() => {
        return allCharts.map(c => ({
            id: c.id,
            symbol: c.symbol,
            exchange: c.exchange,
            isMain: c.isMain,
            price: throttledChartPrices[c.id] || (c.isMain ? throttledModalPrice : undefined)
        }));
    }, [allCharts, throttledChartPrices, throttledModalPrice]);

    const modalCurrentPrice = (deviceProfile.isThermalGuardActive && modalThrottleMs > 0) ? throttledModalPrice : rawModalPrice;
    const modalAvailablePairs = (deviceProfile.isThermalGuardActive && modalThrottleMs > 0) ? throttledModalAvailablePairs : availablePairs;
    const modalOrderbookWalls: OrderbookWall[] = useMemo(() => {
        if (!isManualTradeOpen) return [];
        const targetId = activeChart?.id || activeChartId || 'main';
        const perChart = chartWallsMapRef.current[targetId];
        if (perChart && perChart.length > 0) return perChart;
        return (targetId === 'main' ? walls : []) as OrderbookWall[];
    }, [isManualTradeOpen, activeChart?.id, activeChartId, walls, chartWallsTick]);

    const activeChartIdRef = useRef<string>(activeChartId);
    activeChartIdRef.current = activeChartId;
    const manualTradeSymbolRef = useRef<string>(manualTradeSymbol || activeChart?.symbol || symbol);
    manualTradeSymbolRef.current = manualTradeSymbol || activeChart?.symbol || symbol;

    const resolveTargetDragEntry = useCallback((x: number, y: number): ChartDragBracketEntry | null => {
        const targetSymbol = (manualTradeSymbolRef.current || '').toUpperCase();
        const preferredId = activeChartIdRef.current;

        if (preferredId) {
            const preferred = chartDragBracketRegistry.get(preferredId);
            if (preferred && preferred.containsPoint(x, y)) {
                if (!targetSymbol || preferred.symbol.toUpperCase() === targetSymbol) {
                    return preferred;
                }
            }
        }

        for (const entry of chartDragBracketRegistry.values()) {
            if (!entry.containsPoint(x, y)) continue;
            if (!targetSymbol || entry.symbol.toUpperCase() === targetSymbol) {
                return entry;
            }
        }

        return null;
    }, []);

    const handleModalSelectPair = useCallback((pair: AvailablePair) => {
        activeChartIdRef.current = pair.id;
        manualTradeSymbolRef.current = pair.symbol;
        setActiveChartId(pair.id);
        setManualTradeSymbol(pair.symbol);
    }, []);

    const handleModalClose = useCallback(() => {
        setManualTradePrice(null);
        setManualTradeTrigger(0);
    }, []);

    const handleModalDragBracketStart = useCallback((type: any) => {
        chartDragBracketRegistry.forEach(entry => {
            entry.start(type);
        });
    }, []);

    const handleModalDragBracketMove = useCallback((type: any, x: number, y: number) => {
        const target = resolveTargetDragEntry(x, y);
        chartDragBracketRegistry.forEach(entry => {
            if (entry !== target) {
                entry.clearGhost();
            }
        });
        if (!target) return null;
        return target.move(type, x, y);
    }, [resolveTargetDragEntry]);

    const handleModalDragBracketEnd = useCallback((type: any, x: number, y: number) => {
        const target = resolveTargetDragEntry(x, y);
        chartDragBracketRegistry.forEach(entry => {
            if (entry !== target) {
                entry.clearGhost();
            }
        });
        if (!target) return { inChart: false, price: null };
        const result = target.end(type, x, y);
        if (result.inChart && target.chartId !== activeChartIdRef.current) {
            activeChartIdRef.current = target.chartId;
            setActiveChartId(target.chartId);
        }
        return result;
    }, [resolveTargetDragEntry]);

    useEffect(() => {
        (window as any)._handleChartDragBracketStart = handleModalDragBracketStart;
        (window as any)._handleChartDragBracketMove = handleModalDragBracketMove;
        (window as any)._handleChartDragBracketEnd = handleModalDragBracketEnd;
        return () => {
            if ((window as any)._handleChartDragBracketStart === handleModalDragBracketStart) {
                delete (window as any)._handleChartDragBracketStart;
            }
            if ((window as any)._handleChartDragBracketMove === handleModalDragBracketMove) {
                delete (window as any)._handleChartDragBracketMove;
            }
            if ((window as any)._handleChartDragBracketEnd === handleModalDragBracketEnd) {
                delete (window as any)._handleChartDragBracketEnd;
            }
        };
    }, [handleModalDragBracketStart, handleModalDragBracketMove, handleModalDragBracketEnd]);

    const mainParentL2Data = useMemo(
        () => ({ bids, asks, walls, currentPrice, bestBid: liveBestBid, bestAsk: liveBestAsk, tradeEvent }),
        [bids, asks, walls, currentPrice, liveBestBid, liveBestAsk, tradeEvent]
    );
    const noopCallback = useCallback(() => {}, []);


    const maxTotal = useMemo(() => {
        if (deviceProfile.isThermalGuardActive && !isOrderBookModalOpen) return 1;
        const maxBid = bids.length > 0 ? bids[bids.length - 1].total : 0;
        const maxAsk = asks.length > 0 ? asks[asks.length - 1].total : 0;
        return Math.max(maxBid, maxAsk, 1); // Avoid division by zero
    }, [bids, asks, deviceProfile.isThermalGuardActive, isOrderBookModalOpen]);

    // Emergency Sell Handler
    const handleEmergencySell = async (type: 'market' | 'limit') => {
        if (!selectedHudBotId || isEmergencySelling) return;
        setIsEmergencySelling(true);
        try {
            await botService.emergencySell(selectedHudBotId, type);
            toast.success(`Emergency ${type} sell triggered successfully`);
        } catch (err: any) {
            console.error(`Emergency ${type} sell failed:`, err);
            toast.error(`Emergency ${type} sell failed: ` + (err.response?.data?.detail || err.message));
        } finally {
            setIsEmergencySelling(false);
        }
    };

    const floatingToolsNode = (
        <>
                {/* FLOATING TRADING COMMAND DOCK CONTAINER */}
                <div
                    className="fixed bottom-4 right-3 sm:bottom-7 sm:right-7 z-[999] flex flex-col sm:flex-row items-end gap-2 pointer-events-none max-w-[calc(100vw-24px)]"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* COLLAPSIBLE GLASS DOCK (Kept mounted so ManualTradeModal/Predictor state & API keys persist when hidden) */}
                    <motion.div
                        key="floating-action-tools-drawer"
                        initial={false}
                        animate={
                            isFloatingToolbarOpen
                                ? { opacity: 1, x: 0, y: 0, scale: 1 }
                                : { opacity: 0, x: 24, y: 6, scale: 0.96 }
                        }
                        transition={deviceProfile.isThermalGuardActive ? { duration: 0.12 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                        style={{ pointerEvents: isFloatingToolbarOpen ? 'auto' : 'none' }}
                        aria-hidden={!isFloatingToolbarOpen}
                        className={`flex flex-wrap sm:flex-nowrap items-end justify-end transition-shadow ${
                            deviceProfile.isThermalGuardActive || !isFloatingToolbarOpen ? '' : 'backdrop-blur-xl'
                        } ${
                            isFloatingToolbarOpen
                                ? 'gap-2 sm:gap-2.5 px-2.5 py-2 rounded-2xl border bg-white/95 dark:bg-[#070b14]/95 border-slate-300/80 dark:border-cyan-500/35 shadow-[0_12px_32px_rgba(15,23,42,0.18)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.85),0_0_24px_rgba(6,182,212,0.18)]'
                                : 'invisible w-0 h-0 p-0 m-0 border-0 overflow-hidden'
                        }`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* GROUP 1: INTEL & INDICATORS */}
                        <div className="flex items-end gap-2 sm:pr-2 sm:border-r border-slate-200 dark:border-white/10">
                            {/* TECHNICAL INDICATORS */}
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setIsIndicatorModalOpen(true)}
                                    className="relative shrink-0 w-[40px] h-[40px] rounded-full flex items-center justify-center bg-gradient-to-br from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 border border-slate-900/15 dark:border-teal-400/30 text-white shadow-md dark:shadow-[0_0_12px_rgba(20,184,166,0.45)] transition-all hover:scale-110 active:scale-95 focus:outline-none group cursor-pointer"
                                    title="Technical Analysis Indicators"
                                >
                                    <svg className="w-4.5 h-4.5 group-hover:scale-110 transition-transform bg-transparent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                </button>
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">TA Ind</span>
                            </div>

                            {/* TOP TOKENS DASHBOARD */}
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setIsTopTokensModalOpen(true)}
                                    className="relative shrink-0 w-[40px] h-[40px] rounded-full flex items-center justify-center bg-gradient-to-br from-orange-500 to-red-600 hover:from-orange-400 hover:to-red-500 border border-slate-900/15 dark:border-orange-400/30 text-white shadow-md dark:shadow-[0_0_12px_rgba(249,115,22,0.45)] transition-all hover:scale-110 active:scale-95 focus:outline-none group cursor-pointer"
                                    title="Top Tokens Dashboard"
                                >
                                    <svg className="w-4.5 h-4.5 group-hover:scale-110 transition-transform bg-transparent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
                                    </svg>
                                </button>
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">Tokens</span>
                            </div>

                            {/* LEVEL 2 ORDER BOOK */}
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setIsOrderBookModalOpen(true)}
                                    className="relative shrink-0 w-[40px] h-[40px] rounded-full flex items-center justify-center bg-gradient-to-br from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 border border-slate-900/15 dark:border-blue-400/30 text-white shadow-md dark:shadow-[0_0_12px_rgba(59,130,246,0.45)] transition-all hover:scale-110 active:scale-95 focus:outline-none group cursor-pointer"
                                    title="Level 2 Order Book"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
                                </button>
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">L2 Book</span>
                            </div>
                        </div>

                        {/* GROUP 2: AI & ORDER FLOW CHARTS */}
                        <div className="flex items-end gap-2 sm:pr-2 sm:border-r border-slate-200 dark:border-white/10">
                            {/* AI DEPLOYMENT */}
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => setIsAIDeploymentModalOpen(true)}
                                    className="relative shrink-0 w-[40px] h-[40px] rounded-full flex items-center justify-center bg-gradient-to-br from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 border border-slate-900/15 dark:border-purple-400/30 text-white shadow-md dark:shadow-[0_0_12px_rgba(168,85,247,0.45)] transition-all hover:scale-110 active:scale-95 focus:outline-none group cursor-pointer"
                                    title="Deploy AI Trading Model"
                                >
                                    <svg className="w-4.5 h-4.5 group-hover:scale-110 transition-transform bg-transparent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                                        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                                        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
                                        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
                                        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
                                        <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
                                        <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
                                        <path d="M6 18a4 4 0 0 1-1.967-.516"/>
                                        <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
                                    </svg>
                                </button>
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">AI Bot</span>
                            </div>

                            {/* ALGO PREDICTOR MODAL */}
                            <div className="flex flex-col items-center gap-1">
                                <ModelPredictorModal
                                    size="sm"
                                    currentPrice={modalCurrentPrice}
                                    onPrediction={setPredictionResult}
                                    externalPrice={externalAIPrice}
                                    externalOpenTrigger={externalAIOpenTrigger}
                                    showCrosshairAIPredict={showCrosshairAIPredict}
                                    onToggleCrosshairAIPredict={handleToggleCrosshairAIPredict}
                                />
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">Predict</span>
                            </div>

                            {/* FLOATING ORDER FLOW CHART */}
                            <div className="flex flex-col items-center gap-1">
                                <div className="w-[42px] h-[42px] relative shrink-0 flex items-center justify-center">
                                    {(isFloatingToolbarOpen || !deviceProfile.isThermalGuardActive) && (
                                        <FloatingTVChartButton size="sm" symbol={activeChart?.symbol || symbol} exchange={activeChart?.exchange || exchange} />
                                    )}
                                </div>
                                <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-gray-300 leading-none">Chart</span>
                            </div>
                        </div>

                        {/* GROUP 3: EXECUTION & BOTS */}
                        <div className="flex items-end gap-2">
                            {/* MANUAL TRADE TERMINAL */}
                            <div className="flex flex-col items-center gap-1">
                                <div className="w-[42px] h-[42px] relative shrink-0 flex items-center justify-center">
                                    <ManualTradeModal
                                        buttonSize="sm"
                                        symbol={manualTradeSymbol || activeChart?.symbol || symbol}
                                        activePairId={activeChart?.id || activeChartId}
                                        currentPrice={modalCurrentPrice}
                                        availablePairs={modalAvailablePairs}
                                        orderbookWalls={modalOrderbookWalls}
                                        onSelectPair={handleModalSelectPair}
                                        onApiKeyChange={setSelectedApiKeyId}
                                        clickedPrice={manualTradePrice}
                                        openTrigger={manualTradeTrigger}
                                        onClose={handleModalClose}
                                        onOpenChange={setIsManualTradeOpen}
                                        onChartDragBracketStart={handleModalDragBracketStart}
                                        onChartDragBracketMove={handleModalDragBracketMove}
                                        onChartDragBracketEnd={handleModalDragBracketEnd}
                                    />
                                </div>
                                <span className="text-[9px] font-mono font-extrabold text-cyan-600 dark:text-cyan-300 leading-none">Trade</span>
                            </div>

                            {/* WALLHUNTER / FOREX BOT CONTROLS */}
                            {selectedHudBotId ? (
                                <>
                                    <div className="flex flex-col items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setIsWallHunterOpen(true)}
                                            className="group relative w-[42px] h-[42px] shrink-0"
                                            title="Update WallHunter Config"
                                        >
                                            {!deviceProfile.isThermalGuardActive && isFloatingToolbarOpen && (
                                                <div className="absolute inset-0 bg-indigo-500 rounded-full blur-sm opacity-25 dark:opacity-40 group-hover:opacity-100 transition-opacity animate-pulse" />
                                            )}
                                            <div className="relative w-[42px] h-[42px] bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center border border-slate-900/15 dark:border-white/20 shadow-md dark:shadow-[0_0_12px_rgba(99,102,241,0.5)] group-hover:scale-110 transition-transform cursor-pointer">
                                                <svg className="w-4.5 h-4.5 text-white group-hover:rotate-90 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </div>
                                        </button>
                                        <span className="text-[9px] font-mono font-extrabold text-indigo-600 dark:text-indigo-300 leading-none">Edit Bot</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    await botService.controlBot(selectedHudBotId, 'stop');
                                                    const chartsWithBot = Object.entries(activeBotsByChartId).filter(([, bId]) => bId === selectedHudBotId).map(([cId]) => cId);
                                                    chartsWithBot.forEach(cId => removeBotForChart(cId));
                                                    if (activeWallHunterId === selectedHudBotId) {
                                                        setActiveWallHunterId(null);
                                                    }
                                                } catch (err) {
                                                    console.error("Failed to stop WallHunter bot", err);
                                                }
                                            }}
                                            className="group relative w-[42px] h-[42px] shrink-0"
                                            title="Abort WallHunter"
                                        >
                                            {!deviceProfile.isThermalGuardActive && isFloatingToolbarOpen && (
                                                <div className="absolute inset-0 bg-red-500 rounded-full blur-sm opacity-25 dark:opacity-40 group-hover:opacity-100 transition-opacity animate-pulse" />
                                            )}
                                            <div className="relative w-[42px] h-[42px] bg-gradient-to-br from-red-500 to-red-700 rounded-full flex items-center justify-center border-2 border-slate-900/15 dark:border-white/20 shadow-md dark:shadow-[0_0_12px_rgba(239,68,68,0.5)] group-hover:scale-110 transition-transform cursor-pointer">
                                                <svg className="w-5 h-5 text-white group-hover:rotate-180 transition-transform duration-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </div>
                                        </button>
                                        <span className="text-[9px] font-mono font-extrabold text-rose-600 dark:text-rose-400 leading-none">Stop Bot</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-col items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setIsForexWallHunterOpen(true)}
                                            className="relative w-[42px] h-[42px] shrink-0 group opacity-100 transition-opacity duration-300"
                                            title="Deploy Forex WallHunter"
                                        >
                                            {!deviceProfile.isThermalGuardActive && isFloatingToolbarOpen && (
                                                <div className="absolute inset-0 bg-emerald-500 rounded-full blur-sm opacity-25 dark:opacity-40 group-hover:opacity-100 transition-opacity animate-pulse" />
                                            )}
                                            <div className="relative w-[42px] h-[42px] bg-gradient-to-br from-emerald-400 to-teal-600 rounded-full flex items-center justify-center border-2 border-slate-900/15 dark:border-white/20 shadow-md group-hover:scale-110 transition-transform cursor-pointer">
                                                <svg className="w-5 h-5 text-white group-hover:-rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                                </svg>
                                            </div>
                                        </button>
                                        <span className="text-[9px] font-mono font-extrabold text-emerald-600 dark:text-emerald-300 leading-none">ForexBot</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setIsWallHunterOpen(true)}
                                            className="relative w-[42px] h-[42px] shrink-0 group opacity-100 transition-opacity duration-300"
                                            title="Deploy WallHunter"
                                        >
                                            {!deviceProfile.isThermalGuardActive && isFloatingToolbarOpen && (
                                                <div className="absolute inset-0 bg-yellow-500 rounded-full blur-sm opacity-25 dark:opacity-40 group-hover:opacity-100 transition-opacity animate-pulse" />
                                            )}
                                            <div className="relative w-[42px] h-[42px] bg-gradient-to-br from-yellow-400 to-orange-600 rounded-full flex items-center justify-center border-2 border-slate-900/15 dark:border-white/20 shadow-md group-hover:scale-110 transition-transform cursor-pointer">
                                                <svg className="w-5 h-5 text-white group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                </svg>
                                            </div>
                                        </button>
                                        <span className="text-[9px] font-mono font-extrabold text-amber-600 dark:text-amber-300 leading-none">WallBot</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </motion.div>

                    {/* PRO SAAS COMMAND LAUNCHER PILL / COLLAPSE BUTTON */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleToggleFloatingTools();
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{ pointerEvents: 'auto' }}
                        className={`relative shrink-0 rounded-full flex items-center gap-2 transition-all duration-200 active:scale-95 group cursor-pointer ${
                            deviceProfile.isThermalGuardActive ? '' : 'backdrop-blur-xl'
                        } ${
                            isFloatingToolbarOpen
                                ? 'px-3 py-2 bg-white/95 dark:bg-[#0b1120]/95 hover:bg-slate-100 dark:hover:bg-[#141d34] border border-cyan-500/45 text-cyan-700 dark:text-cyan-300 shadow-lg dark:shadow-[0_0_18px_rgba(6,182,212,0.3)]'
                                : 'pl-1.5 pr-3 py-1.5 bg-white/95 dark:bg-[#070b14]/95 hover:bg-slate-50 dark:hover:bg-[#0e1628] border border-cyan-500/50 dark:border-cyan-400/55 text-slate-900 dark:text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.85),0_0_22px_rgba(6,182,212,0.28)] hover:scale-[1.03]'
                        }`}
                        title={isFloatingToolbarOpen ? "Hide Trading & Bot Tools Dock" : "Open Trading & Bot Tools (Manual Trade, WallHunter Bot, AI & Indicators)"}
                    >
                        {!isFloatingToolbarOpen && !hasDiscoveredFloatingTools && (
                            <span className="absolute -top-1 -right-1 flex h-3 w-3 pointer-events-none">
                                {!deviceProfile.isThermalGuardActive && (
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-80" />
                                )}
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500 border border-white dark:border-[#070b14]" />
                            </span>
                        )}

                        {isFloatingToolbarOpen ? (
                            <>
                                <X className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                                <span className="text-[11px] font-mono font-black uppercase tracking-wider">Hide Tools</span>
                                <ChevronRight className="w-3.5 h-3.5 opacity-80" />
                            </>
                        ) : (
                            <>
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-[0_0_12px_rgba(6,182,212,0.45)] shrink-0">
                                    {selectedHudBotId ? (
                                        <Zap className={`w-4 h-4 fill-amber-300 text-amber-300 ${deviceProfile.isThermalGuardActive ? '' : 'animate-pulse'}`} />
                                    ) : (
                                        <SlidersHorizontal className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                                    )}
                                </div>
                                <div className="flex flex-col text-left min-w-0 leading-tight">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[11.5px] font-black tracking-tight whitespace-nowrap">
                                            Trade & Bot Tools
                                        </span>
                                        {selectedHudBotId ? (
                                            <span className={`px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/45 text-emerald-600 dark:text-emerald-300 text-[8.5px] font-mono font-black uppercase ${deviceProfile.isThermalGuardActive ? '' : 'animate-pulse'}`}>
                                                BOT LIVE
                                            </span>
                                        ) : (
                                            <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[9px] font-mono font-black">
                                                9
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[9px] font-mono text-slate-500 dark:text-gray-400 whitespace-nowrap">
                                        Trade • WallBot • AI • L2
                                    </span>
                                </div>
                                <ChevronLeft className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0 group-hover:-translate-x-0.5 transition-transform" />
                            </>
                        )}
                    </button>
                </div>
        </>
    );

    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;

    // ── Live L2 Orderbook Imbalance & Nearest Whale Wall Radar Telemetry ──
    const activeDisplayPrice = useMemo(() => {
        if (activeChart && activeChart.id !== 'main') {
            return chartPrices[activeChart.id] || currentPrice || 0;
        }
        return currentPrice || 0;
    }, [activeChart, chartPrices, currentPrice]);

    // Decouple L2 Depth & Wall filtering/sorting from high-frequency currentPrice ticks
    // and skip completely on phone (<768px) where the center L2 Radar is hidden.
    const l2DepthAndWallsSummary = useMemo(() => {
        if (isPhoneMobileUI || !showSubNav) {
            return {
                bidDomPct: 50,
                sortedBuyWalls: [] as { price: number; type: 'buy' | 'sell'; size?: number }[],
                sortedSellWalls: [] as { price: number; type: 'buy' | 'sell'; size?: number }[],
                totalWalls: 0,
            };
        }
        const topBids = bids.slice(0, 25);
        const topAsks = asks.slice(0, 25);
        const bidVol = topBids.reduce((s, b: any) => s + Number(b.size || b.amount || 0), 0);
        const askVol = topAsks.reduce((s, a: any) => s + Number(a.size || a.amount || 0), 0);
        const totalVol = bidVol + askVol;
        const bidDomPct = totalVol > 0 ? (bidVol / totalVol) * 100 : 50;

        let activeWallsList: { price: number; type: 'buy' | 'sell'; size?: number }[] = [];
        if (activeChart && activeChart.id !== 'main' && chartWallsMapRef.current[activeChart.id]?.length) {
            activeWallsList = chartWallsMapRef.current[activeChart.id];
        } else if (volumeThreshold > 0) {
            asks.forEach((ask: any) => {
                const val = volumeMode === 'quote' ? ask.size * ask.price : ask.size;
                if (val >= volumeThreshold) {
                    activeWallsList.push({ price: ask.price, type: 'sell', size: ask.size });
                }
            });
            bids.forEach((bid: any) => {
                const val = volumeMode === 'quote' ? bid.size * bid.price : bid.size;
                if (val >= volumeThreshold) {
                    activeWallsList.push({ price: bid.price, type: 'buy', size: bid.size });
                }
            });
        } else {
            activeWallsList = (walls || []) as { price: number; type: 'buy' | 'sell'; size?: number }[];
        }

        const sortedBuyWalls = activeWallsList
            .filter((w) => w.type === 'buy')
            .sort((a, b) => b.price - a.price);
        const sortedSellWalls = activeWallsList
            .filter((w) => w.type === 'sell')
            .sort((a, b) => a.price - b.price);

        return {
            bidDomPct,
            sortedBuyWalls,
            sortedSellWalls,
            totalWalls: activeWallsList.length,
        };
    }, [bids, asks, walls, activeChart, volumeThreshold, volumeMode, chartWallsTick, isPhoneMobileUI, showSubNav]);

    // Under thermal guard (Redmi Pad 2 Pro), quantize reference price to 4 sig-figs so sub-tick jitters don't churn radar distances
    const radarRefPrice = useMemo(() => {
        const raw = activeDisplayPrice || currentPrice || 0;
        if (!deviceProfile.isThermalGuardActive || raw <= 0) return raw;
        return Number(raw.toPrecision(4));
    }, [activeDisplayPrice, currentPrice, deviceProfile.isThermalGuardActive]);

    const l2RadarTelemetry = useMemo(() => {
        if (isPhoneMobileUI || !showSubNav) {
            return {
                bidDomPct: 50,
                nearestSupport: null,
                nearestResistance: null,
                nearestSupportUsd: '',
                nearestResistanceUsd: '',
                supportDistPct: null,
                resistDistPct: null,
                totalWalls: 0,
            };
        }

        const refPx = radarRefPrice;
        const nearestSupport =
            l2DepthAndWallsSummary.sortedBuyWalls.find((w) => refPx <= 0 || w.price <= refPx) || null;
        const nearestResistance =
            l2DepthAndWallsSummary.sortedSellWalls.find((w) => refPx <= 0 || w.price >= refPx) || null;

        const supportDistPct =
            nearestSupport && refPx > 0 ? ((refPx - nearestSupport.price) / refPx) * 100 : null;
        const resistDistPct =
            nearestResistance && refPx > 0
                ? ((nearestResistance.price - refPx) / refPx) * 100
                : null;

        const formatCompactWallUsd = (w: { price: number; size?: number } | null) => {
            if (!w || !w.size) return '';
            const usd = w.price * Number(w.size || 0);
            if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
            if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
            return `$${usd.toFixed(0)}`;
        };

        return {
            bidDomPct: l2DepthAndWallsSummary.bidDomPct,
            nearestSupport,
            nearestResistance,
            nearestSupportUsd: formatCompactWallUsd(nearestSupport),
            nearestResistanceUsd: formatCompactWallUsd(nearestResistance),
            supportDistPct,
            resistDistPct,
            totalWalls: l2DepthAndWallsSummary.totalWalls,
        };
    }, [l2DepthAndWallsSummary, radarRefPrice, isPhoneMobileUI, showSubNav]);

    return (
        <div
            data-viewport-lock={!isPhoneMobileUI ? 'true' : undefined}
            className="flex flex-col h-full bg-slate-100 dark:bg-[#04070e] text-slate-900 dark:text-white overflow-hidden rounded-2xl border border-slate-200 dark:border-cyan-500/25 shadow-sm"
        >
            {isPhoneMobileUI && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-white dark:bg-[#070b14] border-b border-slate-200 dark:border-white/10 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-black text-slate-900 dark:text-white truncate">{symbol}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 font-bold">{interval}</span>
                        <span className={`text-xs font-mono font-black ${lastPriceSide === 'buy' ? 'text-emerald-500' : 'text-rose-500'}`}>
                            ${formatDisplayPrice(currentPrice)}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                setManualTradePrice(null);
                                setManualTradeTrigger(Date.now());
                            }}
                            className="px-2 py-1 rounded-lg bg-cyan-500 text-slate-950 text-[10px] font-mono font-black uppercase cursor-pointer"
                        >
                            ⚡ Trade
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                const next = !showSubNav;
                                if (!next && toolbarRef.current) {
                                    toolbarRef.current.style.overflow = 'hidden';
                                }
                                setShowSubNav(next);
                                try { localStorage.setItem('heatmapSubNavVisiblePhone', String(next)); } catch {}
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border transition-colors ${
                                showSubNav
                                    ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/35'
                                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10'
                            }`}
                        >
                            {showSubNav ? 'Hide Deck' : 'L2 Deck'}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Animated Institutional SaaS Command Deck (Header + L2 Radar + SubNav) ── */}
            <div
                ref={toolbarRef}
                onTransitionEnd={() => {
                    if (showSubNav && toolbarRef.current) {
                        toolbarRef.current.style.overflow = isPhoneMobileUI ? 'auto' : 'visible';
                    }
                }}
                style={{
                    position: 'relative',
                    zIndex: 30,
                    overflow: 'hidden',
                    maxHeight: showSubNav ? (isPhoneMobileUI ? '68dvh' : '500px') : '0px',
                    opacity: showSubNav ? 1 : 0,
                    transition: deviceProfile.isThermalGuardActive ? 'none' : 'max-height 0.32s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
                    willChange: deviceProfile.isThermalGuardActive ? 'auto' : 'max-height, opacity',
                }}
            >
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-90" />

                <header className="cosmo-heatmap-header relative z-20 flex-shrink-0 px-3 py-2 flex-wrap gap-2.5 border-b border-slate-200 dark:border-white/10 flex justify-between items-center bg-white dark:bg-[#070b14]">
                    {/* Left: Pair, Interval, Indicators & Live Price Pill */}
                    <div className="flex flex-wrap items-center gap-2">
                        <HeatmapSymbolSelector symbol={symbol} exchange={exchange} onSymbolChange={setSymbol} onExchangeChange={setExchange} />
                        <TimeframeSelector interval={interval} onIntervalChange={setInterval} />
                        <IndicatorSelector
                            usePortal
                            chartLabel={allCharts.length > 1 ? activeChartLabel : undefined}
                            settings={activeChartSettings}
                            onSettingsChange={handleActiveChartSettingsChange}
                            onResetAll={handleActiveChartReset}
                        />

                        {/* Live Price & Tick Direction Readout */}
                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                            <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase">
                                <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                        lastPriceSide === 'buy' ? 'bg-emerald-500' : 'bg-rose-500'
                                    } ${deviceProfile.isThermalGuardActive ? '' : 'animate-pulse'}`}
                                />
                                {allCharts.length > 1 && activeChart ? activeChart.symbol : 'Live'}
                            </span>
                            <span
                                className={`text-sm sm:text-base font-mono font-black flex items-center gap-1 ${
                                    lastPriceSide === 'buy'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                <span className="text-[10px]">{lastPriceSide === 'buy' ? '▲' : '▼'}</span>
                                ${formatDisplayPrice(activeDisplayPrice)}
                            </span>
                        </div>
                    </div>

                    {/* Center: Live L2 Orderbook Imbalance & Click-to-Snap Whale Wall Radar (Visible across Desktop, Laptop & Redmi Pad Tablet) */}
                    <div className="hidden md:flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-[#050811] px-2.5 py-1 rounded-xl border border-slate-200 dark:border-white/10">
                        {/* Bid vs Ask Tug-of-War Gauge */}
                        <div className="flex items-center gap-1.5 pr-2 border-r border-slate-200 dark:border-white/10" title="Top-25 Level-2 Orderbook Bid vs Ask Volume Imbalance">
                            <span className="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400">
                                {l2RadarTelemetry.bidDomPct.toFixed(0)}% B
                            </span>
                            <div className="cosmo-radar-bar w-16 lg:w-20 h-1.5 rounded-full bg-rose-500/40 overflow-hidden flex">
                                <div
                                    className="h-full bg-emerald-500"
                                    style={{ width: `${Math.min(96, Math.max(4, l2RadarTelemetry.bidDomPct))}%` }}
                                />
                            </div>
                            <span className="text-[10px] font-mono font-black text-rose-600 dark:text-rose-400">
                                {(100 - l2RadarTelemetry.bidDomPct).toFixed(0)}% A
                            </span>
                        </div>

                        {/* Nearest Buy Support Wall (Click to Snap Manual Trade) */}
                        <button
                            type="button"
                            disabled={!l2RadarTelemetry.nearestSupport}
                            onClick={() => {
                                if (!l2RadarTelemetry.nearestSupport) return;
                                handleManualTradeClick(
                                    activeChartId,
                                    activeChart?.symbol || symbol,
                                    l2RadarTelemetry.nearestSupport.price
                                );
                                setManualTradeTrigger(Date.now());
                                toast.success(
                                    `🟢 Snapped Buy Support Wall @ $${formatDisplayPrice(l2RadarTelemetry.nearestSupport.price)} (${l2RadarTelemetry.nearestSupportUsd})`
                                );
                            }}
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 transition-colors ${
                                l2RadarTelemetry.nearestSupport
                                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 cursor-pointer'
                                    : 'bg-white/5 border-white/5 text-slate-400 opacity-50 cursor-default'
                            }`}
                            title={
                                l2RadarTelemetry.nearestSupport
                                    ? `Click to open Manual Trade snapped to Buy Support Wall @ $${formatDisplayPrice(l2RadarTelemetry.nearestSupport.price)} (${l2RadarTelemetry.nearestSupportUsd})`
                                    : 'No Buy Support Wall above current Whale Filter threshold'
                            }
                        >
                            <span>🟢 Support:</span>
                            <span className="font-black">
                                {l2RadarTelemetry.nearestSupport
                                    ? `$${formatDisplayPrice(l2RadarTelemetry.nearestSupport.price)}`
                                    : 'None'}
                            </span>
                            {l2RadarTelemetry.nearestSupportUsd && (
                                <span className="px-1 py-0.1 rounded bg-emerald-500/15 text-[9px] font-black">
                                    {l2RadarTelemetry.nearestSupportUsd}
                                </span>
                            )}
                            {l2RadarTelemetry.supportDistPct !== null && (
                                <span className="cosmo-radar-dist opacity-80">
                                    (-{Math.abs(l2RadarTelemetry.supportDistPct).toFixed(2)}%)
                                </span>
                            )}
                        </button>

                        {/* Nearest Sell Resistance Wall (Click to Snap Manual Trade) */}
                        <button
                            type="button"
                            disabled={!l2RadarTelemetry.nearestResistance}
                            onClick={() => {
                                if (!l2RadarTelemetry.nearestResistance) return;
                                handleManualTradeClick(
                                    activeChartId,
                                    activeChart?.symbol || symbol,
                                    l2RadarTelemetry.nearestResistance.price
                                );
                                setManualTradeTrigger(Date.now());
                                toast.success(
                                    `🔴 Snapped Sell Resistance Wall @ $${formatDisplayPrice(l2RadarTelemetry.nearestResistance.price)} (${l2RadarTelemetry.nearestResistanceUsd})`
                                );
                            }}
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 transition-colors ${
                                l2RadarTelemetry.nearestResistance
                                    ? 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-700 dark:text-rose-300 cursor-pointer'
                                    : 'bg-white/5 border-white/5 text-slate-400 opacity-50 cursor-default'
                            }`}
                            title={
                                l2RadarTelemetry.nearestResistance
                                    ? `Click to open Manual Trade snapped to Sell Resistance Wall @ $${formatDisplayPrice(l2RadarTelemetry.nearestResistance.price)} (${l2RadarTelemetry.nearestResistanceUsd})`
                                    : 'No Sell Resistance Wall above current Whale Filter threshold'
                            }
                        >
                            <span>🔴 Resist:</span>
                            <span className="font-black">
                                {l2RadarTelemetry.nearestResistance
                                    ? `$${formatDisplayPrice(l2RadarTelemetry.nearestResistance.price)}`
                                    : 'None'}
                            </span>
                            {l2RadarTelemetry.nearestResistanceUsd && (
                                <span className="px-1 py-0.1 rounded bg-rose-500/15 text-[9px] font-black">
                                    {l2RadarTelemetry.nearestResistanceUsd}
                                </span>
                            )}
                            {l2RadarTelemetry.resistDistPct !== null && (
                                <span className="cosmo-radar-dist opacity-80">
                                    (+{Math.abs(l2RadarTelemetry.resistDistPct).toFixed(2)}%)
                                </span>
                            )}
                        </button>
                    </div>

                    {/* Right: Primary Pro Execution & Bot Action Cluster */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => {
                                setManualTradePrice(null);
                                setManualTradeTrigger(Date.now());
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-black uppercase tracking-wider cursor-pointer transition-all active:scale-95 ${
                                isManualTradeOpen
                                    ? 'bg-cyan-500 text-slate-950 ring-2 ring-cyan-400/50 shadow-[0_4px_16px_rgba(6,182,212,0.4)]'
                                    : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white shadow-[0_4px_14px_rgba(6,182,212,0.28)]'
                            }`}
                            title="Open Manual Trade & SmartPeg Terminal"
                        >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            <span>Manual Trade</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsWallHunterOpen(true)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-black uppercase tracking-wider cursor-pointer transition-all active:scale-95 ${
                                selectedHudBotId
                                    ? 'bg-emerald-500/15 border-emerald-500/45 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/45 text-amber-700 dark:text-amber-300'
                            }`}
                            title={
                                selectedHudBotId
                                    ? `WallHunter Bot #${selectedHudBotId} Running — Click to configure`
                                    : 'Deploy Autonomous L2 WallHunter Bot'
                            }
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    selectedHudBotId ? 'bg-emerald-400' : 'bg-amber-400'
                                }`}
                            />
                            <span>
                                {selectedHudBotId ? `Bot #${selectedHudBotId} Live` : 'WallHunter Bot'}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsOrderBookModalOpen((v) => !v)}
                            className={`px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border transition-colors cursor-pointer ${
                                isOrderBookModalOpen
                                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
                                    : 'bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Open Floating Level-2 Order Book"
                        >
                            L2 Book
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsBotLogsModalOpen((prev) => !prev)}
                            className={`px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border transition-colors cursor-pointer ${
                                isBotLogsModalOpen
                                    ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40'
                                    : 'bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                            title="Toggle Live Bot Execution Logs"
                        >
                            Logs
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsTopTokensModalOpen(true)}
                            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            title="Open Top Tokens & Volatility Scanner"
                        >
                            <span>🔥 Scanner</span>
                        </button>
                    </div>
                </header>

                <HeatmapSubNav
                    activeTab={activeTab}
                    onChange={setActiveTab}
                    volumeThreshold={volumeThreshold}
                    setVolumeThreshold={setVolumeThreshold}
                    volumeMode={volumeMode}
                    setVolumeMode={setVolumeMode}
                    advancedMetrics={advancedMetrics}
                    onAdvancedMetricsChange={onAdvancedMetricsChange}
                    activeMLModelId={activeMLModelId}
                    setActiveMLModelId={setActiveMLModelId}
                    symbol={symbol}
                    onAddChart={addChart}
                    isAddChartDisabled={additionalCharts.length >= 3}
                    chartsCount={allCharts.length}
                    showFootprint={Boolean(activeChartSettings.showFootprint)}
                    showCVD={Boolean(activeChartSettings.showCVD)}
                    showVPVR={Boolean(activeChartSettings.showHeatmap)}
                    showLastPriceLine={showLastPriceLine}
                    showBidAsk={showBidAsk}
                    showMarkPrice={showMarkPrice}
                    onToggleFootprint={() =>
                        handleActiveChartSettingsChange({
                            ...activeChartSettings,
                            showFootprint: !activeChartSettings.showFootprint,
                        })
                    }
                    onToggleCVD={() =>
                        handleActiveChartSettingsChange({
                            ...activeChartSettings,
                            showCVD: !activeChartSettings.showCVD,
                        })
                    }
                    onToggleVPVR={() =>
                        handleActiveChartSettingsChange({
                            ...activeChartSettings,
                            showHeatmap: !activeChartSettings.showHeatmap,
                        })
                    }
                    onToggleLastPriceLine={handleToggleLastPriceLine}
                    onToggleBidAsk={handleToggleBidAsk}
                    onToggleMarkPrice={allCharts.some(c => c.symbol.includes(':')) ? handleToggleMarkPrice : undefined}
                />
            </div>

            {/* ── Arrow toggle button (always visible) ──────────────────────── */}
            {!isPhoneMobileUI && (
            <div className="flex justify-center">
                <button
                    onClick={() => {
                        const next = !showSubNav;
                        if (!next && toolbarRef.current) {
                            toolbarRef.current.style.overflow = 'hidden';
                        }
                        setShowSubNav(next);
                        try { localStorage.setItem('heatmapSubNavVisible', String(next)); } catch {}
                    }}
                    title={showSubNav ? 'Collapse Command Deck' : 'Expand Command Deck'}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 32,
                        height: 14,
                        background: 'rgba(15,23,42,0.9)',
                        border: '1px solid rgba(6,182,212,0.28)',
                        borderTop: 'none',
                        borderRadius: '0 0 8px 8px',
                        cursor: 'pointer',
                        zIndex: 10,
                        transition: 'background 0.2s',
                        outline: 'none',
                        padding: 0,
                        flexShrink: 0,
                    }}
                >
                    <svg
                        width="12"
                        height="7"
                        viewBox="0 0 12 7"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{
                            transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
                            transform: showSubNav ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                    >
                        <path d="M1 1L6 6L11 1" stroke="#38bdf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>
            )}


            <div className="cosmo-heatmap-grid-wrap flex-1 min-h-0 flex flex-col p-2.5 laptop:p-2 overflow-y-auto hide-scrollbar relative bg-slate-100 dark:bg-[#04070e]">
                {/* RENDER GRID OF CHARTS */}
                <div className={`flex-1 w-full grid gap-3 ${allCharts.length === 1 ? 'grid-cols-1' : allCharts.length === 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2 grid-rows-2'}`}>
                    {allCharts.map((c, idx) => {
                        const chartSettings = c.id === 'main'
                            ? indicatorSettings
                            : (indicatorSettingsByChartId[c.id] || CLEAN_INDICATOR_SETTINGS);
                        return (
                            <OrderFlowChartPanel 
                                key={c.id} 
                                config={c} 
                                isMain={c.isMain} 
                                isActive={activeChartId === c.id}
                                chartLabel={c.isMain ? 'Main' : `Chart ${idx + 1}`}
                                chartSlotIndex={idx}
                                onSelectActive={handleSelectActiveChart}
                                onPriceChange={handleChartPriceChange}
                                allChartsCount={allCharts.length}
                                onUpdate={updateChart} 
                                onRemove={removeChart} 
                                showFootprint={Boolean(chartSettings.showFootprint)} 
                                showCVD={Boolean(chartSettings.showCVD)} 
                                showVPVR={Boolean(chartSettings.showHeatmap)} 
                                indicatorSettings={chartSettings}
                                onIndicatorSettingsChange={handleChartIndicatorSettingsChange}
                                onResetIndicators={handleResetChartIndicators}
                                advancedMetrics={advancedMetrics} 
                                selectedApiKeyId={selectedApiKeyId} 
                                predictionResult={c.isMain ? predictionResult : null} 
                                activeMLModelId={c.isMain ? activeMLModelId : null} 
                                setExternalAIPrice={c.isMain ? setExternalAIPrice : noopCallback} 
                                setExternalAIOpenTrigger={c.isMain ? setExternalAIOpenTrigger : noopCallback} 
                                onManualTradeClick={handleManualTradeClick}
                                setManualTradeTrigger={setManualTradeTrigger}
                                volumeThreshold={volumeThreshold} 
                                volumeMode={volumeMode} 
                                parentL2Data={c.isMain ? mainParentL2Data : undefined}
                                parentBotId={selectedHudBotId}
                                parentBotStatus={botStatus}
                                parentSymbol={symbol}
                                parentOpenOrders={openOrders}
                                parentPosition={activePosition}
                                showCrosshairAIPredict={showCrosshairAIPredict}
                                showLastPriceLine={showLastPriceLine}
                                showBidAsk={showBidAsk}
                                showMarkPrice={showMarkPrice}
                                renderFloatingTools={hasFullscreenChart ? floatingToolsNode : undefined}
                                onFullscreenChange={setHasFullscreenChart}
                                onWallsChange={handleChartWallsChange}
                            />
                        );
                    })}
                </div>


                {/* ACTIVE WALLHUNTER BOT INSTITUTIONAL TELEMETRY HUD — DRAGGABLE */}
                {selectedHudBotId && botStatus && (
                    <div
                        ref={hudContainerRef}
                        className="cosmo-theme-modal"
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            transform: `translate3d(${hudPos.x}px, ${hudPos.y}px, 0)`,
                            willChange: 'transform',
                            zIndex: 50,
                            userSelect: 'none',
                            width: '286px',
                        }}
                    >
                        <div className="relative bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                            <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400" />

                            {/* Bot Switcher Tabs if multiple bots */}
                            {activeBotIds.length > 1 && (
                                <div className="flex gap-1 p-1.5 bg-slate-100 dark:bg-[#050811] border-b border-slate-200 dark:border-white/10 overflow-x-auto hide-scrollbar">
                                    {activeBotIds.map((bId) => (
                                        <button
                                            key={bId}
                                            type="button"
                                            onClick={() => setSelectedHudBotId(bId)}
                                            className={`px-2.5 py-1 text-[10.5px] font-mono font-black rounded-lg whitespace-nowrap transition-colors flex-1 cursor-pointer ${
                                                selectedHudBotId === bId
                                                    ? 'bg-cyan-500 text-slate-950'
                                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            Bot #{bId}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Draggable HUD Header */}
                            <div
                                onMouseDown={startHudDrag}
                                className="px-3.5 py-2.5 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing select-none"
                                title="Drag to reposition WallHunter Telemetry HUD"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <svg className="w-3 h-3 text-cyan-500 flex-shrink-0" viewBox="0 0 10 16" fill="currentColor">
                                        <circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/>
                                        <circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/>
                                        <circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/>
                                    </svg>
                                    <span
                                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                            botStatus.position ? 'bg-amber-400' : 'bg-emerald-400'
                                        }`}
                                    />
                                    <span className="text-[11px] font-mono font-black uppercase tracking-wider text-slate-900 dark:text-white truncate">
                                        {botStatus.position
                                            ? `In Position (${botStatus.position_side === 'sell' ? 'SHORT' : 'LONG'})`
                                            : `Bot #${selectedHudBotId} L2 Hunting`}
                                    </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsWallHunterOpen(true);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[9.5px] font-mono font-bold cursor-pointer"
                                        title="Edit Bot Parameters"
                                    >
                                        Tune
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsBotLogsModalOpen(true);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/35 text-purple-700 dark:text-purple-300 text-[9.5px] font-mono font-bold cursor-pointer"
                                        title="Open Execution Logs"
                                    >
                                        Logs
                                    </button>
                                </div>
                            </div>

                            {/* Telemetry Metrics Body */}
                            <div className="p-3 space-y-2.5 text-xs font-mono">
                                {/* Unrealized PnL Strip */}
                                <div className="flex justify-between items-center bg-slate-50 dark:bg-[#050811] px-2.5 py-2 rounded-xl border border-slate-200 dark:border-white/10">
                                    <span className="text-[10.5px] text-slate-500 dark:text-gray-400 font-bold uppercase">
                                        Open PnL
                                    </span>
                                    <span
                                        className={`font-black text-sm ${
                                            (botStatus.pnl || 0) >= 0
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                        }`}
                                    >
                                        ${(botStatus.pnl || 0).toFixed(2)} (
                                        {(botStatus.pnl_percent || 0) > 0 ? '+' : ''}
                                        {(botStatus.pnl_percent || 0).toFixed(2)}%)
                                    </span>
                                </div>

                                {/* Net Realized PnL & Fee Breakdown */}
                                <div className="bg-slate-50 dark:bg-[#050811] p-2.5 rounded-xl border border-slate-200 dark:border-white/10 space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <span className="text-[10px] uppercase text-slate-500 dark:text-gray-400 font-bold flex items-center gap-1">
                                            <span>Net PnL</span>
                                            {botStatus.global_tp_target ? (
                                                <span className="bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.2 rounded text-[8.5px]">
                                                    Goal ${botStatus.global_tp_target}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span
                                            className={`font-black text-xs ${
                                                botStatus.total_pnl && botStatus.total_pnl < 0
                                                    ? 'text-rose-600 dark:text-rose-400'
                                                    : 'text-emerald-600 dark:text-emerald-400'
                                            }`}
                                        >
                                            ${(botStatus.total_pnl || 0).toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center border-t border-slate-200 dark:border-white/10 pt-1 text-[9.5px]">
                                        <span className="text-slate-500 dark:text-gray-400">
                                            Gross: ${(botStatus.total_gross_pnl || 0).toFixed(2)}
                                        </span>
                                        <span className="text-rose-500/90">
                                            Fees: -${(botStatus.total_fees_paid || 0).toFixed(2)}
                                        </span>
                                    </div>
                                </div>

                                {/* 4-Cell Execution Matrix */}
                                {(() => {
                                    const wins = Number(botStatus.total_wins || 0);
                                    const losses = Number(botStatus.total_losses || 0);
                                    const closedCount = wins + losses;
                                    const winRatePct =
                                        closedCount > 0 ? ((wins / closedCount) * 100).toFixed(0) : '--';
                                    return (
                                        <div className="grid grid-cols-3 gap-1.5 text-center">
                                            <div className="bg-slate-50 dark:bg-[#050811] p-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                                                <span className="block text-[9px] text-slate-500 dark:text-gray-400 uppercase">
                                                    Win Rate
                                                </span>
                                                <span className="font-black text-cyan-600 dark:text-cyan-300 text-xs">
                                                    {winRatePct}
                                                    {closedCount > 0 ? '%' : ''}
                                                </span>
                                            </div>
                                            <div className="bg-slate-50 dark:bg-[#050811] p-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                                                <span className="block text-[9px] text-slate-500 dark:text-gray-400 uppercase">
                                                    W / L
                                                </span>
                                                <span className="font-black text-xs">
                                                    <span className="text-emerald-500">{wins}</span>
                                                    <span className="text-gray-500"> / </span>
                                                    <span className="text-rose-500">{losses}</span>
                                                </span>
                                            </div>
                                            <div className="bg-slate-50 dark:bg-[#050811] p-1.5 rounded-lg border border-slate-200 dark:border-white/10">
                                                <span className="block text-[9px] text-slate-500 dark:text-gray-400 uppercase">
                                                    L / S
                                                </span>
                                                <span className="font-black text-xs">
                                                    <span className="text-emerald-500">
                                                        {botStatus.total_longs || 0}
                                                    </span>
                                                    <span className="text-gray-500"> / </span>
                                                    <span className="text-rose-500">
                                                        {botStatus.total_shorts || 0}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {botStatus.position && (
                                    <div className="pt-1 border-t border-slate-200 dark:border-white/10 space-y-2">
                                        <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                                            <div className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex justify-between">
                                                <span className="text-emerald-300">TP</span>
                                                <span className="font-black text-emerald-400">
                                                    {formatDisplayPrice(botStatus.tp_price)}
                                                </span>
                                            </div>
                                            <div className="px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/25 flex justify-between">
                                                <span className="text-rose-300">SL</span>
                                                <span className="font-black text-rose-400">
                                                    {formatDisplayPrice(botStatus.sl_price)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleEmergencySell('market')}
                                                disabled={isEmergencySelling}
                                                className="py-1.5 px-2 text-[10px] font-black rounded-lg bg-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/35 transition-colors uppercase flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                            >
                                                <Zap className="w-3 h-3" />
                                                {botStatus.mode === 'short' ? 'Mkt Close' : 'Mkt Sell'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleEmergencySell('limit')}
                                                disabled={isEmergencySelling}
                                                className="py-1.5 px-2 text-[10px] font-black rounded-lg bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 border border-cyan-500/35 transition-colors uppercase flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                            >
                                                {botStatus.mode === 'short' ? 'Lim Close' : 'Lim Sell'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {!hasFullscreenChart && floatingToolsNode}



            {/* LEVEL 2 ORDER BOOK MODAL & GLOBAL OVERLAYS (Portaled to body at z-[100000] for fullscreen compatibility) */}
            {typeof document !== 'undefined' && createPortal(
                <div className="relative z-[100000]">
                    {isOrderBookModalOpen && (
                        <OrderBookFloatingModal
                            isOpen={isOrderBookModalOpen}
                            onClose={() => setIsOrderBookModalOpen(false)}
                            symbol={symbol}
                        >
                            <OrderBook
                                bids={bids}
                                asks={asks}
                                maxTotal={maxTotal}
                                volumeThreshold={volumeThreshold}
                                onPriceSelect={(px) => {
                                    handleManualTradeClick(activeChartId, activeChart?.symbol || symbol, px);
                                    setManualTradeTrigger(Date.now());
                                    toast.success(`⚡ Snapped L2 price $${formatDisplayPrice(px)} to Manual Trade`);
                                }}
                            />
                        </OrderBookFloatingModal>
                    )}

                    {isBotLogsModalOpen && (
                        <BotLogsFloatingModal
                            isOpen={isBotLogsModalOpen}
                            onClose={() => setIsBotLogsModalOpen(false)}
                            botId={selectedHudBotId}
                        />
                    )}

                    {isWallHunterOpen && (
                        <WallHunterModal
                            isOpen={isWallHunterOpen}
                            onClose={() => setIsWallHunterOpen(false)}
                            symbol={symbol}
                            exchange={exchange}
                            bids={bids}
                            asks={asks}
                            onDeploySuccess={(botId) => {
                                setActiveWallHunterId(Number(botId));
                                setBotForChart('main', Number(botId));
                                setIsWallHunterOpen(false);
                            }}
                        />
                    )}

                    {isForexWallHunterOpen && (
                        <ForexWallHunterModal
                            isOpen={isForexWallHunterOpen}
                            onClose={() => setIsForexWallHunterOpen(false)}
                            onDeploySuccess={(botId) => {
                                setActiveWallHunterId(Number(botId));
                                setBotForChart('main', Number(botId));
                                setIsForexWallHunterOpen(false);
                            }}
                        />
                    )}

                    {isAIDeploymentModalOpen && (
                        <AIModelDeploymentModal
                            isOpen={isAIDeploymentModalOpen}
                            onClose={() => setIsAIDeploymentModalOpen(false)}
                            symbol={symbol}
                            exchange={exchange}
                            onDeploySuccess={(botId) => {
                                setActiveWallHunterId(Number(botId));
                                setIsAIDeploymentModalOpen(false);
                                setActiveTab('heatmap');
                            }}
                        />
                    )}

                    {isTopTokensModalOpen && (
                        <TopTokensModal 
                            isOpen={isTopTokensModalOpen} 
                            onClose={() => setIsTopTokensModalOpen(false)} 
                        />
                    )}

                    {isIndicatorModalOpen && (
                        <TechnicalIndicatorModal
                            isOpen={isIndicatorModalOpen}
                            onClose={() => setIsIndicatorModalOpen(false)}
                            symbol={symbol}
                        />
                    )}
                </div>,
                document.body
            )}
        </div >
    );
};

export default OrderFlowHeatmap;
