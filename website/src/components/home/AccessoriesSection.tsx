import { useAccessories } from '../../hooks/useAccessories';
import { useInView } from '../../hooks/useInView';
import { useTranslations } from '../../i18n/translations';
import { AccessoryGrid } from '../accessories/AccessoryGrid';
import { Container } from '../common/Container';
import { Reveal } from '../common/Reveal';
import { SectionHeading } from '../common/SectionHeading';

export function AccessoriesSection() {
  const { ref, isInView } = useInView<HTMLElement>({ rootMargin: '400px' });
  const { accessories, isLoading, error } = useAccessories(isInView);
  const { accessoriesSection } = useTranslations();

  return (
    <section id="accessories" ref={ref} className="border-t border-line bg-ivory">
      <Container className="flex flex-col gap-10 py-20 sm:py-28">
        <Reveal>
          <SectionHeading
            eyebrow={accessoriesSection.eyebrow}
            title={accessoriesSection.title}
            description={accessoriesSection.description}
          />
        </Reveal>
        <AccessoryGrid accessories={accessories} isLoading={isLoading} error={error} />
      </Container>
    </section>
  );
}
