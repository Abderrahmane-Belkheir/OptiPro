import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';

interface LanguageSwitcherProps {
  isSolid: boolean;
}

export function LanguageSwitcher({ isSolid }: LanguageSwitcherProps) {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();

  const activeClass = isSolid ? 'text-charcoal' : 'text-paper';
  const inactiveClass = isSolid ? 'text-charcoal-soft hover:text-charcoal' : 'text-paper/70 hover:text-paper';
  const dividerClass = isSolid ? 'text-charcoal-soft/50' : 'text-paper/40';

  return (
    <div
      role="group"
      aria-label={t.languageSwitcher.groupLabel}
      className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide"
    >
      <button
        type="button"
        onClick={() => setLocale('fr')}
        aria-pressed={locale === 'fr'}
        aria-label={t.languageSwitcher.switchToFrench}
        className={`transition-colors duration-300 ${locale === 'fr' ? activeClass : inactiveClass}`}
      >
        FR
      </button>
      <span className={dividerClass} aria-hidden="true">
        /
      </span>
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        aria-label={t.languageSwitcher.switchToEnglish}
        className={`transition-colors duration-300 ${locale === 'en' ? activeClass : inactiveClass}`}
      >
        EN
      </button>
    </div>
  );
}
