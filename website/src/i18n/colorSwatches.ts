/** Approximate swatch hex for each color name used on a frame — purely a small visual cue, not product-accurate. */
const swatchHex: Record<string, string> = {
  Amber: '#c98a3b',
  Beige: '#d8c7a1',
  Black: '#1a1816',
  Blush: '#e3b9b0',
  Carbon: '#2b2b2b',
  Crystal: '#e8e4dc',
  Gold: '#c9a227',
  'Green G-15': '#4c5b45',
  Grey: '#8c8680',
  Gunmetal: '#4c4f56',
  Havana: '#8b5a2b',
  'Matte Black': '#232020',
  'Matte Grey': '#76716c',
  'Prizm Grey': '#5b5955',
  Red: '#a5342a',
  Rose: '#cba0a6',
  'Satin Black': '#201e1c',
  'Sky Blue': '#a9c7d8',
  Teal: '#3f7268',
  Tortoise: '#7a4a26',
};

const fallbackSwatch = '#c8bea9';

export function getColorSwatch(color: string): string {
  return swatchHex[color] ?? fallbackSwatch;
}
