import { useState } from 'react'
import {
  Button, Callout, Dialog, DialogBody, DialogFooter,
  FormGroup, HTMLSelect, InputGroup,
} from '@blueprintjs/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { injectSignal } from '../../api/signals'
import type { SignalType } from '../../api/types'

const SIGNAL_TYPES: SignalType[] = [
  'aircraft_position', 'vessel_position', 'seismic_event',
  'gps_jamming', 'wildfire', 'conflict_event', 'disaster_alert', 'manual',
]

const TYPE_LABELS: Record<string, string> = {
  aircraft_position: 'Aircraft',
  vessel_position:   'Vessel',
  seismic_event:     'Seismic',
  gps_jamming:       'GPS Jam',
  wildfire:          'Wildfire',
  conflict_event:    'Conflict',
  disaster_alert:    'Disaster',
  manual:            'Manual',
  ais_gap:           'AIS Gap',
}

export default function InjectDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [signalType, setSignalType] = useState<SignalType>('manual')
  const [lat,        setLat]        = useState('')
  const [lng,        setLng]        = useState('')
  const [magnitude,  setMagnitude]  = useState('')
  const [note,       setNote]       = useState('')
  const [error,      setError]      = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: injectSignal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] })
      queryClient.invalidateQueries({ queryKey: ['signal_rule_matches'] })
      onClose()
      setLat(''); setLng(''); setMagnitude(''); setNote(''); setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  function handleSubmit() {
    const latN = parseFloat(lat)
    const lngN = parseFloat(lng)
    if (isNaN(latN) || latN < -90  || latN > 90)  { setError('Latitude must be between -90 and 90');   return }
    if (isNaN(lngN) || lngN < -180 || lngN > 180) { setError('Longitude must be between -180 and 180'); return }
    setError(null)
    mutate({ signal_type: signalType, lat: latN, lng: lngN,
             magnitude: magnitude ? parseFloat(magnitude) : null,
             note: note || null })
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Inject Signal" style={{ width: 420 }}>
      <DialogBody>
        {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{error}</Callout>}
        <FormGroup label="Signal Type" labelFor="inject-type">
          <HTMLSelect id="inject-type" value={signalType} fill
            onChange={e => setSignalType(e.target.value as SignalType)}>
            {SIGNAL_TYPES.map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
            ))}
          </HTMLSelect>
        </FormGroup>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FormGroup label="Latitude" labelFor="inject-lat" helperText="-90 to 90">
            <InputGroup id="inject-lat" placeholder="e.g. 33.5" value={lat}
              onChange={e => setLat(e.target.value)} />
          </FormGroup>
          <FormGroup label="Longitude" labelFor="inject-lng" helperText="-180 to 180">
            <InputGroup id="inject-lng" placeholder="e.g. 44.3" value={lng}
              onChange={e => setLng(e.target.value)} />
          </FormGroup>
        </div>
        <FormGroup label="Magnitude" labelFor="inject-mag" helperText="Optional — seismic / wildfire / GPS jamming">
          <InputGroup id="inject-mag" placeholder="e.g. 4.5" value={magnitude}
            onChange={e => setMagnitude(e.target.value)} />
        </FormGroup>
        <FormGroup label="Note" labelFor="inject-note" helperText="Optional — stored in raw_payload">
          <InputGroup id="inject-note" placeholder="e.g. Demo injection for briefing"
            value={note} onChange={e => setNote(e.target.value)} />
        </FormGroup>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button intent="primary" onClick={handleSubmit} loading={isPending}>
              Inject &amp; Evaluate Rules
            </Button>
          </>
        }
      />
    </Dialog>
  )
}
