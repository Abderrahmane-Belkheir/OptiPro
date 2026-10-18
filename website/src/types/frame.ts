export type FrameShape =
  | 'round'
  | 'square'
  | 'cat-eye'
  | 'aviator'
  | 'rectangle'
  | 'oversized'
  | 'browline'
  | 'wayfarer';

export interface Frame {
  id: string;
  name: string;
  /** Matches one of the names in `CatalogTaxonomy.brands`. */
  brand: string;
  /** Matches one of the names in `CatalogTaxonomy.categories`. */
  category: string;
  price?: number;
  currency?: string;
  /**
   * One or more photos; the general grid/card view always shows `images[0]`. The backend sends each
   * photo's CODE ("aviator-gold.jpg"); the hooks turn the codes into full addresses
   * (origin + /images/<host name>/<code>, see utils/resolveImageUrl.ts) before anything renders them.
   */
  images: string[];
  shape?: FrameShape;
  colors?: string[];
  inStock: boolean;
}
