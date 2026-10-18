import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { requireServerUrl, requireTenantKey } from "../config";

/**
 * Uploads photos of frames and accessories to the shop's server
 * (POST /api/images/<code>/<id>?type=frame|accessory, see backend/src/lib/imageUpload.js).
 *
 * <code> is the id of the frame or accessory the photo is for, and `type` says which of the two it is.
 * <id> is the id of the PHOTO, a UUID this client makes up (a fresh one for every upload unless you pass
 * your own): the server checks that the id is not used yet, that the shop really has such a
 * frame/accessory, records the photo in its product_images table under exactly that id and stores the
 * file named after it. A product can have several photos: every upload adds one. The shop proves who it
 * is with the `tenant.key` of the settings file; the server address is `server.url`.
 *
 *   const { id, url } = await localImageService.upload("frame", "RB3025", bytes);
 *   // id  = the photo's id (what a frame's `imageIds` lists); url = "/api/images/<id>" to fetch it
 *
 * Unlike the data services this needs a connection: nothing is queued for later.
 */

export const PRODUCT_TYPES = ["frame", "accessory"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

/** A photo id: a UUID. */
const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a product id may look like: 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit (the server checks the same). */
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Same ceiling as the server (IMAGE_MAX_BYTES there, 5 MB by default), so a too-big file is refused before it is sent. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 60_000;

export type ImageUploadErrorKind =
  | "invalid" //       not a usable request (a type or code that isn't allowed, an empty file, …)
  | "unsupported" //   not a PNG, JPEG, WebP or GIF
  | "too-large" //     over the size limit
  | "not-found" //     the shop has no such frame/accessory
  | "conflict" //      a photo with this id already exists
  | "unauthorized" //  the server doesn't know this tenant key
  | "rate-limited" //  too many wrong keys from this computer; wait
  | "offline" //       the server can't be reached
  | "timeout" //       the server didn't answer in time
  | "server"; //       the server failed

/** What the server said about a failed upload, besides the words (see backend/src/lib/imageUpload.js, uploadError). */
export interface ImageUploadErrorDetails {
  /** The server's stable machine code, e.g. PHOTO_ID_EXISTS, PRODUCT_NOT_FOUND, IMAGE_TOO_LARGE. */
  code?: string;
  /** How sending again can help: "new-id" (make up another photo id), "same-request", or "after-delay". Nothing retries by itself. */
  retry?: "new-id" | "same-request" | "after-delay";
  retryAfterSeconds?: number;
}

/** An upload that failed in a way the caller can act on (the window sees its kind as "[kind] message"). */
export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly kind: ImageUploadErrorKind,
    readonly details: ImageUploadErrorDetails = {},
  ) {
    super(message);
    this.name = "ImageUploadError";
  }
}

export interface UploadedImage {
  /** The photo's id (the one this client made up): what the frame's or accessory's `imageIds` lists. */
  id: string;
  /** Where the photo is fetched from, relative to the server: /api/images/<id>. */
  url: string;
  /** The same address with the server in front, for showing a preview. */
  absoluteUrl: string;
  type: ProductType;
  /** The id of the frame or accessory the photo belongs to. */
  code: string;
  size: number;
  contentType: string;
}

/** What `choose` reports: some files may go through while others fail, so nothing is thrown per file. */
export interface UploadBatch {
  uploaded: UploadedImage[];
  /** `name` is the file's name on this computer. */
  failed: { name: string; kind: ImageUploadErrorKind; message: string }[];
  /** True when the person closed the file picker without choosing anything. */
  canceled: boolean;
}

/** The type of an image from its first bytes (a file's name and the caller's word prove nothing). */
function sniffContentType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new ImageUploadError("The image must be given as bytes (a Uint8Array or ArrayBuffer).", "invalid");
}

/** The server's explanation of a failure: { error, code, retry, retryAfterSeconds }, any part of which may be missing. */
async function serverError(response: Response): Promise<{ message: string | null; details: ImageUploadErrorDetails }> {
  try {
    const body = (await response.json()) as { error?: unknown; code?: unknown; retry?: unknown; retryAfterSeconds?: unknown };
    const details: ImageUploadErrorDetails = {};
    if (typeof body.code === "string") details.code = body.code;
    if (body.retry === "new-id" || body.retry === "same-request" || body.retry === "after-delay") details.retry = body.retry;
    if (typeof body.retryAfterSeconds === "number") details.retryAfterSeconds = body.retryAfterSeconds;
    return { message: typeof body.error === "string" ? body.error : null, details };
  } catch {
    return { message: null, details: {} };
  }
}

/**
 * Sends one photo for the frame/accessory with id `code`, under the photo id `id` (made up here when not
 * given). Throws ConfigError when `server.url` or `tenant.key` is missing, ImageUploadError otherwise.
 */
async function upload(type: ProductType, code: string, data: Uint8Array | ArrayBuffer, id: string = randomUUID()): Promise<UploadedImage> {
  if (!(PRODUCT_TYPES as readonly string[]).includes(type)) {
    throw new ImageUploadError(`"${String(type).slice(0, 20)}" is not a product type: use "frame" or "accessory".`, "invalid");
  }
  if (typeof code !== "string" || !SAFE_CODE.test(code)) {
    throw new ImageUploadError(
      `"${String(code).slice(0, 40)}" is not a usable ${type} id: use 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit.`,
      "invalid",
    );
  }
  if (typeof id !== "string" || !PHOTO_ID.test(id)) {
    throw new ImageUploadError("The photo id must be a UUID.", "invalid");
  }
  id = id.toLowerCase();
  const bytes = toBytes(data);
  if (bytes.length === 0) throw new ImageUploadError("The image is empty.", "invalid");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageUploadError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, "too-large");
  const contentType = sniffContentType(bytes);
  if (!contentType) throw new ImageUploadError("Only PNG, JPEG, WebP and GIF images can be uploaded.", "unsupported");

  const server = requireServerUrl();
  const tenantKey = requireTenantKey();

  let response: Response;
  try {
    response = await fetch(`${server}/api/images/${encodeURIComponent(code)}/${id}?type=${type}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tenantKey}`, "Content-Type": contentType },
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ImageUploadError(`The server did not answer within ${UPLOAD_TIMEOUT_MS / 1000} seconds.`, "timeout");
    }
    throw new ImageUploadError(`Can't reach the server at ${server}. Check the internet connection and try again.`, "offline");
  }

  if (!response.ok) {
    const { message, details } = await serverError(response);
    switch (response.status) {
      case 401:
        throw new ImageUploadError("The server did not accept this shop's tenant key (tenant.key in the settings file).", "unauthorized", details);
      case 404:
        throw new ImageUploadError(message ?? `This shop has no ${type} "${code}".`, "not-found", details);
      case 409:
        // The photo id is taken. The photo was NOT stored; a new id (details.retry === "new-id") and a new request would work.
        throw new ImageUploadError(message ?? `A photo with the id ${id} already exists.`, "conflict", { retry: "new-id", ...details });
      case 413:
        throw new ImageUploadError(message ?? "The server says the image is too large.", "too-large", details);
      case 415:
        throw new ImageUploadError(message ?? "The server does not accept this kind of file.", "unsupported", details);
      case 429:
        throw new ImageUploadError(message ?? "Too many failed attempts. Try again in a few minutes.", "rate-limited", details);
      default:
        throw new ImageUploadError(message ?? `The server answered ${response.status}.`, response.status >= 500 ? "server" : "invalid", details);
    }
  }

  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    url?: unknown;
    size?: unknown;
    contentType?: unknown;
  } | null;
  if (!body || body.id !== id || typeof body.url !== "string" || !body.url.startsWith("/api/images/")) {
    throw new ImageUploadError("The server's answer was not what an upload returns.", "server");
  }
  return {
    id,
    url: body.url,
    absoluteUrl: new URL(body.url, server).href,
    type,
    code,
    size: typeof body.size === "number" ? body.size : bytes.length,
    contentType: typeof body.contentType === "string" ? body.contentType : contentType,
  };
}

/**
 * Uploads files from disk one after another, all for the same frame/accessory (each file becomes one
 * more photo of it, under a photo id made up for it here); a file that fails is reported, the rest still go.
 */
export async function uploadFiles(type: ProductType, code: string, filePaths: string[]): Promise<UploadBatch> {
  const batch: UploadBatch = { uploaded: [], failed: [], canceled: false };
  for (const filePath of filePaths) {
    const name = path.basename(filePath);
    try {
      const { size } = await fs.stat(filePath);
      if (size > MAX_IMAGE_BYTES) throw new ImageUploadError(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`, "too-large");
      batch.uploaded.push(await upload(type, code, await fs.readFile(filePath)));
    } catch (err) {
      // A missing server address or tenant key, a wrong product or a refused key are the same for every file: stop and say so.
      if (err instanceof Error && err.name === "ConfigError") throw err;
      if (err instanceof ImageUploadError && ["not-found", "unauthorized", "rate-limited"].includes(err.kind) && !batch.uploaded.length && !batch.failed.length) {
        throw err;
      }
      if (err instanceof ImageUploadError) batch.failed.push({ name, kind: err.kind, message: err.message });
      else batch.failed.push({ name, kind: "invalid", message: `Could not read ${name}: ${(err as Error).message}` });
    }
  }
  return batch;
}

/** Opens the system file picker and uploads what the person chooses (several files at once are fine) as photos of the frame/accessory `code`. */
async function choose(type: ProductType, code: string): Promise<UploadBatch> {
  if (!(PRODUCT_TYPES as readonly string[]).includes(type)) {
    throw new ImageUploadError(`"${String(type).slice(0, 20)}" is not a product type: use "frame" or "accessory".`, "invalid");
  }
  if (typeof code !== "string" || !SAFE_CODE.test(code)) {
    throw new ImageUploadError(`"${String(code).slice(0, 40)}" is not a usable ${type} id.`, "invalid");
  }
  requireServerUrl(); // fail before asking for files when the upload could not work anyway
  requireTenantKey();
  const { BrowserWindow, dialog } = await import("electron"); // only the app has it, not the node-only tests
  const options: Electron.OpenDialogOptions = {
    title: `Choose photos of ${type} ${code}`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (canceled || filePaths.length === 0) return { uploaded: [], failed: [], canceled: true };
  return uploadFiles(type, code, filePaths);
}

export const localImageService = { upload, choose };
