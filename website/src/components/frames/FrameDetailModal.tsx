import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFrame } from '../../hooks/useFrame';
import { getColorSwatch } from '../../i18n/colorSwatches';
import { translateColor } from '../../i18n/colorLabels';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import { formatPrice } from '../../utils/formatPrice';
import { ItemGalleryModal } from '../common/ItemGalleryModal';

export function FrameDetailModal() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { locale } = useLocale();
  const t = useTranslations();
  const { frame, isLoading, notFound, error } = useFrame(id);

  function handleClose() {
    // navigate(-1) only makes sense when we got here from within the app (a background location
    // was set on the way in) — a direct link or a page refresh has no such history to go back to.
    if (location.state && typeof location.state === 'object' && 'background' in location.state) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }

  if (!frame) {
    const message = isLoading ? t.itemDetail.loading : notFound ? t.itemDetail.notFound : t.itemDetail.error;
    return (
      <ItemGalleryModal images={[]} title={message} onClose={handleClose}>
        <p className="text-sm text-paper/70" role={error ? 'alert' : 'status'}>
          {message}
        </p>
      </ItemGalleryModal>
    );
  }

  return (
    <ItemGalleryModal images={frame.images} title={`${frame.brand} ${frame.name}`} onClose={handleClose}>
      <span className="text-xs uppercase tracking-[0.14em] text-brass-soft">{frame.brand}</span>
      <h2 className="font-display text-3xl font-medium">{frame.name}</h2>
      <div className="flex items-center gap-3">
        {frame.price !== undefined && (
          <span className="font-medium">{formatPrice(frame.price, frame.currency, locale)}</span>
        )}
        {!frame.inStock && (
          <span className="text-xs uppercase tracking-wide text-paper/60">{t.frames.outOfStock}</span>
        )}
      </div>
      {frame.colors && frame.colors.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {frame.colors.map((color) => (
            <span key={color} className="flex items-center gap-1.5 text-xs text-paper/70">
              <span
                className="h-2.5 w-2.5 rounded-full border border-paper/20"
                style={{ backgroundColor: getColorSwatch(color) }}
                aria-hidden="true"
              />
              {translateColor(color, locale)}
            </span>
          ))}
        </div>
      )}
    </ItemGalleryModal>
  );
}
