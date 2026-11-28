export type DisplayTier = 'compact-hd' | 'standard-hd' | 'full-hd' | 'qhd-4k';
export type DisplayFitMode = 'auto' | 'fit' | 'comfort' | 'native';

export interface ViewportMetrics {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  dpr: number;
  aspectRatio: number;
}

export interface ViewportCssTokens {
  rootFontPx: number;
  sidebarExpandedPx: number;
  headerHeightPx: number;
  mainPaddingPx: number;
  panelGapPx: number;
  cardPaddingPx: number;
  chartHeightMd: string;
  chartHeightLg: string;
}

export interface ViewportProfile {
  tier: DisplayTier;
  tierLabel: string;
  mode: DisplayFitMode;
  metrics: ViewportMetrics;
  isCompactViewport: boolean;
  isStandardOrCompact: boolean;
  isFullHdOrLarger: boolean;
  tokens: ViewportCssTokens;
}

const STORAGE_KEY = 'cosmo_display_fit_mode';
const VIEWPORT_EVENT = 'cosmo:viewport-profile-change';

const TIER_LABELS: Record<DisplayTier, string> = {
  'compact-hd': 'Compact HD (≤1366×768)',
  'standard-hd': 'Standard HD (1440–1600)',
  'full-hd': 'Full HD (1920×1080)',
  'qhd-4k': 'QHD / 4K (2560+)',
};

export function getStoredDisplayFitMode(): DisplayFitMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'auto' || raw === 'fit' || raw === 'comfort' || raw === 'native') {
      return raw;
    }
  } catch {
    // Ignore storage restrictions
  }
  return 'auto';
}

export function readViewportMetrics(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return {
      width: 1920,
      height: 1080,
      screenWidth: 1920,
      screenHeight: 1080,
      dpr: 1,
      aspectRatio: 16 / 9,
    };
  }

  const width = Math.round(window.visualViewport?.width || window.innerWidth || 1920);
  const height = Math.round(window.visualViewport?.height || window.innerHeight || 1080);
  const screenWidth = Math.round(window.screen?.width || width);
  const screenHeight = Math.round(window.screen?.height || height);
  const dpr = Number((window.devicePixelRatio || 1).toFixed(2));
  const aspectRatio = height > 0 ? Number((width / height).toFixed(3)) : 1.778;

  return { width, height, screenWidth, screenHeight, dpr, aspectRatio };
}

export function classifyDisplayTier(metrics: ViewportMetrics): DisplayTier {
  const { width, height } = metrics;

  // 1366x768, 1280x720, 1360x768, or compact VPS/RDP windows
  if (width <= 1400 || height <= 820) {
    return 'compact-hd';
  }

  // 1440x900, 1536x864 (1080p @ 125% Windows scaling), 1600x900, 1680x1050
  if (width <= 1720 || height <= 930) {
    return 'standard-hd';
  }

  // 2560x1440, 3440x1440, 3840x2160
  if (width >= 2300) {
    return 'qhd-4k';
  }

  // 1920x1080 reference baseline
  return 'full-hd';
}

export function computeViewportTokens(
  tier: DisplayTier,
  mode: DisplayFitMode,
  metrics: ViewportMetrics
): ViewportCssTokens {
  if (mode === 'native') {
    return {
      rootFontPx: 16,
      sidebarExpandedPx: 288,
      headerHeightPx: 56,
      mainPaddingPx: 32,
      panelGapPx: 24,
      cardPaddingPx: 24,
      chartHeightMd: '256px',
      chartHeightLg: '288px',
    };
  }

  if (mode === 'comfort') {
    const compact = tier === 'compact-hd';
    return {
      rootFontPx: tier === 'qhd-4k' ? 17 : compact ? 15.5 : 16,
      sidebarExpandedPx: compact ? 228 : tier === 'standard-hd' ? 252 : 288,
      headerHeightPx: compact ? 48 : 56,
      mainPaddingPx: compact ? 12 : tier === 'standard-hd' ? 20 : 32,
      panelGapPx: compact ? 12 : 20,
      cardPaddingPx: compact ? 14 : 20,
      chartHeightMd: compact ? 'clamp(220px, 34vh, 260px)' : '256px',
      chartHeightLg: compact ? 'clamp(250px, 40vh, 300px)' : '288px',
    };
  }

  const isFit = mode === 'fit';

  switch (tier) {
    case 'compact-hd':
      return {
        // 1366x768 (~71% width / ~68% height of 1920x1080):
        // Scale rem proportionally so 1920x1080 multi-column & single-row layouts fit cleanly.
        rootFontPx: isFit ? 11.5 : 12.5,
        sidebarExpandedPx: isFit ? 184 : 196,
        headerHeightPx: isFit ? 38 : 42,
        mainPaddingPx: isFit ? 6 : 8,
        panelGapPx: isFit ? 6 : 8,
        cardPaddingPx: isFit ? 8 : 10,
        chartHeightMd: 'clamp(200px, 32vh, 256px)',
        chartHeightLg: 'clamp(224px, 38vh, 288px)',
      };

    case 'standard-hd':
      return {
        rootFontPx: isFit ? 13 : 14,
        sidebarExpandedPx: isFit ? 210 : 228,
        headerHeightPx: isFit ? 42 : 46,
        mainPaddingPx: isFit ? 8 : 12,
        panelGapPx: isFit ? 10 : 12,
        cardPaddingPx: isFit ? 12 : 14,
        chartHeightMd: 'clamp(220px, 34vh, 264px)',
        chartHeightLg: 'clamp(248px, 39vh, 296px)',
      };

    case 'qhd-4k': {
      const isUltra4K = metrics.width >= 3200;
      return {
        rootFontPx: isFit ? 16 : isUltra4K ? 17 : 16.5,
        sidebarExpandedPx: isUltra4K ? 304 : 288,
        headerHeightPx: 56,
        mainPaddingPx: 28,
        panelGapPx: 20,
        cardPaddingPx: 24,
        chartHeightMd: 'clamp(256px, 30vh, 320px)',
        chartHeightLg: 'clamp(288px, 35vh, 380px)',
      };
    }

    case 'full-hd':
    default:
      return {
        rootFontPx: isFit ? 15.5 : 16,
        sidebarExpandedPx: 288,
        headerHeightPx: 56,
        mainPaddingPx: isFit ? 20 : 32,
        panelGapPx: isFit ? 16 : 24,
        cardPaddingPx: 24,
        chartHeightMd: '256px',
        chartHeightLg: '288px',
      };
  }
}

export function computeViewportProfile(): ViewportProfile {
  const metrics = readViewportMetrics();
  const mode = getStoredDisplayFitMode();
  const tier = classifyDisplayTier(metrics);
  const tokens = computeViewportTokens(tier, mode, metrics);

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    mode,
    metrics,
    isCompactViewport: tier === 'compact-hd',
    isStandardOrCompact: tier === 'compact-hd' || tier === 'standard-hd',
    isFullHdOrLarger: tier === 'full-hd' || tier === 'qhd-4k',
    tokens,
  };
}

let cachedViewportProfile: ViewportProfile | null = null;

export function getViewportProfile(forceRefresh = false): ViewportProfile {
  if (!cachedViewportProfile || forceRefresh) {
    cachedViewportProfile = computeViewportProfile();
  }
  return cachedViewportProfile;
}

export function syncViewportProfileToDocument(): ViewportProfile {
  const profile = getViewportProfile(true);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    const { tier, mode, metrics, tokens } = profile;

    root.dataset.displayTier = tier;
    root.dataset.displayMode = mode;
    root.dataset.viewportSize = `${metrics.width}x${metrics.height}`;

    root.classList.toggle('display-compact-hd', tier === 'compact-hd');
    root.classList.toggle('display-standard-hd', tier === 'standard-hd');
    root.classList.toggle('display-full-hd', tier === 'full-hd');
    root.classList.toggle('display-qhd-4k', tier === 'qhd-4k');

    root.classList.toggle('display-mode-auto', mode === 'auto');
    root.classList.toggle('display-mode-fit', mode === 'fit');
    root.classList.toggle('display-mode-comfort', mode === 'comfort');
    root.classList.toggle('display-mode-native', mode === 'native');

    root.style.setProperty('--ui-root-font', `${tokens.rootFontPx}px`);
    root.style.setProperty('--shell-sidebar-w', `${tokens.sidebarExpandedPx}px`);
    root.style.setProperty('--shell-header-h', `${tokens.headerHeightPx}px`);
    root.style.setProperty('--shell-main-pad', `${tokens.mainPaddingPx}px`);
    root.style.setProperty('--panel-gap', `${tokens.panelGapPx}px`);
    root.style.setProperty('--card-pad', `${tokens.cardPaddingPx}px`);
    root.style.setProperty('--chart-h-md', tokens.chartHeightMd);
    root.style.setProperty('--chart-h-lg', tokens.chartHeightLg);
  }
  return profile;
}

export function setDisplayFitMode(mode: DisplayFitMode): ViewportProfile {
  if (typeof window !== 'undefined') {
    try {
      if (mode === 'auto') {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, mode);
      }
    } catch {
      // Ignore storage restrictions
    }
  }

  const next = syncViewportProfileToDocument();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VIEWPORT_EVENT, { detail: next }));
    window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }
  return next;
}

export function subscribeViewportProfile(
  listener: (profile: ViewportProfile) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleCustom = () => listener(getViewportProfile(true));
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      listener(syncViewportProfileToDocument());
    }
  };

  window.addEventListener(VIEWPORT_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(VIEWPORT_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

if (typeof window !== 'undefined') {
  syncViewportProfileToDocument();
  (window as Window & { __COSMO_DISPLAY__?: unknown }).__COSMO_DISPLAY__ = {
    getProfile: () => getViewportProfile(true),
    setMode: (mode: DisplayFitMode) => setDisplayFitMode(mode),
    sync: () => syncViewportProfileToDocument(),
  };
}
