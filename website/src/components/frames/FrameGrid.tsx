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
  /** The label of the chosen gender when the gender filter is on (not All), else null. */
  genderLabel?: string | null;
  /** Whether the selection has frames before the gender filter is applied. */
  hasFramesBeforeFilter?: boolean;
}

export function FrameGrid({ frames, brandName, isLoading, error, hasSelection, genderLabel = null, hasFramesBeforeFilter = false }: FrameGridProps) {
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
    if (genderLabel && hasFramesBeforeFilter) return <StatusMessage>{t.frames.noFramesForGender(genderLabel)}</StatusMessage>;
    return <StatusMessage>{t.frames.noFramesForSelection(brandName)}</StatusMessage>;
  }

  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-12 min-[480px]:grid-cols-2 lg:grid-cols-3">
      {frames.map((frame) => (
        <FrameCard key={frame.code} frame={frame} brandName={brandName} />
      ))}
    </div>
  );
}
