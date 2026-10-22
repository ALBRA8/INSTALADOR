"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, fmtBytes } from "@/hooks/use-albra";
import type { PackageDTO } from "@/lib/albra/api-types";
import { toast } from "sonner";

/** Respuesta tolerante de POST /api/packages/verify. */
interface VerifyResponse {
  verified?: boolean;
  ok?: boolean;
  reason?: string;
}

export function VaultDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [packages, setPackages] = useState<PackageDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifyingFile, setVerifyingFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ packages: PackageDTO[] }>("/api/packages");
      setPackages(data.packages);
    } catch {
      toast.error("No se pudo cargar la bóveda de paquetes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const verify = async (pkg: PackageDTO) => {
    setVerifyingFile(pkg.fileName);
    try {
      const res = await api<VerifyResponse>("/api/packages/verify", {
        method: "POST",
        body: JSON.stringify({ fileName: pkg.fileName }),
      });
      const passed = res.verified ?? res.ok ?? false;
      if (passed) {
        toast.success(`Firma verificada: ${pkg.fileName}`);
      } else {
        toast.error(res.reason ?? `Firma inválida: ${pkg.fileName}`);
      }
      await load();
    } catch {
      toast.error(`No se pudo verificar ${pkg.fileName}.`);
    } finally {
      setVerifyingFile(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Bóveda de paquetes</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Paquetes .albra firmados (HMAC-SHA256) listos para instalar.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-500">Archivo</TableHead>
                <TableHead className="text-zinc-500">Versión</TableHead>
                <TableHead className="text-zinc-500">Canal</TableHead>
                <TableHead className="text-zinc-500">Tamaño</TableHead>
                <TableHead className="text-zinc-500">Verificación</TableHead>
                <TableHead className="w-24 text-right text-zinc-500">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow className="border-zinc-800">
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-zinc-500">
                    <Loader2 className="mx-auto size-4 animate-spin text-amber-400" aria-hidden />
                  </TableCell>
                </TableRow>
              )}
              {!loading && packages.length === 0 && (
                <TableRow className="border-zinc-800">
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-zinc-500">
                    La bóveda está vacía.
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                packages.map((pkg) => (
                  <TableRow key={pkg.fileName} className="border-zinc-800">
                    <TableCell className="font-mono text-xs text-zinc-200">
                      {pkg.fileName}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-400">{pkg.version}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{pkg.channel}</TableCell>
                    <TableCell className="text-xs text-zinc-400">{fmtBytes(pkg.sizeBytes)}</TableCell>
                    <TableCell>
                      {pkg.verified ? (
                        <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          <ShieldCheck className="size-3" aria-hidden />
                          Firma válida
                        </Badge>
                      ) : pkg.tampered ? (
                        <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-400">
                          <ShieldAlert className="size-3" aria-hidden />
                          Manipulado
                        </Badge>
                      ) : (
                        <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-400">
                          <ShieldAlert className="size-3" aria-hidden />
                          {pkg.verifyReason ?? "Firma inválida"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void verify(pkg)}
                        disabled={verifyingFile === pkg.fileName}
                        className="h-7 border-zinc-700 bg-transparent px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                        aria-label={`Verificar paquete ${pkg.fileName}`}
                      >
                        {verifyingFile === pkg.fileName ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          "Verificar"
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>

        <p className="flex items-start gap-2 text-xs text-zinc-500">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
          Los paquetes con firma inválida son rechazados por el instalador.
        </p>
      </DialogContent>
    </Dialog>
  );
}
