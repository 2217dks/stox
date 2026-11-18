"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
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
import { Field, Input, Textarea } from "@/components/ui/input";
import { portfoliosApi } from "@/lib/endpoints";
import { portfolioSchema } from "@/lib/validators";
import { useUI } from "@/store/use-ui";

export function PortfolioDialog({
  portfolio = null,
  trigger,
  defaultOpen = false,
  redirect = false,
  open: controlledOpen,
  onOpenChange,
}) {
  const router = useRouter();
  const editing = Boolean(portfolio);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const setActivePortfolioId = useUI((state) => state.setActivePortfolioId);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(portfolioSchema),
    defaultValues: {
      name: portfolio?.name || "",
      description: portfolio?.description || "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: portfolio?.name || "",
        description: portfolio?.description || "",
      });
    }
  }, [open, portfolio, reset]);

  const onSubmit = async (values) => {
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
    };

    try {
      let createdId = null;

      if (editing) {
        await portfoliosApi.update(portfolio.id, payload);
        toast.success("Portfolio updated");
      } else {
        const data = await portfoliosApi.create(payload);
        const created = data?.portfolio ?? data;
        createdId = created?.id || null;
        if (created?.id) setActivePortfolioId(created.id);
        toast.success("Portfolio created", {
          description: "It starts with $10,000 in virtual cash.",
        });
      }

      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/portfolios"),
      );
      setOpen(false);
      if (redirect && createdId) router.push(`/portfolios/${createdId}`);
    } catch (error) {
      setError("root", {
        message: error?.message || "The portfolio could not be saved.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="primary" size="md">
            <Plus className="size-4" aria-hidden="true" />
            New portfolio
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit portfolio" : "New portfolio"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Only the name and description are editable. Balances stay under the trading engine."
              : "Every portfolio starts with $10,000 in virtual cash and its own holdings and orders."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <DialogBody className="space-y-4">
            {errors.root?.message ? (
              <Alert tone="danger">{errors.root.message}</Alert>
            ) : null}

            <Field label="Name" htmlFor="portfolio-name" error={errors.name?.message}>
              {({ id }) => (
                <Input
                  id={id}
                  placeholder="Long-term, Day trading, Crypto…"
                  invalid={Boolean(errors.name)}
                  {...register("name")}
                />
              )}
            </Field>

            <Field
              label="Description"
              htmlFor="portfolio-description"
              optional
              error={errors.description?.message}
            >
              {({ id }) => (
                <Textarea
                  id={id}
                  placeholder="What is this portfolio for?"
                  rows={3}
                  invalid={Boolean(errors.description)}
                  {...register("description")}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={isSubmitting}>
              {editing ? "Save changes" : "Create portfolio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
