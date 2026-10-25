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
    genderGroupLabel: string;
    genders: { all: string; male: string; female: string; unisex: string };
    /** Shown when the sex filter hides every frame of the selection: the label of the chosen sex. */
    noFramesForGender: (gender: string) => string;
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
  tracking: {
    eyebrow: string;
    title: string;
    hint: string;
    nameLabel: string;
    namePlaceholder: string;
    yearLabel: string;
    yearPlaceholder: string;
    submit: string;
    searching: string;
    errors: {
      invalid: string;
      notFound: string;
      unavailable: string;
      error: string;
      /** The visitor has used the searches allowed (as the server counts them): when to try again. */
      limit: (minutes: number) => string;
    };
    result: {
      ordersHeading: string;
      noOrders: string;
      orderLabel: string;
      searchAnother: string;
      placedOn: string;
      promisedFor: string;
      deliveredOn: string;
      statusLabel: string;
      statuses: Record<'confirmed' | 'at_lab' | 'ready' | 'delivered' | 'cancelled', { label: string; description: string }>;
      cancelledNotice: string;
      itemsHeading: string;
      columns: { item: string; quantity: string; unitPrice: string; total: string };
      eyes: Record<'right' | 'left' | 'both', string>;
      noItems: string;
      summaryHeading: string;
      subtotal: string;
      discount: string;
      total: string;
      paid: string;
      remaining: string;
      paidInFull: string;
    };
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
