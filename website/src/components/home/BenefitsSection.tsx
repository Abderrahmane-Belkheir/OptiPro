import { Gem, Glasses, HeartHandshake, Wrench } from 'lucide-react';
import { useTranslations } from '../../i18n/translations';
import { Container } from '../common/Container';
import { Reveal } from '../common/Reveal';
import { SectionHeading } from '../common/SectionHeading';

const icons = [Gem, Wrench, Glasses, HeartHandshake];

export function BenefitsSection() {
  const { benefits } = useTranslations();

  return (
    <section className="bg-ivory">
      <Container className="py-20 sm:py-28">
        <Reveal>
          <SectionHeading eyebrow={benefits.eyebrow} title={benefits.title} />

          <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.items.map((item, index) => {
              const Icon = icons[index % icons.length];
              return (
                <div key={item.title} className="group flex flex-col gap-5">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brass-soft text-brass transition-colors duration-300 group-hover:bg-brass group-hover:text-paper">
                    <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <div className="flex flex-col gap-2">
                    <h3 className="font-display text-lg font-medium text-charcoal">{item.title}</h3>
                    <p className="text-sm text-charcoal-soft">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
