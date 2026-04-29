import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { MapOverlayControls } from '../components/map/MapOverlayControls'

type ControlsProps = ComponentProps<typeof MapOverlayControls>

function makeProps(overrides: Partial<ControlsProps> = {}): ControlsProps {
  return {
    loading: false,
    error: null,
    isReplaying: false,
    telemetryConnected: true,
    signalError: null,
    mapStyle: 'tactical',
    showCoverage: false,
    showChokepoints: false,
    showTrails: false,
    trailWindowMinutes: 60,
    showSignals: false,
    showHeatmap: false,
    showReplayPulses: false,
    pulseCount: 0,
    annotationMode: false,
    annotations: [],
    rangeRingMode: false,
    rangeRingAnchor: null,
    rangeRingInputs: ['10', '25', '50'],
    rangeRingRadiiKm: [],
    rangeRingUnit: 'nm',
    sectorMode: false,
    sectorAnchor: null,
    sectorDegreesInput: '',
    sectorDegrees: null,
    sectorArcInput: '',
    sectorArcDegrees: null,
    sectorDistanceInput: '',
    sectorDistanceKm: null,
    sectorUnit: 'nm',
    bearingLineMode: false,
    bearingLineAnchor: null,
    bearingLineDegreesInput: '',
    bearingLineDegrees: null,
    bearingLineDistanceInput: '',
    bearingLineDistanceKm: null,
    bearingLineUnit: 'nm',
    measurementMode: false,
    measurementPoints: [],
    onMapStyleChange: vi.fn(),
    onToggleCoverage: vi.fn(),
    onToggleChokepoints: vi.fn(),
    onToggleTrails: vi.fn(),
    onTrailWindowChange: vi.fn(),
    onToggleSignals: vi.fn(),
    onToggleHeatmap: vi.fn(),
    onToggleReplayPulses: vi.fn(),
    onToggleAnnotations: vi.fn(),
    onClearAnnotations: vi.fn(),
    onUpdateAnnotationLabel: vi.fn(),
    onRemoveAnnotation: vi.fn(),
    onToggleRangeRings: vi.fn(),
    onClearRangeRings: vi.fn(),
    onUpdateRangeRingInput: vi.fn(),
    onSetRangeRingUnit: vi.fn(),
    onToggleSector: vi.fn(),
    onClearSector: vi.fn(),
    onUpdateSectorDegreesInput: vi.fn(),
    onUpdateSectorArcInput: vi.fn(),
    onUpdateSectorDistanceInput: vi.fn(),
    onSetSectorUnit: vi.fn(),
    onToggleBearingLine: vi.fn(),
    onClearBearingLine: vi.fn(),
    onUpdateBearingLineDegreesInput: vi.fn(),
    onUpdateBearingLineDistanceInput: vi.fn(),
    onSetBearingLineUnit: vi.fn(),
    onToggleMeasurement: vi.fn(),
    onClearMeasurement: vi.fn(),
    ...overrides,
  }
}

describe('MapOverlayControls — global overlays', () => {
  it('renders nothing chrome when loading is false and error is null', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(document.querySelector('.map-overlay--loading')).toBeNull()
    expect(document.querySelector('.map-overlay--error')).toBeNull()
  })

  it('renders the loading spinner when loading is true', () => {
    render(<MapOverlayControls {...makeProps({ loading: true })} />)
    expect(document.querySelector('.map-overlay--loading')).not.toBeNull()
  })

  it('renders the error callout with the given message', () => {
    render(<MapOverlayControls {...makeProps({ error: 'Backend went away' })} />)
    expect(screen.getByText(/Backend went away/)).toBeInTheDocument()
  })
})

describe('MapOverlayControls — telemetry + replay state', () => {
  it('shows TELEMETRY LIVE badge when connected and not replaying', () => {
    render(<MapOverlayControls {...makeProps({ telemetryConnected: true })} />)
    expect(screen.getByText('TELEMETRY LIVE')).toBeInTheDocument()
  })

  it('shows TELEMETRY OFFLINE badge when disconnected and not replaying', () => {
    render(<MapOverlayControls {...makeProps({ telemetryConnected: false })} />)
    expect(screen.getByText('TELEMETRY OFFLINE')).toBeInTheDocument()
  })

  it('hides telemetry badge entirely in replay mode', () => {
    render(<MapOverlayControls {...makeProps({ isReplaying: true, telemetryConnected: true })} />)
    expect(screen.queryByText(/TELEMETRY/)).toBeNull()
  })

  it('renders the replay-limitations callout in replay mode', () => {
    render(<MapOverlayControls {...makeProps({ isReplaying: true })} />)
    expect(screen.getByText(/Replay limitations/i)).toBeInTheDocument()
  })

  it('renders the signal-error callout when live + showSignals + signalError', () => {
    render(<MapOverlayControls {...makeProps({
      showSignals: true,
      signalError: new Error('baseline drift'),
    })} />)
    expect(screen.getByText(/Signal baseline sync degraded/i)).toBeInTheDocument()
  })

  it('does not render the signal-error callout in replay mode', () => {
    render(<MapOverlayControls {...makeProps({
      isReplaying: true,
      showSignals: true,
      signalError: new Error('baseline drift'),
    })} />)
    expect(screen.queryByText(/Signal baseline sync degraded/i)).toBeNull()
  })
})

describe('MapOverlayControls — style switcher', () => {
  it('renders one button per style with the active style highlighted', () => {
    render(<MapOverlayControls {...makeProps({ mapStyle: 'satellite' })} />)
    const switcher = document.querySelector('.map-style-switcher')
    expect(switcher).not.toBeNull()
    const tactical = within(switcher as HTMLElement).getByText('Tactical')
    const satellite = within(switcher as HTMLElement).getByText('Satellite')
    const street = within(switcher as HTMLElement).getByText('Street')
    expect(satellite.className).toContain('map-style-btn--active')
    expect(tactical.className).not.toContain('map-style-btn--active')
    expect(street.className).not.toContain('map-style-btn--active')
  })

  it('fires onMapStyleChange when a style button is clicked', async () => {
    const onMapStyleChange = vi.fn()
    const user = userEvent.setup()
    render(<MapOverlayControls {...makeProps({ onMapStyleChange })} />)
    await user.click(screen.getByText('Street'))
    expect(onMapStyleChange).toHaveBeenCalledWith('street')
  })
})

describe('MapOverlayControls — layer toggles', () => {
  it('hides the coverage legend when showCoverage is false', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(document.querySelector('.map-coverage-legend')).toBeNull()
    expect(screen.getByText(/COVERAGE OFF/)).toBeInTheDocument()
  })

  it('shows the coverage legend when showCoverage is true and the toggle reads ON', () => {
    render(<MapOverlayControls {...makeProps({ showCoverage: true })} />)
    expect(document.querySelector('.map-coverage-legend')).not.toBeNull()
    expect(screen.getByText(/COVERAGE ON/)).toBeInTheDocument()
  })

  it('fires onToggleCoverage when the coverage toggle is clicked', async () => {
    const onToggleCoverage = vi.fn()
    const user = userEvent.setup()
    render(<MapOverlayControls {...makeProps({ onToggleCoverage })} />)
    await user.click(screen.getByLabelText('Toggle sensor coverage'))
    expect(onToggleCoverage).toHaveBeenCalledOnce()
  })

  it('hides the chokepoint legend when showChokepoints is false', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(document.querySelector('.map-chokepoint-legend')).toBeNull()
  })

  it('shows the chokepoint legend with all 4 levels when showChokepoints is true', () => {
    render(<MapOverlayControls {...makeProps({ showChokepoints: true })} />)
    const legend = document.querySelector('.map-chokepoint-legend') as HTMLElement | null
    expect(legend).not.toBeNull()
    expect(within(legend!).getByText('Monitor')).toBeInTheDocument()
    expect(within(legend!).getByText('Constrained')).toBeInTheDocument()
    expect(within(legend!).getByText('Contested')).toBeInTheDocument()
    expect(within(legend!).getByText('Closed')).toBeInTheDocument()
  })

  it('hides the trails toggle outside replay mode', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(screen.queryByLabelText('Toggle asset trails')).toBeNull()
  })

  it('shows the trails toggle in replay mode and the window selector when trails on', () => {
    render(<MapOverlayControls {...makeProps({
      isReplaying: true,
      showTrails: true,
      trailWindowMinutes: 120,
    })} />)
    expect(screen.getByLabelText('Toggle asset trails')).toBeInTheDocument()
    const windowSelect = screen.getByLabelText('Trail window') as HTMLSelectElement
    expect(windowSelect.value).toBe('120')
  })

  it('hides replay pulses toggle outside replay; renders count badge when on with pulses', () => {
    const liveResult = render(<MapOverlayControls {...makeProps()} />)
    expect(screen.queryByTestId('map-replay-pulses-toggle')).toBeNull()
    liveResult.unmount()

    render(<MapOverlayControls {...makeProps({
      isReplaying: true,
      showReplayPulses: true,
      pulseCount: 7,
    })} />)
    const toggle = screen.getByTestId('map-replay-pulses-toggle')
    expect(toggle).toBeInTheDocument()
    expect(within(toggle).getByText('7')).toBeInTheDocument()
  })

  it('shows the signal legend only when showSignals is true', () => {
    const offResult = render(<MapOverlayControls {...makeProps()} />)
    expect(document.querySelector('.map-signal-legend')).toBeNull()
    offResult.unmount()

    render(<MapOverlayControls {...makeProps({ showSignals: true })} />)
    expect(document.querySelector('.map-signal-legend')).not.toBeNull()
  })

  it('shows the heatmap legend only when both showSignals and showHeatmap are true', () => {
    const heatmapOnlyResult = render(<MapOverlayControls {...makeProps({ showHeatmap: true })} />)
    expect(document.querySelector('.map-heatmap-legend')).toBeNull()
    heatmapOnlyResult.unmount()

    render(<MapOverlayControls {...makeProps({ showSignals: true, showHeatmap: true })} />)
    expect(document.querySelector('.map-heatmap-legend')).not.toBeNull()
  })
})

describe('MapOverlayControls — tool toggles', () => {
  it('renders all 5 tool toggles in their OFF state by default', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(screen.getByText(/ANNOTATE OFF/)).toBeInTheDocument()
    expect(screen.getByText(/RANGE OFF/)).toBeInTheDocument()
    expect(screen.getByText(/SECTOR OFF/)).toBeInTheDocument()
    expect(screen.getByText(/BEARING OFF/)).toBeInTheDocument()
    expect(screen.getByText(/MEASURE OFF/)).toBeInTheDocument()
  })

  it('reflects active tool state via aria-pressed on each tool toggle', () => {
    render(<MapOverlayControls {...makeProps({
      annotationMode: true,
      rangeRingMode: true,
      sectorMode: true,
      bearingLineMode: true,
      measurementMode: true,
    })} />)
    expect(screen.getByLabelText('Toggle map annotation tool').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Toggle map range ring tool').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Toggle map sector tool').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Toggle map bearing line tool').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Toggle map measurement tool').getAttribute('aria-pressed')).toBe('true')
  })

  it('fires the correct callback when each tool toggle is clicked', async () => {
    const props = makeProps()
    const user = userEvent.setup()
    render(<MapOverlayControls {...props} />)
    await user.click(screen.getByLabelText('Toggle map annotation tool'))
    await user.click(screen.getByLabelText('Toggle map range ring tool'))
    await user.click(screen.getByLabelText('Toggle map sector tool'))
    await user.click(screen.getByLabelText('Toggle map bearing line tool'))
    await user.click(screen.getByLabelText('Toggle map measurement tool'))
    expect(props.onToggleAnnotations).toHaveBeenCalledOnce()
    expect(props.onToggleRangeRings).toHaveBeenCalledOnce()
    expect(props.onToggleSector).toHaveBeenCalledOnce()
    expect(props.onToggleBearingLine).toHaveBeenCalledOnce()
    expect(props.onToggleMeasurement).toHaveBeenCalledOnce()
  })
})

describe('MapOverlayControls — annotate panel', () => {
  it('hides the annotate panel when annotationMode is false', () => {
    render(<MapOverlayControls {...makeProps()} />)
    expect(screen.queryByTestId('map-annotate-panel')).toBeNull()
  })

  it('renders an empty-state hint when annotationMode is on with no annotations', () => {
    render(<MapOverlayControls {...makeProps({ annotationMode: true })} />)
    const panel = screen.getByTestId('map-annotate-panel')
    expect(within(panel).getByText(/No temporary annotations yet/)).toBeInTheDocument()
  })

  it('renders an editable input + remove button per annotation', async () => {
    const onUpdateAnnotationLabel = vi.fn()
    const onRemoveAnnotation = vi.fn()
    const user = userEvent.setup()
    render(<MapOverlayControls {...makeProps({
      annotationMode: true,
      annotations: [
        { id: 'ann-1', lat: 12.34, lng: 56.78, label: 'Alpha' },
      ],
      onUpdateAnnotationLabel,
      onRemoveAnnotation,
    })} />)
    const panel = screen.getByTestId('map-annotate-panel')
    const input = within(panel).getByLabelText('Annotation label') as HTMLInputElement
    expect(input.value).toBe('Alpha')
    await user.type(input, '!')
    expect(onUpdateAnnotationLabel).toHaveBeenCalledWith('ann-1', 'Alpha!')
    await user.click(within(panel).getByText('Remove'))
    expect(onRemoveAnnotation).toHaveBeenCalledWith('ann-1')
  })
})

describe('MapOverlayControls — range ring panel', () => {
  it('renders one input per ring with the provided values', () => {
    render(<MapOverlayControls {...makeProps({
      rangeRingMode: true,
      rangeRingInputs: ['5', '15', '40'],
    })} />)
    const panel = screen.getByTestId('map-range-panel')
    expect((within(panel).getByLabelText('Range ring 1 radius') as HTMLInputElement).value).toBe('5')
    expect((within(panel).getByLabelText('Range ring 2 radius') as HTMLInputElement).value).toBe('15')
    expect((within(panel).getByLabelText('Range ring 3 radius') as HTMLInputElement).value).toBe('40')
  })

  it('shows the anchor coordinate when rangeRingAnchor is set, hint otherwise', () => {
    const noAnchorResult = render(<MapOverlayControls {...makeProps({ rangeRingMode: true })} />)
    expect(screen.getByText(/No range anchor yet/)).toBeInTheDocument()
    noAnchorResult.unmount()

    render(<MapOverlayControls {...makeProps({
      rangeRingMode: true,
      rangeRingAnchor: { lat: 10, lng: 20 },
    })} />)
    expect(screen.getByText('10.0000, 20.0000')).toBeInTheDocument()
  })

  it('fires onSetRangeRingUnit when a unit button is clicked', async () => {
    const onSetRangeRingUnit = vi.fn()
    const user = userEvent.setup()
    render(<MapOverlayControls {...makeProps({
      rangeRingMode: true,
      rangeRingUnit: 'nm',
      onSetRangeRingUnit,
    })} />)
    const panel = screen.getByTestId('map-range-panel')
    await user.click(within(panel).getByText('KM'))
    expect(onSetRangeRingUnit).toHaveBeenCalledWith('km')
  })
})

describe('MapOverlayControls — sector + bearing panels', () => {
  it('renders sector panel with bearing/arc/extent inputs when sectorMode is on', () => {
    render(<MapOverlayControls {...makeProps({
      sectorMode: true,
      sectorAnchor: { lat: 0, lng: 0 },
      sectorDegreesInput: '90',
      sectorArcInput: '45',
      sectorDistanceInput: '50',
    })} />)
    const panel = screen.getByTestId('map-sector-panel')
    expect((within(panel).getByLabelText('Sector bearing degrees') as HTMLInputElement).value).toBe('90')
    expect((within(panel).getByLabelText('Sector arc degrees') as HTMLInputElement).value).toBe('45')
    expect((within(panel).getByLabelText('Sector extent') as HTMLInputElement).value).toBe('50')
  })

  it('renders bearing line panel with degrees/extent inputs when bearingLineMode is on', () => {
    render(<MapOverlayControls {...makeProps({
      bearingLineMode: true,
      bearingLineAnchor: { lat: 5, lng: 5 },
      bearingLineDegreesInput: '270',
      bearingLineDistanceInput: '12',
    })} />)
    const panel = screen.getByTestId('map-bearing-panel')
    expect((within(panel).getByLabelText('Bearing degrees') as HTMLInputElement).value).toBe('270')
    expect((within(panel).getByLabelText('Bearing line extent') as HTMLInputElement).value).toBe('12')
  })
})

describe('MapOverlayControls — measurement panel', () => {
  it('shows the empty-state hint with no points', () => {
    render(<MapOverlayControls {...makeProps({ measurementMode: true })} />)
    const panel = screen.getByTestId('map-measure-panel')
    expect(within(panel).getByText(/Click an anchor point on the map/)).toBeInTheDocument()
  })

  it('shows the second-point prompt with one anchor', () => {
    render(<MapOverlayControls {...makeProps({
      measurementMode: true,
      measurementPoints: [{ lat: 0, lng: 0 }],
    })} />)
    const panel = screen.getByTestId('map-measure-panel')
    expect(within(panel).getByText(/Click a second point/)).toBeInTheDocument()
    expect(within(panel).getByText('0.0000, 0.0000')).toBeInTheDocument()
  })

  it('renders distance + bearing labels with two points set', () => {
    render(<MapOverlayControls {...makeProps({
      measurementMode: true,
      measurementPoints: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 0 },
      ],
    })} />)
    const panel = screen.getByTestId('map-measure-panel')
    expect(within(panel).getByText(/Distance/)).toBeInTheDocument()
    expect(within(panel).getByText(/Bearing/)).toBeInTheDocument()
  })
})
