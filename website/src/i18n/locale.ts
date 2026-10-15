export type Locale = 'fr' | 'en';

/** French is the default experience; a visitor must actively switch to English. */
export const DEFAULT_LOCALE: Locale = 'fr';

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en'];

const STORAGE_KEY = 'maison-clair-locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'fr' || value === 'en';
}

/** Reads the visitor's last choice. Returns null if nothing is stored or storage is unavailable. */
export function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private browsing / blocked storage: the choice just won't persist past this visit.
  }
}
