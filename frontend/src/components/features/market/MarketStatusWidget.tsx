import React, { useState, useEffect } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { Clock } from 'lucide-react';

const MarketStatusWidget: React.FC = () => {
    const { activeMarket } = useMarketStore();
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (activeMarket === 'crypto') return null;

    const formatTime = (timeZone: string) => {
        return currentTime.toLocaleTimeString('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
    };

    const getSessionStatus = (market: string) => {
        const hour = currentTime.getUTCHours();
        // Simplified mock logic for market sessions
        if (market === 'New York') return hour >= 13 && hour < 20 ? 'OPEN' : 'CLOSED';
        if (market === 'London') return hour >= 8 && hour < 16 ? 'OPEN' : 'CLOSED';
        if (market === 'Tokyo') return hour >= 0 && hour < 6 ? 'OPEN' : 'CLOSED';
        return 'CLOSED';
    };

    const sessions = [
        { name: 'New York', tz: 'America/New_York' },
        { name: 'London', tz: 'Europe/London' },
        { name: 'Tokyo', tz: 'Asia/Tokyo' }
    ];

    return (
        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-2 mb-3.5">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">Market Sessions</h2>
            </div>
            <div className="space-y-2">
                {sessions.map(session => {
                    const status = getSessionStatus(session.name);
                    const isOpen = status === 'OPEN';
                    return (
                        <div key={session.name} className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10">
                            <div>
                                <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">{session.name}</p>
                                <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">{formatTime(session.tz)}</p>
                            </div>
                            <div className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-black tracking-wider border ${isOpen ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300'}`}>
                                {isOpen ? '● OPEN' : '○ CLOSED'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MarketStatusWidget;
