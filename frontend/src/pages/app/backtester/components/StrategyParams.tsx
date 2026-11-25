import React, { useRef, useCallback, useEffect } from 'react';

type OptimizationParamValue = { start: number | string; end: number | string; step: number | string };
type OptimizationParams = Record<string, OptimizationParamValue>;

const RangeSliderInput: React.FC<{
    config: { label: string; min?: number; max?: number; step?: number };
    value: OptimizationParamValue;
    onChange: (newValue: OptimizationParamValue) => void;
    hideStepInput?: boolean;
}> = ({ config, value, onChange, hideStepInput = false }) => {
    const { min = 0, max = 100, step = 1 } = config;
    const { start, end, step: stepValue } = value;
    const startNum = Number(start);
    const endNum = Number(end);
    const rangeRef = useRef<HTMLDivElement>(null);
    const getPercent = useCallback((val: number) => {
        if (max === min) return 0;
        return Math.max(0, Math.min(100, Math.round(((val - min) / (max - min)) * 100)));
    }, [min, max]);

    useEffect(() => {
        const startPercent = getPercent(startNum);
        const endPercent = getPercent(endNum);
        if (rangeRef.current) {
            rangeRef.current.style.left = `${startPercent}%`;
            rangeRef.current.style.width = `${Math.max(0, endPercent - startPercent)}%`;
        }
    }, [startNum, endNum, getPercent]);

    const handleValueChange = (field: 'start' | 'end' | 'step', val: string | number) => {
        const numVal = Number(val);
        const newValues = { ...value, [field]: numVal };
        let s = Number(newValues.start);
        let e = Number(newValues.end);
        if (field === 'start') s = Math.min(s, e);
        else if (field === 'end') e = Math.max(e, s);
        onChange({ ...newValues, start: s, end: e });
    };

    const handleRangeChange = (field: 'start' | 'end', e: React.ChangeEvent<HTMLInputElement>) => {
        const val = Number(e.target.value);
        if (field === 'start') {
            const newStart = Math.min(val, endNum - Number(stepValue));
            if (newStart !== startNum) onChange({ ...value, start: newStart });
        } else {
            const newEnd = Math.max(val, startNum + Number(stepValue));
            if (newEnd !== endNum) onChange({ ...value, end: newEnd });
        }
    };

    const inputClasses = 'w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-2 py-1 text-slate-900 dark:text-white text-xs font-mono focus:ring-1 focus:ring-brand-primary focus:border-brand-primary outline-none';

    return (
        <div className="space-y-2.5 bg-slate-50 dark:bg-[#0F0F0F] p-2.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
            <div className="range-slider-container">
                <input type="range" min={min} max={max} step={step} value={startNum} onChange={(e) => handleRangeChange('start', e)} className="thumb thumb--left" aria-label="Start value" />
                <input type="range" min={min} max={max} step={step} value={endNum} onChange={(e) => handleRangeChange('end', e)} className="thumb thumb--right" aria-label="End value" />
                <div className="range-slider-track"></div>
                <div ref={rangeRef} className="range-slider-range"></div>
            </div>
            <div className={`grid gap-2 ${hideStepInput ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5">Min</label>
                    <input type="number" min={min} max={max} step={step} value={start} onChange={(e) => handleValueChange('start', e.target.value)} className={inputClasses} />
                </div>
                {!hideStepInput && (
                    <div>
                        <label className="block text-[10px] text-slate-400 mb-0.5 text-center">Step</label>
                        <input type="number" min={step} step={step} value={stepValue} onChange={(e) => handleValueChange('step', e.target.value)} className={inputClasses} />
                    </div>
                )}
                <div>
                    <label className="block text-[10px] text-slate-400 mb-0.5 text-right">Max</label>
                    <input type="number" min={min} max={max} step={step} value={end} onChange={(e) => handleValueChange('end', e.target.value)} className={inputClasses} />
                </div>
            </div>
        </div>
    );
};

interface StrategyParamsProps {
    mode: 'single' | 'optimization';
    activeParamsConfig: Record<string, any>;
    params: Record<string, any>;
    setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
    optimizationParams: OptimizationParams;
    setOptimizationParams: React.Dispatch<React.SetStateAction<OptimizationParams>>;
    optimizationMethod: 'gridSearch' | 'geneticAlgorithm';
    setOptimizationMethod: (m: 'gridSearch' | 'geneticAlgorithm') => void;
    hideOptimizationMethod?: boolean;
    gaParams: { populationSize: number; generations: number };
    setGaParams: React.Dispatch<React.SetStateAction<{ populationSize: number; generations: number }>>;
}

export const StrategyParams: React.FC<StrategyParamsProps> = ({
    mode,
    activeParamsConfig,
    params,
    setParams,
    optimizationParams,
    setOptimizationParams,
    optimizationMethod,
    setOptimizationMethod,
    hideOptimizationMethod = false,
    gaParams,
    setGaParams,
}) => {
    const inputBaseClasses = 'w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white focus:ring-1 focus:ring-brand-primary focus:border-brand-primary outline-none';

    const handleParamChange = (key: string, value: string) => {
        const numValue = Number(value);
        setParams((prev) => ({ ...prev, [key]: value === '' || isNaN(numValue) ? value : numValue }));
    };

    const handleOptimizationParamChange = (key: string, newValue: OptimizationParamValue) => {
        setOptimizationParams((prev) => ({ ...prev, [key]: newValue }));
    };

    if (!activeParamsConfig || Object.keys(activeParamsConfig).length === 0) return null;

    if (mode === 'single') {
        return (
            <div className="pt-3 border-t border-slate-200 dark:border-[#1F1F1F] space-y-2.5">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Strategy Parameters</h4>
                <div className="grid grid-cols-2 gap-2.5">
                    {Object.entries(activeParamsConfig).map(([key, config]: [string, any]) => (
                        <div key={key}>
                            <label className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1 truncate" title={config.label || key}>
                                {config.label || key}
                            </label>
                            <input
                                type={config.type || 'number'}
                                value={params[key] ?? ''}
                                onChange={(e) => handleParamChange(key, e.target.value)}
                                className={inputBaseClasses}
                            />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (mode === 'optimization') {
        return (
            <div className="pt-3 border-t border-slate-200 dark:border-[#1F1F1F] space-y-3">
                {!hideOptimizationMethod && (
                    <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Search Algorithm</label>
                        <div className="grid grid-cols-2 bg-slate-100 dark:bg-[#111] rounded-lg p-1 gap-1 border border-slate-200 dark:border-[#1F1F1F]">
                            <button
                                onClick={() => setOptimizationMethod('gridSearch')}
                                className={`py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                                    optimizationMethod === 'gridSearch'
                                        ? 'bg-white dark:bg-[#222] shadow-sm text-brand-primary'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                Grid Search
                            </button>
                            <button
                                onClick={() => setOptimizationMethod('geneticAlgorithm')}
                                className={`py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                                    optimizationMethod === 'geneticAlgorithm'
                                        ? 'bg-white dark:bg-[#222] shadow-sm text-brand-primary'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                Genetic Algo
                            </button>
                        </div>
                    </div>
                )}

                {optimizationMethod === 'geneticAlgorithm' && !hideOptimizationMethod && (
                    <div className="grid grid-cols-2 gap-2.5">
                        <div>
                            <label className="block text-[10px] text-slate-500 mb-1">Pop. Size</label>
                            <input
                                type="number"
                                value={gaParams.populationSize}
                                onChange={(e) => setGaParams((p) => ({ ...p, populationSize: parseInt(e.target.value) || 10 }))}
                                className={inputBaseClasses}
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] text-slate-500 mb-1">Generations</label>
                            <input
                                type="number"
                                value={gaParams.generations}
                                onChange={(e) => setGaParams((p) => ({ ...p, generations: parseInt(e.target.value) || 5 }))}
                                className={inputBaseClasses}
                            />
                        </div>
                    </div>
                )}

                <div className="space-y-3">
                    {Object.entries(activeParamsConfig).map(([key, config]: [string, any]) => (
                        <div key={key} className="space-y-1">
                            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                {config.label || key}
                            </label>
                            {optimizationParams[key] && (
                                <RangeSliderInput
                                    config={config}
                                    value={optimizationParams[key]}
                                    onChange={(v) => handleOptimizationParamChange(key, v)}
                                    hideStepInput={optimizationMethod === 'geneticAlgorithm' && !hideOptimizationMethod}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return null;
};
