import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Button from '@/components/common/Button';
import { Loader2, RefreshCw, TrendingUp, Newspaper, Activity, Fish, FileText, Smartphone, X, BrainCircuit, GripVertical } from 'lucide-react';

interface SentimentCommandCenterProps {
    report: {
        score_analysis: string;
        news_summary: string;
        correlation_insight: string;
        whale_insight: string;
        executive_summary: string;
    } | null;
    isLoading: boolean;
    onGenerate: (language: 'en' | 'bn') => void;
}

export const SentimentCommandCenter: React.FC<SentimentCommandCenterProps> = React.memo(({
    report,
    isLoading,
    onGenerate
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [language, setLanguage] = useState<'en' | 'bn'>('en');

    // Clamp floating button coordinates within active viewport (Galaxy A34, Redmi Pad 2 Pro, Desktop)
    const clampPos = useCallback((x: number, y: number) => {
        if (typeof window === 'undefined') return { x, y };
        const btnSize = window.innerWidth < 640 ? 52 : 68;
        return {
            x: Math.max(8, Math.min(x, window.innerWidth - btnSize)),
            y: Math.max(8, Math.min(y, window.innerHeight - btnSize)),
        };
    }, []);

    const [position, setPosition] = useState(() =>
        typeof window !== 'undefined' ? clampPos(window.innerWidth - 84, 125) : { x: 1000, y: 125 }
    );
    const [isDragging, setIsDragging] = useState(false);

    // Synchronous drag refs (zero async useEffect latency on Android touchscreens)
    const activePointerIdRef = useRef<number | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const startPointRef = useRef({ x: 0, y: 0 });
    const latestPosRef = useRef(position);
    const wasDraggedRef = useRef(false);
    const dragResetTimerRef = useRef<number | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Load saved position from localStorage (clamped to current viewport)
    useEffect(() => {
        const savedPos = localStorage.getItem('sentimentWidgetPos_v2');
        if (savedPos) {
            try {
                const parsed = JSON.parse(savedPos);
                const clamped = clampPos(Number(parsed.x) || 0, Number(parsed.y) || 125);
                setPosition(clamped);
                latestPosRef.current = clamped;
            } catch {
                // Invalid JSON, ignore
            }
        }
    }, [clampPos]);

    // Keep floating button inside viewport when rotating phone/tablet
    useEffect(() => {
        const handleResize = () => {
            const clamped = clampPos(latestPosRef.current.x, latestPosRef.current.y);
            if (clamped.x !== latestPosRef.current.x || clamped.y !== latestPosRef.current.y) {
                latestPosRef.current = clamped;
                if (buttonRef.current) {
                    buttonRef.current.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0)`;
                }
                setPosition(clamped);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (dragResetTimerRef.current !== null) {
                window.clearTimeout(dragResetTimerRef.current);
            }
        };
    }, [clampPos]);

    const applyTransform = (x: number, y: number) => {
        if (buttonRef.current) {
            buttonRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!buttonRef.current) return;
        if (dragResetTimerRef.current !== null) {
            window.clearTimeout(dragResetTimerRef.current);
            dragResetTimerRef.current = null;
        }
        // Capture pointer synchronously so fast touch swipes on Android Chrome stay locked to this button
        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
            // ignore if pointer already lost
        }
        const rect = buttonRef.current.getBoundingClientRect();
        activePointerIdRef.current = e.pointerId;
        dragOffsetRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
        startPointRef.current = { x: e.clientX, y: e.clientY };
        wasDraggedRef.current = false;
        setIsDragging(true);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;
        if (
            Math.abs(e.clientX - startPointRef.current.x) > 5 ||
            Math.abs(e.clientY - startPointRef.current.y) > 5
        ) {
            wasDraggedRef.current = true;
        }
        const next = clampPos(
            e.clientX - dragOffsetRef.current.x,
            e.clientY - dragOffsetRef.current.y
        );
        latestPosRef.current = next;
        // Direct GPU transform update for locked 120Hz tracking without React re-renders per frame
        applyTransform(next.x, next.y);
    };

    const finishDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;
        activePointerIdRef.current = null;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch {
            // ignore
        }
        setIsDragging(false);
        const finalPos = latestPosRef.current;
        setPosition(finalPos);
        try {
            localStorage.setItem('sentimentWidgetPos_v2', JSON.stringify(finalPos));
        } catch {
            // ignore storage errors
        }
        if (wasDraggedRef.current) {
            dragResetTimerRef.current = window.setTimeout(() => {
                wasDraggedRef.current = false;
                dragResetTimerRef.current = null;
            }, 120);
        }
    };

    // Tap to open (suppressed if pointer moved beyond tap threshold)
    const handleClick = () => {
        if (wasDraggedRef.current) {
            wasDraggedRef.current = false;
            return;
        }
        setIsOpen(true);
    };

    const handleGenerate = () => {
        onGenerate(language);
    };

    const sections = [
        {
            title: 'Sentiment Score Analysis',
            icon: <TrendingUp className="w-5 h-5 text-blue-500" />,
            content: report?.score_analysis,
            color: 'border-blue-500/20'
        },
        {
            title: 'News Narrative',
            icon: <Newspaper className="w-5 h-5 text-purple-500" />,
            content: report?.news_summary,
            color: 'border-purple-500/20'
        },
        {
            title: 'Correlation Insight',
            icon: <Activity className="w-5 h-5 text-green-500" />,
            content: report?.correlation_insight,
            color: 'border-green-500/20'
        },
        {
            title: 'Whale Activity',
            icon: <Fish className="w-5 h-5 text-amber-500" />,
            content: report?.whale_insight,
            color: 'border-amber-500/20'
        }
    ];

    // Main Floating Button Component (GPU translate3d positioning + synchronous touch pointer capture)
    const FloatingButton = (
        <button
            ref={buttonRef}
            type="button"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onContextMenu={(e) => e.preventDefault()}
            onClick={handleClick}
            style={{
                left: 0,
                top: 0,
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
            }}
            className="fixed z-[60] cosmo-gpu-floating-drag group focus:outline-none"
            title="Open AI Command Center (Drag to move)"
            aria-label="Open AI Command Center"
        >
            <div
                className={`relative w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-full shadow-2xl flex items-center justify-center text-white border-2 sm:border-4 border-white/20 pointer-events-none transition-transform duration-150 ${isDragging ? 'scale-110 shadow-indigo-500/50' : 'group-hover:scale-105 group-active:scale-95'}`}
            >
                <BrainCircuit className="w-6 h-6 sm:w-8 sm:h-8 pointer-events-none group-hover:rotate-12 transition-transform" />

                {/* Drag Indicator hint */}
                <div className="absolute -right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-50 transition-opacity pointer-events-none">
                    <GripVertical className="w-4 h-4 text-white" />
                </div>

                {/* GPU-safe live dot if no report yet */}
                {!report && !isLoading && (
                    <span className="absolute top-0 right-0 w-3.5 h-3.5 sm:w-4 sm:h-4 bg-red-500 rounded-full border-2 border-white cosmo-live-dot pointer-events-none"></span>
                )}
            </div>
        </button>
    );

    // Modal Component
    const Modal = (
        <div
            className="fixed inset-0 bg-[#050505]/70 sm:bg-[#050505]/60 sm:backdrop-blur-sm z-[110] flex items-center justify-center p-2.5 sm:p-4 animate-in fade-in duration-200"
            onClick={() => setIsOpen(false)}
        >
            <div
                className="bg-white dark:bg-[#050505] w-full max-w-5xl max-h-[92dvh] rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden flex flex-col relative animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="p-3.5 sm:p-5 border-b border-slate-200 dark:border-[#141414] flex flex-wrap items-center justify-between gap-2.5 bg-slate-50 dark:bg-[#0A0A0A]/50">
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div className="p-2 sm:p-2.5 bg-indigo-500/10 rounded-xl shrink-0">
                            <Smartphone className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base sm:text-xl font-bold text-slate-800 dark:text-slate-100 truncate">
                                Interactive AI Command Center
                            </h3>
                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"></span>
                                <span className="truncate">Real-time Market Narrative & Strategic Analysis</span>
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 ml-auto">
                        {/* Language Toggle */}
                        <div className="flex bg-slate-100 dark:bg-[#141414] border border-slate-200 dark:border-white/10 rounded-lg p-1">
                            <button
                                onClick={() => setLanguage('en')}
                                className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-bold transition-colors ${language === 'en' ? 'bg-white dark:bg-[#0A0A0A] shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                            >
                                EN
                            </button>
                            <button
                                onClick={() => setLanguage('bn')}
                                className={`px-2.5 sm:px-3 py-1 rounded-md text-xs font-bold transition-colors ${language === 'bn' ? 'bg-white dark:bg-[#0A0A0A] shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
                            >
                                BN
                            </button>
                        </div>

                        <Button
                            size="sm"
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-4 h-4 mr-1.5" />
                                    Generate
                                </>
                            )}
                        </Button>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-[#0A0A0A] text-slate-500 transition-colors"
                            aria-label="Close modal"
                        >
                            <X className="w-5 h-5 sm:w-6 sm:h-6" />
                        </button>
                    </div>
                </div>

                {/* Modal Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar touch-pan-y overscroll-y-contain">
                    {!report && !isLoading ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 min-h-[260px]">
                            <div className="p-5 sm:p-6 bg-slate-100 dark:bg-[#0A0A0A] rounded-full mb-5">
                                <BrainCircuit className="w-12 h-12 sm:w-16 sm:h-16 text-indigo-400 opacity-50" />
                            </div>
                            <h4 className="text-lg sm:text-xl font-semibold mb-2">Ready to Analyze</h4>
                            <p className="text-center text-sm max-w-md mb-6">
                                Generate a comprehensive market report combining sentiment, news, whale activity, and correlation logic.
                            </p>
                            <Button onClick={handleGenerate} className="bg-indigo-600 text-white px-7">
                                Start Analysis ({language === 'en' ? 'English' : 'Bengali'})
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-6 sm:space-y-8">
                            {/* Executive Summary (Hero Section) */}
                            <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 dark:from-slate-800 dark:via-slate-800/80 dark:to-slate-800 p-4 sm:p-6 rounded-2xl border border-indigo-100 dark:border-[#1F1F1F] relative overflow-hidden shadow-sm">
                                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                    <FileText className="w-28 h-28 sm:w-32 sm:h-32 text-indigo-600" />
                                </div>
                                <h4 className="text-xs sm:text-sm font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider mb-3 sm:mb-4 flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                    Executive Summary
                                </h4>
                                <div className="text-sm sm:text-lg text-slate-800 dark:text-slate-200 leading-relaxed font-medium relative z-10">
                                    {isLoading ? (
                                        <div className="space-y-2">
                                            <span className="animate-pulse block h-4 w-full bg-slate-200 dark:bg-[#0A0A0A] rounded"></span>
                                            <span className="animate-pulse block h-4 w-3/4 bg-slate-200 dark:bg-[#0A0A0A] rounded"></span>
                                        </div>
                                    ) : report?.executive_summary}
                                </div>
                            </div>

                            {/* Grid Sections */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                                {sections.map((section, idx) => (
                                    <div
                                        key={idx}
                                        className={`p-4 sm:p-6 rounded-2xl border ${section.color} bg-white dark:bg-[#0A0A0A]/40 hover:bg-slate-50 dark:hover:bg-[#0A0A0A] transition-colors shadow-sm`}
                                    >
                                        <div className="flex items-center gap-3 mb-3 sm:mb-4">
                                            <div className={`p-2 rounded-lg ${section.color.replace('border-', 'bg-')}`}>
                                                {section.icon}
                                            </div>
                                            <h4 className="font-bold text-slate-700 dark:text-slate-200 text-base sm:text-lg">
                                                {section.title}
                                            </h4>
                                        </div>
                                        <div className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                                            {isLoading ? (
                                                <div className="space-y-2">
                                                    <span className="animate-pulse block h-3 w-full bg-slate-100 dark:bg-[#0A0A0A] rounded"></span>
                                                    <span className="animate-pulse block h-3 w-5/6 bg-slate-100 dark:bg-[#0A0A0A] rounded"></span>
                                                    <span className="animate-pulse block h-3 w-4/6 bg-slate-100 dark:bg-[#0A0A0A] rounded"></span>
                                                </div>
                                            ) : (
                                                section.content || "Data unavailable"
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    // Return both via portal
    return (
        <>
            {createPortal(FloatingButton, document.body)}
            {isOpen && createPortal(Modal, document.body)}
        </>
    );
});
