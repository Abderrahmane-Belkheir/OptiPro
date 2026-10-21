import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { imagesDir } from "../lib/appData";
import { sqlitePrisma } from "../lib/sqliteClient";
import { ImageUploadError, PRODUCT_TYPES, localImageService, photoUrl, sniffContentType, type ProductType } from "./imageService";
import { currentTenantKey } from "./context";
import { syncFlag } from "./sync";

const EXTENSION_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Moves a file; across drives (where a plain rename is refused) it copies and then removes the original. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.copyFile(from, to);
    try {
      await fs.unlink(from);
    } catch (unlinkErr) {
      // The photo is stored; only the original could not be removed. Not worth failing over.
      console.warn(`photo stored, but the original ${from} could not be removed:`, (unlinkErr as Error).message);
    }
  }
}

/** The photo files in the app's images folder: photo id -> full path. Empty when the folder does not exist yet. */
export async function localPhotoFiles(): Promise<Map<string, string>> {
  const folder = imagesDir();
  const files = new Map<string, string>();
  try {
    for (const name of await fs.readdir(folder)) {
      const id = name.replace(/\.(png|jpg|gif|webp)$/i, "");
      if (id !== name) files.set(id.toLowerCase(), path.join(folder, name));
    }
  } catch {
    // no images folder yet: no local photos
  }
  return files;
}

/**
 * The address a photo is shown from. A photo that is on this computer is shown from its local file, whether
 * or not it has been sent to the server (a photo that is not synced is not on the server yet); otherwise from
 * the server (`server.url` + /api/images/<id>), which throws ConfigError when `server.url` is missing.
 */
export function photoAddress(photoId: string, localFiles: Map<string, string>): string {
  const local = localFiles.get(photoId.toLowerCase());
  return local ? pathToFileURL(local).href : photoUrl(photoId);
}

/**
 * Saves a photo given as bytes for a frame or accessory: makes up its id (a UUID), inserts its row into the
 * local product_images table, and only then writes the bytes to the app's images folder as <id>.<type>. If
 * the write fails the row is taken back, so a row never points at a missing file. Throws on failure.
 * Returns the photo's id.
 */
export async function savePhotoBytes(type: ProductType, productId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const extension = EXTENSION_BY_TYPE[contentType];
  if (!extension) throw new Error(`Unsupported image type ${contentType}.`);
  const id = randomUUID();
  await sqlitePrisma.productImage.create({ data: type === "frame" ? { id, frameId: productId } : { id, accessoryId: productId } });
  const folder = imagesDir();
  const target = path.join(folder, `${id}.${extension}`);
  try {
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" });
  } catch (err) {
    await fs.rm(target, { force: true }).catch(() => {});
    await sqlitePrisma.productImage.deleteMany({ where: { id } }).catch(() => {});
    throw err;
  }
  return id;
}

/** What uploading one photo came to. `stopAll`: the cause is the same for every photo (no connection, wrong key, no server address, ...). */
export type PhotoUploadOutcome = { ok: true } | { ok: false; reason: string; stopAll: boolean; silent?: boolean };

/** Why a failed upload says nothing about the other photos' chances, or does: no connection, a refused key, a missing setting, a failing server. */
function failureAffectsAllPhotos(err: unknown): boolean {
  if (err instanceof Error && err.name === "ConfigError") return true;
  return err instanceof ImageUploadError && ["offline", "timeout", "unauthorized", "rate-limited", "server"].includes(err.kind);
}

async function uploadOne(photoId: string): Promise<PhotoUploadOutcome> {
  if (typeof photoId !== "string" || !photoId) return { ok: false, reason: "no photo id", stopAll: false, silent: true };
  const id = photoId.toLowerCase();

  const row = await sqlitePrisma.productImage.findUnique({ where: { id } }).catch(() => null);
  if (!row) return { ok: false, reason: "no such photo", stopAll: false, silent: true };
  if (row.synced) return { ok: true };
  const type: ProductType | null = row.frameId ? "frame" : row.accessoryId ? "accessory" : null;
  const productId = row.frameId ?? row.accessoryId;
  if (!type || !productId) return { ok: false, reason: "it belongs to no frame or accessory", stopAll: false, silent: true };

  const file = (await localPhotoFiles()).get(id);
  if (!file) return { ok: false, reason: "its file is not in the images folder, nothing to upload", stopAll: false };

  try {
    await localImageService.upload(type, productId, await fs.readFile(file), id);
  } catch (err) {
    // 409: the server already has a photo with this id (an earlier upload went through but was not recorded here).
    const alreadyThere = err instanceof ImageUploadError && err.kind === "conflict" && err.details.code === "PHOTO_ID_EXISTS";
    if (!alreadyThere) return { ok: false, reason: (err as Error).message, stopAll: failureAffectsAllPhotos(err) };
  }

  try {
    await sqlitePrisma.productImage.update({ where: { id }, data: { synced: true } });
  } catch (err) {
    // It is on the server; only the mark failed. The next call gets "already exists" and marks it then.
    console.warn(`photo ${id}: uploaded, but could not be marked synced:`, (err as Error).message);
  }
  return { ok: true };
}

const PHOTO_EXTENSIONS = ["png", "jpg", "gif", "webp"];

/** Removes the files of photos from the images folder (a missing file is fine). */
export async function removePhotoFiles(photoIds: string[]): Promise<void> {
  for (const id of photoIds) for (const extension of PHOTO_EXTENSIONS) await fs.rm(path.join(imagesDir(), `${id}.${extension}`), { force: true }).catch(() => undefined);
}

/** The photo's row, as it is saved with its product: unsynced, for a frame or for an accessory. */
export function photoRowData(type: ProductType, productId: string, photoId: string) {
  return type === "frame" ? { id: photoId, frameId: productId } : { id: photoId, accessoryId: productId };
}

/**
 * Step 1 of creating or editing a product (see productEdit.ts): writes each new photo's file to the images folder under its final
 * name (<photo id>.<type>) and returns the ids. Nothing refers to the files yet: the rows are saved afterwards, together with the
 * product, in one transaction. All or nothing: if one file cannot be written the ones written before it are removed and this throws.
 */
export async function stagePhotoFiles(photos: { bytes: Uint8Array; contentType: string }[]): Promise<{ id: string }[]> {
  const staged: { id: string }[] = [];
  try {
    const folder = imagesDir();
    await fs.mkdir(folder, { recursive: true });
    for (const photo of photos) {
      const extension = EXTENSION_BY_TYPE[photo.contentType];
      if (!extension) throw new Error(`Unsupported image type ${photo.contentType}.`);
      const id = randomUUID();
      await fs.writeFile(path.join(folder, `${id}.${extension}`), photo.bytes, { flag: "wx" });
      staged.push({ id });
    }
  } catch (err) {
    await removePhotoFiles(staged.map((photo) => photo.id));
    throw err;
  }
  return staged;
}

/**
 * Removes the loose photo files: a file in the images folder that no product_images row points at and that is older than
 * `minAgeMs` (a file written a moment ago may be about to get its row). A crash between writing a file and saving its row, or between
 * deleting a row and deleting its file, leaves such a file; this runs at start-up. Resolves to how many it removed. Never throws.
 */
export async function sweepOrphanPhotoFiles(minAgeMs = 10 * 60 * 1000): Promise<number> {
  try {
    const folder = imagesDir();
    const names = await fs.readdir(folder).catch(() => [] as string[]);
    if (names.length === 0) return 0;
    const known = new Set((await sqlitePrisma.productImage.findMany({ select: { id: true } })).map((row) => row.id));
    let removed = 0;
    for (const name of names) {
      const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif|webp)$/i.exec(name);
      if (!match || known.has(match[1].toLowerCase())) continue;
      const file = path.join(folder, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs < minAgeMs) continue;
      await fs.rm(file, { force: true });
      removed += 1;
    }
    if (removed > 0) console.info(`[photos] removed ${removed} loose photo file(s) that no photo row points at`);
    return removed;
  } catch (err) {
    console.warn("[photos] could not clean up loose photo files:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/** The most photos one sync pass uploads; the rest wait for the next pass, so a pass never runs for long. */
export const MAX_PHOTOS_PER_PASS = 50;

/** Photos not on the server yet whose frame or accessory IS on the server (a photo cannot go up before its product). */
async function uploadableWhere() {
  const tenantKey = await currentTenantKey();
  return { synced: false, OR: [{ frame: { is: { synced: true, tenantKey } } }, { accessory: { is: { synced: true, tenantKey } } }] };
}

/** How many photos could be uploaded right now (local query only, no network). */
export async function countUploadablePhotos(): Promise<number> {
  return sqlitePrisma.productImage.count({ where: await uploadableWhere() });
}

export interface PhotoPushResult {
  /** Photos the server took in this pass. */
  uploaded: number;
  /** Photos that could not be uploaded (their reasons are in `errors`). */
  failed: number;
  /** Photos still waiting after this pass (failed ones, ones left over by the per-pass limit, or ones not tried after a stop). */
  remaining: number;
  /** Set when the pass stopped early because the same problem would hit every photo (no connection, wrong key, no server address, ...). */
  stoppedBecause?: string;
  errors: string[];
}

/**
 * Uploads the photos that are not synced and whose frame or accessory is synced, reading each file from the app's
 * images folder, at most MAX_PHOTOS_PER_PASS of them, one after another. A photo that fails does not stop the rest,
 * unless the cause is the same for all of them (no connection, a refused key, a missing server address, a failing
 * server): then it stops at once instead of asking the server again and again. Never throws; does nothing while
 * `syncFlag.push` is false. Called by the scheduler after the tables were pushed, so a frame that became synced in the
 * same pass has its photos uploaded in that pass.
 */
export async function pushPendingPhotos(): Promise<PhotoPushResult> {
  const result: PhotoPushResult = { uploaded: 0, failed: 0, remaining: 0, errors: [] };
  if (!syncFlag.push) return result;
  try {
    const where = await uploadableWhere();
    const waiting = await sqlitePrisma.productImage.count({ where });
    const batch = await sqlitePrisma.productImage.findMany({ where, orderBy: { id: "asc" }, take: MAX_PHOTOS_PER_PASS, select: { id: true } });
    for (const { id } of batch) {
      const outcome = await uploadOne(id);
      if (outcome.ok) result.uploaded += 1;
      else {
        result.failed += 1;
        result.errors.push(`${id}: ${outcome.reason}`);
        if (outcome.stopAll) {
          result.stoppedBecause = outcome.reason;
          break;
        }
      }
    }
    result.remaining = waiting - result.uploaded;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    result.stoppedBecause = result.errors[result.errors.length - 1];
  }
  return result;
}

export const localPhotoService = {
  /**
   * Adds the photo the user picked to a frame or an accessory. In this order:
   *   1. it makes up a unique id (a UUID) for the photo;
   *   2. it inserts a row into the local product_images table: that id, and the frame's or accessory's id
   *      (so the product must exist, the database checks it);
   *   3. only after that insert succeeded, it MOVES the file into the app's images folder
   *      (<app data>/OptiPro/images/<id>.<png|jpg|gif|webp>, the type read from the file itself).
   * Resolves to true when all of it worked, false otherwise (not an image, no such file, no such product, the
   * move failed, ...). A failed move takes the inserted row back, so a row never points at a missing file; a
   * file that was not stored is never moved.
   */
  async addPhoto(type: ProductType, productId: string, filePath: string): Promise<boolean> {
    if (!(PRODUCT_TYPES as readonly string[]).includes(type) || typeof productId !== "string" || !productId || typeof filePath !== "string" || !filePath) {
      return false;
    }

    // What the file really is (the name proves nothing).
    let extension: string;
    try {
      const handle = await fs.open(filePath, "r");
      try {
        if (!(await handle.stat()).isFile()) return false;
        const head = Buffer.alloc(16);
        const { bytesRead } = await handle.read(head, 0, 16, 0);
        const contentType = sniffContentType(head.subarray(0, bytesRead));
        if (!contentType) return false;
        extension = EXTENSION_BY_TYPE[contentType];
      } finally {
        await handle.close();
      }
    } catch {
      return false;
    }

    const id = randomUUID();
    try {
      await sqlitePrisma.productImage.create({ data: type === "frame" ? { id, frameId: productId } : { id, accessoryId: productId } });
    } catch {
      return false; // for example: this product does not exist
    }

    const folder = imagesDir();
    const target = path.join(folder, `${id}.${extension}`);
    try {
      await fs.mkdir(folder, { recursive: true });
      await moveFile(filePath, target);
    } catch (err) {
      console.warn(`photo ${id}: the file could not be moved, its row was taken back:`, (err as Error).message);
      await fs.rm(target, { force: true }).catch(() => {});
      await sqlitePrisma.productImage.deleteMany({ where: { id } }).catch(() => {});
      return false;
    }
    return true;
  },

  /**
   * Uploads the photo whose id is `photoId` (a row of the local product_images table, with its file in the
   * app's images folder) to the server, for the frame or accessory the row belongs to. The server is told
   * who the shop is by the `tenant.key` of the settings file, and stores the photo under this same id.
   * When the server has taken it the row is marked synced. Resolves to true when the photo is on the server
   * (a photo already marked synced is not sent again), false otherwise (no such photo, its file is missing,
   * no connection, the server refused it, ...; the reason is logged). Nothing is retried here: the row stays
   * unsynced, so calling it again later is safe.
   * The frame or accessory has to exist on the server already, so send it before its photos.
   */
  async uploadPhoto(photoId: string): Promise<boolean> {
    const outcome = await uploadOne(photoId);
    if (!outcome.ok && !outcome.silent) console.warn(`photo ${String(photoId).toLowerCase()}: not uploaded: ${outcome.reason}`);
    return outcome.ok;
  },
};
