import { useTranslations } from '../../i18n/translations';
import type { Brand } from '../../types/brand';
import { Spinner, StatusMessage } from '../common/StatusMessage';
import { BrandOption } from './BrandOption';

interface BrandSelectorProps {
  brands: Brand[];
  selectedBrand: string | null;
  onSelect: (brand: string) => void;
  isLoading: boolean;
  error: boolean;
}

export function BrandSelector({ brands, selectedBrand, onSelect, isLoading, error }: BrandSelectorProps) {
  const t = useTranslations();

  if (isLoading) {
    return <Spinner label={t.frames.loadingBrands} />;
  }

  if (error) {
    return <StatusMessage tone="error">{t.frames.catalogError}</StatusMessage>;
  }

  if (brands.length === 0) {
    return <StatusMessage>{t.frames.noBrandsYet}</StatusMessage>;
  }

  return (
    <div
      role="group"
      aria-label={t.frames.brandGroupLabel}
      className="flex gap-x-8 gap-y-3 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible"
    >
      {brands.map((brand) => (
        <BrandOption
          key={brand.id}
          brand={brand.name}
          isSelected={brand.name === selectedBrand}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
