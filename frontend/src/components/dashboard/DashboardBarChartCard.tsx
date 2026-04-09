import { Callout, Classes } from '@blueprintjs/core'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
} from 'recharts'
import { COLORS } from '../../lib/colors'

interface DashboardBarChartDatum {
  fill: string
  count: number
  [key: string]: string | number
}

interface DashboardBarChartCardProps {
  title: string
  loading: boolean
  data: DashboardBarChartDatum[]
  xKey: string
  error?: string | null
}

export function DashboardBarChartCard({
  title,
  loading,
  data,
  xKey,
  error,
}: DashboardBarChartCardProps) {
  return (
    <div className="dashboard-card">
      <h4 className="dashboard-card-title bp6-heading">{title}</h4>
      {error && <Callout intent="danger" compact>{error}</Callout>}
      {loading ? (
        <div className={Classes.SKELETON} style={{ width: '100%', height: 180 }}>&nbsp;</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey={xKey} tick={{ fill: COLORS.muted, fontSize: 11 }} />
            <YAxis tick={{ fill: COLORS.muted, fontSize: 11 }} allowDecimals={false} />
            <ChartTooltip
              contentStyle={{ background: COLORS.chartBg, border: `1px solid ${COLORS.chartBorder}`, fontSize: 12 }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`${String(entry[xKey])}-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
