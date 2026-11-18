"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { copyTradingApi } from "@/lib/endpoints";
import { usePortfolios } from "@/lib/hooks";
import { copyTradeSchema } from "@/lib/validators";

export function EditCopyTradeDialog({ relationship, open, onOpenChange }) {
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
      traderId: relationship?.traderId || "",
      allocationPct: relationship?.allocationPct || "100",
      maxTradeSize: relationship?.maxTradeSize || "",
      copyPortfolioId: relationship?.copyPortfolioId || "",
      isActive: relationship?.isActive ?? true,
    },
  });

  const copyPortfolioId = watch("copyPortfolioId");
  const isActive = watch("isActive");
  const allocation = watch("allocationPct");

  useEffect(() => {
    if (!open || !relationship) return;
    reset({
      traderId: relationship.traderId,
      allocationPct: String(relationship.allocationPct ?? "100"),
      maxTradeSize: relationship.maxTradeSize
        ? String(relationship.maxTradeSize)
        : "",
      copyPortfolioId: relationship.copyPortfolioId || "",
      isActive: relationship.isActive ?? true,
    });
  }, [open, relationship, reset]);

  const onSubmit = async (values) => {
    try {
      await copyTradingApi.update(relationship.id, {
        allocationPct: String(values.allocationPct),
        maxTradeSize: values.maxTradeSize ? String(values.maxTradeSize) : null,
        copyPortfolioId: values.copyPortfolioId || null,
        isActive: values.isActive,
      });
      toast.success("Copy settings updated");
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/copy-trading"),
      );
      onOpenChange?.(false);
    } catch (error) {
      setError("root", {
        message: error?.message || "Could not update copy settings.",
      });
    }
  };

  if (!relationship) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Edit copy settings</DialogTitle>
          <DialogDescription>
            Changes apply to future source trades. Existing copied orders are
            untouched.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogBody className="space-y-4">
            {errors.root?.message ? (
              <Alert tone="danger">{errors.root.message}</Alert>
            ) : null}

            <div className="flex items-center gap-3 rounded-[9px] border border-line bg-surface-2 px-3 py-2.5">
              <Avatar
                src={relationship.trader?.avatarUrl}
                name={relationship.trader?.name || "Trader"}
                size={34}
              />
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-fg">
                  {relationship.trader?.name || "Unknown trader"}
                </p>
                <p className="text-[10.5px] text-fg-subtle">
                  Copying since{" "}
                  {new Date(relationship.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Allocation"
                htmlFor="edit-allocation"
                hint={`${allocation || 0}% of source quantity`}
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
                htmlFor="edit-max"
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
              htmlFor="edit-copy-portfolio"
              hint="Clear to fall back to your default active portfolio."
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
              label="Active"
              description="Pause to stop copying future trades without deleting the relationship."
              checked={isActive}
              onCheckedChange={(value) => setValue("isActive", value)}
            />
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange?.(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
