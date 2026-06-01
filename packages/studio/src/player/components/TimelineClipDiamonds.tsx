import { memo, useRef } from "react";

interface KeyframeEntry {
  percentage: number;
  properties: Record<string, number | string>;
  ease?: string;
}

interface KeyframeCacheEntry {
  format: string;
  keyframes: KeyframeEntry[];
  ease?: string;
  easeEach?: string;
}

interface TimelineClipDiamondsProps {
  keyframesData: KeyframeCacheEntry;
  clipWidthPx: number;
  accentColor: string;
  isSelected: boolean;
  elementId: string;
  selectedKeyframes: Set<string>;
  onClickKeyframe?: (percentage: number) => void;
  onShiftClickKeyframe?: (elementId: string, percentage: number) => void;
  onDragKeyframe?: (percentage: number, newPercentage: number) => void;
  onContextMenuKeyframe?: (e: React.MouseEvent, elementId: string, percentage: number) => void;
}

export const TimelineClipDiamonds = memo(function TimelineClipDiamonds({
  keyframesData,
  clipWidthPx,
  accentColor,
  isSelected,
  elementId,
  selectedKeyframes,
  onClickKeyframe,
  onShiftClickKeyframe,
  onDragKeyframe,
  onContextMenuKeyframe,
}: TimelineClipDiamondsProps) {
  const dragRef = useRef<{ startX: number; startPct: number } | null>(null);

  if (clipWidthPx < 20) return null;

  const handlePointerDown = (e: React.PointerEvent, pct: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startPct: pct };

    const handleMove = (_me: PointerEvent) => {
      // Track movement — visual feedback could be added here
    };

    const handleUp = (ue: PointerEvent) => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      const start = dragRef.current;
      dragRef.current = null;
      if (!start) return;
      const dx = ue.clientX - start.startX;
      const dPct = (dx / clipWidthPx) * 100;
      const newPct = Math.max(0, Math.min(100, Math.round(start.startPct + dPct)));
      if (Math.abs(newPct - start.startPct) > 0.5) {
        onDragKeyframe?.(start.startPct, newPct);
      } else if (ue.shiftKey) {
        onShiftClickKeyframe?.(elementId, start.startPct);
      } else {
        onClickKeyframe?.(start.startPct);
      }
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  return (
    <div className="absolute inset-0" style={{ zIndex: 3, pointerEvents: "none" }}>
      {keyframesData.keyframes.map((kf) => {
        const leftPx = (kf.percentage / 100) * clipWidthPx;
        const kfKey = `${elementId}:${kf.percentage}`;
        const isKfSelected = selectedKeyframes.has(kfKey);
        return (
          <button
            key={kf.percentage}
            type="button"
            className="absolute"
            style={{
              left: leftPx - 4,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "auto",
              padding: 2,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            onPointerDown={(e) => handlePointerDown(e, kf.percentage)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuKeyframe?.(e, elementId, kf.percentage);
            }}
            title={`${kf.percentage}%`}
          >
            <svg width="8" height="8" viewBox="0 0 8 8">
              {isKfSelected && (
                <rect
                  x="4"
                  y="0.5"
                  width="6.4"
                  height="6.4"
                  rx="1"
                  transform="rotate(45 4 0.5)"
                  fill="none"
                  stroke={accentColor}
                  strokeWidth="1"
                  opacity={0.6}
                />
              )}
              <rect
                x="4"
                y="0.5"
                width="4.8"
                height="4.8"
                rx="0.7"
                transform="rotate(45 4 0.5)"
                fill={isKfSelected ? accentColor : isSelected ? accentColor : "#a3a3a3"}
                opacity={isKfSelected ? 1 : isSelected ? 0.9 : 0.5}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
});
