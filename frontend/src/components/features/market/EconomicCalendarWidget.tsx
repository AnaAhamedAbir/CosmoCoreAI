import React from 'react';
import { useMarketStore } from '@/store/marketStore';
import { Calendar, AlertCircle } from 'lucide-react';

const EconomicCalendarWidget: React.FC = () => {
    const { activeMarket } = useMarketStore();

    if (activeMarket === 'crypto') return null;

    const mockEvents = [
        { id: 1, time: '08:30 AM', currency: 'USD', impact: 'high', event: 'Non-Farm Employment Change', actual: '', forecast: '180K', previous: '175K' },
        { id: 2, time: '08:30 AM', currency: 'USD', impact: 'high', event: 'Unemployment Rate', actual: '', forecast: '3.9%', previous: '3.9%' },
        { id: 3, time: '10:00 AM', currency: 'USD', impact: 'medium', event: 'ISM Services PMI', actual: '', forecast: '51.2', previous: '49.4' },
    ];

    return (
        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="flex justify-between items-center mb-3.5">
                <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-500" />
                    <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">Economic Calendar</h2>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 rounded-md">TODAY</span>
            </div>

            <div className="space-y-2">
                {mockEvents.map(evt => (
                    <div key={evt.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10 group hover:border-amber-500/35 transition-colors">
                        <div className="flex justify-between items-start mb-1.5">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono font-bold text-slate-500 dark:text-gray-400">{evt.time}</span>
                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-200">{evt.currency}</span>
                                {evt.impact === 'high' && <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                            </div>
                        </div>
                        <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1 group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors">{evt.event}</p>
                        <div className="flex gap-4 text-[11px] font-mono text-slate-500 dark:text-gray-400">
                            <span>Act: <strong className="text-slate-700 dark:text-gray-200">{evt.actual || '--'}</strong></span>
                            <span>Frcst: <strong>{evt.forecast}</strong></span>
                            <span>Prev: <strong>{evt.previous}</strong></span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EconomicCalendarWidget;
