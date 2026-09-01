import React, { useMemo, useState } from 'react';
import { IndicatorData } from './useTechnicalIndicators';
import { IndicatorCategory } from './indicatorConfig';
import { IndicatorSettingsModal } from './IndicatorSettingsModal';

interface Props {
  indicators: IndicatorData[];
  winRates?: Record<string, number>;
  onSaveConfig: (id: string, config: any) => void;
}

const getSignalBadgeColor = (sig: string) => {
  switch (sig) {
    case 'STRONG_BUY': return 'bg-green-500/20 text-green-400 border border-green-500/30';
    case 'BUY': return 'bg-green-500/10 text-green-400/80 border border-green-500/20';
    case 'NEUTRAL': return 'bg-yellow-500/10 text-yellow-400/80 border border-yellow-500/20';
    case 'SELL': return 'bg-red-500/10 text-red-400/80 border border-red-500/20';
    case 'STRONG_SELL': return 'bg-red-500/20 text-red-400 border border-red-500/30';
    default: return 'bg-gray-500/10 text-gray-400 border border-gray-500/20';
  }
};

const getSignalLabel = (sig: string) => {
  if (sig === 'STRONG_BUY') return 'STR BUY';
  if (sig === 'STRONG_SELL') return 'STR SELL';
  return sig;
};

// Memoized individual indicator row for performance
const IndicatorRow = React.memo(({ ind, winRate, onOpenSettings }: { ind: IndicatorData, winRate?: number, onOpenSettings: (id: string, name: string) => void }) => {
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  return (
    <div className="flex items-center p-2 hover:bg-white/5 rounded-lg transition-colors group">
      {/* Indicator Info & Settings */}
      <div className="flex flex-col w-1/4 min-w-[120px]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">{ind.shortName}</span>
          {winRate !== undefined && (
            <span className="text-[9px] bg-brand-primary/20 text-brand-primary px-1.5 py-0.5 rounded-sm font-bold" title="Historical Win Rate">
              {winRate}% Win
            </span>
          )}
          <button 
            onClick={() => onOpenSettings(ind.id, ind.name)}
            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-brand-primary transition-all ml-auto pr-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          </button>
        </div>
        <span className="text-[10px] text-gray-500 group-hover:text-gray-400 transition-colors">
          {ind.defaultParams !== '-' ? ind.defaultParams : 'Default'}
        </span>
      </div>

      {/* MTF Heatmap Columns */}
      <div className="flex-1 grid grid-cols-6 gap-1">
        {timeframes.map(tf => {
          const tfData = ind.mtf ? ind.mtf[tf] : null;
          const sig = tfData ? tfData.signal : 'NEUTRAL';
          const val = tfData ? tfData.value : '-';
          
          return (
            <div key={tf} className={`flex flex-col items-center justify-center p-1 rounded border ${getSignalBadgeColor(sig)}`} title={`Value: ${val}`}>
              <span className="text-[10px] font-bold">{getSignalLabel(sig)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const IndicatorList: React.FC<Props> = ({ indicators, winRates = {}, onSaveConfig }) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedInd, setSelectedInd] = useState({ id: '', name: '' });

  const handleOpenSettings = (id: string, name: string) => {
    setSelectedInd({ id, name });
    setSettingsOpen(true);
  };

  const handleSaveSettings = (config: any) => {
    onSaveConfig(selectedInd.id, config);
  };

  const grouped = useMemo(() => {
    const groups: Record<string, IndicatorData[]> = {};
    indicators.forEach(ind => {
      if (!groups[ind.category]) groups[ind.category] = [];
      groups[ind.category].push(ind);
    });
    return groups;
  }, [indicators]);

  const categoryOrder: IndicatorCategory[] = ['Oscillators', 'Moving Averages', 'Volatility', 'Momentum', 'Trend', 'Volume', 'Other'];
  const timeframes = ['1m', '5m', '15m', '1H', '4H', '1D'];

  return (
    <div className="flex flex-col gap-6 mt-6 pb-6">
      {/* Global Heatmap Header */}
      <div className="flex px-4 py-2 bg-slate-800/80 rounded-lg border border-white/5 sticky top-0 z-10">
        <div className="w-1/4 min-w-[120px] text-xs font-bold text-slate-400 uppercase">Indicator</div>
        <div className="flex-1 grid grid-cols-6 gap-1 text-center text-xs font-bold text-slate-400 uppercase">
          {timeframes.map(tf => <div key={tf}>{tf}</div>)}
        </div>
      </div>

      {categoryOrder.map(cat => {
        const catIndicators = grouped[cat];
        if (!catIndicators || catIndicators.length === 0) return null;

        return (
          <div key={cat} className="flex flex-col bg-slate-800/40 rounded-xl border border-white/5 overflow-hidden">
            <div className="bg-slate-800/80 px-4 py-2 border-b border-white/5">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{cat}</h4>
            </div>
            <div className="p-2 flex flex-col gap-y-1">
              {catIndicators.map(ind => (
                <IndicatorRow key={ind.id} ind={ind} winRate={winRates[ind.id]} onOpenSettings={handleOpenSettings} />
              ))}
            </div>
          </div>
        );
      })}

      <IndicatorSettingsModal 
        indicatorId={selectedInd.id}
        indicatorName={selectedInd.name}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
};
