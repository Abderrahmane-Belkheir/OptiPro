/** The statuses an order goes through (the shop moves it along): the last two end the journey. */
export type OrderStatus = 'confirmed' | 'at_lab' | 'ready' | 'delivered' | 'cancelled';

export type OrderItemKind = 'frame' | 'lens' | 'accessory' | 'service';

export interface TrackedOrderItem {
  kind: OrderItemKind | string;
  /** What was bought, as the shop wrote it on the order. */
  description: string;
  /** For lenses: 'right', 'left' or 'both'. Null for everything else. */
  eye: 'right' | 'left' | 'both' | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

/** One order of `POST /api/orders/lookup`. Amounts are in centimes. It never holds the prescription or anything private. */
export interface TrackedOrder {
  /** The shop's own order number, like CMD-2026-0042. */
  number: string;
  status: OrderStatus;
  /** ISO dates; null when there is none yet. */
  orderedAt: string | null;
  promisedAt: string | null;
  deliveredAt: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** The sum of the payments, and what is left (never below 0; 0 for a cancelled order). */
  paidCents: number;
  remainingCents: number;
  items: TrackedOrderItem[];
}

/** The answer of `POST /api/orders/lookup`: the orders of the customer, newest first (empty when the customer has none). */
export interface CustomerOrders {
  orders: TrackedOrder[];
}
