import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    Tooltip,
    PieChart,
    Pie,
    Cell,
    CartesianGrid,
    XAxis,
    YAxis,
} from 'recharts';
import {
    Activity,
    ArrowUpDown,
    ArrowUpRight,
    CheckCircle2,
    Eye,
    EyeOff,
    KeyRound,
    Layers,
    Link2Off,
    PieChart as PieChartIcon,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    SlidersHorizontal,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Wallet,
    X,
} from 'lucide-react';
import { useMarketStore } from '@/store/marketStore';
import { MOCK_ASSETS, SUPPORTED_EXCHANGES } from '@/constants';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { AppView } from '@/types';
import type { Asset, Exchange } from '@/types';
import { portfolioService } from '@/services/portfolioService';
import { buildAuthenticatedWsUrl } from '@/utils/wsAuth';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { getPathFromView } from '@/utils/routeUtils';
import CoinLogo from '@/components/common/CoinLogo';

const STABLE_COINS = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD']);
const ALLOCATION_COLORS = ['#06B6D4', '#6366F1', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6'];

interface PortfolioBalancesResponse {
    assets: Asset[];
    total_portfolio_value: number;
}

type AssetFilterMode = 'all' | 'spot' | 'stable';
type AssetSortField = 'value' | 'change' | 'price' | 'symbol';
type MacroScenario = 'Normal' | 'Recession' | 'High Inflation' | 'Stagflation';

const getUserCacheScope = (): string => {
    try {
        const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
        if (!token) return 'anon';
        const parts = token.split('.');
        if (parts.length < 2) return 'anon';
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return String(payload?.sub || 'anon');
    } catch {
        return 'anon';
    }
};

const readPortfolioSnapshot = (
    scope: string
): { data: PortfolioBalancesResponse; timestamp: number } | null => {
    try {
        const raw = sessionStorage.getItem(`cosmo_portfolio_v1:${scope}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.data || typeof parsed.timestamp !== 'number') return null;
        if (Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writePortfolioSnapshot = (scope: string, data: PortfolioBalancesResponse): void => {
    try {
        sessionStorage.setItem(
            `cosmo_portfolio_v1:${scope}`,
            JSON.stringify({ data, timestamp: Date.now() })
        );
    } catch {
        // Ignore storage quota errors
    }
};

const formatCurrency = (val: number, maxDecimals = 2): string => {
    const abs = Math.abs(val);
    const formatted = abs.toLocaleString(undefined, {
        minimumFractionDigits: abs >= 1000 ? 0 : Math.min(2, maxDecimals),
        maximumFractionDigits: abs >= 1000 ? 0 : maxDecimals,
    });
    return val < 0 ? `-$${formatted}` : `$${formatted}`;
};

const formatUnitPrice = (price: number): string => {
    if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (price >= 1) return price.toLocaleString(undefined, { maximumFractionDigits: 4 });
    if (price >= 0.001) return price.toLocaleString(undefined, { maximumFractionDigits: 5 });
    return price.toLocaleString(undefined, { maximumFractionDigits: 7 });
};

/**
 * Deterministic 12-month scenario stress test factoring both macro regime and user risk tolerance.
 */
const generateSimulationData = (
    baseValue: number,
    scenario: MacroScenario,
    riskTolerance: number
) => {
    const months = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12'];
    const startVal = baseValue > 0 ? baseValue : 25000;
    const riskBeta = 0.45 + (riskTolerance / 100) * 1.1; // 0.45x conservative -> 1.55x aggressive

    const regimeConfig: Record<MacroScenario, { trend: number; vol: number; wave: number[] }> = {
        Normal: {
            trend: 0.016,
            vol: 0.032,
            wave: [0.4, -0.2, 0.7, 0.3, -0.1, 0.8, 0.5, -0.3, 0.6, 0.4, 0.7, 0.5],
        },
        Recession: {
            trend: -0.028,
            vol: 0.055,
            wave: [-0.6, -0.8, 0.2, -0.7, -0.4, -0.9, 0.1, -0.5, -0.3, 0.2, -0.2, 0.1],
        },
        'High Inflation': {
            trend: 0.007,
            vol: 0.048,
            wave: [0.7, -0.5, 0.6, -0.6, 0.8, -0.4, 0.5, -0.7, 0.6, 0.2, -0.3, 0.5],
        },
        Stagflation: {
            trend: -0.012,
            vol: 0.05,
            wave: [-0.4, 0.2, -0.5, -0.3, 0.1, -0.6, 0.2, -0.4, -0.2, 0.1, -0.3, 0.0],
        },
    };

    const cfg = regimeConfig[scenario];
    let currentValue = startVal;
    const series = [{ month: 'Now', value: Math.round(startVal) }];

    months.forEach((month, idx) => {
        const monthlyReturn = (cfg.trend + cfg.wave[idx] * cfg.vol) * riskBeta;
        currentValue = Math.max(startVal * 0.15, currentValue * (1 + monthlyReturn));
        series.push({ month, value: Math.round(currentValue) });
    });

    return series;
};

const renderBoldInline = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
            return (
                <strong key={idx} className="font-bold text-slate-900 dark:text-white">
                    {part.slice(2, -2)}
                </strong>
            );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
};

const MiniSparkline: React.FC<{ data: { time: string; value: number }[]; color: string }> = ({
    data,
    color,
}) => {
    if (!data || data.length < 2) return null;
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = 96;
    const height = 32;
    const pad = 3;
    const points = values
        .map((v, i) => {
            const x = pad + (i / (values.length - 1)) * (width - pad * 2);
            const y = height - pad - ((v - min) / range) * (height - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

    return (
        <div className="h-8 w-24 inline-flex items-center justify-end">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                />
            </svg>
        </div>
    );
};

interface ConnectExchangeModalProps {
    isOpen: boolean;
    onClose: () => void;
    exchanges: Exchange[];
    onConnect: (
        exchangeId: string,
        apiKey: string,
        secretKey: string,
        passphrase?: string
    ) => Promise<void>;
    onDisconnect: (exchangeId: string) => Promise<void>;
    isThermalGuard: boolean;
}

const ConnectExchangeModal: React.FC<ConnectExchangeModalProps> = ({
    isOpen,
    onClose,
    exchanges,
    onConnect,
    onDisconnect,
    isThermalGuard,
}) => {
    const [selectedExchange, setSelectedExchange] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [secretKey, setSecretKey] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleSubmit = async (id: string) => {
        setIsSaving(true);
        try {
            await onConnect(id, apiKey, secretKey, passphrase);
            setSelectedExchange(null);
            setApiKey('');
            setSecretKey('');
            setPassphrase('');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 ${
                isThermalGuard ? '' : 'backdrop-blur-md'
            }`}
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-xl rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/30 shadow-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400" />
                <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300">
                            <KeyRound className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                Exchange Data Streams
                            </h2>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                AES-encrypted read & trade API endpoints
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-4 sm:p-5 space-y-2.5 overflow-y-auto max-h-[65vh]">
                    {exchanges.map((exchange) => {
                        const isExpanded = selectedExchange === exchange.id && !exchange.isConnected;
                        const needsPassphrase = ['kucoin', 'okx', 'bitget'].includes(
                            exchange.id.toLowerCase()
                        );
                        return (
                            <div
                                key={exchange.id}
                                className={`rounded-xl border p-3.5 transition-colors ${
                                    isExpanded
                                        ? 'bg-cyan-500/5 border-cyan-500/45'
                                        : 'bg-slate-50 dark:bg-[#0b101d] border-slate-200 dark:border-white/10'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span
                                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                                exchange.isConnected
                                                    ? 'bg-emerald-500'
                                                    : 'bg-slate-300 dark:bg-gray-600'
                                            }`}
                                        />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">
                                                    {exchange.name}
                                                </span>
                                                {exchange.isConnected && (
                                                    <span className="text-[9.5px] px-1.5 py-0.5 rounded font-mono font-bold uppercase bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                                                        Connected
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                                {exchange.isConnected
                                                    ? 'Streaming live balances & valuation'
                                                    : 'Read-only or Trade API supported'}
                                            </span>
                                        </div>
                                    </div>

                                    {exchange.isConnected ? (
                                        <button
                                            type="button"
                                            onClick={() => onDisconnect(exchange.id)}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500 border border-rose-500/35 text-rose-600 dark:text-rose-300 hover:text-white text-xs font-mono font-bold transition-colors cursor-pointer shrink-0"
                                        >
                                            <Link2Off className="w-3.5 h-3.5" />
                                            Disconnect
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setSelectedExchange(
                                                    selectedExchange === exchange.id ? null : exchange.id
                                                )
                                            }
                                            className="px-3 py-1.5 rounded-lg bg-slate-200/80 dark:bg-white/10 hover:bg-cyan-500 hover:text-slate-950 text-slate-800 dark:text-white text-xs font-mono font-bold transition-colors cursor-pointer shrink-0"
                                        >
                                            {isExpanded ? 'Cancel' : 'Connect'}
                                        </button>
                                    )}
                                </div>

                                {isExpanded && (
                                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/10 space-y-2.5">
                                        <input
                                            type="text"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="Public API Key"
                                            className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-white outline-none"
                                        />
                                        <input
                                            type="password"
                                            value={secretKey}
                                            onChange={(e) => setSecretKey(e.target.value)}
                                            placeholder="Private Secret Key"
                                            className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-white outline-none"
                                        />
                                        {needsPassphrase && (
                                            <input
                                                type="password"
                                                value={passphrase}
                                                onChange={(e) => setPassphrase(e.target.value)}
                                                placeholder="API Passphrase (Required for KuCoin / OKX / Bitget)"
                                                className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 dark:text-white outline-none"
                                            />
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleSubmit(exchange.id)}
                                            disabled={!apiKey || !secretKey || isSaving}
                                            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 disabled:opacity-50 text-white text-xs font-mono font-black uppercase tracking-wider cursor-pointer transition-all"
                                        >
                                            {isSaving ? 'Establishing Handshake...' : 'Establish Encrypted Stream'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const PortfolioTracker: React.FC = () => {
    const navigate = useNavigate();
    const { theme } = useTheme();
    const { showToast } = useToast();
    const queryClient = useQueryClient();
    const { activeMarket, setGlobalSymbol, setGlobalExchange } = useMarketStore();
    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const isThermalGuard = deviceProfile.isThermalGuardActive;

    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [chartScope, setChartScope] = useState<'portfolio' | 'asset'>('portfolio');
    const [riskTolerance, setRiskTolerance] = useState(65);
    const [scenario, setScenario] = useState<MacroScenario>('Normal');
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [recommendations, setRecommendations] = useState<string[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [livePrices, setLivePrices] = useState<Record<string, number>>({});
    const [isForceRefreshing, setIsForceRefreshing] = useState(false);
    const [wsStatus, setWsStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');

    // Holdings search / filter / sort controls
    const [searchQuery, setSearchQuery] = useState('');
    const [assetFilter, setAssetFilter] = useState<AssetFilterMode>('all');
    const [hideDust, setHideDust] = useState(true);
    const [sortField, setSortField] = useState<AssetSortField>('value');
    const [sortDesc, setSortDesc] = useState(true);
    const [showAllHoldings, setShowAllHoldings] = useState(false);

    const userScope = useMemo(() => getUserCacheScope(), []);
    const wasMarkedDirty = useMemo(() => {
        try {
            if (sessionStorage.getItem('cosmo_portfolio_dirty') === '1') {
                sessionStorage.removeItem('cosmo_portfolio_dirty');
                return true;
            }
        } catch {
            // Ignore
        }
        return false;
    }, []);
    const initialSnapshot = useMemo(
        () => (wasMarkedDirty ? null : readPortfolioSnapshot(userScope)),
        [userScope, wasMarkedDirty]
    );

    const apiKeysQuery = useQuery({
        queryKey: ['portfolio', 'apiKeys', userScope],
        queryFn: portfolioService.fetchApiKeys,
        staleTime: wasMarkedDirty ? 0 : 60_000,
        gcTime: 15 * 60_000,
        refetchOnWindowFocus: false,
    });

    const balancesQuery = useQuery({
        queryKey: ['portfolio', 'balances', userScope],
        queryFn: async () => {
            const res = await portfolioService.fetchBalances(wasMarkedDirty);
            writePortfolioSnapshot(userScope, res);
            return res;
        },
        initialData: initialSnapshot?.data,
        initialDataUpdatedAt: initialSnapshot?.timestamp,
        staleTime: wasMarkedDirty ? 0 : 30_000,
        gcTime: 15 * 60_000,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (wasMarkedDirty) {
            queryClient.invalidateQueries({ queryKey: ['portfolio', 'apiKeys', userScope] });
            queryClient.invalidateQueries({ queryKey: ['portfolio', 'balances', userScope] });
        }
    }, [wasMarkedDirty, queryClient, userScope]);

    useEffect(() => {
        if (balancesQuery.isError && !balancesQuery.data) {
            showToast('Failed to sync data stream', 'error');
        }
    }, [balancesQuery.isError, balancesQuery.data, showToast]);

    const { exchanges, apiKeysMap } = useMemo(() => {
        const keysData = apiKeysQuery.data || [];
        const connectedSet = new Set(keysData.map((k: any) => k.exchange.toLowerCase()));
        const keysMapping: Record<string, number> = {};
        keysData.forEach((k: any) => {
            if (k.id) keysMapping[k.exchange.toLowerCase()] = k.id;
        });

        const updated: Exchange[] = SUPPORTED_EXCHANGES.map((ex) => ({
            ...ex,
            isConnected: connectedSet.has(ex.id.toLowerCase()),
        }));
        keysData.forEach((k: any) => {
            if (!updated.find((ex) => ex.id.toLowerCase() === k.exchange.toLowerCase())) {
                updated.push({
                    id: k.exchange,
                    name: k.exchange.charAt(0).toUpperCase() + k.exchange.slice(1),
                    logo: null,
                    isConnected: true,
                });
            }
        });
        return { exchanges: updated, apiKeysMap: keysMapping };
    }, [apiKeysQuery.data]);

    const connectedExchanges = useMemo(
        () => exchanges.filter((e) => e.isConnected),
        [exchanges]
    );

    const { assets, totalPortfolioValue } = useMemo(() => {
        const rawAssets = balancesQuery.data?.assets || [];
        if (rawAssets.length === 0) {
            return { assets: [] as Asset[], totalPortfolioValue: 0 };
        }
        const hasLiveOverrides = Object.keys(livePrices).length > 0;
        let total = 0;
        const mapped = rawAssets.map((a: Asset) => {
            const liveP = livePrices[a.symbol];
            const hasLive = typeof liveP === 'number' && liveP > 0;
            const price = hasLive ? liveP : a.price;
            const value = hasLive ? price * a.amount : a.value;
            total += value;
            const history =
                hasLive && Array.isArray(a.history) && a.history.length > 0
                    ? [...a.history.slice(0, -1), { ...a.history[a.history.length - 1], value }]
                    : a.history;
            return { ...a, logo: null, price, value, history };
        });
        return {
            assets: mapped,
            totalPortfolioValue: hasLiveOverrides
                ? total
                : balancesQuery.data?.total_portfolio_value ?? total,
        };
    }, [balancesQuery.data, livePrices]);

    const resolvedSelectedAsset = useMemo(() => {
        if (!selectedAsset) return null;
        return assets.find((a) => a.id === selectedAsset.id) || selectedAsset;
    }, [assets, selectedAsset]);

    const isInitialLoading = balancesQuery.isLoading && !balancesQuery.data;
    const isSyncing = balancesQuery.isFetching || isForceRefreshing;

    const subscriptionMap = useMemo(() => {
        const subscriptions: Record<string, string[]> = {};
        const rawAssets = balancesQuery.data?.assets || [];
        rawAssets.forEach((asset: Asset) => {
            if (STABLE_COINS.has(asset.symbol.toUpperCase())) return;
            const ex = (asset.exchange || asset.allocations?.[0]?.exchange)?.toLowerCase();
            if (!ex) return;
            if (!subscriptions[ex]) subscriptions[ex] = [];
            const pair = `${asset.symbol}/USDT`;
            if (!subscriptions[ex].includes(pair)) {
                subscriptions[ex].push(pair);
            }
        });
        return subscriptions;
    }, [balancesQuery.data?.assets]);

    const subscriptionKey = useMemo(() => JSON.stringify(subscriptionMap), [subscriptionMap]);

    // Real-time WebSocket prices
    useEffect(() => {
        const parsedSubs: Record<string, string[]> = JSON.parse(subscriptionKey);
        if (Object.keys(parsedSubs).length === 0) {
            setWsStatus(connectedExchanges.length > 0 ? 'live' : 'offline');
            return;
        }

        let cancelled = false;
        let socket: WebSocket | null = null;
        setWsStatus('connecting');

        (async () => {
            const wsUrl = await buildAuthenticatedWsUrl('/api/v1/portfolio/ws/prices');
            if (!wsUrl || cancelled) return;

            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                if (!cancelled) setWsStatus('live');
                socket?.send(JSON.stringify({ action: 'subscribe', exchanges: parsedSubs }));
            };

            socket.onclose = () => {
                if (!cancelled) setWsStatus('offline');
            };

            socket.onerror = () => {
                if (!cancelled) setWsStatus('offline');
            };

            socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'portfolio_price_update' && data.prices) {
                        const priceUpdates = data.prices as Record<string, { price?: number }>;
                        const nextOverrides: Record<string, number> = {};
                        Object.entries(priceUpdates).forEach(([pairOrSym, info]) => {
                            if (typeof info?.price === 'number' && info.price > 0) {
                                const baseSym = pairOrSym.includes('/')
                                    ? pairOrSym.split('/')[0]
                                    : pairOrSym;
                                nextOverrides[baseSym] = info.price;
                            }
                        });
                        if (Object.keys(nextOverrides).length > 0) {
                            setLivePrices((prev) => ({ ...prev, ...nextOverrides }));
                        }
                    }
                } catch (err) {
                    console.error('WS Message Parse Error:', err);
                }
            };
        })();

        return () => {
            cancelled = true;
            socket?.close();
        };
    }, [subscriptionKey, connectedExchanges.length]);

    const refreshPortfolio = useCallback(
        async (force = true) => {
            setIsForceRefreshing(true);
            try {
                const [_, freshBalances] = await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['portfolio', 'apiKeys', userScope] }),
                    portfolioService.fetchBalances(force),
                ]);
                setLivePrices({});
                writePortfolioSnapshot(userScope, freshBalances);
                queryClient.setQueryData(['portfolio', 'balances', userScope], freshBalances);
            } catch (error) {
                console.error('Error refreshing portfolio:', error);
                showToast('Failed to sync data stream', 'error');
            } finally {
                setIsForceRefreshing(false);
            }
        },
        [queryClient, userScope, showToast]
    );

    const handleConnect = async (
        exchangeId: string,
        apiKey: string,
        secretKey: string,
        passphrase?: string
    ) => {
        try {
            await portfolioService.addApiKey({
                name: `${exchangeId} Stream`,
                exchange: exchangeId,
                api_key: apiKey,
                secret_key: secretKey,
                passphrase,
            });
            showToast(`Encrypted connection to ${exchangeId} established`, 'success');
            await refreshPortfolio(true);
        } catch {
            showToast(`Connection to ${exchangeId} rejected`, 'error');
        }
    };

    const handleDisconnect = async (exchangeId: string) => {
        try {
            const keyId = apiKeysMap[exchangeId.toLowerCase()];
            if (keyId) {
                await portfolioService.deleteApiKey(keyId);
                showToast(`Session terminated for ${exchangeId}`, 'success');
                await refreshPortfolio(true);
            }
        } catch {
            showToast('Termination failed', 'error');
        }
    };

    // Core KPI Analytics
    const { portfolio24hChange, portfolio24hChangePercent, stablecoinUsd, stablecoinPct, topHolding } =
        useMemo(() => {
            const total24hAgo = assets.reduce(
                (sum, a) => sum + (a.price24h || a.price || 0) * (a.amount || 0),
                0
            );
            const change = totalPortfolioValue - total24hAgo;
            const pct = total24hAgo > 0 ? (change / total24hAgo) * 100 : 0;
            const stables = assets
                .filter((a) => STABLE_COINS.has(a.symbol.toUpperCase()))
                .reduce((sum, a) => sum + (a.value || 0), 0);
            const stableShare = totalPortfolioValue > 0 ? (stables / totalPortfolioValue) * 100 : 0;
            const sortedByVal = [...assets].sort((a, b) => (b.value || 0) - (a.value || 0));
            return {
                portfolio24hChange: change,
                portfolio24hChangePercent: pct,
                stablecoinUsd: stables,
                stablecoinPct: stableShare,
                topHolding: sortedByVal[0] || null,
            };
        }, [assets, totalPortfolioValue]);

    // Aggregated 24h Portfolio Trajectory vs Selected Asset Trajectory
    const trajectorySeries = useMemo(() => {
        if (chartScope === 'asset' && resolvedSelectedAsset?.history?.length) {
            return resolvedSelectedAsset.history.map((pt) => ({
                time: pt.time,
                value: Number(pt.value.toFixed(2)),
            }));
        }
        if (assets.length === 0) return [];
        const total24hAgo = assets.reduce(
            (sum, a) => sum + (a.price24h || a.price || 0) * (a.amount || 0),
            0
        );
        const midVal = (total24hAgo + totalPortfolioValue) / 2;
        return [
            { time: '24h Ago', value: Number(total24hAgo.toFixed(2)) },
            { time: '12h Ago', value: Number(midVal.toFixed(2)) },
            { time: 'Live', value: Number(totalPortfolioValue.toFixed(2)) },
        ];
    }, [assets, resolvedSelectedAsset, chartScope, totalPortfolioValue]);

    // Donut allocation (Top 5 + Others bucket)
    const allocationData = useMemo(() => {
        const positive = assets
            .filter((a) => (a.value || 0) > 0)
            .sort((a, b) => b.value - a.value);
        if (positive.length === 0) return [];
        if (positive.length <= 5) {
            return positive.map((a) => ({ name: a.symbol, value: a.value }));
        }
        const topFive = positive.slice(0, 5).map((a) => ({ name: a.symbol, value: a.value }));
        const otherSum = positive.slice(5).reduce((sum, a) => sum + a.value, 0);
        if (otherSum > 0) {
            topFive.push({ name: 'OTHERS', value: otherSum });
        }
        return topFive;
    }, [assets]);

    // Filtered & Sorted Inventory Rows
    const { visibleAssets, totalFilteredCount, dustHiddenCount } = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        let dustRemoved = 0;

        const filtered = assets.filter((asset) => {
            const symUpper = asset.symbol.toUpperCase();
            const isStable = STABLE_COINS.has(symUpper);

            if (assetFilter === 'stable' && !isStable) return false;
            if (assetFilter === 'spot' && isStable) return false;

            if (hideDust && (asset.value || 0) < 1) {
                dustRemoved += 1;
                return false;
            }

            if (q) {
                const matchSym = symUpper.toLowerCase().includes(q);
                const matchName = (asset.name || '').toLowerCase().includes(q);
                const matchEx = (asset.exchange || '').toLowerCase().includes(q) ||
                    Boolean(asset.allocations?.some((al) => al.exchange.toLowerCase().includes(q)));
                if (!matchSym && !matchName && !matchEx) return false;
            }

            return true;
        });

        filtered.sort((a, b) => {
            const dir = sortDesc ? -1 : 1;
            if (sortField === 'symbol') return a.symbol.localeCompare(b.symbol) * -dir;
            if (sortField === 'price') return ((a.price || 0) - (b.price || 0)) * dir;
            if (sortField === 'change') {
                const cA = a.price24h ? ((a.price - a.price24h) / a.price24h) * 100 : 0;
                const cB = b.price24h ? ((b.price - b.price24h) / b.price24h) * 100 : 0;
                return (cA - cB) * dir;
            }
            return ((a.value || 0) - (b.value || 0)) * dir;
        });

        const rowCap = isThermalGuard && !showAllHoldings ? 25 : showAllHoldings ? filtered.length : 50;
        return {
            visibleAssets: filtered.slice(0, rowCap),
            totalFilteredCount: filtered.length,
            dustHiddenCount: dustRemoved,
        };
    }, [assets, searchQuery, assetFilter, hideDust, sortField, sortDesc, isThermalGuard, showAllHoldings]);

    const toggleSort = (field: AssetSortField) => {
        if (sortField === field) {
            setSortDesc((d) => !d);
        } else {
            setSortField(field);
            setSortDesc(true);
        }
    };

    const handleTradeAsset = useCallback(
        (asset: Asset) => {
            const targetSymbol = STABLE_COINS.has(asset.symbol.toUpperCase())
                ? 'BTC/USDT'
                : `${asset.symbol.toUpperCase()}/USDT`;
            setGlobalSymbol(targetSymbol);
            const targetEx = (asset.exchange || asset.allocations?.[0]?.exchange || '').toLowerCase();
            if (targetEx) setGlobalExchange(targetEx);
            navigate(getPathFromView(AppView.MARKET));
        },
        [setGlobalSymbol, setGlobalExchange, navigate]
    );

    const simulationData = useMemo(() => {
        const simBase =
            totalPortfolioValue > 0
                ? totalPortfolioValue
                : (MOCK_ASSETS as Asset[]).reduce((s, a) => s + (a.value || 0), 0);
        return generateSimulationData(simBase, scenario, riskTolerance);
    }, [totalPortfolioValue, scenario, riskTolerance]);

    const simulationResult = useMemo(() => {
        const startValue = simulationData[0]?.value || 1;
        const endValue = simulationData[simulationData.length - 1]?.value || startValue;
        const minValue = Math.min(...simulationData.map((d) => d.value));
        return {
            projectedReturn: ((endValue - startValue) / startValue) * 100,
            projectedFinalUsd: endValue,
            maxDrawdown: ((startValue - minValue) / startValue) * 100,
        };
    }, [simulationData]);

    const handleOptimize = useCallback(async () => {
        setIsOptimizing(true);
        setRecommendations([]);
        const riskProfile =
            riskTolerance < 33 ? 'Conservative' : riskTolerance > 66 ? 'Aggressive' : 'Moderate';
        const portfolioString = assets
            .slice(0, 12)
            .map(
                (a) =>
                    `${a.symbol}: ${
                        totalPortfolioValue > 0
                            ? ((a.value / totalPortfolioValue) * 100).toFixed(1)
                            : '0.0'
                    }%`
            )
            .join(', ');

        const prompt = `Analyze crypto portfolio: ${portfolioString}. Risk Profile: ${riskProfile}. Provide 3 concise, actionable portfolio optimization & hedging steps. Keep it professional.`;
        try {
            const { GoogleGenAI } = await import('@google/genai');
            const apiKey = (import.meta.env.VITE_API_KEY as string) || '';
            if (!apiKey) {
                throw new Error('Missing Gemini API key');
            }
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: prompt,
            });
            const lines = (response.text || '')
                .split(/\n+/)
                .map((s) => s.replace(/^[\s\-*\d.)]+/, '').trim())
                .filter((s) => s.length > 10)
                .slice(0, 4);
            setRecommendations(
                lines.length > 0
                    ? lines
                    : ['**Rebalance Check:** Keep single-asset spot concentration below 35% of equity.']
            );
            showToast('AI Synthesis complete', 'success');
        } catch {
            // Deterministic local quantitative fallback when Gemini browser key isn't configured
            const fallbackTips: string[] = [];
            if (topHolding && totalPortfolioValue > 0) {
                const topWeight = (topHolding.value / totalPortfolioValue) * 100;
                if (topWeight > 45 && !STABLE_COINS.has(topHolding.symbol.toUpperCase())) {
                    fallbackTips.push(
                        `**Concentration Alert (${topHolding.symbol} ${topWeight.toFixed(
                            1
                        )}%):** Consider trimming excess exposure or arming Auto-Breakeven SL to cap single-coin beta.`
                    );
                }
            }
            if (stablecoinPct < 15) {
                fallbackTips.push(
                    `**Low Dry Powder (${stablecoinPct.toFixed(
                        1
                    )}% Stables):** Target 15â€“25% USDT/USDC reserve for dip entries and futures margin buffer.`
                );
            } else {
                fallbackTips.push(
                    `**Liquidity Buffer (${stablecoinPct.toFixed(
                        1
                    )}% Stables):** Capital reserve is healthy (${formatCurrency(
                        stablecoinUsd,
                        0
                    )}) for asymmetric SmartPeg liquidity wall setups.`
                );
            }
            fallbackTips.push(
                `**${riskProfile} Posture (${scenario} Regime):** Maintain max per-trade risk â‰¤ ${
                    riskTolerance < 33 ? '0.5%' : riskTolerance > 66 ? '1.5%' : '1.0%'
                } with 1:2 minimum R:R brackets.`
            );
            setRecommendations(fallbackTips);
            showToast('Quantitative portfolio diagnostics generated', 'info');
        } finally {
            setIsOptimizing(false);
        }
    }, [
        assets,
        riskTolerance,
        totalPortfolioValue,
        showToast,
        topHolding,
        stablecoinPct,
        stablecoinUsd,
        scenario,
    ]);

    const axisColor = theme === 'dark' ? '#94A3B8' : '#64748B';
    const gridColor = theme === 'dark' ? 'rgba(148,163,184,0.12)' : '#E2E8F0';
    const tooltipStyle =
        theme === 'dark'
            ? {
                  backgroundColor: '#0a101d',
                  border: '1px solid rgba(6, 182, 212, 0.35)',
                  borderRadius: '12px',
                  color: '#F8FAFC',
                  fontSize: '12px',
              }
            : {
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  borderRadius: '12px',
                  color: '#0F172A',
                  fontSize: '12px',
              };

    const topHoldingPct =
        topHolding && totalPortfolioValue > 0 ? (topHolding.value / totalPortfolioValue) * 100 : 0;

    return (
        <div className={`${isPhoneMobileUI ? 'space-y-3.5' : 'space-y-5'} pb-8 overflow-x-hidden`}>
            <ConnectExchangeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                exchanges={exchanges}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                isThermalGuard={isThermalGuard}
            />

            {/* â”€â”€ Top SaaS Portfolio Command Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/25 p-4 lg:p-5 shadow-sm dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] overflow-hidden">
                <div className="h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-85" />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-mono font-black uppercase tracking-wider ${
                                    wsStatus === 'live'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                        : wsStatus === 'connecting'
                                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                                          : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400'
                                }`}
                            >
                                <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                        wsStatus === 'live'
                                            ? 'bg-emerald-500'
                                            : wsStatus === 'connecting'
                                              ? 'bg-amber-400'
                                              : 'bg-slate-400'
                                    } ${!isThermalGuard && wsStatus === 'live' ? 'animate-pulse' : ''}`}
                                />
                                {wsStatus === 'live'
                                    ? 'Live Prices'
                                    : wsStatus === 'connecting'
                                      ? 'Connecting'
                                      : 'Standby'}
                            </span>

                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 text-[10px] font-mono font-bold uppercase">
                                <ShieldCheck className="w-3 h-3" />
                                {connectedExchanges.length} Exchange{' '}
                                {connectedExchanges.length === 1 ? 'Stream' : 'Streams'}
                            </span>

                            <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                {assets.length} Tracked Assets
                            </span>
                        </div>

                        <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                            Portfolio &amp; Treasury Command
                        </h1>
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-gray-400">
                            Cross-exchange net worth, stablecoin liquidity reserves, allocation telemetry &amp; stress simulation.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => refreshPortfolio(true)}
                            disabled={isSyncing}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#0a101d] hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-200 text-xs font-mono font-bold transition-colors cursor-pointer disabled:opacity-50"
                            title="Force-sync exchange balances"
                        >
                            <RefreshCw
                                className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-cyan-500' : ''}`}
                            />
                            <span>{isSyncing ? 'Syncing...' : 'Sync Balances'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white text-xs font-mono font-black uppercase tracking-wider shadow-[0_4px_14px_rgba(6,182,212,0.28)] transition-all cursor-pointer active:scale-95"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Connect Exchange</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* â”€â”€ Row 1: 4 SaaS KPI Cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div
                className={`grid ${
                    isPhoneMobileUI
                        ? 'grid-cols-2 gap-2.5'
                        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
                }`}
            >
                {/* KPI 1: Net Equity */}
                <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 overflow-hidden shadow-sm">
                    <div className="h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-85" />
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                                Net Portfolio Value
                            </p>
                            {isInitialLoading ? (
                                <div className="h-7 w-28 mt-1.5 rounded bg-slate-200 dark:bg-white/10" />
                            ) : (
                                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono mt-1 truncate">
                                    {formatCurrency(totalPortfolioValue, 0)}
                                </h3>
                            )}
                            <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400 mt-1 block">
                                {assets.length} holdings across {connectedExchanges.length || 0} streams
                            </span>
                        </div>
                        <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/25 text-cyan-600 dark:text-cyan-300 shrink-0">
                            <Wallet className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                {/* KPI 2: 24h Delta */}
                <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 overflow-hidden shadow-sm">
                    <div
                        className={`h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r ${
                            portfolio24hChange >= 0
                                ? 'from-emerald-400 to-teal-500'
                                : 'from-rose-400 to-red-500'
                        } opacity-85`}
                    />
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                                24h Net Change
                            </p>
                            <h3
                                className={`text-xl sm:text-2xl font-black font-mono mt-1 truncate ${
                                    portfolio24hChange >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {portfolio24hChange >= 0 ? '+' : ''}
                                {formatCurrency(portfolio24hChange, 0)}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold border ${
                                        portfolio24hChange >= 0
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                            : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                                    }`}
                                >
                                    {portfolio24hChange >= 0 ? 'â–²' : 'â–¼'}{' '}
                                    {Math.abs(portfolio24hChangePercent).toFixed(2)}%
                                </span>
                                {activeMarket === 'forex' && (
                                    <span className="text-[10px] font-mono text-slate-500 dark:text-gray-400">
                                        ({Math.abs(portfolio24hChange * 0.1).toFixed(0)} Pips)
                                    </span>
                                )}
                            </div>
                        </div>
                        <div
                            className={`p-2 rounded-xl border shrink-0 ${
                                portfolio24hChange >= 0
                                    ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-600 dark:text-emerald-300'
                                    : 'bg-rose-500/15 border-rose-500/25 text-rose-600 dark:text-rose-300'
                            }`}
                        >
                            {portfolio24hChange >= 0 ? (
                                <TrendingUp className="w-4 h-4" />
                            ) : (
                                <TrendingDown className="w-4 h-4" />
                            )}
                        </div>
                    </div>
                </div>

                {/* KPI 3: Dry Powder / Stablecoin Reserve */}
                <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 overflow-hidden shadow-sm">
                    <div className="h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r from-indigo-400 to-blue-500 opacity-85" />
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                                Stablecoin Reserve
                            </p>
                            <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono mt-1 truncate">
                                {formatCurrency(stablecoinUsd, 0)}
                            </h3>
                            <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-300 font-bold mt-1 block">
                                {stablecoinPct.toFixed(1)}% dry powder
                            </span>
                        </div>
                        <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/25 text-indigo-600 dark:text-indigo-300 shrink-0">
                            <Layers className="w-4 h-4" />
                        </div>
                    </div>
                </div>

                {/* KPI 4: Top Holding */}
                <div className="relative rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 overflow-hidden shadow-sm">
                    <div className="h-[2px] w-full absolute top-0 left-0 bg-gradient-to-r from-purple-400 to-fuchsia-500 opacity-85" />
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10.5px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                                Top Concentration
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                {topHolding && (
                                    <CoinLogo symbol={topHolding.symbol} className="w-5 h-5 shrink-0" />
                                )}
                                <h3 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono truncate">
                                    {topHolding ? topHolding.symbol : '--'}
                                </h3>
                            </div>
                            <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400 mt-1 block">
                                {topHolding
                                    ? `${topHoldingPct.toFixed(1)}% (${formatCurrency(topHolding.value, 0)})`
                                    : 'No active position'}
                            </span>
                        </div>
                        <div className="p-2 rounded-xl bg-purple-500/15 border border-purple-500/25 text-purple-600 dark:text-purple-300 shrink-0">
                            <PieChartIcon className="w-4 h-4" />
                        </div>
                    </div>
                </div>
            </div>

            {/* â”€â”€ Row 2: Trajectory Chart + Asset Weighting Donut â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                {/* Trajectory Chart */}
                <div className="xl:col-span-8 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm flex flex-col">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-2">
                                <Activity className="w-4 h-4 text-cyan-500" />
                                <span>
                                    {chartScope === 'asset' && resolvedSelectedAsset
                                        ? `${resolvedSelectedAsset.symbol} 24h Holding Curve`
                                        : '24h Portfolio Valuation Trajectory'}
                                </span>
                            </h2>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400 mt-0.5">
                                {chartScope === 'asset' && resolvedSelectedAsset
                                    ? `Position value: ${formatCurrency(resolvedSelectedAsset.value)}`
                                    : 'Aggregated equity curve across all connected venues'}
                            </p>
                        </div>

                        <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#0b101d] p-1 rounded-xl border border-slate-200 dark:border-white/10 self-start sm:self-auto">
                            <button
                                type="button"
                                onClick={() => setChartScope('portfolio')}
                                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                                    chartScope === 'portfolio'
                                        ? 'bg-cyan-500 text-slate-950'
                                        : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                All Portfolio
                            </button>
                            <button
                                type="button"
                                disabled={!resolvedSelectedAsset}
                                onClick={() => setChartScope('asset')}
                                className={`px-2.5 py-1 rounded-lg text-[10.5px] font-mono font-bold transition-colors ${
                                    !resolvedSelectedAsset
                                        ? 'opacity-40 cursor-not-allowed text-slate-400'
                                        : chartScope === 'asset'
                                          ? 'bg-cyan-500 text-slate-950 cursor-pointer'
                                          : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white cursor-pointer'
                                }`}
                            >
                                {resolvedSelectedAsset ? resolvedSelectedAsset.symbol : 'Select Coin'}
                            </button>
                        </div>
                    </div>

                    <div className="h-[250px] sm:h-[280px] w-full flex-1">
                        {trajectorySeries.length > 0 ? (
                            <ResponsiveContainer debounce={220} width="100%" height="100%">
                                <AreaChart
                                    data={trajectorySeries}
                                    margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="portfolioAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.28} />
                                            <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                                    <XAxis
                                        dataKey="time"
                                        tick={{ fill: axisColor, fontSize: 11 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fill: axisColor, fontSize: 11 }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={62}
                                        tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                                        domain={['auto', 'auto']}
                                    />
                                    <Tooltip
                                        contentStyle={tooltipStyle}
                                        formatter={(val: any) => [formatCurrency(Number(val)), 'Equity']}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="value"
                                        stroke="#06B6D4"
                                        strokeWidth={2.5}
                                        fill="url(#portfolioAreaGrad)"
                                        isAnimationActive={!isThermalGuard}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 text-center p-6 gap-2">
                                <p className="text-xs font-mono font-bold text-slate-400 dark:text-gray-500">
                                    {isInitialLoading
                                        ? 'Synchronizing portfolio valuation curve...'
                                        : 'Connect an exchange API key to visualize live equity'}
                                </p>
                                {!isInitialLoading && (
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(true)}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-600 dark:text-cyan-300 text-xs font-mono font-bold cursor-pointer"
                                    >
                                        + Connect First Exchange
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Asset Allocation Card */}
                <div className="xl:col-span-4 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                            Asset Allocation
                        </h2>
                        <span className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                            Top {allocationData.length}
                        </span>
                    </div>

                    <div className="h-[190px] w-full">
                        {allocationData.length > 0 ? (
                            <ResponsiveContainer debounce={220} width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={allocationData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={56}
                                        outerRadius={80}
                                        paddingAngle={4}
                                        dataKey="value"
                                        isAnimationActive={!isThermalGuard}
                                    >
                                        {allocationData.map((_, i) => (
                                            <Cell
                                                key={`alloc-${i}`}
                                                fill={ALLOCATION_COLORS[i % ALLOCATION_COLORS.length]}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={tooltipStyle}
                                        formatter={(val: any) => [formatCurrency(Number(val)), 'Value']}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-xs font-mono text-slate-400 dark:text-gray-500">
                                Zero holdings detected
                            </div>
                        )}
                    </div>

                    <div className="mt-2 space-y-2">
                        {allocationData.map((entry, idx) => {
                            const pct =
                                totalPortfolioValue > 0
                                    ? (entry.value / totalPortfolioValue) * 100
                                    : 0;
                            const color = ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length];
                            return (
                                <div key={entry.name} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs font-mono">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span
                                                className="w-2 h-2 rounded-full shrink-0"
                                                style={{ backgroundColor: color }}
                                            />
                                            {entry.name !== 'OTHERS' && (
                                                <CoinLogo symbol={entry.name} className="w-4 h-4 shrink-0" />
                                            )}
                                            <span className="font-bold text-slate-800 dark:text-gray-200 truncate">
                                                {entry.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-[11px] text-slate-500 dark:text-gray-400">
                                                {formatCurrency(entry.value, 0)}
                                            </span>
                                            <span className="font-black text-slate-900 dark:text-white w-11 text-right">
                                                {pct.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                                        <div
                                            className="h-full rounded-full"
                                            style={{
                                                width: `${Math.min(100, Math.max(2, pct))}%`,
                                                backgroundColor: color,
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* â”€â”€ Row 3: Connected Exchange Channels Strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10.5px] font-mono font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 mr-1">
                        Active Venues:
                    </span>
                    {connectedExchanges.length > 0 ? (
                        connectedExchanges.map((ex) => (
                            <span
                                key={ex.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-mono font-bold uppercase"
                            >
                                <CheckCircle2 className="w-3 h-3" />
                                {ex.name}
                            </span>
                        ))
                    ) : (
                        <span className="text-xs font-mono text-slate-400 dark:text-gray-500">
                            No active API streams configured
                        </span>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                >
                    Manage Streams â†’
                </button>
            </div>

            {/* â”€â”€ Row 4: Holdings Inventory Matrix â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
                {/* Smart Search & Filter Header */}
                <div className="p-4 lg:p-5 border-b border-slate-200 dark:border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                            Holdings Inventory
                        </h2>
                        <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400 mt-0.5">
                            Showing {visibleAssets.length} of {totalFilteredCount} positions
                            {dustHiddenCount > 0 ? ` (${dustHiddenCount} dust <$1 hidden)` : ''}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Search Box */}
                        <div className="relative flex-1 sm:flex-none sm:w-52">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Filter coin or exchange..."
                                className="w-full bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10 focus:border-cyan-400 rounded-xl pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 dark:text-white outline-none"
                            />
                        </div>

                        {/* Filter Tabs */}
                        <div className="flex bg-slate-100 dark:bg-[#0b101d] rounded-xl border border-slate-200 dark:border-white/10 p-0.5 text-[11px] font-mono font-bold">
                            {(
                                [
                                    { key: 'all', label: 'All' },
                                    { key: 'spot', label: 'Coins' },
                                    { key: 'stable', label: 'Stables' },
                                ] as const
                            ).map((tab) => (
                                <button
                                    key={tab.key}
                                    type="button"
                                    onClick={() => setAssetFilter(tab.key)}
                                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                                        assetFilter === tab.key
                                            ? 'bg-cyan-500 text-slate-950'
                                            : 'text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Hide Dust Toggle */}
                        <button
                            type="button"
                            onClick={() => setHideDust((d) => !d)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-mono font-bold cursor-pointer transition-colors ${
                                hideDust
                                    ? 'bg-cyan-500/15 border-cyan-500/35 text-cyan-700 dark:text-cyan-300'
                                    : 'bg-slate-50 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400'
                            }`}
                            title="Hide tiny balances under $1.00"
                        >
                            {hideDust ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            <span>Hide Dust</span>
                        </button>
                    </div>
                </div>

                {/* Desktop/Tablet Table vs Phone Card Layout */}
                {isPhoneMobileUI ? (
                    <div className="divide-y divide-slate-200 dark:divide-white/5">
                        {isInitialLoading && assets.length === 0 && (
                            <div className="p-6 text-center text-xs font-mono text-slate-400">
                                Loading live holdings...
                            </div>
                        )}
                        {!isInitialLoading && visibleAssets.length === 0 && (
                            <div className="p-8 text-center space-y-2.5">
                                <p className="text-xs font-mono text-slate-400 dark:text-gray-500">
                                    No holdings match your current filter.
                                </p>
                                {hideDust && dustHiddenCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setHideDust(false)}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-xs font-mono font-bold cursor-pointer"
                                    >
                                        Show {dustHiddenCount} Dust Asset{dustHiddenCount === 1 ? '' : 's'} (&lt;$1)
                                    </button>
                                )}
                            </div>
                        )}
                        {visibleAssets.map((asset) => {
                            const change24h = asset.price24h
                                ? ((asset.price - asset.price24h) / asset.price24h) * 100
                                : 0;
                            const weightPct =
                                totalPortfolioValue > 0
                                    ? (asset.value / totalPortfolioValue) * 100
                                    : 0;
                            const isSelected = selectedAsset?.id === asset.id;

                            return (
                                <div
                                    key={asset.id}
                                    onClick={() => {
                                        setSelectedAsset(asset);
                                        setChartScope('asset');
                                    }}
                                    className={`p-3.5 space-y-2.5 cursor-pointer transition-colors ${
                                        isSelected ? 'bg-cyan-500/5' : ''
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <CoinLogo symbol={asset.symbol} className="w-7 h-7 shrink-0" />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-sm font-black text-slate-900 dark:text-white uppercase">
                                                        {asset.symbol}
                                                    </span>
                                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-gray-300 font-mono">
                                                        {weightPct.toFixed(1)}%
                                                    </span>
                                                </div>
                                                <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                                    {asset.amount.toLocaleString(undefined, {
                                                        maximumFractionDigits: 4,
                                                    })}{' '}
                                                    @ ${formatUnitPrice(asset.price)}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="text-right shrink-0">
                                            <div className="text-sm font-black text-slate-900 dark:text-white font-mono">
                                                {formatCurrency(asset.value)}
                                            </div>
                                            <span
                                                className={`text-[10.5px] font-mono font-bold ${
                                                    change24h >= 0
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : 'text-rose-600 dark:text-rose-400'
                                                }`}
                                            >
                                                {change24h >= 0 ? 'â–²' : 'â–¼'}{' '}
                                                {Math.abs(change24h).toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex flex-wrap gap-1">
                                            {asset.allocations?.slice(0, 3).map((al) => (
                                                <span
                                                    key={al.exchange}
                                                    className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 font-mono text-slate-600 dark:text-gray-300 uppercase"
                                                >
                                                    {al.exchange}:{' '}
                                                    {al.amount.toLocaleString(undefined, {
                                                        maximumFractionDigits: 3,
                                                    })}
                                                </span>
                                            ))}
                                        </div>

                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleTradeAsset(asset);
                                            }}
                                            className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[10.5px] font-mono font-bold shrink-0"
                                        >
                                            Trade â†’
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-[10.5px] font-mono font-black uppercase tracking-wider text-slate-500 dark:text-gray-400 bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/10">
                                    <th className="px-5 py-3">
                                        <button
                                            type="button"
                                            onClick={() => toggleSort('symbol')}
                                            className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white"
                                        >
                                            Asset <ArrowUpDown className="w-3 h-3" />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => toggleSort('price')}
                                            className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white ml-auto"
                                        >
                                            Price <ArrowUpDown className="w-3 h-3" />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right">Balance &amp; Venues</th>
                                    <th className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => toggleSort('change')}
                                            className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white ml-auto"
                                        >
                                            24h <ArrowUpDown className="w-3 h-3" />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => toggleSort('value')}
                                            className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-900 dark:hover:text-white ml-auto"
                                        >
                                            Value &amp; Weight <ArrowUpDown className="w-3 h-3" />
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-right">24h Curve</th>
                                    <th className="px-5 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-white/5 text-sm">
                                {isInitialLoading &&
                                    assets.length === 0 &&
                                    [0, 1, 2].map((row) => (
                                        <tr key={`skel-${row}`}>
                                            <td className="px-5 py-4" colSpan={7}>
                                                <div className="h-8 rounded-lg bg-slate-100 dark:bg-white/5" />
                                            </td>
                                        </tr>
                                    ))}
                                {!isInitialLoading && visibleAssets.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-12 text-center space-y-2.5">
                                            <p className="text-xs font-mono text-slate-400 dark:text-gray-500">
                                                No holdings match your current filter.
                                            </p>
                                            {hideDust && dustHiddenCount > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setHideDust(false)}
                                                    className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-xs font-mono font-bold cursor-pointer"
                                                >
                                                    Show {dustHiddenCount} Dust Asset{dustHiddenCount === 1 ? '' : 's'} (&lt;$1)
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )}
                                {visibleAssets.map((asset) => {
                                    const change24h = asset.price24h
                                        ? ((asset.price - asset.price24h) / asset.price24h) * 100
                                        : 0;
                                    const weightPct =
                                        totalPortfolioValue > 0
                                            ? (asset.value / totalPortfolioValue) * 100
                                            : 0;
                                    const isSelected = selectedAsset?.id === asset.id;

                                    return (
                                        <tr
                                            key={asset.id}
                                            onClick={() => {
                                                setSelectedAsset(asset);
                                                setChartScope('asset');
                                            }}
                                            className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
                                                isSelected ? 'bg-cyan-500/5' : ''
                                            }`}
                                        >
                                            <td className="px-5 py-3.5">
                                                <div className="flex items-center gap-3">
                                                    <CoinLogo
                                                        symbol={asset.symbol}
                                                        className="w-7 h-7 shrink-0"
                                                    />
                                                    <div>
                                                        <div className="font-black text-slate-900 dark:text-white tracking-wide uppercase">
                                                            {asset.symbol}
                                                        </div>
                                                        <div className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                                            {asset.exchange
                                                                ? asset.exchange.toUpperCase()
                                                                : 'SPOT'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-700 dark:text-gray-200">
                                                ${formatUnitPrice(asset.price)}
                                            </td>

                                            <td className="px-4 py-3.5 text-right">
                                                <div className="font-mono font-bold text-slate-800 dark:text-gray-200">
                                                    {asset.amount.toLocaleString(undefined, {
                                                        maximumFractionDigits: 4,
                                                    })}
                                                </div>
                                                {asset.allocations && asset.allocations.length > 0 && (
                                                    <div className="flex justify-end flex-wrap gap-1 mt-1">
                                                        {asset.allocations.slice(0, 2).map((al) => (
                                                            <span
                                                                key={al.exchange}
                                                                className="text-[9.5px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 font-mono text-slate-500 dark:text-gray-400 uppercase"
                                                            >
                                                                {al.exchange}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>

                                            <td className="px-4 py-3.5 text-right font-mono">
                                                <span
                                                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-bold ${
                                                        change24h >= 0
                                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                    }`}
                                                >
                                                    {change24h >= 0 ? 'â–²' : 'â–¼'}{' '}
                                                    {Math.abs(change24h).toFixed(2)}%
                                                </span>
                                            </td>

                                            <td className="px-4 py-3.5 text-right">
                                                <div className="font-mono font-black text-slate-900 dark:text-white">
                                                    {formatCurrency(asset.value)}
                                                </div>
                                                <div className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                                                    {weightPct.toFixed(1)}% weight
                                                </div>
                                            </td>

                                            <td className="px-4 py-3.5 text-right">
                                                {asset.history?.length > 1 ? (
                                                    <MiniSparkline
                                                        data={asset.history}
                                                        color={change24h >= 0 ? '#10B981' : '#F43F5E'}
                                                    />
                                                ) : (
                                                    <span className="text-slate-400 font-mono text-xs">â€”</span>
                                                )}
                                            </td>

                                            <td className="px-5 py-3.5 text-right">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleTradeAsset(asset);
                                                    }}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300 hover:text-slate-950 text-xs font-mono font-bold transition-colors cursor-pointer"
                                                >
                                                    <span>Trade</span>
                                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {totalFilteredCount > visibleAssets.length && (
                    <div className="p-3 border-t border-slate-200 dark:border-white/10 text-center">
                        <button
                            type="button"
                            onClick={() => setShowAllHoldings(true)}
                            className="px-4 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-mono font-bold text-slate-700 dark:text-gray-300 cursor-pointer"
                        >
                            Show All {totalFilteredCount} Assets
                        </button>
                    </div>
                )}
            </div>

            {/* â”€â”€ Row 5: Stress Simulator & AI Portfolio Architect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Risk Stress Simulator */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm flex flex-col space-y-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-300">
                                <SlidersHorizontal className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                    12-Month Stress Simulator
                                </h3>
                                <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                    Macro regime &amp; exposure beta modeling
                                </p>
                            </div>
                        </div>

                        <span
                            className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-md uppercase border ${
                                riskTolerance > 66
                                    ? 'bg-rose-500/15 border-rose-500/35 text-rose-600 dark:text-rose-300'
                                    : riskTolerance < 33
                                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600 dark:text-emerald-300'
                                      : 'bg-indigo-500/15 border-indigo-500/35 text-indigo-600 dark:text-indigo-300'
                            }`}
                        >
                            {riskTolerance < 33
                                ? 'Conservative'
                                : riskTolerance > 66
                                  ? 'Aggressive'
                                  : 'Balanced'}
                        </span>
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between items-center text-[11px] font-mono">
                            <span className="text-slate-500 dark:text-gray-400 font-bold">
                                Risk Tolerance Beta
                            </span>
                            <span className="font-black text-slate-900 dark:text-white">
                                {riskTolerance}%
                            </span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={riskTolerance}
                            onChange={(e) => setRiskTolerance(Number(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <span className="text-[10.5px] font-mono font-bold uppercase text-slate-500 dark:text-gray-400 block">
                            Macro Scenario
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {(['Normal', 'Recession', 'High Inflation', 'Stagflation'] as const).map(
                                (s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setScenario(s)}
                                        className={`py-1.5 px-2 rounded-xl border text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                                            scenario === s
                                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                                : 'bg-slate-50 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:border-indigo-400/50'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                )
                            )}
                        </div>
                    </div>

                    <div className="h-[130px] w-full">
                        <ResponsiveContainer debounce={220} width="100%" height="100%">
                            <AreaChart
                                data={simulationData}
                                margin={{ top: 5, right: 6, left: 6, bottom: 0 }}
                            >
                                <defs>
                                    <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop
                                            offset="0%"
                                            stopColor={
                                                simulationResult.projectedReturn >= 0
                                                    ? '#10B981'
                                                    : '#F43F5E'
                                            }
                                            stopOpacity={0.25}
                                        />
                                        <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="month"
                                    tick={{ fill: axisColor, fontSize: 10 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    contentStyle={tooltipStyle}
                                    formatter={(val: any) => [formatCurrency(Number(val), 0), 'Projected']}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke={
                                        simulationResult.projectedReturn >= 0
                                            ? '#10B981'
                                            : '#F43F5E'
                                    }
                                    strokeWidth={2}
                                    fill="url(#simGrad)"
                                    isAnimationActive={!isThermalGuard}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                        <div>
                            <p className="text-[10px] font-mono uppercase text-slate-500 dark:text-gray-400 font-bold">
                                12M Projected Return
                            </p>
                            <p
                                className={`text-xl font-black font-mono mt-0.5 ${
                                    simulationResult.projectedReturn >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {simulationResult.projectedReturn >= 0 ? '+' : ''}
                                {simulationResult.projectedReturn.toFixed(1)}%
                            </p>
                            <span className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                                Est. {formatCurrency(simulationResult.projectedFinalUsd, 0)}
                            </span>
                        </div>
                        <div>
                            <p className="text-[10px] font-mono uppercase text-slate-500 dark:text-gray-400 font-bold">
                                Max Scenario Drawdown
                            </p>
                            <p className="text-xl font-black font-mono text-rose-600 dark:text-rose-400 mt-0.5">
                                -{simulationResult.maxDrawdown.toFixed(1)}%
                            </p>
                            <span className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                                Stress trough
                            </span>
                        </div>
                    </div>
                </div>

                {/* AI Portfolio Architect */}
                <div className="rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-4 lg:p-5 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300">
                                <Sparkles className="w-4 h-4" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                                    AI Portfolio Architect
                                </h3>
                                <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                    Allocation rebalancing &amp; risk diagnostics
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[220px] mb-4">
                        {isOptimizing ? (
                            <div className="h-full flex flex-col items-center justify-center p-6 gap-3 rounded-xl bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10">
                                <RefreshCw className="w-7 h-7 text-cyan-500 animate-spin" />
                                <p className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-gray-400">
                                    Analyzing portfolio allocation...
                                </p>
                            </div>
                        ) : recommendations.length > 0 ? (
                            <div className="space-y-2.5">
                                {recommendations.map((rec, index) => (
                                    <div
                                        key={index}
                                        className="flex gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10"
                                    >
                                        <span className="text-cyan-600 dark:text-cyan-400 font-mono font-black text-xs pt-0.5 shrink-0">
                                            0{index + 1}
                                        </span>
                                        <p className="text-xs sm:text-[13px] text-slate-700 dark:text-gray-300 leading-relaxed">
                                            {renderBoldInline(rec)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center p-6 rounded-xl border border-dashed border-slate-200 dark:border-white/10 gap-2">
                                <Sparkles className="w-6 h-6 text-slate-400 dark:text-gray-500" />
                                <p className="text-xs font-mono font-bold text-slate-600 dark:text-gray-300">
                                    Optimization Engine Ready
                                </p>
                                <p className="text-[11.5px] text-slate-500 dark:text-gray-400 max-w-sm">
                                    Run synthesis to evaluate asset concentration, dry powder reserves, and exposure hedging based on your live holdings.
                                </p>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={handleOptimize}
                        disabled={isOptimizing || assets.length === 0}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:brightness-110 disabled:opacity-45 text-white text-xs font-mono font-black uppercase tracking-widest cursor-pointer transition-all shadow-[0_6px_18px_rgba(79,70,229,0.28)] active:scale-[0.99]"
                    >
                        {isOptimizing ? 'Synthesizing Diagnostics...' : 'Run AI & Quant Diagnostics'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PortfolioTracker;
