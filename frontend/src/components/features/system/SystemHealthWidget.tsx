
import React, { useState, useEffect } from 'react';
import { Activity, Database, Server, Cpu } from 'lucide-react';
import { systemService, SystemHealth } from '@/services/systemService';

const SystemHealthWidget: React.FC = () => {
    const [health, setHealth] = useState<SystemHealth | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<boolean>(false);

    const fetchHealth = async () => {
        try {
            // setError(false); // Optional: reset error on retry?
            // If we want to show 'offline' on error, we handle it in catch
            const data = await systemService.getSystemHealth();
            setHealth(data);
            setError(false);
        } catch (err) {
            console.error("Health Check Failed:", err);
            setError(true);
            setHealth(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHealth();
        const interval = setInterval(fetchHealth, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    const getBadgeColor = (status: string) => {
        if (status === 'online' || status === 'healthy') return 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300';
        if (status === 'degraded') return 'bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300';
        return 'bg-rose-500/15 border border-rose-500/30 text-rose-700 dark:text-rose-300';
    };

    // If initial loading
    if (loading && !health && !error) {
        return (
            <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm animate-pulse">
                <div className="h-5 w-32 bg-slate-200 dark:bg-white/10 rounded mb-3"></div>
                <div className="space-y-2.5">
                    <div className="h-10 w-full bg-slate-100 dark:bg-[#0a101d] rounded-xl"></div>
                    <div className="h-10 w-full bg-slate-100 dark:bg-[#0a101d] rounded-xl"></div>
                    <div className="h-10 w-full bg-slate-100 dark:bg-[#0a101d] rounded-xl"></div>
                </div>
            </div>
        );
    }

    // Determine overall display state
    const overallStatus = error ? 'unhealthy' : (health?.status || 'unhealthy');
    const dbStatus = error ? 'offline' : (health?.services.database || 'offline');
    const redisStatus = error ? 'offline' : (health?.services.redis || 'offline');
    const celeryStatus = error ? 'offline' : (health?.services.celery_worker || 'offline');

    return (
        <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="flex justify-between items-center mb-3.5">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-300">
                        <Activity className="w-4 h-4" />
                    </div>
                    <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">System Health</h2>
                </div>

                {/* Status Badge */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono text-[10px] font-black uppercase ${
                    overallStatus === 'healthy'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : overallStatus === 'degraded'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                }`}>
                    <span className={`w-2 h-2 rounded-full ${overallStatus === 'healthy' ? 'bg-emerald-500' : overallStatus === 'degraded' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                    <span>{overallStatus}</span>
                </div>
            </div>

            <div className="space-y-2">
                {/* Database */}
                <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 text-blue-500">
                            <Database className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-gray-200">PostgreSQL DB</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase ${getBadgeColor(dbStatus)}`}>
                        {dbStatus}
                    </span>
                </div>

                {/* Redis */}
                <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 text-rose-500">
                            <Server className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-gray-200">Redis Stream</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase ${getBadgeColor(redisStatus)}`}>
                        {redisStatus}
                    </span>
                </div>

                {/* Celery Worker */}
                <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-50 dark:bg-[#0a101d] border border-slate-200/70 dark:border-white/10">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 text-amber-500">
                            <Cpu className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-gray-200">AI & Bot Workers</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black uppercase ${getBadgeColor(celeryStatus)}`}>
                        {celeryStatus === 'online' ? 'Active' : celeryStatus}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default SystemHealthWidget;
