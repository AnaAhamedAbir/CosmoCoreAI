import { useCallback, useEffect, useMemo, useState } from 'react';
import { manualTradeService } from '../services/manualTradeService';
import {
  getFallbackFeeProfile,
  TradingFeeProfile,
} from '../utils/tradeFeeCalculator';

const FEE_CACHE_STORAGE_KEY = 'cosmo_manual_fee_cache_v1';
const BNB_PREF_STORAGE_KEY = 'cosmo_manual_bnb_discount_v1';
const CLIENT_FEE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedFeeEntry {
  ts: number;
  profile: TradingFeeProfile;
}

function readLocalFeeCache(cacheKey: string): TradingFeeProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(FEE_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, CachedFeeEntry>;
    const entry = map?.[cacheKey];
    if (entry && entry.profile && Date.now() - entry.ts < CLIENT_FEE_CACHE_TTL_MS) {
      return entry.profile;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeLocalFeeCache(cacheKey: string, profile: TradingFeeProfile): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(FEE_CACHE_STORAGE_KEY);
    const map: Record<string, CachedFeeEntry> = raw ? JSON.parse(raw) : {};
    const keys = Object.keys(map);
    if (keys.length >= 40) {
      delete map[keys[0]];
    }
    map[cacheKey] = { ts: Date.now(), profile };
    localStorage.setItem(FEE_CACHE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

function readBnbPref(apiId: string): boolean | null {
  if (typeof window === 'undefined' || !apiId) return null;
  try {
    const raw = localStorage.getItem(BNB_PREF_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return typeof map?.[apiId] === 'boolean' ? map[apiId] : null;
  } catch {
    return null;
  }
}

function writeBnbPref(apiId: string, enabled: boolean): void {
  if (typeof window === 'undefined' || !apiId) return;
  try {
    const raw = localStorage.getItem(BNB_PREF_STORAGE_KEY);
    const map: Record<string, boolean> = raw ? JSON.parse(raw) : {};
    map[apiId] = enabled;
    localStorage.setItem(BNB_PREF_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export interface UseTradingFeeProfileOptions {
  apiKeyId: string;
  symbol: string;
  exchangeId?: string;
  isFutures: boolean;
  isInverse: boolean;
  enabled: boolean;
}

export function useTradingFeeProfile({
  apiKeyId,
  symbol,
  exchangeId = 'binance',
  isFutures,
  isInverse,
  enabled,
}: UseTradingFeeProfileOptions) {
  const normSymbol = (symbol || '').trim().toUpperCase();
  const cacheKey = `${apiKeyId || 'anon'}:${normSymbol}`;

  const fallbackProfile = useMemo(
    () => getFallbackFeeProfile(normSymbol, exchangeId, isFutures, isInverse),
    [normSymbol, exchangeId, isFutures, isInverse]
  );

  const [fetchedProfile, setFetchedProfile] = useState<TradingFeeProfile | null>(() =>
    readLocalFeeCache(cacheKey)
  );
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [bnbDiscountEnabled, setBnbDiscountEnabledState] = useState<boolean>(() => {
    const saved = readBnbPref(apiKeyId);
    return saved !== null ? saved : false;
  });

  // Sync instant cached profile whenever API key or symbol changes
  useEffect(() => {
    const cached = readLocalFeeCache(cacheKey);
    setFetchedProfile(cached);
    const savedBnb = readBnbPref(apiKeyId);
    if (savedBnb !== null) {
      setBnbDiscountEnabledState(savedBnb);
    }
  }, [cacheKey, apiKeyId]);

  const setBnbDiscountEnabled = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setBnbDiscountEnabledState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (apiKeyId) {
          writeBnbPref(apiKeyId, resolved);
        }
        return resolved;
      });
    },
    [apiKeyId]
  );

  const fetchLiveFees = useCallback(
    async (forceRefresh: boolean = false) => {
      if (!normSymbol) return;
      const numericApiId = Number(apiKeyId);
      if (!apiKeyId || !Number.isFinite(numericApiId) || numericApiId <= 0) {
        return;
      }

      if (!forceRefresh) {
        const cached = readLocalFeeCache(cacheKey);
        if (cached) {
          setFetchedProfile(cached);
          return;
        }
      }

      setIsLoadingFees(true);
      try {
        const res = await manualTradeService.getTradingFees(
          numericApiId,
          normSymbol,
          forceRefresh
        );
        if (res && typeof res.taker_rate === 'number') {
          setFetchedProfile(res);
          writeLocalFeeCache(cacheKey, res);
          // Auto-initialize BNB toggle from live Binance account setting if user hasn't set an explicit pref yet
          if (res.bnb_burn_active !== null && readBnbPref(apiKeyId) === null) {
            setBnbDiscountEnabledState(Boolean(res.bnb_burn_active));
          }
        }
      } catch {
        // Silent fallback — UI stays responsive with deterministic default fee profile
      } finally {
        setIsLoadingFees(false);
      }
    },
    [apiKeyId, normSymbol, cacheKey]
  );

  useEffect(() => {
    if (!enabled || !normSymbol || !apiKeyId) return;
    fetchLiveFees(false);
  }, [enabled, normSymbol, apiKeyId, fetchLiveFees]);

  const feeProfile: TradingFeeProfile = useMemo(() => {
    if (
      fetchedProfile &&
      fetchedProfile.symbol === normSymbol &&
      fetchedProfile.is_futures === isFutures
    ) {
      return fetchedProfile;
    }
    return fallbackProfile;
  }, [fetchedProfile, normSymbol, isFutures, fallbackProfile]);

  return {
    feeProfile,
    isLoadingFees,
    bnbDiscountEnabled,
    setBnbDiscountEnabled,
    refreshFees: () => fetchLiveFees(true),
  };
}
