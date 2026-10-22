"use client";

/**
 * ALBRA — Cabecera «Ejecución real»: evidencia de proceso REAL del SO.
 *
 * Muestra qué verificó la plataforma por última vez y con qué evidencia
 * (PID real, puerto en escucha, uptime, identidad, /health autenticado).
 * Sección 3.3 del prompt maestro: la interfaz debe mostrar cuándo se
 * comprobó el estado por última vez y con qué evidencia.
 *
 * Datos: campo `runtime` (RuntimeEvidenceDTO) del GET /api/products/[id]
 * + lastExitEvidence persistida (p.ej. UNEXPECTED_EXIT). Refresca al montar
 * y cada 15s SOLO mientras el panel está montado (cleanup en el efecto).
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { api, fmtDate } from "@/hooks/use-albra";
import type {
  ExitEvidenceDTO,
  ProductDetail,
  RuntimeEvidenceDTO,
  RuntimeOsStateDTO,
} from "@/lib/albra/api-types";

const REFRESH_MS = 15_000;

interface EvidencePayload {
  runtime: RuntimeEvidenceDTO | null;
  exit: ExitEvidenceDTO | null;
  readAt: string;
}

/** Lectura de evidencia real: GET /api/products/[id] (runtime + última salida). */
async function fetchEvidence(productId: string): Promise<EvidencePayload> {
  const data = await api<ProductDetail>(`/api/products/${productId}`);
  return {
    runtime: data.runtime ?? null,
    exit: data.lastExitEvidence ?? null,
    readAt: new Date().toISOString(),
  };
}

const OS_STATE_META: Record<RuntimeOsStateDTO, { label: string; className: string }> = {
  RUNNING: { label: "Proceso vivo", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  ORPHAN_RUNNING: { label: "Huérfano vivo", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  CRASHED: { label: "Terminado", className: "border-red-500/40 bg-red-500/10 text-red-400" },
  EXITED_CLEAN: { label: "Salida ordenada", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
  LOST: { label: "Evidencia perdida", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  STOPPED: { label: "Detenido", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
  UNKNOWN: { label: "Sin verificar", className: "border-zinc-700 bg-zinc-800 text-zinc-400" },
};

const EXIT_LABEL: Record<string, string> = {
  UNEXPECTED_EXIT: "Terminación inesperada",
  GRACEFUL_STOP: "Detención ordenada",
  FORCED_STOP: "Detención forzada",
  GRACEFUL_EXIT: "Salida ordenada",
  START_FAILED: "Fallo de arranque",
  LOST: "Evidencia de ejecución perdida",
};

/** "corriendo 12m 34s" a partir de uptimeS. */
function formatUptime(s?: number): string {
  if (s == null || s < 0) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function trimText(v: string | undefined, max: number): string {
  const t = (v ?? "").trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="mt-1 text-sm font-semibold text-zinc-100">{children}</div>
    </div>
  );
}

export function RuntimeEvidencePanel({
  productId,
  detail,
}: {
  productId: string;
  detail: ProductDetail;
}) {
  const [runtime, setRuntime] = useState<RuntimeEvidenceDTO | null>(detail.runtime ?? null);
  const [exitEvidence, setExitEvidence] = useState<ExitEvidenceDTO | null>(detail.lastExitEvidence ?? null);
  const [readAt, setReadAt] = useState<string | null>(null);

  const apply = useCallback((p: EvidencePayload) => {
    setRuntime(p.runtime);
    setExitEvidence(p.exit);
    setReadAt(p.readAt);
  }, []);

  // Refresco ligero (15s) SOLO mientras el panel está montado.
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      void fetchEvidence(productId)
        .then(p => {
          if (!cancelled) apply(p);
        })
        .catch(() => undefined);
    };
    pull();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") pull();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [productId, apply]);

  const rt = runtime ?? detail.runtime ?? null;
  const exit = exitEvidence ?? detail.lastExitEvidence ?? null;
  const running = rt?.osState === "RUNNING" || rt?.osState === "ORPHAN_RUNNING";
  const crashed = rt?.osState === "CRASHED" || exit?.type === "UNEXPECTED_EXIT";
  const errTail = trimText(exit?.errTail ?? rt?.errLogTail, 200);
  const stateMeta = OS_STATE_META[rt?.osState ?? "UNKNOWN"] ?? OS_STATE_META.UNKNOWN;
  const probe = rt?.healthProbe;

  return (
    <section
      aria-label="Evidencia de ejecución real"
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5"
    >
      {/* Cabecera */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="size-5 shrink-0 text-emerald-400" aria-hidden />
          <h3 className="text-sm font-semibold text-zinc-100">Ejecución real</h3>
          <Badge variant="outline" className={stateMeta.className}>
            {stateMeta.label}
          </Badge>
        </div>
        <span className="text-[11px] text-zinc-500">
          Evidencia del sistema operativo · {readAt ? `verificada ${fmtDate(readAt)}` : "verificando…"}
        </span>
      </div>

      {/* Estado del proceso en una línea */}
      <p className="mt-2 text-xs text-zinc-500">
        {rt?.osState === "RUNNING" && rt.identityVerified
          ? `Proceso real vivo con identidad verificada (PID ${rt.pid}) en el sistema operativo.`
          : rt?.osState === "RUNNING"
            ? "Proceso real vivo en el sistema operativo; identidad pendiente de verificación."
            : rt?.osState === "ORPHAN_RUNNING"
              ? "Proceso vivo no registrado por la plataforma; será adoptado automáticamente."
              : rt?.osState === "CRASHED"
                ? "El proceso dejó de ejecutarse sin una salida ordenada registrada."
                : rt?.osState === "EXITED_CLEAN"
                  ? `El proceso terminó de forma ordenada${rt.exitReason ? ` (${rt.exitReason})` : ""}.`
                  : rt?.osState === "LOST"
                    ? "La plataforma perdió la evidencia del proceso (sin pidfile ni proceso vivo)."
                    : "No hay proceso real en ejecución para este producto."}
      </p>

      {rt?.osState === "ORPHAN_RUNNING" ? (
        <p className="mt-2 text-xs text-amber-400">
          Huérfano: el proceso sobrevivió al INSTALADOR y será adoptado en la próxima reconciliación.
        </p>
      ) : null}

      {/* Hechos verificados */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="PID real">
          <span className="font-mono">{rt?.pid ?? "—"}</span>
        </Fact>
        <Fact label="Identidad">
          {rt?.identityVerified ? (
            <span className="text-emerald-400">Verificada ✓</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Fact>
        <Fact label="Puerto">
          {rt?.port != null ? (
            <span className="font-mono">
              :{rt.port}
              {rt.portServing === true ? (
                <span className="ml-1 font-sans text-xs font-medium text-emerald-400">en escucha</span>
              ) : rt.portServing === false ? (
                <span className="ml-1 font-sans text-xs font-medium text-red-400">sin servicio</span>
              ) : null}
            </span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Fact>
        <Fact label="Uptime">
          {running ? (
            <span className="text-emerald-400">corriendo {formatUptime(rt?.uptimeS)}</span>
          ) : (
            <span className="text-zinc-500">detenido</span>
          )}
          {rt?.lastHeartbeatAt ? (
            <span className="mt-0.5 block truncate text-[10px] font-normal text-zinc-500">
              heartbeat {fmtDate(rt.lastHeartbeatAt)}
            </span>
          ) : null}
        </Fact>
        <Fact label="Health autenticado">
          {probe ? (
            probe.ok ? (
              <span className="text-emerald-400">
                200 OK{probe.latencyMs != null ? ` · ${probe.latencyMs}ms` : ""}
              </span>
            ) : (
              <span className="text-red-400" title={probe.error ?? undefined}>
                Fallo{probe.error ? `: ${trimText(probe.error, 60)}` : ""}
              </span>
            )
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </Fact>
        <Fact label="Última comprobación">
          <span className="text-zinc-300">{fmtDate(detail.lastHealthAt)}</span>
        </Fact>
      </div>

      {/* Terminación inesperada: alerta destructiva con detalle técnico */}
      {crashed ? (
        <Alert className="mt-3 border-red-500/40 bg-red-500/10 text-red-300 [&>svg]:text-red-400">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle className="text-red-300">Terminación inesperada — ver logs</AlertTitle>
          <AlertDescription className="text-red-300/80">
            El proceso
            {exit?.pid ?? rt?.pid ? ` (PID ${exit?.pid ?? rt?.pid})` : ""} dejó de ejecutarse sin una salida
            ordenada registrada
            {exit?.at ? ` el ${fmtDate(exit.at)}` : ""}. Revisa la pestaña «Registros» para el detalle completo.
            {errTail ? (
              <div className="mt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-300/70">
                  Detalle técnico
                </p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-red-500/20 bg-zinc-950 p-2 font-mono text-[10px] leading-relaxed text-zinc-300">
                  {errTail}
                </pre>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : exit ? (
        <p className="mt-3 text-xs text-zinc-500">
          Última salida: {EXIT_LABEL[exit.type] ?? exit.type}
          {exit.reason || exit.evidence ? ` — ${trimText(exit.reason ?? exit.evidence, 120)}` : ""}
        </p>
      ) : null}
    </section>
  );
}
