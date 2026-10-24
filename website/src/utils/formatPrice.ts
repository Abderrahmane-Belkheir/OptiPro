import { siteConfig } from '../data/siteConfig';
import type { Locale } from '../i18n/locale';

const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
};

export function formatPrice(price: number, currency: string | null = null, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: currency || siteConfig.currency.code,
    maximumFractionDigits: 0,
  }).format(price);
}

/** An amount in centimes (what an order holds), as money: the centimes shown only when there are some (150 002,50 and 1 500). */
export function formatCents(cents: number, currency: string | null = null, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: currency || siteConfig.currency.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** A day (an ISO date from the server) written out in the visitor's language, or an empty text when there is none. */
export function formatDay(iso: string | null, locale: Locale = 'en'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}
