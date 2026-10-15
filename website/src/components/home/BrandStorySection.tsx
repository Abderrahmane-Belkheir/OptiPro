import { editorialMedia } from '../../data/editorialMedia';
import { siteConfig } from '../../data/siteConfig';
import { useTranslations } from '../../i18n/translations';
import { Container } from '../common/Container';
import { FadeImage } from '../common/FadeImage';
import { Reveal } from '../common/Reveal';

export function BrandStorySection() {
  const t = useTranslations();

  return (
    <section id="about-store" className="bg-ink">
      <Container className="py-20 sm:py-28">
        <Reveal className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center lg:gap-6">
          <div className="relative lg:col-span-5">
            <FadeImage
              src={editorialMedia.aboutStore}
              alt="A dramatic black-and-white side portrait of a man wearing round glasses"
              className="aspect-[4/5] w-full object-cover"
            />
            <img
              src={siteConfig.brandStory.imageUrl}
              alt=""
              aria-hidden="true"
              className="absolute -bottom-10 -right-6 hidden w-40 border-4 border-ink object-cover sm:block"
            />
          </div>

          <div className="flex flex-col items-start gap-5 lg:col-span-6 lg:col-start-7">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass-soft">
              {t.aboutStore.eyebrow}
            </span>
            <h2 className="font-display text-4xl font-medium text-paper [text-wrap:balance] sm:text-5xl">
              {t.aboutStore.title}
            </h2>
            {t.aboutStore.paragraphs.map((paragraph) => (
              <p key={paragraph} className="max-w-md text-paper/70">
                {paragraph}
              </p>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
