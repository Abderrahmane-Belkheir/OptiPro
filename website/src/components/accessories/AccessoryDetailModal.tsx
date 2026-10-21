import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAccessory } from '../../hooks/useAccessory';
import { translateAccessory } from '../../i18n/accessoryLabels';
import { useLocale } from '../../i18n/useLocale';
import { useTranslations } from '../../i18n/translations';
import { formatPrice } from '../../utils/formatPrice';
import { ItemGalleryModal } from '../common/ItemGalleryModal';

export function AccessoryDetailModal() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { locale } = useLocale();
  const t = useTranslations();
  const { accessory, isLoading, notFound, error } = useAccessory(code);

  function handleClose() {
    // navigate(-1) only makes sense when we got here from within the app (a background location
    // was set on the way in) — a direct link or a page refresh has no such history to go back to.
    if (location.state && typeof location.state === 'object' && 'background' in location.state) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }

  if (!accessory) {
    const message = isLoading ? t.itemDetail.loading : notFound ? t.itemDetail.notFound : t.itemDetail.error;
    return (
      <ItemGalleryModal images={[]} title={message} onClose={handleClose}>
        <p className="text-sm text-paper/70" role={error ? 'alert' : 'status'}>
          {message}
        </p>
      </ItemGalleryModal>
    );
  }

  const label = translateAccessory(accessory, locale);

  return (
    <ItemGalleryModal images={accessory.images} title={label.name} onClose={handleClose}>
      <h2 className="font-display text-3xl font-medium">{label.name}</h2>
      <p className="text-sm text-paper/70">{label.description}</p>
      <div className="flex items-center gap-3">
        {accessory.price != null && (
          <span className="font-medium">{formatPrice(accessory.price, accessory.currency, locale)}</span>
        )}
        {!accessory.inStock && (
          <span className="text-xs uppercase tracking-wide text-paper/60">
            {t.accessoriesSection.outOfStock}
          </span>
        )}
      </div>
    </ItemGalleryModal>
  );
}
