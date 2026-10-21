/**
 * Base origin the backend's relative paths (photoUrl, imageUrl, …) are resolved against.
 * Configure via VITE_API_ORIGIN (e.g. "https://api.maisonclair.example") for a real backend.
 * Defaults to "" (same-origin) for local development against the mock data.
 */
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? '';

/**
 * Where the photos are fetched from, when they are served by the photo storage itself instead of by the API: the public
 * address of the R2 bucket, e.g. "https://photos.maisonclair.example" (a photo is then <that address>/images/<photo id>).
 * Configure via VITE_PHOTO_ORIGIN. Leave it empty to fetch every photo through the API (<API origin>/api/images/<id>).
 */
export const PHOTO_ORIGIN: string = import.meta.env.VITE_PHOTO_ORIGIN ?? '';
