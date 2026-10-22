"use client";

/**
 * ALBRA — Copias de seguridad: listado, creación y restauración.
 */

import { useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, HardDriveDownload, PackageOpen, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError, fmtBytes, fmtDate } from "@/hooks/use-albra";
import type { BackupDTO, ProductDetail } from "@/lib/albra/api-types";

const KIND_LABEL: Record<string, string> = {
  PRE_UPDATE: "Auto (pre-actualización)",
  MANUAL: "Manual",
  PRE_UNINSTALL: "Pre-desinstalación",
};

export function BackupsPanel({ detail, onChanged }: { detail: ProductDetail; onChanged: () => void }) {
  const [creating, setCreating] = useState<boolean>(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupDTO | null>(null);
  const [restoring, setRestoring] = useState<boolean>(false);

  const createBackup = async () => {
    setCreating(true);
    try {
      await api(`/api/products/${detail.productId}/backup`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Copia de seguridad creada");
      onChanged();
    } catch (e) {
      const err = e as ApiError;
      toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo crear la copia");
    } finally {
      setCreating(false);
    }
  };

  const restoreBackup = async (backupId: string) => {
    setRestoring(true);
    try {
      await api(`/api/products/${detail.productId}/restore`, {
        method: "POST",
        body: JSON.stringify({ backupId }),
      });
      toast.success("Copia restaurada correctamente");
      setRestoreTarget(null);
      onChanged();
    } catch (e) {
      const err = e as ApiError;
      if (err instanceof ApiError && err.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else {
        toast.error(err instanceof ApiError ? (err.userMessage ?? err.message) : "No se pudo restaurar la copia");
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HardDriveDownload className="size-5 text-emerald-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Copias de seguridad</h3>
        </div>
        <Button
          size="sm"
          onClick={createBackup}
          disabled={creating}
          className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600"
        >
          <ArchiveRestore className={`size-4 ${creating ? "animate-pulse" : ""}`} />
          Crear copia
        </Button>
      </div>

      {detail.backups.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-900 p-6 text-zinc-500">
          <PackageOpen className="size-4" />
          <p className="text-xs">Sin copias de seguridad todavía. ALBRA crea una automática antes de cada actualización.</p>
        </div>
      ) : (
        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
          {detail.backups.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      b.kind === "PRE_UNINSTALL"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400"
                    }
                  >
                    {KIND_LABEL[b.kind] ?? b.kind}
                  </Badge>
                  <span className="font-mono text-xs text-zinc-300">v{b.version}</span>
                  <span className="text-xs text-zinc-500">{fmtBytes(b.sizeBytes)}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{fmtDate(b.createdAt)}</p>
                {b.note ? <p className="mt-0.5 text-xs italic text-zinc-600">{b.note}</p> : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRestoreTarget(b)}
                disabled={restoring}
                className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
              >
                <ArchiveRestore className="size-3.5" />
                Restaurar
              </Button>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(v) => {
          if (!v) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-amber-400" />
              ¿Restaurar esta copia?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Los datos actuales serán reemplazados por el snapshot
              {restoreTarget ? ` de la versión v${restoreTarget.version}` : ""}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                e.preventDefault();
                if (restoreTarget) void restoreBackup(restoreTarget.id);
              }}
              className="bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-600"
            >
              {restoring ? "Restaurando…" : "Restaurar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
