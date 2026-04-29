import { Callout } from '@blueprintjs/core'
import { useRole } from '../hooks/useRole'
import OperationalHealthPage from './OperationalHealthPage'

export default function OperationalHealthRoutePage() {
  const role = useRole()
  const canViewOperationalHealth = role.canViewOperationalHealth ?? role.isCommander

  if (!canViewOperationalHealth) {
    return (
      <div className="page-content">
        <Callout intent="warning" icon="lock" title="Commander access required">
          Operational health monitoring is restricted to commanders and administrators.
        </Callout>
      </div>
    )
  }

  return <OperationalHealthPage />
}
