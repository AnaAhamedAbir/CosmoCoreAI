import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    Menu,
    X,
    Monitor,
    Smartphone,
    Search,
    ArrowUpRight,
    Github,
    MessageSquare,
    Globe,
    Calendar,
    Compass,
} from 'lucide-react';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { setPhoneViewMode, isThermalGuardActive } from '@/utils/deviceProfile';
import HomePage, { CosmicStarBackground } from './HomePage';
import ServicesPage from './ServicesPage';
import PricingPage from './PricingPage';
import BlogPage from './BlogPage';
import PortfolioPage from './PortfolioPage';
import LegalPage, { type LegalDocType } from './LegalPage';
import PublicBriefingModal, { type BriefingTopic } from './PublicBriefingModal';

export type PublicView = 'Home' | 'Services' | 'Pricing' | 'Portfolio' | 'Blog' | 'Legal';

interface PublicWebsiteProps {
    onLogin: () => void;
    onSignUp: () => void;
}

interface QuickJumpItem {
    id: string;
    label: string;
    category: string;
    view: PublicView;
    symbol?: string;
    sectionId?: string;
    keywords: string;
}

const QUICK_JUMP_ITEMS: QuickJumpItem[] = [
    { id: 'wallhunter', label: 'WallHunter Liquidity Radar', category: 'Feature', view: 'Services', keywords: 'wallhunter whale trap orderbook liquidity' },
    { id: 'heatmap', label: 'OrderFlow Heatmap Canvas', category: 'Feature', view: 'Services', keywords: 'orderflow heatmap depth cluster' },
    { id: 'smartchase', label: 'Smart Chase SL & Brackets', category: 'Feature', view: 'Services', keywords: 'smart chase stop loss trailing risk' },
    { id: 'aifoundry', label: 'AI Strategy Foundry Demo', category: 'Feature', view: 'Home', sectionId: 'ai-strategy-demo', keywords: 'ai foundry prompt python strategy code' },
    { id: 'pricing', label: 'Pricing & Plan Specifications', category: 'Billing', view: 'Pricing', keywords: 'pricing pro free enterprise bdt usd' },
    { id: 'portfolio', label: 'Case Studies & Architecture', category: 'Proof', view: 'Portfolio', keywords: 'portfolio case study systems backtest' },
    { id: 'blog', label: 'Quant Research Blog', category: 'Research', view: 'Blog', keywords: 'blog research tutorial volatility' },
    { id: 'btc', label: 'BTC/USDT Live Terminal Chart', category: 'Market', view: 'Home', symbol: 'BTCUSDT', sectionId: 'homepage_chart_card', keywords: 'btc bitcoin chart usdt' },
    { id: 'eth', label: 'ETH/USDT Live Terminal Chart', category: 'Market', view: 'Home', symbol: 'ETHUSDT', sectionId: 'homepage_chart_card', keywords: 'eth ethereum chart usdt' },
    { id: 'sol', label: 'SOL/USDT Live Terminal Chart', category: 'Market', view: 'Home', symbol: 'SOLUSDT', sectionId: 'homepage_chart_card', keywords: 'sol solana chart usdt' },
];

const PublicBrandLogo: React.FC<{ mobile?: boolean; thermalGuard?: boolean }> = ({
    mobile = false,
    thermalGuard = false,
}) => (
    <div className={`flex flex-row items-center select-none ${mobile ? 'gap-2' : 'gap-3'}`}>
        <img
            src="/logo.png"
            alt="CosmoQuantAI"
            className={`${mobile ? 'h-14' : 'h-[84px]'} w-auto object-contain shrink-0 ${thermalGuard ? '' : 'drop-shadow-[0_0_16px_rgba(99,102,241,0.55)]'}`}
        />
        <span className={`font-extrabold text-white tracking-tight whitespace-nowrap ${mobile ? 'text-base' : 'text-xl md:text-2xl'}`}>
            CosmoQuantAI
        </span>
    </div>
);

const NavLink: React.FC<{
    children: React.ReactNode;
    onClick: () => void;
    isActive: boolean;
}> = ({ children, onClick, isActive }) => (
    <button
        type="button"
        onClick={onClick}
        className={`relative px-4 py-2 text-sm font-medium transition-all duration-300 group ${isActive
            ? 'text-cyan-400'
            : 'text-slate-400 hover:text-white'
            }`}
    >
        {isActive && (
            <span className="absolute inset-0 bg-cyan-500/10 rounded-lg border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]" />
        )}
        <span className="relative z-10">{children}</span>
        <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent transition-all duration-300 ${isActive ? 'w-full' : 'w-0 group-hover:w-2/3'}`} />
    </button>
);

const PublicHeader: React.FC<{
    onLogin: () => void;
    onSignUp: () => void;
    currentView: PublicView;
    onNavigate: (view: PublicView, symbol?: string, sectionId?: string) => void;
}> = ({ onLogin, onSignUp, currentView, onNavigate }) => {
    const navItems: PublicView[] = ['Services', 'Portfolio', 'Pricing', 'Blog'];
    const mobileNavItems: PublicView[] = ['Home', 'Services', 'Portfolio', 'Pricing', 'Blog'];
    const [scrolled, setScrolled] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        const onDocClick = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setIsSearchOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsSearchOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    const searchResults = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return QUICK_JUMP_ITEMS.slice(0, 6);
        return QUICK_JUMP_ITEMS.filter(
            (item) =>
                item.label.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.keywords.toLowerCase().includes(q)
        );
    }, [searchQuery]);

    const handleSelectQuickJump = (item: QuickJumpItem) => {
        setIsSearchOpen(false);
        setSearchQuery('');
        setIsMobileMenuOpen(false);
        onNavigate(item.view, item.symbol, item.sectionId);
    };

    const navBgClass = scrolled
        ? (thermalGuard
            ? 'bg-[#050A14]/95 border-cyan-500/25 shadow-[0_0_30px_rgba(6,182,212,0.12)]'
            : 'bg-[#050A14]/70 backdrop-blur-md border-cyan-500/20 shadow-[0_0_30px_rgba(6,182,212,0.1)]')
        : (thermalGuard
            ? 'bg-[#050A14]/85 border-white/10 shadow-lg'
            : 'bg-[#050A14]/35 backdrop-blur-sm border-white/10 shadow-lg');

    return (
        <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 flex flex-col items-center ${isPhoneMobileUI ? 'pt-2 px-2.5' : 'pt-3 px-4'} pointer-events-none`}>
            <nav className={`pointer-events-auto w-full ${isPhoneMobileUI ? 'max-w-full py-1.5 px-3 rounded-xl' : `max-w-[95%] ${scrolled ? 'py-1.5 px-6 rounded-2xl' : 'py-2 px-7 rounded-2xl'}`} transition-all duration-500 border flex items-center justify-between gap-2 ${navBgClass}`}>

                {/* Left: Logo + Nav */}
                <div className="flex items-center gap-3 lg:gap-8 min-w-0">
                    {isPhoneMobileUI && (
                        <button
                            type="button"
                            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                            aria-label="Toggle public navigation"
                            className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-200 shrink-0 active:scale-95"
                        >
                            {isMobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => { onNavigate('Home'); setIsMobileMenuOpen(false); }}
                        className="transform hover:scale-[1.03] transition-transform min-w-0"
                    >
                        <PublicBrandLogo mobile={isPhoneMobileUI} thermalGuard={thermalGuard} />
                    </button>

                    <div className="hidden md:flex items-center gap-1">
                        {navItems.map((item) => (
                            <NavLink key={item} onClick={() => onNavigate(item)} isActive={currentView === item}>
                                {item}
                            </NavLink>
                        ))}
                    </div>
                </div>

                {/* Center: Working Quick-Jump Search */}
                <div ref={searchRef} className="hidden lg:block flex-1 max-w-sm mx-6 relative">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
                        </div>
                        <input
                            type="text"
                            value={searchQuery}
                            onFocus={() => setIsSearchOpen(true)}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setIsSearchOpen(true);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && searchResults.length > 0) {
                                    handleSelectQuickJump(searchResults[0]);
                                }
                            }}
                            placeholder="Jump to WallHunter, BTC, Pricing..."
                            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-9 pr-9 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-white/10 transition-all"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                aria-label="Clear quick jump search"
                                className="absolute inset-y-0 right-2.5 flex items-center text-slate-500 hover:text-white"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {isSearchOpen && (
                        <div className="absolute left-0 right-0 mt-2 rounded-2xl bg-[#070F20] border border-cyan-500/25 shadow-[0_20px_50px_rgba(0,0,0,0.75)] overflow-hidden z-50">
                            <div className="px-3.5 py-2 border-b border-white/5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                <span className="flex items-center gap-1.5"><Compass className="w-3 h-3 text-cyan-400" /> Quick Jump</span>
                                <span>Enter to select</span>
                            </div>
                            <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
                                {searchResults.length > 0 ? searchResults.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => handleSelectQuickJump(item)}
                                        className="w-full px-3.5 py-2.5 text-left flex items-center justify-between hover:bg-cyan-500/10 transition-colors group"
                                    >
                                        <div>
                                            <p className="text-xs font-semibold text-slate-200 group-hover:text-cyan-300 transition-colors">{item.label}</p>
                                            <p className="text-[10px] font-mono text-slate-500">{item.category} • {item.view}</p>
                                        </div>
                                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 shrink-0" />
                                    </button>
                                )) : (
                                    <div className="px-4 py-5 text-center text-xs text-slate-500">
                                        No matching module or pair. Try &ldquo;WallHunter&rdquo;, &ldquo;Pricing&rdquo;, or &ldquo;BTC&rdquo;.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 md:gap-3 shrink-0">
                    {deviceProfile.isPhone && !isPhoneMobileUI && (
                        <button
                            type="button"
                            onClick={() => setPhoneViewMode('mobile')}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold uppercase tracking-wider"
                        >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>Mobile UI</span>
                        </button>
                    )}

                    {/* Live system badge */}
                    <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Online</span>
                    </div>

                    <div className="w-px h-5 bg-white/10 hidden md:block" />

                    <button
                        type="button"
                        onClick={onLogin}
                        className={`${isPhoneMobileUI ? 'text-xs px-2.5 py-1.5' : 'hidden md:block text-sm px-3 py-2'} font-medium text-slate-300 hover:text-white transition-colors rounded-lg hover:bg-white/5 whitespace-nowrap`}
                    >
                        Log In
                    </button>
                    <button
                        type="button"
                        onClick={onSignUp}
                        className={`relative overflow-hidden font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] transition-all hover:scale-105 group whitespace-nowrap ${isPhoneMobileUI ? 'text-xs px-3 py-2' : 'text-sm px-5 py-2.5'}`}
                    >
                        <span className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                        Get Started
                    </button>
                </div>
            </nav>

            {/* Mobile Dropdown Menu (Phone Mobile UI only) */}
            {isPhoneMobileUI && isMobileMenuOpen && (
                <div className="pointer-events-auto mt-2 w-full rounded-xl bg-[#050A14]/95 border border-cyan-500/25 shadow-2xl p-3 space-y-2.5">
                    <div className="relative">
                        <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && searchResults.length > 0) {
                                    handleSelectQuickJump(searchResults[0]);
                                }
                            }}
                            placeholder="Quick jump: WallHunter, BTC, Pricing..."
                            className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
                        />
                    </div>
                    {searchQuery.trim() ? (
                        <div className="max-h-44 overflow-y-auto divide-y divide-white/5 rounded-lg border border-white/10 bg-[#070F20]">
                            {searchResults.length > 0 ? searchResults.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleSelectQuickJump(item)}
                                    className="w-full px-3 py-2 text-left flex items-center justify-between text-xs text-slate-200 hover:bg-cyan-500/10"
                                >
                                    <span>{item.label}</span>
                                    <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                </button>
                            )) : (
                                <div className="px-3 py-2.5 text-xs text-slate-500 text-center">No matching feature or pair.</div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                            {mobileNavItems.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => {
                                        onNavigate(item);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className={`px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors ${
                                        currentView === item
                                            ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                            : 'bg-white/5 text-slate-300 border border-white/5'
                                    }`}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="pt-1.5 border-t border-white/10 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                setIsMobileMenuOpen(false);
                                setPhoneViewMode('desktop');
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-bold"
                        >
                            <Monitor className="w-3.5 h-3.5" />
                            <span>Desktop View</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setIsMobileMenuOpen(false);
                                onLogin();
                            }}
                            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-semibold text-white"
                        >
                            Log In
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
};

const PublicFooter: React.FC<{
    onOpenLegal: (doc: LegalDocType) => void;
    onNavigateView: (view: PublicView) => void;
    onOpenBriefing: (topic?: BriefingTopic) => void;
}> = ({ onOpenLegal, onNavigateView, onOpenBriefing }) => {
    const [newsletterEmail, setNewsletterEmail] = useState('');
    const [newsletterMsg, setNewsletterMsg] = useState<{ text: string; ok: boolean } | null>(null);
    const thermalGuard = isThermalGuardActive();

    const handleSubscribe = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newsletterEmail.includes('@')) {
            setNewsletterMsg({ text: 'Please enter a valid email address.', ok: false });
            return;
        }
        setNewsletterMsg({ text: 'Subscribed! Weekly quant dispatches will arrive in your inbox.', ok: true });
        setNewsletterEmail('');
    };

    return (
        <footer className="relative bg-transparent border-t border-white/5 pt-16 pb-8 overflow-hidden">
            {!thermalGuard && (
                <>
                    <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
                    <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-500/5 rounded-full blur-[120px] pointer-events-none" />
                </>
            )}

            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
                    <div className="col-span-2 md:col-span-1">
                        <div className="mb-4">
                            <PublicBrandLogo thermalGuard={thermalGuard} />
                        </div>
                        <p className="text-sm text-slate-400 leading-relaxed">
                            Algorithmic trading SaaS uniting WallHunter liquidity telemetry, OrderFlow Heatmaps, AI Foundry, and automated cloud execution.
                        </p>
                        <div className="flex gap-2.5 mt-6">
                            <button
                                type="button"
                                onClick={() => onNavigateView('Blog')}
                                title="Quant Research Log"
                                aria-label="Quant Research Log"
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400 transition-all"
                            >
                                <Globe className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenBriefing('demo')}
                                title="Book Guided Walkthrough"
                                aria-label="Book Guided Walkthrough"
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400 transition-all"
                            >
                                <Calendar className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onNavigateView('Portfolio')}
                                title="Technical Architecture"
                                aria-label="Technical Architecture"
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400 transition-all"
                            >
                                <Github className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenBriefing('enterprise')}
                                title="Contact Desk Support"
                                aria-label="Contact Desk Support"
                                className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:border-cyan-500/40 hover:text-cyan-400 transition-all"
                            >
                                <MessageSquare className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Platform</h3>
                        <ul className="space-y-2.5">
                            {([
                                { label: 'WallHunter & Heatmaps', view: 'Services' as PublicView },
                                { label: 'AI Strategy Foundry', view: 'Services' as PublicView },
                                { label: 'Backtester & Bot Lab', view: 'Services' as PublicView },
                                { label: 'System Case Studies', view: 'Portfolio' as PublicView },
                            ]).map((item) => (
                                <li key={item.label}>
                                    <button
                                        type="button"
                                        onClick={() => onNavigateView(item.view)}
                                        className="text-sm text-slate-400 hover:text-cyan-400 transition-colors text-left"
                                    >
                                        {item.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Resources</h3>
                        <ul className="space-y-2.5">
                            {([
                                { label: 'Pricing & Specs', view: 'Pricing' as PublicView },
                                { label: 'Research Blog', view: 'Blog' as PublicView },
                                { label: 'Book a Briefing', briefing: true },
                                { label: 'Risk Disclaimer', doc: 'risk' as LegalDocType },
                            ]).map((item) => (
                                <li key={item.label}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if ('doc' in item && item.doc) {
                                                onOpenLegal(item.doc);
                                            } else if ('briefing' in item && item.briefing) {
                                                onOpenBriefing('demo');
                                            } else if ('view' in item && item.view) {
                                                onNavigateView(item.view);
                                            }
                                        }}
                                        className="text-sm text-slate-400 hover:text-cyan-400 transition-colors text-left"
                                    >
                                        {item.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Stay Updated</h3>
                        <p className="text-xs text-slate-400 mb-3">Get product updates and quant strategy notes in your inbox.</p>
                        <form onSubmit={handleSubscribe} className="flex flex-col gap-2">
                            <input
                                type="email"
                                value={newsletterEmail}
                                onChange={(e) => setNewsletterEmail(e.target.value)}
                                placeholder="Enter your email"
                                className="bg-white/5 border border-white/10 focus:border-cyan-500/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                            />
                            <button
                                type="submit"
                                className="py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 text-cyan-400 hover:from-cyan-500/30 hover:to-violet-500/30 transition-all"
                            >
                                Subscribe
                            </button>
                            {newsletterMsg && (
                                <p className={`text-[11px] ${newsletterMsg.ok ? 'text-cyan-400' : 'text-rose-400'}`}>
                                    {newsletterMsg.text}
                                </p>
                            )}
                        </form>
                    </div>
                </div>
                <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-xs text-slate-500">© {new Date().getFullYear()} CosmoQuantAI. All rights reserved.</p>
                    <div className="flex flex-wrap gap-6 text-xs text-slate-500">
                        <button type="button" onClick={() => onOpenLegal('privacy')} className="hover:text-cyan-400 transition-colors">Privacy Policy</button>
                        <button type="button" onClick={() => onOpenLegal('terms')} className="hover:text-cyan-400 transition-colors">Terms of Service</button>
                        <button type="button" onClick={() => onOpenLegal('risk')} className="hover:text-cyan-400 transition-colors">Risk Disclaimer</button>
                        <button type="button" onClick={() => onOpenLegal('cookies')} className="hover:text-cyan-400 transition-colors">Cookie Policy</button>
                    </div>
                </div>
            </div>
        </footer>
    );
};

let hasWarpedIn = false;

const PublicWebsite: React.FC<PublicWebsiteProps> = ({ onLogin, onSignUp }) => {
    const [currentView, setCurrentView] = useState<PublicView>('Home');
    const [legalDoc, setLegalDoc] = useState<LegalDocType>('terms');
    const [focusedSymbol, setFocusedSymbol] = useState<string>('BTCUSDT');
    const [focusSectionReq, setFocusSectionReq] = useState<{ id: string; nonce: number } | null>(null);
    const [briefingState, setBriefingState] = useState<{ open: boolean; topic: BriefingTopic }>({
        open: false,
        topic: 'demo',
    });

    const [shouldWarp] = useState(() => {
        if (!hasWarpedIn && typeof window !== 'undefined') {
            hasWarpedIn = true;
            return true;
        }
        return false;
    });

    const openLegal = (doc: LegalDocType) => {
        setLegalDoc(doc);
        setCurrentView('Legal');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const navigateTo = (view: PublicView, symbol?: string, sectionId?: string) => {
        if (symbol) setFocusedSymbol(symbol);
        setCurrentView(view);
        if (sectionId) {
            setFocusSectionReq({ id: sectionId, nonce: Date.now() });
        } else {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const openBriefing = (topic: BriefingTopic = 'demo') => {
        setBriefingState({ open: true, topic });
    };

    const renderContent = () => {
        switch (currentView) {
            case 'Services':
                return <ServicesPage onSignUp={onSignUp} onOpenBriefing={openBriefing} />;
            case 'Pricing':
                return <PricingPage onSelectPlan={onSignUp} onOpenBriefing={openBriefing} />;
            case 'Blog':
                return <BlogPage onSignUp={onSignUp} onOpenLegal={openLegal} />;
            case 'Portfolio':
                return <PortfolioPage onSignUp={onSignUp} onOpenBriefing={openBriefing} />;
            case 'Legal':
                return <LegalPage docType={legalDoc} onSelectDoc={setLegalDoc} onBack={() => navigateTo('Home')} />;
            case 'Home':
            default:
                return (
                    <HomePage
                        onLogin={onLogin}
                        onSignUp={onSignUp}
                        onNavigate={navigateTo}
                        onOpenBriefing={openBriefing}
                        focusedSymbol={focusedSymbol}
                        focusSectionReq={focusSectionReq}
                    />
                );
        }
    };

    return (
        <div className="flex flex-col min-h-screen bg-transparent text-white selection:bg-cyan-500/30">
            <CosmicStarBackground />
            <div className={`flex flex-col flex-grow origin-top ${shouldWarp ? 'animate-warp-in' : ''}`}>
                <PublicHeader
                    onLogin={onLogin}
                    onSignUp={onSignUp}
                    currentView={currentView}
                    onNavigate={navigateTo}
                />
                <main className="flex-grow pt-28 md:pt-32 relative z-10">
                    {renderContent()}
                </main>
                <PublicFooter
                    onOpenLegal={openLegal}
                    onNavigateView={navigateTo}
                    onOpenBriefing={openBriefing}
                />
            </div>

            <PublicBriefingModal
                isOpen={briefingState.open}
                initialTopic={briefingState.topic}
                onClose={() => setBriefingState((prev) => ({ ...prev, open: false }))}
                onSignUp={onSignUp}
            />
        </div>
    );
};

export default PublicWebsite;
