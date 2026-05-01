import type { RefObject } from 'react'
import { MapInlineDebriefPanel } from './MapInlineDebriefPanel'
import { MapSelectionPanels, type MapSelectionPanelsProps } from './MapSelectionPanels'

interface MapContextPanelSurfaceProps {
  contextPanelOpen: boolean
  handleResizeStart: (event: React.MouseEvent) => void
  hasSelection: boolean
  panelRef: RefObject<HTMLElement | null>
  panelWidth: number
  selectionPanelsProps: MapSelectionPanelsProps
}

export function MapContextPanelSurface({
  contextPanelOpen,
  handleResizeStart,
  hasSelection,
  panelRef,
  panelWidth,
  selectionPanelsProps,
}: MapContextPanelSurfaceProps) {
  if (!contextPanelOpen) return null

  return (
    <aside
      ref={panelRef}
      className="map-context-panel"
      role="complementary"
      aria-label="Map selection detail"
      style={{ flexBasis: panelWidth, width: panelWidth }}
    >
      <div
        className="map-context-panel-resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        data-testid="panel-resize-handle"
      />
      <MapInlineDebriefPanel />
      {hasSelection ? (
        <MapSelectionPanels {...selectionPanelsProps} />
      ) : (
        <div className="map-context-panel-empty bp6-text-muted" data-testid="panel-empty-state">
          Select a site, asset, or signal on the map to view details.
          <br /><br />
          Press <kbd>]</kbd> or <kbd>Esc</kbd> to close this panel.
        </div>
      )}
    </aside>
  )
}
