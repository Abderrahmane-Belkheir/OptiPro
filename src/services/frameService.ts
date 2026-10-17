import { deleteRow, upsertRow, upsertRows, listRows } from "./tableApi";
import type { Frame, NewFrame } from "./types";

export const frameService = {
  list: () => listRows<Frame>("frames"),
  /** `brandId` must be one of the tenant's own brands (the backend answers 400 otherwise). */
  upsert: (frame: NewFrame) => upsertRow<Frame, NewFrame>("frames", frame),
  upsertMany: (frames: NewFrame[]) => upsertRows<Frame, NewFrame>("frames", frames),
  remove: (id: string) => deleteRow("frames", id),
};
