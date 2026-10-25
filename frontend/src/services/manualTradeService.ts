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
  };
  client_timestamp?: number;
  attached_tp?: {
    enabled: boolean;
    mode: 'percentage' | 'price' | 'absolute';
    value: number;
    order_type: 'Limit' | 'Market';
    timeout_mins?: number | null;
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
  };
  use_native_tp_sl?: boolean;
  iceberg_qty?: number;
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
  is_futures: boolean;
}

export interface FastPositionResponse {
  amount: number;
  side: 'long' | 'short' | 'none';
}

export const manualTradeService = {
  getApiKeys: async () => {
    const response = await api.get('/users/api-keys');
    return response.data as ApiKey[];
  },

  getFastBalance: async (apiKeyId: number, symbol: string) => {
    const response = await api.get(`/trading/api-key-balance/${apiKeyId}?symbol=${symbol}`);
    return response.data as FastBalanceResponse;
  },

  getActivePosition: async (apiKeyId: number, symbol: string) => {
    const response = await api.get(`/trading/api-key-position/${apiKeyId}?symbol=${symbol}`);
    return response.data as FastPositionResponse;
  },

  placeOrder: async (order: OrderPayload) => {
    // lowercase the side to match typical backend expectations ('buy' or 'sell')
    const formattedOrder = {
      ...order,
      side: order.side.toLowerCase(),
      type: order.type === 'SmartPeg' ? 'smart_peg' : order.type.toLowerCase(),
    };
    
    const response = await api.post('/trading/order', formattedOrder);
    return response.data;
  },

  editOrder: async (apiKeyId: number, orderId: string, payload: { symbol: string, side: string, amount: number, new_price: number }) => {
    // side matching typical backend expectations
    const formattedPayload = {
      ...payload,
      side: payload.side.toLowerCase(),
    };
    const response = await api.put(`/trading/order/${apiKeyId}/${orderId}`, formattedPayload);
    return response.data;
  },

  updateSoftwareSL: async (apiKeyId: number, slId: string, payload: { symbol: string, side: string, new_price: number, amount?: number }) => {
    const formattedPayload = {
      ...payload,
      side: payload.side.toLowerCase(),
    };
    const response = await api.put(`/trading/software-bracket/${apiKeyId}/${slId}`, formattedPayload);
    return response.data;
  },

  getActiveSoftwareBrackets: async (apiKeyId: number, symbol: string) => {
    const response = await api.get(`/trading/active-software-brackets/${apiKeyId}?symbol=${encodeURIComponent(symbol)}`);
    return response.data;
  },

  stopSmartChase: async (payload: { apiKeyId?: number; symbol: string; slId?: string }) => {
    const response = await api.post('/trading/stop-smart-chase', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      sl_id: payload.slId
    });
    return response.data;
  },

  stopSmartPeg: async (payload: { apiKeyId?: number; symbol: string; pegId?: string }) => {
    const response = await api.post('/trading/stop-smart-peg', {
      api_key_id: payload.apiKeyId,
      symbol: payload.symbol,
      sl_id: payload.pegId
    });
    return response.data;
  }
};

