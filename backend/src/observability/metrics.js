/**
 * Minimal Prometheus-compatible metrics registry.
 *
 * The project deliberately avoids `prom-client`: the metric surface we need
 * (counters, gauges, histograms, process gauges) is small, and a hand-rolled
 * registry keeps the dependency tree unchanged and the rendering logic
 * testable without global state.
 *
 * Labels must stay low-cardinality. Callers are responsible for passing route
 * patterns (`/api/v1/orders/:id`), never raw URLs.
 */

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Prometheus text exposition escapes these three characters inside label values.
function escapeLabelValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function normalizeLabels(labels = {}) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]);

  // Sorted keys make the series key stable regardless of call-site order.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return entries;
}

function labelsKey(entries) {
  return JSON.stringify(entries);
}

// The metric name is part of the key. Without it, every unlabelled metric
// (`db_up`, `http_requests_in_flight`, …) would share the `"[]"` slot and
// silently overwrite each other.
function seriesKey(name, entries) {
  return `${name}\u0000${labelsKey(entries)}`;
}

function formatLabels(entries, extra = null) {
  const pairs = [...entries];

  if (extra) {
    pairs.push(extra);
  }

  if (pairs.length === 0) {
    return "";
  }

  return `{${pairs
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  // Sums of float observations accumulate representation noise
  // (0.01 + 0.2 === 0.21000000000000002). Nine decimals is well beyond the
  // resolution of a duration measurement in seconds.
  return String(Number(value.toFixed(9)));
}

/**
 * Allow both `increment(name, labels, value)` and the shorthand
 * `increment(name, value)`.
 *
 * A non-object second argument can only be the numeric value. Treating it as
 * labels (the previous behaviour) silently recorded `0`, which is exactly the
 * kind of bug a metrics layer must not have.
 */
function resolveDeltaArgs(labels, value, fallback) {
  if (labels === null || typeof labels !== "object" || Array.isArray(labels)) {
    return {
      labels: {},
      value: labels === undefined ? fallback : labels,
    };
  }

  return {
    labels,
    value: value === undefined ? fallback : value,
  };
}

function createMetricsRegistry({ buckets = DEFAULT_BUCKETS, now = () => Date.now() } = {}) {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();
  const help = new Map();
  const startedAt = now();

  function describe(name, text) {
    help.set(name, text);
  }

  function increment(name, labels = {}, value = 1) {
    const resolved = resolveDeltaArgs(labels, value, 1);
    const entries = normalizeLabels(resolved.labels);
    const key = seriesKey(name, entries);
    const existing = counters.get(key);

    if (existing) {
      existing.value += resolved.value;
      return existing.value;
    }

    counters.set(key, { name, labels: entries, value: resolved.value });
    return resolved.value;
  }

  function set(name, labels = {}, value) {
    const resolved = resolveDeltaArgs(labels, value, 0);
    const entries = normalizeLabels(resolved.labels);
    gauges.set(seriesKey(name, entries), {
      name,
      labels: entries,
      value: Number(resolved.value) || 0,
    });
    return Number(resolved.value) || 0;
  }

  // Gauges that move up and down (in-flight requests, queue depth) need a
  // delta operation that stays in the gauge type. Routing them through
  // `increment` would silently register a second counter with the same name.
  function incrementGauge(name, labels = {}, value = 1) {
    const resolved = resolveDeltaArgs(labels, value, 1);
    const entries = normalizeLabels(resolved.labels);
    const key = seriesKey(name, entries);
    const existing = gauges.get(key);

    if (existing) {
      existing.value += resolved.value;
      return existing.value;
    }

    gauges.set(key, { name, labels: entries, value: resolved.value });
    return resolved.value;
  }

  function decrementGauge(name, labels = {}, value = 1) {
    return incrementGauge(name, labels, -value);
  }

  function decrement(name, labels = {}, value = 1) {
    return increment(name, labels, -value);
  }

  function observe(name, value, labels = {}) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return;
    }

    let histogram = histograms.get(name);

    if (!histogram) {
      histogram = { buckets, series: new Map() };
      histograms.set(name, histogram);
    }

    const entries = normalizeLabels(labels);
    const key = labelsKey(entries);
    let series = histogram.series.get(key);

    if (!series) {
      series = {
        labels: entries,
        counts: buckets.map(() => 0),
        sum: 0,
        count: 0,
      };
      histogram.series.set(key, series);
    }

    series.count += 1;
    series.sum += numeric;

    // Buckets are cumulative (`le` semantics), so every bucket at or above the
    // observation is incremented.
    for (let index = 0; index < buckets.length; index += 1) {
      if (numeric <= buckets[index]) {
        series.counts[index] += 1;
      }
    }
  }

  function renderSeriesBlock(name, type, renderSamples) {
    const lines = [];
    const helpText = help.get(name);

    if (helpText) {
      lines.push(`# HELP ${name} ${helpText}`);
    }

    lines.push(`# TYPE ${name} ${type}`);
    lines.push(...renderSamples());

    return lines;
  }

  function render({ includeProcess = true } = {}) {
    const names = new Set([
      ...[...counters.values()].map((series) => series.name),
      ...[...gauges.values()].map((series) => series.name),
      ...histograms.keys(),
    ]);

    const blocks = [];

    for (const name of [...names].sort()) {
      const counterSeries = [...counters.values()].filter(
        (series) => series.name === name,
      );

      if (counterSeries.length > 0) {
        blocks.push(
          renderSeriesBlock(name, "counter", () =>
            counterSeries
              .sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))
              .map(
                (series) =>
                  `${name}${formatLabels(series.labels)} ${formatNumber(series.value)}`,
              ),
          ),
        );
        continue;
      }

      const gaugeSeries = [...gauges.values()].filter(
        (series) => series.name === name,
      );

      if (gaugeSeries.length > 0) {
        blocks.push(
          renderSeriesBlock(name, "gauge", () =>
            gaugeSeries
              .sort((a, b) => labelsKey(a.labels).localeCompare(labelsKey(b.labels)))
              .map(
                (series) =>
                  `${name}${formatLabels(series.labels)} ${formatNumber(series.value)}`,
              ),
          ),
        );
        continue;
      }

      const histogram = histograms.get(name);

      if (histogram) {
        blocks.push(
          renderSeriesBlock(name, "histogram", () => {
            const lines = [];

            for (const series of histogram.series.values()) {
              for (let index = 0; index < histogram.buckets.length; index += 1) {
                lines.push(
                  `${name}_bucket${formatLabels(series.labels, [
                    "le",
                    formatNumber(histogram.buckets[index]),
                  ])} ${formatNumber(series.counts[index])}`,
                );
              }

              lines.push(
                `${name}_bucket${formatLabels(series.labels, ["le", "+Inf"])} ${formatNumber(series.count)}`,
              );
              lines.push(
                `${name}_sum${formatLabels(series.labels)} ${formatNumber(series.sum)}`,
              );
              lines.push(
                `${name}_count${formatLabels(series.labels)} ${formatNumber(series.count)}`,
              );
            }

            return lines;
          }),
        );
      }
    }

    if (includeProcess) {
      const memory = process.memoryUsage();
      const uptimeSeconds = Math.max(0, (now() - startedAt) / 1000);

      blocks.push(
        renderSeriesBlock("process_uptime_seconds", "gauge", () => [
          `process_uptime_seconds ${formatNumber(uptimeSeconds)}`,
        ]),
        renderSeriesBlock("process_resident_memory_bytes", "gauge", () => [
          `process_resident_memory_bytes ${formatNumber(memory.rss)}`,
        ]),
        renderSeriesBlock("nodejs_heap_used_bytes", "gauge", () => [
          `nodejs_heap_used_bytes ${formatNumber(memory.heapUsed)}`,
        ]),
        renderSeriesBlock("nodejs_heap_total_bytes", "gauge", () => [
          `nodejs_heap_total_bytes ${formatNumber(memory.heapTotal)}`,
        ]),
      );
    }

    return blocks.length > 0
      ? `${blocks.map((lines) => lines.join("\n")).join("\n")}\n`
      : "";
  }

  function reset() {
    counters.clear();
    gauges.clear();
    histograms.clear();
  }

  return {
    describe,
    increment,
    decrement,
    incrementGauge,
    decrementGauge,
    set,
    observe,
    render,
    reset,
  };
}

// The API process and every test share one registry; `reset()` exists for
// isolation in unit tests.
const registry = createMetricsRegistry();

registry.describe("http_requests_total", "Total HTTP requests by method, route and status.");
registry.describe(
  "http_request_duration_seconds",
  "HTTP request duration in seconds by method, route and status.",
);
registry.describe("http_requests_in_flight", "HTTP requests currently being processed.");
registry.describe("db_query_duration_seconds", "Database query duration in seconds.");
registry.describe("db_up", "1 when the database responded to the last health probe, 0 otherwise.");

module.exports = {
  DEFAULT_BUCKETS,
  createMetricsRegistry,
  registry,
};
