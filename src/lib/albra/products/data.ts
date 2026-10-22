/**
 * ALBRA — Product data access (isolation boundary).
 * Cada producto opera SOLO sobre sus propias tablas. Ningún producto
 * toca datos de otro. Usado por Installer (seeds), Backup/Restore,
 * Update (migraciones) y Uninstall (modos de datos).
 */
import { db } from "@/lib/db";
import { CRM_SEEDS, LEADS_SEEDS } from "@/lib/albra/products/catalog";

export interface ProductDataSnapshot {
  contacts?: unknown[];
  deals?: unknown[];
  leads?: unknown[];
  schemaVersion?: number;
}

export async function seedProductData(productId: string): Promise<number> {
  let count = 0;
  if (productId === "crm") {
    const existing = await db.crmContact.count();
    if (existing === 0) {
      await db.crmContact.createMany({ data: CRM_SEEDS.contacts.map(c => ({ ...c })) });
      count += CRM_SEEDS.contacts.length;
    }
    const existingDeals = await db.crmDeal.count();
    if (existingDeals === 0) {
      const contacts = await db.crmContact.findMany({ select: { id: true, name: true } });
      const byName = new Map(contacts.map(c => [c.name, c.id]));
      await db.crmDeal.createMany({
        data: CRM_SEEDS.deals.map(d => ({ title: d.title, value: d.value, stage: d.stage, contactId: byName.get(d.contactName) ?? null })),
      });
      count += CRM_SEEDS.deals.length;
    }
  } else if (productId === "leads") {
    const existing = await db.leadRecord.count();
    if (existing === 0) {
      await db.leadRecord.createMany({ data: LEADS_SEEDS.leads.map(l => ({ ...l })) });
      count += LEADS_SEEDS.leads.length;
    }
  }
  return count;
}

export async function exportProductData(productId: string): Promise<ProductDataSnapshot> {
  if (productId === "crm") {
    const [contacts, deals, meta] = await Promise.all([
      db.crmContact.findMany({ orderBy: { createdAt: "asc" } }),
      db.crmDeal.findMany({ orderBy: { createdAt: "asc" } }),
      getProductMeta(productId),
    ]);
    return { contacts, deals, schemaVersion: meta.schemaVersion };
  }
  if (productId === "leads") {
    const [leads, meta] = await Promise.all([
      db.leadRecord.findMany({ orderBy: { createdAt: "asc" } }),
      getProductMeta(productId),
    ]);
    return { leads, schemaVersion: meta.schemaVersion };
  }
  return {};
}

export async function importProductData(productId: string, snapshot: ProductDataSnapshot): Promise<void> {
  await clearProductData(productId);
  if (productId === "crm") {
    const contacts = (snapshot.contacts ?? []) as Array<{ id?: string; name: string; email?: string | null; phone?: string | null; company?: string | null; tags?: string | null; createdAt?: string }>;
    for (const c of contacts) {
      await db.crmContact.create({
        data: { name: c.name, email: c.email ?? null, phone: c.phone ?? null, company: c.company ?? null, tags: c.tags ?? null, ...(c.createdAt ? { createdAt: new Date(c.createdAt) } : {}) },
      });
    }
    const deals = (snapshot.deals ?? []) as Array<{ title: string; contactId?: string | null; value?: number; stage?: string; createdAt?: string }>;
    for (const d of deals) {
      await db.crmDeal.create({
        data: { title: d.title, contactId: d.contactId ?? null, value: d.value ?? 0, stage: d.stage ?? "NUEVO", ...(d.createdAt ? { createdAt: new Date(d.createdAt) } : {}) },
      });
    }
  } else if (productId === "leads") {
    const leads = (snapshot.leads ?? []) as Array<{ name: string; company?: string | null; source?: string; status?: string; score?: number; createdAt?: string }>;
    for (const l of leads) {
      await db.leadRecord.create({
        data: { name: l.name, company: l.company ?? null, source: l.source ?? "WEB", status: l.status ?? "NUEVO", score: l.score ?? 0, ...(l.createdAt ? { createdAt: new Date(l.createdAt) } : {}) },
      });
    }
  }
  await setProductMeta(productId, { schemaVersion: snapshot.schemaVersion ?? 1 });
}

export async function clearProductData(productId: string): Promise<void> {
  if (productId === "crm") {
    await db.crmDeal.deleteMany({});
    await db.crmContact.deleteMany({});
  } else if (productId === "leads") {
    await db.leadRecord.deleteMany({});
  }
}

export async function getProductMeta(productId: string): Promise<{ schemaVersion: number }> {
  const row = await db.configRecord.findUnique({ where: { productId_scope: { productId, scope: "PRODUCT" } } });
  const values = (row?.values ?? {}) as { schemaVersion?: number };
  return { schemaVersion: values.schemaVersion ?? 1 };
}

export async function setProductMeta(productId: string, meta: { schemaVersion?: number }): Promise<void> {
  const current = await db.configRecord.findUnique({ where: { productId_scope: { productId, scope: "PRODUCT" } } });
  const values = { ...((current?.values ?? {}) as Record<string, unknown>), ...meta };
  await db.configRecord.upsert({
    where: { productId_scope: { productId, scope: "PRODUCT" } },
    create: { productId, scope: "PRODUCT", values },
    update: { values },
  });
}
