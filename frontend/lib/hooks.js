"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import useSWR, { mutate as globalMutate } from "swr";

import { apiFetch, errorMessage } from "./api";
import { isCrypto } from "./format";
import { marketApi, portfoliosApi } from "./endpoints";
import {
  getSocket,
  releaseMarketSymbol,
  retainMarketSymbol,
} from "./socket";
import { useSession } from "@/store/use-session";
import { useUI } from "@/store/use-ui";
import { canonicalMarketSymbol, toQueryString } from "./utils";

export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

const subscribeToNothing = () => () => {};

export function useMounted() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

export function useApi(path, options = {}) {
  const {
    query,
    enabled = true,
    fallbackData,
    refreshInterval,
    revalidateOnFocus = false,
    keepPreviousData = true,
    ...swrOptions
  } = options;

  const key =
    path && enabled
      ? `${path}${toQueryString(query)}`
      : null;

  const result = useSWR(
    key,
    () => apiFetch(path, { query }),
    {
      revalidateOnFocus,
      keepPreviousData,
      refreshInterval,
      shouldRetryOnError: (error) =>
        !error?.status || error.status >= 500,
      errorRetryCount: 1,
      ...swrOptions,
    },
  );

  return {
    ...result,
    data: result.data ?? fallbackData ?? null,
    loading: result.isLoading && result.data === undefined,
  };
}

export function useQuote(symbol, assetClass, options = {}) {
  const type = assetClass || (isCrypto(symbol) ? "CRYPTO" : "STOCK");
  const key = symbol ? `quote:${type}:${symbol}` : null;

  const { data, error, isLoading, mutate } = useSWR(
    key,
    () => marketApi.quote(symbol, type),
    {
      refreshInterval: options.refreshInterval ?? 60000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  return { quote: data ?? null, error, loading: isLoading, mutate };
}

export function useQuotes(symbols = [], assetTypes = {}, options = {}) {
  const symbolKey = symbols.slice().sort().join(",");
  const assetTypesKey = Object.entries(assetTypes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  const stableAssetTypes = useMemo(() => {
    if (!assetTypesKey) return {};
    return Object.fromEntries(
      assetTypesKey.split(",").map((entry) => entry.split(":")),
    );
  }, [assetTypesKey]);
  const key = symbolKey
    ? assetTypesKey
      ? `quotes:${symbolKey}:${assetTypesKey}`
      : `quotes:${symbolKey}`
    : null;
  const [live, setLive] = useState({});
  const pendingTicksRef = useRef({});

  const { data, error, isLoading, mutate } = useSWR(
    key,
    async () => {
      // One request for the whole set: a per-symbol fan-out costs the global
      // rate-limit budget N times for what is one screen.
      const quotes = await marketApi.quotes(symbols, stableAssetTypes);
      const byCanonical = new Map(
        quotes.map((quote) => [canonicalMarketSymbol(quote.symbol), quote]),
      );

      return Object.fromEntries(
        symbols.map((symbol) => [
          symbol,
          byCanonical.get(canonicalMarketSymbol(symbol)) ?? null,
        ]),
      );
    },
    {
      // Live prices arrive over the market socket. HTTP is only the initial
      // snapshot plus a slow fallback; the global API limiter is deliberately
      // tight, so polling every few seconds is not an option.
      refreshInterval: options.refreshInterval ?? 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  useEffect(() => {
    if (!symbolKey || typeof window === "undefined") return undefined;

    const list = symbolKey.split(",");
    const canonicalList = list.map(canonicalMarketSymbol);
    const socket = getSocket("/market");

    const onPrice = (payload) => {
      if (!payload?.symbol) return;

      // Legacy holdings can be stored as "BINANCE:BTCUSDT" while the backend
      // emits "BTCUSDT". Match on the canonical form and key the tick by the
      // symbol this hook was asked for, so the merge below finds it.
      const index = canonicalList.indexOf(
        canonicalMarketSymbol(payload.symbol),
      );

      if (index === -1) return;

      const targetSymbol = list[index];
      const expectedAsset =
        stableAssetTypes[targetSymbol] ||
        (isCrypto(targetSymbol) ? "CRYPTO" : "STOCK");

      // When the tick carries an asset class, ensure it matches the requested one
      if (payload.assetClass && payload.assetClass !== expectedAsset) {
        return;
      }

      pendingTicksRef.current[targetSymbol] = {
        price: payload.price,
        volume: payload.volume,
        timestamp: payload.timestamp,
      };
    };

    socket.on("price-update", onPrice);
    list.forEach((symbol) => {
      const assetClass =
        stableAssetTypes[symbol] || (isCrypto(symbol) ? "CRYPTO" : "STOCK");
      retainMarketSymbol(symbol, assetClass);
    });

    return () => {
      socket.off("price-update", onPrice);
      list.forEach((symbol) => releaseMarketSymbol(symbol));
    };
  }, [symbolKey, stableAssetTypes]);

  useEffect(() => {
    if (!symbolKey) return undefined;

    const id = setInterval(() => {
      const pending = pendingTicksRef.current;
      if (Object.keys(pending).length === 0) return;
      pendingTicksRef.current = {};
      setLive((previous) => ({ ...previous, ...pending }));
    }, 500);

    return () => clearInterval(id);
  }, [symbolKey]);

  const quotes = useMemo(() => {
    const merged = { ...(data || {}) };
    Object.entries(live).forEach(([symbol, tick]) => {
      if (!symbolKey.split(",").includes(symbol)) return;
      merged[symbol] = { ...(merged[symbol] || {}), ...tick };
    });
    return merged;
  }, [data, live, symbolKey]);

  return {
    quotes,
    error,
    loading: isLoading,
    mutate,
  };
}

export function useMarketOverview(assetClass = "CRYPTO", limit = 6) {
  const { data, error, isLoading, mutate } = useSWR(
    `overview:${assetClass}:${limit}`,
    () => marketApi.overview({ assetClass, limit }),
    {
      refreshInterval: 120000,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const movers = (data?.movers ?? []).map((mover) => ({
    ...mover,
    symbol: mover.symbol?.replace(/^BINANCE:/i, "") || mover.symbol,
  }));

  return { overview: data, movers, error, loading: isLoading, mutate };
}

export function usePortfolios() {
  const { user, status } = useSession();
  const result = useApi("/portfolios", {
    enabled: status === "authed" && Boolean(user),
    refreshInterval: 300000,
  });

  const portfolios = useMemo(
    () => result.data?.portfolios ?? [],
    [result.data],
  );

  return { ...result, portfolios };
}

export function useActivePortfolio() {
  const { portfolios, loading, error, mutate } = usePortfolios();
  const activePortfolioId = useUI((state) => state.activePortfolioId);
  const setActivePortfolioId = useUI((state) => state.setActivePortfolioId);

  const activePortfolios = useMemo(
    () => portfolios.filter((portfolio) => portfolio.isActive !== false),
    [portfolios],
  );

  const activePortfolio = useMemo(() => {
    if (!activePortfolios.length) return null;
    return (
      activePortfolios.find((portfolio) => portfolio.id === activePortfolioId) ||
      activePortfolios.find((portfolio) => portfolio.isDefault) ||
      activePortfolios[0]
    );
  }, [activePortfolios, activePortfolioId]);

  useEffect(() => {
    if (
      activePortfolio &&
      activePortfolio.id !== activePortfolioId
    ) {
      setActivePortfolioId(activePortfolio.id);
    }
  }, [activePortfolio, activePortfolioId, setActivePortfolioId]);

  return {
    portfolios,
    activePortfolios,
    portfolio: activePortfolio,
    portfolioId: activePortfolio?.id ?? null,
    loading,
    error,
    mutate,
    setActivePortfolioId,
  };
}

export function usePortfolioSummary(portfolioId, options = {}) {
  return useApi(
    portfolioId ? `/portfolios/${portfolioId}/summary` : null,
    {
      refreshInterval: 120000,
      ...options,
    },
  );
}

export function useHoldings(portfolioId) {
  return useApi(portfolioId ? `/portfolios/${portfolioId}/holdings` : null, {
    refreshInterval: 120000,
  });
}

/**
 * Quantity-first position model for one symbol.
 *
 * The API stores holdings and orders with the symbol the client submitted, so
 * legacy rows can contain `BINANCE:BTCUSDT` while market routes use
 * `BTCUSDT`. Everything is matched through `canonicalMarketSymbol`.
 *
 * Pending SELL orders are netted out of the sellable quantity because the
 * server does not reserve shares the way it reserves cash for BUY orders.
 */
export function usePosition(portfolioId, symbol) {
  const symbolKey = canonicalMarketSymbol(symbol);
  const holdings = useHoldings(portfolioId);
  const pendingSells = useApi(
    portfolioId && symbolKey ? "/orders" : null,
    {
      query: {
        portfolioId,
        side: "SELL",
        status: "PENDING",
        limit: 100,
      },
      refreshInterval: 120000,
    },
  );

  const holding = useMemo(() => {
    if (!symbolKey) return null;
    return (
      (holdings.data?.holdings ?? []).find(
        (item) => canonicalMarketSymbol(item.symbol) === symbolKey,
      ) || null
    );
  }, [holdings.data, symbolKey]);

  const reservedQuantity = useMemo(() => {
    if (!symbolKey) return 0;
    return (pendingSells.data?.orders ?? [])
      .filter(
        (order) =>
          order.side === "SELL" &&
          order.status === "PENDING" &&
          canonicalMarketSymbol(order.symbol) === symbolKey,
      )
      .reduce((total, order) => total + Number(order.quantity || 0), 0);
  }, [pendingSells.data, symbolKey]);

  const quantity = Number(holding?.quantity ?? 0);
  const netReserved = Math.min(Math.max(reservedQuantity, 0), quantity);

  return {
    holding,
    quantity,
    reservedQuantity: netReserved,
    availableQuantity: Math.max(0, quantity - netReserved),
    averageBuyPrice: Number(holding?.averageBuyPrice ?? 0),
    totalInvested: Number(holding?.totalInvested ?? 0),
    hasPosition: quantity > 0,
    loading: holdings.loading || pendingSells.loading,
    error: holdings.error,
    reservedError: pendingSells.error,
    mutateHoldings: holdings.mutate,
    mutatePendingSells: pendingSells.mutate,
  };
}

export function useUnreadNotifications() {
  const { status } = useSession();
  const { data, mutate } = useApi("/notifications", {
    query: { isRead: false, limit: 1 },
    enabled: status === "authed",
    // The notification socket invalidates this cache. A 3-minute fallback
    // keeps the counter honest without burning the global API budget.
    refreshInterval: 180000,
  });

  return {
    count: data?.pagination?.total ?? 0,
    mutate,
  };
}

export function useInvalidateTrading() {
  const portfolioId = useActivePortfolio().portfolioId;

  return async () => {
    const keys = [
      "/orders",
      "/trades",
      "/portfolios",
      "/notifications",
    ];

    await Promise.all([
      ...keys.map((key) => globalMutate((k) => typeof k === "string" && k.startsWith(key))),
      portfolioId &&
        globalMutate(
          (k) =>
            typeof k === "string" &&
            (k.startsWith(`/portfolios/${portfolioId}`) ||
              k.startsWith("quote:")),
        ),
    ]);
  };
}

/**
 * Reactivate a soft-deleted portfolio.
 *
 * Returns `{ reactivate, pendingId }` so callers can disable the control while
 * the request is in flight. Portfolio-scoped SWR keys are revalidated, which
 * flips the calling surface (and the sidebar switcher) back to the active
 * state without a reload.
 */
export function useReactivatePortfolio() {
  const [pendingId, setPendingId] = useState(null);

  async function reactivate(portfolioId) {
    if (!portfolioId) return false;

    try {
      setPendingId(portfolioId);
      await portfoliosApi.reactivate(portfolioId);
      toast.success("Portfolio reactivated", {
        description: "It can receive new orders again.",
      });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/portfolios"),
      );
      return true;
    } catch (error) {
      toast.error("Could not reactivate portfolio", {
        description: errorMessage(error, "Try again in a moment."),
      });
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return { reactivate, pendingId };
}

/**
 * Subscribe to a public market room. Returns the latest tick, or null while
 * the socket is connecting. HTTP quote polling remains the source of truth.
 */
export function useMarketStream(symbol, assetClass) {
  const [tick, setTick] = useState(null);

  useEffect(() => {
    if (!symbol || typeof window === "undefined") return undefined;

    const socket = getSocket("/market");
    const normalized = symbol.toUpperCase();

    const onPrice = (payload) => {
      if (payload?.symbol !== normalized) return;
      setTick(payload);
    };

    socket.on("price-update", onPrice);
    retainMarketSymbol(normalized, assetClass);

    return () => {
      socket.off("price-update", onPrice);
      releaseMarketSymbol(normalized);
    };
  }, [symbol, assetClass]);

  return tick?.symbol === symbol?.toUpperCase() ? tick : null;
}

/** A stable interval that pauses when the tab is hidden. */
export function useVisibleInterval(callback, delay) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!delay) return undefined;
    const tick = () => {
      if (document.visibilityState === "visible") savedCallback.current();
    };
    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay]);
}
