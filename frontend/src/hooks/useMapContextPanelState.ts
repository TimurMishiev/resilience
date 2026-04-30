import { useCallback, useEffect, useRef, useState } from 'react'

type UseMapContextPanelStateArgs = {
  annotationMode: boolean
  bearingLineMode: boolean
  contextHasSelection: boolean
  disableAnnotations: () => void
  disableBearingLine: () => void
  disableMeasurement: () => void
  disableRangeRings: () => void
  disableSector: () => void
  mapLoaded: boolean
  measurementMode: boolean
  onClearSelection: () => void
  rangeRingMode: boolean
  resize: () => void
  sectorMode: boolean
}

export function useMapContextPanelState({
  annotationMode,
  bearingLineMode,
  contextHasSelection,
  disableAnnotations,
  disableBearingLine,
  disableMeasurement,
  disableRangeRings,
  disableSector,
  mapLoaded,
  measurementMode,
  onClearSelection,
  rangeRingMode,
  resize,
  sectorMode,
}: UseMapContextPanelStateArgs) {
  const [panelForceOpen, setPanelForceOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(360)
  const panelRef = useRef<HTMLElement>(null)

  const contextPanelOpen = contextHasSelection || panelForceOpen

  const closePanel = useCallback(() => {
    setPanelForceOpen(false)
    onClearSelection()
  }, [onClearSelection])

  useEffect(() => {
    if (!mapLoaded) return
    const frame = requestAnimationFrame(() => resize())
    return () => cancelAnimationFrame(frame)
  }, [contextPanelOpen, mapLoaded, panelWidth, resize])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (event.key === ']') {
        event.preventDefault()
        if (contextPanelOpen) {
          closePanel()
        } else {
          setPanelForceOpen(true)
        }
        return
      }

      if (event.key === 'Escape') {
        if (measurementMode) {
          disableMeasurement()
          return
        }
        if (annotationMode) {
          disableAnnotations()
          return
        }
        if (rangeRingMode) {
          disableRangeRings()
          return
        }
        if (sectorMode) {
          disableSector()
          return
        }
        if (bearingLineMode) {
          disableBearingLine()
          return
        }
        if (contextPanelOpen) {
          closePanel()
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    annotationMode,
    bearingLineMode,
    closePanel,
    contextPanelOpen,
    disableAnnotations,
    disableBearingLine,
    disableMeasurement,
    disableRangeRings,
    disableSector,
    measurementMode,
    rangeRingMode,
    sectorMode,
  ])

  const handleResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelRef.current?.offsetWidth ?? 360

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      setPanelWidth(Math.min(600, Math.max(240, startWidth + delta)))
    }

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  return {
    closePanel,
    contextPanelOpen,
    handleResizeStart,
    panelRef,
    panelWidth,
  }
}
