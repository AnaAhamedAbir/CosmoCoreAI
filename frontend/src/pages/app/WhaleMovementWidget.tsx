
import React, { useEffect, useState } from 'react';
import apiClient from '@/services/client';

interface WhaleAlert {
    symbol: string;
    volume: number;
    price: number;
    timestamp: string;
    exchange: string;
}

const WhaleMovementWidget: React.FC<{ limit?: number }> = ({ limit = 5 }) => {
    const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchAlerts = async () => {
            try {
                const response = await apiClient.get(`/whale-alerts/recent?limit=${limit}`);
                if (Array.isArray(response.data)) {
                    setAlerts(response.data);
                }
            } catch (error) {
                console.error("Failed to fetch whale alerts", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAlerts();
        const interval = setInterval(fetchAlerts, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, [limit]);

    return (
        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                    <span className="text-lg">🐋</span> Whale Tape Alerts
                </h2>
                <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-blue-600 dark:text-cyan-300 text-[10px] font-mono font-bold">
                    LIVE FEED
                </span>
            </div>

            {isLoading ? (
                <div className="space-y-2 animate-pulse">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-[#0a101d]" />
                    ))}
                </div>
            ) : alerts.length === 0 ? (
                <div className="rounded-xl bg-slate-50 dark:bg-[#0a101d]/70 border border-dashed border-slate-200 dark:border-white/10 text-center py-5 px-3 text-xs font-mono text-slate-500 dark:text-gray-400">
                    No recent whale movements detected.
                </div>
            ) : (
                <div className="space-y-2">
                    {alerts.map((alert, index) => (
                        <div key={index} className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10 hover:border-cyan-500/35 transition-colors">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="px-2 py-1 bg-cyan-500/15 border border-cyan-500/25 rounded-lg text-cyan-700 dark:text-cyan-300 font-mono font-black text-[10px] shrink-0">
                                    {alert.exchange.toUpperCase().substring(0, 3)}
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">{alert.symbol}</p>
                                    <p className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">{new Date(alert.timestamp).toLocaleTimeString()}</p>
                                </div>
                            </div>
                            <div className="text-right font-mono shrink-0 ml-2">
                                <p className="font-black text-xs sm:text-sm text-cyan-600 dark:text-cyan-300">
                                    {alert.volume.toFixed(2)} {alert.symbol.split('/')[0] || alert.symbol}
                                </p>
                                <p className="text-[10.5px] text-slate-500 dark:text-gray-400">
                                    @ ${alert.price.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WhaleMovementWidget;
