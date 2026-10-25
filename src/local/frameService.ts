import { decodeStringArray, encodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import type { Frame, NewFrame } from "../services/types";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { markSyncedIfUnchanged, pushInsertRows, reportPushOutcome, toApiRow } from "./tableSync";
import { LocalDbError, translateError } from "./errors";
import { randomUUID } from "node:crypto";
import { newProductCode } from "./productCodes";
import { Prisma } from "../generated/sqlite-client";
import { searchFrameIds, searchFrames, type SearchBy } from "./productSearch";
import { frameDetails } from "./frameDetails";
import fs from "node:fs/promises";
import path from "node:path";
import { imagesDir } from "../lib/appData";
import { localPhotoFiles, localPhotoService, photoAddress } from "./photoService";
import { validateFrameForm, validatePhotos, type FieldErrors, type FrameForm, type PhotoInput } from "./frameValidation";
import { applyCreate, applyDelete, applyEdit, checkPhotoChanges, productUsage, type DeleteOutcome, type EditOutcome } from "./productEdit";

type FrameRow = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.frame.findFirst>>>;

function toFrame(row: FrameRow): Frame {
  return { ...row, images: decodeStringArray(row.images), colors: decodeStringArray(row.colors) };
}

/** The columns of `changes` that were given, with the arrays JSON-encoded for SQLite. */
function toColumns(changes: Partial<Omit<NewFrame, "id">>) {
  const { images, colors, ...rest } = changes;
  return {
    ...rest,
    ...(images !== undefined && { images: encodeStringArray(images) }),
    ...(colors !== undefined && { colors: encodeStringArray(colors) }),
  };
}

async function assertOwnBrand(brandId: string, tenantKey: string): Promise<void> {
  const brand = await sqlitePrisma.brand.findFirst({ where: { id: brandId, tenantKey }, select: { id: true } });
  if (!brand) throw new LocalDbError(`brandId ${brandId} is not one of your brands.`, "invalid-reference");
}

/**
 * Sends just-saved (inserted or updated) frames to the server (the table API: insert, which overwrites a row with the same id) and
 * marks the ones it accepted synced. A frame whose brand isn't on the server yet is held back (the server would refuse a frame whose
 * brand it does not have). Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Frame[]> {
  const sendable = await sqlitePrisma.frame.findMany({
    where: { id: { in: ids }, tenantKey, brand: { synced: true } },
  });
  if (sendable.length) {
    await tryPush(`${sendable.length} frame(s)`, async () => {
      const outcome = await pushInsertRows("frames", sendable.map((row) => ({ id: row.id, row: toApiRow(row) })));
      await markSyncedIfUnchanged((tx) => tx.frame, tenantKey, new Map(sendable.map((row) => [row.id, row])), outcome.accepted);
      reportPushOutcome(outcome);
    });
  }
  const fresh = await sqlitePrisma.frame.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toFrame(fresh.find((r) => r.id === id)!));
}

/** A frame together with its photos: each photo's id and the address it is fetched from. */
export type FrameWithPhotos = Omit<Frame, "tenantKey"> & { photos: { id: string; url: string; synced: boolean }[] };

type JoinedFrameRow = Omit<Frame, "images" | "colors" | "tenantKey"> & { images: string; colors: string; imageId: string | null; imageSynced: number | bigint | boolean | null };

/** What `create` answers: either the form's mistakes (nothing was saved) or the new frame and how far it got. */
export type CreateFrameResult =
  | { status: "invalid"; errors: FieldErrors; steps: string[] }
  | {
      status: "created";
      frame: Frame;
      /** How many photos were saved on this computer. */
      photosSaved: number;
      /** True when the server has the frame (it is marked synced); false when it could not be sent yet. */
      sentToServer: boolean;
      /** Why it was not sent, when it was not: "push-failed" (offline or refused) or "parents-not-synced" (its brand is not on the server yet). */
      notSentBecause?: "push-failed" | "parents-not-synced" | "still-sending";
      /** How many photos the server has now (always 0 when the frame itself was not sent). */
      photosUploaded: number;
      steps: string[];
    };

/** What `edit` answers: the form's mistakes (nothing changed) or the updated frame and how far it got. */
export type EditFrameResult =
  | { status: "invalid"; errors: FieldErrors; steps: string[] }
  | ({ status: "updated"; frame: Frame; steps: string[] } & EditOutcome);

/** What `delete` answers. */
export type DeleteFrameResult = { status: "deleted"; id: string; name: string; steps: string[] } & DeleteOutcome;

/** The join repeats a frame once per photo: folds the rows back into one frame with its photos. */
async function foldFrames(rows: JoinedFrameRow[]): Promise<FrameWithPhotos[]> {
    const localFiles = rows.some((r) => r.imageId !== null) ? await localPhotoFiles() : new Map<string, string>();
    const frames = new Map<string, FrameWithPhotos>();
    for (const { imageId, imageSynced, images, colors, ...frame } of rows) {
      let entry = frames.get(frame.id);
      if (!entry) {
        entry = { ...frame, images: decodeStringArray(images), colors: decodeStringArray(colors), photos: [] };
        frames.set(frame.id, entry);
      }
      if (imageId !== null) entry.photos.push({ id: imageId, url: photoAddress(imageId, localFiles), synced: Boolean(imageSynced) });
    }
    return [...frames.values()];
}

/** How many frames a search shows (the search looks one further to know whether there are more). */
const FRAMES_SEARCH_PAGE = 60;

export const localFrameService = {
  /** How many order lines and supplier-order lines the frame is on: above 0, it cannot be deleted (the Edit card does not offer Delete). */
  usage: (id: string) => productUsage("frame", id),

  /** Frames matching what was typed (name, code, reference, brand), as { id, code, name, brand, price, ... }: for pickers. See productSearch.ts. */
  search: searchFrames,

  /** One frame for its details page: its data, brand and category names, photos, and how many were sold (in total and in the last 30 days); null when there is none. See frameDetails.ts. */
  details: frameDetails,

  async list(filter: { brandId?: string; categoryId?: number } = {}): Promise<Frame[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.frame.findMany({ where: { tenantKey, ...filter }, orderBy: { name: "asc" } });
    return rows.map(toFrame);
  },

  /**
   * The frames of one brand and one category, each with its photos. ONE statement: the frames are LEFT JOINed
   * with product_images (through frame_id) and filtered by the brand id and the category id (this database
   * belongs to one shop, so there is no tenant to filter on); a frame with no photos still comes back, with
   * `photos: []`. Each photo is `{ id, url, synced }`: EVERY photo is listed, whether or not it is synced. The
   * url is the photo's local file when it is on this computer (so an unsynced photo, which the server does not
   * have yet, still shows), otherwise `server.url` + /api/images/<id>; the address is only built here, nothing
   * is fetched. Frames are in name order and a frame's photos in id order. Throws ConfigError when a photo
   * without a local file has to be addressed and `server.url` is missing from the settings file.
   */
  async listWithPhotos(brandId: string, categoryId: number): Promise<FrameWithPhotos[]> {
    if (typeof brandId !== "string" || brandId === "" || !Number.isInteger(categoryId)) {
      throw new LocalDbError("listWithPhotos: brandId must be a brand id and categoryId a whole number.", "invalid-input");
    }
    const rows = await sqlitePrisma.$queryRaw<JoinedFrameRow[]>`
      SELECT f.id, f.name, f.price, f.currency, f.images, f.shape, f.colors, f.stock,
             f.brand_id AS brandId, f.category_id AS categoryId, f.eye_size AS eyeSize, f.bridge,
             f.temple_length AS templeLength, f.reference, f.cost_price AS costPrice, f.code, f.gender,
             pi.id AS imageId, pi.synced AS imageSynced
        FROM frames f
        LEFT JOIN product_images pi ON pi.frame_id = f.id
       WHERE f.brand_id = ${brandId} AND f.category_id = ${categoryId}
       ORDER BY f.name ASC, f.id ASC, pi.id ASC`;

    return foldFrames(rows);
  },

  /**
   * The cards of the Frames page for a SEARCH: the frames that match what was typed (by model: name, reference or brand; by code: the code on the label), each with
   * its photos, like listWithPhotos. `filter.brandId` and `filter.categoryId` narrow the search when they are given (the page gives the ones that are chosen);
   * without them only what was typed counts. Answers { frames, more }: at most 60 frames in name order, and whether there were more. Typed text that is not a valid
   * search (see productSearch.ts) throws an invalid-input error saying what is wrong.
   */
  async searchWithPhotos(query: string, by?: SearchBy, filter: { brandId?: string | null; categoryId?: number | null; outOfStock?: boolean; notOrdered?: boolean } = {}): Promise<{ frames: FrameWithPhotos[]; more: boolean }> {
    const found = await searchFrameIds(query, by, filter);
    const more = found.length > FRAMES_SEARCH_PAGE;
    const ids = found.slice(0, FRAMES_SEARCH_PAGE);
    if (ids.length === 0) return { frames: [], more: false };
    const rows = await sqlitePrisma.$queryRaw<JoinedFrameRow[]>(Prisma.sql`
      SELECT f.id, f.name, f.price, f.currency, f.images, f.shape, f.colors, f.stock,
             f.brand_id AS brandId, f.category_id AS categoryId, f.eye_size AS eyeSize, f.bridge,
             f.temple_length AS templeLength, f.reference, f.cost_price AS costPrice, f.code, f.gender,
             pi.id AS imageId, pi.synced AS imageSynced
        FROM frames f
        LEFT JOIN product_images pi ON pi.frame_id = f.id
       WHERE f.id IN (${Prisma.join(ids)})
       ORDER BY f.name ASC, f.id ASC, pi.id ASC`);
    return { frames: await foldFrames(rows), more };
  },

  /**
   * Creates a frame from the creation card, in this order (each step is logged as "[create frame] n. ..." and
   * listed in the result's `steps`):
   *   1. validates the form and the photos (and that the brand exists); on any mistake it answers
   *      { status: "invalid", errors } and NOTHING is saved;
   *   2. inserts the frame into the local database (made-up id, synced = false);
   *   3. gives each photo a random UUID, inserts its product_images row and saves the file in the app's images
   *      folder; if any photo cannot be saved the frame and the photos already saved are taken back and it throws;
   *   4. sends the frame to the remote database and, if it accepts it, marks the frame synced;
   *   5. only if that worked, uploads each photo (each is marked synced when the server has it).
   * A frame that could not be sent (offline) stays saved here, unsynced; `sentToServer` says so.
   */
  async create(form: FrameForm, photoInputs: PhotoInput[] = []): Promise<CreateFrameResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[create frame] ${steps.length}. ${text}`);
    };

    // 1. validate
    const checkedForm = validateFrameForm(form);
    const checkedPhotos = validatePhotos(photoInputs);
    const errors: FieldErrors = { ...checkedForm.errors, ...checkedPhotos.errors };
    const tenantKey = await currentTenantKey();
    if (checkedForm.frame && !(await sqlitePrisma.brand.findFirst({ where: { id: checkedForm.frame.brandId, tenantKey }, select: { id: true } }))) {
      errors.brandId = "This brand no longer exists. Choose another one.";
    }
    if (Object.keys(errors).length > 0 || !checkedForm.frame || !checkedPhotos.photos) {
      step(`validation failed: ${Object.keys(errors).join(", ")}; nothing was saved`);
      return { status: "invalid", errors, steps };
    }
    const data = checkedForm.frame;
    const photos = checkedPhotos.photos;
    step(`validated the form and ${photos.length} photo(s)`);

    // 2-5. the photo files first, then the frame and its photo rows in ONE local transaction, then the server (see productEdit.ts)
    const id = randomUUID();
    const code = await newProductCode("frame", tenantKey);
    const outcome = await applyCreate({
      type: "frame",
      table: "frames",
      id,
      photos,
      createRow: async (tx) => {
        try {
          await tx.frame.create({ data: { id, ...toColumns(data), code, tenantKey } as never });
        } catch (err) {
          translateError(err, "Insert frame");
        }
      },
      step,
    });

    return {
      status: "created",
      frame: (await localFrameService.get(id))!,
      photosSaved: outcome.photosSaved,
      sentToServer: outcome.sentToServer,
      ...(outcome.notSentBecause ? { notSentBecause: outcome.notSentBecause } : {}),
      photosUploaded: outcome.photosUploaded,
      steps,
    };
  },

  /**
   * Updates a frame from the edit card: its fields, new photos to add and the ids of photos to remove. In this order
   * (each step is logged as "[edit frame] n. ..." and listed in the result's `steps`):
   *   1. validates the form, the new photos, the brand, and which photos may be removed; on any mistake it answers
   *      { status: "invalid", errors } and NOTHING changes;
   *   2-6. see applyEdit (productEdit.ts): new photos saved, the row updated locally, removed photos deleted locally and
   *      queued for the server, the frame sent to the remote database, then the new photos uploaded and the queued
   *      photo deletions sent.
   * A frame that could not be sent (offline) stays saved here, unsynced; `sentToServer` says so.
   */
  async edit(id: string, form: FrameForm, photoInputs: PhotoInput[] = [], removePhotoIds: string[] = []): Promise<EditFrameResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[edit frame] ${steps.length}. ${text}`);
    };

    const tenantKey = await currentTenantKey();
    const existing = await sqlitePrisma.frame.findFirst({ where: { id, tenantKey }, select: { id: true } });
    if (!existing) throw new LocalDbError(`Edit frame: no frame "${id}".`, "not-found");

    const checkedForm = validateFrameForm(form);
    const checkedPhotos = validatePhotos(photoInputs);
    const errors: FieldErrors = { ...checkedForm.errors, ...checkedPhotos.errors };
    if (checkedForm.frame && !(await sqlitePrisma.brand.findFirst({ where: { id: checkedForm.frame.brandId, tenantKey }, select: { id: true } }))) {
      errors.brandId = "This brand no longer exists. Choose another one.";
    }
    const changes = await checkPhotoChanges("frame", id, removePhotoIds, checkedPhotos.photos?.length ?? 0);
    if (changes.error && !errors.photos) errors.photos = changes.error;
    if (Object.keys(errors).length > 0 || !checkedForm.frame || !checkedPhotos.photos || !changes.ids) {
      step(`validation failed: ${Object.keys(errors).join(", ")}; nothing was changed`);
      return { status: "invalid", errors, steps };
    }
    const data = checkedForm.frame;
    step(`validated the form, ${checkedPhotos.photos.length} new photo(s) and ${changes.ids.length} photo(s) to remove`);

    const outcome = await applyEdit({
      type: "frame",
      table: "frames",
      id,
      newPhotos: checkedPhotos.photos,
      removeIds: changes.ids,
      update: (tx) => tx.frame.update({ where: { id }, data: { ...toColumns(data), synced: false } as never }),
      step,
    });
    return { status: "updated", frame: (await localFrameService.get(id))!, ...outcome, steps };
  },

  /**
   * Deletes a frame here and on the server: its row and photos locally, then the server's DELETE /api/frames/<id>, which
   * removes its database row and its photo files. A server that cannot be reached is told later by the sync (the outbox);
   * `sentToServer` says whether it has been. A frame that an order refers to cannot be deleted (it says so, nothing changes).
   */
  async delete(id: string): Promise<DeleteFrameResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[delete frame] ${steps.length}. ${text}`);
    };
    const tenantKey = await currentTenantKey();
    const frame = await sqlitePrisma.frame.findFirst({ where: { id, tenantKey }, select: { id: true, name: true } });
    if (!frame) throw new LocalDbError(`Delete frame: no frame "${id}".`, "not-found");
    const photoIds = (await sqlitePrisma.productImage.findMany({ where: { frameId: id }, select: { id: true } })).map((photo) => photo.id);

    const outcome = await applyDelete({
      type: "frame",
      id,
      photoIds,
      deleteRow: async (tx) => {
        try {
          await tx.frame.deleteMany({ where: { id, tenantKey } });
        } catch (err) {
          translateError(err, "Delete frame");
        }
      },
      step,
    });
    return { status: "deleted", id, name: frame.name, ...outcome, steps };
  },

  /**
   * More information about one frame, for its details view. NOT DECIDED YET: for now this only fixes the
   * name and the argument (`id` is the frame's id) and returns nothing; what it returns is filled in later.
   * Async, like the rest of the service, so adding a result later does not change how it is called.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDetails(id: string): Promise<void> {},

  async get(id: string): Promise<Frame | null> {
    const tenantKey = await currentTenantKey();
    const row = await sqlitePrisma.frame.findFirst({ where: { id, tenantKey } });
    return row ? toFrame(row) : null;
  },

  async insert(frame: NewFrame): Promise<Frame> {
    const tenantKey = await currentTenantKey();
    try {
      await assertOwnBrand(frame.brandId, tenantKey);
      const { id, ...rest } = frame;
      await sqlitePrisma.frame.create({ data: { id, ...toColumns(rest), tenantKey } as never });
    } catch (err) {
      translateError(err, "Insert frame");
    }
    await pushRow("frames", frame.id);
    return (await localFrameService.get(frame.id))!;
  },

  /** Inserts all the frames or none of them. */
  async insertMany(frames: NewFrame[]): Promise<Frame[]> {
    const tenantKey = await currentTenantKey();
    try {
      for (const brandId of new Set(frames.map((f) => f.brandId))) await assertOwnBrand(brandId, tenantKey);
      await sqlitePrisma.$transaction(
        frames.map(({ id, ...rest }) => sqlitePrisma.frame.create({ data: { id, ...toColumns(rest), tenantKey } as never })),
      );
    } catch (err) {
      translateError(err, "Insert frames");
    }
    return pushRows(frames.map((f) => f.id), tenantKey);
  },

  async update(id: string, changes: Partial<Omit<NewFrame, "id">>): Promise<Frame> {
    const tenantKey = await currentTenantKey();
    try {
      if (changes.brandId !== undefined) await assertOwnBrand(changes.brandId, tenantKey);
      const { count } = await sqlitePrisma.frame.updateMany({ where: { id, tenantKey }, data: { ...toColumns(changes), synced: false } });
      if (!count) throw new LocalDbError(`Update frame: no frame "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Update frame");
    }
    await pushRow("frames", id);
    return (await localFrameService.get(id))!;
  },

  async remove(id: string): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.frame.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete frame: no frame "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Delete frame");
    }
  },
};

registerPusher("frames", (ids, tenantKey) => pushRows(ids as string[], tenantKey));
