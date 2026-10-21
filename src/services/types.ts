// Shapes of the rows the local database stores and the services return (dates as ISO strings,
// array columns as real arrays). `tenantKey` is set from config.properties, never by the caller.

export interface Brand {
  id: string;
  name: string;
  tenantKey: string;
}

export interface Category {
  id: number;
  name: string;
  imageUrl: string;
}

export interface Frame {
  id: string;
  name: string;
  price: number | null;
  currency: string | null;
  images: string[];
  shape: string | null;
  colors: string[];
  stock: number;
  brandId: string;
  categoryId: number;
  /** Frame size in mm, as printed on the frame (e.g. 52-18-140). */
  eyeSize: number | null;
  bridge: number | null;
  templeLength: number | null;
  /** Manufacturer model code. */
  reference: string | null;
  costPrice: number | null;
  /** The shop's own short code (labels, website); optional for now, unique per shop. */
  code: string | null;
  tenantKey: string;
}

export interface Accessory {
  id: string;
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  images: string[];
  stock: number;
  costPrice: number | null;
  code: string | null;
  tenantKey: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  /** ISO 8601 timestamp. */
  dateOfBirth: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  tenantKey: string;
}

/** A brand's id is a UUID made here (like every other table's); leave it out and one is made. */
export interface NewBrand {
  id?: string;
  name: string;
}

export interface NewFrame {
  id: string;
  name: string;
  brandId: string;
  categoryId: number;
  price?: number | null;
  currency?: string | null;
  images?: string[];
  shape?: string | null;
  colors?: string[];
  stock?: number;
  eyeSize?: number | null;
  bridge?: number | null;
  templeLength?: number | null;
  reference?: string | null;
  costPrice?: number | null;
  code?: string | null;
}

export interface NewAccessory {
  id: string;
  name: string;
  description: string;
  price?: number | null;
  currency?: string | null;
  images?: string[];
  stock?: number;
  costPrice?: number | null;
  code?: string | null;
}

export interface NewCustomer {
  /** Optional: the backend generates a UUID when it's left out. */
  id?: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  /** ISO 8601 date. */
  dateOfBirth?: string | null;
}

// ---- Shop management ---------------------------------------------------------------------------
// Ids are UUIDs created on this side (a new row may omit `id` locally; one is generated) so a row
// has the same id here and on the backend. Dates are ISO 8601 strings. Money is in integer minor
// units (centimes). Every row also carries createdAt/updatedAt; `tenantKey` is set by the key.

interface Stamped {
  tenantKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Prescription extends Stamped {
  id: string;
  customerId: string;
  /** Date written on the prescription. */
  prescribedAt: string;
  prescriberName: string | null;
  rightSphere: number | null;
  rightCylinder: number | null;
  rightAxis: number | null;
  rightAdd: number | null;
  leftSphere: number | null;
  leftCylinder: number | null;
  leftAxis: number | null;
  leftAdd: number | null;
  /** Pupillary distance, mm. */
  pd: number | null;
  pdRight: number | null;
  pdLeft: number | null;
  fittingHeightRight: number | null;
  fittingHeightLeft: number | null;
  notes: string | null;
  imageUrl: string | null;
}

export interface Lens extends Stamped {
  id: string;
  name: string;
  /** single_vision | bifocal | progressive */
  design: string;
  /** organic | polycarbonate | mineral | high_index */
  material: string;
  refractiveIndex: number | null;
  antiReflective: boolean;
  blueLightFilter: boolean;
  photochromic: boolean;
  polarized: boolean;
  tint: string | null;
  /** What the shop charges for it; not tied to a pair or to one lens (the order line says how many and which eye). */
  priceCents: number;
  costCents: number;
  isActive: boolean;
  /** The power interval it can be made for; null = no limit known. */
  sphereMin: number | null;
  sphereMax: number | null;
  cylinderMin: number | null;
  cylinderMax: number | null;
  addMin: number | null;
  addMax: number | null;
  /** The largest allowed |sphere + cylinder|. */
  combinedLimit: number | null;
  /** Days the lab usually needs. */
  leadTimeDays: number | null;
  /** The smallest fitting height (mm) it can be made for. */
  minFittingHeight: number | null;
  brand: string | null;
  reference: string | null;
  notes: string | null;
}

export interface Order extends Stamped {
  id: string;
  /** e.g. CMD-2026-0042. Unique per shop. */
  number: string;
  customerId: string | null;
  prescriptionId: string | null;
  /** confirmed | at_lab | ready | delivered | cancelled */
  status: string;
  orderedAt: string;
  promisedAt: string | null;
  deliveredAt: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
}

export interface OrderItem extends Stamped {
  id: string;
  orderId: string;
  /** frame | lens | accessory | service */
  kind: string;
  frameId: string | null;
  lensId: string | null;
  accessoryId: string | null;
  description: string;
  /** right | left | both — for lenses. */
  eye: string | null;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface Payment extends Stamped {
  id: string;
  orderId: string | null;
  customerId: string | null;
  amountCents: number;
  paidAt: string;
  chequeDueDate: string | null;
  notes: string | null;
}

export interface Invoice extends Stamped {
  id: string;
  /** e.g. FAC-2026-0042. Unique per shop. */
  number: string;
  /** invoice | quote | delivery_note */
  kind: string;
  orderId: string | null;
  customerId: string | null;
  issuedAt: string;
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  totalCents: number;
  customerName: string | null;
  customerAddress: string | null;
}

export interface InvoiceItem extends Stamped {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface NumberSequence extends Stamped {
  id: string;
  /** order | invoice | quote | delivery_note */
  kind: string;
  year: number;
  /** Tells devices that number documents offline apart. */
  series: string;
  prefix: string;
  lastNumber: number;
}

export interface NewPrescription {
  id?: string;
  customerId: string;
  prescribedAt: string;
  prescriberName?: string | null;
  rightSphere?: number | null;
  rightCylinder?: number | null;
  rightAxis?: number | null;
  rightAdd?: number | null;
  leftSphere?: number | null;
  leftCylinder?: number | null;
  leftAxis?: number | null;
  leftAdd?: number | null;
  pd?: number | null;
  pdRight?: number | null;
  pdLeft?: number | null;
  fittingHeightRight?: number | null;
  fittingHeightLeft?: number | null;
  notes?: string | null;
  imageUrl?: string | null;
}

export interface NewLens {
  id?: string;
  name: string;
  design?: string;
  material?: string;
  refractiveIndex?: number | null;
  antiReflective?: boolean;
  blueLightFilter?: boolean;
  photochromic?: boolean;
  polarized?: boolean;
  tint?: string | null;
  priceCents?: number;
  costCents?: number;
  isActive?: boolean;
  sphereMin?: number | null;
  sphereMax?: number | null;
  cylinderMin?: number | null;
  cylinderMax?: number | null;
  addMin?: number | null;
  addMax?: number | null;
  combinedLimit?: number | null;
  leadTimeDays?: number | null;
  minFittingHeight?: number | null;
  brand?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface NewOrder {
  id?: string;
  number: string;
  customerId?: string | null;
  prescriptionId?: string | null;
  status?: string;
  orderedAt?: string;
  promisedAt?: string | null;
  deliveredAt?: string | null;
  subtotalCents?: number;
  discountCents?: number;
  totalCents?: number;
  notes?: string | null;
}

export interface NewOrderItem {
  id?: string;
  orderId: string;
  kind: string;
  frameId?: string | null;
  lensId?: string | null;
  accessoryId?: string | null;
  description: string;
  eye?: string | null;
  quantity?: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface NewPayment {
  id?: string;
  orderId?: string | null;
  customerId?: string | null;
  amountCents: number;
  paidAt?: string;
  chequeDueDate?: string | null;
  notes?: string | null;
}

export interface NewInvoice {
  id?: string;
  number: string;
  kind?: string;
  orderId?: string | null;
  customerId?: string | null;
  issuedAt?: string;
  subtotalCents?: number;
  discountCents?: number;
  vatCents?: number;
  totalCents?: number;
  customerName?: string | null;
  customerAddress?: string | null;
}

export interface NewInvoiceItem {
  id?: string;
  invoiceId: string;
  description: string;
  quantity?: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface NewNumberSequence {
  id?: string;
  kind: string;
  year: number;
  series?: string;
  prefix?: string;
  lastNumber?: number;
}
