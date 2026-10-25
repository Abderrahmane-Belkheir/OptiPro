import { decodeStringArray, encodeStringArray, sqlitePrisma } from "../lib/sqliteClient";
import type { Accessory, NewAccessory } from "../services/types";
import { currentTenantKey } from "./context";
import { tryPush } from "./sync";
import { pushRow, registerPusher } from "./syncPush";
import { markSyncedIfUnchanged, pushInsertRows, reportPushOutcome, toApiRow } from "./tableSync";
import { LocalDbError, translateError } from "./errors";
import { localPhotoFiles, photoAddress } from "./photoService";
import { validateAccessoryForm, validatePhotos, type AccessoryForm, type FieldErrors, type PhotoInput } from "./frameValidation";
import { randomUUID } from "node:crypto";
import { newProductCode } from "./productCodes";
import { searchAccessories } from "./productSearch";
import { accessoryDetails } from "./accessoryDetails";
import { applyCreate, applyDelete, applyEdit, checkPhotoChanges, productUsage, type DeleteOutcome, type EditOutcome } from "./productEdit";

type AccessoryRow = NonNullable<Awaited<ReturnType<typeof sqlitePrisma.accessory.findFirst>>>;

function toAccessory(row: AccessoryRow): Accessory {
  return { ...row, images: decodeStringArray(row.images) };
}

function toColumns(changes: Partial<Omit<NewAccessory, "id">>) {
  const { images, ...rest } = changes;
  return { ...rest, ...(images !== undefined && { images: encodeStringArray(images) }) };
}

/**
 * Sends just-saved (inserted or updated) accessories to the server (the table API: insert, which overwrites a row with the same id)
 * and marks the ones it accepted synced. Returns the rows as they now stand.
 */
export async function pushRows(ids: string[], tenantKey: string): Promise<Accessory[]> {
  const rows = await sqlitePrisma.accessory.findMany({ where: { id: { in: ids }, tenantKey } });
  await tryPush(`${rows.length} accessory(ies)`, async () => {
    const outcome = await pushInsertRows("accessories", rows.map((row) => ({ id: row.id, row: toApiRow(row) })));
    await markSyncedIfUnchanged((tx) => tx.accessory, tenantKey, new Map(rows.map((row) => [row.id, row])), outcome.accepted);
    reportPushOutcome(outcome);
  });
  const fresh = await sqlitePrisma.accessory.findMany({ where: { id: { in: ids }, tenantKey } });
  return ids.map((id) => toAccessory(fresh.find((r) => r.id === id)!));
}

/** An accessory together with its photos: each photo's id and the address it is fetched from. */
export type AccessoryWithPhotos = Omit<Accessory, "tenantKey"> & { photos: { id: string; url: string; synced: boolean }[] };

type JoinedAccessoryRow = Omit<Accessory, "images" | "tenantKey"> & { images: string; imageId: string | null; imageSynced: number | bigint | boolean | null };

/** What `edit` answers: the form's mistakes (nothing changed) or the updated accessory and how far it got. */
export type EditAccessoryResult =
  | { status: "invalid"; errors: FieldErrors; steps: string[] }
  | ({ status: "updated"; accessory: Accessory; steps: string[] } & EditOutcome);

/** What `create` answers: the form's mistakes (nothing was saved) or the new accessory and how far it got. */
export type CreateAccessoryResult =
  | { status: "invalid"; errors: FieldErrors; steps: string[] }
  | {
      status: "created";
      accessory: Accessory;
      /** How many photos were saved on this computer. */
      photosSaved: number;
      /** True when the server has the accessory (it is marked synced); false when it could not be sent yet. */
      sentToServer: boolean;
      notSentBecause?: "push-failed" | "parents-not-synced" | "still-sending";
      /** How many photos the server has now (0 when the accessory itself was not sent). */
      photosUploaded: number;
      steps: string[];
    };

/** What `delete` answers. */
export type DeleteAccessoryResult = { status: "deleted"; id: string; name: string; steps: string[] } & DeleteOutcome;

export const localAccessoryService = {
  /** How many order lines and supplier-order lines the accessory is on: above 0, it cannot be deleted (the Edit card does not offer Delete). */
  usage: (id: string) => productUsage("accessory", id),

  /** Accessories matching what was typed (name, code, description), for pickers. See productSearch.ts. */
  search: searchAccessories,

  /** One accessory for its details page: its data, photos, and how many were sold (in total and in the last 30 days); null when there is none. See accessoryDetails.ts. */
  details: accessoryDetails,

  async list(): Promise<Accessory[]> {
    const tenantKey = await currentTenantKey();
    const rows = await sqlitePrisma.accessory.findMany({ where: { tenantKey }, orderBy: { name: "asc" } });
    return rows.map(toAccessory);
  },

  /**
   * All the accessories, each with its photos (accessories have no brand or category to filter on). ONE
   * statement: the accessories are LEFT JOINed with product_images (through accessory_id); an accessory with
   * no photos still comes back, with `photos: []`. This database belongs to one shop, so there is no tenant to
   * filter on. Each photo is `{ id, url, synced }`: every photo is listed whether or not it is synced. The url is the
   * photo's local file when it is on this computer, otherwise `server.url` + /api/images/<id> (the address is
   * only built here, nothing is fetched). Accessories are in name order and an accessory's photos in id order. Throws
   * ConfigError when a photo has to be addressed and `server.url` is missing from the settings file.
   */
  async listWithPhotos(): Promise<AccessoryWithPhotos[]> {
    const rows = await sqlitePrisma.$queryRaw<JoinedAccessoryRow[]>`
      SELECT a.id, a.name, a.description, a.price, a.currency, a.images, a.stock, a.cost_price AS costPrice, a.code,
             pi.id AS imageId, pi.synced AS imageSynced
        FROM accessories a
        LEFT JOIN product_images pi ON pi.accessory_id = a.id
       ORDER BY a.name ASC, a.id ASC, pi.id ASC`;

    // The join repeats an accessory once per photo: fold the rows back into one accessory with its photos.
    const localFiles = rows.some((r) => r.imageId !== null) ? await localPhotoFiles() : new Map<string, string>();
    const accessories = new Map<string, AccessoryWithPhotos>();
    for (const { imageId, imageSynced, images, ...accessory } of rows) {
      let entry = accessories.get(accessory.id);
      if (!entry) {
        entry = { ...accessory, images: decodeStringArray(images), photos: [] };
        accessories.set(accessory.id, entry);
      }
      if (imageId !== null) entry.photos.push({ id: imageId, url: photoAddress(imageId, localFiles), synced: Boolean(imageSynced) });
    }
    return [...accessories.values()];
  },

  /**
   * Creates an accessory and its photos: validates the form and the photos, writes the photo files, saves the accessory and its photo
   * rows in ONE local transaction, then sends it to the server and uploads the photos (see productEdit.ts for why this order).
   * Logged as "[create accessory] n. ...".
   */
  async create(form: AccessoryForm, photoInputs: PhotoInput[] = []): Promise<CreateAccessoryResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[create accessory] ${steps.length}. ${text}`);
    };

    const checkedForm = validateAccessoryForm(form);
    const checkedPhotos = validatePhotos(photoInputs);
    const errors: FieldErrors = { ...checkedForm.errors, ...checkedPhotos.errors };
    if (Object.keys(errors).length > 0 || !checkedForm.accessory || !checkedPhotos.photos) {
      step(`validation failed: ${Object.keys(errors).join(", ")}; nothing was saved`);
      return { status: "invalid", errors, steps };
    }
    const data = checkedForm.accessory;
    step(`validated the form and ${checkedPhotos.photos.length} photo(s)`);

    const tenantKey = await currentTenantKey();
    const id = randomUUID();
    const code = await newProductCode("accessory", tenantKey);
    const outcome = await applyCreate({
      type: "accessory",
      table: "accessories",
      id,
      photos: checkedPhotos.photos,
      createRow: async (tx) => {
        try {
          await tx.accessory.create({ data: { id, ...toColumns(data), code, tenantKey } as never });
        } catch (err) {
          translateError(err, "Insert accessory");
        }
      },
      step,
    });
    return {
      status: "created",
      accessory: (await localAccessoryService.get(id))!,
      photosSaved: outcome.photosSaved,
      sentToServer: outcome.sentToServer,
      ...(outcome.notSentBecause ? { notSentBecause: outcome.notSentBecause } : {}),
      photosUploaded: outcome.photosUploaded,
      steps,
    };
  },

  /**
   * Updates an accessory from the edit card: its fields, new photos to add and the ids of photos to remove. Same steps as
   * localFrameService.edit (validation, then applyEdit); logged as "[edit accessory] n. ...".
   */
  async edit(id: string, form: AccessoryForm, photoInputs: PhotoInput[] = [], removePhotoIds: string[] = []): Promise<EditAccessoryResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[edit accessory] ${steps.length}. ${text}`);
    };

    const tenantKey = await currentTenantKey();
    const existing = await sqlitePrisma.accessory.findFirst({ where: { id, tenantKey }, select: { id: true } });
    if (!existing) throw new LocalDbError(`Edit accessory: no accessory "${id}".`, "not-found");

    const checkedForm = validateAccessoryForm(form);
    const checkedPhotos = validatePhotos(photoInputs);
    const errors: FieldErrors = { ...checkedForm.errors, ...checkedPhotos.errors };
    const changes = await checkPhotoChanges("accessory", id, removePhotoIds, checkedPhotos.photos?.length ?? 0);
    if (changes.error && !errors.photos) errors.photos = changes.error;
    if (Object.keys(errors).length > 0 || !checkedForm.accessory || !checkedPhotos.photos || !changes.ids) {
      step(`validation failed: ${Object.keys(errors).join(", ")}; nothing was changed`);
      return { status: "invalid", errors, steps };
    }
    const data = checkedForm.accessory;
    step(`validated the form, ${checkedPhotos.photos.length} new photo(s) and ${changes.ids.length} photo(s) to remove`);

    const outcome = await applyEdit({
      type: "accessory",
      table: "accessories",
      id,
      newPhotos: checkedPhotos.photos,
      removeIds: changes.ids,
      update: (tx) => tx.accessory.update({ where: { id }, data: { ...toColumns(data), synced: false } as never }),
      step,
    });
    return { status: "updated", accessory: (await localAccessoryService.get(id))!, ...outcome, steps };
  },

  /** Deletes an accessory here and on the server (see localFrameService.delete); logged as "[delete accessory] n. ...". */
  async delete(id: string): Promise<DeleteAccessoryResult> {
    const steps: string[] = [];
    const step = (text: string) => {
      steps.push(text);
      console.info(`[delete accessory] ${steps.length}. ${text}`);
    };
    const tenantKey = await currentTenantKey();
    const accessory = await sqlitePrisma.accessory.findFirst({ where: { id, tenantKey }, select: { id: true, name: true } });
    if (!accessory) throw new LocalDbError(`Delete accessory: no accessory "${id}".`, "not-found");
    const photoIds = (await sqlitePrisma.productImage.findMany({ where: { accessoryId: id }, select: { id: true } })).map((photo) => photo.id);

    const outcome = await applyDelete({
      type: "accessory",
      id,
      photoIds,
      deleteRow: async (tx) => {
        try {
          await tx.accessory.deleteMany({ where: { id, tenantKey } });
        } catch (err) {
          translateError(err, "Delete accessory");
        }
      },
      step,
    });
    return { status: "deleted", id, name: accessory.name, ...outcome, steps };
  },

  /**
   * More information about one accessory, for its details view. NOT DECIDED YET: for now this only fixes the
   * name and the argument (`id` is the accessory's id) and returns nothing; what it returns is filled in later.
   * Async, like the rest of the service, so adding a result later does not change how it is called.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDetails(id: string): Promise<void> {},

  async get(id: string): Promise<Accessory | null> {
    const tenantKey = await currentTenantKey();
    const row = await sqlitePrisma.accessory.findFirst({ where: { id, tenantKey } });
    return row ? toAccessory(row) : null;
  },

  async insert(accessory: NewAccessory): Promise<Accessory> {
    const tenantKey = await currentTenantKey();
    try {
      const { id, ...rest } = accessory;
      await sqlitePrisma.accessory.create({ data: { id, ...toColumns(rest), tenantKey } as never });
    } catch (err) {
      translateError(err, "Insert accessory");
    }
    await pushRow("accessories", accessory.id);
    return (await localAccessoryService.get(accessory.id))!;
  },

  /** Inserts all the accessories or none of them. */
  async insertMany(accessories: NewAccessory[]): Promise<Accessory[]> {
    const tenantKey = await currentTenantKey();
    try {
      await sqlitePrisma.$transaction(
        accessories.map(({ id, ...rest }) => sqlitePrisma.accessory.create({ data: { id, ...toColumns(rest), tenantKey } as never })),
      );
    } catch (err) {
      translateError(err, "Insert accessories");
    }
    return pushRows(accessories.map((a) => a.id), tenantKey);
  },

  async update(id: string, changes: Partial<Omit<NewAccessory, "id">>): Promise<Accessory> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.accessory.updateMany({ where: { id, tenantKey }, data: { ...toColumns(changes), synced: false } });
      if (!count) throw new LocalDbError(`Update accessory: no accessory "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Update accessory");
    }
    await pushRow("accessories", id);
    return (await localAccessoryService.get(id))!;
  },

  async remove(id: string): Promise<void> {
    const tenantKey = await currentTenantKey();
    try {
      const { count } = await sqlitePrisma.accessory.deleteMany({ where: { id, tenantKey } });
      if (!count) throw new LocalDbError(`Delete accessory: no accessory "${id}".`, "not-found");
    } catch (err) {
      translateError(err, "Delete accessory");
    }
  },
};

registerPusher("accessories", (ids, tenantKey) => pushRows(ids as string[], tenantKey));
