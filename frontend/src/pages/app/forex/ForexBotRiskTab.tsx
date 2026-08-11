import React from 'react';
import { ShieldAlert, TrendingDown } from 'lucide-react';

interface ForexBotRiskTabProps {
  maxDrawdown: number;
  setMaxDrawdown: (val: number) => void;
  stopLoss: number;
  setStopLoss: (val: number) => void;
  takeProfit: number;
  setTakeProfit: (val: number) => void;
  enableTrailingStop: boolean;
  setEnableTrailingStop: (val: boolean) => void;
  trailingDistance: number;
  setTrailingDistance: (val: number) => void;
  enableBreakeven: boolean;
  setEnableBreakeven: (val: boolean) => void;
  breakevenTrigger: number;
  setBreakevenTrigger: (val: number) => void;
}

export const ForexBotRiskTab: React.FC<ForexBotRiskTabProps> = ({
  maxDrawdown, setMaxDrawdown,
  stopLoss, setStopLoss,
  takeProfit, setTakeProfit,
  enableTrailingStop, setEnableTrailingStop,
  trailingDistance, setTrailingDistance,
  enableBreakeven, setEnableBreakeven,
  breakevenTrigger, setBreakevenTrigger
}) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="text-[#D4AF37]" size={20} />
        <h3 className="text-lg font-bold text-white">Risk Management Control</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Basic Risk */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-300">Global Risk Parameters</h4>
          
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Max Drawdown (%)</label>
            <input 
              type="number" 
              value={maxDrawdown} 
              onChange={(e) => setMaxDrawdown(parseFloat(e.target.value))}
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37]" 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Stop Loss (Pips)</label>
              <input 
                type="number" 
                value={stopLoss} 
                onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#ef4444]" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Take Profit (Pips)</label>
              <input 
                type="number" 
                value={takeProfit} 
                onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#22c55e]" 
              />
            </div>
          </div>
        </div>

        {/* Advanced Protection */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <TrendingDown size={16} /> Advanced Protection
          </h4>

          {/* Trailing Stop */}
          <div className="p-3 bg-black/20 rounded-xl border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">Enable Trailing Stop</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={enableTrailingStop} onChange={(e) => setEnableTrailingStop(e.target.checked)} className="sr-only peer" />
                <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D4AF37]"></div>
              </label>
            </div>
            {enableTrailingStop && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-xs text-gray-400">Distance (Pips)</span>
                <input 
                  type="number" 
                  value={trailingDistance} 
                  onChange={(e) => setTrailingDistance(parseFloat(e.target.value))}
                  className="w-20 bg-black/40 border border-white/10 rounded p-1 text-center text-white text-sm focus:border-[#D4AF37] outline-none" 
                />
              </div>
            )}
          </div>

          {/* Move to Breakeven */}
          <div className="p-3 bg-black/20 rounded-xl border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">Move to Breakeven</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={enableBreakeven} onChange={(e) => setEnableBreakeven(e.target.checked)} className="sr-only peer" />
                <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D4AF37]"></div>
              </label>
            </div>
            {enableBreakeven && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-xs text-gray-400">Trigger at Profit (Pips)</span>
                <input 
                  type="number" 
                  value={breakevenTrigger} 
                  onChange={(e) => setBreakevenTrigger(parseFloat(e.target.value))}
                  className="w-20 bg-black/40 border border-white/10 rounded p-1 text-center text-white text-sm focus:border-[#D4AF37] outline-none" 
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
};
