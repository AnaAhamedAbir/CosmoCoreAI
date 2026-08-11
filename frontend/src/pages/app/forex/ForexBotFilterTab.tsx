import React from 'react';
import { Globe, Activity } from 'lucide-react';

interface ForexBotFilterTabProps {
  useNewsFilter: boolean;
  setUseNewsFilter: (val: boolean) => void;
  maxSpread: number;
  setMaxSpread: (val: number) => void;
  sessions: { london: boolean; ny: boolean; tokyo: boolean; sydney: boolean };
  setSessions: (val: any) => void;
  enableAiTrend: boolean;
  setEnableAiTrend: (val: boolean) => void;
}

export const ForexBotFilterTab: React.FC<ForexBotFilterTabProps> = ({
  useNewsFilter, setUseNewsFilter,
  maxSpread, setMaxSpread,
  sessions, setSessions,
  enableAiTrend, setEnableAiTrend
}) => {
  const handleSessionToggle = (sessionKey: string) => {
    setSessions((prev: any) => ({ ...prev, [sessionKey]: !prev[sessionKey] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Globe className="text-[#D4AF37]" size={20} />
        <h3 className="text-lg font-bold text-white">Execution Filters & AI</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Market Conditions */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-300">Market Conditions</h4>
          
          <label className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5 cursor-pointer hover:border-white/20 transition-colors">
            <div>
              <span className="block text-sm text-gray-200 font-medium">Avoid High-Impact News</span>
              <span className="block text-xs text-gray-500 mt-1">Pauses trading 30m before/after red folder events</span>
            </div>
            <div className="relative inline-flex items-center">
              <input type="checkbox" checked={useNewsFilter} onChange={(e) => setUseNewsFilter(e.target.checked)} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D4AF37]"></div>
            </div>
          </label>

          <div className="p-3 bg-black/20 rounded-xl border border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Max Acceptable Spread (Pips)</span>
              <input 
                type="number" step="0.1" 
                value={maxSpread} 
                onChange={(e) => setMaxSpread(parseFloat(e.target.value))}
                className="w-20 bg-black/40 border border-white/10 rounded p-1 text-center text-white text-sm focus:border-[#D4AF37] outline-none" 
              />
            </div>
          </div>
        </div>

        {/* Sessions & AI */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h4 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Activity size={16} /> Advanced Targeting
          </h4>

          <div className="p-3 bg-black/20 rounded-xl border border-white/5">
            <span className="block text-sm text-gray-300 mb-3">Active Trading Sessions</span>
            <div className="grid grid-cols-2 gap-3">
              {Object.keys(sessions).map((session) => (
                <label key={session} className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={sessions[session as keyof typeof sessions]} 
                    onChange={() => handleSessionToggle(session)} 
                    className="accent-[#D4AF37] w-4 h-4 cursor-pointer"
                  />
                  <span className="text-sm text-gray-400 group-hover:text-gray-200 capitalize">{session} Session</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between p-3 bg-[#D4AF37]/5 rounded-xl border border-[#D4AF37]/20 cursor-pointer hover:border-[#D4AF37]/50 transition-colors">
            <div>
              <span className="block text-sm text-[#D4AF37] font-bold">AI Trend Confluence</span>
              <span className="block text-xs text-gray-400 mt-1">Requires ML Model + EMA agreement for entries</span>
            </div>
            <div className="relative inline-flex items-center">
              <input type="checkbox" checked={enableAiTrend} onChange={(e) => setEnableAiTrend(e.target.checked)} className="sr-only peer" />
              <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#D4AF37]"></div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
};
