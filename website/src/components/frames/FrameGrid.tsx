import { useTranslations } from '../../i18n/translations';
import type { Frame } from '../../types/frame';
import { Spinner, StatusMessage } from '../common/StatusMessage';
import { FrameCard } from './FrameCard';

interface FrameGridProps {
  frames: Frame[];
  brandName: string;
  isLoading: boolean;
  error: boolean;
  hasSelection: boolean;
}

export function FrameGrid({ frames, brandName, isLoading, error, hasSelection }: FrameGridProps) {
  const t = useTranslations();

  if (!hasSelection) {
    return <StatusMessage>{t.frames.selectToBrowse}</StatusMessage>;
  }

  if (isLoading) {
    return <Spinner label={t.frames.loadingFrames} />;
  }

  if (error) {
    return <StatusMessage tone="error">{t.frames.framesError}</StatusMessage>;
  }

  if (frames.length === 0) {
    return <StatusMessage>{t.frames.noFramesForSelection(brandName)}</StatusMessage>;
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
      {frames.map((frame) => (
        <FrameCard key={frame.id} frame={frame} brandName={brandName} />
      ))}
    </div>
  );
}
