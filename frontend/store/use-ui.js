"use client";

import { create } from "zustand";

const THEME_KEY = "stox_theme";
const SIDEBAR_KEY = "stox_sidebar_collapsed";
const PORTFOLIO_KEY = "stox_active_portfolio";

function readStorage(key, fallback = null) {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode); UI still works.
  }
}

function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

export const useUI = create((set, get) => ({
  theme: "dark",
  sidebarCollapsed: false,
  activePortfolioId: null,
  commandOpen: false,
  mobileNavOpen: false,
  booted: false,

  boot: () => {
    if (get().booted) return;

    const theme = readStorage(THEME_KEY, "dark");
    const sidebarCollapsed = readStorage(SIDEBAR_KEY, "false") === "true";
    const activePortfolioId = readStorage(PORTFOLIO_KEY);

    applyTheme(theme);

    if (activePortfolioId) {
      // Validate lazily against the portfolio list; a stale id simply falls
      // back to the default portfolio.
    }

    set({ theme, sidebarCollapsed, activePortfolioId, booted: true });
  },

  setTheme: (theme) => {
    applyTheme(theme);
    writeStorage(THEME_KEY, theme);
    set({ theme });
  },

  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
  },

  setSidebarCollapsed: (collapsed) => {
    writeStorage(SIDEBAR_KEY, String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },

  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),

  setActivePortfolioId: (id) => {
    if (id) writeStorage(PORTFOLIO_KEY, id);
    else writeStorage(PORTFOLIO_KEY, "");
    set({ activePortfolioId: id });
  },

  setCommandOpen: (open) => set({ commandOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
}));
