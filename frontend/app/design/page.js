"use client";

import Link from "next/link";
import { ArrowRight, Bell, Plus, Search, Sparkles } from "lucide-react";

import { AreaChart } from "@/components/charts/area-chart";
import { DonutChart, AllocationLegend } from "@/components/charts/donut-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardHeading,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import { Progress } from "@/components/ui/misc";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const swatches = [
  ["Brand", "--brand", "#6C97FF"],
  ["Up", "--up", "#2BD98A"],
  ["Down", "--down", "#FF5C73"],
  ["Warn", "--warn", "#F5B84B"],
  ["Info", "--info", "#56C8F5"],
  ["Violet", "--violet", "#A78BFA"],
  ["Cyan", "--cyan", "#5EEAD4"],
  ["Pink", "--pink", "#F472B6"],
  ["Surface", "--surface", "#0C1018"],
  ["Surface 2", "--surface-2", "#111624"],
  ["Surface 3", "--surface-3", "#161D2D"],
  ["Canvas", "--canvas", "#07090E"],
];

const chartData = [
  { date: "2026-11-01", value: 10240 },
  { date: "2026-11-04", value: 10410 },
  { date: "2026-11-07", value: 10280 },
  { date: "2026-11-10", value: 10840 },
  { date: "2026-11-13", value: 11210 },
  { date: "2026-11-16", value: 10980 },
  { date: "2026-11-18", value: 11420 },
];

const spark = [12, 18, 16, 22, 21, 28, 26, 32, 30, 38, 42, 39, 46, 50];

export default function DesignSystemPage() {
  return (
    <div className="app-surface min-h-dvh">
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-[60px] w-full max-w-[1180px] items-center gap-4 px-5">
          <Logo href="/" size={26} />
          <span className="text-[11px] text-fg-subtle">Design system</span>
          <Badge tone="brand" className="ml-1">
            v1.0
          </Badge>
          <Link
            href="/dashboard"
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[12px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Open terminal
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1180px] px-5 py-12">
        <div className="max-w-[640px]">
          <p className="eyebrow mb-3">Terminal Calm</p>
          <h1 className="text-[40px] font-semibold leading-[1.02] tracking-[-0.05em] text-fg">
            The Stox design system.
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-fg-muted">
            A dark-first, data-dense language for a paper-trading terminal.
            Semantic tokens, tabular numbers, restrained motion, and honest
            states. Every colour below is implemented as a CSS custom property
            in <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-fg">app/globals.css</code>.
          </p>
        </div>

        <section className="mt-14">
          <SectionTitle
            number="01"
            title="Colour"
            description="Blue is the only action accent. Green and red belong to market direction and P&L."
          />
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {swatches.map(([label, token, hex]) => (
              <div
                key={label}
                className="overflow-hidden rounded-[10px] border border-line bg-surface"
              >
                <div
                  className="h-16 w-full"
                  style={{ background: `var(${token})` }}
                />
                <div className="p-2.5">
                  <p className="text-[11px] font-medium text-fg">{label}</p>
                  <p className="font-mono text-[9.5px] text-fg-subtle">{token}</p>
                  <p className="font-mono text-[9px] text-fg-subtle">{hex}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-[10px] border border-up/25 bg-up-soft px-3 py-2 text-[11.5px] text-up">
              Positive · gain · buy
            </div>
            <div className="rounded-[10px] border border-down/25 bg-down-soft px-3 py-2 text-[11.5px] text-down">
              Negative · loss · sell
            </div>
          </div>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="02"
            title="Typography"
            description="Geist for interface, Geist Mono for every number. Tabular figures are mandatory."
          />
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="space-y-5 p-5">
                <div>
                  <p className="eyebrow mb-2">Display</p>
                  <p className="text-[40px] font-semibold leading-[0.96] tracking-[-0.05em] text-fg">
                    Trade the market.
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">Page title</p>
                  <p className="text-[28px] font-semibold tracking-[-0.03em] text-fg">
                    Portfolio overview
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">Section title</p>
                  <p className="text-[18px] font-semibold text-fg">
                    Recent orders
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">Body</p>
                  <p className="max-w-[52ch] text-[14px] leading-relaxed text-fg-muted">
                    Precision comes from alignment, repeatable rhythm and
                    numbers that do not shift when they update.
                  </p>
                </div>
                <div>
                  <p className="eyebrow mb-2">Micro label</p>
                  <p className="text-[11px] font-medium uppercase tracking-[0.09em] text-fg-subtle">
                    Available cash
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-4 p-5">
                <div>
                  <p className="eyebrow mb-2">Numeric · mono</p>
                  <p className="tnum text-[36px] font-semibold tracking-[-0.04em] text-fg">
                    $24,820.70
                  </p>
                  <p className="tnum mt-1 text-[12px] text-up">+4.82% today</p>
                </div>
                <div className="border-t border-line pt-4">
                  <p className="eyebrow mb-2">Table numerals</p>
                  <div className="space-y-1.5 font-mono text-[12px]">
                    {[
                      ["BTC / USDT", "67,284.10", "+2.41%"],
                      ["AAPL", "228.42", "-0.64%"],
                      ["ETH / USDT", "3,284.08", "+1.12%"],
                    ].map(([symbol, price, change]) => (
                      <div
                        key={symbol}
                        className="grid grid-cols-[1fr_auto_auto] gap-4"
                      >
                        <span className="text-fg-muted">{symbol}</span>
                        <span className="tnum text-right text-fg">{price}</span>
                        <span
                          className={`tnum w-16 text-right ${
                            change.startsWith("+") ? "text-up" : "text-down"
                          }`}
                        >
                          {change}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="03"
            title="Buttons"
            description="One action accent, instant press feedback, no width animation."
          />
          <Card className="mt-5">
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary">Primary action</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="success">Buy</Button>
                <Button variant="danger">Sell</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
                <Button size="xs">Extra small</Button>
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Add">
                  <Plus className="size-4" />
                </Button>
                <Button loading>Placing order…</Button>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="04"
            title="Status & data"
            description="Colour never carries meaning alone. Badges pair tone with a dot and a label."
          />
          <Card className="mt-5">
            <CardContent className="space-y-5 p-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="up" dot>Executed</Badge>
                <Badge tone="warn" dot>Pending</Badge>
                <Badge tone="down" dot>Rejected</Badge>
                <Badge tone="neutral">Cancelled</Badge>
                <Badge tone="brand" dot>Active</Badge>
                <Badge tone="violet">Achievement</Badge>
                <Badge tone="info" dot>Copy trade</Badge>
                <Badge tone="outline">Outline</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Total value"
                  value="$24,820.70"
                  delta="+4.82%"
                  deltaLabel="all time"
                  icon={Sparkles}
                />
                <Stat
                  label="Available cash"
                  value="$8,420.00"
                  deltaLabel="No cash reserved"
                />
                <Stat
                  label="Total P&L"
                  value="-$1,284.40"
                  delta="-4.1%"
                  deltaLabel="vs. start"
                  tone="down"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Sparkline data={spark} width={120} height={36} tone="up" />
                <Sparkline data={[...spark].reverse()} width={120} height={36} tone="down" />
                <Progress value={68} className="max-w-[220px]" label="Example progress" />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="05"
            title="Forms"
            description="Visible labels, inline errors, prefix/suffix slots, 38px default height."
          />
          <Card className="mt-5">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Email" htmlFor="demo-email" hint="We never share it.">
                {({ id }) => (
                  <Input
                    id={id}
                    placeholder="you@example.com"
                    leftIcon={<Search className="size-4" />}
                  />
                )}
              </Field>
              <Field
                label="Target price"
                htmlFor="demo-price"
                error="Target must be greater than zero."
              >
                {({ id }) => (
                  <Input
                    id={id}
                    invalid
                    defaultValue="0"
                    leftIcon={<span className="text-[12px]">$</span>}
                  />
                )}
              </Field>
              <Field label="Symbol" htmlFor="demo-symbol">
                {({ id }) => (
                  <Input
                    id={id}
                    defaultValue="BTCUSDT"
                    className="font-mono uppercase"
                  />
                )}
              </Field>
              <Field label="Expiry" htmlFor="demo-expiry" optional>
                {({ id }) => <Input id={id} type="datetime-local" />}
              </Field>
            </CardContent>
          </Card>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="06"
            title="Navigation"
            description="Underline tabs for sections, segmented controls for dense filters."
          />
          <Card className="mt-5">
            <CardContent className="p-5">
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="analytics">Analytics</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <p className="text-[12px] text-fg-muted">
                    Underline tabs sit in the page flow and preserve the shared
                    layout.
                  </p>
                </TabsContent>
                <TabsContent value="analytics">
                  <p className="text-[12px] text-fg-muted">
                    Analytics content would render here.
                  </p>
                </TabsContent>
                <TabsContent value="activity">
                  <p className="text-[12px] text-fg-muted">
                    Activity content would render here.
                  </p>
                </TabsContent>
              </Tabs>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
                <SegmentedControl
                  options={[
                    { value: "24h", label: "24h" },
                    { value: "7d", label: "7d" },
                    { value: "30d", label: "30d" },
                  ]}
                  value="7d"
                  onChange={() => {}}
                  ariaLabel="Example period"
                />
                <SegmentedControl
                  options={[
                    { value: "buy", label: "Buy" },
                    { value: "sell", label: "Sell" },
                  ]}
                  value="buy"
                  onChange={() => {}}
                  ariaLabel="Example side"
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="07"
            title="Charts"
            description="No vertical grid. Muted mono axes. A real summary for assistive technology."
          />
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Portfolio value</CardTitle>
                  <CardDescription>Area chart · 1M</CardDescription>
                </CardHeading>
              </CardHeader>
              <CardContent>
                <AreaChart data={chartData} height={220} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Allocation</CardTitle>
                  <CardDescription>Donut · by market value</CardDescription>
                </CardHeading>
              </CardHeader>
              <CardContent>
                <DonutChart
                  data={[
                    { name: "BTC", value: 5412 },
                    { name: "NVDA", value: 3284 },
                    { name: "AAPL", value: 1878 },
                    { name: "Cash", value: 8420 },
                  ]}
                  centerLabel="Total"
                  centerValue="$18,994"
                  height={170}
                />
                <AllocationLegend
                  className="mt-3"
                  data={[
                    { name: "BTC", value: 5412 },
                    { name: "NVDA", value: 3284 },
                    { name: "AAPL", value: 1878 },
                    { name: "Cash", value: 8420 },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="08"
            title="States"
            description="Every async surface has loading, empty and error states that preserve layout."
          />
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardHeading>
                  <CardTitle>Loading</CardTitle>
                </CardHeading>
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="mt-3 h-20 w-full" />
              </CardContent>
            </Card>
            <Card>
              <EmptyState
                icon={Bell}
                title="No alerts yet"
                description="Create a price alert and let the engine watch the market."
                action={<Button size="sm" variant="secondary">Create alert</Button>}
              />
            </Card>
            <Card>
              <ErrorState
                code="MARKET_DATA_UNAVAILABLE"
                compact
                title="Market data unavailable"
                description="The provider did not respond. Retry in a moment."
                action={<Button size="sm" variant="secondary">Retry</Button>}
              />
            </Card>
          </div>
        </section>

        <section className="mt-14">
          <SectionTitle
            number="09"
            title="Motion"
            description="Fast, purposeful, interruptible. Press 120ms, popover 160ms, modal 220ms, sheet 320ms."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Press", "scale(0.97)", "120ms · ease-out"],
              ["Popover", "opacity + scale(0.97)", "160ms · ease-out"],
              ["Modal", "opacity + scale(0.96)", "220ms · ease-out"],
              ["Sheet", "translateY(100%)", "320ms · drawer"],
            ].map(([name, property, timing]) => (
              <div
                key={name}
                className="rounded-[10px] border border-line bg-surface p-3.5"
              >
                <p className="text-[12px] font-medium text-fg">{name}</p>
                <p className="mt-1 font-mono text-[10px] text-fg-subtle">
                  {property}
                </p>
                <p className="mt-2 text-[10px] text-fg-subtle">{timing}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-subtle">
            Reduced motion keeps fades and removes movement, scale and the
            ticker marquee. Keyboard-initiated actions never animate.
          </p>
        </section>

        <section className="mt-14 rounded-[16px] border border-line bg-surface p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-[16px] font-semibold text-fg">
                Read the full source of truth
              </h2>
              <p className="mt-1 max-w-[58ch] text-[12px] leading-relaxed text-fg-muted">
                Components, page templates, accessibility rules and content
                guidelines live in{" "}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10.5px]">
                  design-system/stox/MASTER.md
                </code>
                .
              </p>
            </div>
            <Button asChild variant="secondary" size="md">
              <Link href="/dashboard">
                See it in the terminal
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionTitle({ number, title, description }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line pb-3">
      <span className="font-mono text-[10px] text-brand">{number}</span>
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-fg">
          {title}
        </h2>
        <p className="mt-0.5 max-w-[70ch] text-[11.5px] leading-relaxed text-fg-subtle">
          {description}
        </p>
      </div>
    </div>
  );
}
