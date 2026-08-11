import React from 'react';
import { Target } from 'lucide-react';

interface TripleBarrierToggleProps {
    useTripleBarrier: boolean;
    setUseTripleBarrier: (v: boolean) => void;
    ptSlRatio: number;
    setPtSlRatio: (v: number) => void;
    barrierTimeout: number;
    setBarrierTimeout: (v: number) => void;
    isTraining: boolean;
}

export const TripleBarrierToggle: React.FC<TripleBarrierToggleProps> = ({
    useTripleBarrier,
    setUseTripleBarrier,
    ptSlRatio,
    setPtSlRatio,
    barrierTimeout,
    setBarrierTimeout,
    isTraining
}) => {
    return (
        <div className="mt-4 p-4 bg-black/20 border border-white/5 rounded-xl">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-purple-400" />
                    <div>
                        <h4 className="text-sm font-semibold text-white">Triple Barrier Method</h4>
                        <p className="text-[10px] text-slate-400">Risk-Adjusted Target (TP/SL/Time)</p>
                    </div>
                </div>
                <button
                    disabled={isTraining}
                    onClick={() => setUseTripleBarrier(!useTripleBarrier)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${useTripleBarrier ? 'bg-purple-500' : 'bg-slate-600'}`}
                >
                    <span className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform ${useTripleBarrier ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>
            
            {useTripleBarrier && (
                <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">PT / SL Ratio</span>
                        <span className="text-purple-400 font-bold">{ptSlRatio}x</span>
                    </div>
                    <input 
                        type="range"
                        min="0.5" max="5.0" step="0.1"
                        value={ptSlRatio}
                        onChange={(e) => setPtSlRatio(parseFloat(e.target.value))}
                        disabled={isTraining}
                        className="w-full accent-purple-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 mb-3">
                        <span>Tight SL (0.5x)</span>
                        <span>Wide TP (5.0x)</span>
                    </div>

                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">Time Barrier (Bars)</span>
                        <span className="text-purple-400 font-bold">{barrierTimeout}</span>
                    </div>
                    <input 
                        type="range"
                        min="1" max="200" step="1"
                        value={barrierTimeout}
                        onChange={(e) => setBarrierTimeout(parseInt(e.target.value))}
                        disabled={isTraining}
                        className="w-full accent-purple-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                        <span>Short (1)</span>
                        <span>Long Hold (200)</span>
                    </div>
                </div>
            )}
        </div>
    );
};
