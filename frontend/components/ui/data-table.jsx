import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { SkeletonRows } from "./skeleton";

export function DataTable({
  columns = [],
  rows = [],
  getRowKey = (row, index) => row.id ?? index,
  loading = false,
  empty = null,
  onRowClick,
  className,
  tableClassName,
  caption,
  density = "default",
  footer,
}) {
  const rowHeight = density === "compact" ? "h-9" : "h-11";

  return (
    <div className={cn("w-full", className)}>
      <div className="overflow-x-auto">
        <table
          className={cn("w-full border-collapse text-left", tableClassName)}
        >
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => {
                const activeSort = column.sortKey && column.sortKey === column.activeSortKey;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      activeSort
                        ? column.sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "h-9 whitespace-nowrap px-3 text-[10.5px] font-medium uppercase tracking-[0.075em] text-fg-subtle first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                      column.align === "right" ? "text-right" : "text-left",
                      column.headerClassName,
                    )}
                  >
                    {column.sortKey ? (
                      <button
                        type="button"
                        onClick={() => column.onSort?.(column.sortKey)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[4px] uppercase tracking-[0.075em] transition-colors hover:text-fg",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        {activeSort ? (
                          column.sortDirection === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <SkeletonRows rows={5} columns={columns.length} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={getRowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "group border-b border-line/70 transition-colors last:border-0",
                    onRowClick &&
                      "cursor-pointer hover:bg-surface-2/80 focus-visible:bg-surface-2 focus-visible:outline-none",
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        rowHeight,
                        "whitespace-nowrap px-3 text-[12.5px] text-fg-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                        column.align === "right"
                          ? "text-right tnum"
                          : "text-left",
                        column.className,
                      )}
                    >
                      {column.render
                        ? column.render(row, index)
                        : row[column.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? <div className="border-t border-line px-4 py-3 sm:px-5">{footer}</div> : null}
    </div>
  );
}
