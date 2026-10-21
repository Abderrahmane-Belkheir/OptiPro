import { Link, useLocation } from 'react-router-dom';
import { translateAccessory } from '../../i18n/accessoryLabels';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import type { Accessory } from '../../types/accessory';
import { formatPrice } from '../../utils/formatPrice';
import { FadeImage } from '../common/FadeImage';

/** Links to the accessory's detail route, opened as a modal over the current grid (see App.tsx). */
export function AccessoryCard({ accessory }: { accessory: Accessory }) {
  const { locale } = useLocale();
  const { accessoriesSection } = useTranslations();
  const label = translateAccessory(accessory, locale);
  const location = useLocation();
  const detailPath = `/accessories/${accessory.code}`;

  return (
    <article className="group flex flex-col transition-transform duration-500 ease-out hover:-translate-y-1">
      <Link
        to={detailPath}
        state={{ background: location }}
        className="block w-full overflow-hidden bg-ivory"
      >
        {/* The grid view fetches and shows ONLY the first photo; the rest are fetched when the product is opened (all together, by the detail modal). */}
        <FadeImage
          src={accessory.images[0]}
          alt={label.name}
          className="block h-auto min-h-40 w-full object-contain group-hover:scale-105"
          loading="lazy"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 pt-4">
        <h3 className="font-display text-lg font-medium text-charcoal">
          <Link to={detailPath} state={{ background: location }} className="hover:text-brass">
            {label.name}
          </Link>
        </h3>
        <p className="text-sm text-charcoal-soft">{label.description}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          {accessory.price != null && (
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
