import type { Locale } from './locale';

interface AccessoryLabel {
  name: string;
  description: string;
}

/** Keyed by Accessory.id. A product added to the mock without an entry here still renders in English. */
const frAccessoryLabels: Record<string, AccessoryLabel> = {
  'acc-case-1': {
    name: 'Étui Rigide en Acétate',
    description: 'Protection moulée doublée de microfibre, adaptée à la plupart des montures.',
  },
  'acc-case-2': {
    name: 'Étui Fin de Voyage',
    description: 'Un profil plus plat qui se glisse dans une poche de veste ou un sac.',
  },
  'acc-cloth-1': {
    name: 'Chiffon Microfibre',
    description: 'Chiffon non pelucheux, sans danger pour les verres traités et polarisés.',
  },
  'acc-cloth-2': {
    name: 'Lot de Trois Chiffons',
    description: 'Trois chiffons dans une pochette en lin, un pour la maison, le travail et les déplacements.',
  },
  'acc-chain-1': {
    name: 'Chaîne à Perles',
    description: 'Perles en laiton montées à la main, pour garder vos lunettes de soleil à portée de main.',
  },
  'acc-chain-2': {
    name: 'Cordon en Cuir',
    description: 'Un cordon en cuir fin pour des montures portées toute la journée.',
  },
  'acc-kit-1': {
    name: 'Kit de Réparation',
    description: 'Vis de rechange, tournevis de précision et plaquettes nasales dans une boîte métallique.',
  },
};

export function translateAccessory(
  accessory: { code: string; name: string; description: string },
  locale: Locale,
): AccessoryLabel {
  if (locale !== 'fr') return { name: accessory.name, description: accessory.description };
  return frAccessoryLabels[accessory.code] ?? { name: accessory.name, description: accessory.description };
}
