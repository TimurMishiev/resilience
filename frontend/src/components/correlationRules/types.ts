import type { CorrelationRule, SignalType, TaskPriority, RuleConditions } from '../../api/types'
import { isCompoundRule } from '../../api/types'

// ── Signal / priority options ─────────────────────────────────────────────────

export const SIGNAL_TYPE_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'aircraft_position', label: 'Aircraft Position' },
  { value: 'vessel_position',   label: 'Vessel Position'   },
  { value: 'seismic_event',     label: 'Seismic Event'     },
  { value: 'gps_jamming',       label: 'GPS Jamming'       },
  { value: 'wildfire',          label: 'Wildfire'          },
  { value: 'conflict_event',    label: 'Conflict Event'    },
  { value: 'disaster_alert',    label: 'Disaster Alert'    },
  { value: 'ais_gap',           label: 'AIS Gap (vessel dark)' },
  { value: 'manual',            label: 'Manual'            },
]

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low',      label: 'Low'      },
  { value: 'normal',   label: 'Normal'   },
  { value: 'high',     label: 'High'     },
  { value: 'critical', label: 'Critical' },
]

export const PRIORITY_INTENTS: Record<TaskPriority, 'none' | 'primary' | 'warning' | 'danger'> = {
  low:      'none',
  normal:   'primary',
  high:     'warning',
  critical: 'danger',
}

// ── MITRE ATT&CK techniques ───────────────────────────────────────────────────

export interface MitreTechnique {
  id:     string
  name:   string
  tactic: string
}

export const MITRE_TECHNIQUES: MitreTechnique[] = [
  { id: 'T1036',  name: 'Masquerading',                      tactic: 'Defense Evasion'      },
  { id: 'T1040',  name: 'Network Sniffing',                  tactic: 'Credential Access'    },
  { id: 'T1498',  name: 'Network Denial of Service',         tactic: 'Impact'               },
  { id: 'T1562',  name: 'Impair Defenses',                   tactic: 'Defense Evasion'      },
  { id: 'T1565',  name: 'Data Manipulation',                 tactic: 'Impact'               },
  { id: 'T1583',  name: 'Acquire Infrastructure',            tactic: 'Resource Development' },
  { id: 'T1590',  name: 'Gather Victim Network Information', tactic: 'Reconnaissance'       },
  { id: 'T1591',  name: 'Gather Victim Org Information',     tactic: 'Reconnaissance'       },
  { id: 'T0826',  name: 'Loss of Availability',              tactic: 'Impact (ICS)'         },
  { id: 'T0827',  name: 'Loss of Control',                   tactic: 'Impact (ICS)'         },
  { id: 'T0879',  name: 'Damage to Property',                tactic: 'Impact (ICS)'         },
  { id: 'T0880',  name: 'Loss of Safety',                    tactic: 'Impact (ICS)'         },
]

export const MITRE_BY_ID = new Map(MITRE_TECHNIQUES.map(t => [t.id, t]))

// ── Compound builder types ─────────────────────────────────────────────────────

export interface ConditionRow {
  _key:                string
  signal_type:         SignalType | ''
  proximity_km:        number
  magnitude_min:       number | ''
  count_threshold:     number
  time_window_minutes: number
}

const DEFAULT_CONDITION: Omit<ConditionRow, '_key'> = {
  signal_type:         '',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 60,
}

export function newCondition(overrides?: Partial<ConditionRow>): ConditionRow {
  return { ...DEFAULT_CONDITION, ...overrides, _key: crypto.randomUUID() }
}

// ── Form state ─────────────────────────────────────────────────────────────────

export interface RuleFormState {
  name:                string
  description:         string
  is_active:           boolean
  cooldown_minutes:    number
  task_title:          string
  task_description:    string
  task_priority:       TaskPriority
  condition_mode:      'simple' | 'compound'
  signal_type:         SignalType | ''
  proximity_km:        number
  magnitude_min:       number | ''
  count_threshold:     number
  time_window_minutes: number
  compound_operator:   'AND' | 'OR'
  compound_conditions: ConditionRow[]
  area_of_operation_id: string | null
  mitre_tags: string[]
}

export const DEFAULT_FORM: RuleFormState = {
  name:                '',
  description:         '',
  is_active:           true,
  cooldown_minutes:    60,
  task_title:          '',
  task_description:    '',
  task_priority:       'normal',
  condition_mode:      'simple',
  signal_type:         'aircraft_position',
  proximity_km:        50,
  magnitude_min:       '',
  count_threshold:     1,
  time_window_minutes: 10,
  compound_operator:   'AND',
  compound_conditions: [newCondition(), newCondition()],
  area_of_operation_id: null,
  mitre_tags: [],
}

export function ruleToForm(rule: CorrelationRule): RuleFormState {
  const a = rule.actions.create_task ?? {}
  const base = {
    name:                 rule.name,
    description:          rule.description ?? '',
    is_active:            rule.is_active,
    cooldown_minutes:     rule.cooldown_minutes,
    task_title:           a.title       ?? '',
    task_description:     a.description ?? '',
    task_priority:        (a.priority as TaskPriority | undefined) ?? 'normal',
    area_of_operation_id: rule.area_of_operation_id,
    mitre_tags:           rule.mitre_tags ?? [],
  }

  if (isCompoundRule(rule.conditions)) {
    const c = rule.conditions
    return {
      ...DEFAULT_FORM,
      ...base,
      condition_mode:      'compound',
      compound_operator:   c.operator,
      compound_conditions: c.conditions.map(sub => newCondition({
        signal_type:         (sub.signal_type as SignalType | undefined) ?? '',
        proximity_km:        sub.proximity_km        ?? 50,
        magnitude_min:       sub.magnitude_min       ?? '',
        count_threshold:     sub.count_threshold     ?? 1,
        time_window_minutes: sub.time_window_minutes ?? 60,
      })),
    }
  }

  const c = rule.conditions
  return {
    ...DEFAULT_FORM,
    ...base,
    condition_mode:      'simple',
    signal_type:         (c.signal_type as SignalType | undefined) ?? 'aircraft_position',
    proximity_km:        c.proximity_km        ?? 50,
    magnitude_min:       c.magnitude_min       ?? '',
    count_threshold:     c.count_threshold     ?? 1,
    time_window_minutes: c.time_window_minutes ?? 10,
  }
}

export function buildRulePayload(form: RuleFormState) {
  let conditions: RuleConditions

  if (form.condition_mode === 'compound') {
    conditions = {
      operator:   form.compound_operator,
      conditions: form.compound_conditions.map(c => ({
        signal_type:         c.signal_type         || null,
        proximity_km:        c.proximity_km,
        magnitude_min:       c.magnitude_min === '' ? null : c.magnitude_min,
        count_threshold:     c.count_threshold,
        time_window_minutes: c.time_window_minutes,
        site_id:             null,
      })),
    }
  } else {
    conditions = {
      signal_type:         form.signal_type         || null,
      proximity_km:        form.proximity_km,
      magnitude_min:       form.magnitude_min === '' ? null : form.magnitude_min,
      count_threshold:     form.count_threshold,
      time_window_minutes: form.time_window_minutes,
      site_id:             null,
    }
  }

  return {
    name:                 form.name,
    description:          form.description || null,
    is_active:            form.is_active,
    cooldown_minutes:     form.cooldown_minutes,
    area_of_operation_id: form.area_of_operation_id || null,
    mitre_tags:           form.mitre_tags,
    conditions,
    actions: {
      create_task: {
        title:       form.task_title,
        description: form.task_description,
        priority:    form.task_priority,
      },
    },
  }
}

// ── Rule templates ─────────────────────────────────────────────────────────────

type TemplateFormState = Omit<Partial<RuleFormState>, 'compound_conditions'> & {
  compound_conditions?: Omit<ConditionRow, '_key'>[]
}

export interface RuleTemplate {
  id:          string
  name:        string
  description: string
  icon:        string
  tags:        string[]
  form:        TemplateFormState
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id:   'maritime_deception',
    name: 'Maritime Deception Pattern',
    description:
      'Vessel goes AIS-dark (transponder off) while operating near a site — a classic indicator of covert or illicit maritime activity.',
    icon: 'ship',
    tags: ['Vessel Position', 'AIS Gap', 'compound AND'],
    form: {
      name:              'Maritime Deception Pattern',
      description:       'Vessel goes AIS-dark near site',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'vessel_position', proximity_km: 100, magnitude_min: '', count_threshold: 1, time_window_minutes: 60  },
        { signal_type: 'ais_gap',         proximity_km: 100, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
      ],
      task_title:       'Maritime deception pattern — {{site_name}}',
      task_description: 'Vessel position followed by AIS gap within {{proximity_km}}km. Review vessel traffic and confirm no covert approach.',
      task_priority:    'high',
      cooldown_minutes: 120,
      mitre_tags:       ['T1036', 'T1565'],
    },
  },
  {
    id:   'electronic_warfare_precursor',
    name: 'Electronic Warfare Precursor',
    description:
      'GPS jamming co-located with aircraft activity — a classic EW precursor pattern used to mask or support air operations.',
    icon: 'satellite',
    tags: ['GPS Jamming', 'Aircraft Position', 'compound AND'],
    form: {
      name:              'Electronic Warfare Precursor',
      description:       'GPS jamming co-located with aircraft activity',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'gps_jamming',       proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60 },
        { signal_type: 'aircraft_position', proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60 },
      ],
      task_title:       'EW precursor — {{site_name}}',
      task_description: 'GPS jamming and aircraft activity within {{proximity_km}}km. Potential EW precursor. Verify GPS reception and airspace.',
      task_priority:    'critical',
      cooldown_minutes: 60,
      mitre_tags:       ['T1562', 'T0826', 'T1498'],
    },
  },
  {
    id:   'humanitarian_crisis',
    name: 'Humanitarian Crisis Indicator',
    description:
      'A natural disaster alert or armed conflict event near site — triggers a humanitarian response task for any high-consequence signal.',
    icon: 'warning-sign',
    tags: ['Disaster Alert', 'Conflict Event', 'compound OR'],
    form: {
      name:              'Humanitarian Crisis Indicator',
      description:       'Natural disaster or armed conflict detected near site',
      condition_mode:    'compound',
      compound_operator: 'OR',
      compound_conditions: [
        { signal_type: 'disaster_alert', proximity_km: 250, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
        { signal_type: 'conflict_event', proximity_km: 200, magnitude_min: '', count_threshold: 1, time_window_minutes: 120 },
      ],
      task_title:       'Crisis event near {{site_name}}',
      task_description: '{{signal_type}} within {{proximity_km}}km. Assess impact on operations and personnel safety.',
      task_priority:    'high',
      cooldown_minutes: 180,
      mitre_tags:       ['T0879', 'T0880'],
    },
  },
  {
    id:   'seismic_threat',
    name: 'Significant Seismic Activity',
    description:
      'Seismic events M4.5 or greater near a site — may indicate infrastructure risk, liquefaction hazard, or secondary effects.',
    icon: 'pulse',
    tags: ['Seismic Event', 'M4.5+', 'simple'],
    form: {
      name:              'Significant Seismic Activity',
      description:       'Earthquake M4.5+ detected near site',
      condition_mode:    'simple',
      signal_type:       'seismic_event',
      proximity_km:      300,
      magnitude_min:     4.5,
      count_threshold:   1,
      time_window_minutes: 30,
      task_title:       'Seismic event near {{site_name}}',
      task_description: 'Magnitude {{magnitude}} seismic event detected {{proximity_km}}km from site. Assess structural integrity and utility services.',
      task_priority:    'high',
      cooldown_minutes: 240,
      mitre_tags:       ['T0879', 'T0880'],
    },
  },
  {
    id:   'air_approach_warning',
    name: 'Air Approach Warning',
    description:
      'Any aircraft within 50 km of a site. Useful for sites requiring continuous airspace awareness or no-fly enforcement.',
    icon: 'airplane',
    tags: ['Aircraft Position', 'simple'],
    form: {
      name:              'Air Approach Warning',
      description:       'Aircraft within 50km of site',
      condition_mode:    'simple',
      signal_type:       'aircraft_position',
      proximity_km:      50,
      magnitude_min:     '',
      count_threshold:   1,
      time_window_minutes: 15,
      task_title:       'Aircraft activity near {{site_name}}',
      task_description: 'Aircraft detected {{proximity_km}}km from {{site_name}}. Monitor for pattern of life or approach vector.',
      task_priority:    'normal',
      cooldown_minutes: 30,
      mitre_tags:       ['T1590', 'T1591'],
    },
  },
  {
    id:   'multi_domain_convergence',
    name: 'Multi-Domain Threat Convergence',
    description:
      'Conflict activity combined with GPS jamming in the same area — combined-arms indicator requiring immediate escalation.',
    icon: 'shield',
    tags: ['Conflict Event', 'GPS Jamming', 'compound AND'],
    form: {
      name:              'Multi-Domain Threat Convergence',
      description:       'Conflict activity with concurrent GPS jamming',
      condition_mode:    'compound',
      compound_operator: 'AND',
      compound_conditions: [
        { signal_type: 'conflict_event', proximity_km: 200, magnitude_min: '', count_threshold: 1, time_window_minutes: 180 },
        { signal_type: 'gps_jamming',   proximity_km: 150, magnitude_min: '', count_threshold: 1, time_window_minutes: 60  },
      ],
      task_title:       'Multi-domain threat — {{site_name}}',
      task_description: 'Conflict event and GPS jamming within {{proximity_km}}km. Possible combined-arms operation. Initiate security posture review.',
      task_priority:    'critical',
      cooldown_minutes: 90,
      mitre_tags:       ['T0827', 'T0880', 'T1562'],
    },
  },
]

// ── Utilities ─────────────────────────────────────────────────────────────────

export function formatLastFired(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60)    return `${Math.floor(diff)}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
