import { sqlitePrisma } from "../lib/sqliteClient";

/** The few Prisma delegate methods the generic sync code uses; the real delegates are typed per model. */
export interface Delegate {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  findFirst(args: object): Promise<Record<string, unknown> | null>;
  findFirstOrThrow(args: object): Promise<Record<string, unknown>>;
  count(args: object): Promise<number>;
  create(args: object): Promise<Record<string, unknown>>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args: object): Promise<{ count: number }>;
}

/** Prisma's delegates by name ("order", "orderItem", …), for code that handles any table. */
export const db = sqlitePrisma as unknown as Record<string, Delegate>;
