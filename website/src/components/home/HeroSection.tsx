import { ArrowRight, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { editorialMedia } from '../../data/editorialMedia';
import { siteConfig } from '../../data/siteConfig';
import { useTranslations } from '../../i18n/translations';
import { Container } from '../common/Container';

interface HeroSectionProps {
  /** The order search bar: one of the first things a visitor sees, so it sits in the hero. */
  searchSlot?: ReactNode;
}

export function HeroSection({ searchSlot }: HeroSectionProps) {
  const t = useTranslations();

  return (
    <section id="top" className="relative -mt-16 flex min-h-[92vh] items-end overflow-hidden bg-ink">
      <img
        src={editorialMedia.hero}
        alt="A woman in round sunglasses and a patterned headscarf, lit in warm amber light"
        className="hero-kenburns absolute inset-0 h-full w-full object-cover object-[center_20%]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/15 to-transparent" />

      <Container className="relative z-10 pb-20 sm:pb-28">
        <div className="hero-stagger flex max-w-2xl flex-col items-start gap-6">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-brass-soft">
            {t.hero.eyebrow}
          </span>
          <h1 className="font-display text-5xl font-medium leading-[0.95] text-paper [text-wrap:balance] sm:text-7xl lg:text-8xl">
            {t.hero.title}
          </h1>
          <p className="max-w-md text-base text-paper/85 sm:text-lg">{t.hero.subtitle}</p>
          <a
            href={siteConfig.hero.ctaTarget}
            className="group mt-4 inline-flex items-center gap-3 border border-paper/70 px-7 py-3.5 text-sm uppercase tracking-wide text-paper transition-colors duration-300 hover:border-paper hover:bg-paper hover:text-ink"
          >
            {t.hero.ctaLabel}
            <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
          </a>
          {searchSlot}
        </div>
      </Container>

      <a
        href={siteConfig.hero.ctaTarget}
        aria-label={t.hero.ctaLabel}
        className="absolute bottom-8 right-6 z-10 hidden h-9 w-9 animate-bounce items-center justify-center rounded-full border border-paper/40 text-paper/70 transition-colors duration-300 hover:border-paper hover:text-paper sm:flex"
      >
        <ChevronDown size={16} aria-hidden="true" />
      </a>
    </section>
  );
}
