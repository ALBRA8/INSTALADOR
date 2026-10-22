"use client";

import { LineChart, Lock, Package, Sparkles, Target, Users, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CatalogItem } from "@/lib/albra/api-types";

/** Mapa de iconos lucide por nombre (lookup directo, sin factories). */
const ICON_MAP: Record<string, LucideIcon> = { Users, Target, Sparkles, LineChart, Package };

export function LockedProductDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: CatalogItem | null;
}) {
  const Icon = (item && ICON_MAP[item.icon]) ?? Package;
  const entitlement = item?.requiredEntitlement ?? "licencia activa";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
              <Icon className="size-5 text-zinc-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-zinc-100">
                {item?.displayName ?? "Producto bloqueado"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-zinc-400">
                {item?.description ?? "Producto del catálogo ALBRA."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <Badge className="gap-1 border-zinc-700 bg-zinc-800/60 text-zinc-300">
            <Lock className="size-3" aria-hidden />
            Requiere: {entitlement}
          </Badge>
          <p className="text-sm leading-relaxed text-zinc-400">
            Este producto forma parte del catálogo ALBRA pero requiere una licencia activa. En el
            modelo SaaS futuro, la cadena{" "}
            <span className="font-mono text-xs text-zinc-300">
              CUSTOMER → SUBSCRIPTION → ENTITLEMENT → PRODUCT ACCESS
            </span>{" "}
            habilita este botón.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
