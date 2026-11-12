import { useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Keep reference globally in case beforeinstallprompt fires before modal mounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
    promptListeners.forEach((cb) => cb());
  });

  window.addEventListener('appinstalled', () => {
    globalDeferredPrompt = null;
    promptListeners.forEach((cb) => cb());
  });
}

export interface PwaInstallState {
  isInstalled: boolean;
  canPromptInstall: boolean;
  isSecureContext: boolean;
  swRegistered: boolean;
  installOutcome: 'idle' | 'accepted' | 'dismissed';
  promptInstall: () => Promise<void>;
}

function checkStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneMedia || iosStandalone;
}

export function usePwaInstall(): PwaInstallState {
  const [isInstalled, setIsInstalled] = useState<boolean>(checkStandaloneMode);
  const [hasPrompt, setHasPrompt] = useState<boolean>(() => globalDeferredPrompt !== null);
  const [swRegistered, setSwRegistered] = useState<boolean>(false);
  const [installOutcome, setInstallOutcome] = useState<'idle' | 'accepted' | 'dismissed'>('idle');

  useEffect(() => {
    const syncPrompt = () => {
      setHasPrompt(globalDeferredPrompt !== null);
      setIsInstalled(checkStandaloneMode());
    };
    promptListeners.add(syncPrompt);

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setIsInstalled(checkStandaloneMode());
    mediaQuery?.addEventListener?.('change', onDisplayChange);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => setSwRegistered(Boolean(reg)))
        .catch(() => setSwRegistered(false));
    }

    return () => {
      promptListeners.delete(syncPrompt);
      mediaQuery?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!globalDeferredPrompt) return;
    const promptEvent = globalDeferredPrompt;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setInstallOutcome(outcome);
    if (outcome === 'accepted') {
      globalDeferredPrompt = null;
      setHasPrompt(false);
      setIsInstalled(true);
    }
  }, []);

  return {
    isInstalled,
    canPromptInstall: hasPrompt && !isInstalled,
    isSecureContext: typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
    swRegistered,
    installOutcome,
    promptInstall,
  };
}

