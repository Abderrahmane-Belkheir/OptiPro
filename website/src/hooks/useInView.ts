import { useEffect, useRef, useState } from 'react';

interface UseInViewOptions {
  threshold?: number;
  /** Lets the observer fire before the element is actually on-screen, e.g. '400px' to start work early. */
  rootMargin?: string;
}

/** Flips to true the first time the element scrolls into (or near) view, then stops observing. */
export function useInView<T extends HTMLElement>({ threshold = 0.2, rootMargin = '0px' }: UseInViewOptions = {}) {
  const ref = useRef<T>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  return { ref, isInView };
}
