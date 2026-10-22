'use client'

import { useCallback, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import {
  Boxes, ScrollText, ShieldCheck, RefreshCcw, FileText, Cpu, Activity, Rocket,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ProductCard } from "@/components/albra/product-card"
import { InstallWizard } from "@/components/albra/install-wizard"
import { ActivityFeed } from "@/components/albra/activity-feed"
import { SystemDialog } from "@/components/albra/system-dialog"
import { VaultDialog } from "@/components/albra/vault-dialog"
import { AuditDialog } from "@/components/albra/audit-dialog"
import { CertificationDialog } from "@/components/albra/certification-dialog"
import { CleanroomDialog } from "@/components/albra/cleanroom-dialog"
import { ReportsDialog } from "@/components/albra/reports-dialog"
import { LockedProductDialog } from "@/components/albra/locked-product-dialog"
import { ProductWorkspace } from "@/components/albra/workspace/product-workspace"
import { CrmPane } from "@/components/crm/crm-pane"
import { LeadsPane } from "@/components/leads/leads-pane"
import { useCatalog, api, fetchRecentRuns, fetchRecentAudit, type ApiError } from "@/hooks/use-albra"
import type { AuditDTO, CatalogItem, LifecycleRunDTO } from "@/lib/albra/api-types"

export default function Home() {
  const { items, loading, refresh } = useCatalog(6000)
  const [runs, setRuns] = useState<LifecycleRunDTO[]>([])
  const [audits, setAudits] = useState<AuditDTO[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [wizardItem, setWizardItem] = useState<CatalogItem | null>(null)
  const [lockedItem, setLockedItem] = useState<CatalogItem | null>(null)
  const [systemOpen, setSystemOpen] = useState(false)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [certOpen, setCertOpen] = useState(false)
  const [cleanOpen, setCleanOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

  const loadFeed = useCallback(async () => {
    try {
      const [r, a] = await Promise.all([fetchRecentRuns(8), fetchRecentAudit(12)])
      setRuns(r)
      setAudits(a)
    } catch {
      // feed no crítico
    } finally {
      setFeedLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFeed()
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadFeed()
    }, 8000)
    return () => clearInterval(t)
  }, [loadFeed])

  const refreshAll = useCallback(() => {
    void refresh()
    void loadFeed()
  }, [refresh, loadFeed])

  const handleLifecycle = useCallback(async (item: CatalogItem, action: "START" | "STOP") => {
    try {
      const res = await api<{ ok: boolean; port?: number }>(`/api/products/${item.productId}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        const msg = action === "START" ? `${item.displayName} funcionando${res.port ? ` (puerto ${res.port})` : ""}` : `${item.displayName} detenido`
        // El feedback del estado lo da el polling del catálogo; toast informativo:
        import("sonner").then(({ toast }) => toast.success(msg))
      }
    } catch (e) {
      const err = e as ApiError
      import("sonner").then(({ toast }) => toast.error(err.userMessage ?? err.message))
    } finally {
      refreshAll()
    }
  }, [refreshAll])

  const selectedItem = useMemo(() => items.find(i => i.productId === selected) ?? null, [items, selected])

  const renderPane = useCallback((productId: string) => {
    const item = items.find(i => i.productId === productId)
    const running = item?.state === "RUNNING"
    if (productId === "crm") {
      return <CrmPane productId={productId} running={running} version={item?.installedVersion ?? "1.0.0"} />
    }
    if (productId === "leads") {
      return <LeadsPane productId={productId} running={running} />
    }
    return undefined
  }, [items])

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex items-center gap-3 min-w-0">
          <Image src="/albra-logo.png" alt="Logotipo de ALBRA" width={40} height={40} className="rounded-lg border border-zinc-800" priority />
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-semibold tracking-tight leading-tight">ALBRA <span className="text-zinc-500 font-normal">Platform</span></h1>
            <p className="text-[11px] sm:text-xs text-zinc-500 leading-tight truncate">Deployment &amp; Lifecycle System · V1.0</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 overflow-x-auto">
            <Button variant="ghost" size="sm" onClick={() => setVaultOpen(true)} aria-label="Bóveda de paquetes">
              <Boxes className="size-4" /><span className="hidden md:inline">Bóveda</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAuditOpen(true)} aria-label="Auditoría">
              <ScrollText className="size-4" /><span className="hidden md:inline">Auditoría</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReportsOpen(true)} aria-label="Reportes">
              <FileText className="size-4" /><span className="hidden md:inline">Reportes</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCertOpen(true)} aria-label="Certificación">
              <ShieldCheck className="size-4" /><span className="hidden md:inline">Certificación</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCleanOpen(true)} aria-label="Clean-room">
              <RefreshCcw className="size-4" /><span className="hidden md:inline">Clean-room</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSystemOpen(true)} aria-label="Sistema">
              <Cpu className="size-4" /><span className="hidden md:inline">Sistema</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">
        {selected ? (
          <ProductWorkspace
            productId={selected}
            pane={renderPane(selected)}
            onBack={() => setSelected(null)}
            onChanged={refreshAll}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section aria-label="Mis productos">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                    <Rocket className="size-4 text-emerald-500" aria-hidden /> Mis productos
                  </h2>
                  <p className="text-xs text-zinc-500">Instala, abre y gestiona los productos de tu ecosistema ALBRA. Cada producto es independiente.</p>
                </div>
                <Badge variant="outline" className="shrink-0 border-zinc-800 text-zinc-400">
                  <Activity className="size-3 mr-1" aria-hidden /> {items.filter(i => i.state === "RUNNING").length} activos
                </Badge>
              </div>
              {loading ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-44 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {items.map(item => (
                    <ProductCard
                      key={item.productId}
                      item={item}
                      busy={item.busy}
                      onInstall={() => setWizardItem(item)}
                      onOpen={() => setSelected(item.productId)}
                      onStart={() => void handleLifecycle(item, "START")}
                      onStop={() => void handleLifecycle(item, "STOP")}
                      onLockedInfo={() => setLockedItem(item)}
                      onUpdate={() => setSelected(item.productId)}
                    />
                  ))}
                </div>
              )}
            </section>
            <aside className="min-w-0">
              <ActivityFeed runs={runs} audits={audits} loading={feedLoading} />
              <Separator className="my-4 bg-zinc-800" />
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                ALBRA nunca te pedirá abrir una terminal. Las instalaciones son transaccionales, los paquetes se
                verifican con hash + firma, y cada operación queda registrada en la auditoría.
              </p>
            </aside>
          </div>
        )}
      </main>

      {/* Footer — sticky bottom */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-500">
          <p>ALBRA Deployment &amp; Lifecycle System V1.0 · Adapter local activo</p>
          <p className="font-mono">INSTALL · CONFIGURE · START · HEALTH · UPDATE · ROLLBACK · DIAGNOSTICS · REPAIR · UNINSTALL</p>
        </div>
      </footer>

      {/* Dialogs */}
      <InstallWizard
        open={wizardItem !== null}
        onOpenChange={v => { if (!v) setWizardItem(null) }}
        item={wizardItem}
        onInstalled={() => { setWizardItem(null); refreshAll() }}
      />
      <SystemDialog open={systemOpen} onOpenChange={setSystemOpen} />
      <VaultDialog open={vaultOpen} onOpenChange={setVaultOpen} />
      <AuditDialog open={auditOpen} onOpenChange={setAuditOpen} />
      <CertificationDialog open={certOpen} onOpenChange={setCertOpen} onFinished={refreshAll} />
      <CleanroomDialog open={cleanOpen} onOpenChange={setCleanOpen} onDone={() => { setSelected(null); refreshAll() }} />
      <ReportsDialog open={reportsOpen} onOpenChange={setReportsOpen} />
      <LockedProductDialog open={lockedItem !== null} onOpenChange={v => { if (!v) setLockedItem(null) }} item={lockedItem} />
    </div>
  )
}
