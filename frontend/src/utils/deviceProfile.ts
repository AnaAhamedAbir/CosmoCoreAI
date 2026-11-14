export type ThermalMode = 'auto' | 'eco' | 'full';
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export interface ThermalTimings {
  l2FlushMs: number;
  tradeTickChartMs: number;
  indicatorIntervalMs: number;
  bracketOpenPollMs: number;
  bracketActivePollMs: number;
  bracketClosedPollMs: number;
  balancePollMs: number;
  mlWarmupMs: number;
  openOrdersPollMs: number;
  liquidationFps: number;
  modalPriceThrottleMs: number;
  marketTradeFlushMs: number;
}

export interface DeviceThermalProfile {
  deviceClass: DeviceClass;
  isPhone: boolean;
  isTablet: boolean;
  isMobileOrTablet: boolean;
  mode: ThermalMode;
  isThermalGuardActive: boolean;
  timings: ThermalTimings;
}

const STORAGE_KEY = 'cosmo_thermal_mode';
const PROFILE_EVENT = 'cosmo:thermal-profile-change';

const DESKTOP_TIMINGS: ThermalTimings = {
  l2FlushMs: 100,
  tradeTickChartMs: 0,
  indicatorIntervalMs: 200,
  bracketOpenPollMs: 1000,
  bracketActivePollMs: 1000,
  bracketClosedPollMs: 2500,
  balancePollMs: 5500,
  mlWarmupMs: 12000,
  openOrdersPollMs: 2000,
  liquidationFps: 20,
  modalPriceThrottleMs: 0,
  marketTradeFlushMs: 0,
};

const MOBILE_THERMAL_TIMINGS: ThermalTimings = {
  l2FlushMs: 600,
  tradeTickChartMs: 120,
  indicatorIntervalMs: 2000,
  bracketOpenPollMs: 4000,
  bracketActivePollMs: 2000,
  bracketClosedPollMs: 12000,
  balancePollMs: 10000,
  mlWarmupMs: 30000,
  openOrdersPollMs: 7500,
  liquidationFps: 10,
  modalPriceThrottleMs: 1000,
  marketTradeFlushMs: 500,
};

export function getStoredThermalMode(): ThermalMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = window.localStorage.getItem(STORAGE_KEY);
    if (val === 'eco' || val === 'full' || val === 'auto') {
      return val;
    }
  } catch {
    // Ignore storage access errors (private browsing / restricted context)
  }
  return 'auto';
}

export function detectDeviceClass(): DeviceClass {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'desktop';
  }

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const uaDataMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;

  const hasCoarsePointer =
    Boolean(window.matchMedia?.('(pointer: coarse)')?.matches) ||
    Boolean(window.matchMedia?.('(any-pointer: coarse)')?.matches);
  const lacksHover = Boolean(window.matchMedia?.('(hover: none)')?.matches);

  const isExplicitPhoneUA = /iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobileToken = /Mobile/i.test(ua) || uaDataMobile === true;
  const isTabletUA =
    /iPad|Tablet|PlayBook|Silk|MIUI|HyperOS|Redmi Pad|Pad/i.test(ua) ||
    (/Macintosh/i.test(ua) && maxTouchPoints > 1) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);

  if (isExplicitPhoneUA || (isAndroid && isMobileToken)) {
    return 'phone';
  }

  // Android tablets (e.g., Redmi Pad 2 Pro) and iPads often report desktop-wide viewports
  // or drop "Mobile" in UA; detect reliably via UA + pointer/touch characteristics.
  if (isTabletUA || isAndroid) {
    return 'tablet';
  }

  // Fallback for Chrome "Desktop site" on Android/iOS tablets & phones:
  // Windows laptops with touchscreens still report fine pointer + hover + Windows UA.
  const isDesktopOS = /Windows NT|Win32|Win64|CrOS/i.test(ua);
  if (!isDesktopOS && hasCoarsePointer && lacksHover && maxTouchPoints >= 2) {
    const minDim = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
    return minDim < 580 ? 'phone' : 'tablet';
  }

  return 'desktop';
}

export function computeThermalProfile(): DeviceThermalProfile {
  const deviceClass = detectDeviceClass();
  const mode = getStoredThermalMode();
  const isPhone = deviceClass === 'phone';
  const isTablet = deviceClass === 'tablet';
  const isMobileOrTablet = isPhone || isTablet;

  const isThermalGuardActive =
    mode === 'eco' ? true : mode === 'full' ? false : isMobileOrTablet;

  return {
    deviceClass,
    isPhone,
    isTablet,
    isMobileOrTablet,
    mode,
    isThermalGuardActive,
    timings: isThermalGuardActive ? MOBILE_THERMAL_TIMINGS : DESKTOP_TIMINGS,
  };
}

let cachedProfile: DeviceThermalProfile | null = null;

export function getThermalProfile(forceRefresh = false): DeviceThermalProfile {
  if (!cachedProfile || forceRefresh) {
    cachedProfile = computeThermalProfile();
  }
  return cachedProfile;
}

export function isThermalGuardActive(): boolean {
  return getThermalProfile().isThermalGuardActive;
}

export function syncThermalDocumentClass(): DeviceThermalProfile {
  const profile = getThermalProfile(true);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.classList.toggle('mobile-thermal-guard', profile.isThermalGuardActive);
    root.dataset.deviceClass = profile.deviceClass;
    root.dataset.thermalMode = profile.mode;
  }
  return profile;
}

export function setThermalModeOverride(mode: ThermalMode): DeviceThermalProfile {
  if (typeof window !== 'undefined') {
    try {
      if (mode === 'auto') {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, mode);
      }
    } catch {
      // ignore
    }
  }
  const next = syncThermalDocumentClass();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: next }));
  }
  return next;
}

export function subscribeThermalProfile(listener: (profile: DeviceThermalProfile) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleCustom = () => listener(getThermalProfile(true));
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      listener(syncThermalDocumentClass());
    }
  };
  window.addEventListener(PROFILE_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(PROFILE_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}

if (typeof window !== 'undefined') {
  syncThermalDocumentClass();
  (window as Window & { __COSMO_THERMAL__?: unknown }).__COSMO_THERMAL__ = {
    getProfile: () => getThermalProfile(true),
    setMode: (mode: ThermalMode) => setThermalModeOverride(mode),
  };
}

