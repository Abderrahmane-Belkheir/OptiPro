interface BrandOptionProps {
  brand: string;
  isSelected: boolean;
  onSelect: (brand: string) => void;
}

export function BrandOption({ brand, isSelected, onSelect }: BrandOptionProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(brand)}
      aria-pressed={isSelected}
      className={`shrink-0 border-b-2 pb-1.5 font-display text-lg transition-colors duration-300 sm:text-xl ${
        isSelected
          ? 'border-brass text-charcoal'
          : 'border-transparent text-charcoal-soft hover:border-charcoal-soft/40 hover:text-charcoal'
      }`}
    >
      {brand}
    </button>
  );
}
