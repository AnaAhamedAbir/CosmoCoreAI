import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    Cell,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    XAxis,
    YAxis,
} from 'recharts';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';
import { Download, Database, Play, Rocket, RotateCcw, Sliders, Sparkles } from 'lucide-react';
import { mlModelsService } from '@/services/mlModelsService';
import { trainingStudioToolsService } from '@/services/trainingStudioToolsService';
import { useTheme } from '@/context/ThemeContext';
import { OptunaTrialsChart } from '@/components/ml/OptunaTrialsChart';
import { PaperReplayPreview } from '@/components/ml/PaperReplayPreview';

export type InspectorTab = 'config' | 'explain' | 'replay' | 'optuna';

const STAT_COLOR_STYLES: Record<string, { borderHover: string; glow: string; icon: string }> = {
    cyan: {
        borderHover: 'hover:border-cyan-500/35',
        glow: 'bg-cyan-500/10 group-hover:bg-cyan-500/20',
        icon: 'text-cyan-600 dark:text-cyan-400',
    },
    blue: {
        borderHover: 'hover:border-blue-500/35',
        glow: 'bg-blue-500/10 group-hover:bg-blue-500/20',
        icon: 'text-blue-600 dark:text-blue-400',
    },
    purple: {
        borderHover: 'hover:border-purple-500/35',
        glow: 'bg-purple-500/10 group-hover:bg-purple-500/20',
        icon: 'text-purple-600 dark:text-purple-400',
    },
    amber: {
        borderHover: 'hover:border-amber-500/35',
        glow: 'bg-amber-500/10 group-hover:bg-amber-500/20',
        icon: 'text-amber-600 dark:text-amber-400',
    },
};

function isRLArchitecture(algorithm?: string): boolean {
    const upper = (algorithm || '').toUpperCase();
    return upper.includes('-RL') || ['QR-DQN', 'CQL', 'GAIL'].includes(upper);
}

export const ExplainabilityView: React.FC<{ data: any; algorithm?: string }> = ({ data, algorithm }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const tooltipStyle = {
        backgroundColor: isDark ? '#111827' : '#ffffff',
        borderColor: isDark ? '#334155' : '#e2e8f0',
        borderRadius: '8px',
        color: isDark ? '#fff' : '#0f172a',
    };

    if (!data || Object.keys(data).length === 0) {
        return (
            <div className="text-center py-12 text-slate-500 dark:text-gray-400 font-semibold">
                No explainability telemetry recorded for this version. Run training with feature tracking or check OOS Paper Replay.
            </div>
        );
    }

    const isRL = isRLArchitecture(algorithm) || data.total_return_pct !== undefined;
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B'];

    const hasFeatureImportance = Array.isArray(data.featureImportance) && data.featureImportance.length > 0;
    const hasPdp = Array.isArray(data.pdpData) && data.pdpData.length > 0;
    const hasTimeSeries = Array.isArray(data.timeSeriesData) && data.timeSeriesData.length > 0;
    const hasConfusion =
        Array.isArray(data.confusionMatrix?.classes) &&
        Array.isArray(data.confusionMatrix?.matrix) &&
        data.confusionMatrix.matrix.length > 0;
    const hasShap = Array.isArray(data.shapSummary) && data.shapSummary.length > 0;
    const hasDecisionTree =
        Array.isArray(data.decisionTree?.nodes) &&
        data.decisionTree.nodes.length > 0 &&
        Array.isArray(data.decisionTree?.edges);
    const hasCvScores = Array.isArray(data.cv_scores?.cv_scores) && data.cv_scores.cv_scores.length > 0;
    const hasBacktest = Boolean(data.backtest_result);
    const hasRawMeta = Boolean(data._raw_metadata) && typeof data._raw_metadata === 'object';

    const shapFeatures: string[] = hasShap
        ? Array.from(new Set<string>(data.shapSummary.map((s: any) => String(s.feature)).filter(Boolean))).slice(0, 8)
        : [];

    return (
        <div className="space-y-6 animate-fade-in pb-6">
            {/* RL Performance Summary */}
            {isRL && (data.total_return_pct !== undefined || data.win_rate !== undefined) && (
                <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-500/20 rounded-xl p-6 shadow-inner">
                    <h3 className="text-sm font-bold text-purple-600 dark:text-purple-400 mb-5 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        RL Policy Performance Metrics ({algorithm || 'RL Agent'})
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-4 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1.5">Total Return</p>
                            <p className={`text-xl font-mono font-bold ${(data.total_return_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {typeof data.total_return_pct === 'number' ? `${data.total_return_pct.toFixed(2)}%` : '--'}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-4 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1.5">Win Rate</p>
                            <p className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {typeof data.win_rate === 'number' ? `${data.win_rate.toFixed(2)}%` : '--'}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-4 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1.5">Sharpe Ratio</p>
                            <p className="text-xl font-mono font-bold text-blue-600 dark:text-blue-400">
                                {typeof data.sharpe_ratio === 'number' ? data.sharpe_ratio.toFixed(2) : '--'}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-4 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1.5">Trades Executed</p>
                            <p className="text-xl font-mono font-bold text-purple-600 dark:text-purple-400">
                                {data.trades_count ?? '--'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* 1. Feature Importance */}
            {hasFeatureImportance && (
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-4">Feature Importance</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.featureImportance} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: isDark ? '#9CA3AF' : '#475569', fontSize: 12 }} width={130} />
                                <RechartsTooltip cursor={{ fill: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.05)' }} contentStyle={tooltipStyle} />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                    {data.featureImportance.map((_: any, index: number) => (
                                        <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* 2 & 3: PDP + Actual vs Predicted */}
            {(hasPdp || hasTimeSeries) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {hasPdp && (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-4">Partial Dependence Plot</h3>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data.pdpData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorY" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#14B8A6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#14B8A6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="x" tick={{ fill: '#6B7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                                        <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                                        <RechartsTooltip contentStyle={tooltipStyle} />
                                        <Area type="monotone" dataKey="y" stroke="#14B8A6" fillOpacity={1} fill="url(#colorY)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {hasTimeSeries && (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-4">Actual vs Predicted (Test Set)</h3>
                            <div className="h-48">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={data.timeSeriesData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                        <XAxis dataKey="time" hide />
                                        <YAxis domain={['auto', 'auto']} tick={{ fill: '#6B7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                                        <RechartsTooltip contentStyle={tooltipStyle} />
                                        <Line type="monotone" dataKey="actual" stroke="#6B7280" strokeWidth={2} dot={false} name="Actual" />
                                        <Line type="monotone" dataKey="predicted" stroke="#6366F1" strokeWidth={2} strokeDasharray="3 3" dot={false} name="Predicted" />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 4 & 5: Confusion Matrix + Dynamic SHAP Summary */}
            {(hasConfusion || hasShap) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {hasConfusion && (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 flex flex-col">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-4">Confusion Matrix</h3>
                            <div className="flex-1 flex items-center justify-center">
                                <div className="grid gap-1 w-full max-w-[260px]" style={{ gridTemplateColumns: `repeat(${data.confusionMatrix.classes.length + 1}, minmax(0, 1fr))` }}>
                                    <div></div>
                                    {data.confusionMatrix.classes.map((c: string) => (
                                        <div key={`col-${c}`} className="text-center text-[10px] text-slate-500 dark:text-gray-400 font-bold">{c}</div>
                                    ))}
                                    {data.confusionMatrix.matrix.map((row: number[], i: number) => {
                                        const rowMax = Math.max(1, ...row);
                                        return (
                                            <React.Fragment key={`row-${i}`}>
                                                <div className="text-right text-[10px] text-slate-500 dark:text-gray-400 font-bold pr-2 flex items-center justify-end">
                                                    {data.confusionMatrix.classes[i]}
                                                </div>
                                                {row.map((val: number, j: number) => {
                                                    const intensity = Math.min(1, val / Math.max(100, rowMax));
                                                    return (
                                                        <div
                                                            key={`cell-${i}-${j}`}
                                                            className="aspect-square flex items-center justify-center rounded text-sm font-mono font-bold"
                                                            style={{
                                                                backgroundColor: i === j ? `rgba(16, 185, 129, ${0.12 + intensity * 0.88})` : `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`,
                                                                color: intensity > 0.45 ? 'white' : isDark ? '#9CA3AF' : '#334155',
                                                            }}
                                                        >
                                                            {val}
                                                        </div>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {hasShap && (
                        <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-4">SHAP Summary (Impact)</h3>
                            <div className="space-y-4">
                                {shapFeatures.map((feature) => {
                                    const dots = data.shapSummary.filter((s: any) => String(s.feature) === feature);
                                    return (
                                        <div key={feature} className="flex items-center gap-2">
                                            <div className="w-32 text-[10px] text-slate-600 dark:text-gray-400 truncate text-right font-bold" title={feature}>
                                                {feature}
                                            </div>
                                            <div className="flex-1 relative h-6 bg-slate-200 dark:bg-white/5 rounded">
                                                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-400 dark:bg-gray-600"></div>
                                                {dots.map((d: any, i: number) => {
                                                    const left = 50 + (Number(d.impact) || 0) * 500;
                                                    const color = d.value === 'High' ? '#EF4444' : '#3B82F6';
                                                    return (
                                                        <div
                                                            key={i}
                                                            className="absolute top-1.5 w-3 h-3 rounded-full opacity-80"
                                                            style={{ left: `${Math.min(Math.max(left, 2), 94)}%`, backgroundColor: color }}
                                                            title={`${feature}: ${d.impact} (${d.value})`}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="flex justify-between text-[10px] text-slate-500 dark:text-gray-500 pt-2 border-t border-slate-200 dark:border-gray-800">
                                    <span>Negative</span>
                                    <span>Value: <span className="text-blue-500">Low</span> / <span className="text-red-500">High</span></span>
                                    <span>Positive</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 6. Decision Tree */}
            {hasDecisionTree && (
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5 h-80 flex flex-col">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-2">Decision Tree Logic</h3>
                    <div className="flex-1 border border-slate-200 dark:border-white/5 rounded-lg overflow-hidden bg-white dark:bg-[#050505]">
                        <ReactFlow
                            nodes={data.decisionTree.nodes.map((n: any, idx: number) => ({
                                id: String(n.id),
                                position: n.position || {
                                    x: n.id === '1' ? 250 : n.id === '2' ? 100 : n.id === '3' ? 400 : n.id === '4' ? 0 : n.id === '5' ? 250 : 120 * idx,
                                    y: n.id === '1' ? 20 : ['2', '3'].includes(n.id) ? 120 : 220,
                                },
                                data: { label: n.label },
                                style: {
                                    background: n.type === 'leaf' ? (n.color === 'green' ? '#10B981' : n.color === 'red' ? '#EF4444' : '#6B7280') : (isDark ? '#1E1B4B' : '#EEF2FF'),
                                    color: n.type === 'leaf' ? '#fff' : (isDark ? '#fff' : '#1E1B4B'),
                                    border: isDark ? '1px solid #4338CA' : '1px solid #818CF8',
                                    borderRadius: '8px',
                                    padding: '8px 10px',
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    width: 140,
                                    textAlign: 'center',
                                },
                            }))}
                            edges={data.decisionTree.edges.map((e: any) => ({
                                id: `e${e.source}-${e.target}`,
                                source: String(e.source),
                                target: String(e.target),
                                label: e.label,
                                labelStyle: { fill: isDark ? '#9CA3AF' : '#475569', fontSize: 10, fontWeight: 'bold' },
                                style: { stroke: isDark ? '#4B5563' : '#94A3B8' },
                                animated: true,
                            }))}
                            fitView
                            attributionPosition="bottom-right"
                        >
                            <Background color={isDark ? '#333' : '#cbd5e1'} gap={16} />
                            <Controls className="bg-white dark:bg-white/10 border-slate-200 dark:border-white/20" showInteractive={false} />
                        </ReactFlow>
                    </div>
                </div>
            )}

            {/* 7. Post-Training Backtest Card */}
            {hasBacktest && (
                <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-500/20 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-4 flex items-center gap-2">
                        Post-Training Backtest Performance
                        <span className="ml-auto text-[10px] text-slate-500 dark:text-gray-400 font-normal">
                            Initial: ${data.backtest_result.initial_balance?.toLocaleString() ?? '--'}
                        </span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">Return</p>
                            <p className={`text-lg font-mono font-bold ${(data.backtest_result.profit_pct ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {(data.backtest_result.profit_pct ?? 0) >= 0 ? '+' : ''}
                                {data.backtest_result.profit_pct?.toFixed(2) ?? '--'}%
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">Win Rate</p>
                            <p className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400">
                                {data.backtest_result.win_rate?.toFixed(1) ?? '--'}%
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">Max DD</p>
                            <p className="text-lg font-mono font-bold text-rose-600 dark:text-rose-400">
                                -{data.backtest_result.max_drawdown?.toFixed(2) ?? '--'}%
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">Kelly %</p>
                            <p className="text-lg font-mono font-bold text-teal-600 dark:text-teal-400">
                                {data.backtest_result.kelly_pct !== undefined ? `${data.backtest_result.kelly_pct.toFixed(1)}%` : 'N/A'}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">MC Ruin Risk</p>
                            <p className={`text-lg font-mono font-bold ${(data.backtest_result.risk_of_ruin ?? 0) > 5 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {data.backtest_result.risk_of_ruin !== undefined ? `${data.backtest_result.risk_of_ruin.toFixed(1)}%` : 'N/A'}
                            </p>
                        </div>
                        <div className="bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 rounded-lg p-3 text-center">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase mb-1">Trades</p>
                            <p className="text-lg font-mono font-bold text-purple-600 dark:text-purple-400">
                                {data.backtest_result.total_trades ?? '--'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* 8. Walk-Forward CV Scores */}
            {hasCvScores && (
                <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-500/20 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-4">Walk-Forward CV Results</h3>
                    <div className="flex gap-2 items-end">
                        {data.cv_scores.cv_scores.map((score: number, i: number) => (
                            <div key={i} className="flex-1 text-center">
                                <div className="bg-blue-500/25 rounded-t mx-auto" style={{ height: `${Math.max(6, Math.min(100, score * 80))}px` }}></div>
                                <p className="text-[10px] text-blue-600 dark:text-blue-400 font-mono mt-1">{(score * 100).toFixed(1)}%</p>
                                <p className="text-[9px] text-slate-500 dark:text-gray-500">F{i + 1}</p>
                            </div>
                        ))}
                        <div className="flex-1 text-center border-l border-slate-200 dark:border-white/10 pl-2">
                            <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase font-bold">Avg</p>
                            <p className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">{((data.cv_scores.cv_avg || 0) * 100).toFixed(1)}%</p>
                            <p className="text-[9px] text-slate-500 dark:text-gray-500">&plusmn;{((data.cv_scores.cv_std || 0) * 100).toFixed(1)}%</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 9. Raw Metadata Fallback */}
            {!hasFeatureImportance && !hasPdp && !hasTimeSeries && !hasConfusion && !hasShap && !hasDecisionTree && !hasBacktest && !hasCvScores && !isRL && hasRawMeta && (
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-gray-300 mb-3">Raw Model Telemetry</h3>
                    <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto bg-white dark:bg-black/40 p-4 rounded-lg border border-slate-200 dark:border-white/5">
                        {JSON.stringify(data._raw_metadata, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};

export interface ModelInspectorModalProps {
    modelId: string;
    modelName: string;
    initialTab?: InspectorTab;
    onClose: () => void;
    onDeployModel?: (modelId: string, symbol?: string, timeframe?: string) => void;
    onRetrainStudio?: (modelId: string) => void;
    onRetrainSuccess?: (jobId: string) => void;
}

export const ModelInspectorModal: React.FC<ModelInspectorModalProps> = ({
    modelId,
    modelName,
    initialTab = 'config',
    onClose,
    onDeployModel,
    onRetrainStudio,
    onRetrainSuccess,
}) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [config, setConfig] = useState<any>(null);
    const [explainData, setExplainData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isDownloadingData, setIsDownloadingData] = useState(false);
    const [isQuickRetraining, setIsQuickRetraining] = useState(false);

    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab, modelId]);

    useEffect(() => {
        setLoading(true);
        Promise.all([
            mlModelsService.getModelConfig(modelId),
            mlModelsService.getModelExplainability(modelId).catch(() => ({})),
        ])
            .then(([configRes, explainRes]) => {
                setConfig(configRes);
                setExplainData(explainRes);
                setLoading(false);
            })
            .catch((err) => {
                console.error('Failed to load details', err);
                setLoading(false);
            });
    }, [modelId]);

    const handleDownloadBundle = async () => {
        setIsDownloading(true);
        try {
            await mlModelsService.downloadModel(modelId, modelName);
            toast.success('Model bundle downloaded!');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Download failed');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadDataset = async () => {
        setIsDownloadingData(true);
        try {
            await mlModelsService.downloadDataset(modelId, modelName);
            toast.success('Dataset snapshot downloaded!');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Dataset snapshot not available');
        } finally {
            setIsDownloadingData(false);
        }
    };

    const handleQuickRetrain = async () => {
        setIsQuickRetraining(true);
        try {
            const res = await trainingStudioToolsService.triggerOneClickRetrain(modelId);
            toast.success(`1-Click Retrain queued (${res.symbol} ${res.timeframe})`);
            onRetrainSuccess?.(res.job_id);
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || '1-Click Retrain not supported for this model; opening Studio instead.');
            if (onRetrainStudio) onRetrainStudio(modelId);
        } finally {
            setIsQuickRetraining(false);
        }
    };

    const TABS: { key: InspectorTab; label: string; icon: React.ReactNode }[] = [
        { key: 'config', label: 'Config & Features', icon: <Sliders className="w-3.5 h-3.5" /> },
        { key: 'explain', label: 'Explainability', icon: <Sparkles className="w-3.5 h-3.5" /> },
        { key: 'replay', label: 'OOS Paper Replay', icon: <Play className="w-3.5 h-3.5" /> },
        { key: 'optuna', label: 'Optuna Trials', icon: <Sliders className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-backdrop-fade-in" onClick={onClose}>
            <div className="absolute inset-0 bg-slate-900/55 dark:bg-black/70 backdrop-blur-md"></div>

            <div
                className="w-full max-w-5xl max-h-[90vh] rounded-3xl flex flex-col overflow-hidden relative animate-modal-content-slide-down z-10"
                style={{
                    background: isDark
                        ? 'linear-gradient(145deg, rgba(15,20,30,0.97) 0%, rgba(5,10,15,0.99) 100%)'
                        : 'linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(248,250,252,0.99) 100%)',
                    boxShadow: isDark
                        ? '0 0 0 1px rgba(255,255,255,0.08), 0 30px 60px -10px rgba(0,0,0,0.85)'
                        : '0 0 0 1px rgba(15,23,42,0.08), 0 25px 50px -10px rgba(15,23,42,0.2)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 shrink-0"></div>

                {/* Header */}
                <div className="p-5 md:p-6 flex flex-wrap justify-between items-center gap-4 border-b border-slate-200 dark:border-white/10 shrink-0">
                    <div>
                        <h2 className="text-xl md:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                            {modelName}
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-gray-400 font-mono mt-0.5">
                            Model ID: {modelId} {config?.symbol && config.symbol !== 'N/A' ? `• ${config.symbol} (${config.timeframe})` : ''}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {onDeployModel && (
                            <button
                                type="button"
                                onClick={() => onDeployModel(modelId, config?.symbol !== 'N/A' ? config?.symbol : undefined, config?.timeframe !== 'N/A' ? config?.timeframe : undefined)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md hover:opacity-95"
                            >
                                <Rocket className="w-3.5 h-3.5" />
                                Deploy Bot
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handleQuickRetrain}
                            disabled={isQuickRetraining}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-purple-500/35 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 disabled:opacity-50"
                        >
                            <RotateCcw className={`w-3.5 h-3.5 ${isQuickRetraining ? 'animate-spin' : ''}`} />
                            {isQuickRetraining ? 'Queuing...' : '1-Click Retrain'}
                        </button>

                        <button
                            type="button"
                            onClick={handleDownloadDataset}
                            disabled={isDownloadingData}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-slate-200 hover:border-cyan-500/40 disabled:opacity-50"
                        >
                            <Database className="w-3.5 h-3.5" />
                            {isDownloadingData ? 'Downloading...' : 'Dataset'}
                        </button>

                        <button
                            type="button"
                            onClick={handleDownloadBundle}
                            disabled={isDownloading}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                            <Download className="w-3.5 h-3.5" />
                            {isDownloading ? 'Zipping...' : 'Bundle (.zip)'}
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 flex items-center justify-center text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-all"
                        >
                            &times;
                        </button>
                    </div>
                </div>

                {/* 4-Tab Bar */}
                <div className="px-6 pt-4 shrink-0">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-slate-100 dark:bg-black/40 rounded-2xl border border-slate-200 dark:border-white/10">
                        {TABS.map((t) => {
                            const active = activeTab === t.key;
                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => setActiveTab(t.key)}
                                    className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                        active
                                            ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-white'
                                    }`}
                                >
                                    {t.icon}
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Scrollable Body */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                    {activeTab === 'replay' ? (
                        <PaperReplayPreview modelId={modelId} />
                    ) : activeTab === 'optuna' ? (
                        <OptunaTrialsChart modelId={modelId} />
                    ) : loading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <div className="w-10 h-10 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
                            <p className="text-slate-500 dark:text-gray-400 font-mono text-xs">Loading Tensor Artifacts...</p>
                        </div>
                    ) : activeTab === 'config' ? (
                        config ? (
                            <div className="space-y-6 animate-fade-in">
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    {[
                                        { label: 'Target Asset', value: config.symbol || 'N/A', color: 'cyan' },
                                        { label: 'Timeframe', value: config.timeframe || 'N/A', color: 'blue' },
                                        {
                                            label: 'Algorithm',
                                            value: config.config?.is_ensemble
                                                ? `Ensemble (${config.config?.ensemble_method || 'Voting'})`
                                                : config.algorithm || 'N/A',
                                            color: 'purple',
                                        },
                                        { label: 'Prediction Target', value: config.config?.prediction_target || 'N/A', color: 'amber' },
                                    ].map((stat, i) => {
                                        const st = STAT_COLOR_STYLES[stat.color];
                                        return (
                                            <div key={i} className={`group relative bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-2xl p-4 ${st.borderHover} transition-all overflow-hidden`}>
                                                <div className={`absolute -right-4 -top-4 w-20 h-20 rounded-full blur-2xl transition-all ${st.glow}`}></div>
                                                <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">{stat.label}</p>
                                                <p className={`text-base font-mono font-bold truncate ${st.icon}`}>{stat.value}</p>
                                            </div>
                                        );
                                    })}

                                    {/* Epochs / Steps / Estimators */}
                                    {(() => {
                                        const algo = (config.algorithm || '').toLowerCase();
                                        const isRL = isRLArchitecture(config.algorithm);
                                        const isTree = algo.includes('forest') || algo.includes('xgboost') || algo.includes('lightgbm') || algo.includes('catboost') || algo.includes('tabnet');
                                        const epochLabel = isRL ? 'Train Steps' : isTree ? 'Estimators' : 'Epochs';
                                        const epochVal = config.config?.epochs;
                                        return (
                                            <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-2xl p-4">
                                                <p className="text-[10px] text-slate-500 dark:text-gray-400 font-bold uppercase tracking-wider mb-1">{epochLabel}</p>
                                                <p className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                    {epochVal != null ? Number(epochVal).toLocaleString() : 'N/A'}
                                                </p>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {(config.config?.split_method || config.config?.eval_metric || config.config?.imbalance_strategy || config.config?.forecast_horizon || config.config?.lookback_window) && (
                                    <div className="bg-slate-50 dark:bg-black/20 border border-rose-500/20 rounded-2xl p-5">
                                        <h3 className="text-sm font-bold text-rose-600 dark:text-rose-400 mb-3">Training Split & Guardrails</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            {config.config?.split_method && (
                                                <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-3">
                                                    <span className="text-[9px] font-bold uppercase text-slate-500">Split Method</span>
                                                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-white capitalize">{config.config.split_method}</p>
                                                </div>
                                            )}
                                            {config.config?.imbalance_strategy && (
                                                <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-3">
                                                    <span className="text-[9px] font-bold uppercase text-slate-500">Imbalance</span>
                                                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-white capitalize">{String(config.config.imbalance_strategy).replace(/_/g, ' ')}</p>
                                                </div>
                                            )}
                                            {config.config?.eval_metric && (
                                                <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-3">
                                                    <span className="text-[9px] font-bold uppercase text-slate-500">Eval Metric</span>
                                                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-white uppercase">{String(config.config.eval_metric).replace(/_/g, ' ')}</p>
                                                </div>
                                            )}
                                            {config.config?.lookback_window && (
                                                <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.06] rounded-xl p-3">
                                                    <span className="text-[9px] font-bold uppercase text-slate-500">Lookback</span>
                                                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-white">{config.config.lookback_window} Bars</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Feature Badges */}
                                {[
                                    { key: 'indicators', title: 'Technical Indicators (OHLCV)', pillCls: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-800 dark:text-cyan-200' },
                                    { key: 'trade_features', title: 'Tick & Volume Flow', pillCls: 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-200' },
                                    { key: 'l2_features', title: 'Orderbook Imbalance (L2)', pillCls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-200' },
                                    { key: 'plp_features', title: 'Predatory Liquidity Pipeline (PLP)', pillCls: 'bg-purple-500/10 border-purple-500/20 text-purple-800 dark:text-purple-200' },
                                ].map((group) => {
                                    const items = config.config?.[group.key];
                                    if (!Array.isArray(items) || items.length === 0) return null;
                                    return (
                                        <div key={group.key} className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-2xl p-5">
                                            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-3">{group.title} ({items.length})</h3>
                                            <div className="flex flex-wrap gap-2">
                                                {items.map((feat: string) => (
                                                    <span key={feat} className={`px-3 py-1 border rounded-lg text-xs font-mono font-bold ${group.pillCls}`}>
                                                        {feat}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}

                                {onRetrainStudio && (
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onClose();
                                                onRetrainStudio(modelId);
                                            }}
                                            className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline"
                                        >
                                            Open Full Hyperparameters in Training Studio &rarr;
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center py-14 text-slate-500 dark:text-gray-400">
                                Configuration details missing for this model.
                            </div>
                        )
                    ) : (
                        <ExplainabilityView data={explainData} algorithm={config?.algorithm} />
                    )}
                </div>
            </div>
        </div>
    );
};

export default ModelInspectorModal;
