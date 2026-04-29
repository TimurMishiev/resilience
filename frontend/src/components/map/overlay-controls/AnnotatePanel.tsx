import type { MapAnnotation } from '../../../lib/mapAnnotations'
import { formatPoint } from './derivations'

interface AnnotatePanelProps {
  annotations: MapAnnotation[]
  onClearAnnotations: () => void
  onUpdateAnnotationLabel: (annotationId: string, label: string) => void
  onRemoveAnnotation: (annotationId: string) => void
}

export function AnnotatePanel({
  annotations,
  onClearAnnotations,
  onUpdateAnnotationLabel,
  onRemoveAnnotation,
}: AnnotatePanelProps) {
  return (
    <div className="map-annotate-panel" data-testid="map-annotate-panel">
      <div className="map-annotate-panel-header">
        <span className="map-annotate-panel-title">TEMPORARY ANNOTATIONS</span>
        <button
          type="button"
          className="map-annotate-panel-action"
          onClick={onClearAnnotations}
          disabled={annotations.length === 0}
        >
          Clear all
        </button>
      </div>

      <div className="map-annotate-panel-body">
        <p className="map-annotate-panel-hint">
          Click the map to drop session-local pins. Annotations stay on this client only and do not change selection or route state.
        </p>

        {annotations.length === 0 ? (
          <p className="map-annotate-panel-hint">No temporary annotations yet.</p>
        ) : (
          <div className="map-annotate-panel-list">
            {annotations.map(annotation => (
              <div key={annotation.id} className="map-annotate-panel-item">
                <input
                  type="text"
                  className="map-annotate-panel-input"
                  aria-label="Annotation label"
                  maxLength={120}
                  value={annotation.label}
                  onChange={event => onUpdateAnnotationLabel(annotation.id, event.target.value)}
                />
                <div className="map-annotate-panel-coordinates mono">
                  {formatPoint(annotation)}
                </div>
                <button
                  type="button"
                  className="map-annotate-panel-action"
                  onClick={() => onRemoveAnnotation(annotation.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
