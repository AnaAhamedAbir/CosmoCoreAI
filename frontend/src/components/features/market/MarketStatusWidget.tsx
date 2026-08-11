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
        <div className="rounded-2xl bg-white dark:bg-[#0A0A0A] border border-brand-border-light dark:border-[#1A1A1A] p-6 laptop:p-4 shadow-lg mb-6">
            <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-yellow-500" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Market Sessions</h2>
            </div>
            <div className="space-y-3">
                {sessions.map(session => {
                    const status = getSessionStatus(session.name);
                    const isOpen = status === 'OPEN';
                    return (
                        <div key={session.name} className="flex justify-between items-center p-3 rounded-xl bg-gray-50 dark:bg-[#000000]/50 border border-gray-100 dark:border-white/5">
                            <div>
                                <p className="font-semibold text-sm text-slate-900 dark:text-white">{session.name}</p>
                                <p className="text-xs text-gray-500">{formatTime(session.tz)}</p>
                            </div>
                            <div className={`px-2 py-1 rounded-full text-[10px] font-bold tracking-wider ${isOpen ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                {isOpen ? '🟢 OPEN' : '🔴 CLOSED'}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default MarketStatusWidget;
