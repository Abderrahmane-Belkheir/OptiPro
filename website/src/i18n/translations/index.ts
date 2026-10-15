import { useLocale } from '../useLocale';
import type { Locale } from '../locale';
import { en } from './en';
import { fr } from './fr';
import type { Translations } from './types';

const translations: Record<Locale, Translations> = { en, fr };

export function useTranslations(): Translations {
  const { locale } = useLocale();
  return translations[locale];
}
