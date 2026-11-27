import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IndicatorSettings } from '@/components/features/market/IndicatorSelector';

export interface UTBotSyncPayload {
    symbol: string;
    timeframe: string;
    sensitivity: number;
    atrPeriod: number;
    useHeikinAshi: boolean;
    candleClose: boolean;
    retestSnipe: boolean;
    timestamp: number;
}

interface BotState {
    activeWallHunterId: number | null;
    setActiveWallHunterId: (id: number | null) => void;
    activeBotsByChartId: Record<string, number>;
    setBotForChart: (chartId: string, id: number) => void;
    removeBotForChart: (chartId: string) => void;
    pendingUtBotSync: UTBotSyncPayload | null;
    setPendingUtBotSync: (payload: UTBotSyncPayload | null) => void;
    indicatorSettings: IndicatorSettings;
    setIndicatorSettings: (settings: Partial<IndicatorSettings>) => void;
    indicatorSettingsByChartId: Record<string, IndicatorSettings>;
    setChartIndicatorSettings: (chartId: string, settings: Partial<IndicatorSettings>) => void;
    resetChartIndicatorSettings: (chartId: string) => void;
}

export const sanitizeIndicatorSettings = (settings: IndicatorSettings): IndicatorSettings => {
    if (!settings) return settings;
    return {
        ...settings,
        emaPeriod: Math.max(1, Math.floor(Number(settings.emaPeriod) || 7)),
        emaTimeframes: Array.isArray(settings.emaTimeframes) && settings.emaTimeframes.length > 0
            ? settings.emaTimeframes
            : ['1m', '5m', '15m'],
        emaRenderMode: (settings.emaRenderMode === 'stepped' ? 'stepped' : 'smooth') as 'smooth' | 'stepped',
        emaCustomColors: settings.emaCustomColors || {},
        emaShowPriceLabels: settings.emaShowPriceLabels !== false,
        bbPeriod: Math.max(1, Math.floor(Number(settings.bbPeriod) || 20)),
        bbStdDev: Number.isFinite(Number(settings.bbStdDev)) && Number(settings.bbStdDev) > 0 ? Number(settings.bbStdDev) : 2,
        rsiPeriod: Math.max(1, Math.floor(Number(settings.rsiPeriod) || 14)),
        macdFast: Math.max(1, Math.floor(Number(settings.macdFast) || 12)),
        macdSlow: Math.max(1, Math.floor(Number(settings.macdSlow) || 26)),
        macdSignal: Math.max(1, Math.floor(Number(settings.macdSignal) || 9)),
        utBotSensitivity: Number.isFinite(Number(settings.utBotSensitivity)) && Number(settings.utBotSensitivity) > 0
            ? Math.min(100, Math.max(0.1, Number(settings.utBotSensitivity)))
            : 1.5,
        utBotAtrPeriod: Math.min(200, Math.max(1, Math.floor(Number(settings.utBotAtrPeriod) || 14))),
        utBotUseHeikinAshi: Boolean(settings.utBotUseHeikinAshi),
        utBotTrendFilter: Boolean(settings.utBotTrendFilter),
        utBotEmaPeriod: Math.min(500, Math.max(5, Math.floor(Number(settings.utBotEmaPeriod) || 50))),
        utBotChopFilter: Boolean(settings.utBotChopFilter),
        utBotAdxThreshold: Math.min(60, Math.max(5, Math.floor(Number(settings.utBotAdxThreshold) || 22))),
        utBotCandleClose: Boolean(settings.utBotCandleClose),
        utBotCooldownBars: Math.min(20, Math.max(0, Number.isFinite(Number(settings.utBotCooldownBars)) ? Math.floor(Number(settings.utBotCooldownBars)) : 0)),
        utBotOrderFlowConfirm: Boolean(settings.utBotOrderFlowConfirm),
        utBotHideWeakSignals: Boolean(settings.utBotHideWeakSignals),
        utBotShowSLTP: Boolean(settings.utBotShowSLTP),
        utBotTp1RR: Number.isFinite(Number(settings.utBotTp1RR)) && Number(settings.utBotTp1RR) > 0
            ? Math.min(10, Math.max(0.5, Number(settings.utBotTp1RR)))
            : 1.5,
        utBotTp2RR: Number.isFinite(Number(settings.utBotTp2RR)) && Number(settings.utBotTp2RR) > 0
            ? Math.min(15, Math.max(1.0, Number(settings.utBotTp2RR)))
            : 2.5,
        utBotRetestSniper: Boolean(settings.utBotRetestSniper),
        utBotDualMode: Boolean(settings.utBotDualMode),
        utBotSlowSensitivity: Number.isFinite(Number(settings.utBotSlowSensitivity)) && Number(settings.utBotSlowSensitivity) > 0
            ? Math.min(100, Math.max(0.5, Number(settings.utBotSlowSensitivity)))
            : 3,
        utBotSlowAtrPeriod: Math.min(200, Math.max(2, Math.floor(Number(settings.utBotSlowAtrPeriod) || 20))),
        utBotClimaxGuard: settings.utBotClimaxGuard !== false,
        utBotMaxExtensionAtr: Number.isFinite(Number(settings.utBotMaxExtensionAtr)) && Number(settings.utBotMaxExtensionAtr) > 0
            ? Math.min(5, Math.max(0.8, Number(settings.utBotMaxExtensionAtr)))
            : 1.6,
        utBotPullbackEntry: settings.utBotPullbackEntry !== false,
        utBotFakeoutReversal: settings.utBotFakeoutReversal !== false,
        utBotPresetVersion: Number(settings.utBotPresetVersion) || 2,
        utBotShowHud: settings.utBotShowHud !== false,
        utBotEnableAlerts: Boolean(settings.utBotEnableAlerts),
        supertrendAtrPeriod: Math.max(1, Math.floor(Number(settings.supertrendAtrPeriod) || 10)),
        supertrendMultiplier: Number.isFinite(Number(settings.supertrendMultiplier)) && Number(settings.supertrendMultiplier) > 0 ? Number(settings.supertrendMultiplier) : 3,
        msbObZigzagLen: Math.max(1, Math.floor(Number(settings.msbObZigzagLen) || 9)),
        msbObFibFactor: Number.isFinite(Number(settings.msbObFibFactor)) ? Number(settings.msbObFibFactor) : 0.33,
        wickSRLookback: Math.max(10, Math.floor(Number(settings.wickSRLookback) || 300)),
        wickSRMinTouches: Math.max(1, Math.floor(Number(settings.wickSRMinTouches) || 25)),
        wickSRAtrPeriod: Math.max(1, Math.floor(Number(settings.wickSRAtrPeriod) || 14)),
        wickSRAtrMultiplier: Number.isFinite(Number(settings.wickSRAtrMultiplier)) && Number(settings.wickSRAtrMultiplier) > 0 ? Number(settings.wickSRAtrMultiplier) : 0.5,
        vwapSDMultiplier1: Number.isFinite(Number(settings.vwapSDMultiplier1)) ? Number(settings.vwapSDMultiplier1) : 1.0,
        vwapSDMultiplier2: Number.isFinite(Number(settings.vwapSDMultiplier2)) ? Number(settings.vwapSDMultiplier2) : 2.0,
        vwapSDMultiplier3: Number.isFinite(Number(settings.vwapSDMultiplier3)) ? Number(settings.vwapSDMultiplier3) : 2.5,
        showLiquiditySweepAbsorption: Boolean(settings.showLiquiditySweepAbsorption),
        lsaSweepLookback: Math.max(5, Math.min(100, Math.floor(Number(settings.lsaSweepLookback) || 20))),
        lsaMinAbsorbedUsd: Math.max(1000, Number(settings.lsaMinAbsorbedUsd) || 50000),
        lsaAbsorptionWindowSec: Math.max(5, Math.min(120, Math.floor(Number(settings.lsaAbsorptionWindowSec) || 20))),
        lsaMinReloads: Math.max(0, Math.min(20, Number.isFinite(Number(settings.lsaMinReloads)) ? Math.floor(Number(settings.lsaMinReloads)) : 1)),
        lsaMaxZones: Math.max(5, Math.min(50, Math.floor(Number(settings.lsaMaxZones) || 20))),
        lsaSignalFilter: (['All', 'Reversal', 'Breakdown', 'Iceberg'].includes(String(settings.lsaSignalFilter)) ? settings.lsaSignalFilter : 'All') as 'All' | 'Reversal' | 'Breakdown' | 'Iceberg',
        lsaShowIcebergMarkers: settings.lsaShowIcebergMarkers !== false,
        lsaShowLiquiditySwap: settings.lsaShowLiquiditySwap !== false,
        lsaShowBreakdownZones: settings.lsaShowBreakdownZones !== false,
        lsaShowHistoricalZones: settings.lsaShowHistoricalZones !== false,
        lsaShowHudSummary: settings.lsaShowHudSummary !== false,
        lsaEnableAlerts: Boolean(settings.lsaEnableAlerts),
        liquidationHeatmapIntensity:
            Number.isFinite(Number(settings.liquidationHeatmapIntensity)) && Number(settings.liquidationHeatmapIntensity) >= 10
                ? Math.min(100, Number(settings.liquidationHeatmapIntensity))
                : 75,
        liquidationBookmapIntensity:
            Number.isFinite(Number(settings.liquidationBookmapIntensity)) && Number(settings.liquidationBookmapIntensity) >= 10
                ? Math.min(100, Number(settings.liquidationBookmapIntensity))
                : 50,
        liquidationBookmapHistoryMin: ([15, 60, 120].includes(Number(settings.liquidationBookmapHistoryMin))
            ? Number(settings.liquidationBookmapHistoryMin)
            : 120) as 15 | 60 | 120,
        liquidationSpoofingThreshold:
            Number.isFinite(Number(settings.liquidationSpoofingThreshold)) && Number(settings.liquidationSpoofingThreshold) >= 100000
                ? Number(settings.liquidationSpoofingThreshold)
                : 500000,
        liquidationPoolHorizon: (['24h', '3d', '7d'].includes(String(settings.liquidationPoolHorizon))
            ? settings.liquidationPoolHorizon
            : '24h') as '24h' | '3d' | '7d',
    };
};

export const PRO_UT_BOT_DEFAULTS = {
    utBotSensitivity: 1.5,
    utBotAtrPeriod: 14,
    utBotUseHeikinAshi: true,
    utBotTrendFilter: false,
    utBotEmaPeriod: 50,
    utBotChopFilter: true,
    utBotAdxThreshold: 22,
    utBotCandleClose: false,
    utBotCooldownBars: 2,
    utBotOrderFlowConfirm: true,
    utBotHideWeakSignals: false,
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
    utBotPresetVersion: 2,
    utBotShowHud: true,
    utBotEnableAlerts: false,
};
export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
        showEMA: false,
        showBB: true,
        showRSI: false,
        showMACD: false,
        showVolume: false,
        showAutoFibo: false,
        showIchimoku: false,
        showTrendFinder: false,
        showUTBot: false,
        showSessions: false,
        aetherHull: false,
        aetherOrderBlocks: false,
        aether3BarReversal: false,
        aetherAutoFibo: false,
        emaPeriod: 7,
        emaTimeframes: ['1m', '5m', '15m'],
        emaRenderMode: 'smooth',
        emaCustomColors: {},
        emaShowPriceLabels: true,
        bbPeriod: 20,
        bbStdDev: 2,
        rsiPeriod: 14,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
        autoFiboLookback: 50,
        tenkanPeriod: 9,
        kijunPeriod: 26,
        senkouBPeriod: 52,
        displacement: 26,
        trendFinderLookback: 30,
        trendFinderDev: 2.0,
        trendFinderThreshold: 'Strong',
        enableTrendFinderVolumeFilter: false,
        trendFinderVolumeMultiplier: 1.5,
        hideLowConfidenceTrend: false,
        ...PRO_UT_BOT_DEFAULTS,
        sessionA: { show: true, name: 'New York', session: '1300-2200', color: '#ff5d00', showRange: true, showTrendline: false, showMean: false, showVWAP: false, showMaxMin: false },
        sessionB: { show: true, name: 'London', session: '0700-1600', color: '#2157f3', showRange: true, showTrendline: false, showMean: false, showVWAP: false, showMaxMin: false },
        sessionC: { show: true, name: 'Tokyo', session: '0000-0900', color: '#e91e63', showRange: true, showTrendline: false, showMean: false, showVWAP: false, showMaxMin: false },
        sessionD: { show: true, name: 'Sydney', session: '2100-0600', color: '#ffeb3b', showRange: true, showTrendline: false, showMean: false, showVWAP: false, showMaxMin: false },
        timezoneOffset: 0,
        rangeTransparency: 10,
        showOutline: true,
        showSessionLabel: true,
        showSessionDashboard: true,
        advancedDashboard: false,
        // Smart Money Concepts defaults
        showSMC: false,
        smcStyle: 'Colored',
        smcMode: 'Historical',
        smcShowInternals: true,
        smcInternalBullFilter: 'All',
        smcInternalBearFilter: 'All',
        smcConfluenceFilter: false,
        smcShowSwing: true,
        smcSwingBullFilter: 'All',
        smcSwingBearFilter: 'All',
        smcSwingLength: 50,
        smcShowStrongWeakHL: true,
        smcShowInternalOB: true,
        smcInternalOBCount: 5,
        smcShowSwingOB: false,
        smcSwingOBCount: 5,
        smcOBFilter: 'Atr',
        smcOBMitigation: 'High/Low',
        smcShowEqualHL: true,
        smcEqualHLLength: 3,
        smcEqualHLThreshold: 0.1,
        smcShowFVG: false,
        smcFVGAutoThreshold: true,
        smcFVGExtendBars: 1,
        smcShowPDZones: false,
        smcL2Validation: true,
        smcCVDTrap: true,
        smcMicroFVG: true,
        smcSweepDetection: true,
        smcShowSwingPatterns: true,
        // ── Order Flow Visual Overlays ──
        showHeatmap: false,
        showCVD: false,
        showFootprint: false,
        // Dual Engine Defaults
        showDualEngine: false,
        dualEngineEmaPeriod: 50,
        dualEngineRsiPeriod: 14,
        dualEngineRsiOB: 70,
        dualEngineRsiOS: 30,
        dualEngineMacdFast: 12,
        dualEngineMacdSlow: 26,
        dualEngineMacdSignal: 9,
        dualEngineSqueezeLength: 20,
        dualEngineSqueezeBB: 2.0,
        dualEngineSqueezeKC: 1.5,
        dualEngineMode: 'Hybrid', // 'Hybrid' | 'Legacy'
        dualEngineAdxLength: 14,
        dualEngineAdxThreshold: 25,
        fredApiKey: '',
        showWatchlistScanner: false,
        // ── ICT Killzones & Pivots [TFO] ──
        showICTKillzones: false,
        ictShowPivots: true,
        ictPivotsExtend: 'Until Mitigated',
        ictShowDWM: true,
        ictShowDailyOpen: true,
        ictShowWeeklyOpen: false,
        ictShowMonthlyOpen: false,
        ictShowMidnightOpen: true,
        ictShowOpeningPrices: false,
        ictShowTimestamps: false,
        ictAsiaSession: '2000-0000',
        ictLondonSession: '0200-0500',
        ictNyAmSession: '0930-1100',
        ictNyLunchSession: '1200-1300',
        ictNyPmSession: '1330-1600',
        ictShowSilverBullet: false,
        ictShowConfluence: false,
        ictShowAMD: false,
        ictShowGaps: false,
        ictShowVolatility: false,
        ictShowEquilibrium: false,
        showICTPO3: false,

        luxShowIndicator: false,
        luxMode: 'Present',
        luxShowMS: true,
        luxSwingLength: 5,
        luxShowMSS: true,
        luxShowBOS: true,
        luxShowDisplacement: false,
        luxPercBody: 0.36,
        luxShowVIMB: true,
        luxVIMBThreshold: 2,
        luxShowOB: true,
        luxOBLookback: 10,
        luxShowBullOB: 1,
        luxShowBearOB: 1,
        luxShowOBLabels: false,
        luxShowLiq: true,
        luxLiqMargin: 2.5, // 10/4
        luxLiqVisibleCount: 2,
        luxShowFVG: true,
        luxBPR: false,
        luxFVGType: 'FVG',
        luxFVGVisibleCount: 2,
        luxShowNWOG: true,
        luxNWOGMax: 3,
        luxShowNDOG: false,
        luxNDOGMax: 1,
        luxFibMode: 'NONE',
        luxFibExtend: false,
        luxShowKillzones: false,
        // ── Quantum AI v8 ──
        showQuantumAI: false,
        quantumMinConf: 70,
        quantumVolatilityFilter: true,
        quantumVolThreshold: 0.2,
        showLiquidationHeatmap: false,
        liquidationHeatmapIntensity: 75,
        liquidationShowBubbles: true,
        liquidationShowSignalArrow: true,
        liquidationSmartMoneyBias: true,
        liquidationShowSmartMoneyHUD: true,
        liquidationShowTrailingCloud: true,
        liquidationShowTrueCVD: false,
        liquidationShowSpoofing: true,
        liquidationShowGEX: true,
        liquidationShowBookmap: true,
        liquidationBookmapIntensity: 50,
        liquidationBookmapHistoryMin: 120,
        liquidationSpoofingThreshold: 500000,
        liquidationShowMagnetZones: true,
        liquidationShowLeveragePools: true,
        liquidationPoolHorizon: '24h',
        liquidationShowTrajectory: true,
        // Supertrend Defaults
        showSupertrend: true,
        supertrendAtrPeriod: 10,
        supertrendMultiplier: 3.0,
        supertrendChangeATR: true,
        supertrendShowSignals: true,
        supertrendHighlighting: true,
        // MSB-OB Defaults
        showMsbOb: false,
        msbObZigzagLen: 9,
        msbObFibFactor: 0.33,
        msbObShowZigzag: true,
        msbObDeleteBroken: true,
        showCandlestickPatterns: false,
        // ── Wick Rejection S/R Defaults ──
        showWickSR: false,
        wickSRTimeframe: '15m',
        wickSRLookback: 300,
        wickSRMinTouches: 25,
        wickSRAtrPeriod: 14,
        wickSRAtrMultiplier: 0.5,
        wickSRShowZones: true,
        wickSRShowLabels: true,
        showVWAPSD: false,
        vwapSDMultiplier1: 1.0,
        vwapSDMultiplier2: 2.0,
        vwapSDMultiplier3: 2.5,
        vwapAnchor: 'Session',
        // ── Aether Flow System ──
        showAetherFlow: false,
        aetherUtBot: true,
        aetherSupertrend: true,
        aetherSmc: true,
        aetherFvg: true,
        // ── Liquidity Sweep, Swap & Iceberg Absorption ──
        showLiquiditySweepAbsorption: false,
        lsaSweepLookback: 20,
        lsaMinAbsorbedUsd: 50000,
        lsaAbsorptionWindowSec: 20,
        lsaMinReloads: 1,
        lsaMaxZones: 20,
        lsaSignalFilter: 'All',
        lsaShowIcebergMarkers: true,
        lsaShowLiquiditySwap: true,
        lsaShowBreakdownZones: true,
        lsaShowHistoricalZones: true,
        lsaShowHudSummary: true,
        lsaEnableAlerts: false,
    };

/**
 * Clean indicator preset with all visual overlays & heavy indicators turned OFF.
 * Used as the initial state for newly added extra charts (+ Add Chart) so opening
 * up to 4 charts does not multiply CPU/GPU thermal load unnecessarily.
 */
export const CLEAN_INDICATOR_SETTINGS: IndicatorSettings = sanitizeIndicatorSettings({
    ...DEFAULT_INDICATOR_SETTINGS,
    showEMA: false,
    showBB: false,
    showRSI: false,
    showMACD: false,
    showVolume: false,
    showAutoFibo: false,
    showIchimoku: false,
    showTrendFinder: false,
    showUTBot: false,
    showSessions: false,
    showQuantumAI: false,
    showLiquidationHeatmap: false,
    showSMC: false,
    showHeatmap: false,
    showCVD: false,
    showFootprint: false,
    showDualEngine: false,
    showWatchlistScanner: false,
    showICTKillzones: false,
    showICTPO3: false,
    luxShowIndicator: false,
    showSupertrend: false,
    showMsbOb: false,
    showCandlestickPatterns: false,
    showWickSR: false,
    showVWAPSD: false,
    showAetherFlow: false,
    showLiquiditySweepAbsorption: false,
});

export const useBotStore = create<BotState>()(
    persist(
        (set) => ({
            activeWallHunterId: null,
            setActiveWallHunterId: (id) => set({ activeWallHunterId: id }),
            activeBotsByChartId: {},
            setBotForChart: (chartId, id) => set((state) => ({ activeBotsByChartId: { ...state.activeBotsByChartId, [chartId]: id } })),
            removeBotForChart: (chartId) => set((state) => {
                const newBots = { ...state.activeBotsByChartId };
                delete newBots[chartId];
                return { activeBotsByChartId: newBots };
            }),
            pendingUtBotSync: null,
            setPendingUtBotSync: (payload) => set({ pendingUtBotSync: payload }),
            indicatorSettings: DEFAULT_INDICATOR_SETTINGS,
            indicatorSettingsByChartId: {
                main: DEFAULT_INDICATOR_SETTINGS,
            },
            setIndicatorSettings: (settings) => set((state) => {
                const nextMain = sanitizeIndicatorSettings({ ...state.indicatorSettings, ...settings });
                return {
                    indicatorSettings: nextMain,
                    indicatorSettingsByChartId: {
                        ...state.indicatorSettingsByChartId,
                        main: nextMain,
                    },
                };
            }),
            setChartIndicatorSettings: (chartId, settings) => set((state) => {
                const base = chartId === 'main'
                    ? (state.indicatorSettingsByChartId?.main || state.indicatorSettings || DEFAULT_INDICATOR_SETTINGS)
                    : (state.indicatorSettingsByChartId?.[chartId] || CLEAN_INDICATOR_SETTINGS);
                const next = sanitizeIndicatorSettings({ ...base, ...settings });
                if (chartId === 'main') {
                    return {
                        indicatorSettings: next,
                        indicatorSettingsByChartId: {
                            ...state.indicatorSettingsByChartId,
                            main: next,
                        },
                    };
                }
                return {
                    indicatorSettingsByChartId: {
                        ...state.indicatorSettingsByChartId,
                        [chartId]: next,
                    },
                };
            }),
            resetChartIndicatorSettings: (chartId) => set((state) => {
                const clean = { ...CLEAN_INDICATOR_SETTINGS };
                if (chartId === 'main') {
                    return {
                        indicatorSettings: clean,
                        indicatorSettingsByChartId: {
                            ...state.indicatorSettingsByChartId,
                            main: clean,
                        },
                    };
                }
                return {
                    indicatorSettingsByChartId: {
                        ...state.indicatorSettingsByChartId,
                        [chartId]: clean,
                    },
                };
            }),
        }),
        {
            name: 'bot-store-storage',
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                state.pendingUtBotSync = null;
                const migrateUtBotPreset = (cfg: IndicatorSettings): IndicatorSettings => {
                    if (!cfg.utBotPresetVersion || cfg.utBotPresetVersion < 2) {
                        return { ...cfg, ...PRO_UT_BOT_DEFAULTS };
                    }
                    return cfg;
                };
                if (state.indicatorSettings) {
                    state.indicatorSettings = sanitizeIndicatorSettings(
                        migrateUtBotPreset({
                            ...DEFAULT_INDICATOR_SETTINGS,
                            ...state.indicatorSettings,
                        })
                    );
                }
                const sanitizedMap: Record<string, IndicatorSettings> = {};
                const existingMap = state.indicatorSettingsByChartId || {};
                for (const [chartId, cfg] of Object.entries(existingMap)) {
                    if (cfg) {
                        sanitizedMap[chartId] = sanitizeIndicatorSettings(
                            migrateUtBotPreset({
                                ...CLEAN_INDICATOR_SETTINGS,
                                ...cfg,
                            })
                        );
                    }
                }
                // Keep 'main' synced with indicatorSettings for backward compatibility
                sanitizedMap.main = state.indicatorSettings || sanitizedMap.main || DEFAULT_INDICATOR_SETTINGS;
                state.indicatorSettingsByChartId = sanitizedMap;
            },
        }
    )
);
