
import React, { createContext, useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeCoordinates {
  clientX?: number;
  clientY?: number;
}

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme | ((prevTheme: Theme) => Theme), coords?: ThemeCoordinates) => void;
  toggleTheme: (eventOrCoords?: React.MouseEvent | ThemeCoordinates) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Helper to temporarily suppress CSS transitions across all DOM elements during theme swap.
// This prevents layout thrashing, style recalculation storms, and animation lag across 1,900+ elements.
const disableTransitionsTemporarily = () => {
  if (typeof document === 'undefined') return () => {};

  const css = document.createElement('style');
  css.setAttribute('type', 'text/css');
  css.appendChild(
    document.createTextNode(
      `*, *::before, *::after {
        -webkit-transition: none !important;
        -moz-transition: none !important;
        -o-transition: none !important;
        -ms-transition: none !important;
        transition: none !important;
      }`
    )
  );
  document.head.appendChild(css);

  return () => {
    // Force a reflow to flush computed styles immediately without transition
    const target = document.body || document.documentElement;
    if (target) {
      (() => window.getComputedStyle(target).opacity)();
    }

    // Restore transitions cleanly on the next animation frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (document.head.contains(css)) {
          document.head.removeChild(css);
        }
      });
    });
  };
};

const applyThemeToDOM = (nextTheme: Theme) => {
  if (typeof window === 'undefined' || !window.document) return;
  const root = window.document.documentElement;
  const restoreTransitions = disableTransitionsTemporarily();

  if (nextTheme === 'dark') {
    root.classList.remove('light');
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
  }

  try {
    window.localStorage.setItem('theme', nextTheme);
  } catch {
    // Ignore storage quota or security errors
  }

  restoreTransitions();
};

// Creates a radiant GPU-accelerated glowing wave pulse originating from the button/cursor
const triggerGlowWave = (x: number, y: number, nextTheme: Theme) => {
  if (typeof document === 'undefined') return;

  const isDark = nextTheme === 'dark';
  // Cosmic purple/indigo glow for dark mode, luminous warm amber/cyan glow for light mode
  const glowColor = isDark ? 'rgba(99, 102, 241, 0.75)' : 'rgba(245, 158, 11, 0.85)';
  const secondaryColor = isDark ? 'rgba(168, 85, 247, 0.45)' : 'rgba(56, 189, 248, 0.45)';

  const ring = document.createElement('div');
  ring.className = 'theme-glow-wave-pulse';
  ring.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    width: 24px;
    height: 24px;
    margin-left: -12px;
    margin-top: -12px;
    border-radius: 50%;
    pointer-events: none;
    z-index: 999999;
    border: 3px solid ${glowColor};
    box-shadow: 0 0 40px 15px ${glowColor}, 0 0 80px 30px ${secondaryColor}, inset 0 0 20px ${glowColor};
    transform: scale(0.2);
    opacity: 1;
    transition: transform 600ms cubic-bezier(0.16, 1, 0.3, 1), opacity 600ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform, opacity;
  `;

  document.body.appendChild(ring);

  const maxRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  requestAnimationFrame(() => {
    const targetScale = Math.max((maxRadius * 2.2) / 24, 10);
    ring.style.transform = `scale(${targetScale})`;
    ring.style.opacity = '0';
  });

  setTimeout(() => {
    if (document.body.contains(ring)) {
      document.body.removeChild(ring);
    }
  }, 700);
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const storedTheme = window.localStorage.getItem('theme') as Theme;
      if (storedTheme === 'light' || storedTheme === 'dark') {
        return storedTheme;
      }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    }
    return 'dark'; // Default to dark theme as per original design
  });

  const themeRef = useRef<Theme>(theme);
  const isTransitioningRef = useRef<boolean>(false);

  // Keep ref synchronized with state
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Ensure DOM class and localStorage match on initial mount
  useEffect(() => {
    const root = window.document.documentElement;
    if (!root.classList.contains(theme)) {
      root.classList.remove(theme === 'dark' ? 'light' : 'dark');
      root.classList.add(theme);
    }
  }, [theme]);

  const setTheme = useCallback((
    nextThemeOrFn: Theme | ((prevTheme: Theme) => Theme),
    coords?: ThemeCoordinates
  ) => {
    const currentTheme = themeRef.current;
    const nextTheme = typeof nextThemeOrFn === 'function' ? nextThemeOrFn(currentTheme) : nextThemeOrFn;
    if (nextTheme === currentTheme) return;

    // Immediately update ref to protect against rapid double-clicks
    themeRef.current = nextTheme;

    // Resolve click coordinates (defaults smoothly to top-right where ThemeToggle sits)
    const x = coords?.clientX ?? (typeof window !== 'undefined' ? window.innerWidth - 48 : 0);
    const y = coords?.clientY ?? 40;

    const doc = typeof document !== 'undefined' ? (document as any) : null;
    const supportsViewTransition =
      doc &&
      typeof doc.startViewTransition === 'function' &&
      !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

    // If rapid click or view transitions not supported, apply with smooth glow wave fallback
    if (isTransitioningRef.current || !supportsViewTransition) {
      applyThemeToDOM(nextTheme);
      triggerGlowWave(x, y, nextTheme);
      React.startTransition(() => {
        setThemeState(nextTheme);
      });
      return;
    }

    isTransitioningRef.current = true;
    const resetTransition = () => {
      isTransitioningRef.current = false;
    };

    try {
      const transition = doc.startViewTransition(() => {
        // 1. Synchronously swap DOM classes
        applyThemeToDOM(nextTheme);
        // 2. Concurrently update React state
        React.startTransition(() => {
          setThemeState(nextTheme);
        });
      });

      // Launch the luminous glow ring pulse
      triggerGlowWave(x, y, nextTheme);

      transition.ready
        .then(() => {
          const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y)
          );

          // Animate the smooth circular flow revealing the new theme
          document.documentElement.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`
              ]
            },
            {
              duration: 550,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)'
            }
          );
        })
        .catch(resetTransition);

      if (transition.finished) {
        transition.finished.then(resetTransition).catch(resetTransition);
      } else {
        setTimeout(resetTransition, 600);
      }
    } catch {
      resetTransition();
      applyThemeToDOM(nextTheme);
      triggerGlowWave(x, y, nextTheme);
      React.startTransition(() => {
        setThemeState(nextTheme);
      });
    }
  }, []);

  const toggleTheme = useCallback((eventOrCoords?: React.MouseEvent | ThemeCoordinates) => {
    let coords: ThemeCoordinates | undefined;
    if (eventOrCoords && 'clientX' in eventOrCoords && typeof eventOrCoords.clientX === 'number') {
      coords = { clientX: eventOrCoords.clientX, clientY: eventOrCoords.clientY };
    }
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'), coords);
  }, [setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};



