# 📈 Observability

> **Structured logs, correlation ids, and Prometheus metrics for the stox backend.**

This document describes what the backend emits today. It covers tasks 49.1
(structured logging), 49.4 (API performance instrumentation), and 49.6
(backend observability metrics). Queue and notification-delivery metrics are
emitted by the BullMQ workers.

---

## 📌 Table of Contents

- [Logging](#-logging)
- [Correlation ids](#-correlation-ids)
- [Metrics](#-metrics)
- [Scraping](#-scraping)
- [Configuration](#-configuration)
- [Design rules](#-design-rules)
- [Known gaps](#-known-gaps)

---

## 🪵 Logging

All logs go through `backend/src/utils/logger.js` (Winston, console transport).
`LOG_LEVEL` controls verbosity (`debug`, `info`, `warn`, `error`).

### Request log line

Every completed request emits exactly one line:

```json
{"method":"GET","url":"/api/v1/orders","statusCode":200,"durationMs":12,"requestId":"…","userId":"…"}
```

| Field | Meaning |
| --- | --- |
| `method` | HTTP method |
| `url` | Path only — the query string is stripped |
| `statusCode` | Response status |
| `durationMs` | Wall-clock duration |
| `requestId` | Correlation id, also returned as `X-Request-Id` |
| `userId` | Authenticated user id, or `null` for anonymous requests |

Level split: `< 400` → `info`, `4xx` → `warn`, `5xx` → `error`.

Headers, bodies, cookies, and query strings are never logged.

### Redaction

`redactSensitive()` deep-copies structured metadata and masks any key matching
`password`, `passwd`, `secret`, `token`, `authorization`, `cookie`, `apiKey`,
`credential`, or `session` (case-insensitive), at any depth up to six levels.
It is applied centrally in the logger format, so even an ad-hoc call site that
passes a whole request object cannot leak a credential.

### Background-job context

`childLogger({ queue, jobId, jobName })` returns a logger whose lines always
carry the supplied context:

```js
const log = childLogger({ queue: "orders", jobId: job.id });
log.info("job started", { attempt: 1 });
// → {"queue":"orders","jobId":"…","attempt":1}
```

Call-site metadata overrides the child defaults.

---

## 🔗 Correlation ids

`middleware/requestContext.js` resolves an id for every request:

1. If the inbound `X-Request-Id` matches `^[A-Za-z0-9._:-]{8,128}$`, it is
   reused. This keeps traces connected across a gateway or the frontend.
2. Otherwise a UUID v4 is generated.

The id is stored on `req.id`, returned in the `X-Request-Id` response header,
and exposed through CORS. A hostile or malformed value is never reflected.

---

## 📊 Metrics

The registry lives in `backend/src/observability/metrics.js`. It is a small
hand-rolled implementation of the Prometheus text format — no `prom-client`
dependency.

### Exposed series

| Metric | Type | Labels | Source |
| --- | --- | --- | --- |
| `http_requests_total` | counter | `method`, `route`, `status` | HTTP middleware |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | HTTP middleware |
| `http_requests_in_flight` | gauge | — | HTTP middleware |
| `db_query_duration_seconds` | histogram | — | `GET /health` probe |
| `db_up` | gauge | — | `GET /health` probe (`1`/`0`) |
| `queue_jobs_enqueued_total` | counter | `queue`, `job` | Successful enqueue |
| `queue_enqueue_failures_total` | counter | `queue`, `job` | Enqueue failures (Redis down, validation) |
| `queue_jobs_completed_total` | counter | `queue`, `job` | Worker completions |
| `queue_jobs_failed_total` | counter | `queue`, `job` | Failed attempts, including retries |
| `queue_jobs_exhausted_total` | counter | `queue`, `job` | Jobs that failed every attempt |
| `notification_deliveries_total` | counter | `channel`, `outcome` | Notification worker: in-app/email/push attempts |
| `process_uptime_seconds` | gauge | — | runtime |
| `process_resident_memory_bytes` | gauge | — | runtime |
| `nodejs_heap_used_bytes` | gauge | — | runtime |
| `nodejs_heap_total_bytes` | gauge | — | runtime |

Histogram buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`
seconds.

### Route labels

`route` is the Express route pattern (`req.baseUrl + req.route.path`), for
example `/api/v1/orders/:id`. Unmatched requests all share `route="unmatched"`.
Raw URLs are never used as labels: order ids and arbitrary paths would create
unbounded cardinality.

---

## 🔍 Scraping

```bash
curl -s http://localhost:8000/metrics
```

The endpoint is mounted at the **root**, not under `/api/v1`, and is not rate
limited. It returns `text/plain; version=0.0.4; charset=utf-8` with
`Cache-Control: no-store`.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: stox-backend
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:8000"]
    # authorization:
    #   credentials: <METRICS_TOKEN>
```

### Disabling or protecting it

| Setting | Effect |
| --- | --- |
| `METRICS_ENABLED=false` | Route returns `404 ROUTE_NOT_FOUND` (existence is not advertised) |
| `METRICS_TOKEN=<value>` | Requires `Authorization: Bearer <value>`; otherwise `401 UNAUTHORIZED` |

The token comparison is constant-time.

> **Production deployment requirement:** `GET /metrics` is enabled by default
> and is only protected when `METRICS_TOKEN` is set. Before deploying, do one of
> the following:
>
> - set a strong, randomly generated `METRICS_TOKEN` in the deployment
>   environment and configure Prometheus to send
>   `Authorization: Bearer <token>`, or
> - block `/metrics` at the ingress/proxy so it is reachable only from the
>   monitoring network.
>
> Never expose an internet-reachable unauthenticated metrics endpoint. The
> series reveal traffic volume, route names, queue activity, and runtime
> behaviour even though they contain no credentials.

---

## ⚙️ Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | Winston level |
| `METRICS_ENABLED` | `true` | Expose `GET /metrics` |
| `METRICS_TOKEN` | unset | Optional bearer token for scraping; set it (or network-restrict `/metrics`) in production |
| `REQUEST_BODY_LIMIT` | `100kb` | JSON body size limit |
| `SECURITY_HEADERS_ENABLED` | `true` | Helmet middleware toggle |
| `QUEUE_ENQUEUE_TIMEOUT_MS` | `1500` | Bound on a best-effort queue enqueue |
| `QUEUES_ENABLED` | `true` | BullMQ vs in-process polling |
| `QUEUE_PREFIX` | `stox` | Redis key namespace for queues |

---

## 📐 Design rules

1. **Low cardinality only.** Never label a metric with a user id, order id,
   email, raw URL, or error message. Use route patterns, enum values, and
   status classes.
2. **No secrets in metrics.** Metrics are aggregate numbers; never include
   request data.
3. **Metric names are part of the series key.** Unlabelled metrics with
   different names must not collide (regression-tested).
4. **Instrumentation must not change behaviour.** The HTTP middleware only
   records on `finish`; it never alters the response. A client that disconnects
   mid-response releases the in-flight gauge but is not counted in
   `http_requests_total`, because the request never completed.
5. **The registry is process-local.** Multiple API processes each expose their
   own `/metrics`; aggregate at the scrape layer.

---

## 🚧 Known gaps

| Gap | Impact |
| --- | --- |
| Queue depth gauge | Job counters are implemented; a live `waiting`/`active`/`delayed` gauge is not yet sampled |
| Provider/cache health gauges | Partially available through `/health`; cache hit/miss metrics pending task 26.2 |
| Durable log aggregation | Logs are console-only; deployment must ship them |
| Trace propagation beyond `X-Request-Id` | No OpenTelemetry spans yet |
