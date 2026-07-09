import type { TimelineRangeSelection } from "./timelineEditing";
import { GUTTER, RULER_H } from "./timelineLayout";
import type { TimelineMarqueeOverlayRect } from "./useTimelineMarqueeSelection";

interface TimelineSelectionOverlaysProps {
  rangeSelection: TimelineRangeSelection | null;
  marqueeRect: TimelineMarqueeOverlayRect | null;
  pps: number;
}

export function TimelineSelectionOverlays({
  rangeSelection,
  marqueeRect,
  pps,
}: TimelineSelectionOverlaysProps) {
  return (
    <>
      {rangeSelection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + Math.min(rangeSelection.start, rangeSelection.end) * pps,
            width: Math.abs(rangeSelection.end - rangeSelection.start) * pps,
            top: RULER_H,
            bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.12)",
            borderLeft: "1px solid rgba(59, 130, 246, 0.4)",
            borderRight: "1px solid rgba(59, 130, 246, 0.4)",
            zIndex: 50,
          }}
        />
      )}
      {marqueeRect && (
        <div
          aria-hidden="true"
          className="absolute pointer-events-none"
          data-timeline-marquee="true"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
            backgroundColor: "rgba(96, 165, 250, 0.16)",
            border: "1px solid rgba(147, 197, 253, 0.72)",
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.35)",
            zIndex: 60,
          }}
        />
      )}
    </>
  );
}
