import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_EMA_TIMEFRAMES } from '../../../utils/indicators';

export interface SessionSettings {
    show: boolean;
    name: string;
    session: string;
    color: string;
    showRange: boolean;
    showTrendline: boolean;
    showMean: boolean;
    showVWAP: boolean;
    showMaxMin: boolean;
}

export interface IndicatorSettings {
    showEMA: boolean;
    showBB: boolean;
    showRSI: boolean;
    showMACD: boolean;
    showVolume: boolean;
    showAutoFibo: boolean;
    showIchimoku: boolean;
    showTrendFinder: boolean;
    showUTBot: boolean;
    showSessions: boolean;
    showQuantumAI: boolean;
    quantumMinConf: number;
    quantumVolatilityFilter: boolean;
    quantumVolThreshold: number;
    showLiquidationHeatmap: boolean;
    liquidationShowTrueCVD: boolean;
    liquidationShowBiasTag?: boolean;
    liquidationShowDeltaStrip?: boolean;
    liquidationSmartMoneyBias?: boolean;
    liquidationShowSmartMoneyHUD?: boolean;
    emaPeriod: number;
    emaTimeframes?: string[];
    emaRenderMode?: 'smooth' | 'stepped';
    emaCustomColors?: Record<string, string>;
    emaShowPriceLabels?: boolean;
    bbPeriod: number;
    bbStdDev: number;
    rsiPeriod: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    autoFiboLookback: number;
    tenkanPeriod: number;
    kijunPeriod: number;
    senkouBPeriod: number;
    displacement: number;
    trendFinderLookback: number;
    trendFinderDev: number;
    trendFinderThreshold: string;
    enableTrendFinderVolumeFilter: boolean;
    trendFinderVolumeMultiplier: number;
    hideLowConfidenceTrend: boolean;
    utBotSensitivity: number;
    utBotAtrPeriod: number;
    utBotUseHeikinAshi: boolean;
    // ── UT Bot Pro Scalping Extensions ──
    utBotTrendFilter: boolean;
    utBotEmaPeriod: number;
    utBotChopFilter: boolean;
    utBotAdxThreshold: number;
    utBotCandleClose: boolean;
    utBotCooldownBars: number;
    utBotOrderFlowConfirm: boolean;
    utBotHideWeakSignals: boolean;
    utBotShowSLTP: boolean;
    utBotTp1RR: number;
    utBotTp2RR: number;
    utBotRetestSniper: boolean;
    utBotDualMode: boolean;
    utBotSlowSensitivity: number;
    utBotSlowAtrPeriod: number;
    utBotClimaxGuard: boolean;
    utBotMaxExtensionAtr: number;
    utBotPullbackEntry: boolean;
    utBotFakeoutReversal: boolean;
    utBotPresetVersion?: number;
    utBotShowHud: boolean;
    utBotEnableAlerts: boolean;
    sessionA: SessionSettings;
    sessionB: SessionSettings;
    sessionC: SessionSettings;
    sessionD: SessionSettings;
    timezoneOffset: number;
    rangeTransparency: number;
    showOutline: boolean;
    showSessionLabel: boolean;
    showSessionDashboard: boolean;
    advancedDashboard: boolean;
    // ── Smart Money Concepts [LuxAlgo] ──
    showSMC: boolean;
    smcStyle: 'Colored' | 'Monochrome';
    smcMode: 'Historical' | 'Present';
    smcShowInternals: boolean;
    smcInternalBullFilter: 'All' | 'BOS' | 'CHoCH';
    smcInternalBearFilter: 'All' | 'BOS' | 'CHoCH';
    smcConfluenceFilter: boolean;
    smcShowSwing: boolean;
    smcSwingBullFilter: 'All' | 'BOS' | 'CHoCH';
    smcSwingBearFilter: 'All' | 'BOS' | 'CHoCH';
    smcSwingLength: number;
    smcShowStrongWeakHL: boolean;
    smcShowInternalOB: boolean;
    smcInternalOBCount: number;
    smcShowSwingOB: boolean;
    smcSwingOBCount: number;
    smcOBFilter: 'Atr' | 'CumMeanRange';
    smcOBMitigation: 'Close' | 'High/Low';
    smcShowEqualHL: boolean;
    smcEqualHLLength: number;
    smcEqualHLThreshold: number;
    smcShowFVG: boolean;
    smcFVGAutoThreshold: boolean;
    smcFVGExtendBars: number;
    smcShowPDZones: boolean;
    smcL2Validation: boolean;
    smcCVDTrap: boolean;
    smcMicroFVG: boolean;
    smcSweepDetection: boolean;
    smcShowSwingPatterns: boolean;
    // ── Order Flow Visual Overlays ──
    showHeatmap?: boolean;
    showCVD?: boolean;
    showFootprint?: boolean;
    // ── Dual Engine Command Center ──
    // ── Dual Engine Command Center ──
    showDualEngine: boolean;
    dualEngineEmaPeriod: number;
    dualEngineRsiPeriod: number;
    dualEngineRsiOB: number;
    dualEngineRsiOS: number;
    dualEngineMacdFast: number;
    dualEngineMacdSlow: number;
    dualEngineMacdSignal: number;
    dualEngineSqueezeLength: number;
    dualEngineSqueezeBB: number;
    dualEngineSqueezeKC: number;
    dualEngineMode: 'Hybrid' | 'Legacy';
    dualEngineAdxLength: number;
    dualEngineAdxThreshold: number;
    fredApiKey: string;
    showWatchlistScanner: boolean;
    // ── ICT Killzones & Pivots [TFO] ──
    showICTKillzones: boolean;
    ictShowPivots: boolean;
    ictPivotsExtend: 'Until Mitigated' | 'Past Mitigation';
    ictShowDWM: boolean;
    ictShowDailyOpen: boolean;
    ictShowWeeklyOpen: boolean;
    ictShowMonthlyOpen: boolean;
    ictShowMidnightOpen: boolean;
    ictShowOpeningPrices: boolean;
    ictShowTimestamps: boolean;
    ictAsiaSession: string;
    ictLondonSession: string;
    ictNyAmSession: string;
    ictNyLunchSession: string;
    ictNyPmSession: string;
    ictShowSilverBullet: boolean;
    ictShowConfluence: boolean;
    ictShowAMD: boolean;
    ictShowGaps: boolean;
    ictShowVolatility: boolean;
    ictShowEquilibrium: boolean;
    
    // ── ICT Power of Three (PO3) ──
    showICTPO3: boolean;

    // LuxAlgo ICT Concepts Settings
    luxShowIndicator: boolean;
    luxMode: 'Present' | 'Historical';
    luxShowMS: boolean;
    luxSwingLength: number;
    luxShowMSS: boolean;
    luxShowBOS: boolean;
    luxShowDisplacement: boolean;
    luxPercBody: number;
    luxShowVIMB: boolean;
    luxVIMBThreshold: number;
    luxShowOB: boolean;
    luxOBLookback: number;
    luxShowBullOB: number;
    luxShowBearOB: number;
    luxShowOBLabels: boolean;
    luxShowLiq: boolean;
    luxLiqMargin: number;
    luxLiqVisibleCount: number;
    luxShowFVG: boolean;
    luxBPR: boolean;
    luxFVGType: 'FVG' | 'IFVG';
    luxFVGVisibleCount: number;

    // Supertrend Settings
    showSupertrend: boolean;
    supertrendAtrPeriod: number;
    supertrendMultiplier: number;
    supertrendChangeATR: boolean;
    supertrendShowSignals: boolean;
    supertrendHighlighting: boolean;

    luxShowNWOG: boolean;
    luxNWOGMax: number;
    luxShowNDOG: boolean;
    luxNDOGMax: number;
    luxFibMode: 'FVG' | 'BPR' | 'OB' | 'Liq' | 'VI' | 'NWOG' | 'NONE';
    luxFibExtend: boolean;
    luxShowKillzones: boolean;
    liquidationHeatmapIntensity: number;
    liquidationShowBubbles: boolean;
    liquidationShowSignalArrow: boolean;
    liquidationShowTrailingCloud: boolean;
    liquidationShowSpoofing: boolean;
    liquidationShowGEX: boolean;
    liquidationShowBookmap: boolean;
    liquidationBookmapIntensity: number;
    liquidationBookmapHistoryMin?: 15 | 60 | 120;
    liquidationSpoofingThreshold: number;
    liquidationShowMagnetZones?: boolean;
    liquidationShowDeepWalls?: boolean;
    liquidationDeepRangePct?: 5 | 10;
    liquidationShowLeveragePools?: boolean;
    liquidationPoolHorizon?: '24h' | '3d' | '7d';
    liquidationShowTrajectory?: boolean;
    // MSB-OB Settings
    showMsbOb: boolean;
    msbObZigzagLen: number;
    msbObFibFactor: number;
    msbObShowZigzag: boolean;
    msbObDeleteBroken: boolean;
    // Candlestick Patterns
    showCandlestickPatterns: boolean;
    // ── Wick Rejection Support & Resistance ──
    showWickSR: boolean;
    wickSRTimeframe: string;
    wickSRLookback: number;
    wickSRMinTouches: number;
    wickSRAtrPeriod: number;
    wickSRAtrMultiplier: number;
    wickSRShowZones: boolean;
    wickSRShowLabels: boolean;
    // ── VWAP SD Bands ──
    showVWAPSD: boolean;
    vwapSDMultiplier1: number;
    vwapSDMultiplier2: number;
    vwapSDMultiplier3: number;
    vwapAnchor: 'Session' | 'Daily' | 'Weekly';
    // ── Aether Flow System ──
    showAetherFlow: boolean;
    aetherUtBot: boolean;
    aetherSupertrend: boolean;
    aetherSmc: boolean;
    aetherFvg: boolean;
    aetherHull: boolean;
    aetherOrderBlocks: boolean;
    aether3BarReversal: boolean;
    aetherAutoFibo: boolean;
    // ── Liquidity Sweep, Swap & Iceberg Absorption ──
    showLiquiditySweepAbsorption: boolean;
    lsaSweepLookback: number;
    lsaMinAbsorbedUsd: number;
    lsaAbsorptionWindowSec: number;
    lsaMinReloads: number;
    lsaMaxZones: number;
    lsaSignalFilter: 'All' | 'Reversal' | 'Breakdown' | 'Iceberg';
    lsaShowIcebergMarkers: boolean;
    lsaShowLiquiditySwap: boolean;
    lsaShowBreakdownZones: boolean;
    lsaShowHistoricalZones: boolean;
    lsaShowHudSummary: boolean;
    lsaEnableAlerts: boolean;
}

interface IndicatorSelectorProps {
    settings: IndicatorSettings;
    onSettingsChange: (settings: IndicatorSettings) => void;
    showHeatmap?: boolean;
    onToggleHeatmap?: () => void;
    showCVD?: boolean;
    onToggleCVD?: () => void;
    showFootprint?: boolean;
    onToggleFootprint?: () => void;
    compact?: boolean;
    chartLabel?: string;
    usePortal?: boolean;
    onResetAll?: () => void;
}

interface BufferedNumberInputProps {
    value: number;
    min: number;
    max: number;
    integer?: boolean;
    onChange: (val: number) => void;
    className?: string;
    placeholder?: string;
}

/**
 * Buffered numeric input that preserves partial typing (empty, trailing dot, or
 * first digit below `min` like typing `2` before `0` for `20`) and clamps on blur.
 */
const BufferedNumberInput: React.FC<BufferedNumberInputProps> = ({
    value,
    min,
    max,
    integer = false,
    onChange,
    className = '',
    placeholder,
}) => {
    const [local, setLocal] = useState<string>(() => String(value));

    useEffect(() => {
        setLocal(prev => {
            const parsed = integer ? parseInt(prev, 10) : parseFloat(prev);
            return Number.isFinite(parsed) && parsed === value ? prev : String(value);
        });
    }, [value, integer]);

    return (
        <input
            type="text"
            inputMode={integer ? 'numeric' : 'decimal'}
            value={local}
            placeholder={placeholder}
            className={className}
            onChange={(e) => {
                const raw = e.target.value;
                const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/;
                if (!pattern.test(raw)) return;
                setLocal(raw);
                if (raw === '' || raw === '.') return;
                const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
                if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
                    onChange(parsed);
                }
            }}
            onBlur={() => {
                const parsed = integer ? parseInt(local, 10) : parseFloat(local);
                const clamped = Number.isFinite(parsed)
                    ? Math.min(max, Math.max(min, integer ? Math.floor(parsed) : parsed))
                    : value;
                setLocal(String(clamped));
                if (clamped !== value) {
                    onChange(clamped);
                }
            }}
        />
    );
};

export const IndicatorSelector: React.FC<IndicatorSelectorProps> = ({
    settings,
    onSettingsChange,
    showHeatmap,
    onToggleHeatmap,
    showCVD,
    onToggleCVD,
    showFootprint,
    onToggleFootprint,
    compact = false,
    chartLabel,
    usePortal = false,
    onResetAll,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [multiplierLocal, setMultiplierLocal] = useState(settings.trendFinderVolumeMultiplier?.toString() || '1.5');
    const [utBotSensLocal, setUtBotSensLocal] = useState(settings.utBotSensitivity?.toString() || '1');
    const [utBotAtrLocal, setUtBotAtrLocal] = useState(settings.utBotAtrPeriod?.toString() || '10');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const triggerButtonRef = useRef<HTMLButtonElement>(null);
    const portalMenuRef = useRef<HTMLDivElement>(null);
    const [portalPos, setPortalPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

    const isHeatmapActive = showHeatmap !== undefined ? showHeatmap : !!settings.showHeatmap;
    const isCVDActive = showCVD !== undefined ? showCVD : !!settings.showCVD;
    const isFootprintActive = showFootprint !== undefined ? showFootprint : !!settings.showFootprint;

    const activeCount = useMemo(() => {
        const flags = [
            settings.showEMA,
            settings.showBB,
            settings.showRSI,
            settings.showMACD,
            settings.showVolume,
            settings.showAutoFibo,
            settings.showIchimoku,
            settings.showTrendFinder,
            settings.showUTBot,
            settings.showSessions,
            settings.showQuantumAI,
            settings.showLiquidationHeatmap,
            settings.showSMC,
            isHeatmapActive,
            isCVDActive,
            isFootprintActive,
            settings.showDualEngine,
            settings.showWatchlistScanner,
            settings.showICTKillzones,
            settings.showICTPO3,
            settings.luxShowIndicator,
            settings.showSupertrend,
            settings.showMsbOb,
            settings.showCandlestickPatterns,
            settings.showWickSR,
            settings.showVWAPSD,
            settings.showAetherFlow,
            settings.showLiquiditySweepAbsorption,
        ];
        return flags.filter(Boolean).length;
    }, [settings, isHeatmapActive, isCVDActive, isFootprintActive]);

    const computePortalPosition = useCallback(() => {
        if (!usePortal || !triggerButtonRef.current || typeof window === 'undefined') return null;
        const rect = triggerButtonRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const menuWidth = Math.min(340, Math.max(260, vw - 24));
        const margin = 12;

        let left = rect.left;
        if (left + menuWidth > vw - margin) {
            left = Math.max(margin, rect.right - menuWidth);
        }
        if (left < margin) left = margin;

        const spaceBelow = vh - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const preferredHeight = Math.min(540, Math.floor(vh * 0.72));

        let top = rect.bottom + 6;
        let maxHeight = Math.max(220, spaceBelow - 48);

        if (spaceBelow < 280 && spaceAbove > spaceBelow) {
            const actualH = Math.min(preferredHeight, spaceAbove);
            top = Math.max(margin, rect.top - actualH - 6);
            maxHeight = Math.max(200, actualH - 48);
        } else {
            maxHeight = Math.max(220, Math.min(preferredHeight, spaceBelow) - 48);
        }

        return { top, left, width: menuWidth, maxHeight };
    }, [usePortal]);

    const updatePortalPosition = useCallback(() => {
        const next = computePortalPosition();
        if (!next) return;
        setPortalPos(prev => (
            prev &&
            prev.top === next.top &&
            prev.left === next.left &&
            prev.width === next.width &&
            prev.maxHeight === next.maxHeight
                ? prev
                : next
        ));
    }, [computePortalPosition]);

    useLayoutEffect(() => {
        if (!isOpen || !usePortal) return;
        updatePortalPosition();
        window.addEventListener('resize', updatePortalPosition);
        window.addEventListener('scroll', updatePortalPosition, true);
        return () => {
            window.removeEventListener('resize', updatePortalPosition);
            window.removeEventListener('scroll', updatePortalPosition, true);
        };
    }, [isOpen, usePortal, updatePortalPosition]);

    const handleToggleHeatmap = () => {
        if (onToggleHeatmap) {
            onToggleHeatmap();
        } else {
            onSettingsChange({
                ...settings,
                showHeatmap: !isHeatmapActive,
            });
        }
    };

    const handleToggleCVD = () => {
        if (onToggleCVD) {
            onToggleCVD();
        } else {
            onSettingsChange({
                ...settings,
                showCVD: !isCVDActive,
            });
        }
    };

    const handleToggleFootprint = () => {
        if (onToggleFootprint) {
            onToggleFootprint();
        } else {
            onSettingsChange({
                ...settings,
                showFootprint: !isFootprintActive,
            });
        }
    };

    useEffect(() => {
        setMultiplierLocal(settings.trendFinderVolumeMultiplier?.toString() || '1.5');
    }, [settings.trendFinderVolumeMultiplier]);

    useEffect(() => {
        setUtBotSensLocal(prev => {
            const parsed = parseFloat(prev);
            return Number.isFinite(parsed) && parsed === settings.utBotSensitivity
                ? prev
                : String(settings.utBotSensitivity ?? 1);
        });
    }, [settings.utBotSensitivity]);

    useEffect(() => {
        setUtBotAtrLocal(prev => {
            const parsed = parseInt(prev, 10);
            return Number.isFinite(parsed) && parsed === settings.utBotAtrPeriod
                ? prev
                : String(settings.utBotAtrPeriod ?? 10);
        });
    }, [settings.utBotAtrPeriod]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const inTrigger = dropdownRef.current?.contains(target);
            const inPortal = portalMenuRef.current?.contains(target);
            if (!inTrigger && !inPortal) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleIndicator = (key: keyof IndicatorSettings) => {
        onSettingsChange({
            ...settings,
            [key]: !settings[key]
        });
    };

    const updateSetting = (key: keyof IndicatorSettings, value: number) => {
        if (!isNaN(value)) {
            const isPeriod = /period|lookback|length|len|fast|slow|signal|minconf|touches/i.test(String(key));
            const isPositiveFloat = /stddev|dev|mult|multiplier|factor|sensitiv/i.test(String(key));
            let safeValue = value;
            if (isPeriod) {
                safeValue = Math.max(1, Math.floor(value));
            } else if (isPositiveFloat) {
                safeValue = value <= 0 ? 0.1 : value;
            }
            onSettingsChange({
                ...settings,
                [key]: safeValue
            });
        }
    };

    const dropdownMenu = isOpen ? (
        <div
            ref={usePortal ? portalMenuRef : undefined}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={usePortal ? (portalPos ? {
                position: 'fixed',
                top: portalPos.top,
                left: portalPos.left,
                width: portalPos.width,
                zIndex: 100001,
            } : {
                position: 'fixed',
                top: -9999,
                left: -9999,
                visibility: 'hidden',
                zIndex: 100001,
            }) : undefined}
            className={`${usePortal ? '' : 'absolute left-0 sm:left-auto sm:right-0 mt-2 w-[calc(100vw-32px)] max-w-sm sm:w-80 z-50'} bg-white dark:bg-[#0c0e14] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden text-gray-900 dark:text-gray-100`}
        >
            <div className="p-3 border-b border-gray-200 dark:border-white/10 flex items-center justify-between gap-2 bg-gray-50/90 dark:bg-white/[0.02]">
                <div className="flex items-center gap-1.5 min-w-0">
                    <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider truncate">
                        Indicators{chartLabel ? ` · ${chartLabel}` : ''}
                    </h3>
                    {activeCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-primary/15 text-brand-primary font-bold">
                            {activeCount}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {onResetAll && activeCount > 0 && (
                        <button
                            type="button"
                            onClick={onResetAll}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 font-bold transition-colors"
                            title="Turn off all indicators on this chart"
                        >
                            Clear All
                        </button>
                    )}
                    <span className="text-[10px] text-brand-primary font-bold">Pro Multi-Engine</span>
                </div>
            </div>
            <div
                style={usePortal && portalPos ? { maxHeight: portalPos.maxHeight } : undefined}
                className={`p-2 flex flex-col gap-1 ${usePortal ? '' : 'max-h-[75vh]'} overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain`}
            >
                        {/* ── Multi-Timeframe EMA Section ── */}
                        <div className="flex flex-col bg-gray-50/80 dark:bg-white/[0.02] border border-gray-200 dark:border-white/5 rounded-xl p-2.5 transition-all">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showEMA}
                                        onChange={() => toggleIndicator('showEMA')}
                                        className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                    />
                                    <div className="ml-3 flex items-center gap-1.5">
                                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">EMA</span>
                                        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">MTF</span>
                                    </div>
                                </label>
                                <div className="flex items-center gap-1 bg-white dark:bg-white/10 px-2 py-0.5 rounded-lg border border-gray-200 dark:border-white/10 shadow-sm">
                                    <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400">P:</span>
                                    <input
                                        type="number"
                                        value={settings.emaPeriod}
                                        onChange={(e) => updateSetting('emaPeriod', Number(e.target.value))}
                                        className="w-9 text-xs bg-transparent text-gray-800 dark:text-gray-200 text-center font-bold focus:outline-none focus:text-brand-primary"
                                        min={1} max={500}
                                        title="Global EMA Period (e.g. 7, 20, 50, 200)"
                                    />
                                </div>
                            </div>

                            {/* MTF Timeframe Selector Pills & Options */}
                            {settings.showEMA && (
                                <div className="mt-2.5 pt-2 border-t border-gray-200/80 dark:border-white/10 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                                            Active Timeframes ({(settings.emaTimeframes && settings.emaTimeframes.length > 0 ? settings.emaTimeframes : ['1m']).length})
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onSettingsChange({
                                                ...settings,
                                                emaRenderMode: settings.emaRenderMode === 'stepped' ? 'smooth' : 'stepped'
                                            })}
                                            className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium bg-slate-100 hover:bg-slate-200 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 dark:hover:text-white transition-colors"
                                            title="Toggle between Smooth curve and Stepped horizontal levels"
                                        >
                                            Mode: <span className="text-amber-500 dark:text-amber-400 font-bold uppercase">{settings.emaRenderMode || 'smooth'}</span>
                                        </button>
                                    </div>

                                    {/* Timeframe Pills Grid */}
                                    <div className="grid grid-cols-4 gap-1.5">
                                        {Object.entries(DEFAULT_EMA_TIMEFRAMES).map(([tf, tfStyle]) => {
                                            const activeList = settings.emaTimeframes && settings.emaTimeframes.length > 0 ? settings.emaTimeframes : ['1m'];
                                            const isActive = activeList.includes(tf);
                                            return (
                                                <button
                                                    key={tf}
                                                    type="button"
                                                    onClick={() => {
                                                        let next: string[];
                                                        if (isActive) {
                                                            next = activeList.filter(t => t !== tf);
                                                            if (next.length === 0) next = [tf]; // Minimum 1 timeframe active
                                                        } else {
                                                            next = [...activeList, tf];
                                                        }
                                                        onSettingsChange({
                                                            ...settings,
                                                            emaTimeframes: next
                                                        });
                                                    }}
                                                    className={`flex items-center justify-center gap-1.5 py-1 px-1.5 rounded-lg text-xs font-mono font-bold transition-all border ${
                                                        isActive
                                                            ? 'bg-slate-900 text-white dark:bg-black/60 dark:text-white shadow-sm'
                                                            : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-transparent hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-gray-200'
                                                    }`}
                                                    style={{
                                                        borderColor: isActive ? tfStyle.color : 'transparent',
                                                        boxShadow: isActive ? `0 0 10px ${tfStyle.color}25` : undefined
                                                    }}
                                                    title={`Toggle EMA ${settings.emaPeriod} on ${tf}`}
                                                >
                                                    <span
                                                        className="w-1.5 h-1.5 rounded-full shrink-0"
                                                        style={{ backgroundColor: tfStyle.color }}
                                                    />
                                                    <span>{tfStyle.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Presets Row */}
                                    <div className="flex items-center justify-between pt-1 text-[9px] text-gray-500">
                                        <span className="font-semibold text-slate-600 dark:text-gray-400">Presets:</span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => onSettingsChange({ ...settings, emaTimeframes: ['1m', '3m', '5m'] })}
                                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-black/40 dark:hover:bg-white/10 text-slate-700 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white border border-slate-200 dark:border-white/5 transition-colors"
                                            >
                                                Scalp
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onSettingsChange({ ...settings, emaTimeframes: ['5m', '15m', '1h'] })}
                                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-black/40 dark:hover:bg-white/10 text-slate-700 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white border border-slate-200 dark:border-white/5 transition-colors"
                                            >
                                                Intraday
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onSettingsChange({ ...settings, emaTimeframes: ['1h', '4h', '1d'] })}
                                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-black/40 dark:hover:bg-white/10 text-slate-700 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white border border-slate-200 dark:border-white/5 transition-colors"
                                            >
                                                Swing
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => onSettingsChange({ ...settings, emaTimeframes: Object.keys(DEFAULT_EMA_TIMEFRAMES) })}
                                                className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-black/40 dark:hover:bg-white/10 text-slate-700 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white border border-slate-200 dark:border-white/5 transition-colors"
                                            >
                                                All
                                            </button>
                                        </div>
                                    </div>

                                    {/* Show Price Column Labels Checkbox */}
                                    <div className="flex items-center justify-between pt-2 border-t border-gray-200/80 dark:border-white/10">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={settings.emaShowPriceLabels !== false}
                                                onChange={(e) => onSettingsChange({
                                                    ...settings,
                                                    emaShowPriceLabels: e.target.checked
                                                })}
                                                className="w-3.5 h-3.5 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-1 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                            />
                                            <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
                                                Show Price Column Labels
                                            </span>
                                        </label>
                                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${settings.emaShowPriceLabels !== false ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20' : 'text-slate-500 dark:text-gray-500 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5'}`}>
                                            {settings.emaShowPriceLabels !== false ? 'ON' : 'OFF'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showBB}
                                    onChange={() => toggleIndicator('showBB')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Bollinger</span>
                            </label>
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-slate-200 dark:border-transparent">
                                <div className="flex items-center">
                                    <span className="text-xs text-slate-500 dark:text-gray-400 font-semibold">P:</span>
                                    <input
                                        type="number"
                                        value={settings.bbPeriod}
                                        onChange={(e) => updateSetting('bbPeriod', Number(e.target.value))}
                                        className="w-8 text-xs bg-transparent text-slate-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary"
                                        min={1} max={500}
                                    />
                                </div>
                                <div className="flex items-center border-l border-slate-300 dark:border-white/10 pl-2">
                                    <span className="text-xs text-slate-500 dark:text-gray-400 font-semibold">D:</span>
                                    <input
                                        type="number"
                                        value={settings.bbStdDev}
                                        onChange={(e) => updateSetting('bbStdDev', parseFloat(e.target.value))}
                                        className="w-8 text-xs bg-transparent text-slate-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary"
                                        min={0.1} max={10} step={0.1}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showRSI}
                                    onChange={() => toggleIndicator('showRSI')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">RSI</span>
                            </label>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">P:</span>
                                <input
                                    type="number"
                                    value={settings.rsiPeriod}
                                    onChange={(e) => updateSetting('rsiPeriod', Number(e.target.value))}
                                    className="w-10 text-xs bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary"
                                    min={1} max={500}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showMACD}
                                        onChange={() => toggleIndicator('showMACD')}
                                        className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">MACD</span>
                                </label>
                            </div>
                            {settings.showMACD && (
                                <div className="grid grid-cols-3 gap-1 pl-7 text-[10px]">
                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                        <span className="text-gray-500 dark:text-gray-400 font-medium">F:</span>
                                        <input
                                            type="number"
                                            value={settings.macdFast}
                                            onChange={(e) => updateSetting('macdFast', Number(e.target.value))}
                                            className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                            min={1} max={100}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                        <span className="text-gray-500 dark:text-gray-400 font-medium">S:</span>
                                        <input
                                            type="number"
                                            value={settings.macdSlow}
                                            onChange={(e) => updateSetting('macdSlow', Number(e.target.value))}
                                            className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                            min={1} max={200}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                        <span className="text-gray-500 dark:text-gray-400 font-medium">Sig:</span>
                                        <input
                                            type="number"
                                            value={settings.macdSignal}
                                            onChange={(e) => updateSetting('macdSignal', Number(e.target.value))}
                                            className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                            min={1} max={100}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showVolume}
                                    onChange={() => toggleIndicator('showVolume')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Volume</span>
                            </label>
                        </div>

                        <div className="flex items-center justify-between p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showAutoFibo}
                                    onChange={() => toggleIndicator('showAutoFibo')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Auto Fibo</span>
                            </label>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">LB:</span>
                                <input
                                    type="number"
                                    value={settings.autoFiboLookback}
                                    onChange={(e) => updateSetting('autoFiboLookback', Number(e.target.value))}
                                    className="w-10 text-xs bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary"
                                    min={10} max={1000} step={10}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showIchimoku}
                                    onChange={() => toggleIndicator('showIchimoku')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Ichimoku Cloud</span>
                            </label>
                           </div>
                           <div className="grid grid-cols-2 gap-2 text-[10px]">
                                <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-500 dark:text-gray-400 font-medium">T:</span>
                                    <input
                                        type="number"
                                        value={settings.tenkanPeriod}
                                        onChange={(e) => updateSetting('tenkanPeriod', Number(e.target.value))}
                                        className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                        min={1} max={100}
                                    />
                                </div>
                                <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-500 dark:text-gray-400 font-medium">K:</span>
                                    <input
                                        type="number"
                                        value={settings.kijunPeriod}
                                        onChange={(e) => updateSetting('kijunPeriod', Number(e.target.value))}
                                        className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                        min={1} max={200}
                                    />
                                </div>
                                <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-500 dark:text-gray-400 font-medium">B:</span>
                                    <input
                                        type="number"
                                        value={settings.senkouBPeriod}
                                        onChange={(e) => updateSetting('senkouBPeriod', Number(e.target.value))}
                                        className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                        min={1} max={400}
                                    />
                                </div>
                                <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-500 dark:text-gray-400 font-medium">D:</span>
                                    <input
                                        type="number"
                                        value={settings.displacement}
                                        onChange={(e) => updateSetting('displacement', Number(e.target.value))}
                                        className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none focus:text-brand-primary text-center"
                                        min={1} max={100}
                                    />
                                </div>
                           </div>
                        </div>

                        {/* Supertrend Indicator */}
                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showSupertrend}
                                    onChange={() => toggleIndicator('showSupertrend')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Supertrend</span>
                            </label>
                           </div>
                           {settings.showSupertrend && (
                               <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                   <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-medium">Period:</span>
                                            <input
                                                type="number"
                                                value={settings.supertrendAtrPeriod}
                                                onChange={(e) => updateSetting('supertrendAtrPeriod', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-green-500 text-center font-bold"
                                                min={1} max={100}
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-medium">Mult:</span>
                                            <input
                                                type="number"
                                                value={settings.supertrendMultiplier}
                                                onChange={(e) => updateSetting('supertrendMultiplier', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-green-500 text-center font-bold"
                                                min={0.1} max={20} step={0.1}
                                            />
                                        </div>
                                   </div>
                                   <div className="flex flex-col gap-1.5">
                                       <label className="flex items-center gap-2 cursor-pointer">
                                           <input type="checkbox" checked={settings.supertrendChangeATR}
                                               onChange={() => onSettingsChange({...settings, supertrendChangeATR: !settings.supertrendChangeATR})}
                                               className="w-3 h-3 rounded text-green-500" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Standard ATR (RMA)</span>
                                       </label>
                                       <label className="flex items-center gap-2 cursor-pointer">
                                           <input type="checkbox" checked={settings.supertrendShowSignals}
                                               onChange={() => onSettingsChange({...settings, supertrendShowSignals: !settings.supertrendShowSignals})}
                                               className="w-3 h-3 rounded text-green-500" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Show Buy/Sell Signals</span>
                                       </label>
                                       <label className="flex items-center gap-2 cursor-pointer">
                                           <input type="checkbox" checked={settings.supertrendHighlighting}
                                               onChange={() => onSettingsChange({...settings, supertrendHighlighting: !settings.supertrendHighlighting})}
                                               className="w-3 h-3 rounded text-green-500" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Enable Highlighter</span>
                                       </label>
                                   </div>
                               </div>
                           )}
                        </div>

                        {/* MSB-OB Indicator */}
                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showMsbOb}
                                    onChange={() => toggleIndicator('showMsbOb')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">MSB & Order Block</span>
                            </label>
                           </div>
                           {settings.showMsbOb && (
                               <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                   <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-medium">Len:</span>
                                            <input
                                                type="number"
                                                value={settings.msbObZigzagLen}
                                                onChange={(e) => updateSetting('msbObZigzagLen', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-orange-500 text-center font-bold"
                                                min={2} max={100}
                                            />
                                        </div>
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-medium">Fib:</span>
                                            <input
                                                type="number"
                                                value={settings.msbObFibFactor}
                                                onChange={(e) => updateSetting('msbObFibFactor', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-orange-500 text-center font-bold"
                                                min={0.01} max={1} step={0.01}
                                            />
                                        </div>
                                   </div>
                                   <div className="flex flex-col gap-1.5">
                                       <label className="flex items-center gap-2 cursor-pointer">
                                           <input type="checkbox" checked={settings.msbObShowZigzag}
                                               onChange={() => onSettingsChange({...settings, msbObShowZigzag: !settings.msbObShowZigzag})}
                                               className="w-3 h-3 rounded text-orange-500" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Show ZigZag Lines</span>
                                       </label>
                                       <label className="flex items-center gap-2 cursor-pointer">
                                           <input type="checkbox" checked={settings.msbObDeleteBroken}
                                               onChange={() => onSettingsChange({...settings, msbObDeleteBroken: !settings.msbObDeleteBroken})}
                                               className="w-3 h-3 rounded text-orange-500" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Delete Broken Zones</span>
                                       </label>
                                   </div>
                               </div>
                           )}
                        </div>

                        {/* Candlestick Patterns Indicator */}
                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showCandlestickPatterns}
                                    onChange={() => toggleIndicator('showCandlestickPatterns')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Candlestick Patterns</span>
                            </label>
                           </div>
                        </div>
                        
                        {/* SMC Flow Indicator */}
                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showAetherFlow}
                                    onChange={() => toggleIndicator('showAetherFlow')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">SMC Flow</span>
                            </label>
                           </div>
                           {settings.showAetherFlow && (
                               <div className="flex flex-col gap-1.5 pl-7 animate-in slide-in-from-top-1 duration-200">
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherUtBot}
                                           onChange={() => onSettingsChange({...settings, aetherUtBot: !settings.aetherUtBot})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">UT Bot (Signals & Trailing Stop)</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherSupertrend}
                                           onChange={() => onSettingsChange({...settings, aetherSupertrend: !settings.aetherSupertrend})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">Supertrend Filter</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherSmc}
                                           onChange={() => onSettingsChange({...settings, aetherSmc: !settings.aetherSmc})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">SMC (Market Structure)</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherFvg}
                                           onChange={() => onSettingsChange({...settings, aetherFvg: !settings.aetherFvg})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">FVG (Fair Value Gaps)</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherOrderBlocks}
                                           onChange={() => onSettingsChange({...settings, aetherOrderBlocks: !settings.aetherOrderBlocks})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">LuxAlgo Order Blocks</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aether3BarReversal}
                                           onChange={() => onSettingsChange({...settings, aether3BarReversal: !settings.aether3BarReversal})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">3-Bar Reversal Pattern</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherHull}
                                           onChange={() => onSettingsChange({...settings, aetherHull: !settings.aetherHull})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">Hull Suite (HMA Band)</span>
                                   </label>
                                   <label className="flex items-center gap-2 cursor-pointer">
                                       <input type="checkbox" checked={settings.aetherAutoFibo}
                                           onChange={() => onSettingsChange({...settings, aetherAutoFibo: !settings.aetherAutoFibo})}
                                           className="w-3 h-3 rounded text-purple-500" />
                                       <span className="text-[10px] text-gray-600 dark:text-gray-400">Auto Fibo (SMC)</span>
                                   </label>
                               </div>
                           )}
                        </div>

                         {/* Wick Rejection Support & Resistance */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                             <label className="flex items-center cursor-pointer flex-1">
                                 <input
                                     type="checkbox"
                                     checked={settings.showWickSR}
                                     onChange={() => toggleIndicator('showWickSR')}
                                     className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                 />
                                 <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                     Smart Support & Resistance
                                 </span>
                             </label>
                            </div>
                            {settings.showWickSR && (
                                <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent col-span-2">
                                            <span className="text-gray-600 dark:text-gray-400 font-bold">Timeframe:</span>
                                            <select 
                                                value={settings.wickSRTimeframe || '1m'}
                                                onChange={(e) => onSettingsChange({ ...settings, wickSRTimeframe: e.target.value })}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center text-[10px] font-medium"
                                                title="Calculate Support/Resistance on a higher timeframe"
                                            >
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="1m">1 Minute (Default)</option>
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="5m">5 Minutes</option>
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="15m">15 Minutes (Strong)</option>
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="1h">1 Hour (Ultra)</option>
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="4h">4 Hours</option>
                                                <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="1d">1 Day</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-bold">LB:</span>
                                            <input type="number" value={settings.wickSRLookback}
                                                onChange={(e) => updateSetting('wickSRLookback', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={50} max={1000} step={50} title="Lookback candles" />
                                        </div>
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-bold">Min:</span>
                                            <input type="number" value={settings.wickSRMinTouches}
                                                onChange={(e) => updateSetting('wickSRMinTouches', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={3} max={50} step={1} title="Min wick touches" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-bold">ATR P:</span>
                                            <input type="number" value={settings.wickSRAtrPeriod}
                                                onChange={(e) => updateSetting('wickSRAtrPeriod', Number(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={5} max={100} step={1} title="ATR period" />
                                        </div>
                                        <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-gray-600 dark:text-gray-400 font-bold">ATRx:</span>
                                            <input type="number" value={settings.wickSRAtrMultiplier}
                                                onChange={(e) => updateSetting('wickSRAtrMultiplier', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={0.1} max={3.0} step={0.1} title="ATR multiplier" />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1.5">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={settings.wickSRShowZones}
                                                onChange={() => onSettingsChange({ ...settings, wickSRShowZones: !settings.wickSRShowZones })}
                                                className="w-3 h-3 rounded text-cyan-400" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Show Zone Bands</span>
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input type="checkbox" checked={settings.wickSRShowLabels}
                                                onChange={() => onSettingsChange({ ...settings, wickSRShowLabels: !settings.wickSRShowLabels })}
                                                className="w-3 h-3 rounded text-cyan-400" />
                                           <span className="text-[10px] text-gray-600 dark:text-gray-400">Show Axis Labels</span>
                                        </label>
                                    </div>
                                    <div className="bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded p-1.5 text-[9px] text-gray-600 dark:text-gray-400 leading-relaxed">
                                        <span className="text-red-500 font-bold">R</span> Resistance (wick tops) | <span className="text-emerald-500 font-bold">S</span> Support (wick bottoms)<br/>
                                        Strength: weak / strong / ultra | [X] = broken
                                    </div>
                                </div>
                            )}
                         </div>

                         {/* VWAP Standard Deviation Bands */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                             <label className="flex items-center cursor-pointer flex-1">
                                 <input
                                     type="checkbox"
                                     checked={settings.showVWAPSD || false}
                                     onChange={() => toggleIndicator('showVWAPSD')}
                                     className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                 />
                                 <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                     VWAP SD Bands
                                 </span>
                             </label>
                            </div>
                            {settings.showVWAPSD && (
                                <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                        <span className="text-gray-600 dark:text-gray-400 font-bold text-[10px]">Anchor:</span>
                                        <select 
                                            value={settings.vwapAnchor || 'Daily'}
                                            onChange={(e) => onSettingsChange({ ...settings, vwapAnchor: e.target.value as any })}
                                            className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center text-[10px] font-medium"
                                        >
                                            <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Session">Session</option>
                                            <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Daily">Daily (00:00)</option>
                                            <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Weekly">Weekly</option>
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                                        <div className="flex flex-col items-center gap-1 bg-gray-100 dark:bg-white/10 px-1 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-sky-600 dark:text-sky-400 font-bold">1st SD</span>
                                            <input type="number" value={settings.vwapSDMultiplier1 || 1.0}
                                                onChange={(e) => updateSetting('vwapSDMultiplier1', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={0.1} max={5.0} step={0.1} title="Band 1 Multiplier" />
                                        </div>
                                        <div className="flex flex-col items-center gap-1 bg-gray-100 dark:bg-white/10 px-1 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-purple-600 dark:text-purple-400 font-bold">2nd SD</span>
                                            <input type="number" value={settings.vwapSDMultiplier2 || 2.0}
                                                onChange={(e) => updateSetting('vwapSDMultiplier2', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={0.1} max={5.0} step={0.1} title="Band 2 Multiplier" />
                                        </div>
                                        <div className="flex flex-col items-center gap-1 bg-gray-100 dark:bg-white/10 px-1 py-1 rounded border border-gray-200 dark:border-transparent">
                                            <span className="text-red-600 dark:text-red-400 font-bold">3rd SD</span>
                                            <input type="number" value={settings.vwapSDMultiplier3 || 2.5}
                                                onChange={(e) => updateSetting('vwapSDMultiplier3', parseFloat(e.target.value))}
                                                className="w-full bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-center font-bold"
                                                min={0.1} max={5.0} step={0.1} title="Band 3 Multiplier (Extreme)" />
                                        </div>
                                    </div>
                                </div>
                            )}
                         </div>

                        <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showTrendFinder}
                                    onChange={() => toggleIndicator('showTrendFinder')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Adaptive Trend Finder</span>
                            </label>
                           </div>
                           {settings.showTrendFinder && (
                               <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                   <div className="flex items-center gap-2 mt-1">
                                       <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                           <span className="text-gray-600 dark:text-gray-400 text-[10px] font-medium">Lookback:</span>
                                           <input
                                               type="number"
                                               value={settings.trendFinderLookback}
                                               onChange={(e) => updateSetting('trendFinderLookback', Number(e.target.value))}
                                               className="w-12 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-[10px] font-bold"
                                               min={20} max={2000} step={10}
                                           />
                                       </div>
                                       <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-1 rounded border border-gray-200 dark:border-transparent">
                                           <span className="text-gray-600 dark:text-gray-400 text-[10px] font-medium">Dev:</span>
                                           <input
                                               type="number"
                                               value={settings.trendFinderDev}
                                               onChange={(e) => updateSetting('trendFinderDev', Number(e.target.value))}
                                               className="w-10 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-[10px] font-bold"
                                               min={0.1} max={5.0} step={0.1}
                                           />
                                       </div>
                                  </div>
                                  <div className="flex flex-col gap-1 mt-1">
                                       <label className="text-gray-600 dark:text-gray-400 text-[10px] font-bold uppercase">Min. Confidence:</label>
                                       <select 
                                           className="w-full bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/5 rounded p-1 text-gray-800 dark:text-gray-200 text-[10px] focus:outline-none focus:border-brand-primary font-medium"
                                           value={settings.trendFinderThreshold || 'Strong'}
                                           onChange={(e) => onSettingsChange({ ...settings, trendFinderThreshold: e.target.value })}
                                       >
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Moderate">Moderate (0.7+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Moderately Strong">Moderately Strong (0.8+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Mostly Strong">Mostly Strong (0.9+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Strong">Strong (0.92+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Very Strong">Very Strong (0.94+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Exceptionally Strong">Exceptionally Strong (0.96+)</option>
                                           <option className="bg-white dark:bg-[#0c0e14] text-gray-900 dark:text-gray-100" value="Ultra Strong">Ultra Strong (0.98+)</option>
                                       </select>
                                  </div>
                                  <div className="flex flex-col gap-1 mt-1">
                                       <label className="flex items-center cursor-pointer group">
                                           <input
                                               type="checkbox"
                                               checked={settings.hideLowConfidenceTrend}
                                               onChange={() => onSettingsChange({ ...settings, hideLowConfidenceTrend: !settings.hideLowConfidenceTrend })}
                                               className="w-3.5 h-3.5 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                           />
                                           <span className="ml-2 text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase group-hover:text-brand-primary transition-colors italic">Hide Below Min. Conf.</span>
                                       </label>
                                  </div>
                                  <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-gray-200/80 dark:border-white/5">
                                       <label className="flex items-center cursor-pointer group">
                                           <input
                                               type="checkbox"
                                               checked={settings.enableTrendFinderVolumeFilter}
                                               onChange={() => onSettingsChange({ ...settings, enableTrendFinderVolumeFilter: !settings.enableTrendFinderVolumeFilter })}
                                               className="w-3.5 h-3.5 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                           />
                                           <span className="ml-2 text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase group-hover:text-brand-primary transition-colors italic">Volume Filter (Confirmation)</span>
                                       </label>
                                       {settings.enableTrendFinderVolumeFilter && (
                                           <div className="flex items-center justify-between bg-gray-100 dark:bg-white/5 p-1.5 rounded border border-gray-200 dark:border-transparent animate-fadeIn">
                                               <span className="text-[10px] text-gray-600 dark:text-gray-400 font-medium">Multiplier:</span>
                                               <input
                                                   type="text"
                                                   value={multiplierLocal}
                                                   onChange={(e) => {
                                                       const val = e.target.value;
                                                       if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                           setMultiplierLocal(val);
                                                           const num = parseFloat(val);
                                                           if (!isNaN(num)) {
                                                               onSettingsChange({ ...settings, trendFinderVolumeMultiplier: num });
                                                           }
                                                       }
                                                   }}
                                                   className="w-12 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none text-[10px] text-right font-mono font-bold"
                                                   placeholder="1.5"
                                               />
                                           </div>
                                       )}
                                  </div>
                               </div>
                           )}
                         </div>
                         
                         {/* UT Bot Alerts Block */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showUTBot}
                                    onChange={() => toggleIndicator('showUTBot')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">UT Bot Alerts</span>
                            </label>
                           </div>
                           
                            <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-600 dark:text-gray-400 text-[10px] font-bold">Key Value:</span>
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        value={utBotSensLocal}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                                setUtBotSensLocal(val);
                                                const parsed = parseFloat(val);
                                                if (Number.isFinite(parsed) && parsed > 0) {
                                                    const clamped = Math.min(100, Math.max(0.1, parsed));
                                                    onSettingsChange({ ...settings, utBotSensitivity: clamped });
                                                }
                                            }
                                        }}
                                        onBlur={() => {
                                            const parsed = parseFloat(utBotSensLocal);
                                            const safe = Number.isFinite(parsed) && parsed > 0
                                                ? Math.min(100, Math.max(0.1, parsed))
                                                : (settings.utBotSensitivity || 1);
                                            setUtBotSensLocal(String(safe));
                                            if (safe !== settings.utBotSensitivity) {
                                                onSettingsChange({ ...settings, utBotSensitivity: safe });
                                            }
                                        }}
                                        className="w-12 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-[10px] text-right font-bold"
                                        placeholder="1"
                                    />
                                </div>
                                <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                    <span className="text-gray-600 dark:text-gray-400 text-[10px] font-bold">ATR P:</span>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={utBotAtrLocal}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || /^\d+$/.test(val)) {
                                                setUtBotAtrLocal(val);
                                                const parsed = parseInt(val, 10);
                                                if (Number.isFinite(parsed) && parsed >= 1) {
                                                    const clamped = Math.min(200, Math.max(1, parsed));
                                                    onSettingsChange({ ...settings, utBotAtrPeriod: clamped });
                                                }
                                            }
                                        }}
                                        onBlur={() => {
                                            const parsed = parseInt(utBotAtrLocal, 10);
                                            const safe = Number.isFinite(parsed) && parsed >= 1
                                                ? Math.min(200, Math.max(1, parsed))
                                                : (settings.utBotAtrPeriod || 10);
                                            setUtBotAtrLocal(String(safe));
                                            if (safe !== settings.utBotAtrPeriod) {
                                                onSettingsChange({ ...settings, utBotAtrPeriod: safe });
                                            }
                                        }}
                                        className="w-10 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none focus:text-brand-primary text-[10px] text-right font-bold"
                                        placeholder="10"
                                    />
                                </div>
                           </div>
                           
                           <div className="flex flex-col gap-1 mt-1">
                                <label className="flex items-center cursor-pointer group">
                                    <input
                                        type="checkbox"
                                        checked={settings.utBotUseHeikinAshi}
                                        onChange={() => onSettingsChange({ ...settings, utBotUseHeikinAshi: !settings.utBotUseHeikinAshi })}
                                        className="w-3.5 h-3.5 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                    />
                                    <span className="ml-2 text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase group-hover:text-brand-primary transition-colors italic">Heikin Ashi Signal (Pine)</span>
                                </label>
                           </div>

                           {settings.showUTBot && (
                               <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-gray-200/80 dark:border-white/10 pl-1 text-[10px]">
                                   <div className="flex items-center justify-between gap-1">
                                       <span className="text-[9px] font-extrabold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                                           Pro Scalping Controls
                                       </span>
                                       <button
                                           type="button"
                                           onClick={() => onSettingsChange({
                                               ...settings,
                                               utBotSensitivity: 1.5,
                                               utBotAtrPeriod: 14,
                                               utBotUseHeikinAshi: true,
                                               utBotChopFilter: true,
                                               utBotAdxThreshold: 22,
                                               utBotCooldownBars: 2,
                                               utBotOrderFlowConfirm: true,
                                               utBotShowSLTP: true,
                                               utBotTp1RR: 1.5,
                                               utBotTp2RR: 2.5,
                                               utBotRetestSniper: true,
                                               utBotDualMode: true,
                                               utBotSlowSensitivity: 3,
                                               utBotSlowAtrPeriod: 20,
                                               utBotClimaxGuard: true,
                                               utBotMaxExtensionAtr: 1.6,
                                               utBotPullbackEntry: true,
                                               utBotFakeoutReversal: true,
                                           })}
                                           title="Apply Recommended Pro BTC/USDC Futures Scalping Preset"
                                           className="px-1.5 py-0.5 rounded bg-purple-500/15 hover:bg-purple-500/25 text-purple-600 dark:text-purple-300 border border-purple-500/30 text-[8.5px] font-bold cursor-pointer transition-colors"
                                       >
                                           ⚡ Pro BTC Preset
                                       </button>
                                   </div>

                                   {/* Game-Changer 1: Climax Spike Guard */}
                                   <div className="flex items-center justify-between gap-2">
                                       <label className="flex items-center gap-1.5 cursor-pointer flex-1" title="Blocks buying the top / selling the bottom of huge climax expansion candles">
                                           <input
                                               type="checkbox"
                                               checked={settings.utBotClimaxGuard !== false}
                                               onChange={() => onSettingsChange({ ...settings, utBotClimaxGuard: settings.utBotClimaxGuard === false })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Climax Spike Guard</span>
                                       </label>
                                       {settings.utBotClimaxGuard !== false && (
                                           <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded" title="Max candle ATR multiple before deferring entry for pullback">
                                               <span className="text-[9px] text-gray-500">Max×ATR</span>
                                               <BufferedNumberInput
                                                   min={0.8} max={5}
                                                   value={settings.utBotMaxExtensionAtr ?? 1.6}
                                                   onChange={(v) => onSettingsChange({ ...settings, utBotMaxExtensionAtr: v })}
                                                   className="w-8 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                               />
                                           </div>
                                       )}
                                   </div>

                                   {/* Game-Changer 2: Delayed Pullback (Dip Sniper) */}
                                   <label className="flex items-center gap-1.5 cursor-pointer" title="Waits for the post-signal opposite pullback dip before firing DIP BUY / DIP SELL">
                                       <input
                                           type="checkbox"
                                           checked={settings.utBotPullbackEntry !== false}
                                           onChange={() => onSettingsChange({ ...settings, utBotPullbackEntry: settings.utBotPullbackEntry === false })}
                                           className="w-3 h-3 rounded text-cyan-500 cursor-pointer"
                                       />
                                       <span className="text-gray-700 dark:text-gray-300 font-semibold">Delayed Pullback (Dip Entry)</span>
                                   </label>

                                   {/* Game-Changer 3: Liquidity Sweep Fakeout Reversal */}
                                   <label className="flex items-center gap-1.5 cursor-pointer" title="Fades trapped stop-hunt breakouts in chop/exhaustion with SWEEP L / SWEEP S">
                                       <input
                                           type="checkbox"
                                           checked={settings.utBotFakeoutReversal !== false}
                                           onChange={() => onSettingsChange({ ...settings, utBotFakeoutReversal: settings.utBotFakeoutReversal === false })}
                                           className="w-3 h-3 rounded text-purple-500 cursor-pointer"
                                       />
                                       <span className="text-gray-700 dark:text-gray-300 font-semibold">Sweep Fakeout Reversal</span>
                                   </label>

                                   {/* 1. EMA Trend Filter */}
                                   <div className="flex items-center justify-between gap-2">
                                       <label className="flex items-center gap-1.5 cursor-pointer flex-1">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotTrendFilter)}
                                               onChange={() => onSettingsChange({ ...settings, utBotTrendFilter: !settings.utBotTrendFilter })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">EMA Trend Filter</span>
                                       </label>
                                       {settings.utBotTrendFilter && (
                                           <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                               <span className="text-[9px] text-gray-500">EMA</span>
                                               <BufferedNumberInput
                                                   min={5} max={500} integer
                                                   value={settings.utBotEmaPeriod ?? 50}
                                                   onChange={(v) => onSettingsChange({ ...settings, utBotEmaPeriod: v })}
                                                   className="w-10 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                               />
                                           </div>
                                       )}
                                   </div>

                                   {/* 2. Anti-Chop ADX Filter */}
                                   <div className="flex items-center justify-between gap-2">
                                       <label className="flex items-center gap-1.5 cursor-pointer flex-1">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotChopFilter)}
                                               onChange={() => onSettingsChange({ ...settings, utBotChopFilter: !settings.utBotChopFilter })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Anti-Chop (ADX)</span>
                                       </label>
                                       {settings.utBotChopFilter && (
                                           <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                               <span className="text-[9px] text-gray-500">Min</span>
                                               <BufferedNumberInput
                                                   min={5} max={60} integer
                                                   value={settings.utBotAdxThreshold ?? 20}
                                                   onChange={(v) => onSettingsChange({ ...settings, utBotAdxThreshold: v })}
                                                   className="w-9 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                               />
                                           </div>
                                       )}
                                   </div>

                                   {/* 3. Candle Close & Cooldown */}
                                   <div className="flex items-center justify-between gap-2">
                                       <label className="flex items-center gap-1.5 cursor-pointer flex-1">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotCandleClose)}
                                               onChange={() => onSettingsChange({ ...settings, utBotCandleClose: !settings.utBotCandleClose })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Candle Close Only</span>
                                       </label>
                                       <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded" title="Min bars cooldown between opposite flips">
                                           <span className="text-[9px] text-gray-500">CD</span>
                                           <BufferedNumberInput
                                               min={0} max={20} integer
                                               value={settings.utBotCooldownBars ?? 0}
                                               onChange={(v) => onSettingsChange({ ...settings, utBotCooldownBars: v })}
                                               className="w-8 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                           />
                                       </div>
                                   </div>

                                   {/* 4. Order Flow & L2 Grading */}
                                   <div className="flex items-center justify-between gap-2">
                                       <label className="flex items-center gap-1.5 cursor-pointer flex-1">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotOrderFlowConfirm)}
                                               onChange={() => onSettingsChange({ ...settings, utBotOrderFlowConfirm: !settings.utBotOrderFlowConfirm })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Order Flow Grading</span>
                                       </label>
                                       {settings.utBotOrderFlowConfirm && (
                                           <label className="flex items-center gap-1 cursor-pointer text-[9px] text-gray-500 dark:text-gray-400">
                                               <input
                                                   type="checkbox"
                                                   checked={Boolean(settings.utBotHideWeakSignals)}
                                                   onChange={() => onSettingsChange({ ...settings, utBotHideWeakSignals: !settings.utBotHideWeakSignals })}
                                                   className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                               />
                                               <span>Hide Weak</span>
                                           </label>
                                       )}
                                   </div>

                                   {/* 5. Retest Sniper */}
                                   <label className="flex items-center gap-1.5 cursor-pointer">
                                       <input
                                           type="checkbox"
                                           checked={Boolean(settings.utBotRetestSniper)}
                                           onChange={() => onSettingsChange({ ...settings, utBotRetestSniper: !settings.utBotRetestSniper })}
                                           className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                       />
                                       <span className="text-gray-700 dark:text-gray-300 font-semibold">Retest Sniper Entries</span>
                                   </label>

                                   {/* 6. Auto SL / TP Levels */}
                                   <div className="flex flex-col gap-1">
                                       <label className="flex items-center gap-1.5 cursor-pointer">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotShowSLTP)}
                                               onChange={() => onSettingsChange({ ...settings, utBotShowSLTP: !settings.utBotShowSLTP })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Auto SL / TP1 / TP2 Lines</span>
                                       </label>
                                       {settings.utBotShowSLTP && (
                                           <div className="flex items-center gap-2 pl-4">
                                               <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                                   <span className="text-[9px] text-gray-500">TP1 R:</span>
                                                   <BufferedNumberInput
                                                       min={0.5} max={10}
                                                       value={settings.utBotTp1RR ?? 1.5}
                                                       onChange={(v) => onSettingsChange({ ...settings, utBotTp1RR: v })}
                                                       className="w-9 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                                   />
                                               </div>
                                               <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                                   <span className="text-[9px] text-gray-500">TP2 R:</span>
                                                   <BufferedNumberInput
                                                       min={1} max={15}
                                                       value={settings.utBotTp2RR ?? 2.5}
                                                       onChange={(v) => onSettingsChange({ ...settings, utBotTp2RR: v })}
                                                       className="w-9 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                                   />
                                               </div>
                                           </div>
                                       )}
                                   </div>

                                   {/* 7. Dual UT Bot (Slow Macro + Fast Trigger) */}
                                   <div className="flex flex-col gap-1">
                                       <label className="flex items-center gap-1.5 cursor-pointer">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotDualMode)}
                                               onChange={() => onSettingsChange({ ...settings, utBotDualMode: !settings.utBotDualMode })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Dual-UT Trend Mode</span>
                                       </label>
                                       {settings.utBotDualMode && (
                                           <div className="flex items-center gap-2 pl-4">
                                               <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                                   <span className="text-[9px] text-gray-500">Slow Key:</span>
                                                   <BufferedNumberInput
                                                       min={0.5} max={100}
                                                       value={settings.utBotSlowSensitivity ?? 3}
                                                       onChange={(v) => onSettingsChange({ ...settings, utBotSlowSensitivity: v })}
                                                       className="w-9 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                                   />
                                               </div>
                                               <div className="flex items-center justify-between w-1/2 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded">
                                                   <span className="text-[9px] text-gray-500">Slow ATR:</span>
                                                   <BufferedNumberInput
                                                       min={2} max={200} integer
                                                       value={settings.utBotSlowAtrPeriod ?? 20}
                                                       onChange={(v) => onSettingsChange({ ...settings, utBotSlowAtrPeriod: v })}
                                                       className="w-9 bg-transparent text-right font-bold text-gray-800 dark:text-gray-200 focus:outline-none"
                                                   />
                                               </div>
                                           </div>
                                       )}
                                   </div>

                                   {/* 8. Win-Rate HUD & Live Alerts */}
                                   <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-200/60 dark:border-white/5">
                                       <label className="flex items-center gap-1.5 cursor-pointer">
                                           <input
                                               type="checkbox"
                                               checked={settings.utBotShowHud !== false}
                                               onChange={() => onSettingsChange({ ...settings, utBotShowHud: settings.utBotShowHud === false })}
                                               className="w-3 h-3 rounded text-brand-primary cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Win-Rate HUD</span>
                                       </label>
                                       <label className="flex items-center gap-1.5 cursor-pointer">
                                           <input
                                               type="checkbox"
                                               checked={Boolean(settings.utBotEnableAlerts)}
                                               onChange={() => onSettingsChange({ ...settings, utBotEnableAlerts: !settings.utBotEnableAlerts })}
                                               className="w-3 h-3 rounded text-amber-500 cursor-pointer"
                                           />
                                           <span className="text-gray-700 dark:text-gray-300 font-semibold">Sound & Toast</span>
                                       </label>
                                   </div>
                               </div>
                           )}
                         </div>

                         {/* ── Quantum AI v8 Block ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                           <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showQuantumAI}
                                    onChange={() => toggleIndicator('showQuantumAI')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Quantum AI v8</span>
                            </label>
                           </div>

                           {settings.showQuantumAI && (
                               <div className="flex flex-col gap-2 mt-1 text-[10px]">
                                    <div className="flex items-center justify-between bg-gray-100 dark:bg-white/10 px-2 py-1.5 rounded-lg border border-gray-200 dark:border-transparent">
                                        <span className="text-gray-600 dark:text-gray-400 font-bold uppercase">Min Confidence</span>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                value={settings.quantumMinConf}
                                                onChange={(e) => updateSetting('quantumMinConf', Number(e.target.value))}
                                                className="w-12 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none text-right font-mono font-bold"
                                                min={0} max={100} step={5}
                                            />
                                            <span className="text-gray-500 font-bold">%</span>
                                        </div>
                                    </div>
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-transparent hover:border-brand-primary/30 transition-all">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <label className="flex items-center cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.quantumVolatilityFilter}
                                                    onChange={() => onSettingsChange({ ...settings, quantumVolatilityFilter: !settings.quantumVolatilityFilter })}
                                                    className="w-3.5 h-3.5 text-brand-primary bg-white border-gray-300 rounded cursor-pointer"
                                                />
                                                <span className="ml-2 font-bold text-gray-600 dark:text-gray-400 uppercase group-hover:text-brand-primary transition-colors">Volatility Filter</span>
                                            </label>
                                        </div>
                                        {settings.quantumVolatilityFilter && (
                                            <div className="flex items-center justify-between bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-2 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">ATR Vol Threshold %:</span>
                                                <input
                                                    type="number"
                                                    value={settings.quantumVolThreshold}
                                                    onChange={(e) => updateSetting('quantumVolThreshold', parseFloat(e.target.value))}
                                                    className="w-12 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none text-right font-mono font-bold"
                                                    min={0.05} max={5.0} step={0.05}
                                                />
                                            </div>
                                        )}
                                    </div>
                               </div>
                           )}
                         </div>

                         {/* Sessions Block */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                             <label className="flex items-center cursor-pointer flex-1">
                                 <input
                                     type="checkbox"
                                     checked={settings.showSessions}
                                     onChange={() => toggleIndicator('showSessions')}
                                     className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                 />
                                 <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">Sessions [LuxAlgo]</span>
                             </label>
                            </div>

                            {settings.showSessions && (
                                <>
                                    <div className="flex flex-col gap-3 mt-2">
                                        {[
                                            { key: 'sessionA', label: 'Session A' },
                                            { key: 'sessionB', label: 'Session B' },
                                            { key: 'sessionC', label: 'Session C' },
                                            { key: 'sessionD', label: 'Session D' }
                                        ].map(({ key, label }) => {
                                            const sess = settings[key as keyof IndicatorSettings] as SessionSettings;
                                            return (
                                                <div key={key} className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200/80 dark:border-transparent hover:border-brand-primary/30 transition-all">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={sess.show}
                                                                onChange={() => onSettingsChange({
                                                                    ...settings,
                                                                    [key]: { ...sess, show: !sess.show }
                                                                })}
                                                                className="w-3.5 h-3.5 rounded text-brand-primary cursor-pointer"
                                                            />
                                                            <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{sess.name}</span>
                                                        </div>
                                                        <input
                                                            type="color"
                                                            value={sess.color}
                                                            onChange={(e) => onSettingsChange({
                                                                ...settings,
                                                                [key]: { ...sess, color: e.target.value }
                                                            })}
                                                            className="w-4 h-4 rounded cursor-pointer border-none bg-transparent"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-[10px] text-gray-600 dark:text-gray-400 font-bold">Time:</span>
                                                        <input
                                                            type="text"
                                                            value={sess.session}
                                                            onChange={(e) => onSettingsChange({
                                                                ...settings,
                                                                [key]: { ...sess, session: e.target.value }
                                                            })}
                                                            className="flex-1 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1.5 py-0.5 text-[10px] text-gray-800 dark:text-gray-200 focus:outline-none focus:border-brand-primary font-mono"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                                                        {[
                                                            { skey: 'showRange', slabel: 'Range' },
                                                            { skey: 'showTrendline', slabel: 'LinReg' },
                                                            { skey: 'showMean', slabel: 'Mean' },
                                                            { skey: 'showVWAP', slabel: 'VWAP' },
                                                            { skey: 'showMaxMin', slabel: 'Max/Min' }
                                                        ].map(({ skey, slabel }) => (
                                                            <label key={skey} className="flex items-center gap-1.5 cursor-pointer group/item">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={sess[skey as keyof SessionSettings] as boolean}
                                                                    onChange={() => onSettingsChange({
                                                                        ...settings,
                                                                        [key]: { ...sess, [skey]: !(sess[skey as keyof SessionSettings]) }
                                                                    })}
                                                                    className="w-2.5 h-2.5 rounded text-brand-primary cursor-pointer"
                                                                />
                                                                <span className="text-[9px] text-gray-600 dark:text-gray-400 group-hover/item:text-brand-primary transition-colors">{slabel}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="mt-2 space-y-2 border-t border-gray-200/80 dark:border-white/5 pt-2">
                                       <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-gray-600 dark:text-gray-400 font-bold">Timezone UTC (+/-):</span>
                                            <input
                                                type="number"
                                                value={settings.timezoneOffset / 60}
                                                onChange={(e) => onSettingsChange({ ...settings, timezoneOffset: Number(e.target.value) * 60 })}
                                                className="w-12 bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-transparent rounded px-1.5 py-0.5 text-[10px] text-gray-800 dark:text-gray-200 focus:outline-none font-bold"
                                            />
                                       </div>
                                       <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-gray-600 dark:text-gray-400 font-bold">Range Alpha (0-100):</span>
                                            <input
                                                type="number"
                                                value={settings.rangeTransparency}
                                                onChange={(e) => onSettingsChange({ ...settings, rangeTransparency: Number(e.target.value) })}
                                                className="w-12 bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-transparent rounded px-1.5 py-0.5 text-[10px] text-gray-800 dark:text-gray-200 focus:outline-none font-bold"
                                                min={0} max={100}
                                            />
                                       </div>
                                       <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { skey: 'showOutline', slabel: 'Outline' },
                                                { skey: 'showSessionLabel', slabel: 'Labels' },
                                                { skey: 'showSessionDashboard', slabel: 'Dashboard' },
                                                { skey: 'advancedDashboard', slabel: 'Advanced Info' }
                                            ].map(({ skey, slabel }) => (
                                                <label key={skey} className="flex items-center gap-2 cursor-pointer group">
                                                    <input
                                                        type="checkbox"
                                                        checked={settings[skey as keyof IndicatorSettings] as boolean}
                                                        onChange={() => onSettingsChange({ ...settings, [skey]: !settings[skey as keyof IndicatorSettings] })}
                                                        className="w-3.5 h-3.5 rounded text-brand-primary cursor-pointer"
                                                    />
                                                    <span className="text-[10px] text-gray-600 dark:text-gray-400 group-hover:text-brand-primary transition-colors uppercase font-bold">{slabel}</span>
                                                </label>
                                            ))}
                                       </div>
                                    </div>
                                </>
                            )}
                         </div>

                         {/* ── Dual Engine Command Center Block ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showDualEngine}
                                        onChange={() => toggleIndicator('showDualEngine')}
                                        className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                        Command Center HUD
                                    </span>
                                </label>
                                <div className="flex rounded overflow-hidden border border-gray-200 dark:border-white/10 text-[9px] ml-2">
                                    {(['Hybrid', 'Legacy'] as const).map(s => (
                                        <button key={s}
                                            onClick={() => onSettingsChange({ ...settings, dualEngineMode: s })}
                                            className={`px-1.5 py-0.5 font-bold transition-all ${
                                                settings.dualEngineMode === s ? 'bg-cyan-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5'}`}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {settings.showDualEngine && (
                                <div className="flex flex-col gap-2 mt-2 text-[10px]">
                                    
                                    {settings.dualEngineMode === 'Legacy' && (
                                        <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-amber-500/30">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-amber-600 dark:text-amber-400 font-bold uppercase text-[9px]">FRED API Key (For US CPI Data)</span>
                                                <input type="password" value={settings.fredApiKey || ''}
                                                    onChange={e => onSettingsChange({ ...settings, fredApiKey: e.target.value })}
                                                    className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1.5 py-1 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-amber-500 font-mono" placeholder="Enter API Key from fred.stlouisfed.org" />
                                            </div>
                                        </div>
                                    )}
                                    {/* EMA & RSI */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/5">
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <div className="flex items-center justify-between bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-bold">EMA Length:</span>
                                                <input type="number" value={settings.dualEngineEmaPeriod}
                                                    onChange={e => updateSetting('dualEngineEmaPeriod', Number(e.target.value))}
                                                    className="w-10 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none text-right font-bold" min={1} max={500} />
                                            </div>
                                            <div className="flex items-center justify-between bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-bold">RSI Period:</span>
                                                <input type="number" value={settings.dualEngineRsiPeriod}
                                                    onChange={e => updateSetting('dualEngineRsiPeriod', Number(e.target.value))}
                                                    className="w-10 bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none text-right font-bold" min={2} max={200} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="flex items-center justify-between bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-bold">RSI OB:</span>
                                                <input type="number" value={settings.dualEngineRsiOB}
                                                    onChange={e => updateSetting('dualEngineRsiOB', Number(e.target.value))}
                                                    className="w-10 bg-transparent text-red-500 font-bold focus:outline-none text-right" min={50} max={100} />
                                            </div>
                                            <div className="flex items-center justify-between bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1.5 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-bold">RSI OS:</span>
                                                <input type="number" value={settings.dualEngineRsiOS}
                                                    onChange={e => updateSetting('dualEngineRsiOS', Number(e.target.value))}
                                                    className="w-10 bg-transparent text-emerald-500 font-bold focus:outline-none text-right" min={0} max={50} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* MACD */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/5">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5 text-[9px]">MACD Settings</p>
                                        <div className="grid grid-cols-3 gap-1">
                                            <div className="flex items-center gap-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">Fast:</span>
                                                <input type="number" value={settings.dualEngineMacdFast}
                                                    onChange={e => updateSetting('dualEngineMacdFast', Number(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" min={1} />
                                            </div>
                                            <div className="flex items-center gap-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">Slow:</span>
                                                <input type="number" value={settings.dualEngineMacdSlow}
                                                    onChange={e => updateSetting('dualEngineMacdSlow', Number(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" min={2} />
                                            </div>
                                            <div className="flex items-center gap-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 font-medium">Sig:</span>
                                                <input type="number" value={settings.dualEngineMacdSignal}
                                                    onChange={e => updateSetting('dualEngineMacdSignal', Number(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" min={1} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Squeeze */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-200 dark:border-white/5">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5 text-[9px]">Squeeze Breakout</p>
                                        <div className="grid grid-cols-3 gap-1">
                                            <div className="flex flex-col bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 text-[8px] uppercase font-bold">Length</span>
                                                <input type="number" value={settings.dualEngineSqueezeLength}
                                                    onChange={e => updateSetting('dualEngineSqueezeLength', Number(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" min={5} />
                                            </div>
                                            <div className="flex flex-col bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 text-[8px] uppercase font-bold">BB Mult</span>
                                                <input type="number" value={settings.dualEngineSqueezeBB}
                                                    onChange={e => updateSetting('dualEngineSqueezeBB', parseFloat(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" step={0.1} />
                                            </div>
                                            <div className="flex flex-col bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded px-1 py-1">
                                                <span className="text-gray-600 dark:text-gray-400 text-[8px] uppercase font-bold">KC Mult</span>
                                                <input type="number" value={settings.dualEngineSqueezeKC}
                                                    onChange={e => updateSetting('dualEngineSqueezeKC', parseFloat(e.target.value))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-bold focus:outline-none" step={0.1} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                         </div>

                         {/* ── Watchlist Scanner ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-100/60 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-200/80 dark:border-white/5 mt-1 pt-3">
                            <label className="flex items-center cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    checked={settings.showWatchlistScanner}
                                    onChange={() => toggleIndicator('showWatchlistScanner')}
                                    className="w-4 h-4 text-brand-primary bg-white border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                />
                                <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                    Watchlist Scanner (Multi-Pair)
                                </span>
                            </label>
                        </div>

                         {/* ── God Mode Liquidation Heatmap ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showLiquidationHeatmap}
                                        onChange={() => toggleIndicator('showLiquidationHeatmap')}
                                        className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                        🔥 Liquidation Heatmap [God Mode]
                                    </span>
                                </label>
                                {settings.showLiquidationHeatmap && (
                                     <button
                                         onClick={(e) => { 
                                             e.stopPropagation(); 
                                             const content = e.currentTarget.parentElement?.nextElementSibling as HTMLElement;
                                             if (content) content.classList.toggle('hidden');
                                         }}
                                         className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                                     >
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                     </button>
                                )}
                            </div>

                            {settings.showLiquidationHeatmap && (
                                <div className="pl-7 pr-2 py-2 flex flex-col gap-3 animate-fadeIn text-[10px]">
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-gray-700 dark:text-gray-300 font-semibold group-hover:text-gray-900 dark:group-hover:text-white transition-colors">L2 Magnet Zones 🧲</span>
                                            <input type="checkbox" checked={settings.liquidationShowMagnetZones !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowMagnetZones: settings.liquidationShowMagnetZones === false ? true : false })} className="w-3 h-3 rounded" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-sky-600 dark:text-sky-400 font-semibold group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">Global Deep Walls (4-Ex) 🌐</span>
                                            <input type="checkbox" checked={settings.liquidationShowDeepWalls !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowDeepWalls: settings.liquidationShowDeepWalls === false ? true : false })} className="w-3 h-3 rounded text-sky-500 focus:ring-sky-500" />
                                        </label>
                                        {settings.liquidationShowDeepWalls !== false && (
                                            <div className="flex items-center justify-between gap-2 mt-1 ml-2 px-2 py-1.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-sky-500/20">
                                                <span className="text-[9.5px] text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wide">
                                                    Depth Range
                                                </span>
                                                <div className="flex rounded overflow-hidden border border-gray-200 dark:border-white/10 text-[9px]">
                                                    {([5, 10] as const).map((pct) => {
                                                        const active = (settings.liquidationDeepRangePct || 10) === pct;
                                                        return (
                                                            <button
                                                                key={pct}
                                                                type="button"
                                                                onClick={() => onSettingsChange({ ...settings, liquidationDeepRangePct: pct })}
                                                                className={`px-2 py-0.5 font-mono font-bold transition-all ${
                                                                    active
                                                                        ? 'bg-sky-500 text-white shadow-sm'
                                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5'
                                                                }`}
                                                            >
                                                                ±{pct}%
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-amber-600 dark:text-amber-400 font-semibold group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">Leverage Liq Pools (5x-100x) ⚡</span>
                                            <input type="checkbox" checked={settings.liquidationShowLeveragePools !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowLeveragePools: settings.liquidationShowLeveragePools === false ? true : false })} className="w-3 h-3 rounded text-amber-500 focus:ring-amber-500" />
                                        </label>
                                        {settings.liquidationShowLeveragePools !== false && (
                                            <div className="flex items-center justify-between gap-2 mt-1 ml-2 px-2 py-1.5 bg-gray-50 dark:bg-white/5 rounded-lg border border-amber-500/20">
                                                <span className="text-[9.5px] text-gray-600 dark:text-gray-400 font-semibold uppercase tracking-wide">
                                                    Pool Horizon (OI-Δ)
                                                </span>
                                                <div className="flex rounded overflow-hidden border border-gray-200 dark:border-white/10 text-[9px]">
                                                    {(['24h', '3d', '7d'] as const).map((h) => {
                                                        const active = (settings.liquidationPoolHorizon || '24h') === h;
                                                        return (
                                                            <button
                                                                key={h}
                                                                type="button"
                                                                onClick={() => onSettingsChange({ ...settings, liquidationPoolHorizon: h })}
                                                                className={`px-2 py-0.5 font-mono font-bold uppercase transition-all ${
                                                                    active
                                                                        ? 'bg-amber-500 text-white shadow-sm'
                                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5'
                                                                }`}
                                                            >
                                                                {h}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-gray-700 dark:text-gray-300 font-semibold group-hover:text-gray-900 dark:group-hover:text-white transition-colors">AI Trajectory Target 🎯</span>
                                            <input type="checkbox" checked={settings.liquidationShowTrajectory !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowTrajectory: settings.liquidationShowTrajectory === false ? true : false })} className="w-3 h-3 rounded" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-gray-700 dark:text-gray-300 font-semibold group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Live Bubbles</span>
                                            <input type="checkbox" checked={settings.liquidationShowBubbles as boolean} onChange={() => onSettingsChange({ ...settings, liquidationShowBubbles: !settings.liquidationShowBubbles })} className="w-3 h-3 rounded" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-gray-700 dark:text-gray-300 font-semibold group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Show Live Signal Arrow</span>
                                            <input type="checkbox" checked={settings.liquidationShowSignalArrow !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowSignalArrow: settings.liquidationShowSignalArrow === false ? true : false })} className="w-3 h-3 rounded" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-blue-600 dark:text-blue-400 font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">Enable Smart Money AI Bias 🧠</span>
                                            <input type="checkbox" checked={settings.liquidationSmartMoneyBias !== false} onChange={() => onSettingsChange({ ...settings, liquidationSmartMoneyBias: settings.liquidationSmartMoneyBias === false ? true : false })} className="w-3 h-3 rounded text-blue-500 focus:ring-blue-500" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-teal-600 dark:text-teal-400 font-semibold group-hover:text-teal-700 dark:group-hover:text-teal-300">Show Smart Money HUD 🖥️</span>
                                            <input type="checkbox" checked={settings.liquidationShowSmartMoneyHUD !== false} onChange={() => onSettingsChange({ ...settings, liquidationShowSmartMoneyHUD: settings.liquidationShowSmartMoneyHUD === false ? true : false })} className="w-3 h-3 rounded text-teal-500 focus:ring-teal-500" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-purple-600 dark:text-purple-400 font-semibold group-hover:text-purple-700 dark:group-hover:text-purple-300">Show True CVD & Iceberg 🛡️</span>
                                            <input type="checkbox" checked={settings.liquidationShowTrueCVD as boolean} onChange={() => onSettingsChange({ ...settings, liquidationShowTrueCVD: !settings.liquidationShowTrueCVD })} className="w-3 h-3 rounded text-purple-500 focus:ring-purple-500" />
                                        </label>
                                        {settings.liquidationShowTrueCVD && (
                                            <div className="flex flex-col gap-1.5 mt-1 ml-2 p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-purple-500/20">
                                                <label className="flex items-center justify-between cursor-pointer">
                                                    <span className="text-[10px] text-gray-600 dark:text-gray-300 font-semibold">Live 1M Close-Bias Tag</span>
                                                    <input
                                                        type="checkbox"
                                                        checked={settings.liquidationShowBiasTag ?? true}
                                                        onChange={() => onSettingsChange({ ...settings, liquidationShowBiasTag: !(settings.liquidationShowBiasTag ?? true) })}
                                                        className="w-3 h-3 rounded text-purple-500 focus:ring-purple-500"
                                                    />
                                                </label>
                                                <label className="flex items-center justify-between cursor-pointer">
                                                    <span className="text-[10px] text-gray-600 dark:text-gray-300 font-semibold">1M Bar Delta Strip (Bottom)</span>
                                                    <input
                                                        type="checkbox"
                                                        checked={settings.liquidationShowDeltaStrip ?? true}
                                                        onChange={() => onSettingsChange({ ...settings, liquidationShowDeltaStrip: !(settings.liquidationShowDeltaStrip ?? true) })}
                                                        className="w-3 h-3 rounded text-purple-500 focus:ring-purple-500"
                                                    />
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-gray-700 dark:text-gray-300 font-semibold group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Raw Heatmap Mode</span>
                                            <input type="checkbox" checked={!settings.liquidationShowTrailingCloud} onChange={() => onSettingsChange({ ...settings, liquidationShowTrailingCloud: false })} className="w-3 h-3 rounded" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-brand-primary font-semibold group-hover:text-brand-primary/80">Dynamic Trailing Clouds (DTLC)</span>
                                            <input type="checkbox" checked={settings.liquidationShowTrailingCloud as boolean} onChange={() => onSettingsChange({ ...settings, liquidationShowTrailingCloud: !settings.liquidationShowTrailingCloud })} className="w-3 h-3 rounded text-brand-primary focus:ring-brand-primary" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2 border-t border-gray-100 dark:border-white/10 pt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-purple-600 dark:text-purple-400 font-semibold group-hover:text-purple-700 dark:group-hover:text-purple-300">Anti-Spoofing Visualizer 👻</span>
                                            <input type="checkbox" checked={settings.liquidationShowSpoofing ?? true} onChange={() => onSettingsChange({ ...settings, liquidationShowSpoofing: !(settings.liquidationShowSpoofing ?? true) })} className="w-3 h-3 rounded text-purple-500 focus:ring-purple-500" />
                                        </label>
                                        
                                        {(settings.liquidationShowSpoofing ?? true) && (
                                            <div className="flex flex-col gap-1.5 mt-2 ml-2 p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-purple-500/20">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase">Volume Threshold</span>
                                                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold">${((settings.liquidationSpoofingThreshold || 500000) / 1000).toFixed(0)}k</span>
                                                </div>
                                                <input 
                                                    type="range" 
                                                    min="100000" 
                                                    max="2000000" 
                                                    step="100000"
                                                    value={settings.liquidationSpoofingThreshold || 500000} 
                                                    onChange={(e) => updateSetting('liquidationSpoofingThreshold', Number(e.target.value))}
                                                    className="w-full accent-purple-500 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2 border-t border-gray-100 dark:border-white/10 pt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-blue-600 dark:text-blue-400 font-semibold group-hover:text-blue-700 dark:group-hover:text-blue-300">GEX & Options Walls 🧲</span>
                                            <input type="checkbox" checked={settings.liquidationShowGEX ?? true} onChange={() => onSettingsChange({ ...settings, liquidationShowGEX: !(settings.liquidationShowGEX ?? true) })} className="w-3 h-3 rounded text-blue-500 focus:ring-blue-500" />
                                        </label>
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-2 border-t border-gray-100 dark:border-white/10 pt-2">
                                        <label className="flex items-center justify-between cursor-pointer group">
                                            <span className="text-orange-600 dark:text-orange-400 font-semibold group-hover:text-orange-700 dark:group-hover:text-orange-300">Bookmap Heatmap 🗺️</span>
                                            <input type="checkbox" checked={settings.liquidationShowBookmap ?? true} onChange={() => onSettingsChange({ ...settings, liquidationShowBookmap: !(settings.liquidationShowBookmap ?? true) })} className="w-3 h-3 rounded text-orange-500 focus:ring-orange-500" />
                                        </label>
                                        
                                        {(settings.liquidationShowBookmap ?? true) && (
                                            <div className="flex flex-col gap-2 mt-2 ml-2 p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-orange-500/20">
                                                <div className="flex flex-col gap-1.5">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold uppercase">Heatmap Intensity</span>
                                                        <span className="text-[10px] text-orange-600 dark:text-orange-400 font-semibold">{settings.liquidationBookmapIntensity || 50}%</span>
                                                    </div>
                                                    <input 
                                                        type="range" 
                                                        min="10" 
                                                        max="100" 
                                                        value={settings.liquidationBookmapIntensity || 50} 
                                                        onChange={(e) => updateSetting('liquidationBookmapIntensity', Number(e.target.value))}
                                                        className="w-full accent-orange-500 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                                    />
                                                </div>
                                                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-gray-200/70 dark:border-white/10">
                                                    <span className="text-[9.5px] text-gray-500 dark:text-gray-400 font-semibold uppercase tracking-wide">
                                                        History Buffer
                                                    </span>
                                                    <div className="flex rounded overflow-hidden border border-gray-200 dark:border-white/10 text-[9px]">
                                                        {([
                                                            { v: 15 as const, label: '15M' },
                                                            { v: 60 as const, label: '1H' },
                                                            { v: 120 as const, label: '2H' },
                                                        ]).map((opt) => {
                                                            const active = (settings.liquidationBookmapHistoryMin || 120) === opt.v;
                                                            return (
                                                                <button
                                                                    key={opt.v}
                                                                    type="button"
                                                                    onClick={() => onSettingsChange({ ...settings, liquidationBookmapHistoryMin: opt.v })}
                                                                    className={`px-2 py-0.5 font-mono font-bold transition-all ${
                                                                        active
                                                                            ? 'bg-orange-500 text-white shadow-sm'
                                                                            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5'
                                                                    }`}
                                                                >
                                                                    {opt.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1.5 mt-1 border-t border-gray-100 dark:border-white/10 pt-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-600 dark:text-gray-400 font-semibold">Heatmap Intensity</span>
                                            <span className="text-brand-primary font-semibold">{settings.liquidationHeatmapIntensity}%</span>
                                        </div>
                                        <input 
                                            type="range" 
                                            min="10" 
                                            max="100" 
                                            value={settings.liquidationHeatmapIntensity as number} 
                                            onChange={(e) => updateSetting('liquidationHeatmapIntensity' as any, Number(e.target.value))}
                                            className="w-full accent-orange-500"
                                        />
                                    </div>
                                </div>
                            )}
                         </div>

                         {/* ── ICT Killzones & Pivots [TFO] ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showICTKillzones}
                                        onChange={() => toggleIndicator('showICTKillzones')}
                                        className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                        🏹 ICT Killzones & Pivots
                                    </span>
                                </label>
                            </div>

                            {settings.showICTKillzones && (
                                <div className="flex flex-col gap-2 mt-2 text-[10px]">
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="flex items-center gap-2 cursor-pointer group">
                                            <input type="checkbox" checked={settings.ictShowPivots}
                                                onChange={() => onSettingsChange({ ...settings, ictShowPivots: !settings.ictShowPivots })}
                                                className="w-3.5 h-3.5 rounded text-rose-500" />
                                            <span className="text-gray-700 dark:text-gray-300 group-hover:text-rose-500 dark:group-hover:text-rose-400 transition-colors uppercase font-semibold">Show Pivots</span>
                                        </label>
                                        <select 
                                            value={settings.ictPivotsExtend}
                                            onChange={(e) => onSettingsChange({ ...settings, ictPivotsExtend: e.target.value as any })}
                                            className="bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none"
                                        >
                                            <option value="Until Mitigated">Mitigated</option>
                                            <option value="Past Mitigation">Permanent</option>
                                        </select>
                                    </div>

                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5 text-[9px]">DWM & Open Lines</p>
                                        <div className="grid grid-cols-2 gap-y-1">
                                            {[
                                                { k: 'ictShowDWM', l: 'HTF High/Low' },
                                                { k: 'ictShowDailyOpen', l: 'Daily Open' },
                                                { k: 'ictShowWeeklyOpen', l: 'Weekly Open' },
                                                { k: 'ictShowMonthlyOpen', l: 'Monthly Open' },
                                                { k: 'ictShowOpeningPrices', l: 'Time Logs' },
                                                { k: 'ictShowTimestamps', l: 'Verticals' },
                                            ].map(item => (
                                                <label key={item.k} className="flex items-center gap-2 cursor-pointer group">
                                                    <input type="checkbox" checked={settings[item.k as keyof IndicatorSettings] as boolean}
                                                        onChange={() => onSettingsChange({ ...settings, [item.k]: !settings[item.k as keyof IndicatorSettings] })}
                                                        className="w-2.5 h-2.5 rounded text-brand-primary" />
                                                    <span className="text-[9px] text-gray-600 dark:text-gray-400 group-hover:text-brand-primary transition-colors uppercase font-medium">{item.l}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5 text-[9px]">Sessions (New York Time)</p>
                                        <div className="flex flex-col gap-1.5">
                                            {[
                                                { k: 'ictAsiaSession', l: 'Asia', c: 'text-blue-500 dark:text-blue-400' },
                                                { k: 'ictLondonSession', l: 'London', c: 'text-red-500 dark:text-red-400' },
                                                { k: 'ictNyAmSession', l: 'NY AM', c: 'text-emerald-500 dark:text-emerald-400' },
                                                { k: 'ictNyLunchSession', l: 'NY Lunch', c: 'text-yellow-600 dark:text-yellow-400' },
                                                { k: 'ictNyPmSession', l: 'NY PM', c: 'text-purple-500 dark:text-purple-400' },
                                            ].map(item => (
                                                <div key={item.k} className="flex items-center justify-between">
                                                    <span className={`font-bold ${item.c}`}>{item.l}:</span>
                                                    <input type="text" value={settings[item.k as keyof IndicatorSettings] as string}
                                                        onChange={(e) => onSettingsChange({ ...settings, [item.k]: e.target.value })}
                                                        className="w-20 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1.5 py-0.5 text-gray-800 dark:text-gray-200 text-right focus:outline-none focus:border-brand-primary" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5 mt-2">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5 text-[9px]">Advanced ICT Suite</p>
                                        <div className="grid grid-cols-2 gap-y-1">
                                            {[
                                                { k: 'ictShowSilverBullet', l: 'Silver Bullet' },
                                                { k: 'ictShowEquilibrium', l: 'Equilibrium' },
                                                { k: 'ictShowConfluence', l: 'Confluence' },
                                                { k: 'ictShowAMD', l: 'Power of 3' },
                                                { k: 'ictShowGaps', l: 'Open Gaps' },
                                                { k: 'ictShowVolatility', l: 'Volatility' },
                                            ].map(item => (
                                                <label key={item.k} className="flex items-center gap-2 cursor-pointer group">
                                                    <input type="checkbox" checked={settings[item.k as keyof IndicatorSettings] as boolean}
                                                        onChange={() => onSettingsChange({ ...settings, [item.k]: !settings[item.k as keyof IndicatorSettings] })}
                                                        className="w-2.5 h-2.5 rounded text-brand-primary" />
                                                    <span className="text-[9px] text-gray-600 dark:text-gray-400 group-hover:text-brand-primary transition-colors uppercase font-medium">{item.l}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                         {/* ── LuxAlgo ICT Concepts ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.luxShowIndicator}
                                        onChange={() => toggleIndicator('luxShowIndicator')}
                                        className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                        ICT Concepts [LuxAlgo]
                                    </span>
                                </label>
                                {settings.luxShowIndicator && (
                                     <button
                                         onClick={(e) => { 
                                             e.stopPropagation(); 
                                             // simple local toggle
                                             const content = e.currentTarget.parentElement?.nextElementSibling as HTMLElement;
                                             if (content) content.classList.toggle('hidden');
                                         }}
                                         className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-500"
                                     >
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                     </button>
                                )}
                            </div>

                            {settings.luxShowIndicator && (
                                <div className="pl-7 pr-2 py-2 flex flex-col gap-3 animate-fadeIn text-[10px]">
                                    
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                        {/* Core Toggles */}
                                        <div className="flex flex-col gap-1.5">
                                            <p className="font-bold text-gray-700 dark:text-gray-300 mb-0.5">STRUCTURE</p>
                                            {[
                                                { k: 'luxShowMS', l: 'Market Structure' },
                                                { k: 'luxShowMSS', l: 'MSS' },
                                                { k: 'luxShowBOS', l: 'BOS' },
                                                { k: 'luxShowDisplacement', l: 'Displacement' },
                                            ].map((t) => (
                                                <label key={t.k} className="flex items-center justify-between cursor-pointer group">
                                                    <span className="text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200">{t.l}</span>
                                                    <input type="checkbox" checked={settings[t.k as keyof IndicatorSettings] as boolean} onChange={() => onSettingsChange({ ...settings, [t.k]: !settings[t.k as keyof IndicatorSettings] })} className="w-3 h-3 rounded" />
                                                </label>
                                            ))}
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-gray-600 dark:text-gray-400">Swing Length</span>
                                                <input type="number" value={settings.luxSwingLength} onChange={(e) => onSettingsChange({ ...settings, luxSwingLength: parseInt(e.target.value)||5 })} className="w-12 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-right text-gray-800 dark:text-gray-200" />
                                            </div>
                                        </div>

                                        <div className="flex flex-col gap-1.5">
                                            <p className="font-bold text-gray-700 dark:text-gray-300 mb-0.5">ZONES</p>
                                            {[
                                                { k: 'luxShowVIMB', l: 'Vol Imbalance' },
                                                { k: 'luxShowOB', l: 'Order Blocks' },
                                                { k: 'luxShowLiq', l: 'Liquidity' },
                                                { k: 'luxShowFVG', l: 'FVG / IFVG' },
                                                { k: 'luxShowNWOG', l: 'NWOG' },
                                                { k: 'luxShowKillzones', l: 'Killzones' },
                                            ].map((t) => (
                                                <label key={t.k} className="flex items-center justify-between cursor-pointer group">
                                                    <span className="text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-gray-200">{t.l}</span>
                                                    <input type="checkbox" checked={settings[t.k as keyof IndicatorSettings] as boolean} onChange={() => onSettingsChange({ ...settings, [t.k]: !settings[t.k as keyof IndicatorSettings] })} className="w-3 h-3 rounded" />
                                                </label>
                                            ))}
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-gray-600 dark:text-gray-400">Fib Mode</span>
                                                <select value={settings.luxFibMode} onChange={(e) => onSettingsChange({ ...settings, luxFibMode: e.target.value as any })} className="w-16 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-right text-gray-800 dark:text-gray-200">
                                                    <option>NONE</option><option>FVG</option><option>BPR</option><option>OB</option><option>Liq</option><option>VI</option><option>NWOG</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                         </div>

                         {/* ICT Power of Three (PO3) Indicator */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                             <label className="flex items-center cursor-pointer flex-1">
                                 <input
                                     type="checkbox"
                                     checked={settings.showICTPO3}
                                     onChange={() => toggleIndicator('showICTPO3')}
                                     className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                 />
                                 <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">ICT Power of Three (PO3)</span>
                             </label>
                            </div>
                         </div>

                         {/* ── Smart Money Concepts [LuxAlgo] Block ── */}
                         <div className="flex flex-col gap-2 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors group border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center cursor-pointer flex-1">
                                    <input
                                        type="checkbox"
                                        checked={settings.showSMC}
                                        onChange={() => toggleIndicator('showSMC')}
                                        className="w-4 h-4 text-brand-primary bg-gray-100 border-gray-300 rounded focus:ring-brand-primary dark:focus:ring-brand-primary dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 transition-colors">
                                        Smart Money Concepts
                                    </span>
                                </label>
                                <div className="flex rounded overflow-hidden border border-gray-200 dark:border-white/10 text-[9px]">
                                    {(['Colored', 'Monochrome'] as const).map(s => (
                                        <button key={s}
                                            onClick={() => onSettingsChange({ ...settings, smcStyle: s })}
                                            className={`px-1.5 py-0.5 font-bold transition-all ${
                                                settings.smcStyle === s 
                                                    ? 'bg-amber-600 text-white' 
                                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-white/5'}`}>
                                            {s.slice(0, 4)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {settings.showSMC && (
                                <div className="flex flex-col gap-2 mt-1 text-[10px]">

                                    {/* Internal Structure */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                                        <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                                            <input type="checkbox" checked={settings.smcShowInternals}
                                                onChange={() => onSettingsChange({ ...settings, smcShowInternals: !settings.smcShowInternals })}
                                                className="w-3 h-3 rounded text-amber-500" />
                                            <span className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Internal Structure</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-1">
                                            <div>
                                                <span className="text-gray-600 dark:text-gray-400 block mb-0.5">Bullish:</span>
                                                <select value={settings.smcInternalBullFilter}
                                                    onChange={e => onSettingsChange({ ...settings, smcInternalBullFilter: e.target.value as any })}
                                                    className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                    <option value="All">All</option>
                                                    <option value="BOS">BOS Only</option>
                                                    <option value="CHoCH">CHoCH Only</option>
                                                </select>
                                            </div>
                                            <div>
                                                <span className="text-gray-600 dark:text-gray-400 block mb-0.5">Bearish:</span>
                                                <select value={settings.smcInternalBearFilter}
                                                    onChange={e => onSettingsChange({ ...settings, smcInternalBearFilter: e.target.value as any })}
                                                    className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                    <option value="All">All</option>
                                                    <option value="BOS">BOS Only</option>
                                                    <option value="CHoCH">CHoCH Only</option>
                                                </select>
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-1.5 cursor-pointer mt-1.5">
                                            <input type="checkbox" checked={settings.smcConfluenceFilter}
                                                onChange={() => onSettingsChange({ ...settings, smcConfluenceFilter: !settings.smcConfluenceFilter })}
                                                className="w-2.5 h-2.5 rounded text-amber-500" />
                                            <span className="text-gray-600 dark:text-gray-400 italic">Confluence Filter</span>
                                        </label>
                                    </div>

                                    {/* Swing Structure */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                                        <label className="flex items-center gap-1.5 cursor-pointer mb-1.5">
                                            <input type="checkbox" checked={settings.smcShowSwing}
                                                onChange={() => onSettingsChange({ ...settings, smcShowSwing: !settings.smcShowSwing })}
                                                className="w-3 h-3 rounded text-amber-500" />
                                            <span className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Swing Structure</span>
                                        </label>
                                        <div className="grid grid-cols-2 gap-1 mb-1.5">
                                            <div>
                                                <span className="text-gray-600 dark:text-gray-400 block mb-0.5">Bullish:</span>
                                                <select value={settings.smcSwingBullFilter}
                                                    onChange={e => onSettingsChange({ ...settings, smcSwingBullFilter: e.target.value as any })}
                                                    className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                    <option value="All">All</option>
                                                    <option value="BOS">BOS Only</option>
                                                    <option value="CHoCH">CHoCH Only</option>
                                                </select>
                                            </div>
                                            <div>
                                                <span className="text-gray-600 dark:text-gray-400 block mb-0.5">Bearish:</span>
                                                <select value={settings.smcSwingBearFilter}
                                                    onChange={e => onSettingsChange({ ...settings, smcSwingBearFilter: e.target.value as any })}
                                                    className="w-full bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                    <option value="All">All</option>
                                                    <option value="BOS">BOS Only</option>
                                                    <option value="CHoCH">CHoCH Only</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-gray-600 dark:text-gray-400">Swing Length:</span>
                                            <input type="number" value={settings.smcSwingLength}
                                                onChange={e => onSettingsChange({ ...settings, smcSwingLength: Number(e.target.value) })}
                                                className="w-14 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1.5 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none"
                                                min={10} max={200} step={5} />
                                        </div>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input type="checkbox" checked={settings.smcShowStrongWeakHL}
                                                onChange={() => onSettingsChange({ ...settings, smcShowStrongWeakHL: !settings.smcShowStrongWeakHL })}
                                                className="w-2.5 h-2.5 rounded text-amber-500" />
                                            <span className="text-gray-600 dark:text-gray-400 italic">Show Strong/Weak H/L</span>
                                        </label>
                                    </div>

                                    {/* Order Blocks */}
                                    <div className="p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5">
                                        <p className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-1.5">Order Blocks</p>
                                        <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                <input type="checkbox" checked={settings.smcShowInternalOB}
                                                    onChange={() => onSettingsChange({ ...settings, smcShowInternalOB: !settings.smcShowInternalOB })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500" />
                                                <span className="text-gray-600 dark:text-gray-400">Internal OB</span>
                                            </label>
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-600 dark:text-gray-400">N:</span>
                                                <input type="number" value={settings.smcInternalOBCount}
                                                    onChange={e => onSettingsChange({ ...settings, smcInternalOBCount: Number(e.target.value) })}
                                                    className="w-10 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none"
                                                    min={1} max={20} />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                                <input type="checkbox" checked={settings.smcShowSwingOB}
                                                    onChange={() => onSettingsChange({ ...settings, smcShowSwingOB: !settings.smcShowSwingOB })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500" />
                                                <span className="text-gray-600 dark:text-gray-400">Swing OB</span>
                                            </label>
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-600 dark:text-gray-400">N:</span>
                                                <input type="number" value={settings.smcSwingOBCount}
                                                    onChange={e => onSettingsChange({ ...settings, smcSwingOBCount: Number(e.target.value) })}
                                                    className="w-10 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none"
                                                    min={1} max={20} />
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-gray-600 dark:text-gray-400">OB Filter:</span>
                                            <select value={settings.smcOBFilter}
                                                onChange={e => onSettingsChange({ ...settings, smcOBFilter: e.target.value as any })}
                                                className="bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                <option value="Atr">ATR</option>
                                                <option value="CumMeanRange">Cum. Mean Range</option>
                                            </select>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-600 dark:text-gray-400">OB Mitigation:</span>
                                            <select value={settings.smcOBMitigation}
                                                onChange={e => onSettingsChange({ ...settings, smcOBMitigation: e.target.value as any })}
                                                className="bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]">
                                                <option value="High/Low">High/Low</option>
                                                <option value="Close">Close</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Equal H/L + FVG + Premium/Discount */}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                            <input type="checkbox" checked={settings.smcShowEqualHL}
                                                onChange={() => onSettingsChange({ ...settings, smcShowEqualHL: !settings.smcShowEqualHL })}
                                                className="w-2.5 h-2.5 rounded text-amber-500" />
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">Equal Highs/Lows</span>
                                            {settings.smcShowEqualHL && (
                                                <div className="ml-auto flex items-center gap-1">
                                                    <span className="text-gray-600 dark:text-gray-400">Thr:</span>
                                                    <input type="number" value={settings.smcEqualHLThreshold}
                                                        onChange={e => onSettingsChange({ ...settings, smcEqualHLThreshold: parseFloat(e.target.value) })}
                                                        className="w-10 bg-white dark:bg-black/20 border border-gray-300 dark:border-white/10 rounded px-1 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none text-[9px]"
                                                        min={0} max={0.5} step={0.05} />
                                                </div>
                                            )}
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                            <input type="checkbox" checked={settings.smcShowFVG}
                                                onChange={() => onSettingsChange({ ...settings, smcShowFVG: !settings.smcShowFVG })}
                                                className="w-2.5 h-2.5 rounded text-amber-500" />
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">Fair Value Gaps</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                            <input type="checkbox" checked={settings.smcShowPDZones}
                                                onChange={() => onSettingsChange({ ...settings, smcShowPDZones: !settings.smcShowPDZones })}
                                                className="w-2.5 h-2.5 rounded text-amber-500" />
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">Premium/Discount Zones</span>
                                        </label>
                                    </div>

                                    {/* Secret Order Flow Features */}
                                    <div className="pt-2 mt-2 border-t border-gray-100 dark:border-white/5">
                                        <div className="text-[10px] font-bold text-amber-600 dark:text-amber-500 mb-1.5 uppercase tracking-wider">
                                            Institutional Order Flow ✨
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input type="checkbox" checked={settings.smcL2Validation}
                                                    onChange={() => onSettingsChange({ ...settings, smcL2Validation: !settings.smcL2Validation })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500 accent-amber-500" />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">L2 Validated OBs (Glow)</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input type="checkbox" checked={settings.smcCVDTrap}
                                                    onChange={() => onSettingsChange({ ...settings, smcCVDTrap: !settings.smcCVDTrap })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500 accent-amber-500" />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">CVD Trap Detection (BOS)</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input type="checkbox" checked={settings.smcSweepDetection}
                                                    onChange={() => onSettingsChange({ ...settings, smcSweepDetection: !settings.smcSweepDetection })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500 accent-amber-500" />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Live Absorption Sweeps (EQH)</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input type="checkbox" checked={settings.smcMicroFVG}
                                                    onChange={() => onSettingsChange({ ...settings, smcMicroFVG: !settings.smcMicroFVG })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500 accent-amber-500" />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Footprint Micro-FVG Lines</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input type="checkbox" checked={settings.smcShowSwingPatterns}
                                                    onChange={() => onSettingsChange({ ...settings, smcShowSwingPatterns: !settings.smcShowSwingPatterns })}
                                                    className="w-2.5 h-2.5 rounded text-amber-500 accent-amber-500" />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Swing Candlestick Patterns</span>
                                            </label>
                                        </div>
                                    </div>
                                    
                                </div>
                            )}
                         </div>

                         {/* ── Order Flow Overlays (Show Heatmap, Show CVD, Show Footprint) ── */}
                         <div className="flex flex-col gap-1.5 p-2 hover:bg-gray-50 dark:hover:bg-white/5 rounded-lg transition-colors border-t border-gray-100 dark:border-white/5 mt-1 pt-3">
                            <div className="flex items-center justify-between pb-0.5">
                                <span className="text-[10px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">
                                    Order Flow Overlays
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary font-mono font-medium">
                                    Live L2
                                </span>
                            </div>

                            {/* Show Heatmap */}
                            <div className="flex items-center justify-between py-1 group/item">
                                <label className="flex items-center cursor-pointer flex-1 select-none">
                                    <input
                                        type="checkbox"
                                        checked={isHeatmapActive}
                                        onChange={handleToggleHeatmap}
                                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 accent-blue-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover/item:text-blue-500 dark:group-hover/item:text-blue-400 transition-colors">
                                        Show Heatmap
                                    </span>
                                </label>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold transition-all ${
                                    isHeatmapActive
                                        ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-[0_0_8px_rgba(59,130,246,0.25)]'
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-500 border border-gray-200 dark:border-transparent'
                                }`}>
                                    VPVR
                                </span>
                            </div>

                            {/* Show CVD */}
                            <div className="flex items-center justify-between py-1 group/item">
                                <label className="flex items-center cursor-pointer flex-1 select-none">
                                    <input
                                        type="checkbox"
                                        checked={isCVDActive}
                                        onChange={handleToggleCVD}
                                        className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 rounded focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 accent-purple-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover/item:text-purple-500 dark:group-hover/item:text-purple-400 transition-colors">
                                        Show CVD
                                    </span>
                                </label>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold transition-all ${
                                    isCVDActive
                                        ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-500/40 shadow-[0_0_8px_rgba(168,85,247,0.25)]'
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-500 border border-gray-200 dark:border-transparent'
                                }`}>
                                    Delta
                                </span>
                            </div>

                            {/* Show Footprint */}
                            <div className="flex items-center justify-between py-1 group/item">
                                <label className="flex items-center cursor-pointer flex-1 select-none">
                                    <input
                                        type="checkbox"
                                        checked={isFootprintActive}
                                        onChange={handleToggleFootprint}
                                        className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 accent-teal-600"
                                    />
                                    <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover/item:text-teal-500 dark:group-hover/item:text-teal-400 transition-colors">
                                        Show Footprint
                                    </span>
                                </label>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold transition-all ${
                                    isFootprintActive
                                        ? 'bg-teal-500/20 text-teal-600 dark:text-teal-400 border border-teal-500/40 shadow-[0_0_8px_rgba(20,184,166,0.25)]'
                                        : 'bg-gray-100 dark:bg-white/5 text-gray-500 border border-gray-200 dark:border-transparent'
                                }`}>
                                    Footprint
                                </span>
                            </div>

                            {/* Sweep, Swap & Iceberg Absorption */}
                            <div className="flex flex-col gap-2 pt-2 mt-1 border-t border-gray-200/70 dark:border-white/5">
                                <div className="flex items-center justify-between py-0.5 group/item">
                                    <label className="flex items-center cursor-pointer flex-1 select-none">
                                        <input
                                            type="checkbox"
                                            checked={!!settings.showLiquiditySweepAbsorption}
                                            onChange={() => toggleIndicator('showLiquiditySweepAbsorption')}
                                            className="w-4 h-4 text-cyan-600 bg-gray-100 border-gray-300 rounded focus:ring-cyan-500 dark:focus:ring-cyan-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 accent-cyan-500 cursor-pointer"
                                        />
                                        <span className="ml-3 text-sm font-semibold text-gray-900 dark:text-gray-100 group-hover/item:text-cyan-500 dark:group-hover/item:text-cyan-400 transition-colors">
                                            Sweep & Iceberg Absorption
                                        </span>
                                    </label>
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold transition-all ${
                                        settings.showLiquiditySweepAbsorption
                                            ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                                            : 'bg-gray-100 dark:bg-white/5 text-gray-500 border border-gray-200 dark:border-transparent'
                                    }`}>
                                        Swap/Iceberg
                                    </span>
                                </div>

                                {settings.showLiquiditySweepAbsorption && (
                                    <div className="flex flex-col gap-2 pl-7 animate-in slide-in-from-top-1 duration-200">
                                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Min Absorbed ($)</span>
                                                <input
                                                    type="number"
                                                    value={settings.lsaMinAbsorbedUsd ?? 50000}
                                                    onChange={(e) => updateSetting('lsaMinAbsorbedUsd', Math.max(1000, Number(e.target.value) || 1000))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                    min={1000}
                                                    step={5000}
                                                    title="Minimum USD volume absorbed at zone"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Sweep Lookback</span>
                                                <input
                                                    type="number"
                                                    value={settings.lsaSweepLookback ?? 20}
                                                    onChange={(e) => updateSetting('lsaSweepLookback', Math.max(5, Math.min(100, Number(e.target.value) || 20)))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                    min={5}
                                                    max={100}
                                                    step={1}
                                                    title="Bars lookback for swing high/low sweep pools"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Window (sec)</span>
                                                <input
                                                    type="number"
                                                    value={settings.lsaAbsorptionWindowSec ?? 20}
                                                    onChange={(e) => updateSetting('lsaAbsorptionWindowSec', Math.max(5, Math.min(120, Math.floor(Number(e.target.value) || 20))))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                    min={5}
                                                    max={120}
                                                    step={5}
                                                    title="Rolling time window (seconds) for live absorption & iceberg detection"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Signal Filter</span>
                                                <select
                                                    value={settings.lsaSignalFilter || 'All'}
                                                    onChange={(e) => onSettingsChange({ ...settings, lsaSignalFilter: e.target.value as any })}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                >
                                                    <option className="bg-white dark:bg-[#0c0e14]" value="All">All Signals</option>
                                                    <option className="bg-white dark:bg-[#0c0e14]" value="Reversal">Reversal Only</option>
                                                    <option className="bg-white dark:bg-[#0c0e14]" value="Breakdown">Breakdown Only</option>
                                                    <option className="bg-white dark:bg-[#0c0e14]" value="Iceberg">Iceberg Only</option>
                                                </select>
                                            </div>
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Min Iceberg Reloads</span>
                                                <input
                                                    type="number"
                                                    value={settings.lsaMinReloads ?? 1}
                                                    onChange={(e) => updateSetting('lsaMinReloads', Math.max(0, Math.min(20, Math.floor(Number(e.target.value) || 0))))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                    min={0}
                                                    max={20}
                                                    step={1}
                                                    title="Minimum live L2 reload count for Iceberg markers"
                                                />
                                            </div>
                                            <div className="flex flex-col gap-0.5 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded border border-gray-200 dark:border-transparent">
                                                <span className="text-gray-500 dark:text-gray-400 font-bold">Max Zones</span>
                                                <input
                                                    type="number"
                                                    value={settings.lsaMaxZones ?? 20}
                                                    onChange={(e) => updateSetting('lsaMaxZones', Math.max(5, Math.min(50, Math.floor(Number(e.target.value) || 20))))}
                                                    className="w-full bg-transparent text-gray-800 dark:text-gray-200 font-mono font-bold focus:outline-none focus:text-cyan-400"
                                                    min={5}
                                                    max={50}
                                                    step={1}
                                                    title="Maximum zones rendered on chart"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.lsaShowIcebergMarkers !== false}
                                                    onChange={() => onSettingsChange({ ...settings, lsaShowIcebergMarkers: !(settings.lsaShowIcebergMarkers !== false) })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Iceberg 💎</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.lsaShowLiquiditySwap !== false}
                                                    onChange={() => onSettingsChange({ ...settings, lsaShowLiquiditySwap: !(settings.lsaShowLiquiditySwap !== false) })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Liq Swap ⇄</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.lsaShowBreakdownZones !== false}
                                                    onChange={() => onSettingsChange({ ...settings, lsaShowBreakdownZones: !(settings.lsaShowBreakdownZones !== false) })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Breakdown Zones</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.lsaShowHistoricalZones !== false}
                                                    onChange={() => onSettingsChange({ ...settings, lsaShowHistoricalZones: !(settings.lsaShowHistoricalZones !== false) })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Historical Zones</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={settings.lsaShowHudSummary !== false}
                                                    onChange={() => onSettingsChange({ ...settings, lsaShowHudSummary: !(settings.lsaShowHudSummary !== false) })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Live Bias HUD</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer p-1.5 bg-gray-50 dark:bg-white/5 rounded border border-gray-100 dark:border-white/5">
                                                <input
                                                    type="checkbox"
                                                    checked={!!settings.lsaEnableAlerts}
                                                    onChange={() => onSettingsChange({ ...settings, lsaEnableAlerts: !settings.lsaEnableAlerts })}
                                                    className="w-3 h-3 rounded text-cyan-500 accent-cyan-500"
                                                />
                                                <span className="text-gray-700 dark:text-gray-300 font-medium">Live Toast Alerts</span>
                                            </label>
                                        </div>

                                        <div className="bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded p-1.5 text-[9px] text-gray-600 dark:text-gray-400 leading-relaxed">
                                            <span className="text-emerald-500 font-bold">REV / ABSORBING</span> = Iceberg + Delta Swap holding zone<br/>
                                            <span className="text-amber-500 font-bold">EXHAUSTING</span> = Wall thinning | <span className="text-rose-500 font-bold">BREAKDOWN</span> = Wall broken
                                        </div>
                                    </div>
                                )}
                            </div>
                         </div>

                    </div>
                </div>
    ) : null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                ref={triggerButtonRef}
                type="button"
                onClick={(e) => {
                    if (compact) e.stopPropagation();
                    if (!isOpen && usePortal) {
                        const pos = computePortalPosition();
                        if (pos) setPortalPos(pos);
                    }
                    setIsOpen(prev => !prev);
                }}
                title={chartLabel ? `Indicators for ${chartLabel}` : 'Indicators'}
                className={compact
                    ? `flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-bold transition-all cursor-pointer ${isOpen
                        ? 'bg-brand-primary/15 border-brand-primary text-brand-primary shadow-sm'
                        : activeCount > 0
                            ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary hover:bg-brand-primary/15'
                            : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/10 hover:bg-gray-200/70 dark:hover:bg-white/10'
                    }`
                    : `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all cursor-pointer ${isOpen
                        ? 'bg-brand-primary/10 border-brand-primary text-brand-primary dark:text-brand-primary shadow-sm'
                        : 'bg-white dark:bg-black/20 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`
                }
            >
                <svg className={compact ? 'w-3 h-3 shrink-0' : 'w-4 h-4 shrink-0'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
                <span>{compact ? 'Ind' : 'Indicators'}</span>
                {!compact && chartLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-primary/15 text-brand-primary font-bold">
                        {chartLabel}
                    </span>
                )}
                {activeCount > 0 && (
                    <span className={`rounded-full font-bold leading-none ${compact ? 'text-[9px] px-1 py-0.5 bg-brand-primary text-white' : 'text-[10px] px-1.5 py-0.5 bg-brand-primary/15 text-brand-primary'}`}>
                        {activeCount}
                    </span>
                )}
                <svg className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {usePortal && typeof document !== 'undefined'
                ? (dropdownMenu ? createPortal(dropdownMenu, document.body) : null)
                : dropdownMenu}
        </div>
    );
};
