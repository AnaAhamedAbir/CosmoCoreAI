import React from 'react';
import { Wrench, RefreshCw, LogIn } from 'lucide-react';
import Button from '@/components/common/Button';

interface MaintenanceOverlayProps {
    message: string;
    onRetry: () => void;
    onOwnerLogin: () => void;
}

const MaintenanceOverlay: React.FC<MaintenanceOverlayProps> = ({
    message,
    onRetry,
    onOwnerLogin,
}) => {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#020610]/95 backdrop-blur-xl p-4">
            <div className="max-w-lg w-full rounded-3xl border border-amber-500/30 bg-[#070F20]/90 p-8 text-center shadow-[0_0_60px_rgba(245,158,11,0.15)] space-y-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <Wrench className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                    <span className="inline-block text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded-full bg-amber-500/15 text-amber-400">
                        Scheduled Maintenance
                    </span>
                    <h2 className="text-2xl font-extrabold text-white">System Upgrade in Progress</h2>
                    <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                    <Button variant="primary" onClick={onRetry}>
                        <span className="flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4" />
                            Check Again
                        </span>
                    </Button>
                    <Button variant="secondary" onClick={onOwnerLogin}>
                        <span className="flex items-center justify-center gap-2">
                            <LogIn className="w-4 h-4" />
                            Owner Sign In
                        </span>
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default MaintenanceOverlay;
