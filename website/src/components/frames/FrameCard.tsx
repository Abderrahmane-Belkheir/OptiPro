import { getColorSwatch } from '../../i18n/colorSwatches';
import { translateColor } from '../../i18n/colorLabels';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import type { Frame } from '../../types/frame';
import { formatPrice } from '../../utils/formatPrice';
import { FadeImage } from '../common/FadeImage';

interface FrameCardProps {
  frame: Frame;
  brandName: string;
}

/** Display-only: no link, button, or click handler — frames are not interactive yet. */
export function FrameCard({ frame, brandName }: FrameCardProps) {
  const { locale } = useLocale();
  const t = useTranslations();

  return (
    <article className="group flex flex-col transition-transform duration-500 ease-out hover:-translate-y-1">
      <div className="aspect-square w-full overflow-hidden bg-paper">
        {/* The grid view always shows the first image; a frame may have more for a future detail view. */}
        <FadeImage
          src={frame.images[0]}
          alt={`${brandName} ${frame.name}`}
          className="h-full w-full object-cover group-hover:scale-105"
          loading="lazy"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 pt-4">
        <span className="text-xs uppercase tracking-[0.14em] text-charcoal-soft">{brandName}</span>
        <h3 className="font-display text-lg font-medium text-charcoal">{frame.name}</h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          {frame.price !== undefined && (
            <span className="font-medium text-charcoal">
              {formatPrice(frame.price, frame.currency, locale)}
            </span>
          )}
          {!frame.inStock && (
            <span className="text-xs uppercase tracking-wide text-charcoal-soft">{t.frames.outOfStock}</span>
          )}
        </div>
        {frame.colors && frame.colors.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {frame.colors.map((color) => (
              <span key={color} className="flex items-center gap-1.5 text-xs text-charcoal-soft">
                <span
                  className="h-2.5 w-2.5 rounded-full border border-ink/10"
                  style={{ backgroundColor: getColorSwatch(color) }}
                  aria-hidden="true"
                />
                {translateColor(color, locale)}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
