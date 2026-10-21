/**
 * Unlike Category.id (a frontend-only placeholder), this id is expected to come from the
 * backend's `/api/catalog` response — the mock just stands in for that until the real API exists.
 */
export interface Brand {
  id: string; // a UUID, the same on the desktop app and the server
  name: string;
}
