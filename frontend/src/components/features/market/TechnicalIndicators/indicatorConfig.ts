export type SignalType = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type IndicatorCategory = 'Oscillators' | 'Moving Averages' | 'Momentum' | 'Volatility' | 'Volume' | 'Trend' | 'Other';

export interface IndicatorConfig {
  id: string;
  name: string;
  shortName: string;
  category: IndicatorCategory;
  defaultParams: string; // e.g., "14", "20, 2", "12, 26, 9"
  weight: number; // 1 to 5, how much it impacts the overall score
}

// 50+ Technical Indicators Configuration
export const TECHNICAL_INDICATORS: IndicatorConfig[] = [
  // --- Oscillators ---
  { id: 'rsi', name: 'Relative Strength Index', shortName: 'RSI', category: 'Oscillators', defaultParams: '14', weight: 4 },
  { id: 'stoch', name: 'Stochastic Oscillator', shortName: 'Stoch', category: 'Oscillators', defaultParams: '14, 3, 3', weight: 3 },
  { id: 'macd', name: 'Moving Average Convergence Divergence', shortName: 'MACD', category: 'Oscillators', defaultParams: '12, 26, 9', weight: 5 },
  { id: 'cci', name: 'Commodity Channel Index', shortName: 'CCI', category: 'Oscillators', defaultParams: '20', weight: 3 },
  { id: 'ao', name: 'Awesome Oscillator', shortName: 'AO', category: 'Oscillators', defaultParams: '34, 5', weight: 3 },
  { id: 'mom', name: 'Momentum', shortName: 'MOM', category: 'Oscillators', defaultParams: '10', weight: 2 },
  { id: 'stochrsi', name: 'Stochastic RSI', shortName: 'StochRSI', category: 'Oscillators', defaultParams: '14, 14, 3, 3', weight: 3 },
  { id: 'uo', name: 'Ultimate Oscillator', shortName: 'UO', category: 'Oscillators', defaultParams: '7, 14, 28', weight: 2 },
  { id: 'wpr', name: 'Williams %R', shortName: 'W%R', category: 'Oscillators', defaultParams: '14', weight: 3 },
  { id: 'mfi', name: 'Money Flow Index', shortName: 'MFI', category: 'Oscillators', defaultParams: '14', weight: 3 },
  { id: 'roc', name: 'Rate of Change', shortName: 'ROC', category: 'Oscillators', defaultParams: '9', weight: 2 },
  { id: 'trix', name: 'TRIX', shortName: 'TRIX', category: 'Oscillators', defaultParams: '15', weight: 2 },

  // --- Moving Averages ---
  { id: 'sma5', name: 'Simple Moving Average (5)', shortName: 'SMA 5', category: 'Moving Averages', defaultParams: '5', weight: 2 },
  { id: 'sma10', name: 'Simple Moving Average (10)', shortName: 'SMA 10', category: 'Moving Averages', defaultParams: '10', weight: 3 },
  { id: 'sma20', name: 'Simple Moving Average (20)', shortName: 'SMA 20', category: 'Moving Averages', defaultParams: '20', weight: 3 },
  { id: 'sma50', name: 'Simple Moving Average (50)', shortName: 'SMA 50', category: 'Moving Averages', defaultParams: '50', weight: 4 },
  { id: 'sma100', name: 'Simple Moving Average (100)', shortName: 'SMA 100', category: 'Moving Averages', defaultParams: '100', weight: 4 },
  { id: 'sma200', name: 'Simple Moving Average (200)', shortName: 'SMA 200', category: 'Moving Averages', defaultParams: '200', weight: 5 },
  { id: 'ema5', name: 'Exponential Moving Average (5)', shortName: 'EMA 5', category: 'Moving Averages', defaultParams: '5', weight: 2 },
  { id: 'ema10', name: 'Exponential Moving Average (10)', shortName: 'EMA 10', category: 'Moving Averages', defaultParams: '10', weight: 3 },
  { id: 'ema20', name: 'Exponential Moving Average (20)', shortName: 'EMA 20', category: 'Moving Averages', defaultParams: '20', weight: 4 },
  { id: 'ema50', name: 'Exponential Moving Average (50)', shortName: 'EMA 50', category: 'Moving Averages', defaultParams: '50', weight: 4 },
  { id: 'ema100', name: 'Exponential Moving Average (100)', shortName: 'EMA 100', category: 'Moving Averages', defaultParams: '100', weight: 4 },
  { id: 'ema200', name: 'Exponential Moving Average (200)', shortName: 'EMA 200', category: 'Moving Averages', defaultParams: '200', weight: 5 },
  { id: 'wma20', name: 'Weighted Moving Average (20)', shortName: 'WMA 20', category: 'Moving Averages', defaultParams: '20', weight: 3 },
  { id: 'vwma20', name: 'Volume Weighted MA (20)', shortName: 'VWMA 20', category: 'Moving Averages', defaultParams: '20', weight: 4 },
  { id: 'hma', name: 'Hull Moving Average', shortName: 'HMA', category: 'Moving Averages', defaultParams: '9', weight: 2 },

  // --- Momentum & Trend ---
  { id: 'adx', name: 'Average Directional Index', shortName: 'ADX', category: 'Trend', defaultParams: '14', weight: 4 },
  { id: 'psar', name: 'Parabolic SAR', shortName: 'PSAR', category: 'Trend', defaultParams: '0.02, 0.2', weight: 3 },
  { id: 'ichimoku', name: 'Ichimoku Cloud', shortName: 'Ichimoku', category: 'Trend', defaultParams: '9, 26, 52', weight: 4 },
  { id: 'supertrend', name: 'SuperTrend', shortName: 'SuperTrend', category: 'Trend', defaultParams: '10, 3', weight: 4 },
  { id: 'aroon', name: 'Aroon', shortName: 'Aroon', category: 'Trend', defaultParams: '14', weight: 3 },
  { id: 'dmi', name: 'Directional Movement Index', shortName: 'DMI', category: 'Trend', defaultParams: '14', weight: 3 },
  { id: 'kst', name: 'Know Sure Thing', shortName: 'KST', category: 'Momentum', defaultParams: '10,15,20,30', weight: 2 },
  { id: 'cmo', name: 'Chande Momentum Oscillator', shortName: 'CMO', category: 'Momentum', defaultParams: '9', weight: 2 },

  // --- Volatility ---
  { id: 'bb', name: 'Bollinger Bands', shortName: 'BB', category: 'Volatility', defaultParams: '20, 2', weight: 4 },
  { id: 'atr', name: 'Average True Range', shortName: 'ATR', category: 'Volatility', defaultParams: '14', weight: 3 },
  { id: 'keltner', name: 'Keltner Channels', shortName: 'KC', category: 'Volatility', defaultParams: '20, 1.5', weight: 2 },
  { id: 'donchian', name: 'Donchian Channels', shortName: 'DC', category: 'Volatility', defaultParams: '20', weight: 2 },
  { id: 'cvd', name: 'Cumulative Volume Delta', shortName: 'CVD', category: 'Volatility', defaultParams: '-', weight: 5 }, // Highly relevant to order flow
  
  // --- Volume ---
  { id: 'obv', name: 'On-Balance Volume', shortName: 'OBV', category: 'Volume', defaultParams: '-', weight: 4 },
  { id: 'cmf', name: 'Chaikin Money Flow', shortName: 'CMF', category: 'Volume', defaultParams: '20', weight: 3 },
  { id: 'vwap', name: 'Volume Weighted Avg Price', shortName: 'VWAP', category: 'Volume', defaultParams: '-', weight: 5 },
  { id: 'pvt', name: 'Price Volume Trend', shortName: 'PVT', category: 'Volume', defaultParams: '-', weight: 2 },
  { id: 'fi', name: 'Force Index', shortName: 'FI', category: 'Volume', defaultParams: '13', weight: 2 },
  { id: 'eom', name: 'Ease of Movement', shortName: 'EOM', category: 'Volume', defaultParams: '14', weight: 2 },
  
  // --- Other / Advanced ---
  { id: 'pivot', name: 'Pivot Points', shortName: 'Pivot', category: 'Other', defaultParams: 'Traditional', weight: 3 },
  { id: 'fib', name: 'Fibonacci Retracements', shortName: 'Fib', category: 'Other', defaultParams: '-', weight: 3 },
  { id: 'td', name: 'TD Sequential', shortName: 'TD Seq', category: 'Other', defaultParams: '9, 13', weight: 3 },
  { id: 'sqz', name: 'Squeeze Momentum', shortName: 'Squeeze', category: 'Other', defaultParams: '20, 2, 1.5', weight: 3 },
  { id: 'vix', name: 'Volatility Index Proxy', shortName: 'VIX Proxy', category: 'Other', defaultParams: '14', weight: 3 },
  { id: 'mcg', name: 'McGinley Dynamic', shortName: 'McGinley', category: 'Other', defaultParams: '14', weight: 2 },
];
