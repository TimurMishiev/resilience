interface ToolToggleStripProps {
  annotationMode: boolean
  rangeRingMode: boolean
  sectorMode: boolean
  bearingLineMode: boolean
  measurementMode: boolean
  onToggleAnnotations: () => void
  onToggleRangeRings: () => void
  onToggleSector: () => void
  onToggleBearingLine: () => void
  onToggleMeasurement: () => void
}

export function ToolToggleStrip({
  annotationMode,
  rangeRingMode,
  sectorMode,
  bearingLineMode,
  measurementMode,
  onToggleAnnotations,
  onToggleRangeRings,
  onToggleSector,
  onToggleBearingLine,
  onToggleMeasurement,
}: ToolToggleStripProps) {
  return (
    <div className="map-tool-row">
      <div
        className={`map-annotate-toggle${annotationMode ? ' map-annotate-toggle--active' : ''}`}
        onClick={onToggleAnnotations}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleAnnotations()
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={annotationMode}
        aria-label="Toggle map annotation tool"
      >
        <span className="map-annotate-toggle-dot" />
        ANNOTATE {annotationMode ? 'ON' : 'OFF'}
      </div>

      <div
        className={`map-range-toggle${rangeRingMode ? ' map-range-toggle--active' : ''}`}
        onClick={onToggleRangeRings}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleRangeRings()
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={rangeRingMode}
        aria-label="Toggle map range ring tool"
      >
        <span className="map-range-toggle-dot" />
        RANGE {rangeRingMode ? 'ON' : 'OFF'}
      </div>

      <div
        className={`map-sector-toggle${sectorMode ? ' map-sector-toggle--active' : ''}`}
        onClick={onToggleSector}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleSector()
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={sectorMode}
        aria-label="Toggle map sector tool"
      >
        <span className="map-sector-toggle-dot" />
        SECTOR {sectorMode ? 'ON' : 'OFF'}
      </div>

      <div
        className={`map-bearing-toggle${bearingLineMode ? ' map-bearing-toggle--active' : ''}`}
        onClick={onToggleBearingLine}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleBearingLine()
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={bearingLineMode}
        aria-label="Toggle map bearing line tool"
      >
        <span className="map-bearing-toggle-dot" />
        BEARING {bearingLineMode ? 'ON' : 'OFF'}
      </div>

      <div
        className={`map-measure-toggle${measurementMode ? ' map-measure-toggle--active' : ''}`}
        onClick={onToggleMeasurement}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleMeasurement()
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={measurementMode}
        aria-label="Toggle map measurement tool"
      >
        <span className="map-measure-toggle-dot" />
        MEASURE {measurementMode ? 'ON' : 'OFF'}
      </div>
    </div>
  )
}
