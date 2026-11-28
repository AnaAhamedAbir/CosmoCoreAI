import React from 'react';

interface ChartWatermarkProps {
    leftAxisOffset?: number;
    rightAxisOffset?: number;
    compact?: boolean;
}

/**
 * Binance-style bottom-left institutional chart watermark ("CosmoQuantAI").
 * Renders cleanly behind the transparent Lightweight Charts canvas and L2 Heatmap
 * with zero pointer interference and ultra-lightweight GPU cost on mobile/tablet Chrome.
 */
export const ChartWatermark: React.FC<ChartWatermarkProps> = React.memo(({
    leftAxisOffset = 0,
    rightAxisOffset = 64,
    compact = false,
}) => {
    return (
        <div
            aria-hidden="true"
            className="absolute inset-0 z-[1] pointer-events-none select-none flex items-end justify-start overflow-hidden pl-3 pb-2.5 sm:pl-5 sm:pb-3.5"
            style={{
                left: leftAxisOffset,
                right: rightAxisOffset,
                bottom: 26,
            }}
        >
            <div className="flex items-center gap-2 sm:gap-2.5 text-slate-900/[0.16] dark:text-white/[0.15]">
                {/* Minimalist CosmoQuantAI Geometric Mark (Binance-inspired crisp vector) */}
                <svg
                    viewBox="0 0 40 40"
                    fill="none"
                    className={compact ? 'w-5 h-5 shrink-0' : 'w-6 h-6 sm:w-7 sm:h-7 shrink-0'}
                >
                    <path
                        d="M20 3L35 20L20 37L5 20L20 3Z"
                        stroke="currentColor"
                        strokeWidth="2.8"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M20 10.5L28 20L20 29.5L12 20L20 10.5Z"
                        fill="currentColor"
                    />
                    <circle cx="20" cy="3" r="2.2" fill="currentColor" />
                    <circle cx="35" cy="20" r="2.2" fill="currentColor" />
                    <circle cx="20" cy="37" r="2.2" fill="currentColor" />
                    <circle cx="5" cy="20" r="2.2" fill="currentColor" />
                </svg>

                <div className="flex flex-col leading-none">
                    <span
                        className={`font-sans font-extrabold tracking-[0.05em] ${
                            compact
                                ? 'text-[15px]'
                                : 'text-[18px] sm:text-[22px] md:text-[24px]'
                        }`}
                    >
                        CosmoQuantAI
                    </span>
                </div>
            </div>
        </div>
    );
});
