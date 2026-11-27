import React, { useState, useEffect } from 'react';
import Card from "@/components/common/Card";
import { Shield, TrendingUp, TrendingDown, Activity, Zap, Layers } from 'lucide-react';
import apiClient from '@/services/client';
import { ResponsiveContainer, BarChart, Bar, Cell, Tooltip } from 'recharts';
import { useTheme } from '@/context/ThemeContext';

interface BlockTrade {
    timestamp: string;
    volume: number;
    price: number;
    side: 'BUY' | 'SELL';
    source: string;
    value_usd: number;
}

interface InstitutionalData {
    sentiment_score: number;
    net_flow: number;
    large_buy_volume: number;
    large_sell_volume: number;
    block_trades: BlockTrade[];
}

interface DarkPoolWidgetProps {
    symbol?: string;
}

export const DarkPoolWidget: React.FC<DarkPoolWidgetProps> = React.memo(({ symbol = 'BTC' }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [data, setData] = useState<InstitutionalData | null>(null);
    const [loading, setLoading] = useState(true);

    // Mock data for chart
    const mockChartData = [
        { name: '10:00', flow: 2.5 },
        { name: '10:15', flow: -1.2 },
        { name: '10:30', flow: 4.0 },
        { name: '10:45', flow: -0.5 },
        { name: '11:00', flow: 1.8 },
        { name: '11:15', flow: 3.2 },
        { name: '11:30', flow: -2.1 },
    ];

    useEffect(() => {
        const fetchData = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const res = await apiClient.get(`/sentiment/dark-pool/${symbol}`);
                setData(res.data);
            } catch (error) {
                console.error("Failed to fetch dark pool data", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, 20000);
        return () => clearInterval(interval);
    }, [symbol]);

    const getSentimentColor = (score: number) => {
        if (score > 0.2) return 'text-emerald-600 dark:text-emerald-400 dark:drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]';
        if (score < -0.2) return 'text-rose-600 dark:text-rose-500 dark:drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]';
        return 'text-slate-600 dark:text-slate-400';
    };

    const getSentimentGradient = (score: number | undefined) => {
        if (!score) return 'from-slate-50 to-slate-100 border-slate-200 dark:from-slate-800 dark:to-slate-900 dark:border-[#1F1F1F]/30';
        if (score > 0.2) return 'from-emerald-50 to-white border-emerald-200 dark:from-emerald-950/40 dark:to-slate-900 dark:border-emerald-500/20';
        if (score < -0.2) return 'from-rose-50 to-white border-rose-200 dark:from-rose-950/40 dark:to-slate-900 dark:border-rose-500/20';
        return 'from-slate-50 to-slate-100 border-slate-200 dark:from-slate-800 dark:to-slate-900 dark:border-[#1F1F1F]/30';
    };

    return (
        <Card className="w-full h-[380px] !p-0 border border-slate-200 dark:border-white/10 bg-white dark:bg-[#070b14] shadow-sm overflow-hidden relative group">
            {/* Header */}
            <div className="relative px-5 py-4 border-b border-slate-200 dark:border-white/5 flex justify-between items-center bg-slate-50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.15)]">
                        <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-wide uppercase">Dark Pool Intel</h3>
                        <div className="flex items-center gap-1.5 text-[10px] text-indigo-600 dark:text-indigo-300 font-mono">
                            <Zap className="h-3 w-3" /> INSTITUTIONAL FLOW
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    <span className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider">LIVE</span>
                    </span>
                    <span className="text-[9px] text-slate-500 dark:text-slate-600 mt-0.5">{symbol}/USD (OTC)</span>
                </div>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 h-[calc(100%-65px)]">

                {/* Visual Sentiment Column */}
                <div className="flex flex-col justify-between h-full space-y-2">
                    {/* Big Score Card */}
                    <div className={`flex-1 relative rounded-2xl border p-4 flex flex-col items-center justify-center bg-gradient-to-br ${getSentimentGradient(data?.sentiment_score)}`}>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2 font-semibold">Net Bias</div>

                        {loading ? (
                            <div className="h-10 w-20 bg-slate-200 dark:bg-[#0A0A0A] animate-pulse rounded" />
                        ) : (
                            <div className="text-center">
                                <div className={`text-4xl font-black font-mono tracking-tighter ${getSentimentColor(data?.sentiment_score || 0)}`}>
                                    {data?.sentiment_score && data.sentiment_score > 0 ? '+' : ''}{data?.sentiment_score.toFixed(2)}
                                </div>
                                <div className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-1 tracking-wide">
                                    {data?.sentiment_score && data.sentiment_score > 0.1 ? 'ACCUMULATION' : data?.sentiment_score && data.sentiment_score < -0.1 ? 'DISTRIBUTION' : 'NEUTRAL'}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Mini Chart */}
                    <div className="h-20 w-full rounded-xl border border-slate-200 dark:border-[#141414]/60 bg-slate-50 dark:bg-slate-950/50 p-3 relative overflow-hidden">
                        <div className="flex items-center justify-between text-[9px] text-slate-500 uppercase font-semibold mb-1">
                            <span>Flow Delta</span>
                            <Activity className="h-3 w-3 opacity-50" />
                        </div>
                        <ResponsiveContainer width="100%" height="80%" debounce={150}>
                            <BarChart data={mockChartData}>
                                <Tooltip
                                    cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)' }}
                                    contentStyle={{
                                        backgroundColor: isDark ? '#0A0A0A' : '#FFFFFF',
                                        borderColor: isDark ? '#334155' : '#E2E8F0',
                                        color: isDark ? '#F8FAFC' : '#0F172A',
                                        fontSize: '12px',
                                        borderRadius: '8px'
                                    }}
                                />
                                <Bar dataKey="flow" radius={[2, 2, 0, 0]}>
                                    {mockChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.flow > 0 ? '#10b981' : '#f43f5e'}
                                            fillOpacity={0.8}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Trade Feed Column */}
                <div className="flex flex-col h-full overflow-hidden">
                    <div className="flex items-center justify-between mb-3 border-b border-dashed border-slate-200 dark:border-[#141414] pb-2">
                        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase flex items-center gap-2">
                            <Layers className="h-3 w-3" /> Recent Blocks
                        </h4>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#0A0A0A] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#1F1F1F]">
                            &gt; $100k
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 scrollbar-track-transparent">
                        {loading ? (
                            [1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-slate-100 dark:bg-[#0A0A0A]/30 rounded animate-pulse" />)
                        ) : (
                            data?.block_trades.map((trade, idx) => (
                                <div key={idx} className="group/item relative flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-[#141414]/60 bg-slate-50/70 dark:bg-[#050505]/40 hover:bg-slate-100 dark:hover:bg-[#0A0A0A] hover:border-slate-300 dark:hover:border-[#1F1F1F] hover:shadow-sm dark:hover:shadow-lg dark:hover:shadow-black/20 transition-all duration-200">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded bg-opacity-10 ${trade.side === 'BUY' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                            {trade.side === 'BUY' ? (
                                                <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <TrendingDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                                {trade.volume.toFixed(2)} <span className="text-slate-500 text-[10px] font-normal">{symbol}</span>
                                            </div>
                                            <div className="text-[9px] text-slate-500 uppercase tracking-wide">
                                                {trade.source}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-right">
                                        <div className={`text-xs font-mono font-medium ${trade.side === 'BUY' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                            ${(trade.value_usd / 1000).toFixed(0)}k
                                        </div>
                                        <div className="text-[9px] text-slate-500 dark:text-slate-600">
                                            {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                        {data?.block_trades.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-600 text-xs gap-2 opacity-70 dark:opacity-60">
                                <Activity className="h-8 w-8 text-slate-300 dark:text-slate-800" />
                                No large blocks detected
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
});
