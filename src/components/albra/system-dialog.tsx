"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/hooks/use-albra";
import type { SystemInfoDTO } from "@/lib/albra/api-types";
import { cn } from "@/lib/utils";

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-sm text-zinc-100",
          mono && "break-all font-mono text-xs"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function SystemDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [info, setInfo] = useState<SystemInfoDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setInfo(null);
      setError(null);
    })();
    api<SystemInfoDTO>("/api/system")
      .then((d) => {
        if (!cancelled) setInfo(d);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo obtener la información del sistema.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Sistema</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Información de la máquina y del runtime de ALBRA.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        {!info && !error && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-zinc-800" />
            ))}
          </div>
        )}

        {info && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Adaptador" value={info.adapterLabel} />
            <Stat label="Plataforma" value={info.platform} />
            <Stat label="Arquitectura" value={info.arch} />
            <Stat label="Node" value={info.nodeVersion} mono />
            <Stat label="Memoria" value={`${info.totalMemMB} MB`} />
            <Stat label="Disco libre" value={`${info.freeDiskMB} MB`} />
            <Stat label="Productos instalados" value={String(info.productsInstalled)} />
            <Stat label="Paquetes en bóveda" value={String(info.packagesInVault)} />
            <Stat label="Uptime" value={`${Math.max(1, Math.round(info.uptimeS / 60))} min`} />
            <div className="col-span-2 sm:col-span-3">
              <Stat label="ALBRA Home" value={info.albraHome} mono />
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-center">
          <p className="text-xs text-zinc-600">
            {info
              ? `ALBRA Platform v${info.version} — ${info.adapterLabel}`
              : "ALBRA Platform — Local Adapter"}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
