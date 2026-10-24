import { Check, MapPin, Phone, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { OrderTracking } from '../../hooks/useOrderTracking';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import type { Locale } from '../../i18n/locale';
import type { OrderStatus, TrackedOrder } from '../../types/trackedOrder';
import { formatCents, formatDay } from '../../utils/formatPrice';
import { Container } from '../common/Container';

/** The steps an order goes through, in order. A cancelled order is not on this road. */
const STEPS: Exclude<OrderStatus, 'cancelled'>[] = ['confirmed', 'at_lab', 'ready', 'delivered'];

interface OrderResultSectionProps {
  tracking: OrderTracking;
}

/** The order that was found, laid out so a customer sees at once where it is, what is in it and what is left to pay. Nothing is shown until an order is found. */
export function OrderResultSection({ tracking }: OrderResultSectionProps) {
  const { state } = tracking;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const found = state.phase === 'found' ? state.order : null;

  // when an order is found, bring it into view and move the focus to it
  useEffect(() => {
    if (!found) return;
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    headingRef.current?.focus({ preventScroll: true });
  }, [found]);

  if (!found) return null;
  return (
    <section id="track" aria-label={found.number} className="bg-paper" data-order-result="">
      <Container className="py-14 sm:py-20">
        <OrderResult order={found} headingRef={headingRef} onClear={tracking.clear} />
      </Container>
    </section>
  );
}

function OrderResult({ order, headingRef, onClear }: { order: TrackedOrder; headingRef: React.RefObject<HTMLHeadingElement | null>; onClear: () => void }) {
  const t = useTranslations();
  const { locale } = useLocale();
  const r = t.tracking.result;
  const status = r.statuses[order.status] ?? { label: order.status, description: '' };
  const cancelled = order.status === 'cancelled';
  const money = (cents: number) => formatCents(cents, order.currency, locale);
  const paidInFull = !cancelled && order.remainingCents === 0 && order.totalCents > 0;

  return (
    <article className="min-w-0 border border-line bg-ivory">
      {/* the order and where it is */}
      <header className="flex flex-col gap-6 border-b border-line p-6 sm:p-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass">
              {r.orderLabel} {order.number}
            </span>
            <h2 ref={headingRef} tabIndex={-1} style={{ outline: 'none' }} className="font-display text-4xl font-medium text-charcoal outline-none focus:outline-none focus-visible:outline-none sm:text-5xl" data-order-status={order.status}>
              {status.label}
            </h2>
            <p className="max-w-xl text-charcoal-soft [overflow-wrap:anywhere]">{status.description}</p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-2 border border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-charcoal-soft transition-colors hover:border-charcoal hover:text-charcoal"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {r.searchAnother}
          </button>
        </div>

        {cancelled ? (
          <p className="border-l-2 border-brass py-1 pl-5 text-sm italic text-charcoal" role="note">
            {r.cancelledNotice}
          </p>
        ) : (
          <Progress status={order.status as Exclude<OrderStatus, 'cancelled'>} labels={r.statuses} />
        )}

        <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
          <Fact label={r.placedOn} value={formatDay(order.orderedAt, locale)} />
          {!cancelled && order.deliveredAt === null && <Fact label={r.promisedFor} value={formatDay(order.promisedAt, locale)} />}
          {order.deliveredAt && <Fact label={r.deliveredOn} value={formatDay(order.deliveredAt, locale)} />}
        </dl>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* what is in the order */}
        <div className="min-w-0 border-b border-line p-6 sm:p-10 lg:border-b-0 lg:border-r">
          <h3 className="font-display text-2xl text-charcoal [overflow-wrap:anywhere]">{r.itemsHeading}</h3>
          {order.items.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal-soft">{r.noItems}</p>
          ) : (
            <ItemsTable order={order} locale={locale} money={money} />
          )}
        </div>

        {/* what was paid, and the shop to call */}
        <aside className="flex min-w-0 flex-col gap-8 p-6 sm:p-10">
          <div>
            <h3 className="font-display text-2xl text-charcoal">{r.summaryHeading}</h3>
            <dl className="mt-4 flex flex-col gap-2 text-sm" data-order-summary="">
              {order.discountCents > 0 && (
                <>
                  <Row label={r.subtotal} value={money(order.subtotalCents)} />
                  <Row label={r.discount} value={`− ${money(order.discountCents)}`} />
                </>
              )}
              <Row label={r.total} value={money(order.totalCents)} strong />
              <Row label={r.paid} value={money(order.paidCents)} />
              <div className="mt-2 border-t border-line pt-3">
                {paidInFull ? (
                  <p className="inline-flex items-center gap-2 text-sm font-semibold text-charcoal" data-paid-in-full="">
                    <Check size={16} className="text-brass" aria-hidden="true" />
                    {r.paidInFull}
                  </p>
                ) : (
                  <Row label={r.remaining} value={money(order.remainingCents)} strong highlight={order.remainingCents > 0} />
                )}
              </div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 text-sm" data-order-shop="">
            <h3 className="font-display text-2xl text-charcoal">{r.shopHeading}</h3>
            <p className="font-semibold text-charcoal [overflow-wrap:anywhere]">{order.shop.name}</p>
            {order.shop.address && (
              <p className="flex items-start gap-2 text-charcoal-soft [overflow-wrap:anywhere]">
                <MapPin size={16} className="mt-0.5 shrink-0 text-brass" aria-hidden="true" />
                {order.shop.address}
              </p>
            )}
            {order.shop.phone && (
              <a href={`tel:${order.shop.phone.replace(/[^\d+]/g, '')}`} className="link-underline inline-flex w-fit items-center gap-2 text-charcoal">
                <Phone size={16} className="text-brass" aria-hidden="true" />
                {r.call}: {order.shop.phone}
              </a>
            )}
          </div>
        </aside>
      </div>
    </article>
  );
}

function Progress({ status, labels }: { status: Exclude<OrderStatus, 'cancelled'>; labels: Record<OrderStatus, { label: string }> }) {
  const current = STEPS.indexOf(status);
  return (
    <ol className="flex flex-col gap-3 sm:grid sm:grid-cols-4 sm:gap-2" aria-label="Progress" data-order-steps="">
      {STEPS.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-3 sm:flex-col sm:items-stretch sm:gap-2" aria-current={active ? 'step' : undefined} data-step={step} data-state={done ? 'done' : active ? 'current' : 'todo'}>
            <span className={`h-1.5 w-8 shrink-0 sm:w-full ${done || active ? 'bg-brass' : 'bg-line'}`} aria-hidden="true" />
            <span className={`flex min-w-0 items-center gap-1.5 text-xs uppercase [overflow-wrap:anywhere] tracking-wide sm:text-[0.8rem] ${active ? 'font-semibold text-charcoal' : done ? 'text-charcoal-soft' : 'text-charcoal-soft/60'}`}>
              {done && <Check size={13} className="shrink-0 text-brass" aria-hidden="true" />}
              {labels[step].label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-charcoal-soft">{label}</dt>
      <dd className="font-medium text-charcoal">{value}</dd>
    </div>
  );
}

function Row({ label, value, strong = false, highlight = false }: { label: string; value: string; strong?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-charcoal-soft">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-base font-semibold text-charcoal' : 'text-charcoal'} ${highlight ? 'text-brass' : ''}`}>{value}</dd>
    </div>
  );
}

function ItemsTable({ order, locale, money }: { order: TrackedOrder; locale: Locale; money: (cents: number) => string }) {
  const t = useTranslations();
  const c = t.tracking.result.columns;
  const eyes = t.tracking.result.eyes;
  void locale;
  return (
    <>
      {/* on a phone: one block per item (a table would be wider than the screen) */}
      <ul className="mt-4 flex flex-col sm:hidden" data-order-items-list="">
        {order.items.map((item, index) => (
          <li key={index} className="flex flex-col gap-1 border-b border-line/70 py-3" data-order-item="">
            <span className="font-medium text-charcoal [overflow-wrap:anywhere]">{item.description}</span>
            {item.eye && <span className="text-xs text-charcoal-soft">{eyes[item.eye] ?? item.eye}</span>}
            <span className="mt-1 flex items-baseline justify-between gap-3 text-sm text-charcoal-soft">
              <span className="tabular-nums">
                {item.quantity} × {money(item.unitPriceCents)}
              </span>
              <span className="font-medium tabular-nums text-charcoal">{money(item.totalCents)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm" data-order-items="">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-charcoal-soft">
              <th scope="col" className="py-2 pr-4 font-medium">{c.item}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{c.quantity}</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">{c.unitPrice}</th>
              <th scope="col" className="py-2 pl-2 text-right font-medium">{c.total}</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={index} className="border-b border-line/70 align-top" data-order-item="">
                <td className="py-3 pr-4">
                  <span className="font-medium text-charcoal">{item.description}</span>
                  {item.eye && <span className="block text-xs text-charcoal-soft">{eyes[item.eye] ?? item.eye}</span>}
                </td>
                <td className="px-2 py-3 text-right tabular-nums">{item.quantity}</td>
                <td className="px-2 py-3 text-right tabular-nums">{money(item.unitPriceCents)}</td>
                <td className="py-3 pl-2 text-right font-medium tabular-nums text-charcoal">{money(item.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
