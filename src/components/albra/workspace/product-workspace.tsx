"use client";

/**
 * ALBRA — Workspace de producto: cabecera con ciclo de vida + pestañas
 * (Resumen, Producto, Actualizar, Copias, Diagnóstico, Registros, Ciclo de vida, Configuración).
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  MoreVertical,
  Package,
  PackageX,
  Play,
  Power,
  PowerOff,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/albra/status-badge";
import { HealthChecks } from "@/components/albra/workspace/health-checks";
import { UpdatePanel } from "@/components/albra/workspace/update-panel";
import { BackupsPanel } from "@/components/albra/workspace/backups-panel";
import { DiagnosticsPanel } from "@/components/albra/workspace/diagnostics-panel";
import { LogsPanel } from "@/components/albra/workspace/logs-panel";
import { RunsHistory } from "@/components/albra/workspace/runs-history";
import { ConfigPanel } from "@/components/albra/workspace/config-panel";
import { UninstallDialog } from "@/components/albra/workspace/uninstall-dialog";
import { api, ApiError, fmtDate, useProductDetail } from "@/hooks/use-albra";
import type { LifecycleStateDTO, ProductDetail } from "@/lib/albra/api-types";

const BUSY_STATES: LifecycleStateDTO[] = ["INSTALLING", "STARTING", "UPDATING", "REPAIRING", "UNINSTALLING"];

const BUSY_LABEL: Record<string, string> = {
  INSTALLING: "instalando",
  STARTING: "iniciando",
  UPDATING: "actualizando",
  REPAIRING: "reparando",
  UNINSTALLING: "desinstalando",
};

type LifecycleAction = "START" | "STOP" | "RESTART";

const LIFECYCLE_TOAST: Record<LifecycleAction, string> = {
  START: "Producto iniciado",
  STOP: "Producto detenido",
  RESTART: "Producto reiniciando…",
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
      {children}
    </span>
  );
}

function QuickFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{children}</div>
    </div>
  );
}

export function ProductWorkspace({
  productId,
  pane,
  onBack,
  onChanged,
}: {
  productId: string;
  pane?: React.ReactNode;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { detail, loading, refresh } = useProductDetail(productId, 4000);
  const [acting, setActing] = useState<LifecycleAction | null>(null);
  const [healthRefreshing, setHealthRefreshing] = useState<boolean>(false);
  const [uninstallOpen, setUninstallOpen] = useState<boolean>(false);

  const isBusy = detail ? BUSY_STATES.includes(detail.state) : false;

  const lifecycle = async (action: LifecycleAction) => {
    setActing(action);
    try {
      await api(`/api/products/${productId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      toast.success(LIFECYCLE_TOAST[action]);
      await refresh();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else if (e instanceof ApiError) {
        toast.error(e.userMessage ?? e.message);
      } else {
        toast.error("No se pudo ejecutar la acción");
      }
    } finally {
      setActing(null);
    }
  };

  const runHealthChecks = async () => {
    setHealthRefreshing(true);
    try {
      await api(`/api/products/${productId}/health`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "PRODUCT_BUSY") {
        toast.warning("Hay una operación en curso");
      } else if (e instanceof ApiError) {
        toast.error(e.userMessage ?? e.message);
      } else {
        toast.error("No se pudo verificar la salud");
      }
    } finally {
      setHealthRefreshing(false);
    }
  };

  // ── Cargando ──
  if (!detail && loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span className="size-2 animate-pulse rounded-full bg-amber-400" />
          Cargando workspace…
        </div>
      </div>
    );
  }

  // ── No instalado ──
  if (!detail) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-xl border-zinc-800 bg-zinc-900">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-800">
              <PackageX className="size-6 text-zinc-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Este producto no está instalado</p>
              <p className="mt-1 text-xs text-zinc-500">Vuelve al Launcher para instalarlo desde el catálogo.</p>
            </div>
            <Button onClick={onBack} className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600">
              <ArrowLeft className="size-4" />
              Volver
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const d: ProductDetail = detail;
  const running = d.state === "RUNNING";

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* ── Cabecera sticky ── */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Volver al Launcher</span>
            <span className="sr-only">Volver al Launcher</span>
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
              <Package className="size-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-base font-bold tracking-tight text-zinc-50">{d.displayName}</h1>
                <StatusBadge state={d.state} health={d.health} />
                {d.certified ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-bold tracking-wide text-emerald-400"
                  >
                    ALBRA CERTIFIED
                  </Badge>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Chip>v{d.version}</Chip>
                {d.port !== null ? <Chip>puerto :{d.port}</Chip> : null}
                <Chip>{d.vendor}</Chip>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!running && !isBusy ? (
              <Button
                size="sm"
                onClick={() => void lifecycle("START")}
                disabled={acting !== null}
                className="bg-emerald-500 font-bold text-zinc-950 hover:bg-emerald-600"
              >
                {acting === "START" ? (
                  <span className="size-2 animate-pulse rounded-full bg-amber-950" />
                ) : (
                  <Play className="size-4" />
                )}
                INICIAR
              </Button>
            ) : null}
            {running ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void lifecycle("STOP")}
                  disabled={acting !== null || isBusy}
                  className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
                >
                  <Square className="size-4" />
                  DETENER
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void lifecycle("RESTART")}
                  disabled={acting !== null || isBusy}
                  className="border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50"
                >
                  <RotateCcw className="size-4" />
                  REINICIAR
                </Button>
              </>
            ) : null}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700 bg-zinc-800/60 px-2 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50"
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-zinc-800 bg-zinc-900 text-zinc-100"
              >
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuItem
                  onClick={() => setUninstallOpen(true)}
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                >
                  <Trash2 className="size-4" />
                  Desinstalar…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ── Operación en curso ── */}
      {isBusy ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-300">
          <Power className="size-4" />
          <AlertTitle className="text-amber-300">Operación en curso</AlertTitle>
          <AlertDescription className="text-amber-300/80">
            Operación en curso: {BUSY_LABEL[d.state] ?? d.state}… Las acciones del ciclo de vida están deshabilitadas
            hasta que termine.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ── Pestañas ── */}
      <Tabs defaultValue="resumen">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
          <TabsTrigger value="resumen" className="shrink-0 data-[state=active]:bg-zinc-800">
            Resumen
          </TabsTrigger>
          <TabsTrigger value="producto" className="shrink-0 data-[state=active]:bg-zinc-800">
            Producto
          </TabsTrigger>
          <TabsTrigger value="actualizar" className="shrink-0 data-[state=active]:bg-zinc-800">
            Actualizar
            {d.updates.length > 0 ? (
              <span className="ml-1 size-1.5 rounded-full bg-amber-400" title="Actualización disponible" />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="copias" className="shrink-0 data-[state=active]:bg-zinc-800">
            Copias
          </TabsTrigger>
          <TabsTrigger value="diagnostico" className="shrink-0 data-[state=active]:bg-zinc-800">
            Diagnóstico
          </TabsTrigger>
          <TabsTrigger value="registros" className="shrink-0 data-[state=active]:bg-zinc-800">
            Registros
          </TabsTrigger>
          <TabsTrigger value="ciclo" className="shrink-0 data-[state=active]:bg-zinc-800">
            Ciclo de vida
          </TabsTrigger>
          <TabsTrigger value="configuracion" className="shrink-0 data-[state=active]:bg-zinc-800">
            Configuración
          </TabsTrigger>
        </TabsList>

        {/* ── Resumen ── */}
        <TabsContent value="resumen" className="mt-4 space-y-4">
          <HealthChecks
            checks={d.checks}
            overall={d.health}
            onRefresh={() => void runHealthChecks()}
            refreshing={healthRefreshing}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickFact label="Versión">v{d.version}</QuickFact>
            <QuickFact label="Puerto">{d.port !== null ? `:${d.port}` : "—"}</QuickFact>
            <QuickFact label="Instalado">{fmtDate(d.installedAt)}</QuickFact>
            <QuickFact label="Último health">{fmtDate(d.lastHealthAt)}</QuickFact>
            <QuickFact label="Runtime">
              <span className="font-mono text-xs">{d.runtimeHandle ?? "—"}</span>
            </QuickFact>
            <QuickFact label="Fabricante">{d.vendor}</QuickFact>
          </div>
        </TabsContent>

        {/* ── Producto (pane del producto) ── */}
        <TabsContent value="producto" className="mt-4">
          {running ? (
            pane
          ) : (
            <Card className="mx-auto max-w-md rounded-xl border-zinc-800 bg-zinc-900">
              <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-800">
                  <PowerOff className="size-6 text-zinc-500" />
                </div>
                <p className="text-sm font-medium text-zinc-300">
                  {d.displayName} está detenido — inícialo para usarlo
                </p>
                <Button
                  onClick={() => void lifecycle("START")}
                  disabled={acting !== null || isBusy}
                  className="bg-emerald-500 font-semibold text-zinc-950 hover:bg-emerald-600"
                >
                  <Play className="size-4" />
                  Iniciar
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Actualizar ── */}
        <TabsContent value="actualizar" className="mt-4">
          <UpdatePanel detail={d} onDone={() => { void refresh(); onChanged(); }} />
        </TabsContent>

        {/* ── Copias ── */}
        <TabsContent value="copias" className="mt-4">
          <BackupsPanel detail={d} onChanged={() => { void refresh(); onChanged(); }} />
        </TabsContent>

        {/* ── Diagnóstico ── */}
        <TabsContent value="diagnostico" className="mt-4">
          <DiagnosticsPanel
            productId={productId}
            detail={d}
            onRepaired={() => { void refresh(); onChanged(); }}
          />
        </TabsContent>

        {/* ── Registros ── */}
        <TabsContent value="registros" className="mt-4">
          <LogsPanel productId={productId} />
        </TabsContent>

        {/* ── Ciclo de vida ── */}
        <TabsContent value="ciclo" className="mt-4">
          <RunsHistory productId={productId} />
        </TabsContent>

        {/* ── Configuración ── */}
        <TabsContent value="configuracion" className="mt-4">
          <ConfigPanel detail={d} onSaved={() => { void refresh(); onChanged(); }} />
        </TabsContent>
      </Tabs>

      <UninstallDialog
        open={uninstallOpen}
        onOpenChange={setUninstallOpen}
        productId={productId}
        displayName={d.displayName}
        onUninstalled={() => {
          void refresh();
          onChanged();
          onBack();
        }}
      />
    </div>
  );
}
