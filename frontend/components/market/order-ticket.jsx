"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Info, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SymbolSearch } from "@/components/market/symbol-search";
import { ordersApi } from "@/lib/endpoints";
import { useQuote, useInvalidateTrading } from "@/lib/hooks";
import {
  formatCurrency,
  formatPrice,
  formatQuantity,
  isCrypto,
} from "@/lib/format";
import { ORDER_TYPES, QUICK_ALLOCATIONS } from "@/lib/constants";
import { orderSchema } from "@/lib/validators";
import { cn } from "@/lib/utils";

export function OrderTicket({
  portfolioId,
  portfolio,
  defaultSymbol = "",
  defaultAssetType,
  defaultSide = "BUY",
  defaultType = "MARKET",
  availableQuantity,
  onSuccess,
  compact = false,
  showHeader = true,
  className,
}) {
  const invalidate = useInvalidateTrading();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const initialAssetType =
    defaultAssetType ||
    (defaultSymbol && isCrypto(defaultSymbol) ? "CRYPTO" : "STOCK");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      portfolioId: portfolioId || "",
      symbol: defaultSymbol,
      assetType: initialAssetType,
      side: defaultSide,
      type: defaultType,
      quantity: "",
      limitPrice: "",
      stopPrice: "",
      expiresAt: "",
    },
  });

  const symbol = watch("symbol");
  const assetType = watch("assetType");
  const side = watch("side");
  const type = watch("type");
  const quantity = watch("quantity");
  const limitPrice = watch("limitPrice");
  const stopPrice = watch("stopPrice");

  const { quote } = useQuote(symbol, assetType);

  useEffect(() => {
    if (portfolioId) setValue("portfolioId", portfolioId);
  }, [portfolioId, setValue]);

  useEffect(() => {
    if (defaultSymbol) {
      setValue("symbol", defaultSymbol);
      setValue(
        "assetType",
        defaultAssetType ||
          (isCrypto(defaultSymbol) ? "CRYPTO" : "STOCK"),
      );
    }
  }, [defaultSymbol, defaultAssetType, setValue]);

  const price = useMemo(() => {
    if (type === "LIMIT") return Number(limitPrice);
    if (type === "STOP_LOSS" || type === "TAKE_PROFIT") return Number(stopPrice);
    return Number(quote?.price);
  }, [type, limitPrice, stopPrice, quote?.price]);

  const estimated =
    Number(quantity) > 0 && price > 0 ? Number(quantity) * price : 0;
  const availableCash = Number(portfolio?.availableCash ?? portfolio?.cashBalance ?? 0);
  // Deactivated portfolios are read-only: the API rejects new orders, so the
  // ticket blocks submission instead of letting the user discover it on error.
  const portfolioInactive = portfolio?.isActive === false;
  const insuffientCash =
    side === "BUY" && estimated > 0 && estimated > availableCash;
  const priceLabel =
    type === "LIMIT"
      ? "Limit price"
      : "Stop trigger price";

  const fillAllocation = (percent) => {
    if (!price) return;

    if (side === "SELL" && availableQuantity) {
      const next = (Number(availableQuantity) * percent) / 100;
      setValue("quantity", next.toFixed(Math.min(8, 8)).replace(/\.?0+$/, ""), {
        shouldValidate: true,
      });
      return;
    }

    const next = (availableCash * (percent / 100)) / price;
    if (Number.isFinite(next) && next > 0) {
      setValue("quantity", next.toFixed(8).replace(/\.?0+$/, ""), {
        shouldValidate: true,
      });
    }
  };

  const onSubmit = async (values) => {
    if (!portfolioId) {
      setError("root", {
        message: "Choose a portfolio before placing an order.",
      });
      return;
    }

    if (portfolioInactive) {
      setError("root", {
        message:
          "This portfolio is deactivated. Reactivate it to place new orders.",
      });
      return;
    }

    const payload = {
      portfolioId,
      symbol: values.symbol.trim().toUpperCase(),
      assetType: values.assetType,
      side: values.side,
      type: values.type,
      quantity: String(values.quantity).trim(),
    };

    if (values.type === "LIMIT") payload.limitPrice = String(values.limitPrice).trim();
    if (values.type === "STOP_LOSS" || values.type === "TAKE_PROFIT") {
      payload.stopPrice = String(values.stopPrice).trim();
    }
    if (values.expiresAt) {
      payload.expiresAt = new Date(values.expiresAt).toISOString();
    }

    try {
      const data = await ordersApi.create(payload);
      toast.success(
        `${values.side === "BUY" ? "Buy" : "Sell"} order placed`,
        {
          description: `${values.quantity} ${values.symbol} · ${values.type.toLowerCase()}`,
        },
      );
      reset({
        portfolioId,
        symbol: values.symbol,
        assetType: values.assetType,
        side: values.side,
        type: "MARKET",
        quantity: "",
        limitPrice: "",
        stopPrice: "",
        expiresAt: "",
      });
      await invalidate();
      onSuccess?.(data?.order ?? data);
    } catch (error) {
      setError("root", {
        message: error?.message || "The order could not be placed.",
      });
      toast.error("Order rejected", {
        description: error?.message || "The order could not be placed.",
      });
    }
  };

  return (
    <div className={cn("panel", compact ? "p-3.5" : "p-4 sm:p-5", className)}>
      {showHeader ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-fg">Order ticket</h2>
            <p className="mt-0.5 text-[11px] text-fg-subtle">
              Virtual funds. Real market prices.
            </p>
          </div>
          {quote?.price ? (
            <div className="text-right">
              <p className="tnum text-[14px] font-semibold text-fg">
                {formatCurrency(quote.price)}
              </p>
              <p className="text-[9.5px] text-fg-subtle">Live quote</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3.5" noValidate>
        {portfolioInactive ? (
          <Alert tone="warning" title="Portfolio deactivated">
            Reactivate this portfolio from its portfolio page to place new
            orders.
          </Alert>
        ) : null}
        {errors.root?.message ? (
          <Alert tone="danger">{errors.root.message}</Alert>
        ) : null}

        <div className="grid grid-cols-2 gap-1 rounded-[9px] border border-line bg-surface-2 p-1">
          {[
            { value: "BUY", label: "Buy", active: "bg-up text-[#04120b]" },
            { value: "SELL", label: "Sell", active: "bg-down text-white" },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setValue("side", option.value)}
              aria-pressed={side === option.value}
              className={cn(
                "h-8 rounded-[7px] text-[12.5px] font-semibold transition-[background-color,color] duration-[var(--dur-fast)]",
                side === option.value
                  ? option.active
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Field
          label="Symbol"
          htmlFor="order-symbol"
          error={errors.symbol?.message}
        >
          {({ id }) => (
            <div className="space-y-2">
              <SymbolSearch
                value={symbol}
                onChange={(next) => setValue("symbol", next, { shouldValidate: true })}
                onSelect={(result) => {
                  setValue("symbol", result.symbol, { shouldValidate: true });
                  setValue("assetType", result.assetClass);
                }}
                assetClass={assetType}
                inputClassName="font-mono"
              />
              <input id={id} type="hidden" {...register("symbol")} />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={assetType}
                  onValueChange={(value) => setValue("assetType", value)}
                >
                  <SelectTrigger className="h-8 text-[11.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STOCK">Stocks</SelectItem>
                    <SelectItem value="CRYPTO">Crypto</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={type}
                  onValueChange={(value) => setValue("type", value)}
                >
                  <SelectTrigger className="h-8 text-[11.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_TYPES.map((orderType) => (
                      <SelectItem key={orderType.value} value={orderType.value}>
                        {orderType.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </Field>

        <Field
          label="Quantity"
          htmlFor="order-quantity"
          error={errors.quantity?.message}
          action={
            <span className="tnum text-[10px] text-fg-subtle">
              {side === "BUY"
                ? `${formatCurrency(availableCash, { compact: true })} available`
                : availableQuantity
                  ? `${formatQuantity(availableQuantity)} available`
                  : "Position limited"}
            </span>
          }
        >
          {({ id }) => (
            <Input
              id={id}
              inputMode="decimal"
              placeholder="0.00"
              className="font-mono tnum"
              invalid={Boolean(errors.quantity)}
              {...register("quantity")}
            />
          )}
        </Field>

        {side === "BUY" || availableQuantity ? (
          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_ALLOCATIONS.map((percent) => (
              <button
                key={percent}
                type="button"
                onClick={() => fillAllocation(percent)}
                className="h-7 rounded-[6px] border border-line bg-surface-2 text-[10.5px] font-medium text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                {percent === 100 ? "Max" : `${percent}%`}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[10.5px] leading-snug text-fg-subtle">
            Sell quantity is limited to your open position. Enter the amount to
            close or reduce.
          </p>
        )}

        {type !== "MARKET" ? (
          <Field
            label={priceLabel}
            htmlFor="order-price"
            error={
              type === "LIMIT"
                ? errors.limitPrice?.message
                : errors.stopPrice?.message
            }
          >
            {({ id }) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder={
                  quote?.price ? formatPrice(quote.price) : "0.00"
                }
                className="font-mono tnum"
                invalid={
                  type === "LIMIT"
                    ? Boolean(errors.limitPrice)
                    : Boolean(errors.stopPrice)
                }
                {...register(type === "LIMIT" ? "limitPrice" : "stopPrice")}
              />
            )}
          </Field>
        ) : null}

        <div className="rounded-[8px] border border-line bg-surface-2/60 px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-fg-subtle">
              <Wallet className="size-3" aria-hidden="true" />
              Estimated {side === "BUY" ? "cost" : "proceeds"}
            </span>
            <span className="tnum font-medium text-fg">
              {estimated > 0 ? formatCurrency(estimated) : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-fg-subtle">
            <span>Execution</span>
            <span>
              {type === "MARKET"
                ? "Best available price"
                : type === "LIMIT"
                  ? "At limit or better"
                  : "Triggers a market order"}
            </span>
          </div>
        </div>

        {insuffientCash ? (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-warn">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Estimated cost exceeds available cash. The order may be rejected
            unless the fill is cheaper.
          </p>
        ) : null}

        {!compact ? (
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex w-full items-center justify-between rounded-[6px] py-1 text-[11px] text-fg-subtle transition-colors hover:text-fg-muted"
              aria-expanded={showAdvanced}
            >
              Advanced
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  showAdvanced && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            {showAdvanced ? (
              <Field
                label="Expires at"
                htmlFor="order-expiry"
                hint="Optional. Pending orders without an expiry stay open."
                error={errors.expiresAt?.message}
                className="mt-2"
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    invalid={Boolean(errors.expiresAt)}
                    {...register("expiresAt")}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : null}

        <Button
          type="submit"
          variant={side === "BUY" ? "success" : "danger"}
          size={compact ? "md" : "lg"}
          fullWidth
          loading={isSubmitting}
          disabled={portfolioInactive}
        >
          {isSubmitting
            ? "Placing order…"
            : `${side === "BUY" ? "Buy" : "Sell"} ${symbol || "asset"}`}
        </Button>

        <p className="text-center text-[9.5px] leading-snug text-fg-subtle">
          Market orders fill at the best available price. Virtual funds only.
        </p>
      </form>
    </div>
  );
}
