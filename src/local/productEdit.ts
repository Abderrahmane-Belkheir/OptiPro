import type { Prisma } from "../generated/sqlite-client";
import { sqlitePrisma } from "../lib/sqliteClient";
import { LocalDbError } from "./errors";
import { MAX_PHOTOS, type CleanPhoto } from "./frameValidation";
import type { ProductType } from "./imageService";
import { attemptDeletion, queueDeletionIn } from "./pendingDeletions";
import { localPhotoService, photoRowData, removePhotoFiles, stagePhotoFiles } from "./photoService";
import { interactiveWaitMs, pushRow } from "./syncPush";

/**
 * The steps that creating, editing and deleting a frame and an accessory have in common (the services differ in what they
 * validate and which table they write). Each service validates first, then hands over to these.
 *
 * THE ORDER, and why. The goal: if the app is closed or crashes at ANY moment, nothing is half done, and whatever was saved here
 * reaches the cloud the next time the app runs (the sync passes work from what is saved in the local database, and every step
 * they take on the server can be repeated without harm).
 *
 *   1. FILES FIRST. The new photos' files are written to the images folder under their final names. Nothing refers to them yet, so
 *      a crash here leaves only loose files (the clean-up at start-up removes them) and no frame, no row.
 *   2. ONE LOCAL TRANSACTION. The product's row, its new photo rows, the removal of photo rows and the entries of the outbox (what
 *      the server still has to be told) are written together: either all of it is saved or none of it. A crash leaves the old state
 *      or the new one, never a frame without its photos, a photo row without its file, or a removed photo nobody told the server about.
 *   3. After the commit, the files that are not needed any more are removed (a crash here only leaves loose files).
 *   4. Only now the SERVER, and each step is driven by what is saved: the product (`synced = false` until it is accepted; the table
 *      API overwrites by id, so sending it twice is harmless), then its new photos (`synced = false` until uploaded; an upload of a
 *      photo the server already has is answered "already exists" and just marked), then the outbox. A crash anywhere in here leaves
 *      rows that are still marked unsynced, and the sync pass at the next start (and every 10 minutes) finishes the job.
 */

export type StepLog = (text: string) => void;

/** The transaction's client: what the callbacks of the services write through, so their writes join the transaction. */
export type Tx = Prisma.TransactionClient;

/** The id column of product_images that points at this kind of product. */
const PHOTO_COLUMN = { frame: "frameId", accessory: "accessoryId" } as const;

/**
 * Checks the photo changes of an edit: the photos to remove must be photos of THIS product (and each named once), and
 * the product may not end up with more photos than MAX_PHOTOS. Returns the ids to remove, or the message to show.
 */
export async function checkPhotoChanges(
  type: ProductType,
  productId: string,
  removeIds: unknown,
  addCount: number,
): Promise<{ ids: string[]; error?: undefined } | { ids?: undefined; error: string }> {
  if (removeIds === undefined || removeIds === null) removeIds = [];
  if (!Array.isArray(removeIds) || removeIds.some((id) => typeof id !== "string")) return { error: "The photos to remove must be given as a list of ids." };
  const wanted = [...new Set((removeIds as string[]).map((id) => id.toLowerCase()))];
  const mine = await sqlitePrisma.productImage.findMany({ where: { [PHOTO_COLUMN[type]]: productId }, select: { id: true } });
  const have = new Set(mine.map((photo) => photo.id));
  const foreign = wanted.filter((id) => !have.has(id));
  if (foreign.length > 0) return { error: `${foreign.length === 1 ? "A photo" : `${foreign.length} photos`} to remove ${foreign.length === 1 ? "is" : "are"} not on this ${type}.` };
  const after = have.size - wanted.length + addCount;
  if (after > MAX_PHOTOS) return { error: `Too many photos: it would have ${after} (the most is ${MAX_PHOTOS}).` };
  return { ids: wanted };
}

/** What sending to the server came to (step 4). */
interface SendOutcome {
  /** True when the server has the product with its current values (it is marked synced). */
  sentToServer: boolean;
  /** Why it was not sent, when it was not: "push-failed" (offline or refused) or "parents-not-synced" (a parent, its brand, is not on the server yet). */
  notSentBecause?: "push-failed" | "parents-not-synced" | "still-sending";
  /** How many of the new photos the server has now (0 while the product itself is not on the server). */
  photosUploaded: number;
}

/** Uploads the photos one after the other; `counter.n` is how many the server has. Never throws. */
async function uploadPhotos(photoIds: string[], counter: { n: number }, step: StepLog): Promise<void> {
  for (const photoId of photoIds) {
    try {
      const ok = await localPhotoService.uploadPhoto(photoId);
      if (ok) counter.n += 1;
      step(ok ? `uploaded photo ${photoId}` : `photo ${photoId} was not uploaded (stays unsynced, sent later)`);
    } catch (err) {
      step(`photo ${photoId} was not uploaded (${(err as Error).message}); stays unsynced, sent later`);
    }
  }
}

/**
 * Step 4 for a product and its new photos: the product first, and only if the server has it, the photos. The person waits for this only as long as
 * interactiveWaitMs() allows (the product, then the photos together): a slower server never holds the screen. What is not done by then goes on in the background (the
 * photos follow the product as soon as it has landed), and the answer says "still-sending".
 */
async function sendToServer(table: "frames" | "accessories", id: string, newPhotoIds: string[], step: StepLog, type: ProductType): Promise<SendOutcome> {
  const started = Date.now();
  const counter = { n: 0 };
  const pushed = await pushRow(table, id);

  if (pushed.reason === "push-pending") {
    step(`the server has not answered yet: the ${type} is being sent in the background`);
    void pushed.done?.then((final) => (final.synced ? uploadPhotos(newPhotoIds, counter, step) : undefined)).catch(() => undefined);
    return { sentToServer: false, notSentBecause: "still-sending", photosUploaded: 0 };
  }
  step(pushed.synced ? `the server accepted the ${type}: marked synced` : `the ${type} was not sent (${pushed.reason}); it stays saved here and is sent later`);

  if (pushed.synced && newPhotoIds.length > 0) {
    // the photos can be big: wait for them only for what is left of the short wait; the rest of them are uploaded in the background
    const uploads = uploadPhotos(newPhotoIds, counter, step);
    const left = Math.max(interactiveWaitMs() - (Date.now() - started), 0);
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([uploads.then(() => true), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), left); })]).finally(() => clearTimeout(timer));
    if (!finished) step("some photos are still being uploaded: they go on in the background");
  } else if (!pushed.synced && newPhotoIds.length > 0) {
    step("new photos not uploaded: the product is not on the server yet (they are uploaded by the next sync pass)");
  }
  return {
    sentToServer: pushed.synced,
    ...(pushed.synced ? {} : { notSentBecause: pushed.reason === "parents-not-synced" ? ("parents-not-synced" as const) : ("push-failed" as const) }),
    photosUploaded: counter.n,
  };
}

// ---- create ---------------------------------------------------------------------------------------------

export interface CreateOutcome extends SendOutcome {
  /** How many photos were saved on this computer. */
  photosSaved: number;
}

/**
 * Creates a product and its photos (see THE ORDER above):
 *   1. the photos' files are written (all or nothing);
 *   2. `createRow(tx)` and the photos' rows are saved in one transaction;
 *   3. the product is sent to the server, then its photos.
 */
export async function applyCreate(c: {
  type: ProductType;
  table: "frames" | "accessories";
  id: string;
  photos: CleanPhoto[];
  /** Creates the product's row through `tx` (so it is part of the transaction); the row must have `synced = false` (the default). */
  createRow: (tx: Tx) => Promise<unknown>;
  step: StepLog;
}): Promise<CreateOutcome> {
  const { type, table, id, step } = c;

  let staged: { id: string }[];
  try {
    staged = await stagePhotoFiles(c.photos);
  } catch (err) {
    step(`a photo could not be saved (${(err as Error).message}); nothing was created`);
    throw new LocalDbError(`The photos could not be saved on this computer: ${(err as Error).message}`, "invalid-input");
  }
  if (staged.length > 0) step(`saved ${staged.length} photo file(s) in the images folder`);

  try {
    await sqlitePrisma.$transaction(async (tx) => {
      await c.createRow(tx);
      for (const photo of staged) await tx.productImage.create({ data: photoRowData(type, id, photo.id) });
    });
  } catch (err) {
    await removePhotoFiles(staged.map((photo) => photo.id));
    step(`the ${type} could not be saved (${(err as Error).message}); its photo files were taken back and nothing was created`);
    throw err;
  }
  step(`saved the ${type} and its ${staged.length} photo row(s) in the local database in one transaction (synced = false)`);

  const sent = await sendToServer(table, id, staged.map((photo) => photo.id), step, type);
  return { photosSaved: staged.length, ...sent };
}

// ---- edit ------------------------------------------------------------------------------------------------

export interface EditOutcome extends SendOutcome {
  photosAdded: number;
  photosRemoved: number;
  /** How many removed photos the server has been told about, and how many deletions are still waiting for the connection. */
  deletionsSent: number;
  deletionsWaiting: number;
}

/**
 * Applies an edit that has been validated (see THE ORDER above):
 *   1. the new photos' files are written (all or nothing);
 *   2. in ONE transaction: `update(tx)` changes the product's row (it must set synced = false), the new photos' rows are added, the
 *      photos to remove have their rows deleted and each is written to the outbox for the server;
 *   3. the removed photos' files are deleted from this computer;
 *   4. the product is sent to the server, then the new photos, then the queued photo deletions are sent now.
 */
export async function applyEdit(c: {
  type: ProductType;
  table: "frames" | "accessories";
  id: string;
  newPhotos: CleanPhoto[];
  removeIds: string[];
  update: (tx: Tx) => Promise<unknown>;
  step: StepLog;
}): Promise<EditOutcome> {
  const { type, table, id, step } = c;

  let staged: { id: string }[];
  try {
    staged = await stagePhotoFiles(c.newPhotos);
  } catch (err) {
    step(`a photo could not be saved (${(err as Error).message}); nothing was changed`);
    throw new LocalDbError(`The photos could not be saved on this computer: ${(err as Error).message}`, "invalid-input");
  }
  if (staged.length > 0) step(`saved ${staged.length} new photo file(s) in the images folder`);

  let removed = 0;
  try {
    await sqlitePrisma.$transaction(async (tx) => {
      await c.update(tx);
      for (const photo of staged) await tx.productImage.create({ data: photoRowData(type, id, photo.id) });
      for (const photoId of c.removeIds) {
        removed += (await tx.productImage.deleteMany({ where: { id: photoId } })).count;
        await queueDeletionIn(tx, "photo", photoId); // also when the row was already gone: the server may still have the photo
      }
    });
  } catch (err) {
    await removePhotoFiles(staged.map((photo) => photo.id));
    step(`the ${type} could not be updated (${(err as Error).message}); the new photo files were taken back and nothing was changed`);
    throw err;
  }
  step(`updated the ${type} in the local database in one transaction (synced = false): ${staged.length} photo(s) added, ${removed} removed (queued for the server)`);

  await removePhotoFiles(c.removeIds);
  if (c.removeIds.length > 0) step(`deleted ${c.removeIds.length} removed photo file(s) from this computer`);

  const sent = await sendToServer(table, id, staged.map((photo) => photo.id), step, type);

  let deletionsSent = 0;
  let deletionsWaiting = 0;
  let stopped = false; // after a failure that would hit every deletion (no connection, a refused key, ...) the rest are not tried now
  for (const photoId of c.removeIds) {
    if (stopped) {
      deletionsWaiting += 1;
      continue;
    }
    const outcome = await attemptDeletion("photo", photoId);
    if (outcome?.ok) deletionsSent += 1;
    else deletionsWaiting += 1;
    step(outcome?.ok ? `the server deleted photo ${photoId}` : `photo ${photoId} is still on the server (${outcome ? outcome.reason : "not queued"}); its deletion is retried by the sync`);
    if (outcome && !outcome.ok && outcome.stopAll) stopped = true;
  }

  return { photosAdded: staged.length, photosRemoved: removed, ...sent, deletionsSent, deletionsWaiting };
}

// ---- delete ----------------------------------------------------------------------------------------------

export interface DeleteOutcome {
  photosDeleted: number;
  /** True when the server has deleted it (or never had it). */
  sentToServer: boolean;
  /** Why the server was not told, when it was not. */
  reason?: string;
}

/**
 * Deletes a frame or accessory (see THE ORDER above):
 *   1. in ONE transaction: `deleteRow(tx)` deletes its row (its photo rows go with it: the foreign key cascades) and the deletion is
 *      written to the outbox. A product that an order still refers to cannot be deleted and says so; nothing changes;
 *   2. its photo files are removed from the images folder;
 *   3. the server's table API is asked right away. The server removes its database row, its photo rows and the files of its photos;
 *      if it cannot be reached, the outbox entry is sent by the sync until it has been.
 */
export async function applyDelete(c: {
  type: ProductType;
  id: string;
  photoIds: string[];
  deleteRow: (tx: Tx) => Promise<void>;
  step: StepLog;
}): Promise<DeleteOutcome> {
  const { type, id, step } = c;
  try {
    await sqlitePrisma.$transaction(async (tx) => {
      await c.deleteRow(tx);
      await queueDeletionIn(tx, type, id);
    });
  } catch (err) {
    if (err instanceof LocalDbError && err.kind === "invalid-reference") {
      throw new LocalDbError(`This ${type} is used in orders or invoices, so it cannot be deleted.`, "invalid-reference");
    }
    throw err;
  }
  step(`deleted the ${type} from the local database (and its ${c.photoIds.length} photo row(s)) and queued the deletion for the server, in one transaction`);

  await removePhotoFiles(c.photoIds);
  if (c.photoIds.length > 0) step(`removed ${c.photoIds.length} photo file(s) from the images folder`);

  const outcome = await attemptDeletion(type, id);
  const sent = Boolean(outcome?.ok);
  step(sent ? `the server deleted the ${type} and its photos` : `the server could not be told (${outcome && !outcome.ok ? outcome.reason : "nothing queued"}); the deletion is retried by the sync`);
  return { photosDeleted: c.photoIds.length, sentToServer: sent, ...(sent || !outcome || outcome.ok ? {} : { reason: outcome.reason }) };
}
