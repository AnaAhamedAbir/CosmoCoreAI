import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Clock, ChevronDown, Check, Star, Zap } from 'lucide-react';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export interface TimeframeSelectorProps {
    interval: string;
    onIntervalChange: (newInterval: string) => void;
    compact?: boolean;
}

interface TimeGroup {
    label: string;
    badge?: string;
    isSubMinute?: boolean;
    items: string[];
}

const TIME_GROUPS: TimeGroup[] = [
    { label: 'Scalp · Seconds', badge: 'LIVE', isSubMinute: true, items: ['1s', '5s', '15s', '30s'] },
    { label: 'Intraday · Minutes', items: ['1m', '3m', '5m', '15m', '30m', '45m'] },
    { label: 'Session · Hours', items: ['1h', '2h', '4h', '6h', '12h'] },
    { label: 'Macro · Swing', items: ['1d', '1w', '1M'] },
];

const ALL_TIMEFRAMES = TIME_GROUPS.flatMap((g) => g.items);
const DEFAULT_PINNED = ['5s', '1m', '5m', '15m', '1h'];
const PINNED_TF_STORAGE_KEY = 'cosmo_pinned_timeframes_v1';

function loadPinnedTimeframes(): string[] {
    if (typeof window === 'undefined') return DEFAULT_PINNED;
    try {
        const raw = localStorage.getItem(PINNED_TF_STORAGE_KEY);
        if (!raw) return DEFAULT_PINNED;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const valid = parsed.filter((tf): tf is string => typeof tf === 'string' && ALL_TIMEFRAMES.includes(tf));
            return valid.length > 0 ? valid : DEFAULT_PINNED;
        }
    } catch {}
    return DEFAULT_PINNED;
}

function savePinnedTimeframes(tfs: string[]) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(PINNED_TF_STORAGE_KEY, JSON.stringify(tfs));
    } catch {}
}

export const TimeframeSelector: React.FC<TimeframeSelectorProps> = ({
    interval,
    onIntervalChange,
    compact = false,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pinnedTimeframes, setPinnedTimeframes] = useState<string[]>(loadPinnedTimeframes);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 276 });

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const thermalGuard = isThermalGuardActive();

    const orderedPinned = useMemo(
        () => [...pinnedTimeframes].sort((a, b) => ALL_TIMEFRAMES.indexOf(a) - ALL_TIMEFRAMES.indexOf(b)),
        [pinnedTimeframes]
    );

    const isSubMinuteActive = interval.endsWith('s');
    const isIntervalPinned = orderedPinned.includes(interval);

    const computeDropdownPos = useCallback(() => {
        const anchor = triggerRef.current || containerRef.current;
        if (!anchor || typeof window === 'undefined') return;
        const rect = anchor.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(280, vw - 16);
        const left = Math.max(8, Math.min(rect.left, vw - width - 8));
        const estimatedHeight = 355;
        const spaceBelow = vh - rect.bottom - 10;
        const top =
            spaceBelow < 220 && rect.top > estimatedHeight * 0.65
                ? Math.max(8, rect.top - estimatedHeight - 8)
                : rect.bottom + 8;

        setDropdownPos({ top, left, width });
    }, []);

    const openDropdown = () => {
        computeDropdownPos();
        setIsOpen(true);
    };

    const togglePin = (tf: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setPinnedTimeframes((prev) => {
            const exists = prev.includes(tf);
            // Keep at least 1 timeframe pinned and cap at 7 so toolbar stays crisp
            if (exists && prev.length <= 1) return prev;
            const next = exists ? prev.filter((item) => item !== tf) : [...prev, tf].slice(-7);
            savePinnedTimeframes(next);
            return next;
        });
    };

    // Close on outside click or Escape
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                containerRef.current &&
                !containerRef.current.contains(target) &&
                dropdownRef.current &&
                !dropdownRef.current.contains(target)
            ) {
                setIsOpen(false);
            }
        };
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen]);

    // Re-position on external scroll/resize while open (ignore internal dropdown scroll)
    useEffect(() => {
        if (!isOpen) return;
        const handleScroll = (event: Event) => {
            if (dropdownRef.current && event.target instanceof Node && dropdownRef.current.contains(event.target)) {
                return;
            }
            computeDropdownPos();
        };
        const handleResize = () => computeDropdownPos();
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [isOpen, computeDropdownPos]);

    const dropdown = isOpen ? (
        <div
            ref={dropdownRef}
            style={{
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownPos.width,
                position: 'fixed',
                zIndex: 200000,
            }}
            className={`rounded-2xl overflow-hidden border border-slate-200 dark:border-white/15 bg-white dark:bg-[#070b14] ${
                thermalGuard ? '' : 'dark:bg-[#070b14]/95 backdrop-blur-2xl'
            } shadow-[0_24px_60px_-12px_rgba(0,0,0,0.28)] dark:shadow-[0_28px_70px_-12px_rgba(0,0,0,0.85)]`}
        >
            <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-85" />

            <div className="p-2.5 space-y-3">
                {TIME_GROUPS.map((group) => (
                    <div key={group.label}>
                        <div className="px-1.5 mb-1.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                                {group.isSubMinute && <Zap size={10} className="text-cyan-400 fill-cyan-400" />}
                                <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                    {group.label}
                                </span>
                            </div>
                            {group.badge ? (
                                <span className="text-[8px] font-mono font-black px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 tracking-wider">
                                    {group.badge}
                                </span>
                            ) : (
                                <div className="h-px flex-1 bg-slate-100 dark:bg-white/10" />
                            )}
                        </div>

                        <div className="grid grid-cols-4 gap-1">
                            {group.items.map((item) => {
                                const isSelected = interval === item;
                                const isPinned = pinnedTimeframes.includes(item);
                                return (
                                    <button
                                        key={item}
                                        type="button"
                                        onClick={() => {
                                            onIntervalChange(item);
                                            setIsOpen(false);
                                        }}
                                        className={`relative group/tf px-2 py-2 min-h-[34px] flex items-center justify-center text-xs font-mono font-bold rounded-lg border transition-all cursor-pointer active:scale-95 ${
                                            isSelected
                                                ? group.isSubMinute
                                                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.35)]'
                                                    : 'bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 border-slate-900 dark:border-cyan-400 shadow-sm'
                                                : 'bg-slate-50/70 dark:bg-white/[0.03] border-slate-200/60 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:border-cyan-500/35 hover:text-slate-950 dark:hover:text-white'
                                        }`}
                                    >
                                        <span>{item}</span>

                                        {/* Star pin button on hover or when pinned */}
                                        <span
                                            role="button"
                                            tabIndex={-1}
                                            onClick={(e) => togglePin(item, e)}
                                            title={isPinned ? 'Unpin from quick bar' : 'Pin to quick bar'}
                                            className={`absolute top-0.5 right-0.5 p-0.5 rounded transition-opacity ${
                                                isPinned
                                                    ? isSelected
                                                        ? 'opacity-100 text-slate-950'
                                                        : 'opacity-100 text-amber-400'
                                                    : 'opacity-45 sm:opacity-0 sm:group-hover/tf:opacity-80 text-slate-400 hover:text-amber-400'
                                            }`}
                                        >
                                            <Star size={8} className={isPinned ? 'fill-current' : ''} />
                                        </span>

                                        {isSelected && (
                                            <span className="absolute -bottom-1 -right-1 bg-white dark:bg-[#070b14] text-cyan-600 dark:text-cyan-400 rounded-full p-0.5 shadow border border-cyan-500/30">
                                                <Check size={7} strokeWidth={4} />
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="px-3 py-1.5 border-t border-slate-100 dark:border-white/10 bg-slate-50/80 dark:bg-[#050810] flex items-center justify-between text-[9px] font-mono text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1">
                    <Star size={9} className="text-amber-400 fill-amber-400" />
                    Pin up to 7 to quick bar
                </span>
                <span>ESC</span>
            </div>
        </div>
    ) : null;

    if (compact) {
        return (
            <div ref={containerRef} className="relative">
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
                    className={`flex items-center gap-1.5 px-2 py-1 h-8 rounded-lg border transition-all cursor-pointer ${
                        isOpen
                            ? 'bg-white dark:bg-[#0b101d] border-cyan-500/70 shadow-[0_0_0_2px_rgba(6,182,212,0.16)]'
                            : 'bg-white dark:bg-[#0b101d] border-slate-200 dark:border-white/10 hover:border-cyan-500/45'
                    }`}
                >
                    {isSubMinuteActive ? (
                        <Zap size={12} className="text-cyan-500 dark:text-cyan-400 fill-cyan-400/30" />
                    ) : (
                        <Clock size={12} className="text-slate-400" />
                    )}
                    <span className="text-xs font-mono font-black text-slate-900 dark:text-white">{interval}</span>
                    <ChevronDown
                        size={12}
                        className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyan-400' : ''}`}
                    />
                </button>
                {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={`inline-flex items-center h-10 p-1 rounded-xl border transition-all bg-white dark:bg-[#0b101d] ${
                isOpen
                    ? 'border-cyan-500/70 shadow-[0_0_0_2px_rgba(6,182,212,0.16)]'
                    : 'border-slate-200 dark:border-white/10 hover:border-cyan-500/35'
            }`}
        >
            {/* 1-Click Pinned Quick-Access Bar (TradingView Pro style, visible sm+) */}
            <div className="hidden sm:flex items-center gap-0.5 pr-1">
                {orderedPinned.map((tf) => {
                    const isSelected = interval === tf;
                    const isSec = tf.endsWith('s');
                    return (
                        <button
                            key={tf}
                            type="button"
                            onClick={() => onIntervalChange(tf)}
                            className={`px-2 py-1 h-7 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer flex items-center gap-0.5 ${
                                isSelected
                                    ? isSec
                                        ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                                        : 'bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 shadow-sm'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
                            }`}
                            title={`Switch to ${tf} candles`}
                        >
                            {isSec && (
                                <Zap
                                    size={9}
                                    className={isSelected ? 'text-slate-950 fill-slate-950' : 'text-cyan-500 dark:text-cyan-400'}
                                />
                            )}
                            <span>{tf}</span>
                        </button>
                    );
                })}
            </div>

            {/* Divider on desktop */}
            <div className="hidden sm:block w-px h-5 bg-slate-200 dark:bg-white/10 mx-0.5" />

            {/* Popover Trigger (shows active interval on mobile or when current interval is not pinned) */}
            <button
                ref={triggerRef}
                type="button"
                onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
                className={`flex items-center gap-1.5 px-2 h-7 rounded-lg transition-colors cursor-pointer ${
                    isOpen
                        ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                        : !isIntervalPinned
                          ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 font-bold'
                          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="All timeframes & customize quick bar"
            >
                <span className={`${isIntervalPinned ? 'flex sm:hidden' : 'flex'} items-center gap-1 text-xs font-mono font-black`}>
                    {isSubMinuteActive ? (
                        <Zap size={11} className="text-cyan-500 dark:text-cyan-400 fill-cyan-400/30" />
                    ) : (
                        <Clock size={11} />
                    )}
                    <span>{interval}</span>
                </span>
                <ChevronDown
                    size={13}
                    className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-cyan-400' : ''}`}
                />
            </button>

            {/* Portal escapes overflow:hidden parents */}
            {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
        </div>
    );
};
