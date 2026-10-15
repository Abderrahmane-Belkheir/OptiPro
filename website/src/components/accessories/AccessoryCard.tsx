import { translateAccessory } from '../../i18n/accessoryLabels';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import type { Accessory } from '../../types/accessory';
import { formatPrice } from '../../utils/formatPrice';
import { FadeImage } from '../common/FadeImage';

/** Display-only, matching the frame cards: no link, button, or click handler. */
export function AccessoryCard({ accessory }: { accessory: Accessory }) {
  const { locale } = useLocale();
  const { accessoriesSection } = useTranslations();
  const label = translateAccessory(accessory, locale);

  return (
    <article className="group flex flex-col transition-transform duration-500 ease-out hover:-translate-y-1">
      <div className="aspect-square w-full overflow-hidden bg-ivory">
        <FadeImage
          src={accessory.imageUrl}
          alt={label.name}
          className="h-full w-full object-cover group-hover:scale-105"
          loading="lazy"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 pt-4">
        <h3 className="font-display text-lg font-medium text-charcoal">{label.name}</h3>
        <p className="text-sm text-charcoal-soft">{label.description}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {accessory.price !== undefined && (
            <span className="font-medium text-charcoal">
              {formatPrice(accessory.price, accessory.currency, locale)}
            </span>
          )}
          {!accessory.inStock && (
            <span className="text-xs uppercase tracking-wide text-charcoal-soft">
              {accessoriesSection.outOfStock}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
