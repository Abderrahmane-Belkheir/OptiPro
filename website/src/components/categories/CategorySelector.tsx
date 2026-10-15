import { useTranslations } from '../../i18n/translations';
import type { Category } from '../../types/category';
import { Spinner, StatusMessage } from '../common/StatusMessage';
import { CategoryCard } from './CategoryCard';

interface CategorySelectorProps {
  categories: Category[];
  selectedCategory: string | null;
  onSelect: (category: string) => void;
  isLoading: boolean;
  error: boolean;
}

export function CategorySelector({
  categories,
  selectedCategory,
  onSelect,
  isLoading,
  error,
}: CategorySelectorProps) {
  const t = useTranslations();

  if (isLoading) {
    return <Spinner label={t.frames.loadingCategories} />;
  }

  if (error) {
    return <StatusMessage tone="error">{t.frames.catalogError}</StatusMessage>;
  }

  return (
    <div role="group" aria-label={t.frames.categoryGroupLabel} className="grid grid-cols-3 gap-3 sm:gap-4">
      {categories.map((category) => (
        <CategoryCard
          key={category.id}
          category={category}
          isSelected={category.name === selectedCategory}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
