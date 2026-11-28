import React from 'react';
import { Monitor, Maximize2, Sparkles, SlidersHorizontal } from 'lucide-react';
import { useViewportProfile } from '@/hooks/useViewportProfile';
import { DisplayFitMode, setDisplayFitMode } from '@/utils/viewportProfile';

interface DisplayOptimizerWidgetProps {
  compact?: boolean;
}

const MODE_OPTIONS: Array<{
  id: DisplayFitMode;
  label: string;
  desc: string;
}> = [
  { id: 'auto', label: 'Auto', desc: 'Auto-adapts to monitor resolution (1366×768 → 4K)' },
  { id: 'fit', label: 'Full Fit', desc: 'Tighter workspace chrome so more fits in one screen' },
  { id: 'comfort', label: 'Comfort', desc: 'Full-size 16px components with smooth page scroll' },
  { id: 'native', label: 'Native 1:1', desc: 'Unmodified baseline layout (1920×1080 reference)' },
];

/**
 * Modular Display & Resolution Auto-Optimizer control panel.
 * Displays live monitor dimensions, detected tier, and lets users switch fit modes.
 */
const DisplayOptimizerWidget: React.FC<DisplayOptimizerWidgetProps> = ({ compact = false }) => {
  const viewport = useViewportProfile();
  const { metrics, tierLabel, mode, tokens } = viewport;

  if (compact) {
    return (
      <div className="rounded-xl border border-cyan-500/25 bg-white/80 dark:bg-white/[0.03] p-3 space-y-2 shadow-sm dark:shadow-none">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
              <Maximize2 className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-black tracking-wider uppercase text-slate-900 dark:text-white">
                  Display Auto-Fit
                </span>
                <span className="px-1.5 py-0.5 text-[8.5px] font-mono font-black rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                  {metrics.width}×{metrics.height}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 truncate">
                {tierLabel} • Root {tokens.rootFontPx}px • DPR {metrics.dpr}x
              </p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg p-0.5 flex-shrink-0">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDisplayFitMode(opt.id)}
                title={opt.desc}
                className={`px-1.5 py-0.5 text-[8.5px] font-bold uppercase rounded transition-colors cursor-pointer ${
                  mode === opt.id
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#0A0F1C] p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-500">
            <Monitor className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Multi-Monitor Display Auto-Optimizer</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
                <Sparkles className="w-3 h-3" />
                {tierLabel}
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Viewport: <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{metrics.width}×{metrics.height}</span> • Screen:{' '}
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{metrics.screenWidth}×{metrics.screenHeight}</span> • Base Font:{' '}
              <span className="font-mono font-semibold text-cyan-600 dark:text-cyan-300">{tokens.rootFontPx}px</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {MODE_OPTIONS.map((opt) => {
          const active = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setDisplayFitMode(opt.id)}
              className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                active
                  ? 'bg-cyan-500/10 border-cyan-500/50 ring-1 ring-cyan-500/30'
                  : 'bg-white dark:bg-[#070B14] border-slate-200 dark:border-slate-800 hover:border-cyan-500/35'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-bold uppercase tracking-wider ${active ? 'text-cyan-700 dark:text-cyan-300' : 'text-slate-800 dark:text-slate-200'}`}>
                  {opt.label}
                </span>
                <SlidersHorizontal className={`w-3.5 h-3.5 ${active ? 'text-cyan-500' : 'text-slate-400'}`} />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{opt.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DisplayOptimizerWidget;
