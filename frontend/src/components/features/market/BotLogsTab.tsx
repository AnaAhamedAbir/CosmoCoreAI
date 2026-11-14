import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useBotLogs } from '../../../hooks/useBotLogs';

interface BotLogsTabProps {
    botId?: number | null;
}

export const BotLogsTab: React.FC<BotLogsTabProps> = ({ botId }) => {
    // 1. Fetch real logs via Hook
    const { logs, isConnected, clearLogs } = useBotLogs(botId || null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // 2. Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const getLogBadgeStyle = (type: string) => {
        const lowerType = type.toLowerCase();
        if (lowerType.includes('info')) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20';
        if (lowerType.includes('signal')) return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20';
        if (lowerType.includes('trade') || lowerType.includes('profit')) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20';
        if (lowerType.includes('warning') || lowerType.includes('risk')) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20';
        if (lowerType.includes('error') || lowerType.includes('stop')) return 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20';
        if (lowerType.includes('system')) return 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20';
        return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20';
    };

    return (
        <div className="w-full h-full flex flex-col font-mono text-sm overflow-hidden bg-white dark:bg-[#070b14] transition-colors">
            {/* Terminal Subheader with connection status and Clear button */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-white/10 bg-gray-50/80 dark:bg-white/[0.02] shrink-0 transition-colors">
                <div className="flex items-center space-x-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500'} `}></div>
                    <span className="text-gray-600 dark:text-gray-400 font-bold tracking-wider text-[11px] truncate">
                        ALGO_BOT_{botId || 'NONE'}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${isConnected ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25' : 'bg-rose-500/15 text-rose-500 border border-rose-500/25'}`}>
                        {isConnected ? 'LIVE FEED' : 'OFFLINE'}
                    </span>
                </div>
                <button 
                    onClick={clearLogs}
                    className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white px-2 py-0.5 rounded border border-gray-300 dark:border-white/10 bg-white hover:bg-gray-100 dark:bg-white/5 dark:hover:bg-white/10 transition-colors shadow-sm cursor-pointer"
                    title="Clear log buffer"
                >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear</span>
                </button>
            </div>

            {/* Scrollable logs */}
            <div className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-1.5 bg-white dark:bg-[#070b14] transition-colors select-text">
                {logs.length === 0 ? (
                    <div className="flex items-center space-x-3 p-2 text-xs">
                        <span className="text-gray-400 dark:text-gray-500 font-mono">[{new Date().toLocaleTimeString('en-US', { hour12: false })}]</span>
                        <span className="font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-[10px]">WAIT</span>
                        <span className="text-gray-500 dark:text-gray-400 animate-pulse">
                            {botId ? 'Awaiting backend logs...' : 'No bot selected...'}
                        </span>
                    </div>
                ) : (
                    logs.map((log, index) => (
                        <div key={index} className="flex items-start space-x-2.5 p-1 px-1.5 hover:bg-gray-100/80 dark:hover:bg-white/5 rounded transition-colors text-xs leading-relaxed">
                            <span className="text-gray-400 dark:text-gray-500 shrink-0 font-mono text-[11px]">[{log.time}]</span>
                            <span className={`font-bold uppercase px-1.5 py-0.2 rounded shrink-0 text-[10px] tracking-wide ${getLogBadgeStyle(log.type)}`}>
                                {log.type}
                            </span>
                            <span className="text-gray-800 dark:text-gray-200 break-all font-mono">{log.message}</span>
                        </div>
                    ))
                )}
                {/* Empty div for auto-scroll anchor */}
                <div ref={logsEndRef} />
            </div>
        </div>
    );
};
