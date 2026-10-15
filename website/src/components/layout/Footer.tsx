import { siteConfig } from '../../data/siteConfig';
import { useTranslations } from '../../i18n/translations';
import type { SiteInfo } from '../../types/siteInfo';
import { Container } from '../common/Container';

interface FooterProps {
  siteInfo: SiteInfo | null;
}

export function Footer({ siteInfo }: FooterProps) {
  const year = new Date().getFullYear();
  const t = useTranslations();

  return (
    <footer id="footer-contact" className="border-t border-brass-soft/25 bg-ink text-paper/85">
      <Container className="grid gap-10 py-20 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <span className="font-display text-2xl font-medium text-paper">{siteInfo?.name}</span>
          <p className="text-sm text-paper/60">{t.tagline}</p>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-soft">
            {t.footer.exploreLabel}
          </span>
          {siteConfig.nav.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="link-underline self-start text-sm text-paper/75 hover:text-paper"
            >
              {t.nav[link.key]}
            </a>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-soft">
            {t.footer.visitLabel}
          </span>
          {siteInfo && (
            <>
              <p className="text-sm text-paper/75">{siteInfo.contact.address}</p>
              <p className="text-sm text-paper/75">{siteInfo.contact.phone}</p>
              <p className="text-sm text-paper/75">{siteInfo.contact.email}</p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-soft">
            {t.footer.followLabel}
          </span>
          {siteInfo?.social.map((social) => (
            <a
              key={social.label}
              href={social.url}
              className="link-underline self-start text-sm text-paper/75 hover:text-paper"
            >
              {social.label}
            </a>
          ))}
        </div>
      </Container>

      <Container className="border-t border-paper/10 py-6">
        <p className="text-xs text-paper/50">
          © {year} {siteInfo?.name}. {t.footer.rightsReserved}
        </p>
      </Container>
    </footer>
  );
}
