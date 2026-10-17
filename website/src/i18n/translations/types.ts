export interface Translations {
  nav: {
    frames: string;
    accessories: string;
    aboutStore: string;
    openMenu: string;
    closeMenu: string;
  };
  languageSwitcher: {
    groupLabel: string;
    switchToFrench: string;
    switchToEnglish: string;
  };
  announcement: string;
  tagline: string;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    ctaLabel: string;
  };
  frames: {
    heading: string;
    promptNone: string;
    promptCategoryOnly: (category: string) => string;
    promptBrandOnly: (brand: string) => string;
    showing: (brand: string, category: string) => string;
    categoryGroupLabel: string;
    brandGroupLabel: string;
    loadingCategories: string;
    loadingBrands: string;
    loadingFrames: string;
    noBrandsYet: string;
    noFramesForSelection: (brand: string) => string;
    selectToBrowse: string;
    outOfStock: string;
    catalogError: string;
    framesError: string;
  };
  lookbook: {
    eyebrow: string;
    quote: string;
    caption: string;
  };
  accessoriesSection: {
    eyebrow: string;
    title: string;
    description: string;
    loading: string;
    error: string;
    none: string;
    outOfStock: string;
  };
  aboutStore: {
    eyebrow: string;
    title: string;
    paragraphs: string[];
  };
  benefits: {
    eyebrow: string;
    title: string;
    items: { title: string; description: string }[];
  };
  footer: {
    exploreLabel: string;
    visitLabel: string;
    followLabel: string;
    rightsReserved: string;
  };
  itemDetail: {
    close: string;
    loading: string;
    error: string;
    notFound: string;
    thumbnailAlt: (name: string, index: number) => string;
  };
}
