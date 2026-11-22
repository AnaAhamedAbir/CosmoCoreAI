import React, { useCallback, useEffect, useState } from 'react';
import { billingService, type PlatformNoCodeConfig } from '@/services/adminService';
import { Megaphone, X } from 'lucide-react';

const GlobalAnnouncementBar: React.FC = () => {
    const [cfg, setCfg] = useState<PlatformNoCodeConfig | null>(null);
    const [dismissedMsg, setDismissedMsg] = useState<string | null>(null);

    const fetchConfig = useCallback(async () => {
        try {
            const data = await billingService.getPublicConfig();
            setCfg(data);
        } catch {
            // silent fallback if offline
        }
    }, []);

    useEffect(() => {
        void fetchConfig();
        const handler = () => {
            void fetchConfig();
        };
        window.addEventListener('app:public-config-refresh', handler);
        return () => window.removeEventListener('app:public-config-refresh', handler);
    }, [fetchConfig]);

    if (!cfg || !cfg.announcement_active || !cfg.announcement_message?.trim()) {
        return null;
    }

    if (dismissedMsg === cfg.announcement_message) {
        return null;
    }

    const palette =
        cfg.announcement_type === 'warning'
            ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-300'
            : cfg.announcement_type === 'success'
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
            : 'bg-cyan-500/15 border-cyan-500/30 text-cyan-700 dark:text-cyan-300';

    return (
        <div className={`px-4 py-2 border-b text-xs font-semibold flex items-center justify-between gap-3 ${palette}`}>
            <div className="flex items-center gap-2 min-w-0">
                <Megaphone className="w-4 h-4 shrink-0" />
                <span className="truncate">{cfg.announcement_message}</span>
            </div>
            <button
                type="button"
                onClick={() => setDismissedMsg(cfg.announcement_message)}
                className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0"
                aria-label="Dismiss announcement"
            >
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
};

export default GlobalAnnouncementBar;
