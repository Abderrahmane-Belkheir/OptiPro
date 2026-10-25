export type FrameShape =
  | 'round'
  | 'square'
  | 'cat-eye'
  | 'aviator'
  | 'rectangle'
  | 'oversized'
  | 'browline'
  | 'wayfarer';

/** Who a frame is for, as the shop's server sends it (lower case). */
export type FrameGender = 'male' | 'female' | 'unisex';

export interface Frame {
  /** The shop's own short code, unique within the shop: how a product is known, addressed and printed on its label. The internal id never reaches the website. */
  code: string;
  name: string;
  /** Matches one of the names in `CatalogTaxonomy.brands`. */
  brand: string;
  /** Matches one of the names in `CatalogTaxonomy.categories`. */
  category: string;
  price?: number | null;
  currency?: string | null;
  /**
   * Photo addresses: one or more; the general grid/card view always shows `images[0]`. What the backend
   * sends is `imageIds` (below) and, for older records, photo codes in this same field; the hooks turn them
   * into full addresses (utils/resolveImageUrl.ts, resolveProductImages) before anything renders them, so
   * by the time a component reads `images` it holds ready-to-use addresses.
   */
  images: string[];
  /**
   * The ids of the photos the shop uploaded for this item (as sent by the backend). Each photo is fetched
   * with GET /api/images/<id>; the hooks put those addresses into `images`.
   */
  imageIds?: string[];
  shape?: FrameShape;
  /** Who the frame is for; absent or null when the shop did not say. */
  gender?: FrameGender | null;
  colors?: string[];
  inStock: boolean;
}
