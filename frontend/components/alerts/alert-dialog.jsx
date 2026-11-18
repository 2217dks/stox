"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BellPlus } from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SymbolSearch } from "@/components/market/symbol-search";
import { alertsApi } from "@/lib/endpoints";
import { ALERT_CONDITIONS } from "@/lib/constants";
import { alertSchema } from "@/lib/validators";
import { isCrypto } from "@/lib/format";

export function AlertDialog({
  trigger,
  defaultSymbol = "",
  defaultAssetType,
  alert = null,
  onSaved,
}) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(alert);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(alertSchema),
    defaultValues: {
      symbol: alert?.symbol || defaultSymbol,
      assetType:
        alert?.assetType ||
        defaultAssetType ||
        (defaultSymbol && isCrypto(defaultSymbol) ? "CRYPTO" : "STOCK"),
      condition: alert?.condition || "PRICE_ABOVE",
      targetPrice: alert?.targetPrice ? String(alert.targetPrice) : "",
      sendEmail: alert?.sendEmail ?? true,
      sendPush: alert?.sendPush ?? false,
    },
  });

  const symbol = watch("symbol");
  const assetType = watch("assetType");
  const condition = watch("condition");
  const sendEmail = watch("sendEmail");
  const sendPush = watch("sendPush");
  const isPercent = condition.startsWith("PERCENT");

  const onSubmit = async (values) => {
    const payload = {
      symbol: values.symbol,
      assetType: values.assetType,
      condition: values.condition,
      targetPrice: String(values.targetPrice),
      sendEmail: values.sendEmail,
      sendPush: values.sendPush,
    };

    try {
      if (editing) {
        await alertsApi.update(alert.id, {
          condition: payload.condition,
          targetPrice: payload.targetPrice,
          sendEmail: payload.sendEmail,
          sendPush: payload.sendPush,
        });
        toast.success("Alert updated");
      } else {
        await alertsApi.create(payload);
        toast.success("Alert created", {
          description: `${values.symbol} · ${ALERT_CONDITIONS.find((item) => item.value === values.condition)?.label}`,
        });
      }

      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/alerts"),
      );
      reset();
      setOpen(false);
      onSaved?.();
    } catch (error) {
      setError("root", {
        message: error?.message || "The alert could not be saved.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="secondary" size="md">
            <BellPlus className="size-4" aria-hidden="true" />
            Create alert
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit alert" : "Create price alert"}</DialogTitle>
          <DialogDescription>
            We check alerts against live quotes. Percentage alerts capture the
            current price as a baseline when created.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogBody className="space-y-4">
            {errors.root?.message ? (
              <Alert tone="danger">{errors.root.message}</Alert>
            ) : null}

            {!editing ? (
              <Field label="Symbol" htmlFor="alert-symbol" error={errors.symbol?.message}>
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
                    />
                    <input id={id} type="hidden" {...register("symbol")} />
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
                  </div>
                )}
              </Field>
            ) : (
              <div className="flex items-center justify-between rounded-[9px] border border-line bg-surface-2 px-3 py-2.5">
                <span className="font-mono text-[12px] font-medium text-fg">
                  {alert.symbol}
                </span>
                <span className="text-[10px] uppercase tracking-[0.07em] text-fg-subtle">
                  {alert.assetType}
                </span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Condition" htmlFor="alert-condition">
                {({ id }) => (
                  <Select
                    value={condition}
                    onValueChange={(value) => setValue("condition", value)}
                  >
                    <SelectTrigger id={id}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_CONDITIONS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field
                label={isPercent ? "Change threshold" : "Target price"}
                htmlFor="alert-target"
                error={errors.targetPrice?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    placeholder={isPercent ? "5.00" : "250.00"}
                    className="font-mono tnum"
                    leftIcon={
                      isPercent ? (
                        <span className="text-[12px]">%</span>
                      ) : (
                        <span className="text-[12px]">$</span>
                      )
                    }
                    invalid={Boolean(errors.targetPrice)}
                    {...register("targetPrice")}
                  />
                )}
              </Field>
            </div>

            <p className="text-[11px] leading-relaxed text-fg-subtle">
              {isPercent
                ? "The current quote is stored as the baseline; the alert triggers when price moves by this percentage."
                : "The alert triggers when the quote crosses your target from either direction."}
            </p>

            <div className="space-y-3 rounded-[9px] border border-line bg-surface-2/50 px-3.5 py-3">
              <Switch
                label="Email notification"
                description="Send to your account email when triggered."
                checked={sendEmail}
                onCheckedChange={(value) => setValue("sendEmail", value)}
              />
              <Switch
                label="Push notification"
                description="Requires a registered push token."
                checked={sendPush}
                onCheckedChange={(value) => setValue("sendPush", value)}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              {editing ? "Save changes" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
