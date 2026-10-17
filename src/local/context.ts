import { getApiConfig } from "../config";
import { sqlitePrisma } from "../lib/sqliteClient";

let ensuredTenant: string | undefined;

/**
 * The tenant every local query is scoped to — the key from config.properties — making sure the
 * local `tenants` row it points at exists (every tenant-owned table has a foreign key to it, and
 * the backend never sends tenants down). Done once per key per run.
 */
export async function currentTenantKey(): Promise<string> {
  const { tenantKey } = getApiConfig();
  if (ensuredTenant !== tenantKey) {
    await sqlitePrisma.tenant.upsert({
      where: { key: tenantKey },
      create: { key: tenantKey, host: `local:${tenantKey}`, name: tenantKey },
      update: {},
    });
    ensuredTenant = tenantKey;
  }
  return tenantKey;
}
