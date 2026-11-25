import React, { useState, useMemo } from 'react';
import { BacktestResult } from '@/types';

interface ParameterHeatmapProps {
    results: BacktestResult[];
    onSelectConfig?: (params: Record<string, any>) => void;
}

const ParameterHeatmap: React.FC<ParameterHeatmapProps> = ({ results, onSelectConfig }) => {
    const firstValidResult = results?.find((r) => r.params && Object.keys(r.params).length > 0);
    const availableParams = firstValidResult ? Object.keys(firstValidResult.params || {}) : [];

    const metrics = [
        { label: 'Net Profit (%)', key: 'profitPercent' },
        { label: 'Sharpe Ratio', key: 'sharpeRatio' },
        { label: 'Max Drawdown (%)', key: 'maxDrawdown' },
        { label: 'Win Rate (%)', key: 'winRate' },
    ];

    const [xAxisParam, setXAxisParam] = useState<string>(availableParams[0] || '');
    const [yAxisParam, setYAxisParam] = useState<string>(availableParams[1] || availableParams[0] || '');
    const [selectedMetric, setSelectedMetric] = useState<string>('profitPercent');

    const effectiveX = availableParams.includes(xAxisParam) ? xAxisParam : availableParams[0] || '';
    const effectiveY = availableParams.includes(yAxisParam) ? yAxisParam : (availableParams[1] || availableParams[0] || '');

    const { matrix, xValues, yValues, minValue, maxValue } = useMemo(() => {
        const xSet = new Set<number>();
        const ySet = new Set<number>();
        const dataMap = new Map<string, { val: number; res: BacktestResult }>();

        let min = Infinity;
        let max = -Infinity;

        (results || []).forEach((res) => {
            if (!res.params || !effectiveX || !effectiveY) return;
            const xVal = Number(res.params[effectiveX]);
            const yVal = Number(res.params[effectiveY]);
            if (isNaN(xVal) || isNaN(yVal)) return;

            xSet.add(xVal);
            ySet.add(yVal);

            const rawVal = res[selectedMetric as keyof BacktestResult] as number;
            const cleanVal = rawVal === undefined || rawVal === null || isNaN(rawVal) ? 0 : rawVal;

            if (cleanVal < min) min = cleanVal;
            if (cleanVal > max) max = cleanVal;

            dataMap.set(`${xVal}-${yVal}`, { val: cleanVal, res });
        });

        return {
            matrix: dataMap,
            xValues: Array.from(xSet).sort((a, b) => a - b),
            yValues: Array.from(ySet).sort((a, b) => b - a),
            minValue: min,
            maxValue: max,
        };
    }, [results, effectiveX, effectiveY, selectedMetric]);

    if (!results || results.length === 0) return null;

    if (availableParams.length < 2) {
        return (
            <div className="flex flex-col items-center justify-center h-52 bg-slate-50 dark:bg-[#0A0A0A] rounded-xl border border-dashed border-slate-300 dark:border-[#1F1F1F]">
                <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">
                    2D Parameter Heatmap requires at least 2 optimized parameters.
                </p>
                <p className="text-xs text-slate-400 mt-1">
                    Select 2+ parameters in Optimization mode to inspect robustness plateaus.
                </p>
            </div>
        );
    }

    const getCellColor = (value: number) => {
        const isDrawdown = selectedMetric === 'maxDrawdown';
        if (isDrawdown) {
            const intensity = Math.min(0.2 + (Math.abs(value) / Math.max(Math.abs(maxValue), 1)) * 0.75, 0.95);
            return `rgba(244, 63, 94, ${intensity})`;
        }
        if (value > 0) {
            const intensity = Math.min(0.2 + (value / Math.max(maxValue, 1)) * 0.8, 0.95);
            return `rgba(16, 185, 129, ${intensity})`;
        }
        const intensity = Math.min(0.2 + (Math.abs(value) / Math.max(Math.abs(minValue), 1)) * 0.8, 0.95);
        return `rgba(244, 63, 94, ${intensity})`;
    };

    return (
        <div className="bg-white dark:bg-[#0A0A0A] p-5 rounded-xl border border-slate-200 dark:border-[#1F1F1F]">
            <div className="flex flex-wrap gap-4 mb-5 items-end border-b border-slate-200 dark:border-[#1F1F1F] pb-4">
                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">X-Axis Parameter</label>
                    <select
                        value={effectiveX}
                        onChange={(e) => setXAxisParam(e.target.value)}
                        className="bg-slate-100 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-3 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                        {availableParams.map((p) => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Y-Axis Parameter</label>
                    <select
                        value={effectiveY}
                        onChange={(e) => setYAxisParam(e.target.value)}
                        className="bg-slate-100 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-3 py-1.5 text-xs text-slate-900 dark:text-white"
                    >
                        {availableParams.map((p) => (
                            <option key={p} value={p}>{p}</option>
                        ))}
                    </select>
                </div>

                <div className="ml-auto">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Color Metric</label>
                    <select
                        value={selectedMetric}
                        onChange={(e) => setSelectedMetric(e.target.value)}
                        className="bg-slate-100 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-3 py-1.5 text-xs font-mono text-slate-900 dark:text-white"
                    >
                        {metrics.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
                <div className="inline-block min-w-full">
                    <div className="flex">
                        <div className="flex flex-col justify-center pr-2">
                            <span className="transform -rotate-90 text-[11px] font-bold text-slate-400 whitespace-nowrap w-4">
                                {effectiveY}
                            </span>
                        </div>

                        <div>
                            {yValues.map((yVal) => (
                                <div key={yVal} className="flex items-center">
                                    <div className="w-14 text-right pr-2 text-[11px] text-slate-500 font-mono py-1">{yVal}</div>
                                    {xValues.map((xVal) => {
                                        const cell = matrix.get(`${xVal}-${yVal}`);
                                        const hasVal = cell !== undefined;

                                        return (
                                            <div
                                                key={`${xVal}-${yVal}`}
                                                onClick={() => cell?.res?.params && onSelectConfig?.(cell.res.params)}
                                                className={`w-14 h-10 m-0.5 rounded flex items-center justify-center relative group transition-transform hover:scale-105 hover:z-10 ${
                                                    onSelectConfig && hasVal ? 'cursor-pointer' : 'cursor-default'
                                                }`}
                                                style={{
                                                    backgroundColor: hasVal ? getCellColor(cell.val) : 'transparent',
                                                    border: hasVal ? 'none' : '1px dashed #27272A',
                                                }}
                                            >
                                                {hasVal ? (
                                                    <>
                                                        <span className="text-[10px] font-mono font-bold text-white drop-shadow">
                                                            {cell.val.toFixed(1)}
                                                        </span>
                                                        <div className="hidden group-hover:block absolute bottom-full mb-2 bg-[#050505] text-white text-[11px] p-2.5 rounded-lg shadow-xl z-50 whitespace-nowrap pointer-events-none border border-[#1F1F1F]">
                                                            <div className="font-bold border-b border-[#1F1F1F] pb-1 mb-1">
                                                                {effectiveX}={xVal}, {effectiveY}={yVal}
                                                            </div>
                                                            <div>Profit: <span className="font-mono text-emerald-400">{cell.res.profitPercent}%</span></div>
                                                            <div>Sharpe: <span className="font-mono text-blue-400">{cell.res.sharpeRatio}</span></div>
                                                            <div>Max DD: <span className="font-mono text-rose-400">-{Math.abs(cell.res.maxDrawdown || 0)}%</span></div>
                                                            {onSelectConfig && <div className="text-[10px] text-brand-primary mt-1">Click to apply params</div>}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <span className="text-[9px] text-slate-600">-</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}

                            <div className="flex ml-14 mt-2">
                                {xValues.map((xVal) => (
                                    <div key={xVal} className="w-14 text-center text-[11px] text-slate-500 font-mono">
                                        {xVal}
                                    </div>
                                ))}
                            </div>
                            <div className="text-center mt-2 text-[11px] font-bold text-slate-400">
                                {effectiveX}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ParameterHeatmap;
