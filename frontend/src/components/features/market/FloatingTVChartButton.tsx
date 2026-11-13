import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart2, X, RefreshCw, ChevronDown, GripVertical } from 'lucide-react';
import {
  createChart,
  ISeriesApi,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
} from 'lightweight-charts';
import { marketDepthService } from '../../../services/marketDepthService';
import {
  calculateEMA,
  calculateBollingerBands,
  calculateRSI,
  calculateMACD,
} from '../../../utils/indicators';
import { HeatmapSymbolSelector } from './HeatmapSymbolSelector';
import { TimeframeSelector } from './TimeframeSelector';
import { useTheme } from '../../../context/ThemeContext';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';

const MotionButton = motion.button as any;
const MotionDiv   = motion.div   as any;

// ── EMA periods ───────────────────────────────────────────────────────────────
const EMA_PERIODS = [9, 21, 50, 100, 200];

// ── Indicator state type ──────────────────────────────────────────────────────
interface IndSettings {
  showEMA:   boolean;
  emaPeriod: number;
  showBB:    boolean;
  showRSI:   boolean;
  showVol:   boolean;
  showMACD:  boolean;
}

const DEFAULT_IND: IndSettings = {
  showEMA:   true,
  emaPeriod: 21,
  showBB:    false,
  showRSI:   false,
  showVol:   true,
  showMACD:  false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const stripFutures = (s: string) => s.replace(/:[^/]*$/, '');
const fmtPrice = (p: number) => {
  if (p < 0.001)  return p.toFixed(8);
  if (p < 1)      return p.toFixed(5);
  if (p < 10)     return p.toFixed(4);
  return p.toFixed(2);
};

// ─────────────────────────────────────────────────────────────────────────────
// Mini Order-Flow Chart sub-component
// ─────────────────────────────────────────────────────────────────────────────
interface MiniChartProps {
  symbol:   string;
  exchange: string;
  interval: string;
  ind:      IndSettings;
  isThermalGuard?: boolean;
  isDraggingRef?: React.MutableRefObject<boolean>;
}

const MiniOrderFlowChart: React.FC<MiniChartProps> = React.memo(({ symbol, exchange, interval, ind, isThermalGuard = false, isDraggingRef }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const containerRef     = useRef<HTMLDivElement>(null);
  const chartRef         = useRef<any>(null);
  const candleRef        = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef           = useRef<ISeriesApi<'Histogram'>   | null>(null);
  const emaRef           = useRef<ISeriesApi<'Line'>        | null>(null);
  const bbUpRef          = useRef<ISeriesApi<'Line'>        | null>(null);
  const bbMidRef         = useRef<ISeriesApi<'Line'>        | null>(null);
  const bbLoRef          = useRef<ISeriesApi<'Line'>        | null>(null);
  const rsiRef           = useRef<ISeriesApi<'Line'>        | null>(null);
  const macdLineRef      = useRef<ISeriesApi<'Line'>        | null>(null);
  const macdSignalRef    = useRef<ISeriesApi<'Line'>        | null>(null);
  const macdHistRef      = useRef<ISeriesApi<'Histogram'>   | null>(null);
  const priceLineRef     = useRef<any>(null);
  const lastCandleRef    = useRef<any>(null);
  const priceBadgeRef    = useRef<HTMLSpanElement>(null);
  const lastTickTimeRef  = useRef<number>(0);
  const wsRef            = useRef<WebSocket | null>(null);
  const mountedRef       = useRef(true);

  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [wsOk,      setWsOk]      = useState(false);
  const [loading,   setLoading]   = useState(true);

  // ── CHART INIT (once per mount) ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    if (!containerRef.current) return;

    // RSI/MACD active → bottom 25% reserved
    const hasBottom = ind.showRSI || ind.showMACD;
    const bottomMargin = hasBottom ? 0.28 : 0.18;

    const chart = createChart(containerRef.current, {
      layout: {
        background:  { type: 'solid', color: 'transparent' } as any,
        textColor:   isLight ? '#334155' : '#64748b',
        fontSize:    10,
      },
      grid: {
        vertLines: { color: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.03)' },
        horzLines: { color: isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.03)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(139,92,246,0.4)', width: 1, style: LineStyle.Dashed },
        horzLine: { color: 'rgba(139,92,246,0.4)', width: 1, style: LineStyle.Dashed },
      },
      timeScale: { borderColor: isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.05)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.05)', scaleMargins: { top: 0.06, bottom: bottomMargin } },
      leftPriceScale:  { visible: hasBottom, borderColor: isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.05)', scaleMargins: { top: 0.76, bottom: 0 } },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;

    // ── Series ──────────────────────────────────────────────────────────────
    // Candlestick
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false,
      priceFormat: { type: 'custom', minMove: 0.000000001, formatter: fmtPrice },
    });

    // Volume
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });

    // EMA
    emaRef.current = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: false, priceScaleId: 'right', visible: ind.showEMA,
    });

    // Bollinger Bands
    bbUpRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(56,189,248,0.55)', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: false, priceScaleId: 'right', visible: ind.showBB,
    });
    bbMidRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(56,189,248,0.85)', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: false, priceScaleId: 'right', visible: ind.showBB,
    });
    bbLoRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(56,189,248,0.55)', lineWidth: 1, crosshairMarkerVisible: false,
      lastValueVisible: false, priceScaleId: 'right', visible: ind.showBB,
    });

    // RSI
    rsiRef.current = chart.addSeries(LineSeries, {
      color: '#db2777', lineWidth: 1, priceScaleId: 'left',
      crosshairMarkerVisible: false, lastValueVisible: true, visible: ind.showRSI,
    });

    // MACD
    macdLineRef.current = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 1, priceScaleId: 'left',
      crosshairMarkerVisible: false, lastValueVisible: false, visible: ind.showMACD,
    });
    macdSignalRef.current = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, priceScaleId: 'left',
      crosshairMarkerVisible: false, lastValueVisible: false, visible: ind.showMACD,
    });
    macdHistRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: 'left', lastValueVisible: false, visible: ind.showMACD,
    });

    // Resize observer
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r && chartRef.current) chartRef.current.applyOptions({ width: r.width, height: r.height });
    });
    ro.observe(containerRef.current);

    return () => {
      mountedRef.current = false;
      ro.disconnect();
      chart.remove();
      chartRef.current = candleRef.current = volRef.current = null;
      emaRef.current = bbUpRef.current = bbMidRef.current = bbLoRef.current = null;
      rsiRef.current = macdLineRef.current = macdSignalRef.current = macdHistRef.current = null;
      priceLineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamically re-skin LightweightCharts grid & axes when user switches Light/Dark mode
  useEffect(() => {
    if (!chartRef.current) return;
    const borderCol = isLight ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.05)';
    const gridCol = isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.03)';
    chartRef.current.applyOptions({
      layout: { textColor: isLight ? '#334155' : '#64748b' },
      grid: {
        vertLines: { color: gridCol },
        horzLines: { color: gridCol },
      },
      timeScale: { borderColor: borderCol },
      rightPriceScale: { borderColor: borderCol },
      leftPriceScale: { borderColor: borderCol },
    });
  }, [isLight]);

  // ── DATA FETCH whenever symbol / exchange / interval changes ─────────────
  useEffect(() => {
    if (!candleRef.current) return;
    let cancelled = false;
    setLoading(true);
    priceLineRef.current = null;

    const clean = stripFutures(symbol).toUpperCase();
    const candleLimit = isThermalGuard ? 350 : 1500;

    marketDepthService.getOHLCV(clean, exchange, interval, candleLimit)
      .then((data: any[]) => {
        if (cancelled) return;
        if (!candleRef.current || !volRef.current) return;

        const candles = data.map((k: any) => ({
          time:   k.time as any,
          open:   parseFloat(k.open),
          high:   parseFloat(k.high),
          low:    parseFloat(k.low),
          close:  parseFloat(k.close),
          volume: parseFloat(k.volume || 0),
        }));

        candleRef.current.setData(candles);
        volRef.current.setData(
          candles.map(c => ({
            time: c.time, value: c.volume,
            color: c.close >= c.open ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)',
          }))
        );

        // EMA
        if (emaRef.current && candles.length > ind.emaPeriod) {
          emaRef.current.setData(calculateEMA(candles, ind.emaPeriod) as any);
        }

        // Bollinger Bands
        if (bbUpRef.current && bbMidRef.current && bbLoRef.current && candles.length > 20) {
          const bb = calculateBollingerBands(candles, 20, 2);
          bbUpRef.current.setData(bb.map(d => ({ time: d.time, value: d.upper } as any)));
          bbMidRef.current.setData(bb.map(d => ({ time: d.time, value: d.middle } as any)));
          bbLoRef.current.setData(bb.map(d => ({ time: d.time, value: d.lower } as any)));
        }

        // RSI
        if (rsiRef.current && candles.length > 14) {
          rsiRef.current.setData(calculateRSI(candles, 14) as any);
        }

        // MACD
        if (macdLineRef.current && macdSignalRef.current && macdHistRef.current && candles.length > 26) {
          const macdData = calculateMACD(candles, 12, 26, 9);
          macdLineRef.current.setData(macdData.map(d => ({ time: d.time, value: d.macd } as any)));
          macdSignalRef.current.setData(macdData.map(d => ({ time: d.time, value: d.signal } as any)));
          macdHistRef.current.setData(macdData.map(d => ({
            time: d.time, value: d.histogram,
            color: d.histogram >= 0 ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)',
          } as any)));
        }

        if (candles.length > 0) {
          lastCandleRef.current = { ...candles[candles.length - 1] };
          const last = lastCandleRef.current.close;

          if (candleRef.current) {
            const pl = candleRef.current.createPriceLine({
              price: last, color: 'rgba(139,92,246,0.9)',
              lineWidth: 1, lineStyle: LineStyle.Dashed,
              axisLabelVisible: true, title: '',
            });
            priceLineRef.current = pl;
          }
          setLivePrice(last);
          if (priceBadgeRef.current) {
            priceBadgeRef.current.textContent = fmtPrice(last);
          }
        }

        chartRef.current?.timeScale().fitContent();
        setLoading(false);
      })
      .catch(err => {
        if (!cancelled) { console.warn('[MiniChart] fetch err:', err); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [symbol, exchange, interval, ind.emaPeriod]);

  // ── INDICATOR VISIBILITY UPDATES (no data refetch) ───────────────────────
  useEffect(() => {
    emaRef.current?.applyOptions({ visible: ind.showEMA });
    volRef.current?.applyOptions({ visible: ind.showVol });
    bbUpRef.current?.applyOptions({ visible: ind.showBB });
    bbMidRef.current?.applyOptions({ visible: ind.showBB });
    bbLoRef.current?.applyOptions({ visible: ind.showBB });
    rsiRef.current?.applyOptions({ visible: ind.showRSI });
    macdLineRef.current?.applyOptions({ visible: ind.showMACD });
    macdSignalRef.current?.applyOptions({ visible: ind.showMACD });
    macdHistRef.current?.applyOptions({ visible: ind.showMACD });

    // Show/hide left scale
    const hasBottom = ind.showRSI || ind.showMACD;
    chartRef.current?.priceScale('left').applyOptions({ visible: hasBottom });
  }, [ind]);

  // ── WEBSOCKET (live ticks) ───────────────────────────────────────────────
  useEffect(() => {
    const cleanSym = stripFutures(symbol).replace('/', '');
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let sock: WebSocket | null = null;

    const connect = () => {
      if (!mountedRef.current) return;
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        sock = new WebSocket(`${proto}//${window.location.host}/ws/market-data/${cleanSym}`);
        wsRef.current = sock;

        sock.onopen  = () => { if (mountedRef.current) setWsOk(true); };
        sock.onclose = () => {
          if (mountedRef.current) { setWsOk(false); reconnectTimer = setTimeout(connect, 3000); }
        };
        sock.onerror = () => sock?.close();

        sock.onmessage = (ev) => {
          if (!mountedRef.current) return;
          // When app is in background, tab hidden, or screen locked on tablet/mobile, stop CPU/GPU work
          if (typeof document !== 'undefined' && document.hidden) return;
          // When user is dragging modal across the screen, suspend canvas updates to guarantee silky-smooth 120fps GPU transform
          if (isDraggingRef?.current) return;

          try {
            const msg = JSON.parse(ev.data);
            const price = msg.type === 'ticker'
              ? parseFloat(msg.data?.price)
              : msg.price ? parseFloat(msg.price) : NaN;
            if (isNaN(price) || price <= 0) return;

            const now = performance.now();
            // Throttle tick renders to 75ms on mobile/thermal guard (prevents phone heating) and 16ms on desktop
            const throttleMs = isThermalGuard ? 75 : 16;
            if (now - lastTickTimeRef.current < throttleMs) {
              return;
            }
            lastTickTimeRef.current = now;

            // Direct DOM update eliminates full React re-render of MiniOrderFlowChart on each tick!
            if (priceBadgeRef.current) {
              priceBadgeRef.current.textContent = fmtPrice(price);
            }

            if (priceLineRef.current) {
              try { priceLineRef.current.applyOptions({ price }); } catch { /* ignore */ }
            }
            if (lastCandleRef.current && candleRef.current) {
              const up = {
                ...lastCandleRef.current, close: price,
                high: Math.max(lastCandleRef.current.high, price),
                low:  Math.min(lastCandleRef.current.low,  price),
              };
              lastCandleRef.current = up;
              try { candleRef.current.update(up); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        };
      } catch { /* ignore */ }
    };

    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer);
      sock?.close();
      mountedRef.current = true;
    };
  }, [symbol, isThermalGuard]);

  return (
    <div className="relative w-full h-full bg-[#070C17]">
      <AnimatePresence>
        {loading && (
          <MotionDiv initial={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-[#070C17]">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin opacity-70" />
            <span className="text-[9px] text-gray-600 font-mono uppercase tracking-widest">
              Loading {stripFutures(symbol)}…
            </span>
          </MotionDiv>
        )}
      </AnimatePresence>

      <div ref={containerRef} className="w-full h-full" />

      {/* Live price badge */}
      {!loading && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5 pointer-events-none">
          <span ref={priceBadgeRef} className="text-[11px] font-mono font-black text-white bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded-lg border border-white/10">
            {livePrice !== null ? fmtPrice(livePrice) : '---'}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${wsOk ? 'bg-green-400 shadow-[0_0_5px_rgba(34,197,94,0.9)] animate-pulse' : 'bg-orange-400'}`} />
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Small toggle pill for indicator toolbar
// ─────────────────────────────────────────────────────────────────────────────
const IndPill: React.FC<{
  label:    string;
  active:   boolean;
  color?:   string;
  onClick:  () => void;
  children?: React.ReactNode;
}> = ({ label, active, color = '#8b5cf6', onClick, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-all ${
      active
        ? 'text-white border-transparent'
        : 'border-white/10 text-gray-600 hover:text-gray-300 hover:border-white/20'
    }`}
    style={active ? { background: color, color: '#ffffff', boxShadow: `0 0 8px ${color}66` } : {}}
  >
    {label}
    {children}
  </button>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Floating Button + Panel
// ─────────────────────────────────────────────────────────────────────────────
interface FloatingTVChartButtonProps {
  symbol:    string;
  exchange?: string;
  size?: 'sm' | 'md';
}

const FloatingTVChartButtonBase: React.FC<FloatingTVChartButtonProps> = ({
  symbol,
  exchange = 'bybit',
  size = 'md',
}) => {
  const deviceProfile = useDeviceProfile();
  const { isThermalGuardActive, isPhone } = deviceProfile;

  const [isOpen,      setIsOpen]      = useState(false);
  const [chartExchange, setChartExchange] = useState(exchange);
  const [chartSym,    setChartSym]    = useState(symbol);
  const [interval,    setInterval]    = useState('15m');
  const [chartKey,    setChartKey]    = useState(0);
  const [ind,         setInd]         = useState<IndSettings>(DEFAULT_IND);
  const [showEmaPick, setShowEmaPick] = useState(false);

  // ── Ultra-Smooth 120fps GPU Dragging Implementation (Zero React Re-render direct transform) ──
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const chartContentRef = useRef<HTMLDivElement>(null);
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  const isDraggingRef = useRef(false);

  const [modalPos, setModalPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('cosmo_floating_tv_chart_pos_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            return {
              x: Math.max(6, Math.min(Math.max(6, winW - 550), parsed.x)),
              y: Math.max(6, Math.min(Math.max(6, winH - 530), parsed.y)),
            };
          }
        }
      } catch {}
    }
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const isMobile = winW < 640;
    return {
      x: isMobile ? 8 : Math.max(10, Math.min(winW - 560, winW - 572)),
      y: isMobile ? 45 : Math.max(10, Math.min(winH - 540, winH - 600)),
    };
  });

  const modalPosRef = useRef(modalPos);
  modalPosRef.current = modalPos;

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    currentX: 0,
    currentY: 0,
    minX: 6,
    maxX: 1200,
    minY: 6,
    maxY: 800,
  });

  const clampPos = useCallback((rawX: number, rawY: number) => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const modalW = modalContainerRef.current?.offsetWidth || 540;
    const modalH = modalContainerRef.current?.offsetHeight || 520;
    const minX = 6;
    const maxX = Math.max(minX, winW - modalW - 6);
    const minY = 6;
    const maxY = Math.max(minY, winH - modalH - 6);
    return {
      x: Math.max(minX, Math.min(maxX, Math.round(rawX))),
      y: Math.max(minY, Math.min(maxY, Math.round(rawY))),
    };
  }, []);

  // Synchronize modal position and observe live window resize (Isolated from active dragging)
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const modalEl = modalContainerRef.current;
    if (!modalEl) return;

    if (dragRef.current.isDragging) return;

    const clamped = clampPos(modalPosRef.current.x, modalPosRef.current.y);
    modalEl.style.transform = `translate3d(${clamped.x}px, ${clamped.y}px, 0)`;
    dragRef.current.currentX = clamped.x;
    dragRef.current.currentY = clamped.y;

    if (clamped.x !== modalPosRef.current.x || clamped.y !== modalPosRef.current.y) {
      modalPosRef.current = clamped;
      setModalPos(clamped);
    }

    const onWindowResize = () => {
      if (dragRef.current.isDragging) return;
      const nextClamped = clampPos(modalPosRef.current.x, modalPosRef.current.y);
      if (modalContainerRef.current) {
        modalContainerRef.current.style.transform = `translate3d(${nextClamped.x}px, ${nextClamped.y}px, 0)`;
      }
      dragRef.current.currentX = nextClamped.x;
      dragRef.current.currentY = nextClamped.y;
      if (nextClamped.x !== modalPosRef.current.x || nextClamped.y !== modalPosRef.current.y) {
        modalPosRef.current = nextClamped;
        setModalPos(nextClamped);
      }
    };

    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [isOpen, clampPos]);

  // Ultra-Smooth 120fps GPU Mouse & Touch Drag Handler with RAF synchronization
  const handleStartDrag = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const isTouch = 'touches' in e;
      if (!isTouch && (e as React.MouseEvent).button !== 0) return;

      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('[data-no-drag="true"]')
      ) {
        return;
      }

      const startClientX = isTouch ? e.touches[0]?.clientX : (e as React.MouseEvent).clientX;
      const startClientY = isTouch ? e.touches[0]?.clientY : (e as React.MouseEvent).clientY;
      if (startClientX === undefined || startClientY === undefined) return;

      if (!isTouch && e.cancelable) {
        e.preventDefault();
      }
      e.stopPropagation();

      activeDragCleanupRef.current?.();

      const modalEl = modalContainerRef.current;
      const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const modalW = modalEl?.offsetWidth || 540;
      const modalH = modalEl?.offsetHeight || 520;

      const currentPos = modalPosRef.current;
      const drag = dragRef.current;
      drag.isDragging = true;
      isDraggingRef.current = true;
      drag.startX = startClientX;
      drag.startY = startClientY;
      drag.originX = currentPos.x;
      drag.originY = currentPos.y;
      drag.currentX = currentPos.x;
      drag.currentY = currentPos.y;
      drag.minX = 6;
      drag.maxX = Math.max(6, winW - modalW - 6);
      drag.minY = 6;
      drag.maxY = Math.max(6, winH - modalH - 6);

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      // Shield background OrderFlowHeatmap and canvas from mouse/pointer events during drag
      document.body.style.pointerEvents = 'none';

      if (modalEl) {
        modalEl.style.pointerEvents = 'auto';
        modalEl.style.transition = 'none';
        modalEl.style.boxShadow = 'none';
        modalEl.style.backdropFilter = 'none';
        (modalEl.style as any).webkitBackdropFilter = 'none';
        modalEl.style.backgroundColor =
          typeof document !== 'undefined' && document.documentElement.classList.contains('light')
            ? 'rgba(255, 255, 255, 0.98)'
            : 'rgba(7, 12, 23, 0.98)';
      }

      // Temporarily disable pointer events on inner chart canvas during drag
      if (chartContentRef.current) {
        chartContentRef.current.style.pointerEvents = 'none';
      }

      const applyMove = (clientX: number, clientY: number) => {
        if (!drag.isDragging) return;
        const rawX = drag.originX + (clientX - drag.startX);
        const rawY = drag.originY + (clientY - drag.startY);

        const clampedX = Math.max(drag.minX, Math.min(drag.maxX, rawX));
        const clampedY = Math.max(drag.minY, Math.min(drag.maxY, rawY));

        drag.currentX = clampedX;
        drag.currentY = clampedY;

        if (modalContainerRef.current) {
          modalContainerRef.current.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
        }
      };

      const onMouseMove = (mv: MouseEvent) => {
        applyMove(mv.clientX, mv.clientY);
      };

      const onTouchMove = (tv: TouchEvent) => {
        if (!drag.isDragging) return;
        if (tv.cancelable) tv.preventDefault();
        const touch = tv.touches[0];
        if (!touch) return;
        applyMove(touch.clientX, touch.clientY);
      };

      const cleanupDrag = () => {
        drag.isDragging = false;
        isDraggingRef.current = false;

        if (typeof document !== 'undefined') {
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          document.body.style.pointerEvents = '';
        }

        if (modalContainerRef.current) {
          modalContainerRef.current.style.pointerEvents = '';
          modalContainerRef.current.style.transition = '';
          modalContainerRef.current.style.backdropFilter = '';
          (modalContainerRef.current.style as any).webkitBackdropFilter = '';
          modalContainerRef.current.style.backgroundColor = '';
          modalContainerRef.current.style.boxShadow = '';
        }

        if (chartContentRef.current) {
          chartContentRef.current.style.pointerEvents = '';
        }

        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onUp);
        window.removeEventListener('touchcancel', onUp);
        window.removeEventListener('blur', onUp);

        if (activeDragCleanupRef.current === cleanupDrag) {
          activeDragCleanupRef.current = null;
        }
      };

      const onUp = () => {
        if (!drag.isDragging) {
          cleanupDrag();
          return;
        }
        cleanupDrag();

        const finalPos = { x: drag.currentX, y: drag.currentY };
        modalPosRef.current = finalPos;
        setModalPos(finalPos);
        try {
          localStorage.setItem('cosmo_floating_tv_chart_pos_v2', JSON.stringify(finalPos));
        } catch {}
      };

      activeDragCleanupRef.current = cleanupDrag;
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onUp);
      window.addEventListener('touchcancel', onUp);
      window.addEventListener('blur', onUp);
    },
    [clampPos]
  );

  // Safety cleanup on unmount
  useEffect(() => {
    return () => {
      activeDragCleanupRef.current?.();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.style.pointerEvents = '';
    };
  }, []);

  // Sync heatmap symbol+exchange → chart (only when panel closed)
  useEffect(() => {
    if (!isOpen) {
      setChartSym(symbol);
      setChartExchange(exchange);
    }
  }, [symbol, exchange, isOpen]);

  // When symbol/exchange changes via the selector → reload chart
  const handleSymbolChange = (newSym: string) => {
    setChartSym(newSym);
    setChartKey(k => k + 1);
  };
  const handleExchangeChange = (newEx: string) => {
    setChartExchange(newEx);
    setChartKey(k => k + 1);
  };

  const toggle = (key: keyof IndSettings) => {
    setInd(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const modalWidthClass = isPhone
    ? 'w-[calc(100vw-16px)] max-w-[440px]'
    : 'w-[540px] max-w-[calc(100vw-24px)]';
  const modalHeight = isPhone
    ? (ind.showRSI || ind.showMACD ? 450 : 395)
    : (ind.showRSI || ind.showMACD ? 560 : 520);

  return (
    <>
      {/* ── FAB ─────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {!isOpen && (
          <MotionButton
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileHover={{ scale: 1.05 }}
            onClick={() => setIsOpen(true)}
            className={`relative ${size === 'sm' ? 'w-[42px] h-[42px] shadow-md dark:shadow-[0_0_12px_rgba(139,92,246,0.5)]' : 'w-16 h-16 shadow-lg dark:shadow-[0_0_24px_rgba(139,92,246,0.5)]'} rounded-full flex items-center justify-center bg-gradient-to-br from-violet-600 to-indigo-600 border border-slate-900/15 dark:border-violet-400/30 text-white transition-all focus:outline-none group`}
            title="TVChart"
          >
            <BarChart2 className={`${size === 'sm' ? 'w-5 h-5' : 'w-7 h-7'} transition-transform`} />
          </MotionButton>
        )}
      </AnimatePresence>

      {/* ── Floating Panel (Portaled to document.body for zero-lag screen-wide GPU drag) ── */}
      {typeof document !== 'undefined' &&
        createPortal(
          isOpen ? (
            <div
              ref={modalContainerRef}
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                transform: `translate3d(${dragRef.current.isDragging ? dragRef.current.currentX : modalPos.x}px, ${dragRef.current.isDragging ? dragRef.current.currentY : modalPos.y}px, 0)`,
                willChange: 'transform',
                contain: 'layout paint',
                height: modalHeight,
                zIndex: 100000,
              }}
              className={`cosmo-theme-modal fixed ${modalWidthClass} rounded-2xl ${
                isThermalGuardActive
                  ? 'bg-[#070C17] border-violet-500/30 shadow-[0_12px_36px_rgba(0,0,0,0.92)]'
                  : 'bg-white dark:bg-[#070C17] backdrop-blur-xl border border-slate-200 dark:border-violet-500/20 shadow-[0_16px_64px_rgba(0,0,0,0.85)]'
              } flex flex-col overflow-hidden select-none`}
            >
              {/* ── DRAG HANDLE ─────────────────────────────────────────── */}
              <div
                onMouseDown={handleStartDrag}
                onTouchStart={handleStartDrag}
                style={{ touchAction: 'none' }}
                className="flex items-center justify-between px-3 py-2 bg-black/50 border-b border-white/[0.05] cursor-grab active:cursor-grabbing select-none flex-shrink-0"
                title="Drag to move TVChart"
              >
                <div className="flex items-center gap-2 pointer-events-none">
                  <GripVertical className="w-3.5 h-3.5 text-violet-400/70 shrink-0" />
                  <div className="w-5 h-5 rounded-md bg-violet-600/30 flex items-center justify-center">
                    <BarChart2 className="w-3 h-3 text-violet-400" />
                  </div>
                  <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest">TVChart</span>
                  <span className="text-[9px] text-gray-400 font-mono">
                    · {stripFutures(chartSym)} · {interval}
                  </span>
                </div>
                <div
                  className="flex items-center gap-1 pointer-events-auto"
                  data-no-drag="true"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setChartKey((k) => k + 1)}
                    className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                    title="Refresh"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* ── SYMBOL + INTERVAL SELECTOR ───────────────────────────── */}
              <div
                className="flex-shrink-0 bg-[#000000] border-b border-white/[0.05] px-3 py-2 flex flex-col gap-1.5"
                data-no-drag="true"
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                {/* Symbol + Timeframe on same row, side by side */}
                <div className="flex items-center gap-2">
                  <HeatmapSymbolSelector
                    symbol={chartSym}
                    exchange={chartExchange}
                    onSymbolChange={handleSymbolChange}
                    onExchangeChange={handleExchangeChange}
                  />
                  <TimeframeSelector
                    interval={interval}
                    onIntervalChange={(tf) => {
                      setInterval(tf);
                      setChartKey((k) => k + 1);
                    }}
                  />
                </div>

                {/* ── Row 3: INDICATOR TOOLBAR ─────────────────────────────── */}
                <div className="flex items-center gap-1.5 pt-0.5 border-t border-white/[0.06] flex-wrap">
                  <span className="text-[9px] text-gray-700 uppercase tracking-widest font-bold flex-shrink-0">Ind</span>

                  {/* EMA pill with period sub-menu */}
                  <div className="relative">
                    <div className="flex items-center">
                      <IndPill
                        label={`EMA${ind.emaPeriod}`}
                        active={ind.showEMA}
                        color="#d97706"
                        onClick={() => toggle('showEMA')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowEmaPick((v) => !v)}
                        className="ml-0.5 px-1 py-0.5 rounded text-gray-600 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showEmaPick ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                    <AnimatePresence>
                      {showEmaPick && (
                        <MotionDiv
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.1 }}
                          className="absolute top-full left-0 mt-1 bg-[#000000] border border-white/10 rounded-xl shadow-2xl p-1 z-50 flex gap-0.5"
                        >
                          {EMA_PERIODS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setInd((prev) => ({ ...prev, emaPeriod: p, showEMA: true }));
                                setShowEmaPick(false);
                              }}
                              className={`px-2 py-1 text-[10px] font-bold rounded-lg transition-colors cursor-pointer ${
                                ind.emaPeriod === p ? 'bg-amber-500 text-black' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </MotionDiv>
                      )}
                    </AnimatePresence>
                  </div>

                  <IndPill label="BB" active={ind.showBB} color="#0ea5e9" onClick={() => toggle('showBB')} />
                  <IndPill label="RSI" active={ind.showRSI} color="#db2777" onClick={() => toggle('showRSI')} />
                  <IndPill label="MACD" active={ind.showMACD} color="#3b82f6" onClick={() => toggle('showMACD')} />
                  <IndPill label="VOL" active={ind.showVol} color="#6366f1" onClick={() => toggle('showVol')} />

                  {/* RSI/MACD note */}
                  {(ind.showRSI || ind.showMACD) && (
                    <span className="ml-auto text-[8px] text-gray-700 font-mono">sub-pane ↓</span>
                  )}
                </div>
              </div>

              {/* ── MINI CHART ───────────────────────────────────────────── */}
              <div ref={chartContentRef} className="flex-1 min-h-0 overflow-hidden">
                <MiniOrderFlowChart
                  key={`${chartKey}-${chartSym}-${chartExchange}-${interval}`}
                  symbol={chartSym}
                  exchange={chartExchange}
                  interval={interval}
                  ind={ind}
                  isThermalGuard={isThermalGuardActive}
                  isDraggingRef={isDraggingRef}
                />
              </div>
            </div>
          ) : null,
          document.body
        )}
    </>
  );
};

export const FloatingTVChartButton = React.memo(FloatingTVChartButtonBase);
