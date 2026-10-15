/**
 * Base origin the backend's relative paths (photoUrl, imageUrl, …) are resolved against.
 * Configure via VITE_API_ORIGIN (e.g. "https://api.maisonclair.example") for a real backend.
 * Defaults to "" (same-origin) for local development against the mock data.
 */
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? '';
