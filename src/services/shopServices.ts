import { deleteRow, listRows, upsertRow, upsertRows, type WritableTable } from "./tableApi";
import type {
  Invoice, InvoiceItem, Lens, NewInvoice, NewInvoiceItem, NewLens, NewNumberSequence, NewOrder, NewOrderItem,
  NewPayment, NewPrescription, NumberSequence, Order, OrderItem, Payment, Prescription,
} from "./types";

/** list / upsert / upsertMany / remove for one table, with the same shape as the older services. */
function tableService<Row, NewRow>(table: WritableTable) {
  return {
    list: () => listRows<Row>(table),
    upsert: (row: NewRow) => upsertRow<Row, NewRow>(table, row),
    upsertMany: (rows: NewRow[]) => upsertRows<Row, NewRow>(table, rows),
    /** Rejects with a 409 ApiError while other rows still refer to it. */
    remove: (id: string) => deleteRow(table, id),
  };
}

export const prescriptionService = tableService<Prescription, NewPrescription>("prescriptions");
export const lensService = tableService<Lens, NewLens>("lenses");
export const orderService = tableService<Order, NewOrder>("orders");
export const orderItemService = tableService<OrderItem, NewOrderItem>("order_items");
export const paymentService = tableService<Payment, NewPayment>("payments");
export const invoiceService = tableService<Invoice, NewInvoice>("invoices");
export const invoiceItemService = tableService<InvoiceItem, NewInvoiceItem>("invoice_items");
export const numberSequenceService = tableService<NumberSequence, NewNumberSequence>("number_sequences");
