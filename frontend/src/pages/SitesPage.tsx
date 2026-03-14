import { Callout, HTMLTable, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { useSites } from '../hooks/useSites'
import { useReplay } from '../context/ReplayContext'

export default function SitesPage() {
  const { asOf } = useReplay()
  const { data, error, isPending } = useSites({ per_page: 100, ...(asOf ? { as_of: asOf } : {}) })

  if (isPending) {
    return <div className="page-center"><Spinner /></div>
  }

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load sites">
          {error.message}
        </Callout>
      </div>
    )
  }

  if (!data || data.data.length === 0) {
    return (
      <NonIdealState
        icon="map-marker"
        title="No sites"
        description="No sites have been created yet."
      />
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Sites</h2>
        <span className="bp6-text-muted">{data.meta?.total ?? data.data.length} total</span>
      </div>

      <HTMLTable className="data-table" striped interactive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Latitude</th>
            <th>Longitude</th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((site) => (
            <tr key={site.id}>
              <td>{site.name}</td>
              <td>
                <Tag minimal intent={site.status === 'active' ? 'success' : 'none'}>
                  {site.status}
                </Tag>
              </td>
              <td className="mono">{Number(site.latitude).toFixed(4)}</td>
              <td className="mono">{Number(site.longitude).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}
