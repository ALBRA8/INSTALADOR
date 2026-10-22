"use client";
/**
 * ALBRA — Hooks de cliente para la API de la plataforma.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AuditDTO, CatalogItem, CertificationDTO, LifecycleRunDTO, ProductDetail, SystemInfoDTO,
} from "@/lib/albra/api-types";

export class ApiError extends Error {
  code: string;
  userMessage?: string;
  status: number;
  constructor(status: number, code: string, message: string, userMessage?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.userMessage = userMessage;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; userMessage?: string } })?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Error ${res.status}`, err?.userMessage);
  }
  return body as T;
}

/** Catálogo del Launcher con auto-refresh. */
export function useCatalog(pollMs = 6000) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ products: CatalogItem[] }>("/api/catalog");
      setItems(data.products);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (pollMs <= 0) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { items, loading, error, refresh };
}

/** Detalle de producto con auto-refresh. */
export function useProductDetail(productId: string | null, pollMs = 5000) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!productId) return;
    try {
      const data = await api<ProductDetail>(`/api/products/${productId}`);
      setDetail(data);
    } catch {
      // producto no instalado todavía
    }
  }, [productId]);

  useEffect(() => {
    void (async () => {
      if (!productId) {
        setDetail(null);
        return;
      }
      setLoading(true);
      await refresh();
      setLoading(false);
    })();
    if (pollMs <= 0) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => clearInterval(t);
  }, [productId, refresh, pollMs]);

  return { detail, loading, refresh };
}

/** Polling de un run hasta que finaliza. */
export function useRunPolling(runId: string | null, onUpdate?: (run: LifecycleRunDTO) => void, onFinished?: (run: LifecycleRunDTO) => void) {
  const [run, setRun] = useState<LifecycleRunDTO | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
    onFinishedRef.current = onFinished;
  });

  useEffect(() => {
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const data = await api<LifecycleRunDTO>(`/api/runs/${runId}`);
        if (stopped) return;
        setRun(data);
        onUpdateRef.current?.(data);
        if (data.finishedAt) {
          onFinishedRef.current?.(data);
          return; // stop polling
        }
        setTimeout(tick, 450);
      } catch {
        if (!stopped) setTimeout(tick, 900);
      }
    };
    void (async () => {
      if (!runId) {
        setRun(null);
        return;
      }
      await tick();
    })();
    return () => {
      stopped = true;
    };
  }, [runId]);

  return run;
}

export function useSystemInfo() {
  const [info, setInfo] = useState<SystemInfoDTO | null>(null);
  useEffect(() => {
    void api<SystemInfoDTO>("/api/system").then(setInfo).catch(() => undefined);
  }, []);
  return info;
}

export async function fetchRecentRuns(limit = 8): Promise<LifecycleRunDTO[]> {
  const data = await api<{ runs: LifecycleRunDTO[] }>(`/api/runs?limit=${limit}`);
  return data.runs;
}

export async function fetchRecentAudit(limit = 12): Promise<AuditDTO[]> {
  const data = await api<{ events: AuditDTO[] }>(`/api/audit?limit=${limit}`);
  return data.events;
}

export async function fetchCertification(productId = "crm"): Promise<CertificationDTO | null> {
  const data = await api<{ certification: CertificationDTO | null }>(`/api/certification?productId=${productId}`);
  return data.certification;
}

export function fmtDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "medium" });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
