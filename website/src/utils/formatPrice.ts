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
