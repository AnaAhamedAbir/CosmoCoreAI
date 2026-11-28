import api from './api';

export interface OrderPayload {
  symbol: string;
  side: 'Buy' | 'Sell';
  type: 'Market' | 'Limit' | 'SmartPeg';
  amount: number;
  price?: number;
  exchange_id: string;
  api_key_id?: number | null;
  params?: {
    leverage?: number;
    marginMode?: 'cross' | 'isolated';
    reduceOnly?: boolean;
    maxChaseDeviationPct?: number;
    pegAnchorPrice?: number;
    pegStrategy?: 'bbo' | 'inside_spread' | 'wall_aware';
    wallMultiplier?: number;
    wallFrontRunTicks?: number;
    antiSpoofGuard?: boolean;
    contracts?: number;
    positionSide?: string;
    timeInForce?: string;
  };
  client_timestamp?: number;
  attached_tp?: {
    enabled: boolean;
    mode: 'percentage' | 'price' | 'absolute';
    value: number;
    order_type: 'Limit' | 'Market';
    timeout_mins?: number | null;
    strict_maker?: boolean;
  };
  attached_sl?: {
    enabled: boolean;
    type: 'fixed' | 'trailing' | 'smart_chase' | 'trailing_chase';
    mode: 'percentage' | 'price' | 'absolute' | 'atr';
    value: number;
    timeout_mins?: number | null;
    atr_period?: number;
    atr_multiplier?: number;
    atr_timeframe?: string;
    smart_chase_deviation_pct?: number;
    smart_chase_delay_ms?: number;
    smart_chase_max_attempts?: number;
    smart_chase_mode?: 'dynamic_bbo' | 'interval';
    smart_chase_trigger_source?: 'last' | 'bid_ask';
    smart_chase_peg_strategy?: 'bbo' | 'inside_spread' | 'wall_aware';
    smart_chase_wall_multiplier?: number;
    auto_breakeven_enabled?: boolean;
    auto_breakeven_trigger_pct?: number;
    auto_breakeven_buffer_pct?: number;
    anti_wick_mode?: 'instant' | 'dwell' | 'candle_close';
    anti_wick_dwell_seconds?: number;
    anti_wick_timeframe?: '1m' | '3m' | '5m' | '15m';
    anti_wick_disaster_pct?: number;
  };
  use_native_tp_sl?: boolean;
  iceberg_qty?: number;
  enable_ml_filter?: boolean;
  ml_model_id?: string;
  ml_execution_mode?: 'basic' | 'advanced';
  ml_bullish_threshold?: number;
  ml_bearish_threshold?: number;
  confirm_high_latency?: boolean;
}

export interface ApiKey {
  id: number;
  exchange: string;
  api_key: string;
  name?: string;
  key_name?: string;
  label?: string; // Sometimes the backend returns name/label, we fallback to formatting if absent
}

export interface FastBalanceResponse {
  base: string;
  base_free: number;
  base_used?: number;
  base_total?: number;
  quote: string;
  quote_free: number;
  quote_used?: number;
  quote_total?: number;
  settle?: string;
  is_futures: boolean;
  is_inverse?: boolean;
  contract_size?: number;
  spot_free?: number;
  usds_futures_free?: number;
}

export interface FastPositionResponse {
  amount: number;
  contracts?: number;
  contract_size?: number;
  is_inverse?: boolean;
  side: 'long' | 'short' | 'none';
  entry_price?: number;
  mark_price?: number;
  liquidation_price?: number;
  leverage?: number | null;
  margin_mode?: string | null;
  unrealized_pnl?: number;
  pnl_pct?: number;
}

export interface MlLivePreviewResponse {
  status: string;
  symbol?: string;
  model_id?: string;
  model_name?: string;
  signal?: string;
  bullish_pct?: number;
  bearish_pct?: number;
  flow_bull_pct?: number | null;
  flow_bear_pct?: number | null;
  l2_bid_pct?: number | null;
  l2_ask_pct?: number | null;
  buy_ready?: boolean;
  sell_ready?: boolean;
  updated_at?: number;
}

export interface TradingFeeResponse {
  symbol: string;
  exchange: string;
  market_type: 'spot' | 'usdm_futures' | 'coinm_futures';
  is_futures: boolean;
  is_inverse: boolean;
  base: string;
  quote: string;
  settle: string;
  maker_rate: number;
  taker_rate: number;
  bnb_discount_supported: boolean;
  bnb_discount_rate: number;
  bnb_burn_active: boolean | null;
  source: 'live_api' | 'market_meta' | 'estimated_default';
  tier_label: string;
  cached?: boolean;
  updated_at?: number;
}

// In-flight request coalescing & 350ms micro-cache to prevent multi-component polling storms
const _inflightPolls = new Map<string, Promise<any>>();
const _pollMicroCache = new Map<string, { ts: number; data: any }>();
const POLL_MICRO_CACHE_TTL_MS = 350;

function _coalescedPoll<T>(key: string, fetcher: () => Promise<T>, bypassCache = false): Promise<T> {
  const now = Date.now();
  if (!bypassCache) {
    const cached = _pollMicroCache.get(key);
    if (cached && now - cached.ts < POLL_MICRO_CACHE_TTL_MS) {
      return Promise.resolve(cached.data as T);
    }
  }
  const existing = _inflightPolls.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const p = fetcher()
    .then((data) => {
      _pollMicroCache.set(key, { ts: Date.now(), data });
      return data;
    })
    .finally(() => {
      _inflightPolls.delete(key);
    });
  _inflightPolls.set(key, p);
  return p;
}

export function invalidateTradingPollCache(apiKeyId?: number | string | null): void {
  if (apiKeyId === undefined || apiKeyId === null) {
    _pollMicroCache.clear();
    return;
  }
  const prefix = `:${String(apiKeyId)}:`;
  for (const k of Array.from(_pollMicroCache.keys())) {
    if (k.includes(prefix)) {
      _pollMicroCache.delete(k);
    }
  }
}

export const manualTradeService = {
  invalidatePollCache: invalidateTradingPollCache,

  getApiKeys: async () => {
    const response = await api.get('/users/api-keys');
    return response.data as ApiKey[];
  },

  getFastBalance: async (apiKeyId: number, symbol: string, forceRefresh: boolean = false) => {
    const key = `bal:${apiKeyId}:${symbol.trim().toUpperCase()}`;
    return _coalescedPoll(
      key,
      async () => {
        const response = await api.get(
          `/trading/api-key-balance/${apiKeyId}?symbol=${encodeURIComponent(symbol)}${forceRefresh ? '&force_refresh=true' : ''}`
        );
        return response.data as FastBalanceResponse;
      },
      forceRefresh
    );
  },

  getTradingFees: async (apiKeyId: number, symbol: string, forceRefresh: boolean = false) => {
    const key = `fee:${apiKeyId}:${symbol.trim().toUpperCase()}`;
    return _coalescedPoll(
      key,
      async () => {
        const response = await api.get(
          `/trading/api-key-fees/${apiKeyId}?symbol=${encodeURIComponent(symbol)}${forceRefresh ? '&force_refresh=true' : ''}`
        );
        return response.data as TradingFeeResponse;
      },
      forceRefresh
    );
  },

  getActivePosition: async (apiKeyId: number, symbol: string, forceRefresh: boolean = false) => {
    const key = `pos:${apiKeyId}:${symbol.trim().toUpperCase()}`;
    return _coalescedPoll(
      key,
      async () => {
        const response = await api.get(
          `/trading/api-key-position/${apiKeyId}?symbol=${encodeURIComponent(symbol)}${forceRefresh ? '&force_refresh=true' : ''}`
        );
        return response.data as FastPositionResponse;
      },
      forceRefresh
    );
  },

  placeOrder: async (order: OrderPayload) => {
    // lowercase the side to match typical backend expectations ('buy' or 'sell')
    const formattedOrder = {
      ...order,
      side: order.side.toLowerCase(),
      type: order.type === 'SmartPeg' ? 'smart_peg' : order.type.toLowerCase(),
    };
    
    const response = await api.post('/trading/order', formattedOrder);
    invalidateTradingPollCache(order.api_key_id);
    return response.data;
  },

  editOrder: async (apiKeyId: number, orderId: string, payload: { symbol: string, side: string, amount: number, new_price: number }) => {
    // side matching typical backend expectations
    const formattedPayload = {
      ...payload,
      side: payload.side.toLowerCase(),
    };
    const response = await api.put(`/trading/order/${apiKeyId}/${orderId}`, formattedPayload);
    invalidateTradingPollCache(apiKeyId);
    return response.data;
  },

  updateSoftwareSL: async (apiKeyId: number, slId: string, payload: { symbol: string, side: string, new_price: number, amount?: number }) => {
    const formattedPayload = {
      ...payload,
      side: payload.side.toLowerCase(),
    };
    const response = await api.put(`/trading/software-bracket/${apiKeyId}/${slId}`, formattedPayload);
    invalidateTradingPollCache(apiKeyId);
    return response.data;
  },

  placeDragBracket: async (payload: {
    apiKeyId: number;
    symbol: string;
    bracketType: 'tp' | 'sl';
    price: number;
    amount?: number;
    isFutures?: boolean;
    side?: string;
    tpConfig?: any;
    slConfig?: any;
    targetOrderId?: string;
  }) => {
    const response = await api.post('/trading/place-drag-bracket', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      bracket_type: payload.bracketType,
      price: payload.price,
      amount: payload.amount,
      is_futures: payload.isFutures,
      side: payload.side,
      tp_config: payload.tpConfig,
      sl_config: payload.slConfig,
      target_order_id: payload.targetOrderId,
    });
    invalidateTradingPollCache(payload.apiKeyId);
    return response.data;
  },

  getActiveSoftwareBrackets: async (apiKeyId: number, symbol: string, forceRefresh: boolean = false) => {
    const key = `brackets:${apiKeyId}:${symbol.trim().toUpperCase()}`;
    return _coalescedPoll(
      key,
      async () => {
        const response = await api.get(`/trading/active-software-brackets/${apiKeyId}?symbol=${encodeURIComponent(symbol)}`);
        return response.data;
      },
      forceRefresh
    );
  },

  getOpenLimitOrders: async (apiKeyId: number, symbol: string, forceRefresh: boolean = false) => {
    const key = `openOrders:${apiKeyId}:${symbol.trim().toUpperCase()}`;
    return _coalescedPoll(
      key,
      async () => {
        const response = await api.get(`/trading/open-limit-orders/${apiKeyId}?symbol=${encodeURIComponent(symbol)}`);
        return response.data;
      },
      forceRefresh
    );
  },

  stopSmartChase: async (payload: { apiKeyId?: number; symbol: string; slId?: string }) => {
    const response = await api.post('/trading/stop-smart-chase', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      sl_id: payload.slId
    });
    invalidateTradingPollCache(payload.apiKeyId);
    return response.data;
  },

  stopSmartPeg: async (payload: { apiKeyId?: number; symbol: string; pegId?: string }) => {
    const response = await api.post('/trading/stop-smart-peg', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      sl_id: payload.pegId
    });
    invalidateTradingPollCache(payload.apiKeyId);
    return response.data;
  },

  warmupMlFilter: async (symbol: string, mlModelId: string) => {
    try {
      const response = await api.post('/trading/ml-filter-warmup', {
        symbol,
        ml_model_id: mlModelId
      });
      return response.data;
    } catch {
      return null;
    }
  },

  emergencyForceOrder: async (payload: {
    apiKeyId: number;
    symbol: string;
    side: 'Buy' | 'Sell';
    executionMode: 'limit_maker' | 'market';
    sizePct?: number;
    customAmount?: number;
    targetOrderId?: string;
    targetOrderAmount?: number;
    targetOrderMode?: string;
    leverage?: number;
    marginMode?: 'cross' | 'isolated';
    reduceOnly?: boolean;
    attached_tp?: OrderPayload['attached_tp'];
    attached_sl?: OrderPayload['attached_sl'];
    enable_ml_filter?: boolean;
    ml_model_id?: string;
    ml_execution_mode?: 'basic' | 'advanced';
    ml_bullish_threshold?: number;
    ml_bearish_threshold?: number;
  }) => {
    const response = await api.post('/trading/emergency-force-order', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      side: payload.side.toLowerCase(),
      execution_mode: payload.executionMode,
      size_pct: payload.sizePct ?? 100.0,
      custom_amount: payload.customAmount,
      target_order_id: payload.targetOrderId,
      target_order_amount: payload.targetOrderAmount,
      target_order_mode: payload.targetOrderMode,
      leverage: payload.leverage,
      margin_mode: payload.marginMode,
      reduce_only: Boolean(payload.reduceOnly),
      attached_tp: payload.attached_tp,
      attached_sl: payload.attached_sl,
      enable_ml_filter: Boolean(payload.enable_ml_filter),
      ml_model_id: payload.ml_model_id,
      ml_execution_mode: payload.ml_execution_mode || 'basic',
      ml_bullish_threshold: payload.ml_bullish_threshold,
      ml_bearish_threshold: payload.ml_bearish_threshold
    });
    return response.data;
  },

  cancelOrder: async (apiKeyId: number, orderId: string, symbol: string) => {
    const response = await api.delete(`/trading/order/${apiKeyId}/${encodeURIComponent(orderId)}?symbol=${encodeURIComponent(symbol)}`);
    invalidateTradingPollCache(apiKeyId);
    return response.data;
  },

  cancelAllOrders: async (apiKeyId: number, symbol: string) => {
    const response = await api.post('/trading/cancel-all-orders', {
      api_key_id: apiKeyId,
      symbol
    });
    invalidateTradingPollCache(apiKeyId);
    return response.data;
  },

  closePosition: async (apiKeyId: number, symbol: string) => {
    const response = await api.post('/trading/close-position', {
      api_key_id: apiKeyId,
      symbol
    });
    invalidateTradingPollCache(apiKeyId);
    return response.data;
  },

  getNearestWalls: async (
    symbol: string,
    exchangeId: string = 'binance',
    wallMultiplier: number = 2.5,
    frontRunTicks: number = 1,
    apiKeyId?: number
  ) => {
    try {
      const response = await api.get('/trading/nearest-walls', {
        params: {
          symbol,
          exchange_id: exchangeId,
          wall_multiplier: wallMultiplier,
          front_run_ticks: frontRunTicks,
          ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
        },
      });
      return response.data;
    } catch {
      return null;
    }
  },

  getMlFilterLivePreview: async (
    symbol: string,
    mlModelId: string,
    bullishThreshold: number = 0.5,
    bearishThreshold: number = 0.5,
    exchangeId: string = 'binance'
  ): Promise<MlLivePreviewResponse | null> => {
    try {
      const response = await api.get('/trading/ml-filter-preview', {
        params: {
          symbol,
          ml_model_id: mlModelId,
          bullish_threshold: bullishThreshold,
          bearish_threshold: bearishThreshold,
          exchange_id: exchangeId,
        },
      });
      return response.data as MlLivePreviewResponse;
    } catch {
      return null;
    }
  },

  moveSlToBreakeven: async (
    apiKeyId: number,
    symbol: string,
    bufferPct: number = 0.05,
    fallbackEntryPrice: number = 0
  ) => {
    const response = await api.post(`/trading/breakeven/${apiKeyId}`, {
      symbol,
      buffer_pct: bufferPct,
      fallback_entry_price: fallbackEntryPrice,
    });
    return response.data;
  },
};

