import React from 'react';
import Card from '@/components/common/Card';
import Button from '@/components/common/Button';
import { Loader2, RefreshCw, Maximize2 } from 'lucide-react';
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { SentimentHeatmapItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';

/** Pure SVG treemap tile avoiding HTML <foreignObject> so GPU scrolling remains 60-120fps. */
const ModernHeatmapContent = (props: any) => {
    const { x, y, width, height, name, sentimentScore, marketCap, depth, isDark } = props;
    const score = typeof sentimentScore === 'number' ? sentimentScore : 0;

    if (depth === 0 || !name || !width || !height || width < 4 || height < 4) return null;

    const tileW = Math.max(0, width - 4);
    const tileH = Math.max(0, height - 4);
    if (tileW <= 0 || tileH <= 0) return null;

    let fill = isDark ? '#1e293b' : '#e2e8f0';
    let stroke = isDark ? 'rgba(148,163,184,0.28)' : '#cbd5e1';
    let titleColor = isDark ? '#e2e8f0' : '#1e293b';
    let scoreColor = isDark ? '#94a3b8' : '#475569';

    if (score > 0.5) {
        fill = isDark ? 'rgba(16,185,129,0.28)' : '#d1fae5';
        stroke = isDark ? 'rgba(16,185,129,0.55)' : '#34d399';
        titleColor = isDark ? '#d1fae5' : '#064e3b';
        scoreColor = isDark ? '#34d399' : '#047857';
    } else if (score > 0.1) {
        fill = isDark ? 'rgba(20,184,166,0.20)' : '#ccfbf1';
        stroke = isDark ? 'rgba(20,184,166,0.42)' : '#2dd4bf';
        titleColor = isDark ? '#f0fdfa' : '#134e4a';
        scoreColor = isDark ? '#2dd4bf' : '#0f766e';
    } else if (score < -0.5) {
        fill = isDark ? 'rgba(244,63,94,0.28)' : '#ffe4e6';
        stroke = isDark ? 'rgba(244,63,94,0.55)' : '#fb7185';
        titleColor = isDark ? '#ffe4e6' : '#881337';
        scoreColor = isDark ? '#fb7185' : '#be123c';
    } else if (score < -0.1) {
        fill = isDark ? 'rgba(249,115,22,0.20)' : '#ffedd5';
        stroke = isDark ? 'rgba(249,115,22,0.42)' : '#fb923c';
        titleColor = isDark ? '#fff7ed' : '#7c2d12';
        scoreColor = isDark ? '#fb923c' : '#c2410c';
    }

    const showDetail = width > 60 && height > 50;
    const showMini = width > 30 && height > 30;
    const cx = x + 2 + tileW / 2;
    const cy = y + 2 + tileH / 2;

    return (
        <g>
            <rect
                x={x + 2}
                y={y + 2}
                width={tileW}
                height={tileH}
                rx={10}
                ry={10}
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
            />
            {showMini && (
                <text
                    x={cx}
                    y={showDetail ? cy - 8 : cy + 4}
                    textAnchor="middle"
                    fill={titleColor}
                    fontSize={width < 50 ? 10 : 13}
                    fontWeight={800}
                >
                    {name}
                </text>
            )}
            {showDetail && (
                <>
                    <text
                        x={cx}
                        y={cy + 7}
                        textAnchor="middle"
                        fill={scoreColor}
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="monospace"
                    >
                        {score > 0 ? '+' : ''}{score.toFixed(2)}
                    </text>
                    {typeof marketCap === 'number' && marketCap > 0 && (
                        <text
                            x={cx}
                            y={cy + 20}
                            textAnchor="middle"
                            fill={isDark ? 'rgba(255,255,255,0.55)' : '#475569'}
                            fontSize={8}
                            fontWeight={600}
                        >
                            {(marketCap / 1_000_000_000).toFixed(0)}B
                        </text>
                    )}
                </>
            )}
        </g>
    );
};

interface SentimentHeatmapProps {
    heatmapData: SentimentHeatmapItem[];
    isHeatmapLoading: boolean;
    onSync: () => void;
}

export const SentimentHeatmap: React.FC<SentimentHeatmapProps> = React.memo(({ heatmapData, isHeatmapLoading, onSync }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <Card className="min-h-[450px] flex flex-col relative overflow-hidden border-slate-200 dark:border-white/10 bg-white dark:bg-[#070b14]">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white shadow-lg shadow-indigo-500/20">
                        <Maximize2 size={18} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                            Quantum Sentiment Map
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                            Visualizing Market Emotions & Capital Flow
                        </p>
                    </div>
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={onSync}
                    disabled={isHeatmapLoading}
                    className="bg-brand-primary"
                >
                    {isHeatmapLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
            </div>

            <div className="flex-grow w-full h-[380px] min-h-[380px] bg-slate-100 dark:bg-[#0f1623] rounded-2xl p-1 overflow-hidden border border-slate-200 dark:border-[#141414]/60 shadow-inner relative">
                {isHeatmapLoading && heatmapData.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-white/95 dark:bg-[#0f1623]/95">
                        <Loader2 className="animate-spin w-8 h-8 text-brand-primary" />
                        <p className="text-xs font-mono text-brand-primary mt-4">INITIALIZING NEURAL GRID...</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%" debounce={220}>
                        <Treemap
                            data={heatmapData}
                            dataKey="marketCap"
                            aspectRatio={4 / 3}
                            stroke="transparent"
                            fill="#8884d8"
                            content={<ModernHeatmapContent isDark={isDark} />}
                            isAnimationActive={false}
                            animationDuration={0}
                        >
                            <Tooltip
                                cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 2 }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-xl shadow-2xl border border-slate-200 dark:border-white/10 min-w-[160px]">
                                                <h4 className="text-sm font-black text-slate-800 dark:text-white">{data.name}</h4>
                                                <p className="text-xs font-mono text-cyan-500">Score: {data.sentimentScore}</p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                        </Treemap>
                    </ResponsiveContainer>
                )}
            </div>
        </Card>
    );
});
