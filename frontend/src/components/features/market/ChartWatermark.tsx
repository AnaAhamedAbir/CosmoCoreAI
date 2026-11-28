import React from 'react';

interface ChartWatermarkProps {
    leftAxisOffset?: number;
    rightAxisOffset?: number;
    compact?: boolean;
}

/**
 * Binance-style centered institutional chart watermark ("CosmoQuant").
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
            className="absolute inset-0 z-[1] pointer-events-none select-none flex items-center justify-center overflow-hidden"
            style={{
                left: leftAxisOffset,
                right: rightAxisOffset,
                bottom: 26,
            }}
        >
            <div className="flex items-center gap-2.5 sm:gap-3.5 text-slate-900/[0.065] dark:text-white/[0.055]">
                {/* Minimalist CosmoQuant Geometric Mark (Binance-inspired crisp vector) */}
                <svg
                    viewBox="0 0 40 40"
                    fill="none"
                    className={compact ? 'w-7 h-7 shrink-0' : 'w-10 h-10 sm:w-12 sm:h-12 shrink-0'}
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
                        className={`font-sans font-extrabold tracking-[0.14em] uppercase ${
                            compact
                                ? 'text-[22px]'
                                : 'text-[28px] sm:text-[38px] md:text-[46px]'
                        }`}
                    >
                        CosmoQuant
                    </span>
                </div>
            </div>
        </div>
    );
});
