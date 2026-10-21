import { useTranslations } from '../../i18n/translations';
import type { Accessory } from '../../types/accessory';
import { Spinner, StatusMessage } from '../common/StatusMessage';
import { AccessoryCard } from './AccessoryCard';

interface AccessoryGridProps {
  accessories: Accessory[];
  isLoading: boolean;
  error: boolean;
}

export function AccessoryGrid({ accessories, isLoading, error }: AccessoryGridProps) {
  const { accessoriesSection } = useTranslations();

  if (isLoading) {
    return <Spinner label={accessoriesSection.loading} />;
  }

  if (error) {
    return <StatusMessage tone="error">{accessoriesSection.error}</StatusMessage>;
  }

  if (accessories.length === 0) {
    return <StatusMessage>{accessoriesSection.none}</StatusMessage>;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-12 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {accessories.map((accessory) => (
        <AccessoryCard key={accessory.code} accessory={accessory} />
      ))}
    </div>
  );
}
