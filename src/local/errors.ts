import { Prisma } from "../generated/sqlite-client";

/** A local database operation that failed in a way the caller can act on. */
export class LocalDbError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "duplicate" | "invalid-reference" | "invalid-input",
  ) {
    super(message);
    this.name = "LocalDbError";
  }
}

/** The server could not be reached (offline, DNS, timeout). Expected, not a bug: whatever was being sent stays unsynced for a later pass. */
export class RemoteUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteUnreachableError";
  }
}

/** Turns Prisma's error codes into LocalDbErrors; anything unrecognised is rethrown untouched. */
export function translateError(err: unknown, what: string): never {
  if (err instanceof LocalDbError) throw err;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") throw new LocalDbError(`${what}: a row with the same unique value (id or name) already exists.`, "duplicate");
    if (err.code === "P2003") throw new LocalDbError(`${what}: it references, or is still referenced by, another row.`, "invalid-reference");
    if (err.code === "P2025") throw new LocalDbError(`${what}: row not found.`, "not-found");
  }
  throw err;
}
