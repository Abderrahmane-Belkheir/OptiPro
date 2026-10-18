export interface Accessory {
  id: string;
  name: string;
  description: string;
  price?: number;
  currency?: string;
  /**
   * One or more photos; the general grid/card view always shows `images[0]`. The backend sends each
   * photo's CODE ("aviator-gold.jpg"); the hooks turn the codes into full addresses
   * (origin + /images/<host name>/<code>, see utils/resolveImageUrl.ts) before anything renders them.
   */
  images: string[];
  inStock: boolean;
}
