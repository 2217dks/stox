import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names without Tailwind conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Build a stable query string, dropping empty values. */
export function toQueryString(query = {}) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;

    if (Array.isArray(value)) {
      const joined = value.filter(Boolean).join(",");
      if (joined) params.set(key, joined);
      return;
    }

    if (value instanceof Date) {
      params.set(key, value.toISOString());
      return;
    }

    params.set(key, String(value));
  });

  const string = params.toString();
  return string ? `?${string}` : "";
}

/** Decode the payload of a JWT without verifying it. */
export function decodeJwt(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = decodeURIComponent(
      atob(normalized)
        .split("")
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/** True when the token is missing, malformed, or within `skew` of expiry. */
export function isTokenExpiring(token, skewSeconds = 30) {
  const payload = decodeJwt(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 - Date.now() < skewSeconds * 1000;
}

export function initials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A deterministic positive integer from a string (for avatar gradients). */
export function hashString(value = "") {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Strip a provider transport prefix (e.g. BINANCE:BTCUSDT). */
export function normalizeMarketSymbol(symbol = "") {
  return String(symbol).replace(/^BINANCE:/i, "");
}

/**
 * Provider-independent comparison key for a market symbol.
 *
 * Holdings and orders were historically written with a `BINANCE:` prefix or a
 * slash pair, while market routes use the canonical `BTCUSDT`. Comparing this
 * key keeps position lookups correct for both legacy and new rows.
 */
export function canonicalMarketSymbol(symbol = "") {
  return String(symbol)
    .trim()
    .toUpperCase()
    .replace(/^(?:BINANCE|FINNHUB|YAHOO):/, "")
    .replace(/\//g, "");
}

export function humanizeEnum(value = "") {
  return value
    .toString()
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
