"use client";

import { useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/hooks/use-albra";
import { toast } from "sonner";

export function CleanroomDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setBusy(false);
  }, [open]);

  const canRun = confirmText.trim() === "RESETEAR" && !busy;

  const runCleanroom = async () => {
    if (!canRun) return;
    setBusy(true);
    try {
      await api<unknown>("/api/cleanroom", { method: "POST" });
      toast.success("Clean-room completado: máquina restaurada a estado limpio.");
      onDone();
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast.error(err.message ?? "No se pudo ejecutar el clean-room.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-zinc-100">
            <TriangleAlert className="size-5 text-red-500" aria-hidden />
            Restaurar máquina limpia
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-zinc-400">
              <p>
                Esta acción <span className="text-red-400">borra todas las instalaciones, datos y
                configuraciones</span> de los productos ALBRA en esta máquina.
              </p>
              <p>
                Se conservan únicamente los <span className="text-zinc-200">paquetes de la
                bóveda</span> y el <span className="text-zinc-200">registro de auditoría</span>.
              </p>
              <p className="text-xs text-zinc-500">
                Escribe <span className="font-mono text-zinc-300">RESETEAR</span> para habilitar el
                botón de confirmación.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder='Escribe "RESETEAR"'
          aria-label="Confirmación de clean-room"
          disabled={busy}
          className="border-zinc-800 bg-zinc-900 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-red-500/40"
        />

        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={busy}
            className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Cancelar
          </AlertDialogCancel>
          <Button
            onClick={() => void runCleanroom()}
            disabled={!canRun}
            className="bg-red-600 text-white hover:bg-red-500"
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Restaurando…
              </>
            ) : (
              "Restaurar máquina limpia"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
