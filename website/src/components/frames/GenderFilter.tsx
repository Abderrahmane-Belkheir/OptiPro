import { useTranslations } from '../../i18n/translations';
import type { FrameGender } from '../../types/frame';

export type GenderFilterValue = 'all' | FrameGender;

const OPTIONS: GenderFilterValue[] = ['all', 'male', 'female', 'unisex'];

interface GenderFilterProps {
  selected: GenderFilterValue;
  onSelect: (gender: GenderFilterValue) => void;
}

/** All, Male, Female, Unisex: narrows the frames shown (a frame the shop did not give a gender to is only in All). */
export function GenderFilter({ selected, onSelect }: GenderFilterProps) {
  const t = useTranslations();
  return (
    <div role="group" aria-label={t.frames.genderGroupLabel} data-gender-filter="" className="flex flex-wrap gap-2">
      {OPTIONS.map((value) => {
        const isSelected = value === selected;
        return (
          <button
            key={value}
            type="button"
            data-gender={value}
            aria-pressed={isSelected}
            onClick={() => onSelect(value)}
            className={`border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors duration-300 ${
              isSelected ? 'border-charcoal bg-charcoal text-paper' : 'border-line text-charcoal-soft hover:border-charcoal hover:text-charcoal'
            }`}
          >
            {t.frames.genders[value]}
          </button>
        );
      })}
    </div>
  );
}
