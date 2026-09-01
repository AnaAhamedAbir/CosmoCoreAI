import React, { useMemo } from 'react';
import { IndicatorData } from './useTechnicalIndicators';
import { IndicatorCategory } from './indicatorConfig';

interface Props {
  indicators: IndicatorData[];
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
const IndicatorRow = React.memo(({ ind }: { ind: IndicatorData }) => (
  <div className="flex items-center justify-between p-2 hover:bg-white/5 rounded-lg transition-colors group">
    <div className="flex flex-col">
      <span className="text-sm font-semibold text-gray-200">{ind.shortName}</span>
      <span className="text-[10px] text-gray-500 group-hover:text-gray-400 transition-colors">
        {ind.name} • {ind.defaultParams !== '-' ? ind.defaultParams : 'Default'}
      </span>
    </div>
    <div className="flex items-center gap-3">
      <span className="text-sm font-mono text-gray-300 w-16 text-right">{ind.value}</span>
      <div className={`px-2 py-1 rounded text-[10px] font-bold w-16 text-center ${getSignalBadgeColor(ind.signal)}`}>
        {getSignalLabel(ind.signal)}
      </div>
    </div>
  </div>
));

export const IndicatorList: React.FC<Props> = ({ indicators }) => {
  // Group indicators by category
  const grouped = useMemo(() => {
    const groups: Record<string, IndicatorData[]> = {};
    indicators.forEach(ind => {
      if (!groups[ind.category]) groups[ind.category] = [];
      groups[ind.category].push(ind);
    });
    return groups;
  }, [indicators]);

  const categoryOrder: IndicatorCategory[] = ['Oscillators', 'Moving Averages', 'Volatility', 'Momentum', 'Trend', 'Volume', 'Other'];

  return (
    <div className="flex flex-col gap-6 mt-6 pb-6">
      {categoryOrder.map(cat => {
        const catIndicators = grouped[cat];
        if (!catIndicators || catIndicators.length === 0) return null;

        return (
          <div key={cat} className="flex flex-col bg-slate-800/40 rounded-xl border border-white/5 overflow-hidden">
            <div className="bg-slate-800/80 px-4 py-2 border-b border-white/5">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">{cat}</h4>
            </div>
            <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
              {catIndicators.map(ind => (
                <IndicatorRow key={ind.id} ind={ind} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
