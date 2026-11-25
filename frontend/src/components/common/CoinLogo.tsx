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

// Shared singleton CoinGecko logo cache across the entire SPA
let sharedLogoMap: Record<string, string> = {};
let logoFetchStarted = false;
const logoSubscribers = new Set<(map: Record<string, string>) => void>();

export const ensureCoinLogoMapLoaded = (): void => {
    if (logoFetchStarted || typeof window === 'undefined') return;
    logoFetchStarted = true;
    fetch('/api/v1/market-data/coin-logos')
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
            if (payload && typeof payload.logos === 'object' && payload.logos) {
                sharedLogoMap = payload.logos;
                logoSubscribers.forEach((cb) => cb(sharedLogoMap));
            }
        })
        .catch(() => {
            // Allow future retry if initial request failed offline
            logoFetchStarted = false;
        });
};

export const useSharedCoinLogoMap = (): Record<string, string> => {
    const [map, setMap] = useState<Record<string, string>>(() => sharedLogoMap);

    useEffect(() => {
        ensureCoinLogoMapLoaded();
        if (Object.keys(sharedLogoMap).length > 0) {
            setMap(sharedLogoMap);
        }
        const listener = (next: Record<string, string>) => setMap(next);
        logoSubscribers.add(listener);
        return () => {
            logoSubscribers.delete(listener);
        };
    }, []);

    return map;
};

export const normalizeCoinSymbol = (rawSymbol: string): string => {
    let base = String(rawSymbol || '')
        .split('/')[0]
        .split(':')[0]
        .trim();

    // Strip lowercase "k" multiplier prefix (e.g., kPEPE, kSHIB) before uppercasing
    if (/^k[A-Z0-9]{2,}/.test(base)) {
        base = base.slice(1);
    }

    base = base.toUpperCase();

    // Handle joined pair symbols like BTCUSDT, ETHUSDT when "/" is absent
    if (base.length > 4 && (base.endsWith('USDT') || base.endsWith('USDC') || base.endsWith('BUSD'))) {
        base = base.slice(0, -4);
    }

    // Strip Futures contract multiplier prefixes (e.g., 1000PEPE, 1000BONK, 1MBABYDOGE)
    const multMatch = base.match(/^(?:1000000|100000|10000|1000|1M)([A-Z0-9]{2,})$/);
    if (multMatch) {
        base = multMatch[1];
    }

    if (base === 'XBT') base = 'BTC';

    const lower = base.toLowerCase();
    return SYMBOL_ALIAS[lower] || lower;
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
    const sharedMap = useSharedCoinLogoMap();
    const baseLower = normalizeCoinSymbol(symbol);
    const baseUpper = baseLower.toUpperCase();
    const displayCode = baseUpper.slice(0, 3) || '?';
    const resolvedRemoteUrl = logoUrl || sharedMap[baseUpper] || null;

    const candidates = useMemo(() => {
        const list: string[] = [];
        if (BUNDLED_COIN_SYMBOLS.has(baseLower)) {
            list.push(`/coins/${baseLower}.png`);
        }
        if (resolvedRemoteUrl && !list.includes(resolvedRemoteUrl)) {
            list.push(resolvedRemoteUrl);
        }
        return list;
    }, [baseLower, resolvedRemoteUrl]);

    const [attemptIdx, setAttemptIdx] = useState(0);

    useEffect(() => {
        setAttemptIdx(0);
    }, [baseLower, resolvedRemoteUrl]);

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
