import type { Locale } from './locale';

/**
 * The canonical category name (English, from the catalog taxonomy) is always the data key used
 * for selection and filtering. This only translates what's *displayed*. A category the backend
 * adds without an entry here still renders — it just shows its canonical name until translated.
 */
const frCategoryLabels: Record<string, string> = {
  'Optical Frames': 'Montures Optiques',
  Sunglasses: 'Lunettes de Soleil',
  Kids: 'Enfants',
};

export function translateCategory(name: string, locale: Locale): string {
  if (locale !== 'fr') return name;
  return frCategoryLabels[name] ?? name;
}
