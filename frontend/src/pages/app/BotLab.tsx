import React, { useState, useEffect, useMemo } from 'react';
import { useMarketStore } from '@/store/marketStore';
import { useBotStore } from '@/store/botStore';
import Button from '@/components/common/Button';
import type { ActiveBot, BacktestResult } from '@/types';
import { useToast } from '@/context/ToastContext';
import { useLatencyGuard } from '@/context/LatencyGuardContext';
import { botService } from '@/services/botService';
import BotSettingsModal from './BotSettingsModal';
import BotLabModal from './BotLabModal';
import { runBacktestApi, getBacktestStatus } from '@/services/backtester';
import BotCard from '@/components/features/bots/BotCard';
import BotDetailsModal from '@/components/features/bots/BotDetailsModal';
import BacktestResultModal from '@/components/features/backtest/BacktestResultModal';
import BotLabHeader from '@/components/features/bots/BotLabHeader';
import {
    Hammer, Plus, ChevronDown, Search, LayoutGrid, List,
    Settings, Activity, Trash2, Copy, BarChart2, ShieldAlert
} from 'lucide-react';
import VisualStrategyBuilderModal from './VisualStrategyBuilderModal';
import DEXExecutionWidget from '@/components/features/bots/DEXExecutionWidget';

const BotLab: React.FC = () => {
    const [isCreating, setIsCreating] = useState(false);
    const { globalSymbol, setGlobalSymbol, setGlobalExchange } = useMarketStore();
    const { setActiveWallHunterId } = useBotStore();
    const [isVisualBuilderOpen, setIsVisualBuilderOpen] = useState(false);
    const [bots, setBots] = useState<ActiveBot[]>([]);
    const { showToast } = useToast();
    const { shouldWarn: isLatencyWarning, shouldProtect: isLatencyGuarded, severity: latencySeverity, reasons: latencyReasons, confirmIfHighLatency } = useLatencyGuard();
    const [backtestingBotId, setBacktestingBotId] = useState<string | null>(null);
    const [isBacktestModalOpen, setIsBacktestModalOpen] = useState(false);
    const [selectedBot, setSelectedBot] = useState<ActiveBot | null>(null);
    const [selectedDetailBot, setSelectedDetailBot] = useState<ActiveBot | null>(null);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [settingsBot, setSettingsBot] = useState<ActiveBot | null>(null);
    const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isDeFiOpen, setIsDeFiOpen] = useState(false);

    // Pro Fleet Filter, Sort & View States
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'paper' | 'live' | 'winning' | 'losing'>('all');
    const [sortBy, setSortBy] = useState<'active_first' | 'pnl_desc' | 'pnl_asc' | 'roi_desc' | 'name'>('active_first');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

    const [stats, setStats] = useState({ total_pnl: 0, average_win_rate: 0, active_bots: 0, total_bots: 0 });

    useEffect(() => { loadBots(false); }, []);

    const loadBots = async (isLoadMore = false) => {
        try {
            const limit = 20;
            const currentOffset = isLoadMore ? offset : 0;

            const [newBots, statsData] = await Promise.all([
                botService.getAllBots(currentOffset, limit),
                !isLoadMore ? botService.getBotStats() : Promise.resolve(null),
            ]);

            if (isLoadMore) {
                setBots((prev) => [...prev, ...newBots]);
            } else {
                setBots(newBots);
                if (statsData) setStats(statsData);
            }

            setOffset(currentOffset + limit);
            setHasMore(newBots.length === limit);
        } catch (error) {
            console.error(error);
            showToast('Failed to load bots', 'error');
        }
    };

    const filteredBots = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        const filtered = bots.filter((b) => {
            if (q) {
                const matches =
                    b.name?.toLowerCase().includes(q) ||
                    b.market?.toLowerCase().includes(q) ||
                    b.strategy?.toLowerCase().includes(q) ||
                    b.exchange?.toLowerCase().includes(q);
                if (!matches) return false;
            }
            if (statusFilter === 'active') return b.status === 'active';
            if (statusFilter === 'inactive') return b.status !== 'active';
            if (statusFilter === 'paper') return b.is_paper_trading !== false;
            if (statusFilter === 'live') return b.is_paper_trading === false;
            if (statusFilter === 'winning') return (b.pnl ?? 0) > 0;
            if (statusFilter === 'losing') return (b.pnl ?? 0) < 0;
            return true;
        });

        return [...filtered].sort((a, b) => {
            if (sortBy === 'active_first') {
                if (a.status === 'active' && b.status !== 'active') return -1;
                if (b.status === 'active' && a.status !== 'active') return 1;
                return (b.pnl ?? 0) - (a.pnl ?? 0);
            }
            if (sortBy === 'pnl_desc') return (b.pnl ?? 0) - (a.pnl ?? 0);
            if (sortBy === 'pnl_asc') return (a.pnl ?? 0) - (b.pnl ?? 0);
            if (sortBy === 'roi_desc') return (b.pnlPercent ?? b.pnl_percent ?? 0) - (a.pnlPercent ?? a.pnl_percent ?? 0);
            return (a.name || '').localeCompare(b.name || '');
        });
    }, [bots, searchQuery, statusFilter, sortBy]);

    const handleRunBacktest = async (bot: ActiveBot) => {
        if (backtestingBotId) return;
        setBacktestingBotId(bot.id);
        showToast(`Running 3M simulation for ${bot.name}...`, 'info');

        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setMonth(endDate.getMonth() - 3);

            const payload = {
                symbol: bot.market,
                timeframe: bot.timeframe || '1h',
                strategy: bot.strategy,
                initial_cash: bot.trade_value || 10000,
                start_date: startDate.toISOString().split('T')[0],
                end_date: endDate.toISOString().split('T')[0],
                params: bot.config?.strategyParams || {},
                commission: 0.001,
                slippage: 0,
                leverage: bot.config?.leverage || 1,
                stop_loss: bot.config?.stop_loss || bot.config?.riskParams?.stopLoss || 0,
                take_profit: bot.config?.take_profit || bot.config?.riskParams?.takeProfit || 0,
            };

            const initialRes = await runBacktestApi(payload);
            const taskId = initialRes.task_id;

            const interval = setInterval(async () => {
                try {
                    const statusRes = await getBacktestStatus(taskId);
                    if (statusRes.status === 'Completed') {
                        clearInterval(interval);
                        setBacktestingBotId(null);
                        if (statusRes.result?.error || statusRes.result?.status === 'error') {
                            showToast(`Simulation Error: ${statusRes.result.error || statusRes.result.message}`, 'error');
                        } else {
                            const raw = statusRes.result;
                            const metrics = raw.advanced_metrics || {};
                            setBacktestResult({
                                id: `bt_${Date.now()}`,
                                market: bot.market,
                                strategy: bot.strategy,
                                date: new Date().toISOString().split('T')[0],
                                profitPercent: raw.profit_percent ?? 0,
                                profit_percent: raw.profit_percent ?? 0,
                                maxDrawdown: metrics.max_drawdown ?? 0,
                                winRate: raw.trade_analysis?.win_rate ?? metrics.win_rate ?? 0,
                                sharpeRatio: metrics.sharpe ?? 0,
                                totalTrades: raw.total_trades ?? 0,
                                finalValue: raw.final_value ?? 0,
                                equity_curve: Array.isArray(raw.equity_curve)
                                    ? raw.equity_curve.map((val: any, index: number) => ({
                                        name: typeof val === 'object' ? (val.name || (val.time ? new Date(val.time * 1000).toLocaleDateString() : index.toString())) : index.toString(),
                                        value: typeof val === 'object' ? val.value : val,
                                    }))
                                    : [],
                            });
                            setSelectedBot(bot);
                            setIsBacktestModalOpen(true);
                            showToast('Simulation Complete', 'success');
                        }
                    } else if (statusRes.status === 'Failed') {
                        clearInterval(interval);
                        setBacktestingBotId(null);
                        showToast('Simulation Failed', 'error');
                    }
                } catch {
                    clearInterval(interval);
                    setBacktestingBotId(null);
                }
            }, 1500);
        } catch {
            setBacktestingBotId(null);
            showToast('Failed to start simulation', 'error');
        }
    };

    const handleSaveVisualStrategy = async (name: string, config: any) => {
        showToast(`Compiling and deploying "${name}"...`, 'info');
        try {
            const botPayload = {
                name,
                exchange: 'binance',
                market: globalSymbol || 'BTC/USDT',
                strategy: 'Custom Visual Protocol',
                timeframe: '1h',
                trade_value: 100,
                is_paper_trading: true,
                config: { amount_per_trade: 100, ...config },
            };
            const newBot = await botService.createBot(botPayload);
            setBots((prev) => [newBot, ...prev]);
            setIsVisualBuilderOpen(false);
            showToast(`Strategy "${name}" deployed successfully.`, 'success');
            loadBots(false);
        } catch (error) {
            console.error('Failed to create bot:', error);
            showToast(`Failed to deploy strategy "${name}".`, 'error');
        }
    };

    const handleToggleStatus = async (id: string, currentStatus?: string) => {
        const bot = bots.find((b) => b.id === id);
        if (!bot) return;

        const statusToUse = currentStatus || bot.status;
        const action = statusToUse === 'active' ? 'stop' : 'start';

        let overriddenHighLatency = false;
        if (action === 'start') {
            const latGate = await confirmIfHighLatency({
                actionLabel: `Start Bot: ${bot.name}`,
                details: `${bot.market || ''} • ${bot.strategy || ''}`,
                isExitOrReduce: false,
            });
            if (!latGate.proceed) return;
            overriddenHighLatency = latGate.overriddenHighLatency;
        }

        try {
            setBots((prev) => prev.map((b) => (b.id === id ? { ...b, status: action === 'start' ? 'active' : 'inactive' } : b)));
            await botService.controlBot(id, action, overriddenHighLatency ? { confirmHighLatency: true } : undefined);

            if (action === 'start') {
                setActiveWallHunterId(Number(id));
                if (bot.market) setGlobalSymbol(bot.market);
                if (bot.exchange) setGlobalExchange(bot.exchange);
            } else {
                const currentActive = useBotStore.getState().activeWallHunterId;
                if (Number(currentActive) === Number(id)) setActiveWallHunterId(null);
            }
            showToast(`${bot.name} ${action === 'start' ? 'Online' : 'Offline'}`, 'success');
            botService.getBotStats().then(setStats).catch(() => {});
        } catch (error) {
            console.error('Toggle Error:', error);
            loadBots(false);
            showToast('Command failed', 'error');
        }
    };

    const handleCloneBot = async (bot: ActiveBot) => {
        try {
            const clonePayload = {
                name: `${bot.name} (Copy)`,
                description: bot.description || '',
                exchange: bot.exchange || 'binance',
                market: bot.market,
                strategy: bot.strategy,
                timeframe: bot.timeframe || '1h',
                trade_value: Math.max(1, Number(bot.trade_value ?? bot.tradeValue ?? 100)),
                trade_unit: bot.trade_unit ?? bot.tradeUnit ?? 'QUOTE',
                api_key_id: bot.is_paper_trading === false ? (bot.api_key_id ?? bot.apiKeyId ?? null) : null,
                is_paper_trading: bot.is_paper_trading !== false,
                config: {
                    ...(bot.config || {}),
                    amount_per_trade: Math.max(1, Number(bot.config?.amount_per_trade ?? bot.trade_value ?? bot.tradeValue ?? 100)),
                    take_profit: bot.config?.take_profit && Number(bot.config.take_profit) > 0 ? Number(bot.config.take_profit) : null,
                },
            };
            const created = await botService.createBot(clonePayload);
            setBots((prev) => [created, ...prev]);
            showToast(`Cloned "${bot.name}"`, 'success');
        } catch (err: any) {
            showToast(err?.response?.data?.detail || 'Failed to clone bot', 'error');
        }
    };

    const handleEmergencySell = async (bot: ActiveBot) => {
        if (!window.confirm(`Emergency Market Close open position for "${bot.name}" (${bot.market})?`)) return;
        try {
            const res = await botService.emergencySell(bot.id, 'market');
            showToast(res?.message || `Emergency market close executed for ${bot.name}`, 'info');
            loadBots(false);
        } catch (err: any) {
            showToast(err?.response?.data?.detail || 'Emergency close failed', 'error');
        }
    };

    const handleDeleteBot = async (id: string) => {
        const bot = bots.find((b) => b.id === id);
        if (bot?.status === 'active' && !window.confirm('WARNING: Unit is ACTIVE. Terminate and delete?')) return;
        if (!window.confirm(`Confirm decommissioning "${bot?.name || id}"?`)) return;
        try {
            await botService.deleteBot(id);
            setBots((prev) => prev.filter((b) => b.id !== id));
            showToast('Unit decommissioned', 'success');
            botService.getBotStats().then(setStats).catch(() => {});
        } catch {
            showToast('Decommission failed', 'error');
        }
    };

    return (
        <div className="h-full flex flex-col animate-fade-in relative overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-[#050505]">
            {isCreating && <BotLabModal isOpen={isCreating} onClose={() => setIsCreating(false)} onSuccess={() => { loadBots(false); setIsCreating(false); }} />}
            {isVisualBuilderOpen && <VisualStrategyBuilderModal onClose={() => setIsVisualBuilderOpen(false)} onSave={handleSaveVisualStrategy} />}

            {isDeFiOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && setIsDeFiOpen(false)}>
                    <div className="relative max-w-lg w-full">
                        <div className="flex justify-end mb-2">
                            <button className="text-xs text-slate-400 hover:text-white" onClick={() => setIsDeFiOpen(false)}>Close</button>
                        </div>
                        <DEXExecutionWidget />
                    </div>
                </div>
            )}

            {selectedDetailBot && (
                <BotDetailsModal
                    bot={selectedDetailBot}
                    onClose={() => setSelectedDetailBot(null)}
                    onEmergencySell={handleEmergencySell}
                />
            )}

            {isBacktestModalOpen && selectedBot && backtestResult && (
                <BacktestResultModal
                    bot={selectedBot}
                    result={backtestResult}
                    onClose={() => setIsBacktestModalOpen(false)}
                />
            )}

            {/* Top Command Header */}
            <div className="flex-none p-4 md:p-6 pb-3 space-y-4">
                <div className="flex flex-wrap justify-between items-center gap-3">
                    <div>
                        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                            Bot Laboratory
                            <span className="text-brand-primary font-mono text-[11px] px-2 py-0.5 bg-brand-primary/10 rounded border border-brand-primary/20">
                                FLEET TERMINAL
                            </span>
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Algorithmic Execution, Risk Surveillance & Real-Time Telemetry
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => setIsDeFiOpen(true)} className="text-xs flex items-center gap-1.5 border-slate-200 dark:border-[#1F1F1F]">
                            DeFi Direct
                        </Button>
                        <Button variant="outline" onClick={() => setIsVisualBuilderOpen(true)} className="text-xs flex items-center gap-1.5 border-slate-200 dark:border-[#1F1F1F]">
                            <Hammer size={14} /> Visual Builder
                        </Button>
                        <Button variant="primary" onClick={() => setIsCreating(true)} className="text-xs flex items-center gap-1.5">
                            <Plus size={15} /> Deploy New Unit
                        </Button>
                    </div>
                </div>

                {isLatencyWarning && (
                    <div className="rounded-xl border border-rose-500/40 bg-rose-950/35 px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
                            <div className="min-w-0">
                                <span className="text-xs font-black uppercase tracking-wider text-rose-300 block">
                                    High Network Latency Warning ({latencySeverity.toUpperCase()})
                                </span>
                                <span className="text-[11px] font-mono text-rose-200/85 block truncate">
                                    {latencyReasons.join(' • ') || 'Elevated latency detected — accidental bot starts are guarded.'}
                                </span>
                            </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-rose-600/80 text-white text-[10px] font-black uppercase tracking-wider flex-shrink-0">
                            {isLatencyGuarded ? 'Start Guard Active' : 'Latency Lag'}
                        </span>
                    </div>
                )}

                <BotLabHeader
                    bots={bots}
                    stats={stats}
                    onOpenCreate={() => setIsCreating(true)}
                    onFleetChanged={() => loadBots(false)}
                />

                {/* Fleet Filter, Sort & View Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl p-2.5">
                    <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
                        <div className="relative flex-1 max-w-xs">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search bot, pair, strategy..."
                                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-lg text-xs text-slate-900 dark:text-white outline-none focus:border-brand-primary"
                            />
                        </div>

                        <div className="flex flex-wrap gap-1">
                            {([
                                { id: 'all', label: 'All' },
                                { id: 'active', label: 'Active' },
                                { id: 'inactive', label: 'Stopped' },
                                { id: 'live', label: 'Live' },
                                { id: 'paper', label: 'Paper' },
                                { id: 'winning', label: 'Winning' },
                                { id: 'losing', label: 'Losing' },
                            ] as const).map((pill) => (
                                <button
                                    key={pill.id}
                                    onClick={() => setStatusFilter(pill.id)}
                                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                                        statusFilter === pill.id
                                            ? 'bg-brand-primary text-white'
                                            : 'bg-slate-100 dark:bg-[#141414] text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {pill.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as any)}
                            className="bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#1F1F1F] rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white outline-none"
                        >
                            <option value="active_first">Sort: Active First</option>
                            <option value="pnl_desc">Sort: Highest PnL</option>
                            <option value="pnl_asc">Sort: Lowest PnL</option>
                            <option value="roi_desc">Sort: Highest ROI %</option>
                            <option value="name">Sort: Name A-Z</option>
                        </select>

                        <div className="flex bg-slate-100 dark:bg-[#111] p-0.5 rounded-lg border border-slate-200 dark:border-[#1F1F1F]">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                                title="Card Grid View"
                            >
                                <LayoutGrid size={14} />
                            </button>
                            <button
                                onClick={() => setViewMode('table')}
                                className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm' : 'text-slate-500'}`}
                                title="Fleet Matrix Table"
                            >
                                <List size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Fleet Display: Grid or High-Density Matrix Table */}
            <div className="px-4 md:px-6 pb-8">
                {viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {filteredBots.map((bot, index) => (
                            <BotCard
                                key={bot.id}
                                bot={bot}
                                index={index}
                                isLoading={backtestingBotId === bot.id}
                                onRunBacktest={handleRunBacktest}
                                onToggleStatus={handleToggleStatus}
                                onDelete={handleDeleteBot}
                                onDetails={setSelectedDetailBot}
                                onSettings={(b) => { setSettingsBot(b); setIsSettingsModalOpen(true); }}
                                onClone={handleCloneBot}
                                onEmergencySell={handleEmergencySell}
                            />
                        ))}

                        {!hasMore && (
                            <button
                                onClick={() => setIsCreating(true)}
                                className="group min-h-[220px] border border-dashed border-slate-300 dark:border-[#262626] hover:border-brand-primary rounded-2xl flex flex-col items-center justify-center text-center hover:bg-brand-primary/5 bg-white/50 dark:bg-[#0A0A0A]/50 transition-all"
                            >
                                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-[#141414] flex items-center justify-center mb-3 group-hover:bg-brand-primary group-hover:text-white text-slate-400 transition-colors">
                                    <Plus size={22} />
                                </div>
                                <h3 className="text-sm font-bold text-slate-500 group-hover:text-brand-primary">Deploy New Unit</h3>
                                <p className="text-xs text-slate-400 mt-1">Configure Spot, Margin, or Futures bot</p>
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] rounded-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs text-left">
                                <thead className="bg-slate-50 dark:bg-[#111] text-slate-500 uppercase text-[10px]">
                                    <tr>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Unit</th>
                                        <th className="px-4 py-3">Mode</th>
                                        <th className="px-4 py-3">Market</th>
                                        <th className="px-4 py-3">Strategy</th>
                                        <th className="px-4 py-3 text-right">Size</th>
                                        <th className="px-4 py-3 text-right">Net PnL</th>
                                        <th className="px-4 py-3 text-right">ROI %</th>
                                        <th className="px-4 py-3 text-right">Win %</th>
                                        <th className="px-4 py-3 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-[#1F1F1F] font-mono">
                                    {filteredBots.map((bot) => {
                                        const roi = Number(bot.pnlPercent ?? bot.pnl_percent ?? 0);
                                        const isPaper = bot.is_paper_trading !== false;
                                        return (
                                            <tr key={bot.id} className="hover:bg-slate-50 dark:hover:bg-[#111] transition-colors">
                                                <td className="px-4 py-2.5">
                                                    <button
                                                        onClick={() => handleToggleStatus(bot.id, bot.status)}
                                                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                            bot.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'
                                                        }`}
                                                    >
                                                        {bot.status === 'active' ? 'ONLINE' : 'OFFLINE'}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-2.5 font-sans font-bold text-slate-900 dark:text-white">{bot.name}</td>
                                                <td className="px-4 py-2.5">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isPaper ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                                                        {isPaper ? 'PAPER' : 'LIVE'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300">
                                                    {bot.market} <span className="text-slate-500">({bot.timeframe || '1h'})</span>
                                                </td>
                                                <td className="px-4 py-2.5 font-sans text-slate-500">{bot.strategy}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-300">${bot.trade_value ?? bot.tradeValue ?? 0}</td>
                                                <td className={`px-4 py-2.5 text-right font-bold ${(bot.pnl ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {(bot.pnl ?? 0) >= 0 ? '+' : '-'}${Math.abs(bot.pnl ?? 0).toFixed(2)}
                                                </td>
                                                <td className={`px-4 py-2.5 text-right font-bold ${roi >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {roi >= 0 ? '+' : ''}{roi.toFixed(2)}%
                                                </td>
                                                <td className="px-4 py-2.5 text-right text-blue-400">{Number(bot.win_rate ?? 0).toFixed(1)}%</td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button onClick={() => setSelectedDetailBot(bot)} className="p-1 text-slate-400 hover:text-blue-400" title="Details"><Activity size={13} /></button>
                                                        <button onClick={() => { setSettingsBot(bot); setIsSettingsModalOpen(true); }} className="p-1 text-slate-400 hover:text-white" title="Settings"><Settings size={13} /></button>
                                                        <button onClick={() => handleCloneBot(bot)} className="p-1 text-slate-400 hover:text-purple-400" title="Clone"><Copy size={13} /></button>
                                                        <button onClick={() => handleRunBacktest(bot)} className="p-1 text-slate-400 hover:text-brand-primary" title="Simulate"><BarChart2 size={13} /></button>
                                                        {bot.status === 'active' && (
                                                            <button onClick={() => handleEmergencySell(bot)} className="p-1 text-amber-400 hover:text-amber-300" title="Emergency Close"><ShieldAlert size={13} /></button>
                                                        )}
                                                        <button onClick={() => handleDeleteBot(bot.id)} className="p-1 text-slate-400 hover:text-rose-400" title="Delete"><Trash2 size={13} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredBots.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-8 text-center text-slate-500 font-sans">
                                                No bots match current search/filter criteria.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {hasMore && (
                    <div className="flex justify-center pt-6">
                        <Button
                            variant="secondary"
                            onClick={() => loadBots(true)}
                            className="px-6 py-2 text-xs flex items-center gap-2"
                        >
                            Load More Bots <ChevronDown size={14} />
                        </Button>
                    </div>
                )}
            </div>

            <BotSettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                bot={settingsBot}
                onUpdate={(bot) => {
                    setBots((prev) => prev.map((b) => (b.id === bot.id ? bot : b)));
                    if (selectedBot?.id === bot.id) setSelectedBot(bot);
                }}
            />
        </div>
    );
};

export default BotLab;
