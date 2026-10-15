import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { siteConfig } from '../../data/siteConfig';
import { useTranslations } from '../../i18n/translations';
import { Container } from '../common/Container';
import { LanguageSwitcher } from './LanguageSwitcher';

interface NavbarProps {
  storeName: string;
}

export function Navbar({ storeName }: NavbarProps) {
  const t = useTranslations();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 72);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isSolid = isScrolled || isMenuOpen;

  return (
    <>
      <div className="bg-ink px-4 py-2 text-center text-xs tracking-wide text-paper/90">
        {t.announcement}
      </div>

      <div
        className={`sticky top-0 z-40 transition-colors duration-500 ${
          isSolid
            ? 'border-b border-line bg-ivory/95 backdrop-blur-sm'
            : 'border-b border-transparent bg-transparent'
        }`}
      >
        <Container className="flex h-16 items-center gap-10">
          <a
            href="#top"
            className={`font-display text-xl font-medium tracking-tight transition-colors duration-500 ${
              isSolid ? 'text-charcoal' : 'text-paper'
            }`}
          >
            {storeName}
          </a>

          <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
            {siteConfig.nav.map((link) => (
              <a
                key={link.key}
                href={link.href}
                className={`link-underline text-sm uppercase tracking-wide transition-colors duration-500 ${
                  isSolid ? 'text-charcoal-soft hover:text-charcoal' : 'text-paper/90 hover:text-paper'
                }`}
              >
                {t.nav[link.key]}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-5">
            <LanguageSwitcher isSolid={isSolid} />

            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-nav"
              aria-label={isMenuOpen ? t.nav.closeMenu : t.nav.openMenu}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-500 md:hidden ${
                isSolid ? 'text-charcoal hover:bg-beige' : 'text-paper hover:bg-paper/10'
              }`}
            >
              {isMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </Container>

        {isMenuOpen && (
          <nav id="mobile-nav" aria-label="Mobile" className="border-t border-line bg-ivory md:hidden">
            <Container className="flex flex-col gap-1 py-3">
              {siteConfig.nav.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className="py-2.5 text-sm uppercase tracking-wide text-charcoal-soft transition-colors hover:text-charcoal"
                >
                  {t.nav[link.key]}
                </a>
              ))}
            </Container>
          </nav>
        )}
      </div>
    </>
  );
}
