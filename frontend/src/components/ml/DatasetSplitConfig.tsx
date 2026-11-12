import React, { useState, useEffect } from 'react';
import { Layers } from 'lucide-react';

export interface DatasetSplitConfigProps {
  splitMethod: string;
  setSplitMethod: (val: string) => void;
  trainRatio: number;
  setTrainRatio: (val: number) => void;
  valRatio: number;
  setValRatio: (val: number) => void;
  testRatio: number;
  setTestRatio: (val: number) => void;
  imbalanceStrategy: string;
  setImbalanceStrategy: (val: string) => void;
  purgeLength?: number;
  setPurgeLength?: (val: number) => void;
  wfoWindows?: number;
  setWfoWindows?: (val: number) => void;
}

const DatasetSplitConfig: React.FC<DatasetSplitConfigProps> = ({
  splitMethod,
  setSplitMethod,
  trainRatio,
  setTrainRatio,
  valRatio,
  setValRatio,
  testRatio,
  setTestRatio,
  imbalanceStrategy,
  setImbalanceStrategy,
  purgeLength = 5,
  setPurgeLength,
  wfoWindows = 5,
  setWfoWindows
}) => {
  useEffect(() => {
    // Ensure ratios sum to 100
    if (trainRatio + valRatio + testRatio !== 100) {
      setTestRatio(Math.max(0, 100 - trainRatio - valRatio));
    }
  }, [trainRatio, valRatio, testRatio, setTestRatio]);

  return (
    <div className="bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 rounded-xl p-4 mb-6 shadow-sm dark:shadow-none">
      <div className="flex items-center gap-2 mb-4">
        <Layers className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Dataset Split & Imbalance</h3>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Split Method</label>
            <select
              value={splitMethod}
              onChange={(e) => setSplitMethod(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors"
            >
              <option value="chronological" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Chronological (Time-Series)</option>
              <option value="walk_forward" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Walk-Forward Validation</option>
              <option value="purged_cv" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Purged Cross-Validation (CPCV)</option>
              <option value="random" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Random Split (Not Rec. for TS)</option>
            </select>
          </div>
          
          {splitMethod === 'purged_cv' && setPurgeLength && (
            <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 rounded-lg">
                <div className="flex justify-between text-[11px] font-bold text-indigo-700 dark:text-indigo-300 mb-2 uppercase">
                    <span>Purge Length (Bars)</span>
                    <span>{purgeLength}</span>
                </div>
                <input 
                    type="range" 
                    min="1" 
                    max="50" 
                    value={purgeLength}
                    onChange={(e) => setPurgeLength(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                />
                <p className="text-[10px] text-indigo-600 dark:text-indigo-400/80 mt-2 leading-relaxed">
                    Drops samples between train and validation sets to prevent data leakage from overlapping features (e.g. rolling means).
                </p>
            </div>
          )}

          {splitMethod === 'walk_forward' && setWfoWindows && (
            <div className="mt-3 p-3 bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 rounded-lg">
                <div className="flex justify-between text-[11px] font-bold text-teal-700 dark:text-teal-300 mb-2 uppercase">
                    <span>WFO Windows (Folds)</span>
                    <span>{wfoWindows}</span>
                </div>
                <input 
                    type="range" 
                    min="2" 
                    max="20" 
                    value={wfoWindows}
                    onChange={(e) => setWfoWindows(Number(e.target.value))}
                    className="w-full accent-teal-500"
                />
                <p className="text-[10px] text-teal-600 dark:text-teal-400/80 mt-2 leading-relaxed">
                    Simulates real-world periodic retraining. Data is divided into {wfoWindows || 5} chronological segments.
                </p>
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">Class Imbalance Strategy</label>
            <select
              value={imbalanceStrategy}
              onChange={(e) => setImbalanceStrategy(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors"
            >
              <option value="none" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">None</option>
              <option value="smote" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">SMOTE (Synthetic Minority)</option>
              <option value="class_weights" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Compute Class Weights</option>
              <option value="undersampling" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Random Undersampling</option>
            </select>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600 dark:text-slate-400">Train Ratio</span>
              <span className="text-cyan-600 dark:text-cyan-400 font-medium">{trainRatio}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="90"
              value={trainRatio}
              onChange={(e) => setTrainRatio(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600 dark:text-slate-400">Validation Ratio</span>
              <span className="text-purple-600 dark:text-purple-400 font-medium">{valRatio}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="30"
              value={valRatio}
              onChange={(e) => setValRatio(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-600 dark:text-slate-400">Test Ratio</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">{Math.max(0, 100 - trainRatio - valRatio)}%</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-900 h-2.5 rounded-full overflow-hidden flex">
              <div style={{ width: `${trainRatio}%` }} className="bg-cyan-500 h-full transition-all duration-300"></div>
              <div style={{ width: `${valRatio}%` }} className="bg-purple-500 h-full transition-all duration-300"></div>
              <div style={{ width: `${Math.max(0, 100 - trainRatio - valRatio)}%` }} className="bg-emerald-500 h-full transition-all duration-300"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatasetSplitConfig;
