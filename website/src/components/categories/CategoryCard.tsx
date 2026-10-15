import { Check } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { categoryFallbackImageUrl } from '../../data/categoryPresentation';
import { translateCategory } from '../../i18n/categoryLabels';
import { useLocale } from '../../i18n/useLocale';
import type { Category } from '../../types/category';
import { FadeImage } from '../common/FadeImage';

interface CategoryCardProps {
  category: Category;
  isSelected: boolean;
  onSelect: (category: string) => void;
}

function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = 'true';
  img.src = categoryFallbackImageUrl;
}

export function CategoryCard({ category, isSelected, onSelect }: CategoryCardProps) {
  const { locale } = useLocale();

  return (
    <button
      type="button"
      onClick={() => onSelect(category.name)}
      aria-pressed={isSelected}
      className={`group relative flex aspect-[3/2] w-full flex-col overflow-hidden border text-left focus-visible:outline-offset-4 sm:aspect-[4/3] ${
        isSelected ? 'border-brass' : 'border-transparent hover:border-charcoal-soft/40'
      }`}
    >
      <FadeImage
        src={category.url}
        onError={handleImageError}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover group-hover:scale-[1.04] ${
          isSelected ? '' : 'category-desaturate'
        }`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/75 via-ink/10 to-transparent" />

      {isSelected && (
        <span className="absolute right-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-brass text-paper">
          <Check size={12} strokeWidth={3} aria-hidden="true" />
        </span>
      )}

      <div className="relative z-10 mt-auto flex flex-col gap-1.5 p-3 sm:p-4">
        <span className="font-display text-base font-medium text-paper sm:text-lg">
          {translateCategory(category.name, locale)}
        </span>
        <span
          className={`h-px bg-brass-soft transition-transform duration-500 ease-out ${
            isSelected ? 'w-10 scale-x-100' : 'w-10 origin-left scale-x-0 group-hover:scale-x-100'
          }`}
        />
      </div>
    </button>
  );
}
