import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Zap, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface PriceRow {
  price_id: string;
  product_id: string;
  product_name: string;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; interval_count?: number } | null;
  product_metadata: Record<string, string> | null;
}

function formatAmount(unitAmount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(unitAmount / 100);
}

interface PlanPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (interval: "monthly" | "annual") => Promise<void>;
}

export function PlanPickerDialog({ open, onOpenChange, onConfirm }: PlanPickerDialogProps) {
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState<"monthly" | "annual">("monthly");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedInterval("monthly");
    setPricesLoading(true);
    fetch("/api/billing/prices")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data: { prices: PriceRow[] }) => {
        const proPrices = (data.prices ?? []).filter(
          (p) => p.product_metadata?.tier === "pro"
        );
        setPrices(proPrices);
      })
      .catch(() => {})
      .finally(() => setPricesLoading(false));
  }, [open]);

  const monthlyPrice = prices.find((p) => p.recurring?.interval === "month");
  const annualPrice = prices.find((p) => p.recurring?.interval === "year");

  const annualSavingsPct = useMemo(() => {
    if (!monthlyPrice || !annualPrice) return null;
    const monthlyTotal = monthlyPrice.unit_amount * 12;
    const saving = Math.round((1 - annualPrice.unit_amount / monthlyTotal) * 100);
    return saving > 0 ? saving : null;
  }, [monthlyPrice, annualPrice]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm(selectedInterval);
    } finally {
      setConfirming(false);
    }
  }

  const options: { interval: "monthly" | "annual"; label: string; price: PriceRow | undefined; badge?: string }[] = [
    { interval: "monthly", label: "Monthly", price: monthlyPrice },
    {
      interval: "annual",
      label: "Annual",
      price: annualPrice,
      badge: annualSavingsPct ? `Save ${annualSavingsPct}%` : undefined,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="dialog-plan-picker">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Upgrade to Pro</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground -mt-1">
          Choose a billing interval to continue.
        </p>

        {pricesLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {options.map(({ interval, label, price, badge }) => {
              const selected = selectedInterval === interval;
              return (
                <button
                  key={interval}
                  type="button"
                  onClick={() => setSelectedInterval(interval)}
                  data-testid={`plan-option-${interval}`}
                  className={cn(
                    "relative rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  )}
                >
                  {badge && (
                    <span className="absolute -top-2.5 right-3 bg-green-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                      {badge}
                    </span>
                  )}
                  {selected && (
                    <span className="absolute top-2 right-2">
                      <Check className="w-3.5 h-3.5 text-primary" />
                    </span>
                  )}
                  <p className="text-sm font-semibold mb-1">{label}</p>
                  {price ? (
                    <>
                      <p className="text-xl font-bold text-foreground">
                        {formatAmount(price.unit_amount, price.currency)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        / {price.recurring?.interval === "year" ? "year" : "month"}
                      </p>
                      {interval === "annual" && monthlyPrice && (
                        <p className="text-xs text-muted-foreground mt-1">
                          ({formatAmount(Math.round(price.unit_amount / 12), price.currency)}/mo)
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">—</p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={confirming || pricesLoading}
            className="gap-1.5"
            data-testid="button-confirm-plan"
          >
            {confirming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {confirming ? "Opening checkout…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
