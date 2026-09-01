import React, { useState } from 'react';

interface Props {
  indicatorId: string;
  indicatorName: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
}

export const IndicatorSettingsModal: React.FC<Props> = ({ indicatorId, indicatorName, isOpen, onClose, onSave }) => {
  const [period, setPeriod] = useState(14);
  const [source, setSource] = useState('close');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-slate-900 border border-brand-primary/30 rounded-xl shadow-2xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-brand-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /></svg>
            {indicatorName} Settings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Length / Period</label>
            <input 
              type="number" 
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:border-brand-primary transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Source</label>
            <select 
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-white outline-none focus:border-brand-primary transition-colors"
            >
              <option value="close">Close</option>
              <option value="open">Open</option>
              <option value="high">High</option>
              <option value="low">Low</option>
              <option value="hlc3">HLC3</option>
            </select>
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <button 
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              onSave({ length: period, source });
              onClose();
            }}
            className="flex-1 py-2 rounded-lg bg-brand-primary hover:bg-brand-primary/80 text-black font-bold transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
