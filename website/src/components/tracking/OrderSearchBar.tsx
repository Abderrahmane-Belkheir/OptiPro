import { ArrowRight, Search } from 'lucide-react';
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslations } from '../../i18n/translations';
import type { OrderTracking } from '../../hooks/useOrderTracking';

interface OrderSearchBarProps {
  tracking: OrderTracking;
}

/**
 * The order search: a visitor types their full name and year of birth. It sits in the hero, so it is among the first things seen on the site. The page puts no limit
 * on searches; if the server refuses the visitor for a while (too many asks that matched nobody), the bar says how long to wait.
 */
export function OrderSearchBar({ tracking }: OrderSearchBarProps) {
  const t = useTranslations();
  const inputId = useId();
  const yearId = useId();
  const messageId = useId();
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const { state, waitMs } = tracking;
  const loading = state.phase === 'loading';
  const blocked = waitMs > 0;
  const minutes = Math.max(1, Math.ceil(waitMs / 60000));

  function onYearChange(event: ChangeEvent<HTMLInputElement>) {
    setYear(event.target.value.replace(/\D/g, '').slice(0, 4)); // digits only, at most 4
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!loading) void tracking.search(name, year);
  }

  let message: string | null = null;
  if (state.phase === 'error') {
    if (state.failure === 'too-many') message = t.tracking.errors.limit(minutes);
    else if (state.failure === 'invalid') message = t.tracking.errors.invalid;
    else if (state.failure === 'not-found') message = t.tracking.errors.notFound;
    else if (state.failure === 'unavailable') message = t.tracking.errors.unavailable;
    else message = t.tracking.errors.error;
  } else if (blocked) {
    message = t.tracking.errors.limit(minutes);
  } else if (loading) {
    message = t.tracking.searching;
  }
  const isError = state.phase === 'error' || blocked;

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${inputId}-title`}
      data-order-search=""
      className="mt-6 w-full max-w-xl border border-paper/25 bg-ink/55 p-5 backdrop-blur-md sm:p-6"
    >
      <p id={`${inputId}-title`} className="text-xs font-semibold uppercase tracking-[0.22em] text-brass-soft">
        {t.tracking.eyebrow}
      </p>
      <label htmlFor={inputId} className="mt-2 block font-display text-2xl text-paper sm:text-3xl">
        {t.tracking.title}
      </label>
      <p className="mt-1 text-sm text-paper/80">{t.tracking.hint}</p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
          <label htmlFor={inputId} className="sr-only">
            {t.tracking.nameLabel}
          </label>
          <input
            id={inputId}
            name="fullName"
            type="text"
            autoComplete="name"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.tracking.namePlaceholder}
            aria-describedby={messageId}
            aria-invalid={state.phase === 'error' ? true : undefined}
            className="min-w-0 flex-1 border border-paper/40 bg-paper px-4 py-3.5 font-sans text-base text-charcoal placeholder:text-charcoal-soft/70"
          />
          <label htmlFor={yearId} className="sr-only">
            {t.tracking.yearLabel}
          </label>
          <input
            id={yearId}
            name="yearOfBirth"
            type="text"
            inputMode="numeric"
            autoComplete="bday-year"
            spellCheck={false}
            maxLength={4}
            pattern="[0-9]{4}"
            value={year}
            onChange={onYearChange}
            placeholder={t.tracking.yearPlaceholder}
            aria-describedby={messageId}
            aria-invalid={state.phase === 'error' ? true : undefined}
            className="w-full border border-paper/40 bg-paper px-4 py-3.5 font-sans text-base text-charcoal placeholder:text-charcoal-soft/70 sm:w-36"
          />
        </div>
        <button
          type="submit"
          disabled={loading || blocked}
          className="group inline-flex items-center justify-center gap-3 border border-paper bg-paper px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-ink transition-colors duration-300 hover:bg-brass-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
          {t.tracking.submit}
          {!loading && <ArrowRight size={16} aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1" />}
        </button>
      </div>

      <div id={messageId} className="mt-3 min-h-5 text-sm" role={isError ? 'alert' : 'status'} aria-live="polite">
        {message && <span className={isError ? 'text-brass-soft' : 'text-paper/80'}>{message}</span>}
      </div>
    </form>
  );
}
