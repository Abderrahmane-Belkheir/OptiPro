export interface Accessory {
  id: string;
  name: string;
  description: string;
  price?: number;
  currency?: string;
  imageUrl: string;
  inStock: boolean;
}
