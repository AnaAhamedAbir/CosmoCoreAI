export type ThermalMode = 'auto' | 'eco' | 'full';
export type DeviceClass = 'phone' | 'tablet' | 'desktop';
export type PhoneViewMode = 'mobile' | 'desktop';

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
  phoneViewMode: PhoneViewMode;
  isPhoneMobileUI: boolean;
  mode: ThermalMode;
  isThermalGuardActive: boolean;
  timings: ThermalTimings;
}

const STORAGE_KEY = 'cosmo_thermal_mode';
const PHONE_VIEW_STORAGE_KEY = 'cosmo_phone_view_mode';
const PROFILE_EVENT = 'cosmo:thermal-profile-change';
const MOBILE_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=overlays-content';
const DESKTOP_EMULATED_VIEWPORT_CONTENT =
  'width=1280, user-scalable=no, interactive-widget=overlays-content';

const DESKTOP_TIMINGS: ThermalTimings = {
  l2FlushMs: 50,
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
  l2FlushMs: 200,
  tradeTickChartMs: 40,
  indicatorIntervalMs: 2000,
  bracketOpenPollMs: 1800,
  bracketActivePollMs: 1200,
  bracketClosedPollMs: 12000,
  balancePollMs: 6500,
  mlWarmupMs: 15000,
  openOrdersPollMs: 4000,
  liquidationFps: 10,
  modalPriceThrottleMs: 120,
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

export function getStoredPhoneViewMode(): PhoneViewMode {
  if (typeof window === 'undefined') return 'mobile';
  try {
    const val = window.localStorage.getItem(PHONE_VIEW_STORAGE_KEY);
    if (val === 'desktop' || val === 'mobile') {
      return val;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'mobile';
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
  const phoneViewMode: PhoneViewMode = isPhone ? getStoredPhoneViewMode() : 'desktop';
  const isPhoneMobileUI = isPhone && phoneViewMode === 'mobile';

  const isThermalGuardActive =
    mode === 'eco' ? true : mode === 'full' ? false : isMobileOrTablet;

  return {
    deviceClass,
    isPhone,
    isTablet,
    isMobileOrTablet,
    phoneViewMode,
    isPhoneMobileUI,
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
    root.classList.toggle('mobile-phone-ui', profile.isPhoneMobileUI);
    root.classList.toggle('mobile-desktop-mode', profile.isPhone && profile.phoneViewMode === 'desktop');
    root.dataset.deviceClass = profile.deviceClass;
    root.dataset.thermalMode = profile.mode;
    root.dataset.phoneViewMode = profile.phoneViewMode;

    // Dynamically adjust viewport ONLY on auto-detected phones.
    // Tablets and PCs keep index.html viewport untouched; two-finger zoom stays disabled.
    if (profile.isPhone) {
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      if (viewportMeta) {
        const desired =
          profile.phoneViewMode === 'desktop'
            ? DESKTOP_EMULATED_VIEWPORT_CONTENT
            : MOBILE_VIEWPORT_CONTENT;
        if (viewportMeta.getAttribute('content') !== desired) {
          viewportMeta.setAttribute('content', desired);
        }
      }
    }
  }
  return profile;
}

export function setPhoneViewMode(mode: PhoneViewMode): DeviceThermalProfile {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PHONE_VIEW_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  }
  const next = syncThermalDocumentClass();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: next }));
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }
  return next;
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
    if (e.key === STORAGE_KEY || e.key === PHONE_VIEW_STORAGE_KEY) {
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
    setPhoneViewMode: (mode: PhoneViewMode) => setPhoneViewMode(mode),
  };
}

