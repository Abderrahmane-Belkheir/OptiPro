import type { Locale } from './locale';

/** English color names (as stored on each frame) translated for display. Unknown terms pass through. */
const frColorLabels: Record<string, string> = {
  Amber: 'Ambre',
  Beige: 'Beige',
  Black: 'Noir',
  Blush: 'Rose Poudré',
  Carbon: 'Carbone',
  Crystal: 'Cristal',
  Gold: 'Or',
  'Green G-15': 'Vert G-15',
  Grey: 'Gris',
  Gunmetal: 'Gunmetal',
  Havana: 'Havane',
  'Matte Black': 'Noir Mat',
  'Matte Grey': 'Gris Mat',
  'Prizm Grey': 'Gris Prizm',
  Red: 'Rouge',
  Rose: 'Rose',
  'Satin Black': 'Noir Satiné',
  'Sky Blue': 'Bleu Ciel',
  Teal: 'Bleu Canard',
  Tortoise: 'Écaille',
};

export function translateColor(color: string, locale: Locale): string {
  if (locale !== 'fr') return color;
  return frColorLabels[color] ?? color;
}
