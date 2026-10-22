"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Etiquetas en español para los estados del ciclo de vida. */
const STATE_LABEL: Record<string, string> = {
  RUNNING: "Funcionando",
  STOPPED: "Detenido",
  INSTALLED: "Instalado",
  AVAILABLE: "No instalado",
  INSTALLING: "Instalando",
  UPDATING: "Actualizando",
  REPAIRING: "Reparando",
  UNINSTALLING: "Desinstalando",
  STARTING: "Iniciando",
  DEGRADED: "Degradado",
  FAILED: "Error",
};

/** Color del punto según estado (tema oscuro ALBRA: esmeralda/zinc/ámbar/rojo). */
const DOT_STYLE: Record<string, string> = {
  RUNNING: "bg-emerald-500 animate-pulse",
  STOPPED: "bg-zinc-400",
  INSTALLED: "bg-zinc-400",
  AVAILABLE: "bg-zinc-600",
  STARTING: "bg-amber-400 animate-pulse",
  INSTALLING: "bg-amber-400 animate-pulse",
  UPDATING: "bg-amber-400 animate-pulse",
  REPAIRING: "bg-amber-400 animate-pulse",
  UNINSTALLING: "bg-amber-400 animate-pulse",
  DEGRADED: "bg-amber-500",
  FAILED: "bg-red-500",
};

export function StatusBadge({
  state,
  health,
  compact,
}: {
  state?: string | null;
  health?: string | null;
  compact?: boolean;
}) {
  // Override de salud: health FAILED siempre se muestra como "Error".
  const failed = health === "FAILED";
  if (!failed && (state == null || state === "")) return null;

  const resolved = failed ? "FAILED" : (state as string);
  const label = failed ? "Error" : (STATE_LABEL[resolved] ?? resolved);

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-zinc-700 bg-zinc-900/60 font-normal text-zinc-300",
        compact && "gap-1 px-1.5 text-[10px]"
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", DOT_STYLE[resolved] ?? "bg-zinc-600")}
      />
      {label}
    </Badge>
  );
}
