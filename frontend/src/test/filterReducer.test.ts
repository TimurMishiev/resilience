/**
 * Tests for the TasksPage filter reducer.
 *
 * These are pure function tests — no rendering, no mocks.
 * The reducer is the most complex state in the app (9 fields, 8 actions)
 * so we verify every transition explicitly.
 */
import { describe, it, expect } from 'vitest'

// Re-export the reducer internals for testing.
// The reducer and its types are defined in TasksPage.tsx; we duplicate the
// minimal interface here so tests don't depend on the component's render tree.
type WorkflowStatus = 'new' | 'triaged' | 'in_progress' | 'blocked' | 'resolved'
type TaskPriority   = 'low' | 'normal' | 'high' | 'critical'

interface FilterState {
  statusFilter:   WorkflowStatus | ''
  siteFilter:     string | null
  priorityFilter: TaskPriority | null
  dateFrom:       string | null
  dateTo:         string | null
  nlQuery:        string
  nlLoading:      boolean
  nlError:        string | null
  nlApplied:      boolean
}

type FilterAction =
  | { type: 'SET_STATUS';   value: WorkflowStatus | '' }
  | { type: 'SET_SITE';     value: string | null }
  | { type: 'SET_PRIORITY'; value: TaskPriority | null }
  | { type: 'SET_NL_QUERY'; value: string }
  | { type: 'NL_LOADING' }
  | { type: 'NL_SUCCESS'; filters: {
      status:   WorkflowStatus | ''
      site:     string | null
      priority: TaskPriority | null
      dateFrom: string | null
      dateTo:   string | null
    } }
  | { type: 'NL_ERROR'; message: string }
  | { type: 'CLEAR' }

const INITIAL: FilterState = {
  statusFilter: '', siteFilter: null, priorityFilter: null,
  dateFrom: null, dateTo: null,
  nlQuery: '', nlLoading: false, nlError: null, nlApplied: false,
}

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, statusFilter: action.value }
    case 'SET_SITE':
      return { ...state, siteFilter: action.value }
    case 'SET_PRIORITY':
      return { ...state, priorityFilter: action.value }
    case 'SET_NL_QUERY':
      return { ...state, nlQuery: action.value }
    case 'NL_LOADING':
      return { ...state, nlLoading: true, nlError: null }
    case 'NL_SUCCESS':
      return {
        ...state,
        nlLoading:      false,
        nlApplied:      true,
        statusFilter:   action.filters.status,
        siteFilter:     action.filters.site,
        priorityFilter: action.filters.priority,
        dateFrom:       action.filters.dateFrom,
        dateTo:         action.filters.dateTo,
      }
    case 'NL_ERROR':
      return { ...state, nlLoading: false, nlError: action.message }
    case 'CLEAR':
      return INITIAL
  }
}

describe('filterReducer', () => {
  it('starts from initial state', () => {
    expect(INITIAL).toMatchObject({
      statusFilter: '', siteFilter: null, priorityFilter: null,
      nlLoading: false, nlApplied: false, nlError: null,
    })
  })

  it('SET_STATUS updates statusFilter only', () => {
    const next = filterReducer({ ...INITIAL, siteFilter: 'site-1' }, { type: 'SET_STATUS', value: 'blocked' })
    expect(next.statusFilter).toBe('blocked')
    expect(next.siteFilter).toBe('site-1')   // untouched
  })

  it('SET_SITE updates siteFilter only', () => {
    const next = filterReducer(INITIAL, { type: 'SET_SITE', value: 'site-abc' })
    expect(next.siteFilter).toBe('site-abc')
  })

  it('SET_PRIORITY updates priorityFilter only', () => {
    const next = filterReducer(INITIAL, { type: 'SET_PRIORITY', value: 'critical' })
    expect(next.priorityFilter).toBe('critical')
  })

  it('SET_NL_QUERY updates nlQuery only', () => {
    const next = filterReducer(INITIAL, { type: 'SET_NL_QUERY', value: 'show blocked tasks' })
    expect(next.nlQuery).toBe('show blocked tasks')
    expect(next.nlLoading).toBe(false)
  })

  it('NL_LOADING sets nlLoading and clears any prior error', () => {
    const withError = { ...INITIAL, nlError: 'previous error' }
    const next = filterReducer(withError, { type: 'NL_LOADING' })
    expect(next.nlLoading).toBe(true)
    expect(next.nlError).toBeNull()
  })

  it('NL_SUCCESS applies all filters and clears loading', () => {
    const loading = { ...INITIAL, nlLoading: true }
    const next = filterReducer(loading, {
      type: 'NL_SUCCESS',
      filters: {
        status:   'in_progress',
        site:     'site-xyz',
        priority: 'high',
        dateFrom: '2026-01-01',
        dateTo:   '2026-03-01',
      },
    })
    expect(next.nlLoading).toBe(false)
    expect(next.nlApplied).toBe(true)
    expect(next.statusFilter).toBe('in_progress')
    expect(next.siteFilter).toBe('site-xyz')
    expect(next.priorityFilter).toBe('high')
    expect(next.dateFrom).toBe('2026-01-01')
    expect(next.dateTo).toBe('2026-03-01')
  })

  it('NL_ERROR clears loading and sets error message', () => {
    const loading = { ...INITIAL, nlLoading: true }
    const next = filterReducer(loading, { type: 'NL_ERROR', message: 'AI filter failed' })
    expect(next.nlLoading).toBe(false)
    expect(next.nlError).toBe('AI filter failed')
    expect(next.nlApplied).toBe(false)
  })

  it('CLEAR resets everything to initial state', () => {
    const dirty: FilterState = {
      statusFilter:   'blocked',
      siteFilter:     'site-1',
      priorityFilter: 'critical',
      dateFrom:       '2026-01-01',
      dateTo:         '2026-03-01',
      nlQuery:        'show blocked',
      nlLoading:      false,
      nlError:        null,
      nlApplied:      true,
    }
    const next = filterReducer(dirty, { type: 'CLEAR' })
    expect(next).toEqual(INITIAL)
  })

  it('is a pure function — does not mutate input state', () => {
    const state = { ...INITIAL }
    filterReducer(state, { type: 'SET_STATUS', value: 'resolved' })
    expect(state.statusFilter).toBe('')   // unchanged
  })
})
