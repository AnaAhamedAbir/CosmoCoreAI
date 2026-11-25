import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity,
    ArrowUpRight,
    BarChart3,
    BrainCircuit,
    CheckCircle2,
    Download,
    FileText,
    Flame,
    Globe,
    Layers,
    Loader2,
    Newspaper,
    Radar,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Users,
    Zap,
} from 'lucide-react';
import { useSentimentEngine } from '@/hooks/useSentimentEngine';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import AssetSearchControl from '@/components/common/AssetSearchControl';
import { DigitalClock } from '@/components/common/DigitalClock';
import { EntityAnalysisWidget } from '@/components/features/sentiment/EntityAnalysisWidget';

// Domain Widgets
import { SentimentScoreCards } from '@/components/features/sentiment/SentimentScoreCards';
import {
    SentimentPriceChart,
    SentimentDivergenceChart,
} from '@/components/features/sentiment/SentimentCharts';
import { SentimentNewsFeed } from '@/components/features/sentiment/SentimentNewsFeed';
import { WhaleActivityWidget } from '@/components/features/sentiment/WhaleActivityWidget';
import { CommunityVoting } from '@/components/features/sentiment/CommunityVoting';
import { SentimentHeatmap } from '@/components/features/sentiment/SentimentHeatmap';
import { SentimentNarratives } from '@/components/features/sentiment/SentimentNarratives';
import { SentimentSignalAnalysis } from '@/components/features/sentiment/SentimentSignalAnalysis';
import OnChainLiquidityWidget from '@/components/features/sentiment/OnChainLiquidityWidget';
import ExchangeFlowWidget from '@/components/features/sentiment/ExchangeFlowWidget';
import FearGreedWidget from '@/components/features/sentiment/FearGreedWidget';
import { HighImpactWidget } from '@/components/features/sentiment/HighImpactWidget';
import { DarkPoolWidget } from '@/components/features/sentiment/DarkPoolWidget';
import SmartExecutionWidget from '@/components/features/trading/SmartExecutionWidget';
import { ArbitrageScannerWidget } from '@/components/features/sentiment/ArbitrageScannerWidget';
import { SentimentCommandCenter } from '@/components/features/sentiment/SentimentCommandCenter';
import { MacroEconomicWidget } from '@/components/features/sentiment/MacroEconomicWidget';

// Skeletons
import { MetricsSkeleton } from '@/components/features/sentiment/skeletons/MetricsSkeleton';
import { ChartSkeleton } from '@/components/features/sentiment/skeletons/ChartSkeleton';
import { HeatmapSkeleton } from '@/components/features/sentiment/skeletons/HeatmapSkeleton';

type SentimentWorkspaceTab =
    | 'all'
    | 'overview'
    | 'narratives'
    | 'whales'
    | 'macro_heatmap'
    | 'execution';

const QUICK_MAJOR_PAIRS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'] as const;

const SentimentEngine: React.FC = () => {
    const navigate = useNavigate();
    const thermalGuard = isThermalGuardActive();

    const {
        activePair,
        setActivePair,
        activeExchange,
        setActiveExchange,
        syncData,
        isHeatmapLoading,
        isNerEnabled,
        setIsNerEnabled,
        nerData,
        isNerLoading,
        currentMetrics,
        fearGreedIndex,
        fearGreedLabel,
        chartData,
        timeframe,
        setTimeframe,
        correlation,
        heatmapData,
        pollStats,
        handleVote,
        influencers,
        socialDominance,
        sentimentSources,
        filteredSources,
        activeFilter,
        setActiveFilter,
        narratives,
        wordCloud,
        isNarrativeLoading,
        hasNarrativesLoaded,
        handleGenerateNarratives,
        sourceBreakdownData,
        aiSummary,
        isSummaryLoading,
        selectedProvider,
        setSelectedProvider,
        handleGenerateSummary,
        aiModel,
        setAiModel,
        selectedTopic,
        activeSourceFilter,
        setActiveSourceFilter,
        availableSources,
        handleTopicClick,
        marketReport,
        isReportLoading,
        generateMarketReport,
    } = useSentimentEngine();

    const [activeWorkspaceTab, setActiveWorkspaceTab] =
        useState<SentimentWorkspaceTab>('all');
    const [reportLang, setReportLang] = useState<'en' | 'bn'>('en');
    const [showExecutiveBriefDrawer, setShowExecutiveBriefDrawer] = useState<boolean>(false);
    const [isExportOpen, setIsExportOpen] = useState<boolean>(false);

    // ── Institutional Composite Alpha & Conviction Telemetry ──
    const alphaTelemetry = useMemo(() => {
        const nlpScore = Number(currentMetrics?.currentScore || 0); // typically -1.0 to +1.0
        const smartMoney = Number(currentMetrics?.currentSmartMoney || 0); // typically -1.0 to +1.0
        const momentum = Number(currentMetrics?.currentMomentum || 0);
        const fgNormalized = (Number(fearGreedIndex || 50) - 50) / 50; // -1.0 to +1.0

        // Weighted Institutional Alpha Score (-100 to +100)
        const rawAlpha =
            smartMoney * 45 + nlpScore * 30 + fgNormalized * 15 + Math.tanh(momentum) * 10;
        const clampedAlpha = Math.max(-100, Math.min(100, Math.round(rawAlpha)));
        const convictionPct = Math.min(99, Math.max(15, Math.round(50 + clampedAlpha * 0.48)));

        const posCount = sentimentSources.filter((s) => s.sentiment === 'Positive').length;
        const negCount = sentimentSources.filter((s) => s.sentiment === 'Negative').length;
        const neuCount = sentimentSources.filter((s) => s.sentiment === 'Neutral').length;
        const highImpactCount = sentimentSources.filter((s) => s.impact_level === 'HIGH').length;
        const totalDirectional = posCount + negCount;
        const bullHeadlineRatio =
            totalDirectional > 0 ? Math.round((posCount / totalDirectional) * 100) : 50;

        // Divergence check: Smart Money vs Retail/Headline sentiment
        const isBullishDivergence = smartMoney > 0.15 && (nlpScore < 0 || fearGreedIndex < 42);
        const isBearishDivergence = smartMoney < -0.15 && (nlpScore > 0.15 || fearGreedIndex > 65);

        let regimeLabel = 'NEUTRAL / CONSOLIDATION';
        let actionLabel = 'WAIT FOR CATALYST';
        let tone: 'emerald' | 'rose' | 'amber' | 'cyan' = 'amber';

        if (isBullishDivergence) {
            regimeLabel = 'SMART MONEY ACCUMULATION (BULL DIV)';
            actionLabel = 'ACCUMULATE / LONG BIAS';
            tone = 'emerald';
        } else if (isBearishDivergence) {
            regimeLabel = 'INSTITUTIONAL DISTRIBUTION (BEAR DIV)';
            actionLabel = 'HEDGE / SHORT BIAS';
            tone = 'rose';
        } else if (clampedAlpha >= 20) {
            regimeLabel = 'HIGH-CONVICTION BULLISH MOMENTUM';
            actionLabel = 'LONG / MOMENTUM FOLLOW';
            tone = 'emerald';
        } else if (clampedAlpha <= -20) {
            regimeLabel = 'HIGH-CONVICTION BEARISH PRESSURE';
            actionLabel = 'SHORT / DEFENSIVE RISK';
            tone = 'rose';
        } else {
            regimeLabel = 'BALANCED / RANGE-BOUND SENTIMENT';
            actionLabel = 'MEAN-REVERSION SCALP';
            tone = 'cyan';
        }

        return {
            nlpScore,
            smartMoney,
            momentum,
            clampedAlpha,
            convictionPct,
            posCount,
            negCount,
            neuCount,
            highImpactCount,
            bullHeadlineRatio,
            isBullishDivergence,
            isBearishDivergence,
            regimeLabel,
            actionLabel,
            tone,
        };
    }, [currentMetrics, fearGreedIndex, sentimentSources]);

    const handleExportCSV = (type: 'chart' | 'news') => {
        if (type === 'chart' && chartData) {
            import('@/utils/exportUtils').then(({ downloadCSV }) => {
                downloadCSV(
                    chartData,
                    `sentiment_chart_${activePair.replace('/', '_')}_${new Date().toISOString().split('T')[0]}`
                );
            });
        } else if (type === 'news' && sentimentSources) {
            import('@/utils/exportUtils').then(({ downloadCSV }) => {
                downloadCSV(
                    sentimentSources,
                    `sentiment_news_${activePair.replace('/', '_')}_${new Date().toISOString().split('T')[0]}`
                );
            });
        }
        setIsExportOpen(false);
    };

    const handleSelectScannerOpportunity = (
        symbol: string,
        exchange: string,
        _action: string
    ) => {
        setActiveExchange(exchange);
        setActivePair(symbol);
    };

    const baseSymbol = useMemo(
        () => (activePair.includes('/') ? activePair.split('/')[0] : activePair),
        [activePair]
    );

    const latestReferencePrice = useMemo(() => {
        if (!Array.isArray(chartData) || chartData.length === 0) return 0;
        return Number(chartData[chartData.length - 1]?.price || 0);
    }, [chartData]);

    return (
        <div className="space-y-4 pb-8">
            {/* ── 1. TOP INSTITUTIONAL COMMAND DECK ── */}
            <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 shadow-sm overflow-visible">
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 rounded-t-2xl" />

                <div className="p-3.5 sm:p-4 flex flex-col gap-3">
                    {/* Row 1: Title, Active Venue/Pair Search, Quick Pairs & Action Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/35 flex items-center justify-center text-cyan-600 dark:text-cyan-300 shrink-0">
                                    <BrainCircuit className="w-5 h-5" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h1 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                                            Sentiment AI & Narrative Alpha
                                        </h1>
                                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono font-black uppercase">
                                            PRO QUANT
                                        </span>
                                        <div className="hidden xl:block pl-1">
                                            <DigitalClock className="text-xs font-mono text-slate-500 dark:text-gray-400" />
                                        </div>
                                    </div>
                                    <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                        Institutional NLP • Smart Money vs Retail Divergence • On-Chain Whale Flow
                                    </p>
                                </div>
                            </div>

                            <div className="h-6 w-px bg-slate-200 dark:bg-white/10 hidden lg:block" />

                            {/* Asset & Exchange Selector */}
                            <AssetSearchControl
                                activeExchange={activeExchange}
                                setActiveExchange={setActiveExchange}
                                activePair={activePair}
                                setActivePair={setActivePair}
                            />

                            {/* 1-Click Quick Asset Pills */}
                            <div className="hidden 2xl:flex items-center gap-1 bg-slate-100 dark:bg-[#050811] p-1 rounded-xl border border-slate-200 dark:border-white/10">
                                {QUICK_MAJOR_PAIRS.map((pair) => {
                                    const isCurrent = activePair === pair;
                                    return (
                                        <button
                                            key={pair}
                                            type="button"
                                            onClick={() => setActivePair(pair)}
                                            className={`px-2 py-1 rounded-lg text-[10.5px] font-mono font-black transition-colors cursor-pointer ${
                                                isCurrent
                                                    ? 'bg-cyan-500 text-slate-950 shadow-sm'
                                                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            {pair.split('/')[0]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right Cluster: NLP Model Switcher, Deep NER, AI Brief, Export & Sync */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* NLP Engine Switcher */}
                            <div
                                className="flex items-center bg-slate-100 dark:bg-[#050811] border border-slate-200 dark:border-white/10 p-0.5 rounded-xl"
                                title="Select NLP Sentiment Engine"
                            >
                                <button
                                    type="button"
                                    onClick={() => setAiModel('vader')}
                                    className={`px-2.5 py-1 text-[11px] font-mono font-black rounded-lg transition-colors cursor-pointer ${
                                        aiModel === 'vader'
                                            ? 'bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm'
                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    ⚡ VADER
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAiModel('finbert')}
                                    className={`px-2.5 py-1 text-[11px] font-mono font-black rounded-lg transition-colors cursor-pointer ${
                                        aiModel === 'finbert'
                                            ? 'bg-white dark:bg-purple-500 text-slate-900 dark:text-white shadow-sm'
                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    🧠 FinBERT
                                </button>
                            </div>

                            {/* Deep Entity NER Toggle */}
                            <button
                                type="button"
                                onClick={() => setIsNerEnabled(!isNerEnabled)}
                                className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                                    isNerEnabled
                                        ? 'bg-indigo-500/15 border-indigo-500/45 text-indigo-700 dark:text-indigo-300'
                                        : 'bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white'
                                }`}
                                title="Toggle Named Entity Recognition (Coins, Institutions & Macro Catalysts)"
                            >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>AI Entities</span>
                            </button>

                            {/* AI Executive Narrative Report Button */}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowExecutiveBriefDrawer((prev) => !prev);
                                    if (!marketReport && !isReportLoading) {
                                        generateMarketReport(reportLang);
                                    }
                                }}
                                className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-black flex items-center gap-1.5 transition-colors cursor-pointer ${
                                    showExecutiveBriefDrawer || marketReport
                                        ? 'bg-purple-500/15 border-purple-500/45 text-purple-700 dark:text-purple-300'
                                        : 'bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-200 hover:border-purple-500/40'
                                }`}
                                title="Open AI Executive Market Brief (EN / BN)"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                <span>Executive Brief</span>
                            </button>

                            {/* CSV / PDF Export Menu */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setIsExportOpen((prev) => !prev)}
                                    className="px-2.5 py-1.5 rounded-xl border bg-slate-100 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                                    title="Export Sentiment Telemetry"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Export</span>
                                </button>
                                {isExportOpen && (
                                    <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-[#0b101d] rounded-xl shadow-2xl border border-slate-200 dark:border-white/15 z-50 overflow-hidden text-xs font-mono">
                                        <button
                                            type="button"
                                            onClick={() => handleExportCSV('chart')}
                                            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer"
                                        >
                                            <span>📊 Export Chart CSV</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleExportCSV('news')}
                                            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 border-t border-slate-100 dark:border-white/5 cursor-pointer"
                                        >
                                            <span>📰 Export News Tape CSV</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                window.print();
                                                setIsExportOpen(false);
                                            }}
                                            className="w-full text-left px-3.5 py-2.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 flex items-center gap-2 border-t border-slate-100 dark:border-white/5 cursor-pointer"
                                        >
                                            <span>🖨️ Print / Save PDF</span>
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Sync Data Button */}
                            <button
                                type="button"
                                onClick={syncData}
                                disabled={isHeatmapLoading}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white text-xs font-mono font-black uppercase tracking-wider shadow-[0_4px_14px_rgba(6,182,212,0.25)] cursor-pointer disabled:opacity-50"
                            >
                                {isHeatmapLoading ? (
                                    <>
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        <span>Syncing</span>
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        <span>Sync Intel</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Conditional Deep Entity NER Drawer */}
                    {isNerEnabled && nerData && (
                        <div className="pt-2 border-t border-slate-200 dark:border-white/10">
                            <EntityAnalysisWidget data={nerData} isLoading={isNerLoading} />
                        </div>
                    )}

                    {/* Conditional AI Executive Market Brief Drawer (Inline Institutional Report) */}
                    {showExecutiveBriefDrawer && (
                        <div className="pt-3 border-t border-slate-200 dark:border-white/10">
                            <div className="rounded-xl bg-slate-50 dark:bg-[#050811] border border-purple-500/30 p-4 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <BrainCircuit className="w-4 h-4 text-purple-500" />
                                        <span className="text-xs font-mono font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                            AI Executive Market Narrative Brief ({activePair})
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10 rounded-lg p-0.5 text-[10px] font-mono font-bold">
                                            <button
                                                type="button"
                                                onClick={() => setReportLang('en')}
                                                className={`px-2 py-0.5 rounded cursor-pointer ${
                                                    reportLang === 'en'
                                                        ? 'bg-purple-500 text-white'
                                                        : 'text-slate-500 dark:text-gray-400'
                                                }`}
                                            >
                                                EN
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setReportLang('bn')}
                                                className={`px-2 py-0.5 rounded cursor-pointer ${
                                                    reportLang === 'bn'
                                                        ? 'bg-purple-500 text-white'
                                                        : 'text-slate-500 dark:text-gray-400'
                                                }`}
                                            >
                                                BN
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => generateMarketReport(reportLang)}
                                            disabled={isReportLoading}
                                            className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-mono font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                        >
                                            {isReportLoading ? (
                                                <>
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                    <span>Synthesizing...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <RefreshCw className="w-3 h-3" />
                                                    <span>Regenerate Brief</span>
                                                </>
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowExecutiveBriefDrawer(false)}
                                            className="px-2 py-1 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                        >
                                            Hide
                                        </button>
                                    </div>
                                </div>

                                {isReportLoading ? (
                                    <div className="py-6 text-center text-xs font-mono text-purple-600 dark:text-purple-300 flex items-center justify-center gap-2">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>
                                            Synthesizing headlines, whale netflows, and price-sentiment correlation...
                                        </span>
                                    </div>
                                ) : marketReport ? (
                                    <div className="space-y-3 text-xs">
                                        <div className="p-3 rounded-xl bg-white dark:bg-[#0b101d] border border-purple-500/25">
                                            <span className="block text-[10px] font-mono font-black uppercase text-purple-600 dark:text-purple-400 mb-1">
                                                Executive Thesis
                                            </span>
                                            <p className="text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
                                                {marketReport.executive_summary}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
                                            <div className="p-2.5 rounded-xl bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                                                <span className="block text-[10px] font-mono font-bold uppercase text-cyan-600 dark:text-cyan-400 mb-1">
                                                    Score Analysis
                                                </span>
                                                <p className="text-slate-600 dark:text-slate-300 leading-snug">
                                                    {marketReport.score_analysis}
                                                </p>
                                            </div>
                                            <div className="p-2.5 rounded-xl bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                                                <span className="block text-[10px] font-mono font-bold uppercase text-indigo-600 dark:text-indigo-400 mb-1">
                                                    News Narrative
                                                </span>
                                                <p className="text-slate-600 dark:text-slate-300 leading-snug">
                                                    {marketReport.news_summary}
                                                </p>
                                            </div>
                                            <div className="p-2.5 rounded-xl bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                                                <span className="block text-[10px] font-mono font-bold uppercase text-emerald-600 dark:text-emerald-400 mb-1">
                                                    Correlation Insight
                                                </span>
                                                <p className="text-slate-600 dark:text-slate-300 leading-snug">
                                                    {marketReport.correlation_insight}
                                                </p>
                                            </div>
                                            <div className="p-2.5 rounded-xl bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                                                <span className="block text-[10px] font-mono font-bold uppercase text-amber-600 dark:text-amber-400 mb-1">
                                                    Whale Activity
                                                </span>
                                                <p className="text-slate-600 dark:text-slate-300 leading-snug">
                                                    {marketReport.whale_insight}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="py-4 text-center text-xs font-mono text-slate-500">
                                        Click &ldquo;Regenerate Brief&rdquo; to compile an AI executive narrative report.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── 2. 4-CARD LIVE ALPHA CONVICTION STRIP (ABOVE THE FOLD) ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {/* Card 1: Composite Alpha Conviction & Action Bias */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-3.5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Composite Alpha Signal
                        </span>
                        <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase border ${
                                alphaTelemetry.tone === 'emerald'
                                    ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600 dark:text-emerald-300'
                                    : alphaTelemetry.tone === 'rose'
                                      ? 'bg-rose-500/15 border-rose-500/35 text-rose-600 dark:text-rose-300'
                                      : 'bg-cyan-500/15 border-cyan-500/35 text-cyan-600 dark:text-cyan-300'
                            }`}
                        >
                            {alphaTelemetry.convictionPct}% Conviction
                        </span>
                    </div>

                    <div className="my-2">
                        <div className="text-sm font-black tracking-tight text-slate-900 dark:text-white truncate">
                            {alphaTelemetry.regimeLabel}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs font-mono">
                            <span className="text-slate-500 dark:text-gray-400">Desk Bias:</span>
                            <span
                                className={`font-black ${
                                    alphaTelemetry.tone === 'emerald'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : alphaTelemetry.tone === 'rose'
                                          ? 'text-rose-600 dark:text-rose-400'
                                          : 'text-cyan-600 dark:text-cyan-400'
                                }`}
                            >
                                {alphaTelemetry.actionLabel}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-white/5">
                        <button
                            type="button"
                            onClick={() => navigate('/level2-wallhunter-bot')}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[10.5px] font-mono font-black uppercase flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                            <Zap className="w-3 h-3" />
                            <span>L2 WallHunter</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveWorkspaceTab('execution')}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-200 text-[10.5px] font-mono font-black uppercase flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                            <span>Smart Exec</span>
                            <ArrowUpRight className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {/* Card 2: Institutional Smart Money vs Retail NLP */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-3.5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Smart Money vs NLP Score
                        </span>
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/25 text-indigo-600 dark:text-indigo-300">
                            {currentMetrics.currentNetflow || 'Neutral Flow'}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 my-2 font-mono">
                        <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10">
                            <span className="block text-[9.5px] text-slate-500 dark:text-gray-400 uppercase">
                                Smart Money
                            </span>
                            <span
                                className={`text-base font-black ${
                                    alphaTelemetry.smartMoney > 0.1
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : alphaTelemetry.smartMoney < -0.1
                                          ? 'text-rose-600 dark:text-rose-400'
                                          : 'text-slate-800 dark:text-white'
                                }`}
                            >
                                {alphaTelemetry.smartMoney > 0 ? '+' : ''}
                                {alphaTelemetry.smartMoney.toFixed(2)}
                            </span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10">
                            <span className="block text-[9.5px] text-slate-500 dark:text-gray-400 uppercase">
                                {aiModel.toUpperCase()} NLP
                            </span>
                            <span
                                className={`text-base font-black ${
                                    alphaTelemetry.nlpScore > 0.1
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : alphaTelemetry.nlpScore < -0.1
                                          ? 'text-rose-600 dark:text-rose-400'
                                          : 'text-slate-800 dark:text-white'
                                }`}
                            >
                                {alphaTelemetry.nlpScore > 0 ? '+' : ''}
                                {alphaTelemetry.nlpScore.toFixed(2)}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-gray-400 pt-1 border-t border-slate-100 dark:border-white/5">
                        <span>Momentum: {alphaTelemetry.momentum.toFixed(2)}</span>
                        <span>Social Vol: {currentMetrics.currentVolume}</span>
                    </div>
                </div>

                {/* Card 3: Fear & Greed Macro Regime */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-3.5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Fear & Greed Regime
                        </span>
                        <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase border ${
                                fearGreedIndex < 30
                                    ? 'bg-rose-500/15 border-rose-500/35 text-rose-600 dark:text-rose-300'
                                    : fearGreedIndex > 65
                                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600 dark:text-emerald-300'
                                      : 'bg-amber-500/15 border-amber-500/35 text-amber-600 dark:text-amber-300'
                            }`}
                        >
                            {fearGreedLabel}
                        </span>
                    </div>

                    <div className="my-2">
                        <div className="flex items-baseline justify-between font-mono">
                            <span className="text-2xl font-black text-slate-900 dark:text-white">
                                {fearGreedIndex}
                                <span className="text-xs font-normal text-slate-400"> / 100</span>
                            </span>
                            <span className="text-[10.5px] font-bold text-slate-500 dark:text-gray-400">
                                {fearGreedIndex < 25
                                    ? 'Contrarian Buy Zone'
                                    : fearGreedIndex > 75
                                      ? 'Contrarian Take-Profit'
                                      : 'Balanced Emotion'}
                            </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden mt-2">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500"
                                style={{ width: `${Math.min(100, Math.max(4, fearGreedIndex))}%` }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-gray-400 pt-1 border-t border-slate-100 dark:border-white/5">
                        <span>Price-Sentiment r:</span>
                        <span
                            className={`font-black ${
                                Math.abs(correlation) > 0.5
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-amber-600 dark:text-amber-400'
                            }`}
                        >
                            {correlation.toFixed(2)} ({correlation > 0.5 ? 'Strong Sync' : 'Decoupled'})
                        </span>
                    </div>
                </div>

                {/* Card 4: News Velocity, High-Impact Flash Catalysts & Bull/Bear Ratio */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-3.5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                            Headline & Catalyst Tape
                        </span>
                        <button
                            type="button"
                            onClick={() => setActiveWorkspaceTab('narratives')}
                            className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/35 text-rose-600 dark:text-rose-300 text-[10px] font-mono font-black uppercase cursor-pointer"
                        >
                            ⚡ {alphaTelemetry.highImpactCount} High-Impact
                        </button>
                    </div>

                    <div className="my-2">
                        <div className="flex items-center justify-between text-xs font-mono font-bold mb-1">
                            <span className="text-emerald-600 dark:text-emerald-400">
                                {alphaTelemetry.posCount} Bull ({alphaTelemetry.bullHeadlineRatio}%)
                            </span>
                            <span className="text-slate-400">{alphaTelemetry.neuCount} Neu</span>
                            <span className="text-rose-600 dark:text-rose-400">
                                {alphaTelemetry.negCount} Bear ({100 - alphaTelemetry.bullHeadlineRatio}%)
                            </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-rose-500/40 overflow-hidden flex">
                            <div
                                className="h-full bg-emerald-500"
                                style={{
                                    width: `${Math.min(96, Math.max(4, alphaTelemetry.bullHeadlineRatio))}%`,
                                }}
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-500 dark:text-gray-400 pt-1 border-t border-slate-100 dark:border-white/5">
                        <span>Tracked Sources: {availableSources.length}</span>
                        <span>Total Signals: {sentimentSources.length}</span>
                    </div>
                </div>
            </div>

            {/* ── 3. SAAS WORKSPACE NAVIGATION TABS (Full Desk by default + Focused Section Filters) ── */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#070b14] p-1.5 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm">
                <div className="flex flex-wrap items-center gap-1">
                    {(
                        [
                            {
                                id: 'all',
                                label: 'All Intelligence (Full Desk)',
                                icon: <Layers className="w-3.5 h-3.5" />,
                                badge: '18 Modules',
                            },
                            {
                                id: 'overview',
                                label: 'Overview & Divergence',
                                icon: <BarChart3 className="w-3.5 h-3.5" />,
                                badge: null,
                            },
                            {
                                id: 'narratives',
                                label: 'AI Narratives & News Tape',
                                icon: <Newspaper className="w-3.5 h-3.5" />,
                                badge: sentimentSources.length || null,
                            },
                            {
                                id: 'whales',
                                label: 'Whales, Dark Pool & On-Chain',
                                icon: <Radar className="w-3.5 h-3.5" />,
                                badge: 'LIVE',
                            },
                            {
                                id: 'macro_heatmap',
                                label: 'Market Heatmap & Macro',
                                icon: <Globe className="w-3.5 h-3.5" />,
                                badge: heatmapData.length || null,
                            },
                            {
                                id: 'execution',
                                label: 'Smart Execution Desk',
                                icon: <Zap className="w-3.5 h-3.5" />,
                                badge: null,
                            },
                        ] as const
                    ).map((tab) => {
                        const active = activeWorkspaceTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveWorkspaceTab(tab.id)}
                                className={`px-3 py-2 rounded-xl text-xs font-mono font-black flex items-center gap-2 transition-colors cursor-pointer ${
                                    active
                                        ? 'bg-cyan-500 text-slate-950 shadow-sm'
                                        : 'text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5'
                                }`}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                                {tab.badge && (
                                    <span
                                        className={`px-1.5 py-0.2 rounded text-[9.5px] font-black ${
                                            active
                                                ? 'bg-slate-950/20 text-slate-950'
                                                : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                                        }`}
                                    >
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {selectedTopic && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/15 border border-indigo-500/35 text-xs font-mono text-indigo-700 dark:text-indigo-300">
                        <span>Topic Filter: #{selectedTopic}</span>
                        <button
                            type="button"
                            onClick={() => handleTopicClick(selectedTopic)}
                            className="font-black hover:text-rose-500 ml-1 cursor-pointer"
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>

            {/* ── 4. ACTIVE WORKSPACE BODY (All 18 Original Modules Preserved & Organized) ── */}
            <SentimentCommandCenter
                report={marketReport}
                isLoading={isReportLoading}
                onGenerate={generateMarketReport}
            />

            {(activeWorkspaceTab === 'all' || activeWorkspaceTab === 'overview') && (
                <div className="space-y-6">
                    {/* Top Divergence Alpha Scanner Hotlist */}
                    <div className="h-72">
                        <ArbitrageScannerWidget
                            onSelectOpportunity={handleSelectScannerOpportunity}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left Column: Smart Money Reactor + Fear/Greed + On-Chain Liquidity & Exchange Flow */}
                        <div className="lg:col-span-1 space-y-6">
                            {isHeatmapLoading && !currentMetrics ? (
                                <MetricsSkeleton />
                            ) : (
                                <SentimentScoreCards
                                    data={{
                                        ...currentMetrics,
                                        fearGreedIndex,
                                        fearGreedLabel,
                                    }}
                                    onActionClick={() => setActiveWorkspaceTab('execution')}
                                />
                            )}
                            <FearGreedWidget />
                            <OnChainLiquidityWidget symbol={activePair} />
                            <ExchangeFlowWidget />
                        </div>

                        {/* Right Column: Dual-Axis Sentiment vs Price + Smart Money vs Retail Divergence + High Impact Catalysts */}
                        <div className="lg:col-span-2 flex flex-col space-y-6">
                            {isHeatmapLoading && !chartData ? (
                                <ChartSkeleton />
                            ) : (
                                <>
                                    <SentimentPriceChart
                                        historyData={chartData}
                                        timeframe={timeframe}
                                        setTimeframe={setTimeframe}
                                        activePair={activePair}
                                        correlation={correlation}
                                    />
                                    <SentimentDivergenceChart
                                        data={chartData}
                                        correlation={correlation}
                                    />
                                </>
                            )}
                            <HighImpactWidget news={filteredSources} />
                        </div>
                    </div>
                </div>
            )}

            {(activeWorkspaceTab === 'all' || activeWorkspaceTab === 'macro_heatmap') && (
                <div className="space-y-6">
                    {isHeatmapLoading && heatmapData.length === 0 ? (
                        <HeatmapSkeleton />
                    ) : (
                        <SentimentHeatmap
                            heatmapData={heatmapData}
                            isHeatmapLoading={isHeatmapLoading}
                            onSync={syncData}
                        />
                    )}

                    <MacroEconomicWidget />

                    <CommunityVoting
                        votes={pollStats}
                        onVote={handleVote}
                        influencers={influencers}
                    />
                </div>
            )}

            {(activeWorkspaceTab === 'all' || activeWorkspaceTab === 'narratives') && (
                <div className="space-y-6">
                    {/* Cross-Asset Social Dominance Mindshare Strip */}
                    {Array.isArray(socialDominance) && socialDominance.length > 0 && (
                        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-2.5">
                                <span className="text-xs font-mono font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                    📡 Cross-Asset Social Mindshare Dominance
                                </span>
                                <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                    Click asset to inspect narrative
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {socialDominance.map((item: any, idx: number) => {
                                    const sym = String(item.symbol || item.asset || item.name || '').toUpperCase();
                                    const share = Number(item.dominance ?? item.share ?? item.value ?? 0);
                                    if (!sym) return null;
                                    const pairStr = sym.includes('/') ? sym : `${sym}/USDT`;
                                    const isCurrent = activePair.toUpperCase() === pairStr;
                                    return (
                                        <button
                                            key={`${sym}-${idx}`}
                                            type="button"
                                            onClick={() => setActivePair(pairStr)}
                                            className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                                                isCurrent
                                                    ? 'bg-cyan-500/15 border-cyan-500/45 text-cyan-700 dark:text-cyan-300'
                                                    : 'bg-slate-50 dark:bg-[#050811] border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300 hover:border-cyan-500/30'
                                            }`}
                                        >
                                            <span className="font-black">{sym}</span>
                                            {share > 0 && (
                                                <span className="px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 text-[10px]">
                                                    {share.toFixed(1)}%
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Narrative Mindshare Cloud + Top Emerging Narratives */}
                    <SentimentNarratives
                        narratives={narratives}
                        wordCloud={wordCloud}
                        isNarrativeLoading={isNarrativeLoading}
                        hasNarrativesLoaded={hasNarrativesLoaded}
                        onGenerateNarratives={handleGenerateNarratives}
                        onWordClick={handleTopicClick}
                        selectedWord={selectedTopic}
                    />

                    {/* Signal Source Breakdown + Multi-LLM Intelligence Synthesizer & Smart Execution Widget */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <SentimentSignalAnalysis
                                sourceBreakdownData={sourceBreakdownData}
                                sentimentSources={sentimentSources}
                                aiSummary={aiSummary}
                                isSummaryLoading={isSummaryLoading}
                                selectedProvider={selectedProvider}
                                setSelectedProvider={setSelectedProvider}
                                onGenerateSummary={handleGenerateSummary}
                            />
                        </div>
                        <div className="lg:col-span-1">
                            <SmartExecutionWidget
                                symbol={activePair}
                                referencePrice={latestReferencePrice}
                                defaultSide={alphaTelemetry.clampedAlpha < 0 ? 'sell' : 'buy'}
                            />
                        </div>
                    </div>

                    {/* Dark Pool, Whale Activity & Verified Neural News Stream */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1 space-y-6">
                            <DarkPoolWidget symbol={baseSymbol} />
                            <WhaleActivityWidget />
                        </div>
                        <div className="lg:col-span-2">
                            <SentimentNewsFeed
                                news={filteredSources}
                                activeFilter={activeFilter}
                                setActiveFilter={setActiveFilter}
                                activeSourceFilter={activeSourceFilter}
                                onSourceSelect={setActiveSourceFilter}
                                availableSources={availableSources}
                            />
                        </div>
                    </div>
                </div>
            )}

            {activeWorkspaceTab === 'whales' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <DarkPoolWidget symbol={baseSymbol} />
                        <WhaleActivityWidget />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <OnChainLiquidityWidget symbol={activePair} />
                        <ExchangeFlowWidget />
                    </div>
                </div>
            )}

            {activeWorkspaceTab === 'execution' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left 1 Col: Smart Execution Widget */}
                    <div className="lg:col-span-1">
                        <SmartExecutionWidget
                            symbol={activePair}
                            referencePrice={latestReferencePrice}
                            defaultSide={alphaTelemetry.clampedAlpha < 0 ? 'sell' : 'buy'}
                        />
                    </div>

                    {/* Right 2 Cols: Pre-Trade Sentiment Confluence Matrix & Direct Terminal Launchers */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-5 shadow-sm space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-white/10">
                                <div>
                                    <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                                        <ShieldCheck className="w-5 h-5 text-cyan-500" />
                                        <span>Pre-Trade Sentiment Confluence Checklist ({activePair})</span>
                                    </h3>
                                    <p className="text-xs font-mono text-slate-500 dark:text-gray-400">
                                        Verify multi-factor institutional alignment before committing capital
                                    </p>
                                </div>
                                <span
                                    className={`px-3 py-1 rounded-xl text-xs font-mono font-black uppercase border ${
                                        alphaTelemetry.tone === 'emerald'
                                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                                            : alphaTelemetry.tone === 'rose'
                                              ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-300'
                                              : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
                                    }`}
                                >
                                    {alphaTelemetry.actionLabel}
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-xs">
                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 flex items-center justify-between">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 dark:text-gray-400 uppercase">
                                            1. Institutional Smart Money
                                        </span>
                                        <span className="font-bold text-slate-900 dark:text-white">
                                            {alphaTelemetry.smartMoney > 0.15
                                                ? 'Accumulating (Bullish)'
                                                : alphaTelemetry.smartMoney < -0.15
                                                  ? 'Distributing (Bearish)'
                                                  : 'Neutral Flow'}
                                        </span>
                                    </div>
                                    <span
                                        className={`text-sm font-black ${
                                            alphaTelemetry.smartMoney >= 0
                                                ? 'text-emerald-500'
                                                : 'text-rose-500'
                                        }`}
                                    >
                                        {alphaTelemetry.smartMoney > 0 ? '+' : ''}
                                        {alphaTelemetry.smartMoney.toFixed(2)}
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 flex items-center justify-between">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 dark:text-gray-400 uppercase">
                                            2. {aiModel.toUpperCase()} News NLP Bias
                                        </span>
                                        <span className="font-bold text-slate-900 dark:text-white">
                                            {alphaTelemetry.bullHeadlineRatio}% Bullish Headlines
                                        </span>
                                    </div>
                                    <span
                                        className={`text-sm font-black ${
                                            alphaTelemetry.nlpScore >= 0
                                                ? 'text-emerald-500'
                                                : 'text-rose-500'
                                        }`}
                                    >
                                        {alphaTelemetry.nlpScore > 0 ? '+' : ''}
                                        {alphaTelemetry.nlpScore.toFixed(2)}
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 flex items-center justify-between">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 dark:text-gray-400 uppercase">
                                            3. Fear & Greed Contrarian Check
                                        </span>
                                        <span className="font-bold text-slate-900 dark:text-white">
                                            {fearGreedLabel}
                                        </span>
                                    </div>
                                    <span className="text-sm font-black text-cyan-500">
                                        {fearGreedIndex} / 100
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 flex items-center justify-between">
                                    <div>
                                        <span className="block text-[10px] text-slate-500 dark:text-gray-400 uppercase">
                                            4. Flash Catalyst Risk
                                        </span>
                                        <span className="font-bold text-slate-900 dark:text-white">
                                            {alphaTelemetry.highImpactCount > 0
                                                ? `${alphaTelemetry.highImpactCount} Critical Catalysts Active`
                                                : 'No High-Impact Shock'}
                                        </span>
                                    </div>
                                    <span className="text-sm font-black text-amber-500">
                                        r = {correlation.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            <div className="pt-2 flex flex-wrap items-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => navigate('/level2-wallhunter-bot')}
                                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white text-xs font-mono font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer shadow-md"
                                >
                                    <Zap className="w-4 h-4" />
                                    <span>Execute on L2 WallHunter Terminal</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => navigate('/market')}
                                    className="px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-800 dark:text-white text-xs font-mono font-black uppercase tracking-wider flex items-center gap-2 cursor-pointer"
                                >
                                    <span>Open Live Market Spot/TWAP Desk</span>
                                    <ArrowUpRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <HighImpactWidget news={filteredSources} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default SentimentEngine;
