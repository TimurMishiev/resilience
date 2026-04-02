import { Button, ButtonGroup, Callout, FormGroup, HTMLSelect, NumericInput } from '@blueprintjs/core'
import type { ConditionRow } from './types'
import { SIGNAL_TYPE_OPTIONS } from './types'

interface CompoundBuilderProps {
  operator:   'AND' | 'OR'
  conditions: ConditionRow[]
  onOperatorChange:  (op: 'AND' | 'OR') => void
  onConditionChange: (index: number, field: keyof ConditionRow, value: unknown) => void
  onAddCondition:    () => void
  onRemoveCondition: (index: number) => void
}

export function CompoundBuilder({
  operator, conditions,
  onOperatorChange, onConditionChange, onAddCondition, onRemoveCondition,
}: CompoundBuilderProps) {
  return (
    <div className="compound-builder">
      <div className="compound-operator-row">
        <span className="bp6-text-muted" style={{ fontSize: 11, marginRight: 8 }}>MATCH</span>
        <ButtonGroup>
          <Button
            small
            active={operator === 'AND'}
            intent={operator === 'AND' ? 'primary' : 'none'}
            onClick={() => onOperatorChange('AND')}
          >
            ALL of (AND)
          </Button>
          <Button
            small
            active={operator === 'OR'}
            intent={operator === 'OR' ? 'warning' : 'none'}
            onClick={() => onOperatorChange('OR')}
          >
            ANY of (OR)
          </Button>
        </ButtonGroup>
        <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 8 }}>
          these conditions
        </span>
      </div>

      {conditions.map((cond, i) => (
        <div key={cond._key} className="compound-condition-row">
          <div className="compound-condition-header">
            <span className="bp6-text-muted" style={{ fontSize: 10, fontWeight: 600 }}>
              CONDITION {i + 1}
            </span>
            <Button
              icon="cross"
              minimal
              small
              disabled={conditions.length <= 2}
              onClick={() => onRemoveCondition(i)}
              title={conditions.length <= 2 ? 'Compound rules need at least 2 conditions' : 'Remove condition'}
            />
          </div>

          <FormGroup label="Signal Type" style={{ marginBottom: 6 }}>
            <HTMLSelect
              value={cond.signal_type}
              onChange={e => onConditionChange(i, 'signal_type', e.target.value)}
              fill
            >
              <option value="">Any signal type</option>
              {SIGNAL_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </HTMLSelect>
          </FormGroup>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormGroup label="Proximity (km)" style={{ marginBottom: 6 }}>
              <NumericInput
                value={cond.proximity_km}
                onValueChange={v => onConditionChange(i, 'proximity_km', v)}
                min={1} max={5000} fill
              />
            </FormGroup>

            <FormGroup label="Min Magnitude" style={{ marginBottom: 6 }}>
              <NumericInput
                value={cond.magnitude_min === '' ? '' : cond.magnitude_min}
                onValueChange={(v, s) => onConditionChange(i, 'magnitude_min', s === '' ? '' : v)}
                min={0} max={10} fill placeholder="—"
              />
            </FormGroup>
          </div>
        </div>
      ))}

      <Button
        icon="plus"
        minimal
        small
        intent="primary"
        onClick={onAddCondition}
        style={{ marginTop: 4 }}
      >
        Add condition
      </Button>

      <Callout intent="primary" compact style={{ marginTop: 12, fontSize: 12 }}>
        {operator === 'AND'
          ? 'All conditions must be met. Non-matching signal types will be looked up from recent DB history.'
          : 'Any single condition is sufficient to fire the rule.'
        }
      </Callout>
    </div>
  )
}
