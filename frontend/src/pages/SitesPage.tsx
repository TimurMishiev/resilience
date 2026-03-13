import { useEffect, useState } from 'react'
import { Callout, HTMLTable, NonIdealState, Spinner, Tag } from '@blueprintjs/core'
import { getSites } from '../api/sites'
import type { Site, PaginatedResponse } from '../api/types'

export default function SitesPage() {
  const [result, setResult] = useState<PaginatedResponse<Site> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSites({ per_page: 100 })
      .then(setResult)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unknown error'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="page-center">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-content">
        <Callout intent="danger" title="Failed to load sites">
          {error}
        </Callout>
      </div>
    )
  }

  if (!result || result.data.length === 0) {
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
        <span className="bp6-text-muted">{result.meta.total} total</span>
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
          {result.data.map((site) => (
            <tr key={site.id}>
              <td>{site.name}</td>
              <td>
                <Tag
                  minimal
                  intent={site.status === 'active' ? 'success' : 'none'}
                >
                  {site.status}
                </Tag>
              </td>
              <td className="mono">{site.latitude.toFixed(4)}</td>
              <td className="mono">{site.longitude.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </div>
  )
}
