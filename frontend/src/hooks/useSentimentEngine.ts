import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '@/services/client';
import { useMarketStore } from '@/store/marketStore';
import { useToast } from '@/context/ToastContext';
import { sentimentService } from '@/services/sentimentService';
import type { SentimentSource, SentimentLabel, SentimentHeatmapItem } from '@/types';
import { useSentimentSocket } from './useSentimentSocket';
import { Influencer } from '@/components/features/sentiment/InfluencerWatchlist'; // Assuming this is exported

// Define types locally if not available globally for strict typing
interface SentimentChartPoint {
    time: number;
    price: number;
    score: number;
    momentum?: number;
    social_volume?: number;
    smart_money_score?: number;
    netflow_status?: string;
    retail_score?: number;
    [key: string]: any;
}

// export const pairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']; // Removed for dynamic selection

export const useSentimentEngine = () => {
    const { showToast } = useToast();

    // State
    const [aiModel, setAiModel] = useState<'vader' | 'finbert'>('vader');
    const { globalSymbol: activePair, setGlobalSymbol: setActivePair, globalExchange: activeExchange, setGlobalExchange: setActiveExchange } = useMarketStore();
    const [chartData, setChartData] = useState<SentimentChartPoint[]>([]);
    const [sentimentSources, setSentimentSources] = useState<SentimentSource[]>([]);
    const [fearGreedIndex, setFearGreedIndex] = useState(50);
    const [fearGreedLabel, setFearGreedLabel] = useState('Neutral');
    const [activeFilter, setActiveFilter] = useState<'All' | SentimentLabel>('All');
    const [aiSummary, setAiSummary] = useState('');
    const [isSummaryLoading, setIsSummaryLoading] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState('gemini');

    // Timeframe
    const [timeframe, setTimeframe] = useState('1d');

    // Correlation
    const [correlation, setCorrelation] = useState(0);

    // Heatmap
    const [heatmapData, setHeatmapData] = useState<SentimentHeatmapItem[]>([]);
    const [isHeatmapLoading, setIsHeatmapLoading] = useState(false);

    // Narratives
    const [narratives, setNarratives] = useState<string[]>([]);
    const [wordCloud, setWordCloud] = useState<{ text: string; weight: number }[]>([]);
    const [isNarrativeLoading, setIsNarrativeLoading] = useState(false);
    const [hasNarrativesLoaded, setHasNarrativesLoaded] = useState(false);
    const [newSourceId, setNewSourceId] = useState<string | null>(null); // Kept for potential compatibility

    // Abort Controller
    const abortControllerRef = useRef<AbortController | null>(null);

    // New Features
    const [pollStats, setPollStats] = useState({ bullish_pct: 0, bearish_pct: 0, total_votes: 0 });
    const [influencers, setInfluencers] = useState<Influencer[]>([]);
    const [socialDominance, setSocialDominance] = useState<any[]>([]);

    // Smart Analysis (NER)
    const [isNerEnabled, setIsNerEnabled] = useState(false);
    const [nerData, setNerData] = useState<{ coins: string[], orgs: string[], events: string[] } | null>(null);
    const [isNerLoading, setIsNerLoading] = useState(false);

    const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

    const [activeSourceFilter, setActiveSourceFilter] = useState<'All' | string>('All');

    // Market Narrative Report
    const [marketReport, setMarketReport] = useState<any | null>(null);
    const [isReportLoading, setIsReportLoading] = useState(false);

    // Helpers
    const calculateCorrelation = (data: any[]) => {
        if (!data || data.length === 0) {
            setCorrelation(0);
            return;
        }
        const n = data.length;
        const x = data.map((d: any) => d.price);
        const y = data.map((d: any) => d.score);

        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumXY += x[i] * y[i];
            sumX2 += x[i] * x[i];
            sumY2 += y[i] * y[i];
        }

        const numerator = (n * sumXY) - (sumX * sumY);
        const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));

        if (denominator !== 0) {
            setCorrelation(numerator / denominator);
        } else {
            setCorrelation(0);
        }
    };

    const timeframeRef = useRef(timeframe);
    timeframeRef.current = timeframe;

    const handleTopicClick = useCallback((topic: string) => {
        setSelectedTopic(prev => prev === topic ? null : topic);
    }, []);

    const syncData = useCallback(async () => {
        // Cancel previous request if exists
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;
        const activeTimeframe = timeframeRef.current;

        setIsHeatmapLoading(true); // Using heatmap loading as global sync indicator
        try {
            // Fetch all 7 sentiment intelligence streams in parallel with allSettled so one slow/optional endpoint never breaks the terminal
            const [
                newsSettled,
                fgSettled,
                chartSettled,
                heatmapSettled,
                pollSettled,
                inflSettled,
                domSettled,
            ] = await Promise.allSettled([
                api.get('/sentiment/news', { params: { model: aiModel }, signal }),
                api.get('/sentiment/fear-greed', { signal }),
                api.get('/sentiment/correlation', { params: { symbol: activePair, period: activeTimeframe }, signal }),
                api.get('/sentiment/heatmap', { signal }),
                api.get('/sentiment/poll-stats', { params: { symbol: activePair }, signal }),
                api.get('/sentiment/influencers', { signal }),
                api.get('/sentiment/social-dominance', { signal }),
            ]);

            if (signal.aborted) return;

            // --- A. News ---
            if (newsSettled.status === 'fulfilled') {
                const rawNews = Array.isArray(newsSettled.value.data) ? newsSettled.value.data : [];
                const formattedNews = rawNews.map((item: any) => ({
                    id: item.id?.toString() || Math.random().toString(),
                    source: item.source || 'Unknown',
                    content: item.content || item.text,
                    sentiment: item.sentiment || 'Neutral',
                    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
                    url: item.url,
                    type: item.type,
                    impact_level: item.impact_level,
                    impact_score: item.impact_score,
                }));
                const finalNews = formattedNews.slice(0, 50);
                setSentimentSources(finalNews);
                try {
                    localStorage.setItem(`sentiment_sources_${activePair}`, JSON.stringify(finalNews));
                } catch {}
            }

            // --- B. Fear & Greed ---
            if (fgSettled.status === 'fulfilled' && fgSettled.value.data?.value) {
                const idx = parseInt(fgSettled.value.data.value);
                const lbl = fgSettled.value.data.value_classification || 'Neutral';
                setFearGreedIndex(idx);
                setFearGreedLabel(lbl);
                try {
                    localStorage.setItem('sentiment_fear_greed', JSON.stringify({ index: idx, label: lbl }));
                } catch {}
            }

            // --- C. Chart & Correlation ---
            if (chartSettled.status === 'fulfilled' && Array.isArray(chartSettled.value.data)) {
                setChartData(chartSettled.value.data);
                try {
                    localStorage.setItem(`sentiment_chart_${activePair}_${activeTimeframe}`, JSON.stringify(chartSettled.value.data));
                } catch {}
                calculateCorrelation(chartSettled.value.data);
            }

            // --- D. Heatmap ---
            if (heatmapSettled.status === 'fulfilled') {
                const hData = heatmapSettled.value.data || [];
                setHeatmapData(hData);
                try {
                    localStorage.setItem('sentiment_heatmap', JSON.stringify(hData));
                } catch {}
            }

            // --- E. Poll, Influencers & Social Dominance ---
            if (pollSettled.status === 'fulfilled' && pollSettled.value.data) {
                setPollStats(pollSettled.value.data);
            }
            if (inflSettled.status === 'fulfilled' && Array.isArray(inflSettled.value.data)) {
                setInfluencers(inflSettled.value.data);
            }
            if (domSettled.status === 'fulfilled' && Array.isArray(domSettled.value.data)) {
                setSocialDominance(domSettled.value.data);
            }
        } catch (err: any) {
            if (err.name === 'AbortError' || err.code === "ERR_CANCELED") {
                return;
            }
            console.error("Failed to sync data", err);
            showToast('Sync Failed. Check connection.', 'error');
        } finally {
            if (abortControllerRef.current === controller) {
                setIsHeatmapLoading(false);
            }
        }
    }, [activePair, aiModel, showToast]);

    const handleGenerateSummary = useCallback(async () => {
        showToast('Generating Summary...', 'info');
        setIsSummaryLoading(true);
        setAiSummary('');
        try {
            const headlines = sentimentSources.slice(0, 10).map(s => s.content).join('. ');
            const response = await api.post('/sentiment/summary', {
                headlines: headlines,
                asset: activePair,
                provider: selectedProvider
            });
            setAiSummary(response.data.summary);
            showToast('Summary Generated', 'success');
        } catch (error) {
            console.error("Error generating summary:", error);
            showToast('Failed to generate AI summary.', 'error');
        } finally {
            setIsSummaryLoading(false);
        }
    }, [sentimentSources, activePair, selectedProvider, showToast]);

    const handleGenerateNarratives = useCallback(async () => {
        setIsNarrativeLoading(true);
        try {
            const res = await api.get('/sentiment/narratives');
            if (res.data) {
                setNarratives(res.data.narratives || []);
                setWordCloud(res.data.word_cloud || []);
                setHasNarrativesLoaded(true);
                showToast('Market Narratives Generated Successfully!', 'success');
            }
        } catch (error) {
            console.error("Failed to fetch narratives", error);
            showToast('Failed to generate narratives.', 'error');
        } finally {
            setIsNarrativeLoading(false);
        }
    }, [showToast]);

    const handleVote = useCallback(async (type: 'bullish' | 'bearish') => {
        try {
            // user_id is now optional (Guest Mode supported by backend)
            await api.post('/sentiment/poll', { symbol: activePair, vote_type: type });
            showToast('Vote Registered!', 'success');
            const pollRes = await api.get('/sentiment/poll-stats', { params: { symbol: activePair } });
            setPollStats(pollRes.data);
        } catch (error) {
            console.error("Vote error:", error);
            showToast('Failed to submit vote.', 'error');
        }
    }, [activePair, showToast]);

    const fetchSmartAnalysis = useCallback(async () => {
        if (!isNerEnabled) return;
        setIsNerLoading(true);
        try {
            const result = await sentimentService.getSentimentAnalysis(activePair, true, aiModel);
            if (result.entities) {
                setNerData(result.entities);
            } else {
                setNerData({ coins: [], orgs: [], events: [] });
            }
        } catch (error) {
            console.error("Smart Analysis Failed", error);
            showToast('Failed to fetch Deep Entity Analysis', 'error');
        } finally {
            setIsNerLoading(false);
        }
    }, [activePair, isNerEnabled, aiModel, showToast]);


    const generateMarketReport = useCallback(async (language: 'en' | 'bn' = 'en') => {
        setIsReportLoading(true);
        try {
            // Fetch Whale Alerts (Best Effort)
            let whaleStats = { net_flow: 0, recent_count: 0, alerts: [] };
            try {
                const whaleRes = await api.get('/whale-alerts/recent?limit=5');
                const alerts = whaleRes.data || [];
                const volume = alerts.reduce((acc: number, alert: any) => acc + (alert.volume || 0), 0);
                whaleStats = { net_flow: volume, recent_count: alerts.length, alerts: alerts };
            } catch (e) {
                console.warn("Whale data fetch failed", e);
            }

            const lastPt = chartData[chartData.length - 1];
            const payload = {
                headlines: sentimentSources.slice(0, 15).map(s => s.content),
                score: lastPt?.score || 0,
                correlation: correlation,
                whale_stats: whaleStats,
                language: language
            };

            const res = await api.post('/sentiment/comprehensive-report', payload);
            setMarketReport(res.data);
            showToast('Market Narrative Report Generated', 'success');
        } catch (error) {
            console.error("Report Generation Failed", error);
            showToast('Failed to generate report', 'error');
        } finally {
            setIsReportLoading(false);
        }
    }, [sentimentSources, chartData, correlation, showToast]);

    // WebSocket Integration
    const { realTimeData } = useSentimentSocket(activePair);

    useEffect(() => {
        if (realTimeData && realTimeData.type === 'VOTE_UPDATE') {
            console.log("⚡ Real-time Vote Update:", realTimeData.data);
            setPollStats(realTimeData.data);
        }
    }, [realTimeData]);

    // Effects
    useEffect(() => {
        if (isNerEnabled) {
            fetchSmartAnalysis();
        } else {
            setNerData(null);
        }
    }, [isNerEnabled, activePair, aiModel, fetchSmartAnalysis]);

    useEffect(() => {
        const loadPersistedData = () => {
            try {
                const savedSources = localStorage.getItem(`sentiment_sources_${activePair}`);
                const savedFearGreed = localStorage.getItem('sentiment_fear_greed');
                const savedChart =
                    localStorage.getItem(`sentiment_chart_${activePair}_${timeframeRef.current}`) ||
                    localStorage.getItem(`sentiment_chart_${activePair}`);
                const savedHeatmap = localStorage.getItem('sentiment_heatmap');

                if (savedSources) setSentimentSources(JSON.parse(savedSources));
                if (savedFearGreed) {
                    const fg = JSON.parse(savedFearGreed);
                    setFearGreedIndex(fg.index);
                    setFearGreedLabel(fg.label);
                }
                if (savedChart) {
                    const parsedChart = JSON.parse(savedChart);
                    setChartData(parsedChart);
                    calculateCorrelation(parsedChart);
                }
                if (savedHeatmap) setHeatmapData(JSON.parse(savedHeatmap));
            } catch (e) {
                console.error("Failed to load persistence data", e);
            }
        };
        loadPersistedData();
        syncData();

        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [activePair, aiModel, syncData]);

    // Fetch only chart correlation when timeframe switches instead of re-syncing all 7 endpoints
    const initialTimeframeMountRef = useRef(true);
    useEffect(() => {
        if (initialTimeframeMountRef.current) {
            initialTimeframeMountRef.current = false;
            return;
        }
        const controller = new AbortController();
        const savedChart = localStorage.getItem(`sentiment_chart_${activePair}_${timeframe}`);
        if (savedChart) {
            try {
                const parsed = JSON.parse(savedChart);
                setChartData(parsed);
                calculateCorrelation(parsed);
            } catch {}
        }
        api.get('/sentiment/correlation', {
            params: { symbol: activePair, period: timeframe },
            signal: controller.signal,
        })
            .then((res) => {
                if (!controller.signal.aborted && Array.isArray(res.data)) {
                    setChartData(res.data);
                    try {
                        localStorage.setItem(`sentiment_chart_${activePair}_${timeframe}`, JSON.stringify(res.data));
                    } catch {}
                    calculateCorrelation(res.data);
                }
            })
            .catch(() => {});
        return () => controller.abort();
    }, [timeframe, activePair]);

    // Computed Metrics
    const currentMetrics = useMemo(() => {
        if (chartData.length === 0) return { currentScore: 0, currentMomentum: 0, currentVolume: 0, currentSmartMoney: 0, currentNetflow: 'Neutral' };
        const lastPoint = chartData[chartData.length - 1];
        return {
            currentScore: lastPoint.score || 0,
            currentMomentum: lastPoint.momentum || 0,
            currentVolume: lastPoint.social_volume || 0,
            currentSmartMoney: lastPoint.smart_money_score || 0,
            currentNetflow: lastPoint.netflow_status || 'Neutral'
        };
    }, [chartData]);

    const sourceBreakdownData = useMemo(() => {
        const counts = sentimentSources.reduce((acc, s) => ({ ...acc, [s.sentiment]: (acc[s.sentiment] || 0) + 1 }), {} as Record<SentimentLabel, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }, [sentimentSources]);

    const availableSources = useMemo(() => {
        const sources = new Set(sentimentSources.map(s => s.source));
        return Array.from(sources).filter(Boolean);
    }, [sentimentSources]);

    const filteredSources = useMemo(() => {
        let sources = sentimentSources;

        // 1. Sentiment Filter
        if (activeFilter !== 'All') {
            sources = sources.filter(s => s.sentiment === activeFilter);
        }

        // 2. Topic Filter
        if (selectedTopic) {
            const lowerTopic = selectedTopic.toLowerCase();
            sources = sources.filter(s =>
                (s.content && s.content.toLowerCase().includes(lowerTopic)) ||
                (s.source && s.source.toLowerCase().includes(lowerTopic))
            );
        }

        // 3. Source Filter (Compound Logic)
        if (activeSourceFilter !== 'All') {
            sources = sources.filter(s => s.source === activeSourceFilter);
        }

        return sources;
    }, [activeFilter, sentimentSources, selectedTopic, activeSourceFilter]);

    return {
        // State
        activePair,
        setActivePair,
        activeExchange,
        setActiveExchange,
        chartData,
        sentimentSources,
        fearGreedIndex,
        fearGreedLabel,
        activeFilter,
        setActiveFilter,
        aiSummary,
        isSummaryLoading,
        selectedProvider,
        setSelectedProvider,
        timeframe,
        setTimeframe,
        correlation,
        heatmapData,
        isHeatmapLoading,
        narratives,
        wordCloud,
        isNarrativeLoading,
        hasNarrativesLoaded,
        pollStats,
        influencers,
        socialDominance,
        isNerEnabled,
        setIsNerEnabled,
        nerData,
        isNerLoading,
        selectedTopic,
        activeSourceFilter,
        setActiveSourceFilter,
        availableSources,
        marketReport,
        isReportLoading,

        // Actions
        syncData,
        handleGenerateSummary,
        handleGenerateNarratives,
        handleVote,
        handleTopicClick,
        generateMarketReport,

        // Computed
        currentMetrics,
        sourceBreakdownData,
        filteredSources,
        aiModel,
        setAiModel
    };
};
