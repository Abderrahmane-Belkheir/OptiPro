export interface Accessory {
  id: string;
  name: string;
  description: string;
  price?: number;
  currency?: string;
  /** One or more photos; the general grid/card view always shows `images[0]`. */
  images: string[];
  inStock: boolean;
}
