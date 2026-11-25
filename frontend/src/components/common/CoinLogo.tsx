import React, { useMemo, useState, useEffect } from 'react';

const BUNDLED_COIN_SYMBOLS = new Set([
    'btc', 'eth', 'sol', 'bnb', 'xrp', 'ada', 'doge', 'avax',
    'dot', 'link', 'uni', 'ltc', 'trx', 'shib', 'sui', 'apt',
    'sei', 'matic', 'usdt', 'usdc', 'pepe', 'ton', 'arb',
]);

const SYMBOL_ALIAS: Record<string, string> = {
    pol: 'matic',
};

const BADGE_PALETTE = [
    'from-cyan-500/30 to-blue-600/30 border-cyan-400/40 text-cyan-200',
    'from-violet-500/30 to-fuchsia-600/30 border-violet-400/40 text-violet-200',
    'from-emerald-500/30 to-teal-600/30 border-emerald-400/40 text-emerald-200',
    'from-amber-500/30 to-orange-600/30 border-amber-400/40 text-amber-200',
    'from-rose-500/30 to-pink-600/30 border-rose-400/40 text-rose-200',
];

export const normalizeCoinSymbol = (rawSymbol: string): string => {
    const cleaned = String(rawSymbol || '')
        .split('/')[0]
        .split(':')[0]
        .trim()
        .toLowerCase();
    return SYMBOL_ALIAS[cleaned] || cleaned;
};

interface CoinLogoProps {
    symbol: string;
    logoUrl?: string | null;
    className?: string;
}

const CoinLogo: React.FC<CoinLogoProps> = ({
    symbol,
    logoUrl,
    className = 'h-5 w-5',
}) => {
    const baseLower = normalizeCoinSymbol(symbol);
    const displayCode = String(symbol || '?')
        .split('/')[0]
        .split(':')[0]
        .trim()
        .toUpperCase()
        .slice(0, 3);

    const candidates = useMemo(() => {
        const list: string[] = [];
        if (BUNDLED_COIN_SYMBOLS.has(baseLower)) {
            list.push(`/coins/${baseLower}.png`);
        }
        if (logoUrl && !list.includes(logoUrl)) {
            list.push(logoUrl);
        }
        return list;
    }, [baseLower, logoUrl]);

    const [attemptIdx, setAttemptIdx] = useState(0);

    useEffect(() => {
        setAttemptIdx(0);
    }, [baseLower, logoUrl]);

    const currentSrc = candidates[attemptIdx];
    const paletteClass = BADGE_PALETTE[
        (baseLower.charCodeAt(0) || 0) % BADGE_PALETTE.length
    ];

    if (!currentSrc) {
        return (
            <span
                aria-label={displayCode}
                className={`${className} rounded-full bg-gradient-to-br ${paletteClass} border inline-flex items-center justify-center font-mono font-extrabold text-[8px] leading-none shrink-0 select-none`}
            >
                {displayCode}
            </span>
        );
    }

    return (
        <img
            src={currentSrc}
            alt={displayCode}
            loading="lazy"
            decoding="async"
            onError={() => setAttemptIdx((prev) => prev + 1)}
            className={`${className} rounded-full object-contain shrink-0 select-none`}
        />
    );
};

export default CoinLogo;
