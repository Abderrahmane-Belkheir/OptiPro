import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from '../../i18n/translations';
import { FadeImage } from './FadeImage';

interface ItemGalleryModalProps {
  images: string[];
  title: string;
  onClose: () => void;
  children?: ReactNode;
}

/** Full-screen image gallery + details overlay, shared by the frame and accessory detail routes. */
export function ItemGalleryModal({ images, title, onClose, children }: ItemGalleryModalProps) {
  const t = useTranslations();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const activeImage = images[activeIndex];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/90 p-4 backdrop-blur-sm sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t.itemDetail.close}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-paper/10 text-paper transition-colors hover:bg-paper/20 sm:right-8 sm:top-8"
      >
        <X size={20} aria-hidden="true" />
      </button>

      <div
        className="flex max-h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto sm:flex-row sm:items-start"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-[3]">
          <div className="flex w-full items-center justify-center overflow-hidden bg-paper">
            {activeImage && (
              <FadeImage
                key={activeImage}
                src={activeImage}
                alt={title}
                className="block h-auto max-h-[75vh] w-full object-contain"
              />
            )}
          </div>

          {images.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={t.itemDetail.thumbnailAlt(title, index)}
                  aria-current={index === activeIndex}
                  className={`h-20 w-20 overflow-hidden border bg-paper transition-colors ${
                    index === activeIndex ? 'border-brass' : 'border-transparent hover:border-paper/40'
                  }`}
                >
                  {/* Opening a product requests ALL of its photos at once (every thumbnail is an <img>, loaded
                      eagerly), so clicking through them later fetches nothing more. The grid fetched only the first. */}
                  <img src={image} alt="" loading="eager" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        {children && <div className="flex flex-col gap-3 pt-2 text-paper sm:flex-[2]">{children}</div>}
      </div>
    </div>
  );
}
