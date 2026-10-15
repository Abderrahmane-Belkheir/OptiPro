import { useState, type ImgHTMLAttributes } from 'react';

/**
 * An <img> that fades in once it actually finishes loading, instead of popping in abruptly.
 * Also checks `complete` on mount (via the ref callback) — a cached image can finish loading
 * before React attaches the `onLoad` listener, which would otherwise leave it stuck invisible.
 */
export function FadeImage({ className = '', onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <img
      {...props}
      ref={(img) => {
        if (img?.complete) setIsLoaded(true);
      }}
      onLoad={(event) => {
        setIsLoaded(true);
        onLoad?.(event);
      }}
      className={`transition-[opacity,transform,filter] duration-700 ease-out ${isLoaded ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}
