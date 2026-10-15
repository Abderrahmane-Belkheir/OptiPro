import { useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, readStoredLocale, writeStoredLocale, type Locale } from './locale';
import { LocaleContext } from './localeContextValue';

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(next: Locale) {
    setLocaleState(next);
    writeStoredLocale(next);
  }

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
