import React, { useEffect, useState } from 'react';
import { useTechnicalIndicators } from './useTechnicalIndicators';
import { OverallGauge } from './OverallGauge';
import { IndicatorList } from './IndicatorList';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
}

export const TechnicalIndicatorModal: React.FC<Props> = ({ isOpen, onClose, symbol }) => {
  const { indicators, overallSentiment, confluenceAlerts, aiSummary, winRates, updateConfig } = useTechnicalIndicators(symbol, isOpen);
  const [isRendered, setIsRendered] = useState(false);

  // For smooth entry animation
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => setIsRendered(true), 10);
    } else {
      setIsRendered(false);
    }
  }, [isOpen]);

  if (!isOpen && !isRendered) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 transition-all duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none delay-150'}`}>
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isRendered ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      {/* Modal Container */}
      <div 
        className={`relative w-full max-w-4xl max-h-[90vh] bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ${isRendered ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/5 bg-slate-900/50 backdrop-blur-md z-10 sticky top-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-primary/20 rounded-lg text-brand-primary">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Technical Analysis</h2>
              <p className="text-xs text-slate-400">Real-time indicators for {symbol.toUpperCase()}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
          
          {/* AI Insight Summary */}
          {aiSummary && (
            <div className="mb-6 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-brand-primary/20 rounded-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-30 group-hover:opacity-100 transition-opacity">
                <svg className="w-6 h-6 text-brand-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" /></svg>
              </div>
              <h3 className="text-xs font-bold text-brand-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                AI Market Insight
              </h3>
              <p className="text-sm text-slate-300 italic">"{aiSummary}"</p>
            </div>
          )}

          {/* Confluence Alerts Section */}
          {confluenceAlerts && confluenceAlerts.length > 0 && (
            <div className="mb-6 flex flex-col gap-2">
              <h3 className="text-sm font-medium text-slate-400 tracking-widest uppercase">High Probability Setups</h3>
              {confluenceAlerts.map((alert, idx) => (
                <div key={idx} className={`p-3 rounded-lg border flex items-start gap-3 ${
                  alert.type === 'BULLISH' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}>
                  <span className="text-xl">⚡</span>
                  <p className="text-sm">{alert.message}</p>
                </div>
              ))}
            </div>
          )}

          {/* Top Section: Gauge */}
          <div className="mb-8">
            <OverallGauge sentiment={overallSentiment} />
          </div>

          {/* Bottom Section: Indicator Grid */}
          <div className="relative">
            <h3 className="text-sm font-medium text-slate-400 mb-2 tracking-widest uppercase">Indicator Details (50+)</h3>
            {indicators.length > 0 ? (
              <IndicatorList indicators={indicators} winRates={winRates} onSaveConfig={updateConfig} />
            ) : (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
