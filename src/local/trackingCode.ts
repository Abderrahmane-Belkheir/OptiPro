import { randomInt } from "node:crypto";
import { LocalDbError } from "./errors";

/**
 * The tracking code of an order that has a prescription: a random number of 6 digits (100000 to 999999), different for every order of the shop. Random, not counted up, so the
 * code of one order tells nothing about the others. (An order without a prescription gets none: see orderPlacement.ts.)
 */
export const TRACKING_CODE_MIN = 100000;
export const TRACKING_CODE_MAX = 999999;
const TRIES = 50;

/**
 * A code that is not taken. `isTaken(code)` says whether an order of the shop has it already; `random` gives a number from min to max (both included): a stand-in in tests.
 * Throws when 50 random tries all hit a code that is taken (the shop has used up almost all of the 900 000).
 */
export async function newTrackingCode(
  isTaken: (code: number) => Promise<boolean>,
  random: (min: number, max: number) => number = (min, max) => randomInt(min, max + 1),
): Promise<number> {
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const code = random(TRACKING_CODE_MIN, TRACKING_CODE_MAX);
    if (!(await isTaken(code))) return code;
  }
  throw new LocalDbError("No free tracking code was found: almost all of the 900 000 codes of this shop are used.", "invalid-input");
}
