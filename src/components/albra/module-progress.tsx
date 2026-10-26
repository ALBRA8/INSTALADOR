"use client";

/**
 * ALBRA V3 — Barras de progreso INDEPENDIENTES por módulo.
 * Cada runtime / dependencia / lote de archivos que se instala se muestra
 * con su propia barra (progress 0–100) y estado, para poder seguir el
 * avance de cada módulo por separado dentro de un paso del run.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MinusCircle,
  Package,
  Puzzle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { RunUnitDTO } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<RunUnitDTO["kind"], LucideIcon> = {
  runtime: Puzzle,
  dependency: Package,
  files: CheckCircle2,
  module: Package,
};

function unitVisual(u: RunUnitDTO): { Icon: LucideIcon; barClass: string; textClass: string } {
  switch (u.status) {
    case "RUNNING":
      return { Icon: Loader2, barClass: "[&>[data-slot=progress-indicator]]:bg-amber-400", textClass: "text-amber-400" };
    case "SUCCESS":
      return { Icon: CheckCircle2, barClass: "[&>[data-slot=progress-indicator]]:bg-emerald-500", textClass: "text-emerald-500" };
    case "WARNING":
      return { Icon: AlertTriangle, barClass: "[&>[data-slot=progress-indicator]]:bg-amber-500", textClass: "text-amber-500" };
    case "FAILURE":
      return { Icon: XCircle, barClass: "[&>[data-slot=progress-indicator]]:bg-red-500", textClass: "text-red-500" };
    case "SKIPPED":
      return { Icon: MinusCircle, barClass: "[&>[data-slot=progress-indicator]]:bg-zinc-600", textClass: "text-zinc-500" };
    default:
      return { Icon: Package, barClass: "[&>[data-slot=progress-indicator]]:bg-zinc-600", textClass: "text-zinc-500" };
  }
}

export function ModuleProgressBars({ units, title }: { units: RunUnitDTO[]; title?: string }) {
  if (units.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      {title && (
        <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          <Puzzle className="size-3" aria-hidden />
          {title}
        </p>
      )}
      <ul className="space-y-3">
        {units.map((u) => {
          const { Icon, barClass, textClass } = unitVisual(u);
          const KindIcon = KIND_ICON[u.kind] ?? Package;
          return (
            <li key={u.id} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <KindIcon className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span className={cn("truncate text-xs font-medium", u.status === "PENDING" ? "text-zinc-500" : "text-zinc-200")}>
                  {u.label}
                </span>
                {u.status === "RUNNING" ? (
                  <Icon className={cn("size-3.5 shrink-0 animate-spin", textClass)} aria-label="En progreso" />
                ) : (
                  <Icon className={cn("size-3.5 shrink-0", textClass)} aria-hidden />
                )}
                <span className={cn("ml-auto shrink-0 font-mono text-[11px] tabular-nums", textClass)}>
                  {u.progress}%
                </span>
              </div>
              <Progress
                value={u.progress}
                aria-label={`Progreso de ${u.label}`}
                className={cn("h-1.5 bg-zinc-800", barClass)}
              />
              {u.detail && (
                <p className="truncate font-mono text-[11px] text-zinc-500">{u.detail}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
