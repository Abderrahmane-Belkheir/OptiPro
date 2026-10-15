export type NavKey = 'frames' | 'accessories' | 'aboutStore';

export interface NavLink {
  key: NavKey;
  href: string;
}

export interface SiteConfig {
  /** Shared by the navbar and the footer — the label for each comes from translations. */
  nav: NavLink[];
  hero: {
    ctaTarget: string;
    imageUrl: string;
  };
  brandStory: {
    imageUrl: string;
  };
  currency: {
    code: string;
  };
}

export const siteConfig: SiteConfig = {
  nav: [
    { key: 'frames', href: '#frames' },
    { key: 'accessories', href: '#accessories' },
    { key: 'aboutStore', href: '#about-store' },
  ],
  hero: {
    ctaTarget: '#frames',
    imageUrl: '/images/hero.svg',
  },
  brandStory: {
    imageUrl: '/images/brand-story.svg',
  },
  currency: {
    code: 'USD',
  },
};
