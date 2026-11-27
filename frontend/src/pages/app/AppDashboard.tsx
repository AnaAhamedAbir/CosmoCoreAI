import * as React from 'react';
import { useState, useCallback, useMemo, useRef, useEffect, Suspense } from 'react';
import { Logo, DashboardIcon, PortfolioIcon, BacktesterIcon, BotLabIcon, MarketIcon, SentimentIcon, FilingsIcon, LogoutIcon, OnChainIcon, RegimeIcon, CorrelationIcon, MLModelIcon, IndicatorStudioIcon, EducationIcon, AIFoundryIcon, AlternativeDataIcon, MLModelMarketplaceIcon, QuantScreenerIcon, AlertsWatchlistIcon, AnalystResearchIcon, InstitutionalHoldingsIcon, BlockTradeDetectorIcon, UnusualOptionsActivityIcon, LiquidationMapIcon, PineScriptIcon, TokenUnlockIcon, ChevronDownIcon, UserCircleIcon, CreditCardIcon, KeyIcon, TaskManagerIcon } from '@/constants';
// FIX: Updated AppView import to break circular dependency.
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getPathFromView, getViewFromPath } from '@/utils/routeUtils';
import { AppView, TradingBot, IndicatorData } from '@/types';
import { Cpu, Database, Activity, LineChart, Bot, Layers, Shield, Bell, Palette, Menu, X, Monitor, Smartphone, Search, Sparkles, Wallet, ArrowUpRight } from 'lucide-react';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { setPhoneViewMode } from '@/utils/deviceProfile';
import AIAssistantModal from './AIAssistantModal';
import ThemeToggle from '@/components/common/ThemeToggle';
import MarketTicker from '@/components/features/market/MarketTicker';
import PanicButton from '@/components/common/PanicButton';
import SystemAlertWidget from '@/components/common/SystemAlertWidget';
import ClientDeviceWidget from '@/components/common/ClientDeviceWidget';
import SystemNotificationWidget from '@/components/common/SystemNotificationWidget';
import MarketSwitcher from '@/components/common/MarketSwitcher';
import GlobalAnnouncementBar from '@/components/common/GlobalAnnouncementBar';
import { useSettings } from '@/context/SettingsContext';
import { LatencyGuardProvider } from '@/context/LatencyGuardContext';
import { useMarketStore } from '@/store/marketStore';

const Dashboard = React.lazy(() => import('./Dashboard'));
const PortfolioTracker = React.lazy(() => import('./PortfolioTracker'));
const Market = React.lazy(() => import('./Market'));
const SentimentEngine = React.lazy(() => import('./SentimentEngine'));
const CorporateFilings = React.lazy(() => import('./CorporateFilings'));
const Settings = React.lazy(() => import('./Settings'));
const OnChainAnalyzer = React.lazy(() => import('./OnChainAnalyzer'));
const MarketRegimeClassifier = React.lazy(() => import('./MarketRegimeClassifier'));
const CorrelationMatrix = React.lazy(() => import('./CorrelationMatrix'));
const CustomMLModels = React.lazy(() => import('./CustomMLModels'));
const CustomIndicatorStudio = React.lazy(() => import('./CustomIndicatorStudio'));
const ModelTrainingStudio = React.lazy(() => import('./ModelTrainingStudio'));
const EducationHub = React.lazy(() => import('./EducationHub'));
const AIFoundry = React.lazy(() => import('./AIFoundry'));
const AlternativeData = React.lazy(() => import('./AlternativeData'));
const MLModelMarketplace = React.lazy(() => import('./MLModelMarketplace'));
const RealTimeData = React.lazy(() => import('./RealTimeData'));
const QuantScreener = React.lazy(() => import('./QuantScreener'));
const AlertsWatchlist = React.lazy(() => import('./AlertsWatchlist'));
const AnalystResearch = React.lazy(() => import('./AnalystResearch'));
const InstitutionalHoldingsTracker = React.lazy(() => import('./InstitutionalHoldingsTracker'));
const BlockTradeDetector = React.lazy(() => import('./BlockTradeDetector'));
const UnusualOptionsActivity = React.lazy(() => import('./UnusualOptionsActivity'));
const LiquidationMap = React.lazy(() => import('./LiquidationMap'));
const PineScriptStudio = React.lazy(() => import('./PineScriptStudio'));
const TokenUnlockCalendar = React.lazy(() => import('./TokenUnlockCalendar'));
const TaskManager = React.lazy(() => import('./TaskManager'));
const NeuralArchitecture = React.lazy(() => import('./NeuralArchitecture'));
const Backtester = React.lazy(() => import('./Backtester'));
const BotLab = React.lazy(() => import('./BotLab'));
const OrderFlowHeatmap = React.lazy(() => import('./OrderFlowHeatmap'));
const ArbitrageBot = React.lazy(() => import('./ArbitrageBot'));
const GridBot = React.lazy(() => import('./GridBot'));
const LeadLagBot = React.lazy(() => import('./LeadLagBot'));
const MarketDepthWidget = React.lazy(() => import('./MarketDepth/MarketDepthWidget'));
const EventDrivenSimulator = React.lazy(() => import('./EventDrivenSimulator'));
const OwnerAdminConsole = React.lazy(() => import('./OwnerAdminConsole'));

const ForexDashboard = React.lazy(() => import('./forex/ForexDashboard'));
const ForexBotLab = React.lazy(() => import('./forex/ForexBotLab'));
const ForexCalendar = React.lazy(() => import('./forex/ForexCalendar'));
const ForexPairs = React.lazy(() => import('./forex/ForexPairs'));

const StocksDashboard = () => <div className="p-8 text-white"><h1 className="text-3xl font-bold">Stocks Dashboard</h1><p className="text-gray-400 mt-4">Welcome to the Equities Desk workspace.</p></div>;
const CommoditiesDashboard = () => <div className="p-8 text-white"><h1 className="text-3xl font-bold">Commodities Dashboard</h1><p className="text-gray-400 mt-4">Welcome to the Commodities workspace.</p></div>;
const PlaceholderView = ({ title }: { title: string }) => <div className="p-8 text-white"><h1 className="text-3xl font-bold">{title}</h1><p className="text-gray-400 mt-4">This module is under construction.</p></div>;

interface AppDashboardProps {
    onLogout: () => void;
}

// Pro SaaS Institutional NavItem Component
const NavItem: React.FC<{
    icon: React.ReactNode;
    label: string;
    path: string;
    isActive: boolean;
    onClick?: () => void;
    isCollapsed?: boolean;
}> = ({ icon, label, path, isActive, onClick, isCollapsed }) => (
    <Link
        to={path}
        onClick={onClick}
        title={isCollapsed ? label : undefined}
        className={`group relative flex items-center w-full px-3 py-2 mb-0.5 rounded-xl transition-colors duration-200 overflow-hidden border
            ${isActive
                ? 'bg-cyan-500/10 border-cyan-500/35 text-cyan-950 dark:bg-[#0D1E35] dark:bg-gradient-to-r dark:from-cyan-500/20 dark:to-indigo-500/15 dark:border-cyan-400/45 dark:text-white shadow-sm'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-white'
            }`}
    >
        {/* Left active vertical bar */}
        {isActive && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-cyan-500 dark:bg-cyan-400" />
        )}

        <span className={`relative z-10 w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-lg transition-colors duration-200
            ${isActive
                ? 'bg-cyan-500/20 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300'
                : 'bg-transparent text-slate-400 dark:text-slate-500 group-hover:text-cyan-600 dark:group-hover:text-cyan-400'
            }`}>
            {icon}
        </span>

        <span className={`relative z-10 ml-3 text-[13px] font-semibold tracking-wide truncate whitespace-nowrap transition-opacity duration-200 ${isCollapsed ? 'opacity-0 w-0 pointer-events-none' : 'opacity-100'}`}>
            {label}
        </span>

        {isActive && !isCollapsed && (
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400 flex-shrink-0" />
        )}
    </Link>
);

const Sidebar: React.FC<{
    onLogout: () => void;
    isCollapsed: boolean;
    onToggle: () => void;
    isPhoneMobileUI?: boolean;
    isMobileOpen?: boolean;
    onCloseMobile?: () => void;
}> = React.memo(({ onLogout, isCollapsed, onToggle, isPhoneMobileUI = false, isMobileOpen = false, onCloseMobile }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const currentView = getViewFromPath(location.pathname);
    const { userProfile } = useSettings();
    const { activeMarket } = useMarketStore();
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [navQuery, setNavQuery] = useState('');
    const profileRef = useRef<HTMLDivElement>(null);

    const previousMarket = useRef(activeMarket);
    useEffect(() => {
        if (previousMarket.current !== activeMarket) {
            previousMarket.current = activeMarket;
            if (activeMarket === 'forex') navigate(getPathFromView(AppView.FOREX_DASHBOARD));
            else if (activeMarket === 'stocks') navigate(getPathFromView(AppView.STOCKS_DASHBOARD));
            else if (activeMarket === 'commodities') navigate(getPathFromView(AppView.COMMODITIES_DASHBOARD));
            else navigate(getPathFromView(AppView.DASHBOARD));
        }
    }, [activeMarket, navigate]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const tierLabel = userProfile.is_superuser
        ? 'Platform Owner'
        : userProfile.plan_tier === 'enterprise'
            ? 'Enterprise Desk'
            : userProfile.plan_tier === 'pro' || userProfile.is_pro
                ? 'Pro Quant · $50/mo'
                : 'Starter · Free';

    const initials = useMemo(() => {
        const name = (userProfile.fullName || 'AA').trim();
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    }, [userProfile.fullName]);

    const DropdownMenuItem: React.FC<{ icon: React.ReactNode; label: string; hint?: string; accent?: boolean; onClick: () => void; }> = ({ icon, label, hint, accent, onClick }) => (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center justify-between w-full px-3 py-2.5 mb-1 text-left rounded-xl border transition-colors cursor-pointer group ${
                accent
                    ? 'bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:border-slate-200 dark:hover:border-slate-800 text-slate-700 dark:text-slate-200'
            }`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                    accent
                        ? 'bg-cyan-500/15 text-cyan-500'
                        : 'bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 group-hover:text-cyan-500 dark:group-hover:text-cyan-400'
                }`}>
                    {icon}
                </span>
                <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{label}</div>
                    {hint && <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{hint}</div>}
                </div>
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </button>
    );

    const navCategories = useMemo(() => {
        if (activeMarket === 'forex') {
            return [
                {
                    title: 'Forex Terminal',
                    items: [
                        { view: AppView.FOREX_DASHBOARD, icon: <DashboardIcon />, label: 'Forex Dashboard' },
                        { view: AppView.FOREX_PAIRS, icon: <MarketIcon />, label: 'Forex Market Chart' },
                        { view: AppView.FOREX_CALENDAR, icon: <FilingsIcon />, label: 'Economic Calendar' },
                        { view: AppView.FOREX_BOT_LAB, icon: <BotLabIcon />, label: 'Forex Bot Lab' },
                        { view: AppView.CORRELATION_MATRIX, icon: <CorrelationIcon />, label: 'Correlation Matrix' },
                    ]
                }
            ];
        }

        if (activeMarket === 'stocks') {
            return [
                {
                    title: 'Equities Desk',
                    items: [
                        { view: AppView.STOCKS_DASHBOARD, icon: <DashboardIcon />, label: 'Stocks Dashboard' },
                        { view: AppView.STOCKS_SCREENER, icon: <QuantScreenerIcon />, label: 'Stock Screener' },
                        { view: AppView.EARNINGS_CALENDAR, icon: <FilingsIcon />, label: 'Earnings & SEC' },
                        { view: AppView.ANALYST_RESEARCH, icon: <AnalystResearchIcon />, label: 'Analyst Ratings' },
                        { view: AppView.INSTITUTIONAL_HOLDINGS, icon: <InstitutionalHoldingsIcon />, label: 'Institutional Holdings' },
                    ]
                }
            ];
        }

        if (activeMarket === 'commodities') {
            return [
                {
                    title: 'Commodities Trading',
                    items: [
                        { view: AppView.COMMODITIES_DASHBOARD, icon: <DashboardIcon />, label: 'Dashboard' },
                        { view: AppView.COMMODITIES_MARKET, icon: <MarketIcon />, label: 'Futures Market' },
                    ]
                }
            ];
        }

        // Crypto / Default
        return [
            {
                title: 'Operations',
                items: [
                    { view: AppView.DASHBOARD, icon: <DashboardIcon />, label: 'Dashboard' },
                    { view: AppView.PORTFOLIO, icon: <PortfolioIcon />, label: 'Portfolio' },
                    { view: AppView.MARKET, icon: <MarketIcon />, label: 'Live Market' },
                    { view: AppView.ALERTS_WATCHLIST, icon: <AlertsWatchlistIcon />, label: 'Sentinels' },
                    { view: AppView.TASK_MANAGER, icon: <TaskManagerIcon />, label: 'Task Command' },
                ]
            },
            {
                title: 'Core Engines',
                items: [
                    { view: AppView.BACKTESTER, icon: <BacktesterIcon />, label: 'Backtester' },
                    { view: AppView.EVENT_DRIVEN, icon: <Activity />, label: 'Live Simulation' },
                    { view: AppView.ARBITRAGE_BOT, icon: <Bot />, label: 'Arbitrage Bot' },
                    { view: AppView.GRID_BOT, icon: <Layers />, label: 'Grid Bot' },
                    { view: AppView.LEAD_LAG_BOT, icon: <LineChart />, label: 'Lead-Lag Bot' },
                    { view: AppView.BOT_LAB, icon: <BotLabIcon />, label: 'Bot Laboratory' },
                    { view: AppView.ORDER_FLOW_HEATMAP, icon: <Activity />, label: 'Wallhunter_Bot' },
                    { view: AppView.AI_FOUNDRY, icon: <AIFoundryIcon />, label: 'AI Foundry' },
                    { view: AppView.CUSTOM_ML_MODELS, icon: <MLModelIcon />, label: 'ML Registry' },
                    { view: AppView.MODEL_TRAINING_STUDIO, icon: <Activity />, label: 'Training Studio' },
                ]
            },
            {
                title: 'Alpha Intelligence',
                items: [
                    { view: AppView.SENTIMENT_ENGINE, icon: <SentimentIcon />, label: 'Sentiment AI' },
                    { view: AppView.BLOCK_TRADE_DETECTOR, icon: <BlockTradeDetectorIcon />, label: 'Block Trades' },
                    { view: AppView.UNUSUAL_OPTIONS_ACTIVITY, icon: <UnusualOptionsActivityIcon />, label: 'Unusual Options' },
                    { view: AppView.LIQUIDATION_MAP, icon: <LiquidationMapIcon />, label: 'Liquidation Map' },
                    { view: AppView.TOKEN_UNLOCK_CALENDAR, icon: <TokenUnlockIcon />, label: 'Token Unlocks' },
                    { view: AppView.MARKET_REGIME_CLASSIFIER, icon: <RegimeIcon />, label: 'Regime Classifier' },
                    { view: AppView.ON_CHAIN_ANALYZER, icon: <OnChainIcon />, label: 'On-Chain Data' },
                    { view: AppView.MARKET_DEPTH, icon: <Activity />, label: 'Market Depth' },
                    { view: AppView.ALTERNATIVE_DATA, icon: <AlternativeDataIcon />, label: 'Alternative Data' },
                ]
            },
            {
                title: 'Developer Studio',
                items: [
                    { view: AppView.NURAL_CORE, icon: <Cpu size={18} />, label: 'Neural Core' },
                    { view: AppView.ML_MODEL_MARKETPLACE, icon: <MLModelMarketplaceIcon />, label: 'Algo Marketplace' },
                    { view: AppView.CUSTOM_INDICATOR_STUDIO, icon: <IndicatorStudioIcon />, label: 'Indicator Studio' },
                    { view: AppView.PINE_SCRIPT_STUDIO, icon: <PineScriptIcon />, label: 'Pine Editor' },
                ]
            },
            {
                title: 'Knowledge',
                items: [
                    { view: AppView.EDUCATION_HUB, icon: <EducationIcon />, label: 'Academy' },
                ]
            },
            ...(userProfile.is_superuser
                ? [{
                    title: 'Owner Command',
                    items: [
                        { view: AppView.OWNER_ADMIN, icon: <Shield className="w-[18px] h-[18px]" />, label: 'Owner Admin' },
                    ]
                }]
                : []),
        ];
    }, [activeMarket, userProfile.is_superuser]);

    const effectiveCollapsed = isPhoneMobileUI ? false : isCollapsed;

    const filteredCategories = useMemo(() => {
        const q = navQuery.trim().toLowerCase();
        if (!q || effectiveCollapsed) return navCategories;
        return navCategories
            .map((cat) => ({
                ...cat,
                items: cat.items.filter((item) => item.label.toLowerCase().includes(q)),
            }))
            .filter((cat) => cat.items.length > 0);
    }, [navCategories, navQuery, effectiveCollapsed]);

    const sidebarAside = (
        <aside className={`${
            isPhoneMobileUI
                ? `fixed top-0 left-0 h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)] w-[272px] max-w-[84vw] z-[90] transition-transform duration-200 ease-out ${isMobileOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'}`
                : `${effectiveCollapsed ? 'w-20' : 'w-72'} h-full max-h-full flex-shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] z-30 relative`
        } bg-[#F8FAFC] dark:bg-[#070B14] border-r border-slate-200 dark:border-slate-800/80 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_28px_rgba(0,0,0,0.45)] group`}>

            {/* Subtle Top Accent Hairline */}
            <div className="h-[1px] w-full bg-gradient-to-r from-cyan-500/50 via-indigo-500/40 to-transparent flex-shrink-0" />

            {/* Mobile Drawer Close Button */}
            {isPhoneMobileUI ? (
                <button
                    type="button"
                    onClick={onCloseMobile}
                    aria-label="Close navigation menu"
                    className="absolute right-3 top-3 w-8 h-8 bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-500 hover:text-cyan-500 shadow-sm z-30 active:scale-95 cursor-pointer"
                >
                    <X className="w-4 h-4" />
                </button>
            ) : (
                /* Collapse Toggle Button (PC / Tablet) */
                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={effectiveCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className="absolute -right-3 top-14 w-6 h-6 bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700/80 rounded-full flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:border-cyan-500/50 shadow-md z-30 transition-colors cursor-pointer"
                >
                    <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform duration-300 ${effectiveCollapsed ? '-rotate-90' : 'rotate-90'}`} />
                </button>
            )}

            {/* Brand Header + Quick Filter */}
            <div className="px-4 pt-0 pb-2.5 relative z-10 flex-shrink-0">
                <div className="flex items-center justify-center">
                    {effectiveCollapsed ? (
                        <img
                            src="/logo.png"
                            alt="CosmoQuantAI"
                            className="h-14 w-14 mt-2.5 object-contain select-none drop-shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                        />
                    ) : (
                        <div className="relative flex flex-col items-center w-full select-none -mt-[14px]">
                            <span className={`absolute ${isPhoneMobileUI ? 'left-0' : 'right-0'} top-6 px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-widest bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25 z-20`}>
                                PRO
                            </span>
                            <img
                                src="/logo.png"
                                alt="CosmoQuantAI"
                                className="h-[136px] w-[136px] object-contain drop-shadow-[0_6px_16px_rgba(15,23,42,0.2)] dark:drop-shadow-[0_0_24px_rgba(6,182,212,0.45)]"
                            />
                            <span className="-mt-4 font-extrabold text-[19px] leading-tight text-slate-900 dark:text-white tracking-tight whitespace-nowrap">
                                CosmoQuantAI
                            </span>
                        </div>
                    )}
                </div>

                {/* Quick Module Search (Expanded only) */}
                {!effectiveCollapsed && (
                    <div className="mt-2.5 relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 pointer-events-none" />
                        <input
                            type="text"
                            value={navQuery}
                            onChange={(e) => setNavQuery(e.target.value)}
                            placeholder="Jump to module..."
                            className="w-full h-8 pl-8 pr-7 rounded-xl text-xs bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/90 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                        {navQuery && (
                            <button
                                type="button"
                                onClick={() => setNavQuery('')}
                                aria-label="Clear filter"
                                className="absolute right-2 p-0.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                )}

                <div className={`h-px w-full bg-slate-200/80 dark:bg-slate-800/70 mt-3 ${effectiveCollapsed ? 'opacity-40' : 'opacity-100'}`} />
            </div>

            {/* Vertical Feature List */}
            <nav className="flex-1 min-h-0 overflow-y-auto px-3 custom-scrollbar pb-4 relative z-10">
                {filteredCategories.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                        No modules match "{navQuery}"
                    </div>
                ) : (
                    filteredCategories.map(category => (
                        <div key={category.title} className="mb-4 last:mb-0">
                            <div className="relative h-5 mb-1.5 flex items-center justify-between px-2.5">
                                {!effectiveCollapsed ? (
                                    <>
                                        <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 select-none">
                                            {category.title}
                                        </h3>
                                        <span className="text-[9px] font-mono text-slate-400/80 dark:text-slate-600">
                                            {category.items.length}
                                        </span>
                                    </>
                                ) : (
                                    <div className="w-full h-px bg-slate-200 dark:bg-slate-800/80" />
                                )}
                            </div>
                            <div className="space-y-0.5">
                                {category.items.map(item => (
                                    <NavItem
                                        key={item.view}
                                        icon={item.icon}
                                        label={item.label}
                                        path={getPathFromView(item.view)}
                                        isActive={currentView === item.view}
                                        isCollapsed={effectiveCollapsed}
                                        onClick={isPhoneMobileUI ? onCloseMobile : undefined}
                                    />
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </nav>

            {/* Profile & Account Footer */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#050810] relative z-20 flex-shrink-0" ref={profileRef}>
                {/* Backdrop Overlay (thermal-safe without heavy blur) */}
                {isProfileOpen && (
                    <div
                        className="fixed inset-0 bg-slate-950/70 z-[100] transition-opacity duration-200 opacity-100 pointer-events-auto"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsProfileOpen(false);
                        }}
                    />
                )}

                {/* Slide-over My Account Drawer */}
                <div
                    className={`fixed top-0 left-0 h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)] w-[336px] max-w-[88vw] bg-white dark:bg-[#070B14] shadow-2xl border-r border-slate-200 dark:border-slate-800 z-[110] transform transition-transform duration-300 ease-out ${isProfileOpen ? 'translate-x-0' : '-translate-x-full'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex flex-col h-full">
                        {/* Drawer Top Accent */}
                        <div className="h-[2px] w-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500 flex-shrink-0" />

                        {/* Drawer Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800/80">
                            <div>
                                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 uppercase tracking-wider">
                                    <UserCircleIcon className="w-4 h-4 text-cyan-500" />
                                    My Account
                                </h2>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    Workspace Identity & Subscription
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsProfileOpen(false)}
                                aria-label="Close account drawer"
                                className="p-1.5 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Subscription & Identity Card */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-800/80">
                            <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-[#0B1120] border border-cyan-500/30 text-white shadow-lg">
                                <div className="flex items-center gap-3.5">
                                    <div className="relative flex-shrink-0">
                                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-md">
                                            {initials}
                                        </div>
                                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#0B1120]" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-sm text-white truncate">{userProfile.fullName || 'Quant Trader'}</h3>
                                        <div className="flex items-center gap-1.5 mt-1">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                {tierLabel}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[11px]">
                                    <span className="text-slate-400">Desk Access: <strong className="text-emerald-300">Active</strong></span>
                                    <button
                                        type="button"
                                        onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/billing'); setIsProfileOpen(false); }}
                                        className="text-cyan-300 hover:text-cyan-200 font-semibold flex items-center gap-1 cursor-pointer"
                                    >
                                        Manage Plan <ArrowUpRight className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Drawer Menu Items */}
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                            <div>
                                <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                    Account &amp; Connectivity
                                </p>
                                <DropdownMenuItem
                                    icon={<UserCircleIcon className="w-4 h-4" />}
                                    label="Profile Settings"
                                    hint="Identity, timezone & desk defaults"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/profile'); setIsProfileOpen(false); }}
                                />
                                <DropdownMenuItem
                                    icon={<CreditCardIcon className="w-4 h-4" />}
                                    label="Billing & Subscription"
                                    hint="Pro Quant plan & invoices"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/billing'); setIsProfileOpen(false); }}
                                />
                                <DropdownMenuItem
                                    icon={<Shield className="w-4 h-4" />}
                                    label="Security & 2FA"
                                    hint="Session locks & authenticator"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/security'); setIsProfileOpen(false); }}
                                />
                                <DropdownMenuItem
                                    icon={<KeyIcon className="w-4 h-4" />}
                                    label="API Keys & Brokers"
                                    hint="Exchange execution credentials"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/api-keys'); setIsProfileOpen(false); }}
                                />
                            </div>

                            <div>
                                <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                    Terminal Preferences
                                </p>
                                <DropdownMenuItem
                                    icon={<Bell className="w-4 h-4" />}
                                    label="Notifications"
                                    hint="Telegram, alerts & signal routing"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/notifications'); setIsProfileOpen(false); }}
                                />
                                <DropdownMenuItem
                                    icon={<Palette className="w-4 h-4" />}
                                    label="Appearance & Thermal"
                                    hint="Dark desk theme & Eco Guard"
                                    onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/appearance'); setIsProfileOpen(false); }}
                                />
                            </div>

                            {userProfile.is_superuser && (
                                <div>
                                    <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-500">
                                        Owner Administration
                                    </p>
                                    <DropdownMenuItem
                                        accent
                                        icon={<Shield className="w-4 h-4" />}
                                        label="Owner Admin Console"
                                        hint="Platform health, users & telemetry"
                                        onClick={() => { navigate(getPathFromView(AppView.OWNER_ADMIN)); setIsProfileOpen(false); }}
                                    />
                                    <DropdownMenuItem
                                        icon={<Database className="w-4 h-4" />}
                                        label="Data Management"
                                        hint="Cache pools, ingestion & retention"
                                        onClick={() => { navigate(getPathFromView(AppView.SETTINGS) + '/data'); setIsProfileOpen(false); }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Logout Footer */}
                        <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#050810]">
                            <button
                                type="button"
                                onClick={onLogout}
                                className="flex items-center justify-center w-full gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wider hover:bg-rose-500 hover:text-white transition-colors cursor-pointer"
                            >
                                <LogoutIcon />
                                <span>Sign Out Session</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* User Account Button */}
                <button
                    type="button"
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    title={effectiveCollapsed ? `${userProfile.fullName || 'User'} · My Account` : 'Open My Account'}
                    className={`flex items-center w-full p-2 rounded-2xl border transition-colors cursor-pointer group ${
                        effectiveCollapsed ? 'justify-center' : ''
                    } ${isProfileOpen
                        ? 'bg-cyan-500/10 border-cyan-500/45 shadow-sm'
                        : 'bg-white dark:bg-[#0B1120] border-slate-200 dark:border-slate-800/80 hover:border-cyan-500/40'
                    }`}
                >
                    <div className="relative flex-shrink-0">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                            {initials}
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 border-2 border-white dark:border-[#0B1120] rounded-full" />
                    </div>
                    {!effectiveCollapsed && (
                        <>
                            <div className="ml-2.5 flex-1 min-w-0 text-left">
                                <p className="font-bold text-xs text-slate-900 dark:text-white truncate group-hover:text-cyan-600 dark:group-hover:text-cyan-300 transition-colors">
                                    {userProfile.fullName || 'Quant Trader'}
                                </p>
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono flex items-center gap-1 mt-0.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                                    {tierLabel}
                                </p>
                            </div>
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-transform duration-200 text-slate-400 group-hover:text-cyan-400 ${isProfileOpen ? 'rotate-180 text-cyan-400' : ''}`}>
                                <ChevronDownIcon className="h-4 w-4" />
                            </div>
                        </>
                    )}
                </button>
            </div>
        </aside>
    );

    if (isPhoneMobileUI) {
        return (
            <>
                {isMobileOpen && (
                    <div
                        className="fixed inset-0 bg-slate-950/70 z-[85] transition-opacity duration-200"
                        onClick={onCloseMobile}
                    />
                )}
                {sidebarAside}
            </>
        );
    }

    return sidebarAside;
});

const MODAL_VIEWS: AppView[] = [];

import { BacktestProvider } from '@/context/BacktestContext';

interface DashboardContentRouterProps {
    viewToRender: AppView;
    activeSettingsSection: string | null;
    retrainModelIdParam: string | null;
    onNavigate: (view: AppView, section?: string) => void;
}

/** Memoized route view container so sidebar collapse/expand never triggers active page re-renders. */
const DashboardContentRouter: React.FC<DashboardContentRouterProps> = React.memo(({
    viewToRender,
    activeSettingsSection,
    retrainModelIdParam,
    onNavigate,
}) => {
    switch (viewToRender) {
        case AppView.DASHBOARD: return <Dashboard />;
        case AppView.PORTFOLIO: return <PortfolioTracker />;
        case AppView.BACKTESTER: return <Backtester />;
        case AppView.EVENT_DRIVEN: return <EventDrivenSimulator />;
        case AppView.ARBITRAGE_BOT: return <ArbitrageBot />;
        case AppView.GRID_BOT: return <GridBot />;
        case AppView.LEAD_LAG_BOT: return <LeadLagBot />;
        case AppView.BOT_LAB: return <BotLab />;
        case AppView.ORDER_FLOW_HEATMAP: return <OrderFlowHeatmap />;
        case AppView.AI_FOUNDRY: return <AIFoundry />;
        case AppView.MARKET: return <Market />;
        case AppView.SENTIMENT_ENGINE: return <SentimentEngine />;
        case AppView.CORPORATE_FILINGS: return <CorporateFilings />;
        case AppView.INSTITUTIONAL_HOLDINGS: return <InstitutionalHoldingsTracker />;
        case AppView.BLOCK_TRADE_DETECTOR: return <BlockTradeDetector />;
        case AppView.UNUSUAL_OPTIONS_ACTIVITY: return <UnusualOptionsActivity />;
        case AppView.ON_CHAIN_ANALYZER: return <OnChainAnalyzer />;
        case AppView.LIQUIDATION_MAP: return <LiquidationMap />;
        case AppView.MARKET_REGIME_CLASSIFIER: return <MarketRegimeClassifier />;
        case AppView.CORRELATION_MATRIX: return <CorrelationMatrix />;
        case AppView.TOKEN_UNLOCK_CALENDAR: return <TokenUnlockCalendar />;
        case AppView.ALTERNATIVE_DATA: return <AlternativeData />;
        case AppView.REAL_TIME_DATA: return <RealTimeData />;
        case AppView.QUANT_SCREENER: return <QuantScreener />;
        case AppView.ALERTS_WATCHLIST: return <AlertsWatchlist />;
        case AppView.ANALYST_RESEARCH: return <AnalystResearch />;
        case AppView.CUSTOM_ML_MODELS: return <CustomMLModels onNavigate={onNavigate} />;
        case AppView.MODEL_TRAINING_STUDIO: return <ModelTrainingStudio retrainModelId={retrainModelIdParam} />;
        case AppView.ML_MODEL_MARKETPLACE: return <MLModelMarketplace />;
        case AppView.CUSTOM_INDICATOR_STUDIO: return <CustomIndicatorStudio />;
        case AppView.PINE_SCRIPT_STUDIO: return <PineScriptStudio />;
        case AppView.EDUCATION_HUB: return <EducationHub />;
        case AppView.NURAL_CORE: return <NeuralArchitecture />;
        case AppView.TASK_MANAGER: return <TaskManager />;
        case AppView.MARKET_DEPTH: return <MarketDepthWidget />;
        case AppView.SETTINGS: return <Settings initialSection={activeSettingsSection} />;
        case AppView.OWNER_ADMIN: return <OwnerAdminConsole />;

        // TradFi Routes
        case AppView.FOREX_DASHBOARD: return <ForexDashboard />;
        case AppView.FOREX_PAIRS: return <ForexPairs />;
        case AppView.FOREX_CALENDAR: return <ForexCalendar />;
        case AppView.FOREX_BOT_LAB: return <ForexBotLab />;
        case AppView.STOCKS_DASHBOARD: return <StocksDashboard />;
        case AppView.STOCKS_SCREENER: return <PlaceholderView title="Stock Screener" />;
        case AppView.EARNINGS_CALENDAR: return <PlaceholderView title="Earnings Calendar" />;
        case AppView.SEC_FILINGS: return <PlaceholderView title="SEC Filings" />;
        case AppView.COMMODITIES_DASHBOARD: return <CommoditiesDashboard />;
        case AppView.COMMODITIES_MARKET: return <PlaceholderView title="Commodities Futures" />;

        default: return <Dashboard />;
    }
});

const AppDashboard: React.FC<AppDashboardProps> = ({ onLogout }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const currentView = getViewFromPath(location.pathname);
    
    // Parse dynamic section from URL
    const getDynamicSection = (basePath: string) => {
        if (location.pathname.startsWith(basePath + '/')) {
            const section = location.pathname.substring((basePath + '/').length);
            return section || null;
        }
        return null;
    };
    const activeSettingsSection = getDynamicSection('/settings');
    const retrainModelIdParam = getDynamicSection('/model-training-studio');
    const { userProfile } = useSettings();

    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [isAssistantOpen, setIsAssistantOpen] = useState(false);
    const [modalView, setModalView] = useState<AppView | null>(null);
    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    // Auto-collapse sidebar on laptop/small screens (≤1366px)
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
        typeof window !== 'undefined' && (window.innerWidth <= 1440 || window.matchMedia?.('(pointer: coarse)').matches)
    );

    useEffect(() => {
        setIsMobileSidebarOpen(false);
    }, [location.pathname, isPhoneMobileUI]);
    const lastWidthRef = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);
    const userToggledSidebarRef = useRef(false);

    // Lock document/body scroll while inside the app dashboard shell
    useEffect(() => {
        document.documentElement.classList.add('app-shell-locked');
        document.body.classList.add('app-shell-locked');
        return () => {
            document.documentElement.classList.remove('app-shell-locked');
            document.body.classList.remove('app-shell-locked');
        };
    }, []);
    const prevViewRef = useRef<AppView>(currentView || AppView.DASHBOARD);

    // OmniTrade State Removed

    // Sync sidebar collapse state with window resize (only when screen width changes, not on virtual keyboard)
    useEffect(() => {
        const handleResize = () => {
            const currentWidth = window.innerWidth;
            // Virtual keyboard open/close on mobile/tablet triggers resize, but width remains unchanged.
            // Ignore vertical-only height changes to prevent un-minimizing the sidebar!
            if (currentWidth === lastWidthRef.current) {
                return;
            }
            lastWidthRef.current = currentWidth;

            // If user explicitly toggled the sidebar, respect their choice
            if (userToggledSidebarRef.current) {
                if (currentWidth <= 1024) {
                    setIsSidebarCollapsed(true);
                }
                return;
            }

            const isTouch = window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
            if (currentWidth <= 1440 || isTouch) {
                setIsSidebarCollapsed(true);
            } else {
                setIsSidebarCollapsed(false);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (MODAL_VIEWS.includes(currentView)) {
            setModalView(currentView);
        } else {
            // Only update prevView if it's a main page navigation, not a modal opening
            prevViewRef.current = currentView;
            setModalView(null);
        }
    }, [currentView]);

    // ✅ Listen for external route navigation is mostly handled by React Router now.
    // However, we can provide a compatible onNavigate for inner components
    const handleNavigate = useCallback((view: AppView, section?: string) => {
        let path = getPathFromView(view);
        if (section) path += `/${section}`;
        navigate(path);
    }, [navigate]);

    useEffect(() => {
        if (window.location.pathname === '/alpha-engine/market-depth') {
            handleNavigate(AppView.MARKET_DEPTH);
        }
    }, [handleNavigate]);

    const handleConnectWallet = async () => {
        if (window.ethereum) {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                if (accounts && accounts.length > 0) {
                    setWalletAddress(accounts[0]);
                }
            } catch (error) {
                console.error("User rejected wallet connection request:", error);
            }
        } else {
            alert("Please install a Web3 wallet like MetaMask or use a Web3-enabled browser.");
        }
    };

    const handleDisconnectWallet = () => {
        setWalletAddress(null);
    };

    const viewToRender = modalView ? prevViewRef.current : currentView;

    const handleSidebarToggle = useCallback(() => {
        userToggledSidebarRef.current = true;
        setIsSidebarCollapsed((prev) => !prev);
    }, []);

    const handleCloseMobileSidebar = useCallback(() => {
        setIsMobileSidebarOpen(false);
    }, []);

    const showWalletConnect = [AppView.DASHBOARD, AppView.PORTFOLIO, AppView.ON_CHAIN_ANALYZER].includes(viewToRender);

    return (
        <LatencyGuardProvider canManageServerGuard={userProfile.is_superuser}>
        <BacktestProvider>
            <div className="flex h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)] w-full max-w-[100vw] overflow-hidden bg-brand-light dark:bg-[#050810]">
                <Sidebar 
                        onLogout={onLogout} 
                        isCollapsed={isSidebarCollapsed} 
                        onToggle={handleSidebarToggle}
                        isPhoneMobileUI={isPhoneMobileUI}
                        isMobileOpen={isMobileSidebarOpen}
                        onCloseMobile={handleCloseMobileSidebar}
                    />
                    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col overflow-hidden relative z-0">
                        <header className="relative z-50 flex-shrink-0 bg-white/95 dark:bg-[#070B14]/95 border-b border-slate-200 dark:border-slate-800/80">
                            <div className="h-[1px] w-full bg-gradient-to-r from-cyan-500/50 via-indigo-500/40 to-emerald-500/40" />
                            <GlobalAnnouncementBar />
                            {isPhoneMobileUI ? (
                                <>
                                    {/* Mobile Row 1: Drawer Trigger + Title + Quick Actions */}
                                    <div className="flex items-center justify-between gap-2 px-3 h-12 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <button
                                                type="button"
                                                onClick={() => setIsMobileSidebarOpen(true)}
                                                aria-label="Open navigation menu"
                                                className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/80 text-slate-700 dark:text-slate-200 active:scale-95 shrink-0 cursor-pointer"
                                            >
                                                <Menu className="w-4 h-4" />
                                            </button>
                                            <div className="min-w-0">
                                                <h1 className="text-xs font-bold text-slate-900 dark:text-white tracking-tight truncate">
                                                    {viewToRender}
                                                </h1>
                                                <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-500 block leading-none mt-0.5">
                                                    Live Desk
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => setPhoneViewMode('desktop')}
                                                title="Switch to full Desktop Layout"
                                                className="flex items-center gap-1 px-2 h-9 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 text-[10px] font-bold uppercase tracking-wider cursor-pointer"
                                            >
                                                <Monitor className="w-3.5 h-3.5" />
                                                <span>Desk</span>
                                            </button>
                                            <SystemNotificationWidget />
                                            <button
                                                type="button"
                                                onClick={() => setIsAssistantOpen(true)}
                                                title="Open AI Quant Copilot"
                                                aria-label="Open AI Quant Copilot"
                                                className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-r from-cyan-500/15 to-indigo-500/15 border border-cyan-500/35 text-cyan-600 dark:text-cyan-300 cursor-pointer"
                                            >
                                                <Sparkles className="w-4 h-4" />
                                            </button>
                                            <ThemeToggle />
                                        </div>
                                    </div>
                                    {/* Mobile Row 2: Market Switcher + Telemetry + Panic + Wallet */}
                                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-slate-100 dark:border-slate-800/60 overflow-x-auto hide-scrollbar">
                                        <div className="shrink-0">
                                            <MarketSwitcher />
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {userProfile.is_superuser ? <SystemAlertWidget /> : <ClientDeviceWidget />}
                                            <PanicButton />
                                            {showWalletConnect && (
                                                walletAddress ? (
                                                    <button
                                                        type="button"
                                                        onClick={handleDisconnectWallet}
                                                        className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-[10px] font-mono font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 cursor-pointer whitespace-nowrap"
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        {`${walletAddress.substring(0, 4)}..${walletAddress.substring(walletAddress.length - 3)}`}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={handleConnectWallet}
                                                        className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-[10px] font-bold uppercase tracking-wider bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/80 text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                                                    >
                                                        <Wallet className="w-3.5 h-3.5 text-cyan-400" />
                                                        <span>Wallet</span>
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center justify-between gap-3 px-6 laptop:px-4 h-14 laptop:h-12 min-w-0">
                                    {/* Left — Live Terminal Breadcrumb & Market Switcher */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="hidden xl:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                LIVE DESK
                                            </span>
                                            <h1 className="text-base xl:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                                                {viewToRender}
                                            </h1>
                                        </div>
                                        <div className="hidden md:block w-px h-5 bg-slate-200 dark:bg-slate-800/90 flex-shrink-0" />
                                        <div className="flex-shrink-0">
                                            <MarketSwitcher />
                                        </div>
                                    </div>

                                    {/* Right — Command Controls: Telemetry, Notify, Kill Switch, Wallet, AI Copilot, Theme */}
                                    <div className="flex items-center gap-2 justify-end shrink-0">
                                        {deviceProfile.isPhone && (
                                            <button
                                                type="button"
                                                onClick={() => setPhoneViewMode('mobile')}
                                                title="Return to Mobile-Optimized View"
                                                className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer"
                                            >
                                                <Smartphone className="w-3.5 h-3.5" />
                                                <span>Mobile UI</span>
                                            </button>
                                        )}

                                        {/* Telemetry & Notification Group */}
                                        <div className="flex items-center gap-2">
                                            {userProfile.is_superuser ? <SystemAlertWidget /> : <ClientDeviceWidget />}
                                            <SystemNotificationWidget />
                                        </div>

                                        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800/90 hidden sm:block" />

                                        {/* Risk & Execution Group */}
                                        <PanicButton />

                                        {showWalletConnect && (
                                            <div>
                                                {walletAddress ? (
                                                    <button
                                                        type="button"
                                                        onClick={handleDisconnectWallet}
                                                        title="Click to disconnect wallet"
                                                        className="flex items-center gap-2 px-3 h-9 rounded-xl bg-emerald-500/10 hover:bg-rose-500/10 border border-emerald-500/30 hover:border-rose-500/35 text-emerald-700 dark:text-emerald-300 hover:text-rose-500 dark:hover:text-rose-300 text-xs font-mono font-bold transition-colors cursor-pointer whitespace-nowrap"
                                                    >
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        <span>{`${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`}</span>
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={handleConnectWallet}
                                                        className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/80 hover:border-cyan-500/45 text-slate-700 dark:text-slate-200 hover:text-cyan-600 dark:hover:text-cyan-300 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
                                                    >
                                                        <Wallet className="w-3.5 h-3.5 text-cyan-400" />
                                                        <span className="hidden lg:inline">Connect Wallet</span>
                                                        <span className="lg:hidden">Wallet</span>
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {/* AI Copilot & Theme */}
                                        <button
                                            type="button"
                                            onClick={() => setIsAssistantOpen(true)}
                                            title="Open AI Quant Copilot"
                                            className="flex items-center gap-1.5 px-2.5 xl:px-3 h-9 rounded-xl bg-gradient-to-r from-cyan-500/15 to-indigo-500/15 hover:from-cyan-500/25 hover:to-indigo-500/25 border border-cyan-500/35 text-cyan-700 dark:text-cyan-300 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />
                                            <span className="hidden xl:inline">Quant AI</span>
                                        </button>

                                        <ThemeToggle />
                                    </div>
                                </div>
                            )}
                            {viewToRender === AppView.MARKET && (
                                <div className="border-t border-slate-200 dark:border-slate-800/80">
                                    <MarketTicker
                                        onCoinClick={(coinSym) => useMarketStore.getState().setGlobalSymbol(`${coinSym}/USDT`)}
                                    />
                                </div>
                            )}
                        </header>
                        <main className={`flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-y-contain relative z-0 ${isPhoneMobileUI ? 'p-3' : 'p-8 laptop:p-3 laptop-h:p-2.5'}`}>
                            <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[240px] text-slate-400 text-xs">Loading module...</div>}>
                                <DashboardContentRouter
                                    viewToRender={viewToRender}
                                    activeSettingsSection={activeSettingsSection}
                                    retrainModelIdParam={retrainModelIdParam}
                                    onNavigate={handleNavigate}
                                />
                            </Suspense>
                        </main>
                    </div>
                    <AIAssistantModal isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} currentView={viewToRender} />
            </div>
        </BacktestProvider>
        </LatencyGuardProvider>
    );
};

export default AppDashboard;

