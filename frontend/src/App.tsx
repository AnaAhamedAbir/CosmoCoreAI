import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import PublicWebsite from '@/pages/public/PublicWebsite';
import AppDashboard from '@/pages/app/AppDashboard';
import LoginTransition from '@/pages/app/LoginTransition';
import SignUpFormModal from '@/pages/public/SignUpFormModal';
import LoginFormModal from '@/pages/public/LoginFormModal';
import ForgotPasswordModal from '@/pages/public/ForgotPasswordModal';
import ResetPasswordScreen from '@/pages/public/ResetPasswordScreen';
import { AppView } from '@/types';
import { Toaster } from 'react-hot-toast';
import { syncThermalDocumentClass } from '@/utils/deviceProfile';
import { useViewportProfile } from '@/hooks/useViewportProfile';
import MaintenanceOverlay from '@/components/common/MaintenanceOverlay';
import VersionUpdateBanner from '@/components/common/VersionUpdateBanner';

// AppState Enum আপডেট
enum AppState {
  PUBLIC,
  SHOW_SIGNUP_MODAL,
  SHOW_LOGIN_MODAL,
  SHOW_FORGOT_PASSWORD_MODAL,
  RESET_PASSWORD_SCREEN,
  LOGGING_IN_TRANSITION,
  LOGGED_IN,
}

const clearPortfolioSessionCache = () => {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith('cosmo_portfolio_v1:') || k === 'cosmo_portfolio_dirty')) {
        sessionStorage.removeItem(k);
      }
    }
  } catch {
    // Ignore storage access errors
  }
};

function App() {
  useViewportProfile();
  const navigate = useNavigate();
  const [appState, setAppState] = useState<AppState>(() => {
    if (typeof window !== 'undefined') {
      const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
      if (token) return AppState.LOGGED_IN;
    }
    return AppState.PUBLIC;
  });
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  // Sync dynamic viewport height (--app-height) for tablet/mobile Chrome (e.g., Redmi Pad 2 Pro)
  useEffect(() => {
    syncThermalDocumentClass();
    const isInputActive = () => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
    };

    const updateAppHeight = () => {
      // Prevent crushing/shrinking the layout height when virtual keyboard pops up on tablets/phones
      if (isInputActive()) {
        return;
      }
      const vh = window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${vh}px`);
    };

    updateAppHeight();
    window.addEventListener('resize', updateAppHeight);
    window.addEventListener('orientationchange', () => {
      setTimeout(updateAppHeight, 150);
    });

    const handleFocusOut = () => {
      setTimeout(updateAppHeight, 200);
    };
    window.addEventListener('focusout', handleFocusOut);

    // Multi-touch pinch zoom is already disabled natively via CSS `touch-action: pan-x pan-y`
    // and viewport meta without registering a scroll-blocking non-passive touchmove listener on document.
    const preventGestureZoom = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('gesturestart', preventGestureZoom, { passive: false } as AddEventListenerOptions);
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false } as AddEventListenerOptions);

    return () => {
      window.removeEventListener('resize', updateAppHeight);
      window.removeEventListener('orientationchange', updateAppHeight);
      window.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
    };
  }, []);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('refreshToken');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    clearPortfolioSessionCache();
    
    // Broadcast logout to other tabs
    localStorage.setItem('cross-tab-logout', Date.now().toString());
    
    // Reset React Router to root cleanly without hard reload
    navigate('/', { replace: true });

    // Instantly reset scroll to top of public page
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.dispatchEvent(new CustomEvent('app:settings-reset'));

    setAppState(AppState.PUBLIC);
  }, [navigate]);

  useEffect(() => {
    const handleMaintenance = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      setMaintenanceMessage(detail?.message || 'Platform is currently undergoing scheduled maintenance.');
    };
    window.addEventListener('app:maintenance', handleMaintenance);

    const handleAppLogout = () => {
      handleLogout();
    };
    window.addEventListener('app:logout', handleAppLogout);

    // Check if token exists in current tab's session or local storage
    const token = sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
    if (token) {
      setAppState(AppState.LOGGED_IN);
    } else {
      // If no token in this tab, ask other open tabs for their session
      localStorage.setItem('request-session-sync', Date.now().toString());
    }

    // Listen for storage events from other tabs
    const handleStorageEvent = (event: StorageEvent) => {
      // Another tab requested a session sync, and we have a session to share
      if (event.key === 'request-session-sync' && sessionStorage.getItem('accessToken')) {
        localStorage.setItem('session-sync-data', JSON.stringify({
          accessToken: sessionStorage.getItem('accessToken'),
          refreshToken: sessionStorage.getItem('refreshToken')
        }));
        // Remove it immediately so it doesn't linger in localStorage
        localStorage.removeItem('session-sync-data');
      }

      // We received session data from another tab
      if (event.key === 'session-sync-data' && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          if (data.accessToken) {
            sessionStorage.setItem('accessToken', data.accessToken);
            if (data.refreshToken) sessionStorage.setItem('refreshToken', data.refreshToken);
            setAppState(AppState.LOGGED_IN);
          }
        } catch (e) {
          console.error('Error parsing session sync data', e);
        }
      }

      // Handle Cross-Tab Logout Sync
      if (event.key === 'cross-tab-logout') {
        sessionStorage.removeItem('accessToken');
        sessionStorage.removeItem('refreshToken');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        clearPortfolioSessionCache();
        navigate('/', { replace: true });
        window.scrollTo({ top: 0, behavior: 'instant' });
        setAppState(AppState.PUBLIC);
      }
    };

    window.addEventListener('storage', handleStorageEvent);

    const searchParams = new URLSearchParams(window.location.search);
    const resetTokenParam = searchParams.get('token');

    if (resetTokenParam) {
      setResetToken(resetTokenParam);
      setAppState(AppState.RESET_PASSWORD_SCREEN);
      navigate('/', { replace: true });
    }

    return () => {
      window.removeEventListener('app:maintenance', handleMaintenance);
      window.removeEventListener('app:logout', handleAppLogout);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, [handleLogout, navigate]);

  const handleForgotPasswordInitiate = useCallback(() => {
    setAppState(AppState.SHOW_FORGOT_PASSWORD_MODAL);
  }, []);

  const handleResetSuccess = useCallback(() => {
    setAppState(AppState.SHOW_LOGIN_MODAL);
  }, []);

  const handleBackToLogin = useCallback(() => {
    setAppState(AppState.SHOW_LOGIN_MODAL);
  }, []);

  const handleLoginInitiate = useCallback(() => {
    setAppState(AppState.SHOW_LOGIN_MODAL);
  }, []);

  const handleSignUpInitiate = useCallback(() => {
    setAppState(AppState.SHOW_SIGNUP_MODAL);
  }, []);

  // সাইনআপ থেকে লগইন মোডালে যাওয়ার জন্য
  const switchToLogin = useCallback(() => {
    setAppState(AppState.SHOW_LOGIN_MODAL);
  }, []);

  // লগইন থেকে সাইনআপ মোডালে যাওয়ার জন্য
  const switchToSignUp = useCallback(() => {
    setAppState(AppState.SHOW_SIGNUP_MODAL);
  }, []);

  // লগইন বা সাইনআপ সফল হওয়ার পর (API কল সাকসেস হলে)
  const handleAuthSuccess = useCallback(() => {
    window.dispatchEvent(new CustomEvent('app:settings-refresh'));
    setAppState(AppState.LOGGING_IN_TRANSITION);
  }, []);

  const isDashboardActive = appState === AppState.LOGGED_IN;
  const isTransitioning = appState === AppState.LOGGING_IN_TRANSITION;
  const isResetScreen = appState === AppState.RESET_PASSWORD_SCREEN && Boolean(resetToken);

  return (
    <div className={isDashboardActive ? "h-[var(--app-height,100dvh)] max-h-[var(--app-height,100dvh)] w-full max-w-[100vw] overflow-hidden font-sans" : "min-h-[var(--app-height,100dvh)] font-sans"}>
      <Toaster 
        position="top-right" 
        toastOptions={{ 
          className: '!bg-[#121212] !text-white !border !border-white/10 !shadow-2xl',
          style: { zIndex: 999999 } 
        }} 
      />
      <VersionUpdateBanner />
      
      {/* 1. Public Landing Page & Modals (unmounted while authenticated to avoid background WS/canvas/iframe overhead) */}
      {!isDashboardActive && !isTransitioning && !isResetScreen && (
        <div className="contents">
          <PublicWebsite onLogin={handleLoginInitiate} onSignUp={handleSignUpInitiate} />
          <AnimatePresence>
            {appState === AppState.SHOW_LOGIN_MODAL && (
              <LoginFormModal
                key="login-modal"
                onClose={() => setAppState(AppState.PUBLIC)}
                onLoginSuccess={handleAuthSuccess}
                onSwitchToSignup={switchToSignUp}
                onSwitchToForgotPassword={handleForgotPasswordInitiate}
              />
            )}
            {appState === AppState.SHOW_SIGNUP_MODAL && (
              <SignUpFormModal
                key="signup-modal"
                onClose={() => setAppState(AppState.PUBLIC)}
                onRegister={handleAuthSuccess}
                onSwitchToLogin={switchToLogin}
              />
            )}
            {appState === AppState.SHOW_FORGOT_PASSWORD_MODAL && (
              <ForgotPasswordModal
                key="forgot-password-modal"
                onClose={() => setAppState(AppState.PUBLIC)}
                onBackToLogin={handleBackToLogin}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* 2. Login Transition */}
      {isTransitioning && (
        <LoginTransition onAnimationComplete={() => setAppState(AppState.LOGGED_IN)} />
      )}

      {/* 3. Authenticated Dashboard */}
      {isDashboardActive && (
        <AppDashboard onLogout={handleLogout} />
      )}

      {/* 4. Reset Password Screen */}
      {isResetScreen && (
        <ResetPasswordScreen token={resetToken!} onResetSuccess={handleResetSuccess} />
      )}

      {/* 5. Scheduled Maintenance Overlay (dismissible by Owner login or Retry) */}
      {maintenanceMessage && (
        <MaintenanceOverlay
          message={maintenanceMessage}
          onRetry={() => {
            setMaintenanceMessage(null);
            window.dispatchEvent(new CustomEvent('app:settings-refresh'));
          }}
          onOwnerLogin={() => {
            setMaintenanceMessage(null);
            setAppState(AppState.SHOW_LOGIN_MODAL);
          }}
        />
      )}
    </div>
  );
}

export default App;
