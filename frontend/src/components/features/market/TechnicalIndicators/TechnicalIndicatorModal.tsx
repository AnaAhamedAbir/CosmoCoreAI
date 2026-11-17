import React from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, X } from 'lucide-react';
import { useFloatingModalDrag } from '@/hooks/useFloatingModalDrag';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { FloatingModalCyberFX } from '@/components/common/FloatingModalCyberFX';
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
  const { isThermalGuardActive } = useDeviceProfile();
  const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
    isOpen,
    storageKey: 'cosmo_technical_indicator_modal_pos_v1',
    defaultWidth: 620,
    defaultHeight: 740,
    maxCapHeight: 778,
    compactMaxCapHeight: 720,
  });

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={modalContainerRef}
      style={containerStyle}
      className={`cosmo-theme-modal fixed w-[620px] max-w-[calc(100vw-12px)] h-[740px] rounded-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
        isThermalGuardActive ? 'animate-cosmo-modal-fast' : 'animate-cosmo-modal-teal'
      } ${
        isThermalGuardActive
          ? 'bg-[#080c16] border-teal-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
          : 'bg-[#070b14] bg-gradient-to-b from-[#0c1220]/95 via-[#080d1a]/[0.98] to-[#050811]/[0.98] border-teal-500/35 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(20,184,166,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
      }`}
    >
      <FloatingModalCyberFX color="teal" isThermalGuard={isThermalGuardActive} />

      {/* Top Neon Accent Line */}
      <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-teal-400 to-emerald-500 opacity-85 shrink-0" />

      {/* Draggable Header */}
      <div
        onMouseDown={handleStartDrag}
        onTouchStart={handleStartDrag}
        style={{ touchAction: 'none' }}
        className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0"
        title="Drag to move Technical Analysis"
      >
        <div className="flex items-center gap-2 pointer-events-none min-w-0">
          <GripVertical className="w-3.5 h-3.5 text-teal-400/80 shrink-0" />
          <div className="p-1.5 bg-brand-primary/20 rounded-lg text-brand-primary shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] sm:text-[14.5px] font-black text-white tracking-tight truncate">
              Technical Analysis
            </h2>
            <p className="text-[9.5px] text-slate-400 font-mono truncate">
              Real-time indicators for {symbol.toUpperCase()}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer shrink-0"
          title="Close Technical Analysis"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content (Scrollable) */}
      <div
        style={{ touchAction: 'pan-y' }}
        className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 custom-scrollbar select-text"
      >
        {/* AI Insight Summary */}
        {aiSummary && (
          <div className="mb-4 p-3.5 bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-brand-primary/20 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-30 group-hover:opacity-100 transition-opacity">
              <svg className="w-5 h-5 text-brand-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" /></svg>
            </div>
            <h3 className="text-[11px] font-bold text-brand-primary uppercase tracking-widest mb-1.5 flex items-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
              AI Market Insight
            </h3>
            <p className="text-[12.5px] text-slate-300 italic">"{aiSummary}"</p>
          </div>
        )}

        {/* Confluence Alerts Section */}
        {confluenceAlerts && confluenceAlerts.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            <h3 className="text-[11px] font-medium text-slate-400 tracking-widest uppercase">High Probability Setups</h3>
            {confluenceAlerts.map((alert, idx) => (
              <div key={idx} className={`p-2.5 rounded-lg border flex items-start gap-2.5 ${
                alert.type === 'BULLISH' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                <span className="text-base">⚡</span>
                <p className="text-[12.5px]">{alert.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Top Section: Gauge */}
        <div className="mb-5">
          <OverallGauge sentiment={overallSentiment} />
        </div>

        {/* Bottom Section: Indicator Grid */}
        <div className="relative">
          <h3 className="text-[11px] font-medium text-slate-400 mb-2 tracking-widest uppercase">Indicator Details (50+)</h3>
          {indicators.length > 0 ? (
            <IndicatorList indicators={indicators} winRates={winRates} onSaveConfig={updateConfig} />
          ) : (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
