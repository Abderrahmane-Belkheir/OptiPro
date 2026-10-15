import type { Translations } from './types';

export const fr: Translations = {
  nav: {
    frames: 'Montures',
    accessories: 'Accessoires',
    aboutStore: 'Notre Maison',
    openMenu: 'Ouvrir le menu',
    closeMenu: 'Fermer le menu',
  },
  languageSwitcher: {
    groupLabel: 'Langue',
    switchToFrench: 'Passer en français',
    switchToEnglish: 'Switch to English',
  },
  announcement: 'Ajustement des verres offert pour chaque monture, en boutique ou par courrier',
  tagline: 'Optique de caractère',
  hero: {
    eyebrow: 'La Collection 2026',
    title: 'Trouvez Votre Monture Parfaite.',
    subtitle: 'Découvrez des lunettes qui reflètent votre style, pensées pour la façon dont vous voyez le monde.',
    ctaLabel: 'Découvrir les Collections',
  },
  frames: {
    heading: 'Trouvez Vos Montures',
    promptNone: 'Sélectionnez une catégorie et une marque pour afficher les montures correspondantes.',
    promptCategoryOnly: (category) => `Catégorie : ${category} — choisissez maintenant une marque.`,
    promptBrandOnly: (brand) => `Marque : ${brand} — choisissez maintenant une catégorie.`,
    showing: (brand, category) => `Affichage : ${brand} · ${category}`,
    categoryGroupLabel: 'Choisir une catégorie',
    brandGroupLabel: 'Choisir une marque',
    loadingCategories: 'Chargement des catégories…',
    loadingBrands: 'Chargement des marques…',
    loadingFrames: 'Chargement des montures…',
    noBrandsYet: "Aucune marque n'est disponible pour le moment.",
    noFramesForSelection: (brand) =>
      `${brand} ne propose pas encore de montures dans cette catégorie. Essayez une autre marque.`,
    selectToBrowse: 'Sélectionnez une catégorie et une marque ci-dessus pour parcourir les montures disponibles.',
    outOfStock: 'Rupture de Stock',
    catalogError: 'Impossible de charger les catégories et les marques pour le moment.',
    framesError: 'Impossible de charger les montures pour cette sélection.',
  },
  lookbook: {
    eyebrow: 'Le Détail',
    quote: "Chaque charnière, chaque rivet, chaque millimètre d'ajustement est une décision — jamais un hasard.",
    caption:
      "Du premier croquis à la toute dernière finition, nos opticiens sont présents à chaque étape — ils ajustent, retouchent, et ne laissent jamais partir une monture qu'ils ne porteraient pas eux-mêmes.",
  },
  accessoriesSection: {
    eyebrow: 'La Touche Finale',
    title: 'Accessoires',
    description: "Étuis, cordons et indispensables d'entretien pour que chaque paire reste impeccable.",
    loading: 'Chargement des accessoires…',
    error: 'Impossible de charger les accessoires pour le moment.',
    none: "Aucun accessoire n'est disponible pour le moment.",
    outOfStock: 'Rupture de Stock',
  },
  aboutStore: {
    eyebrow: 'Notre Savoir-Faire',
    title: "Des lunettes pensées jusqu'à la charnière.",
    paragraphs: [
      "Maison Clair est née d'un simple comptoir d'atelier, où chaque monture était ajustée à l'œil et à la main. Cette exigence n'a pas changé : chaque modèle que nous proposons est choisi pour la façon dont il se porte, s'use et vieillit.",
      "Nous travaillons avec un nombre restreint de maisons, des ateliers centenaires aux créateurs indépendants, pour que chaque collection reste réfléchie plutôt que surchargée.",
    ],
  },
  benefits: {
    eyebrow: "L'Exigence",
    title: 'Pourquoi Maison Clair',
    items: [
      {
        title: 'Montures Soigneusement Sélectionnées',
        description:
          "Chaque modèle est choisi en personne, à la main, pour sa coupe et sa finition avant d'arriver en boutique.",
      },
      {
        title: 'Un Savoir-Faire de Qualité',
        description:
          "Acétates, charnières et quincaillerie conçus pour un usage quotidien, à réparer plutôt qu'à remplacer.",
      },
      {
        title: 'Un Accompagnement Optique Expert',
        description: 'Nos opticiens ajustent chaque paire à votre prescription, la forme de votre visage et vos habitudes.',
      },
      {
        title: 'Un Service Personnalisé',
        description: "Ajustements, nettoyages et conseils font partie de l'expérience Maison Clair, sans supplément.",
      },
    ],
  },
  footer: {
    exploreLabel: 'Explorer',
    visitLabel: 'Nous Visiter',
    followLabel: 'Nous Suivre',
    rightsReserved: 'Tous droits réservés.',
  },
};
