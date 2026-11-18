"use client";

import { useMemo } from "react";

import { formatCurrency, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const weekdays = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

function intensity(value) {
  const number = Number(value || 0);
  const absolute = Math.abs(number);

  if (absolute === 0) return 0;
  if (absolute < 0.25) return 1;
  if (absolute < 0.75) return 2;
  if (absolute < 1.5) return 3;
  return 4;
}

function cellStyle(percent) {
  const number = Number(percent || 0) * 100;
  const level = intensity(number);

  if (level === 0) return { background: "var(--surface-3)" };

  const color = number > 0 ? "var(--up)" : "var(--down)";
  const alpha = [0, 22, 36, 55, 78][level];
  return {
    background: `color-mix(in oklab, ${color} ${alpha}%, var(--surface-2))`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} ${alpha + 18}%, transparent)`,
  };
}

export function PnlHeatmap({ data = [], className }) {
  const weeks = useMemo(() => {
    if (!data.length) return [];

    const cells = data
      .map((item) => ({
        ...item,
        date: new Date(`${item.date}T00:00:00Z`),
      }))
      .sort((a, b) => a.date - b.date);

    const start = cells[0].date;
    const weekday = (start.getUTCDay() + 6) % 7;
    const slots = [
      ...Array.from({ length: weekday }, () => null),
      ...cells,
    ];

    const result = [];
    for (let index = 0; index < slots.length; index += 7) {
      result.push(slots.slice(index, index + 7));
    }
    return result;
  }, [data]);

  if (!data.length) {
    return (
      <div
        className={cn(
          "flex h-[170px] items-center justify-center rounded-[10px] border border-dashed border-line text-[12px] text-fg-subtle",
          className,
        )}
      >
        No daily P&L yet
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar">
        <div className="flex shrink-0 flex-col gap-[3px] pt-[17px]">
          {weekdays.map((day, index) => (
            <span
              key={index}
              className="flex h-[11px] items-center text-[8.5px] leading-none text-fg-subtle"
            >
              {day}
            </span>
          ))}
        </div>

        <div className="flex gap-[3px]">
          {weeks.map((week, weekIndex) => {
            const firstFilled = week.find(Boolean);
            const previous = weeks[weekIndex - 1]?.find(Boolean);
            const monthStart =
              firstFilled &&
              (!previous ||
                previous.date.getUTCMonth() !== firstFilled.date.getUTCMonth());

            return (
              <div key={weekIndex} className="flex flex-col gap-[3px]">
                <span className="h-[14px] text-[8.5px] leading-none text-fg-subtle">
                  {monthStart
                    ? firstFilled.date.toLocaleString("en-US", {
                        month: "short",
                        timeZone: "UTC",
                      })
                    : ""}
                </span>
                {week.map((cell, dayIndex) =>
                  cell ? (
                    <div
                      key={cell.date.toISOString()}
                      className="group relative"
                      title={`${cell.date.toUTCString().slice(0, 16)} · ${formatCurrency(
                        cell.pnl,
                        { signed: true },
                      )} (${formatPercent(Number(cell.pnlPercent) * 100)})`}
                    >
                      <span
                        className="block size-[11px] rounded-[2.5px] transition-transform group-hover:scale-125"
                        style={cellStyle(cell.pnlPercent)}
                        aria-hidden="true"
                      />
                      <span className="sr-only">
                        {cell.date.toISOString().slice(0, 10)}:{" "}
                        {formatCurrency(cell.pnl, { signed: true })},{" "}
                        {formatPercent(Number(cell.pnlPercent) * 100)}
                      </span>
                    </div>
                  ) : (
                    <span key={`empty-${dayIndex}`} className="block size-[11px]" />
                  ),
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[9.5px] text-fg-subtle">
        <span>Daily P&L · UTC</span>
        <span className="flex items-center gap-1">
          Loss
          {[2, 1, 0.5, 0.1].map((level) => (
            <span
              key={`loss-${level}`}
              className="size-[9px] rounded-[2px]"
              style={cellStyle(-level / 100)}
              aria-hidden="true"
            />
          ))}
          <span className="mx-0.5">0</span>
          {[0.1, 0.5, 1, 2].map((level) => (
            <span
              key={`gain-${level}`}
              className="size-[9px] rounded-[2px]"
              style={cellStyle(level / 100)}
              aria-hidden="true"
            />
          ))}
          Gain
        </span>
      </div>
    </div>
  );
}
