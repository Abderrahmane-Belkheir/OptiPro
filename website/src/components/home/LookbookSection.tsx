import { editorialMedia } from '../../data/editorialMedia';
import { useTranslations } from '../../i18n/translations';
import { Container } from '../common/Container';
import { FadeImage } from '../common/FadeImage';
import { Reveal } from '../common/Reveal';

export function LookbookSection() {
  const { lookbook } = useTranslations();

  return (
    <section className="border-t border-line bg-paper">
      <Container className="py-20 sm:py-28">
        <Reveal className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end lg:gap-6">
          <div className="lg:col-span-5">
            <FadeImage
              src={editorialMedia.lookbookPrimary}
              alt="A pair of wire-framed glasses resting on an open book, lit in warm afternoon light"
              className="aspect-[4/5] w-full object-cover"
            />
          </div>

          <div className="flex flex-col gap-8 lg:col-span-7 lg:pl-6">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass">
              {lookbook.eyebrow}
            </span>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -left-3 -top-10 select-none font-display text-[8rem] leading-none text-brass-soft/30 sm:-top-14 sm:text-[10rem]"
              >
                &ldquo;
              </span>
              <p className="relative font-display text-3xl font-medium leading-tight text-charcoal [text-wrap:balance] sm:text-4xl lg:text-5xl">
                {lookbook.quote}
              </p>
            </div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <FadeImage
                src={editorialMedia.lookbookSecondary}
                alt="A man holding a pair of black-framed glasses up to the camera"
                className="aspect-[4/3] w-full max-w-xs object-cover"
              />
              <p className="max-w-xs text-sm text-charcoal-soft">{lookbook.caption}</p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
