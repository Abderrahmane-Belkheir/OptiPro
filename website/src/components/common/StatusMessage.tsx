import type { ReactNode } from 'react';

interface StatusMessageProps {
  tone?: 'default' | 'error';
  children: ReactNode;
}

export function StatusMessage({ tone = 'default', children }: StatusMessageProps) {
  const toneClass = tone === 'error' ? 'border-brass text-charcoal' : 'border-line text-charcoal-soft';

  return (
    <p
      className={`max-w-md border-l-2 py-1 pl-5 text-sm italic ${toneClass}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-charcoal-soft" role="status">
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brass"
        aria-hidden="true"
      />
      {label}
    </div>
  );
}
