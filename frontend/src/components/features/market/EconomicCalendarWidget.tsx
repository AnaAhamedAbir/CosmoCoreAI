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
        <div className="rounded-2xl bg-white dark:bg-[#0A0A0A] border border-brand-border-light dark:border-[#1A1A1A] p-6 laptop:p-4 shadow-lg mb-6">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-yellow-500" />
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Economic Calendar</h2>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 bg-yellow-500/10 text-yellow-600 rounded-full">TODAY</span>
            </div>
            
            <div className="space-y-3">
                {mockEvents.map(evt => (
                    <div key={evt.id} className="p-3 rounded-xl bg-gray-50 dark:bg-[#000000]/50 border border-gray-100 dark:border-white/5 group hover:border-yellow-500/30 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-gray-500 w-16">{evt.time}</span>
                                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-slate-700 dark:text-gray-300">{evt.currency}</span>
                                {evt.impact === 'high' && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                            </div>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1 group-hover:text-yellow-600 dark:group-hover:text-yellow-500 transition-colors">{evt.event}</p>
                        <div className="flex gap-4 text-xs text-gray-500">
                            <span>Act: <span className="font-bold text-slate-700 dark:text-gray-300">{evt.actual || '--'}</span></span>
                            <span>Frcst: <span className="font-bold">{evt.forecast}</span></span>
                            <span>Prev: <span className="font-bold">{evt.previous}</span></span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EconomicCalendarWidget;
