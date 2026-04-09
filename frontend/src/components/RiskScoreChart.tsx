import { useState } from 'react'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Button, ButtonGroup, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useSiteRiskHistory } from '../hooks/useSite'
import type { RiskLevel, SiteRiskSnapshot } from '../api/types'
import { humanize } from '../utils/humanize'

// ── constants ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<RiskLevel, string> = {
  low:      '#23a26d',
  moderate: '#f0b726',
  high:     '#e67e22',
  critical: '#cd4246',
}

const COMPONENT_COLORS = {
  alert_pressure: '#cd4246',  // red  — most urgent
  task_health:    '#f0b726',  // amber — task pressure
  signal_density: '#4580e6',  // blue  — environmental signal density
}

const RISK_THRESHOLDS = [
  { y: 25, label: 'LOW',      color: '#23a26d' },
  { y: 50, label: 'MOD',      color: '#f0b726' },
  { y: 75, label: 'HIGH',     color: '#e67e22' },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTick(iso: string, days: number): string {
  const d = new Date(iso)
  if (days <= 3) {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })
}

function riskLevelForScore(score: number): RiskLevel {
  if (score <= 25) return 'low'
  if (score <= 50) return 'moderate'
  if (score <= 75) return 'high'
  return 'critical'
}

// ── custom tooltip ────────────────────────────────────────────────────────────

interface TooltipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length || !label) return null

  const score = payload.find(p => p.name === 'score')?.value ?? 0
  const level = riskLevelForScore(score)

  return (
    <div style={{
      background:   '#1c2127',
      border:       `1px solid ${RISK_COLORS[level]}`,
      borderRadius: 4,
      padding:      '8px 12px',
      fontSize:     12,
      minWidth:     160,
    }}>
      <div style={{ marginBottom: 6, color: '#8a9ba8', fontSize: 11 }}>
        {new Date(label).toLocaleString(undefined, {
          month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
      </div>
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 2 }}>
          <span style={{ color: p.color, textTransform: 'capitalize' }}>
            {humanize(p.name)}
          </span>
          <span style={{ color: '#e1e8ed', fontFamily: 'monospace' }}>
            {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #2f363f' }}>
        <Tag
          minimal
          style={{
            background: RISK_COLORS[level] + '30',
            color:      RISK_COLORS[level],
            fontSize:   10,
          }}
        >
          {level.toUpperCase()}
        </Tag>
      </div>
    </div>
  )
}

// ── chart data transform ──────────────────────────────────────────────────────

function toChartPoint(snap: SiteRiskSnapshot) {
  return {
    recorded_at:    snap.recorded_at,
    score:          snap.score,
    alert_pressure: snap.alert_pressure,
    task_health:    snap.task_health,
    signal_density: snap.signal_density,
  }
}

// ── gradient area fill — color changes with risk level ───────────────────────

function ScoreGradient({ id }: { id: string }) {
  // Build gradient stops at each risk threshold crossing
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"   stopColor="#cd4246" stopOpacity={0.25} />
        <stop offset="50%"  stopColor="#e67e22" stopOpacity={0.15} />
        <stop offset="95%"  stopColor="#23a26d" stopOpacity={0.05} />
      </linearGradient>
    </defs>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface Props {
  siteId: string
  asOf?: string | null
}

export default function RiskScoreChart({ siteId, asOf }: Props) {
  const [days, setDays]           = useState(7)
  const [showComponents, setShowComponents] = useState(true)

  const { data, isPending, error } = useSiteRiskHistory(siteId, { days, ...(asOf ? { as_of: asOf } : {}) })

  const snapshots = data?.data ?? []
  const chartData = snapshots.map(toChartPoint)

  // Current (latest) score for the header badge
  const latest    = snapshots.at(-1)
  const latestLevel = latest ? riskLevelForScore(latest.score) : null

  if (isPending) {
    return (
      <div className="risk-chart-shell">
        <Spinner size={16} />
      </div>
    )
  }

  if (error) return null  // silent — chart is supplementary, not critical

  if (snapshots.length === 0) {
    return (
      <div className="risk-chart-shell risk-chart-empty">
        <NonIdealState
          icon="chart"
          title="No history yet"
          description="Risk score snapshots are written hourly. Check back soon."
          className="tab-empty-state"
        />
      </div>
    )
  }

  const gradientId = `risk-gradient-${siteId}`
  const tickCount  = days <= 3 ? 12 : days <= 7 ? 7 : 10

  return (
    <div className="risk-chart-shell">
      {/* ── header ── */}
      <div className="risk-chart-header">
        <span className="risk-chart-title">Risk Score Trend</span>

        {latest && latestLevel && (
          <Tag
            minimal
            style={{
              background: RISK_COLORS[latestLevel] + '25',
              color:      RISK_COLORS[latestLevel],
              fontWeight: 700,
              fontSize:   11,
            }}
          >
            {latest.score} {latestLevel.toUpperCase()}
          </Tag>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            small minimal
            active={showComponents}
            style={{ fontSize: 11 }}
            onClick={() => setShowComponents(v => !v)}
          >
            Components
          </Button>
          <ButtonGroup minimal>
            {[3, 7, 14, 30].map(d => (
              <Button
                key={d}
                small
                active={days === d}
                style={{ fontSize: 11 }}
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>

      {/* ── chart ── */}
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <ScoreGradient id={gradientId} />

          <CartesianGrid strokeDasharray="3 3" stroke="#2f363f" vertical={false} />

          <XAxis
            dataKey="recorded_at"
            tickFormatter={iso => fmtTick(iso, days)}
            tick={{ fontSize: 10, fill: '#8a9ba8' }}
            tickCount={tickCount}
            axisLine={{ stroke: '#2f363f' }}
            tickLine={false}
          />

          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#8a9ba8' }}
            axisLine={false}
            tickLine={false}
            width={32}
          />

          <ChartTooltip content={<CustomTooltip />} />

          {/* risk level threshold lines */}
          {RISK_THRESHOLDS.map(({ y, label, color }) => (
            <ReferenceLine
              key={y}
              y={y}
              stroke={color}
              strokeDasharray="4 4"
              strokeOpacity={0.4}
              label={{ value: label, position: 'right', fontSize: 9, fill: color, opacity: 0.7 }}
            />
          ))}

          {/* component lines — shown when toggle is on */}
          {showComponents && (
            <>
              <Line
                type="monotone"
                dataKey="alert_pressure"
                stroke={COMPONENT_COLORS.alert_pressure}
                strokeWidth={1}
                dot={false}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                name="alert_pressure"
              />
              <Line
                type="monotone"
                dataKey="task_health"
                stroke={COMPONENT_COLORS.task_health}
                strokeWidth={1}
                dot={false}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                name="task_health"
              />
              <Line
                type="monotone"
                dataKey="signal_density"
                stroke={COMPONENT_COLORS.signal_density}
                strokeWidth={1}
                dot={false}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                name="signal_density"
              />
            </>
          )}

          {/* total score — solid filled area on top */}
          <Area
            type="monotone"
            dataKey="score"
            stroke="#e1e8ed"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, stroke: '#e1e8ed', strokeWidth: 2 }}
            name="score"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── legend ── */}
      {showComponents && (
        <div className="risk-chart-legend">
          <span style={{ color: '#e1e8ed' }}>── score</span>
          <span style={{ color: COMPONENT_COLORS.alert_pressure }}>╌╌ alert pressure</span>
          <span style={{ color: COMPONENT_COLORS.task_health }}>╌╌ task health</span>
          <span style={{ color: COMPONENT_COLORS.signal_density }}>╌╌ signal density</span>
        </div>
      )}
    </div>
  )
}
