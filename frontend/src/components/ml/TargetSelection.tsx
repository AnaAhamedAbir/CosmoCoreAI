import React from 'react';
import { Target } from 'lucide-react';

interface TargetSelectionProps {
    predictionTarget: string;
    setPredictionTarget: (target: string) => void;
    isTraining: boolean;
    selectedAlgorithm?: string;
}

const ADVANCED_SETUP_SUPPORTED_ALGOS = [
    'LSTM', 'GRU', 'TCN', '1D-CNN', 'DeepLOB', 'Transformer', 
    'PPO-RL', 'SAC-RL', 'DDPG-RL', 'TD3-RL',
    'MuZero', 'Meta-RL', 'HRL', 'MAPPO',
    'Mamba SSM', 'KAN Network', 'JEPA World Model', 'Time-LLM', 'TTFT', 'GNN-RL', 'SNN Liquid', 'Sparse MoE Router'
];

const RL_ONLY_ALGOS = [
    'MuZero', 'Meta-RL', 'HRL', 'MAPPO'
];

const TargetSelection: React.FC<TargetSelectionProps> = ({ predictionTarget, setPredictionTarget, isTraining, selectedAlgorithm }) => {
    
    // Check if the currently selected algorithm supports advanced setup
    const isAdvancedSupported = !selectedAlgorithm || ADVANCED_SETUP_SUPPORTED_ALGOS.includes(selectedAlgorithm);
    
    // Check if the currently selected algorithm forces advanced setup (RL only models)
    const isRlOnly = !!selectedAlgorithm && RL_ONLY_ALGOS.includes(selectedAlgorithm);
    
    // Check if MTL is supported (Advanced Supported but NOT RL)
    const isRlAlgo = !!selectedAlgorithm && selectedAlgorithm.includes('-RL') || isRlOnly;
    const isMtlSupported = isAdvancedSupported && !isRlAlgo;

    // Auto-switch to advanced_setup if an RL-only algorithm is selected
    React.useEffect(() => {
        if (isRlOnly && predictionTarget !== 'advanced_setup') {
            setPredictionTarget('advanced_setup');
        }
    }, [isRlOnly, predictionTarget, setPredictionTarget]);

    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" /> Prediction Target
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button
                    onClick={() => setPredictionTarget('classification')}
                    disabled={isTraining || isRlOnly}
                    title={isRlOnly ? "Not applicable for advanced RL engines" : ""}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                        isRlOnly
                            ? 'bg-white/5 text-slate-500 border border-white/5 opacity-40 cursor-not-allowed grayscale'
                            : predictionTarget === 'classification' 
                                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)] border border-indigo-400/50' 
                                : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 hover:text-white'
                    }`}
                >
                    <span className="block">Direction (Up/Down)</span>
                    <span className="block text-[10px] font-normal opacity-70 mt-0.5">Classification</span>
                </button>
                <button
                    onClick={() => setPredictionTarget('regression')}
                    disabled={isTraining || isRlOnly}
                    title={isRlOnly ? "Not applicable for advanced RL engines" : ""}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                        isRlOnly
                            ? 'bg-white/5 text-slate-500 border border-white/5 opacity-40 cursor-not-allowed grayscale'
                            : predictionTarget === 'regression' 
                                ? 'bg-gradient-to-r from-pink-600 to-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.4)] border border-rose-400/50' 
                                : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 hover:text-white'
                    }`}
                >
                    <span className="block">Exact Price</span>
                    <span className="block text-[10px] font-normal opacity-70 mt-0.5">Regression</span>
                </button>
                <button
                    onClick={() => setPredictionTarget('advanced_setup')}
                    disabled={isTraining || !isAdvancedSupported}
                    title={!isAdvancedSupported ? `Not supported by ${selectedAlgorithm || 'this algorithm'}` : ''}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                        !isAdvancedSupported 
                            ? 'bg-white/5 text-slate-500 border border-white/5 opacity-50 cursor-not-allowed grayscale'
                            : predictionTarget === 'advanced_setup' 
                                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-[0_0_15px_rgba(8,145,178,0.4)] border border-cyan-400/50' 
                                : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 hover:text-white'
                    }`}
                >
                    <span className="block">Advanced Setup (SL/TP)</span>
                    <span className="block text-[10px] font-normal opacity-70 mt-0.5">Multi-Output</span>
                </button>
                <button
                    onClick={() => setPredictionTarget('multi_task')}
                    disabled={isTraining || !isMtlSupported}
                    title={!isMtlSupported ? `Not supported by ${selectedAlgorithm || 'this algorithm'}` : ''}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                        !isMtlSupported 
                            ? 'bg-white/5 text-slate-500 border border-white/5 opacity-50 cursor-not-allowed grayscale'
                            : predictionTarget === 'multi_task' 
                                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] border border-emerald-400/50' 
                                : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 hover:text-white'
                    }`}
                >
                    <span className="block">Multi-Task</span>
                    <span className="block text-[10px] font-normal opacity-70 mt-0.5">Dir + Price</span>
                </button>
            </div>
            <p className="text-xs text-slate-500 mt-2 ml-1 font-medium">What should the AI predict for the next candle?</p>
        </div>
    );
};

export default TargetSelection;
