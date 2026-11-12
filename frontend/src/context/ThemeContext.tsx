
import React, { createContext, useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme | ((prevTheme: Theme) => Theme)) => void;
  toggleTheme: () => void;
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

  const setTheme = useCallback((nextThemeOrFn: Theme | ((prevTheme: Theme) => Theme)) => {
    const currentTheme = themeRef.current;
    const nextTheme = typeof nextThemeOrFn === 'function' ? nextThemeOrFn(currentTheme) : nextThemeOrFn;
    if (nextTheme === currentTheme) return;

    // Immediately update ref to protect against rapid double-clicks
    themeRef.current = nextTheme;

    // 1. Immediately apply to DOM synchronously (0ms visual latency, no transition lag)
    applyThemeToDOM(nextTheme);

    // 2. Wrap React component re-rendering in startTransition for non-blocking UI
    React.startTransition(() => {
      setThemeState(nextTheme);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
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


