import { callTable } from "./tableApiClient";

/** What can be deleted on the server, and the table it lives in. */
export type DeletionKind = "frame" | "accessory" | "photo" | "brand" | "customer" | "prescription" | "lens";
const TABLE: Record<DeletionKind, string> = { frame: "frames", accessory: "accessories", photo: "product_images", brand: "brands", customer: "customers", prescription: "prescriptions", lens: "lenses" };

/**
 * What asking the server to delete something came to.
 *   ok          the server no longer has it (it deleted it, or never had it: `alreadyGone`)
 *   !ok         it still has it, or we could not tell; `stopAll` says the cause is the same for any other deletion too
 *               (no connection, a refused key, a missing setting, a failing server), so asking again now is pointless.
 */
export type ServerDeleteOutcome = { ok: true; alreadyGone: boolean; warning?: string } | { ok: false; reason: string; stopAll: boolean };

/**
 * POST <server.url>/api/table/frames|accessories|product_images|brands|customers|prescriptions|lenses?action=delete with { "id": "<id>" } and the shop's tenant key.
 * The server deletes the row and, for a frame or an accessory, its photo rows and the files of its photos (a photo row's own file
 * too). Deleting what is not there is not an error (count 0). Never throws.
 */
export async function deleteOnServer(kind: DeletionKind, id: string): Promise<ServerDeleteOutcome> {
  const result = await callTable(TABLE[kind], "delete", { id: kind === "photo" ? id.toLowerCase() : id });
  if (result.ok) return { ok: true, alreadyGone: result.body.count === 0, ...(result.warning ? { warning: result.warning } : {}) };
  return { ok: false, reason: result.reason, stopAll: result.stopAll };
}
