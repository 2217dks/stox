"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";

import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
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
import { copyTradingApi } from "@/lib/endpoints";
import { usePortfolios } from "@/lib/hooks";
import { copyTradeSchema } from "@/lib/validators";

export function CopyTradeDialog({
  trader,
  trigger,
  onCreated,
  open: controlledOpen,
  onOpenChange,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const { activePortfolios } = usePortfolios();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(copyTradeSchema),
    defaultValues: {
      traderId: trader?.id || "",
      allocationPct: "100",
      maxTradeSize: "",
      copyPortfolioId: "",
      isActive: true,
    },
  });

  const allocation = watch("allocationPct");
  const copyPortfolioId = watch("copyPortfolioId");
  const isActive = watch("isActive");

  useEffect(() => {
    if (!open || !trader) return;
    reset({
      traderId: trader.id,
      allocationPct: "100",
      maxTradeSize: "",
      copyPortfolioId: "",
      isActive: true,
    });
  }, [open, trader, reset]);

  const onSubmit = async (values) => {
    try {
      await copyTradingApi.create({
        traderId: trader.id,
        allocationPct: String(values.allocationPct),
        maxTradeSize: values.maxTradeSize ? String(values.maxTradeSize) : null,
        copyPortfolioId: values.copyPortfolioId || undefined,
        isActive: values.isActive,
      });
      toast.success(`Copying ${trader.name}`, {
        description: values.isActive
          ? "New source trades will be mirrored at your allocation."
          : "The relationship is paused. Activate it when ready.",
      });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/copy-trading"),
      );
      setOpen(false);
      onCreated?.();
    } catch (error) {
      setError("root", {
        message: error?.message || "Could not start copy trading.",
      });
    }
  };

  if (!trader) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="secondary" size="sm">
              <Copy className="size-3.5" aria-hidden="true" />
              Copy
            </Button>
          )}
        </DialogTrigger>
      ) : null}
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Copy {trader.name}</DialogTitle>
          <DialogDescription>
            Mirror their market orders into a portfolio you choose, with a hard
            allocation and an optional notional cap.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogBody className="space-y-4">
            {errors.root?.message ? (
              <Alert tone="danger">{errors.root.message}</Alert>
            ) : null}

            <div className="flex items-center gap-3 rounded-[9px] border border-line bg-surface-2 px-3 py-2.5">
              <Avatar src={trader.avatarUrl} name={trader.name} size={34} />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-fg">
                  {trader.name}
                </p>
                <p className="text-[10.5px] text-fg-subtle">
                  Source trader · market orders only
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Allocation"
                htmlFor="copy-allocation"
                hint={`${allocation || 0}% of each source quantity`}
                error={errors.allocationPct?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    className="font-mono tnum"
                    rightSlot={<span className="pr-2 text-[11px] text-fg-subtle">%</span>}
                    invalid={Boolean(errors.allocationPct)}
                    {...register("allocationPct")}
                  />
                )}
              </Field>

              <Field
                label="Max trade size"
                htmlFor="copy-max"
                optional
                hint="Notional cap in USD"
                error={errors.maxTradeSize?.message}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    inputMode="decimal"
                    placeholder="No cap"
                    className="font-mono tnum"
                    leftIcon={<span className="text-[12px]">$</span>}
                    invalid={Boolean(errors.maxTradeSize)}
                    {...register("maxTradeSize")}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Destination portfolio"
              htmlFor="copy-portfolio"
              hint="Leave as default to use your default active portfolio."
              error={errors.copyPortfolioId?.message}
            >
              {({ id }) => (
                <Select
                  value={copyPortfolioId || "default"}
                  onValueChange={(value) =>
                    setValue("copyPortfolioId", value === "default" ? "" : value)
                  }
                >
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default active portfolio</SelectItem>
                    {activePortfolios.map((portfolio) => (
                      <SelectItem key={portfolio.id} value={portfolio.id}>
                        {portfolio.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Switch
              label="Activate immediately"
              description="Paused relationships can be enabled later without creating a duplicate."
              checked={isActive}
              onCheckedChange={(value) => setValue("isActive", value)}
            />

            <div className="flex items-start gap-2 rounded-[8px] border border-line bg-surface-2/50 px-3 py-2.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              <p className="text-[10.5px] leading-relaxed text-fg-subtle">
                Copied orders are market orders. The max trade size caps the
                sized quantity at the source price, not the final fill. Copied
                trades are not copied again.
              </p>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Start copying
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
