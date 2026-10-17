import type { Translations } from './types';

export const en: Translations = {
  nav: {
    frames: 'Frames',
    accessories: 'Accessories',
    aboutStore: 'About Store',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },
  languageSwitcher: {
    groupLabel: 'Language',
    switchToFrench: 'Switch to French',
    switchToEnglish: 'Switch to English',
  },
  announcement: 'Complimentary lens fitting with every frame, in boutique or by post',
  tagline: 'Eyewear with character',
  hero: {
    eyebrow: 'The 2026 Collection',
    title: 'Find Your Perfect Frame.',
    subtitle: 'Discover eyewear that reflects your style, designed for the way you see the world.',
    ctaLabel: 'Explore Collections',
  },
  frames: {
    heading: 'Find Your Frames',
    promptNone: 'Select a category and a brand to see matching frames.',
    promptCategoryOnly: (category) => `${category} selected — now choose a brand.`,
    promptBrandOnly: (brand) => `${brand} selected — now choose a category.`,
    showing: (brand, category) => `Showing ${brand} in ${category}`,
    categoryGroupLabel: 'Shop by category',
    brandGroupLabel: 'Shop by brand',
    loadingCategories: 'Loading categories…',
    loadingBrands: 'Loading brands…',
    loadingFrames: 'Loading frames…',
    noBrandsYet: 'No brands are available yet.',
    noFramesForSelection: (brand) =>
      `${brand} doesn't have frames in this category yet. Try another brand to keep browsing.`,
    selectToBrowse: 'Select a category and brand above to browse available frames.',
    outOfStock: 'Out of Stock',
    catalogError: 'We could not load categories and brands right now.',
    framesError: 'We could not load frames for this selection.',
  },
  lookbook: {
    eyebrow: 'The Details',
    quote: 'Every hinge, every rivet, every millimeter of fit is a decision — not an afterthought.',
    caption:
      "From the first sketch to the final polish, our opticians are in the room — fitting, adjusting, and refusing to ship anything they wouldn't wear themselves.",
  },
  accessoriesSection: {
    eyebrow: 'Finishing Touches',
    title: 'Accessories',
    description: 'Cases, cords, and care essentials to keep every pair at its best.',
    loading: 'Loading accessories…',
    error: 'We could not load accessories right now.',
    none: 'No accessories are available right now.',
    outOfStock: 'Out of Stock',
  },
  aboutStore: {
    eyebrow: 'Our Craft',
    title: 'Eyewear considered down to the hinge.',
    paragraphs: [
      'Maison Clair began as a single atelier counter, fitting frames by eye and by hand. That standard has not moved: every model we carry is chosen for how it sits, how it wears, and how it ages.',
      'We work with a small roster of houses, from century-old ateliers to independent makers, so each collection stays considered rather than crowded.',
    ],
  },
  benefits: {
    eyebrow: 'The Standard',
    title: 'Why Maison Clair',
    items: [
      {
        title: 'Carefully Selected Frames',
        description: 'Every model is chosen in person, by hand, for fit and finish before it reaches the floor.',
      },
      {
        title: 'Quality Craftsmanship',
        description: 'Acetates, hinges, and hardware built to be worn daily and repaired, not replaced.',
      },
      {
        title: 'Expert Optical Guidance',
        description: 'Our opticians fit every pair to your prescription, face shape, and habits.',
      },
      {
        title: 'Personalized Service',
        description: 'Adjustments, cleanings, and advice are part of owning a Maison Clair frame, not an upsell.',
      },
    ],
  },
  footer: {
    exploreLabel: 'Explore',
    visitLabel: 'Visit',
    followLabel: 'Follow',
    rightsReserved: 'All rights reserved.',
  },
  itemDetail: {
    close: 'Close',
    loading: 'Loading…',
    error: 'We could not load this item right now.',
    notFound: "This item couldn't be found.",
    thumbnailAlt: (name, index) => `${name} — photo ${index + 1}`,
  },
};
