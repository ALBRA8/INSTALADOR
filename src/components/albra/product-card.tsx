"use client";

import {
  ArrowUpCircle,
  BadgeCheck,
  ExternalLink,
  LineChart,
  Loader2,
  Lock,
  Package,
  Play,
  Rocket,
  Sparkles,
  Square,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/albra/status-badge";
import type { CatalogItem } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

/** Mapa de iconos lucide por nombre (lookup directo, sin factories). */
const ICON_MAP: Record<string, LucideIcon> = { Users, Target, Sparkles, LineChart, Package };

export function ProductCard({
  item,
  busy,
  onInstall,
  onOpen,
  onStart,
  onStop,
  onLockedInfo,
  onUpdate,
}: {
  item: CatalogItem;
  busy?: boolean;
  onInstall: () => void;
  onOpen: () => void;
  onStart: () => void;
  onStop: () => void;
  onLockedInfo: () => void;
  onUpdate?: () => void;
}) {
  const Icon = ICON_MAP[item.icon] ?? Package;

  const inProgress =
    item.state === "INSTALLING" ||
    item.state === "UPDATING" ||
    item.state === "REPAIRING" ||
    item.state === "UNINSTALLING" ||
    item.state === "STARTING";

  const emeraldBtn = "bg-emerald-600 text-white hover:bg-emerald-500";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700 sm:p-5">
      {/* Cabecera: icono + nombre + estado */}
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-800">
          <Icon className="size-5 text-emerald-400" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{item.displayName}</p>
          <p className="truncate text-xs text-zinc-500">ALBRA · {item.category}</p>
        </div>
        <StatusBadge state={item.state} health={item.health} />
      </div>

      {/* Chips: puerto / certificado / actualización / bloqueado */}
      <div className="flex flex-wrap items-center gap-1.5">
        {item.port != null && (
          <span className="rounded-md border border-zinc-800 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
            Puerto {item.port}
          </span>
        )}
        {item.certified && (
          <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <BadgeCheck className="size-3" aria-hidden />
            ALBRA CERTIFIED
          </Badge>
        )}
        {item.updateAvailable && (
          <button
            type="button"
            onClick={onUpdate}
            aria-label="Actualización disponible: ver detalles"
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
          >
            <ArrowUpCircle className="size-3" aria-hidden />
            v{item.latestVersion ?? "?"} disponible
          </button>
        )}
        {item.locked && (
          <Badge className="gap-1 border-zinc-700 bg-zinc-800/60 text-zinc-400">
            <Lock className="size-3" aria-hidden />
            No adquirido
          </Badge>
        )}
      </div>

      {/* Acciones según estado */}
      <div className="mt-auto flex flex-wrap gap-2">
        {item.locked ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onLockedInfo}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <Lock aria-hidden />
            VER PRODUCTO
          </Button>
        ) : busy || inProgress ? (
          <Button
            size="sm"
            disabled
            className={cn("gap-2", busy ? emeraldBtn : "border-zinc-700 bg-zinc-800 text-zinc-300")}
          >
            <Loader2 className="animate-spin" aria-hidden />
            {busy ? "Trabajando…" : null}
          </Button>
        ) : item.state === "AVAILABLE" ? (
          <Button size="sm" onClick={onInstall} className={emeraldBtn}>
            <Rocket aria-hidden />
            INSTALAR
          </Button>
        ) : item.state === "RUNNING" ? (
          <>
            <Button size="sm" onClick={onOpen} className={emeraldBtn}>
              <ExternalLink aria-hidden />
              ABRIR
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onStop}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
            >
              <Square aria-hidden />
              DETENER
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpen}
              className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <ExternalLink aria-hidden />
              ABRIR
            </Button>
            <Button size="sm" onClick={onStart} className={emeraldBtn}>
              <Play aria-hidden />
              INICIAR
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
