import { useState } from 'react';
import { BrandSelector } from '../components/brands/BrandSelector';
import { CategorySelector } from '../components/categories/CategorySelector';
import { Container } from '../components/common/Container';
import { Reveal } from '../components/common/Reveal';
import { SectionHeading } from '../components/common/SectionHeading';
import { FrameGrid } from '../components/frames/FrameGrid';
import { AccessoriesSection } from '../components/home/AccessoriesSection';
import { BenefitsSection } from '../components/home/BenefitsSection';
import { BrandStorySection } from '../components/home/BrandStorySection';
import { HeroSection } from '../components/home/HeroSection';
import { LookbookSection } from '../components/home/LookbookSection';
import { OrderResultSection } from '../components/tracking/OrderResultSection';
import { OrderSearchBar } from '../components/tracking/OrderSearchBar';
import { translateCategory } from '../i18n/categoryLabels';
import { useLocale } from '../i18n/useLocale';
import { useTranslations } from '../i18n/translations';
import { useCatalog } from '../hooks/useCatalog';
import { useFrames } from '../hooks/useFrames';
import { useOrderTracking } from '../hooks/useOrderTracking';

export function HomePage() {
  const { locale } = useLocale();
  const t = useTranslations();
  const { categories, brands, isLoading: catalogLoading, error: catalogError } = useCatalog();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const tracking = useOrderTracking();

  // Selection state stays name-based (for display/translation), but the frames API now filters
  // by id — resolved here from the catalog already loaded by useCatalog.
  const selectedCategoryId = categories.find((c) => c.name === selectedCategory)?.id ?? null;
  const selectedBrandId = brands.find((b) => b.name === selectedBrand)?.id ?? null;

  const { frames, isLoading: framesLoading, error: framesError } = useFrames(
    selectedCategoryId,
    selectedBrandId,
  );

  const displayedCategory = selectedCategory ? translateCategory(selectedCategory, locale) : null;

  return (
    <>
      {/* The order search is in the hero (one of the first things seen); the order it finds appears right under the hero. */}
      <HeroSection searchSlot={<OrderSearchBar tracking={tracking} />} />
      <OrderResultSection tracking={tracking} />

      <section id="frames" className="bg-ivory">
        <Container className="flex flex-col gap-10 py-20 sm:py-28">
          <Reveal className="flex flex-col gap-2">
            <SectionHeading title={t.frames.heading} />
            <p className="text-sm text-charcoal-soft">
              {displayedCategory && selectedBrand
                ? t.frames.showing(selectedBrand, displayedCategory)
                : displayedCategory
                  ? t.frames.promptCategoryOnly(displayedCategory)
                  : selectedBrand
                    ? t.frames.promptBrandOnly(selectedBrand)
                    : t.frames.promptNone}
            </p>
          </Reveal>

          <Reveal className="flex flex-col gap-6">
            <CategorySelector
              categories={categories}
              selectedCategory={selectedCategory}
              onSelect={setSelectedCategory}
              isLoading={catalogLoading}
              error={catalogError}
            />
            <BrandSelector
              brands={brands}
              selectedBrand={selectedBrand}
              onSelect={setSelectedBrand}
              isLoading={catalogLoading}
              error={catalogError}
            />
          </Reveal>

          <FrameGrid
            frames={frames}
            brandName={selectedBrand ?? ''}
            isLoading={framesLoading}
            error={framesError}
            hasSelection={Boolean(selectedCategory && selectedBrand)}
          />
        </Container>
      </section>

      <LookbookSection />
      <AccessoriesSection />
      <BrandStorySection />
      <BenefitsSection />
    </>
  );
}
