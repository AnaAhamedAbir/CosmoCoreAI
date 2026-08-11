

import React from 'react';
import { Cpu } from 'lucide-react';

interface ForexBotGeneralTabProps {
  botName: string;
  setBotName: (val: string) => void;
  pair: string;
  setPair: (val: string) => void;
  lotSize: number;
  setLotSize: (val: number) => void;
  leverage: number;
  setLeverage: (val: number) => void;
  selectedStrategy: string;
  setSelectedStrategy: (val: string) => void;
}

const templates = [
  { title: 'News Straddle Pro', description: 'Places buy/sell stops before high impact news to catch volatility.', type: 'Breakout', recommendedPairs: ['EUR/USD', 'GBP/USD'] },
  { title: 'London Scalper', description: 'High frequency scalping exploiting tight spreads during London-NY overlap.', type: 'HFT', recommendedPairs: ['GBP/JPY', 'EUR/GBP'] },
  { title: 'Smart Grid', description: 'Cost-averaging grid system with built-in hedging.', type: 'Grid', recommendedPairs: ['AUD/CAD', 'NZD/USD'] },
];

const StrategyTemplateCard = ({ title, description, type, recommendedPairs, onSelect, isSelected }: any) => (
  <div
    className={`p-4 rounded-2xl border transition-all cursor-pointer ${isSelected
        ? 'bg-[#D4AF37]/10 border-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.2)]'
        : 'bg-white/5 dark:bg-[#0A101D]/80 border-gray-200 dark:border-white/10 hover:border-[#D4AF37]/50'
      }`}
    onClick={onSelect}
  >
    <div className="flex justify-between items-start mb-2">
      <div className={`p-2 rounded-lg ${isSelected ? 'bg-[#D4AF37] text-slate-900' : 'bg-[#D4AF37]/10 text-[#D4AF37]'}`}>
        <Cpu size={16} />
      </div>
      <span className="text-[10px] font-mono px-2 py-1 bg-white/10 rounded-md text-gray-400">{type}</span>
    </div>
    <h3 className={`text-sm font-bold mt-2 ${isSelected ? 'text-[#D4AF37]' : 'text-slate-900 dark:text-white'}`}>{title}</h3>
    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{description}</p>
  </div>
);

export const ForexBotGeneralTab: React.FC<ForexBotGeneralTabProps> = ({
  botName, setBotName,
  pair, setPair,
  lotSize, setLotSize,
  leverage, setLeverage,
  selectedStrategy, setSelectedStrategy
}) => {
  const handleTemplateSelect = (template: any) => {
    setSelectedStrategy(template.title);
    setBotName(template.title);
    setPair(template.recommendedPairs[0]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
      {/* Left Column: Form */}
      <div className="lg:col-span-3 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-400 mb-1">Unit Designation</label>
            <input
              type="text"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white font-bold focus:outline-none focus:border-[#D4AF37]"
              placeholder="Bot Name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Currency Pair</label>
            <select
              value={pair}
              onChange={(e) => setPair(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37]"
            >
              <option>EUR/USD</option>
              <option>GBP/JPY</option>
              <option>XAU/USD (Gold)</option>
              <option>GBP/USD</option>
              <option>EUR/GBP</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Lot Size</label>
            <div className="flex gap-2">
              <select
                value={lotSize}
                onChange={(e) => setLotSize(parseFloat(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37]"
              >
                <option value="1.0">Standard (1.0)</option>
                <option value="0.1">Mini (0.1)</option>
                <option value="0.01">Micro (0.01)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Leverage</label>
            <select
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37]"
            >
              <option value="50">1:50</option>
              <option value="100">1:100</option>
              <option value="500">1:500</option>
            </select>
          </div>
        </div>
      </div>

      {/* Right Column: Templates */}
      <div className="lg:col-span-2 space-y-4 border-l border-white/10 pl-8">
        <h3 className="text-lg font-bold text-white mb-2">Strategy Templates</h3>
        <div className="space-y-3">
          {templates.map((template, idx) => (
            <StrategyTemplateCard
              key={idx}
              {...template}
              isSelected={selectedStrategy === template.title}
              onSelect={() => handleTemplateSelect(template)}
            />
          ))}
        </div>
        <button
          className="w-full border border-dashed border-gray-600 text-gray-400 hover:text-[#D4AF37] hover:border-[#D4AF37] mt-4 p-3 rounded-xl transition-colors"
          onClick={() => setSelectedStrategy('Custom')}
        >
          Custom Protocol
        </button>
      </div>
    </div>
  );
};
