/**
 * AlertChainDrawer
 *
 * Shows the full intelligence chain for a single SignalRuleMatch:
 *   Signal  →  Rule / Geofence  →  Alert  →  Task  (if any)
 *
 * Rendered as a side drawer that slides in when `match` is set.
 */
import { Drawer, DrawerSize, Tag, Icon, Divider, Callout } from '@blueprintjs/core'
import type { SignalRuleMatch } from '../api/types'
import { SIGNAL_ICON_NAME } from '../lib/signalIcons'
import { humanize } from '../utils/humanize'
import { deriveFreshness, type FreshnessState } from '../lib/freshness'

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function ConfBadge({ value }: { value: number }) {
  const pct   = Math.round(value * 100)
  const intent = pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'danger'
  return <Tag minimal intent={intent}>{pct}% confidence</Tag>
}

function freshnessIntent(state: FreshnessState): 'warning' | 'danger' | 'none' {
  if (state === 'aging') return 'warning'
  if (state === 'stale' || state === 'unavailable') return 'danger'
  return 'none'
}

// ── chain node ─────────────────────────────────────────────────────────────

interface NodeProps {
  icon: string
  label: string
  title: string
  children?: React.ReactNode
  faded?: boolean
}

function ChainNode({ icon, label, title, children, faded }: NodeProps) {
  return (
    <div style={{
      background: faded ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)',
      border: `1px solid ${faded ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)'}`,
      borderRadius: 8,
      padding: '12px 16px',
      opacity: faded ? 0.45 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: children ? 8 : 0 }}>
        <Icon icon={icon as never} size={16} style={{ opacity: 0.7 }} />
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55 }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      {children && <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>{children}</div>}
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
      <Icon icon="arrow-down" size={12} style={{ opacity: 0.35 }} />
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────

interface Props {
  match: SignalRuleMatch | null
  onClose: () => void
  /**
   * Reference clock used for freshness derivation on the Signal node.
   * Callers with a replay-aware clock should pass `asOfMs` here;
   * omit for live-only surfaces.
   */
  referenceTimeMs?: number
}

export default function AlertChainDrawer({ match, onClose, referenceTimeMs }: Props) {
  if (!match) return null

  const isGeofence = Boolean(match.metadata?.geofence_breach)
  const distKm     = match.metadata?.distance_km as number | undefined
  const geofenceKm = match.metadata?.geofence_radius_km as number | undefined

  const signalFreshness: FreshnessState | null =
    match.signal && referenceTimeMs != null
      ? deriveFreshness(Date.parse(match.signal.occurred_at), referenceTimeMs)
      : null

  const alertStatusIntent: Record<string, 'danger' | 'warning' | 'primary' | 'success' | 'none'> = {
    unacknowledged: 'danger',
    acknowledged:   'warning',
    investigating:  'primary',
    closed:         'success',
  }

  return (
    <Drawer
      isOpen={Boolean(match)}
      onClose={onClose}
      title="Intelligence Chain"
      size={DrawerSize.SMALL}
      position="right"
    >
      <div style={{ padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── SIGNAL ── */}
        <ChainNode
          icon={match.signal ? (SIGNAL_ICON_NAME[match.signal.signal_type] ?? 'dot') : 'dot'}
          label="Signal"
          title={match.signal ? humanize(match.signal.signal_type) : 'Signal deleted'}
          faded={!match.signal}
        >
          {match.signal && (
            <>
              <div>Source: <code>{match.signal.source}</code></div>
              <div>
                Occurred: {fmt(match.signal.occurred_at)}
                {signalFreshness && signalFreshness !== 'fresh' && (
                  <>
                    {' '}
                    <Tag
                      minimal
                      intent={freshnessIntent(signalFreshness)}
                      style={{ fontSize: 10, marginLeft: 4 }}
                      data-testid="alert-chain-signal-freshness"
                    >
                      {signalFreshness}
                    </Tag>
                  </>
                )}
              </div>
              <div>
                Location: {Number(match.signal.lat).toFixed(3)}, {Number(match.signal.lng).toFixed(3)}
              </div>
              {distKm != null && (
                <div>Distance to site: <strong>{Number(distKm).toFixed(1)} km</strong></div>
              )}
            </>
          )}
        </ChainNode>

        <Arrow />

        {/* ── RULE / GEOFENCE ── */}
        <ChainNode
          icon={isGeofence ? 'locate' : 'data-lineage'}
          label={isGeofence ? 'Geofence' : 'Rule'}
          title={isGeofence
            ? `Geofence breach${geofenceKm != null ? ` (radius ${geofenceKm} km)` : ''}`
            : (match.correlation_rule?.name ?? 'Rule deleted')}
          faded={!isGeofence && !match.correlation_rule}
        >
          {isGeofence ? (
            <div>Signal entered the site's monitored geofence perimeter.</div>
          ) : match.correlation_rule ? (
            <div>Rule ID: <code style={{ fontSize: 11 }}>{match.correlation_rule.id.slice(0, 8)}…</code></div>
          ) : null}
        </ChainNode>

        <Arrow />

        {/* ── ALERT ── */}
        <ChainNode
          icon="warning-sign"
          label="Alert"
          title={`${humanize(match.workflow_status)} alert`}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
            <ConfBadge value={match.confidence} />
            <Tag minimal intent={alertStatusIntent[match.workflow_status] ?? 'none'} style={{ fontSize: 10 }}>
              {match.workflow_status}
            </Tag>
          </div>
          <div>Fired: {fmt(match.fired_at)}</div>
          {match.acknowledged_at && (
            <div>Acknowledged: {fmt(match.acknowledged_at)}{match.acknowledged_by ? ` by ${match.acknowledged_by.email}` : ''}</div>
          )}
          {match.notes && (
            <Callout compact style={{ marginTop: 8, fontSize: 12 }}>{match.notes}</Callout>
          )}
        </ChainNode>

        {match.task && (
          <>
            <Arrow />

            {/* ── TASK ── */}
            <ChainNode
              icon="clipboard"
              label="Task"
              title={match.task.title}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Tag minimal intent={
                  match.task.priority === 'critical' ? 'danger'
                  : match.task.priority === 'high'     ? 'warning'
                  : match.task.priority === 'normal'   ? 'primary'
                  : 'none'
                } style={{ fontSize: 10 }}>
                  {match.task.priority}
                </Tag>
                <Tag minimal style={{ fontSize: 10 }}>
                  {humanize(match.task.workflow_status)}
                </Tag>
              </div>
            </ChainNode>
          </>
        )}

        {!match.task && (
          <>
            <Arrow />
            <ChainNode icon="clipboard" label="Task" title="No task created" faded>
              <div>This alert did not automatically generate a task.</div>
            </ChainNode>
          </>
        )}

        <Divider style={{ margin: '20px 0 12px' }} />

        {/* ── site context ── */}
        {match.site && (
          <div style={{ fontSize: 12, opacity: 0.6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon icon="map-marker" size={12} />
            Site: <strong>{match.site.name}</strong>
          </div>
        )}
      </div>
    </Drawer>
  )
}
