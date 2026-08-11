import React from 'react';
import { Settings, Activity, Loader2, XCircle } from 'lucide-react';
import TargetSelection from '@/components/ml/TargetSelection';
import ForecastConfigurator from '@/components/ml/ForecastConfigurator';
import EvaluationMetricSelector from '@/components/ml/EvaluationMetricSelector';
import DataAugmentationConfig from '@/components/ml/DataAugmentationConfig';
import ClusterImportanceToggle from '@/components/ml/ClusterImportanceToggle';
import AdversarialTrainingConfig from '@/components/ml/AdversarialTrainingConfig';
import DatasetSplitConfig from '@/components/ml/DatasetSplitConfig';
import { TripleBarrierToggle } from './TripleBarrierToggle';
import { MetaLabelingToggle } from './MetaLabelingToggle';
import { FeatureSelectionDropdown } from './FeatureSelectionDropdown';
import LiveMarketPulse from '@/components/ml/LiveMarketPulse';
import AdvancedHyperparameters from '@/components/ml/AdvancedHyperparameters';

export interface ForexCoreParametersProps {
    symbol: string;
    setSymbol: (v: string) => void;
    broker: string;
    setBroker: (v: string) => void;
    instruments: any[];
    isTraining: boolean;
    isDeleting: boolean;
    handleDeleteDataset: () => void;
    algorithm: string;
    
    // Timeframe & Rows & Dates
    timeframe: string;
    setTimeframe: (v: string) => void;
    targetRows: number;
    setTargetRows: (v: number) => void;
    dateRangeMode: 'ticks' | 'date';
    setDateRangeMode: (v: 'ticks' | 'date') => void;
    startDate: string;
    setStartDate: (v: string) => void;
    endDate: string;
    setEndDate: (v: string) => void;
    
    // Core Parameters
    modelName: string;
    setModelName: (v: string) => void;
    predictionTarget: string;
    setPredictionTarget: (v: string) => void;
    forecastHorizon: number;
    setForecastHorizon: (v: number) => void;
    lookbackWindow: number;
    setLookbackWindow: (v: number) => void;
    evalMetric: string;
    setEvalMetric: (v: string) => void;
    learningRate: number;
    setLearningRate: (v: number) => void;
    maxDepth: number;
    setMaxDepth: (v: number) => void;

    // Preprocessing
    outlierRemoval: string;
    setOutlierRemoval: (v: string) => void;
    scalingMethod: string;
    setScalingMethod: (v: string) => void;

    // Advanced Preprocessing
    fractionalDiff: boolean;
    setFractionalDiff: (v: boolean) => void;
    fractionalDValue: number;
    setFractionalDValue: (v: number) => void;
    augmentationStrategy: string;
    setAugmentationStrategy: (v: string) => void;
    augmentationFactor: number;
    setAugmentationFactor: (v: number) => void;
    augmentationSamples?: number;
    setAugmentationSamples?: (v: number) => void;
    useClusteredImportance: boolean;
    setUseClusteredImportance: (v: boolean) => void;
    enableAdversarial: boolean;
    setEnableAdversarial: (v: boolean) => void;
    adversarialEpsilon: number;
    setAdversarialEpsilon: (v: number) => void;
    enableMetaLabeling: boolean;
    setEnableMetaLabeling: (v: boolean) => void;
    featureSelectionMethod: string;
    setFeatureSelectionMethod: (v: string) => void;
    applyPcaCollinearity: boolean;
    setApplyPcaCollinearity: (v: boolean) => void;
    applyShapSelection: boolean;
    setApplyShapSelection: (v: boolean) => void;
    shapVarianceThreshold: number;
    setShapVarianceThreshold: (v: number) => void;
    missingDataThreshold: number;
    setMissingDataThreshold: (v: number) => void;
    autoFeatureSelection: boolean;
    setAutoFeatureSelection: (v: boolean) => void;
    autoFeatureCount: number;
    setAutoFeatureCount: (v: number) => void;

    // Dataset Split
    splitMethod: string;
    setSplitMethod: (v: string) => void;
    trainRatio: number;
    setTrainRatio: (v: number) => void;
    valRatio: number;
    setValRatio: (v: number) => void;
    testRatio: number;
    setTestRatio: (v: number) => void;
    imbalanceStrategy: string;
    setImbalanceStrategy: (v: string) => void;
    feeThreshold: number;
    setFeeThreshold: (v: number) => void;
    purgeLength: number;
    setPurgeLength: (v: number) => void;
    wfoWindows: number;
    setWfoWindows: (v: number) => void;
    
    // Triple Barrier
    useTripleBarrier: boolean;
    setUseTripleBarrier: (v: boolean) => void;
    ptSlRatio: number;
    setPtSlRatio: (v: number) => void;
    barrierTimeout: number;
    setBarrierTimeout: (v: number) => void;
    

}

const TIMEFRAMES = ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const ForexSymbolSelector = ({ symbol, setSymbol, broker, setBroker, instruments }: any) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState('');

    const filteredInstruments = instruments.filter((inst: any) => 
        inst.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        inst.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectedInst = instruments.find((i: any) => i.name === symbol);
    
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <select value={broker} onChange={(e) => setBroker(e.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-teal-500/50 outline-none w-[140px]">
                    <option value="oanda" className="bg-gray-900 text-white">OANDA</option>
                    <option value="fxcm" className="bg-gray-900 text-white">FXCM</option>
                    <option value="mt5" className="bg-gray-900 text-white">MetaTrader 5</option>
                </select>
                
                <div className="relative flex-1">
                    <div 
                        onClick={() => setIsOpen(!isOpen)}
                        className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white cursor-pointer hover:bg-white/10 transition-colors flex items-center justify-between"
                    >
                        <span>{instruments.length === 0 ? "Loading..." : (selectedInst?.display_name || symbol)}</span>
                        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                    
                    {isOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                            <div className="absolute top-full left-0 right-0 mt-2 bg-[#0a0f16] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[300px]">
                                <div className="p-2 border-b border-white/10">
                                    <input 
                                        type="text"
                                        placeholder="Search pair..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500/50"
                                        autoFocus
                                    />
                                </div>
                                <div className="overflow-y-auto custom-scrollbar p-1">
                                    {filteredInstruments.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400 text-center">No pairs found</div>
                                    ) : (
                                        filteredInstruments.map((inst: any) => (
                                            <div 
                                                key={inst.name}
                                                onClick={() => {
                                                    setSymbol(inst.name);
                                                    setIsOpen(false);
                                                    setSearchQuery('');
                                                }}
                                                className={`px-3 py-2 text-sm rounded-lg cursor-pointer transition-colors ${symbol === inst.name ? 'bg-teal-500/20 text-teal-400' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                                            >
                                                {inst.display_name}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ForexCoreParametersPanel: React.FC<ForexCoreParametersProps> = (props) => {
    return (
        <div className="flex flex-col h-full bg-white/5 border border-teal-500/30 rounded-2xl shadow-[0_0_12px_rgba(20,184,166,0.1)] overflow-hidden">
            <div className="p-5 bg-black/40 border-b border-white/10 flex-shrink-0 relative z-20">
                <h3 className="text-sm font-bold text-teal-400 flex items-center gap-2 uppercase tracking-widest">
                    <Settings className="w-4 h-4" /> Core Parameters
                </h3>
            </div>
            <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar h-full">
                
                {/* Upper Half: Asset, Model Name, Targets */}
                <div className="flex flex-col gap-4">
                    <LiveMarketPulse symbol={props.symbol} exchange={props.broker} />
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Broker & Currency Pair</label>
                        <ForexSymbolSelector 
                            symbol={props.symbol} 
                            setSymbol={props.setSymbol} 
                            broker={props.broker} 
                            setBroker={props.setBroker} 
                            instruments={props.instruments} 
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Custom Model Name (Optional)</label>
                    <input 
                        type="text" 
                        value={props.modelName} 
                        onChange={e => props.setModelName(e.target.value)}
                        disabled={props.isTraining}
                        className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:ring-2 focus:ring-teal-500/50 outline-none transition-all disabled:opacity-50 placeholder-white/30 shadow-inner"
                        placeholder="e.g., EURUSD_Scalper_V1"
                    />
                </div>

                <TargetSelection 
                    predictionTarget={props.predictionTarget}
                    setPredictionTarget={props.setPredictionTarget}
                    isTraining={props.isTraining}
                    selectedAlgorithm={props.algorithm}
                />

                <TripleBarrierToggle 
                    useTripleBarrier={props.useTripleBarrier}
                    setUseTripleBarrier={props.setUseTripleBarrier}
                    ptSlRatio={props.ptSlRatio}
                    setPtSlRatio={props.setPtSlRatio}
                    barrierTimeout={props.barrierTimeout}
                    setBarrierTimeout={props.setBarrierTimeout}
                    isTraining={props.isTraining}
                />

                <ForecastConfigurator
                    forecastHorizon={props.forecastHorizon}
                    setForecastHorizon={props.setForecastHorizon}
                    lookbackWindow={props.lookbackWindow}
                    setLookbackWindow={props.setLookbackWindow}
                />

                <EvaluationMetricSelector
                    predictionTarget={props.predictionTarget}
                    evalMetric={props.evalMetric}
                    setEvalMetric={props.setEvalMetric}
                />

                <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Timeframe (Resolution)</label>
                    <div className="grid grid-cols-3 gap-2">
                        {TIMEFRAMES.map(tf => (
                            <button
                                key={tf}
                                disabled={props.isTraining}
                                onClick={() => props.setTimeframe(tf)}
                                className={`py-2 rounded-xl text-sm font-bold transition-all duration-300 ${props.timeframe === tf ? 'bg-teal-500/20 text-teal-400 border border-teal-400/50 shadow-[0_0_15px_rgba(20,184,166,0.3)]' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 hover:text-white'}`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                </div>
                


                {/* Lower Half: Advanced Preprocessing UI */}
                <div className="mt-6 pt-6 border-t border-white/10">
                    <h4 className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <Activity className="w-4 h-4" /> Data Preprocessing
                    </h4>
                    
                    <div className="space-y-4">
                        {/* Note: Missing Data Handling is excluded intentionally for Forex */}

                        <div>
                            <label className="block text-[11px] font-bold text-slate-400 mb-1.5 uppercase">Outlier Filtering</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { id: 'none', label: 'None' },
                                    { id: 'zscore', label: 'Z-Score (>3σ)' },
                                    { id: 'iqr', label: 'IQR Clipping' }
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        disabled={props.isTraining}
                                        onClick={() => props.setOutlierRemoval(opt.id)}
                                        className={`py-1.5 rounded-lg text-xs font-bold transition-all ${props.outlierRemoval === opt.id ? 'bg-teal-500/20 text-teal-300 border border-teal-500/50 shadow-[0_0_10px_rgba(20,184,166,0.2)]' : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'}`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-400 mb-1.5 uppercase">Feature Scaling</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { id: 'none', label: 'None' },
                                    { id: 'standard', label: 'Standard' },
                                    { id: 'minmax', label: 'MinMax' },
                                    { id: 'robust', label: 'Robust' }
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        disabled={props.isTraining}
                                        onClick={() => props.setScalingMethod(opt.id)}
                                        className={`py-1.5 rounded-lg text-xs font-bold transition-all ${props.scalingMethod === opt.id ? 'bg-teal-500/20 text-teal-300 border border-teal-500/50 shadow-[0_0_10px_rgba(20,184,166,0.2)]' : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10'}`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        
                        <FeatureSelectionDropdown 
                            featureSelectionMethod={props.featureSelectionMethod}
                            setFeatureSelectionMethod={props.setFeatureSelectionMethod}
                            isTraining={props.isTraining}
                        />

                        {/* 🚀 Smart Feature Selection (Phase 3) */}
                        <div className="p-3 bg-teal-500/5 border border-teal-500/20 rounded-xl space-y-3 mt-4">
                            <h4 className="text-xs font-bold text-teal-400 flex items-center justify-between">
                                <span className="flex items-center gap-2">Smart Feature Selection</span>
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        props.setApplyPcaCollinearity(true);
                                        props.setApplyShapSelection(true);
                                        props.setShapVarianceThreshold(0.95);
                                    }}
                                    className="text-[10px] px-2 py-1 bg-teal-500 hover:bg-teal-400 text-white rounded font-bold shadow-lg shadow-teal-500/30 transition-all"
                                >
                                    Auto-Optimize
                                </button>
                            </h4>
                            
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-[11px] font-bold text-slate-300 block">Collinearity Filter (PCA)</span>
                                    <span className="text-[9px] text-slate-500">Drops features with &gt;95% correlation to reduce noise.</span>
                                </div>
                                <button
                                    onClick={(e) => { e.preventDefault(); props.setApplyPcaCollinearity(!props.applyPcaCollinearity); }}
                                    className={`w-10 h-5 rounded-full transition-colors relative ${props.applyPcaCollinearity ? 'bg-teal-500' : 'bg-slate-700'}`}
                                >
                                    <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${props.applyPcaCollinearity ? 'translate-x-5.5 left-0.5' : 'translate-x-0.5'}`} style={{ transform: props.applyPcaCollinearity ? 'translateX(22px)' : 'translateX(2px)' }} />
                                </button>
                            </div>
                            
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-[11px] font-bold text-slate-300 block">SHAP Value Extraction</span>
                                    <span className="text-[9px] text-slate-500">Trains lightweight XGBoost to pick features with predictive power.</span>
                                </div>
                                <button
                                    onClick={(e) => { e.preventDefault(); props.setApplyShapSelection(!props.applyShapSelection); }}
                                    className={`w-10 h-5 rounded-full transition-colors relative ${props.applyShapSelection ? 'bg-teal-500' : 'bg-slate-700'}`}
                                >
                                    <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${props.applyShapSelection ? 'translate-x-5.5 left-0.5' : 'translate-x-0.5'}`} style={{ transform: props.applyShapSelection ? 'translateX(22px)' : 'translateX(2px)' }} />
                                </button>
                            </div>

                            {props.applyShapSelection && (
                                <div className="pt-2 border-t border-teal-500/10">
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>Variance Explained Threshold</span>
                                        <span className="text-teal-400 font-bold">{(props.shapVarianceThreshold * 100).toFixed(0)}%</span>
                                    </div>
                                    <input 
                                        type="range" min="0.50" max="0.99" step="0.01"
                                        value={props.shapVarianceThreshold} 
                                        onChange={(e) => props.setShapVarianceThreshold(parseFloat(e.target.value))}
                                        className="w-full accent-teal-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            )}

                            <div className="pt-2 border-t border-teal-500/10">
                                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                    <span>Missing Data Dropout Threshold</span>
                                    <span className="text-teal-400 font-bold">{(props.missingDataThreshold * 100).toFixed(0)}%</span>
                                </div>
                                <input 
                                    type="range" min="0.05" max="0.50" step="0.01"
                                    value={props.missingDataThreshold} 
                                    onChange={(e) => props.setMissingDataThreshold(parseFloat(e.target.value))}
                                    className="w-full accent-teal-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                />
                                <p className="text-[9px] text-slate-500 mt-1">Drops features with &gt;{(props.missingDataThreshold * 100).toFixed(0)}% missing data (protects sparse features like volume).</p>
                            </div>
                            <div className="pt-2 border-t border-teal-500/10 flex items-center justify-between">
                                <div>
                                    <span className="text-[10px] text-slate-400 block mb-0.5">Auto Feature Selection</span>
                                    <span className="text-[9px] text-slate-500 block">RF+MI Hybrid Rank (Prevents Overfitting)</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => props.setAutoFeatureSelection(!props.autoFeatureSelection)}
                                    className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none ${props.autoFeatureSelection ? 'bg-teal-500' : 'bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${props.autoFeatureSelection ? 'translate-x-4' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            {props.autoFeatureSelection && (
                                <div className="pt-1">
                                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                                        <span>Target Feature Count</span>
                                        <span className="text-teal-400 font-bold">{props.autoFeatureCount}</span>
                                    </div>
                                    <input 
                                        type="range" min="10" max="150" step="10"
                                        value={props.autoFeatureCount} 
                                        onChange={(e) => props.setAutoFeatureCount(parseInt(e.target.value))}
                                        className="w-full accent-teal-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            )}
                        </div>
                        
                        <DataAugmentationConfig
                            augmentationStrategy={props.augmentationStrategy}
                            setAugmentationStrategy={props.setAugmentationStrategy}
                            augmentationFactor={props.augmentationFactor}
                            setAugmentationFactor={props.setAugmentationFactor}
                            augmentationSamples={props.augmentationSamples}
                            setAugmentationSamples={props.setAugmentationSamples}
                        />
                        
                        <ClusterImportanceToggle 
                            useClusteredImportance={props.useClusteredImportance}
                            setUseClusteredImportance={props.setUseClusteredImportance}
                        />
                        
                        <AdversarialTrainingConfig 
                            enableAdversarial={props.enableAdversarial}
                            setEnableAdversarial={props.setEnableAdversarial}
                            adversarialEpsilon={props.adversarialEpsilon}
                            setAdversarialEpsilon={props.setAdversarialEpsilon}
                        />

                        <MetaLabelingToggle 
                            enableMetaLabeling={props.enableMetaLabeling}
                            setEnableMetaLabeling={props.setEnableMetaLabeling}
                            isTraining={props.isTraining}
                        />
                    </div>
                </div>

                {/* Dataset Split Configuration */}
                <div className="mt-6 pt-6 border-t border-white/10">
                    <DatasetSplitConfig
                        splitMethod={props.splitMethod}
                        setSplitMethod={props.setSplitMethod}
                        trainRatio={props.trainRatio}
                        setTrainRatio={props.setTrainRatio}
                        valRatio={props.valRatio}
                        setValRatio={props.setValRatio}
                        testRatio={props.testRatio}
                        setTestRatio={props.setTestRatio}
                        imbalanceStrategy={props.imbalanceStrategy}
                        setImbalanceStrategy={props.setImbalanceStrategy}
                        purgeLength={props.purgeLength}
                        setPurgeLength={props.setPurgeLength}
                        wfoWindows={props.wfoWindows}
                        setWfoWindows={props.setWfoWindows}
                    />
                </div>

            </div>
        </div>
    );
};
