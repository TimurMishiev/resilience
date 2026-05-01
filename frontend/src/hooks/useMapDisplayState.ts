import { useState } from 'react'
import type { MapStyleKey } from './useMapLibreEngine'
import type { MapOverlayControlsProps } from '../components/map/MapOverlayControls'

type MapDisplayStateOwnedProps =
  | 'loading'
  | 'error'
  | 'mapStyle'
  | 'pulseCount'
  | 'signalError'
  | 'showCoverage'
  | 'showChokepoints'
  | 'showTrails'
  | 'trailWindowMinutes'
  | 'showSignals'
  | 'showHeatmap'
  | 'showReplayPulses'
  | 'telemetryConnected'
  | 'onMapStyleChange'
  | 'onToggleCoverage'
  | 'onToggleChokepoints'
  | 'onToggleTrails'
  | 'onTrailWindowChange'
  | 'onToggleSignals'
  | 'onToggleHeatmap'
  | 'onToggleReplayPulses'

type UseMapDisplayStateInput = Omit<MapOverlayControlsProps, MapDisplayStateOwnedProps>

interface MapDisplayStatusProps {
  error: string | null
  loading: boolean
  pulseCount: number
  signalError: Error | null
  telemetryConnected: boolean
}

export function useMapDisplayState(input: UseMapDisplayStateInput) {
  const [showSignals, setShowSignals] = useState(true)
  const [showCoverage, setShowCoverage] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showChokepoints, setShowChokepoints] = useState(true)
  const [showTrails, setShowTrails] = useState(true)
  // Replay event pulses default ON. Effective only while replaying.
  const [showReplayPulses, setShowReplayPulses] = useState(true)
  const [trailWindowMinutes, setTrailWindowMinutes] = useState(30)
  const [mapStyle, setMapStyle] = useState<MapStyleKey>('tactical')

  const buildOverlayControlsProps = ({
    error,
    loading,
    pulseCount,
    signalError,
    telemetryConnected,
  }: MapDisplayStatusProps): MapOverlayControlsProps => ({
    ...input,
    error,
    loading,
    mapStyle,
    onMapStyleChange: setMapStyle,
    onToggleChokepoints: () => setShowChokepoints((value) => !value),
    onToggleCoverage: () => setShowCoverage((value) => !value),
    onToggleHeatmap: () => setShowHeatmap((value) => !value),
    onToggleReplayPulses: () => setShowReplayPulses((value) => !value),
    onToggleSignals: () => setShowSignals((value) => !value),
    onToggleTrails: () => setShowTrails((value) => !value),
    pulseCount,
    showChokepoints,
    showCoverage,
    showHeatmap,
    showReplayPulses,
    showSignals,
    showTrails,
    signalError,
    telemetryConnected,
    trailWindowMinutes,
    onTrailWindowChange: setTrailWindowMinutes,
  })

  return {
    buildOverlayControlsProps,
    mapStyle,
    showChokepoints,
    showCoverage,
    showHeatmap,
    showReplayPulses,
    showSignals,
    showTrails,
    trailWindowMinutes,
  }
}
