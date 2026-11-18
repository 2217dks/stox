"use client";

import { useEffect, useRef } from "react";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
} from "lightweight-charts";

import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUI } from "@/store/use-ui";

function readToken(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function toSeries(prices = []) {
  const seen = new Set();

  return prices
    .map((candle) => {
      const time = Math.floor(new Date(candle.timestamp).getTime() / 1000);
      const open = Number(candle.open);
      const high = Number(candle.high);
      const low = Number(candle.low);
      const close = Number(candle.close);
      const volume = Number(candle.volume ?? 0);
      return { time, open, high, low, close, volume, timestamp: candle.timestamp };
    })
    .filter((candle) => {
      if (
        !Number.isFinite(candle.time) ||
        !Number.isFinite(candle.open) ||
        !Number.isFinite(candle.high) ||
        !Number.isFinite(candle.low) ||
        !Number.isFinite(candle.close) ||
        seen.has(candle.time)
      ) {
        return false;
      }
      seen.add(candle.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

export function CandleChart({
  prices = [],
  interval = "1h",
  mode = "candles",
  height = 380,
  className,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const theme = useUI((state) => state.theme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const data = toSeries(prices);
    if (!data.length) return undefined;

    const styles = getComputedStyle(document.documentElement);
    const brand = readToken("--brand", "#6c97ff");
    const up = readToken("--up", "#2bd98a");
    const down = readToken("--down", "#ff5c73");
    const grid = readToken("--chart-grid", "rgba(255,255,255,.06)");
    const line = readToken("--line", "rgba(255,255,255,.08)");
    const fgSubtle = readToken("--fg-subtle", "#657088");
    const fgMuted = readToken("--fg-muted", "#96a2b8");

    const intraday = !["1d", "1w", "1M"].includes(interval);

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: fgSubtle,
        fontFamily: styles.getPropertyValue("--font-geist-mono") || "monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0)" },
        horzLines: { color: grid },
      },
      rightPriceScale: {
        borderColor: line,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: line,
        timeVisible: intraday,
        secondsVisible: false,
        rightOffset: 2,
        barSpacing: 7,
        minBarSpacing: 2,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(150,162,184,.4)",
          width: 1,
          style: 3,
          labelBackgroundColor: brand,
        },
        horzLine: {
          color: "rgba(150,162,184,.4)",
          width: 1,
          style: 3,
          labelBackgroundColor: brand,
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
      localization: {
        priceFormatter: (price) =>
          formatPrice(price),
      },
    });

    chartRef.current = chart;

    if (mode === "area") {
      const series = chart.addSeries(AreaSeries, {
        lineColor: brand,
        lineWidth: 2,
        topColor: `${brand}3d`,
        bottomColor: `${brand}00`,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
      });
      series.setData(
        data.map((candle) => ({ time: candle.time, value: candle.close })),
      );
    } else {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderVisible: false,
        wickUpColor: up,
        wickDownColor: down,
        priceLineVisible: false,
      });
      series.setData(data);

      const hasVolume = data.some((candle) => candle.volume > 0);
      if (hasVolume) {
        const volume = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          color: `${fgMuted}40`,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volume.priceScale().applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        volume.setData(
          data.map((candle) => ({
            time: candle.time,
            value: candle.volume,
            color:
              candle.close >= candle.open
                ? `${up}33`
                : `${down}33`,
          })),
        );
      }
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [prices, interval, mode, height, theme]);

  return (
    <div
      ref={containerRef}
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={`${mode === "candles" ? "Candlestick" : "Price"} chart`}
    />
  );
}
