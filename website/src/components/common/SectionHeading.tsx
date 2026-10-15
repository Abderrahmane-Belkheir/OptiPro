interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}

export function SectionHeading({ eyebrow, title, description, align = 'left' }: SectionHeadingProps) {
  const alignment = align === 'center' ? 'items-center text-center' : 'items-start text-left';

  return (
    <div className={`flex flex-col gap-3 ${alignment}`}>
      {eyebrow && (
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brass">{eyebrow}</span>
      )}
      <h2 className="font-display text-4xl font-medium text-charcoal [text-wrap:balance] sm:text-5xl">
        {title}
      </h2>
      {description && <p className="max-w-2xl text-charcoal-soft">{description}</p>}
    </div>
  );
}
