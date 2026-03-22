import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'

interface Props {
  data: number[]   // 30 daily counts, index 0 = oldest
  width?: number | `${number}%`
  height?: number
}

interface TooltipPayload {
  value?: number
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: number
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const daysAgo = 29 - (label ?? 0)
  const dayLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`
  return (
    <div style={{
      background: '#1c2127',
      border: '1px solid #394b59',
      borderRadius: 4,
      padding: '4px 8px',
      fontSize: 11,
      color: '#a7b6c2',
      pointerEvents: 'none',
    }}>
      <span style={{ color: '#48aff0' }}>{payload[0]?.value ?? 0}</span>
      {' '}fire{payload[0]?.value !== 1 ? 's' : ''} · {dayLabel}
    </div>
  )
}

export function RuleSparkline({ data, width = 80, height = 28 }: Props) {
  const chartData = data.map((count, i) => ({ i, count }))

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#2d72d2" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#2d72d2" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="count"
          stroke="#2d72d2"
          strokeWidth={1.5}
          fill="url(#sparkGrad)"
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: '#394b59', strokeWidth: 1 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
