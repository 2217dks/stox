"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { portfoliosApi } from "@/lib/endpoints";

export function DeactivatePortfolioDialog({ portfolio, trigger, onDeactivated }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isDefault = portfolio?.isDefault;

  const deactivate = async () => {
    if (!portfolio || isDefault) return;

    try {
      setLoading(true);
      setError("");
      await portfoliosApi.remove(portfolio.id);
      toast.success("Portfolio deactivated", {
        description: "Holdings and history are preserved.",
      });
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/portfolios"),
      );
      setOpen(false);
      onDeactivated?.();
      router.push("/portfolios");
    } catch (err) {
      setError(err?.message || "The portfolio could not be deactivated.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="danger-ghost" size="sm">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Deactivate
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Deactivate {portfolio?.name}?</DialogTitle>
          <DialogDescription>
            This is a soft delete. Holdings, orders and trades are preserved,
            but the portfolio can no longer receive new orders.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {isDefault ? (
            <Alert tone="warning" title="Default portfolio protected">
              The default portfolio cannot be deactivated. Create or choose
              another portfolio as your default first.
            </Alert>
          ) : (
            <Alert tone="warning" title="Open orders">
              Cancel any pending orders before deactivating. Cash reserved by
              those orders is not released by this action.
            </Alert>
          )}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep portfolio
          </Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={isDefault}
            onClick={deactivate}
          >
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
