import { useMemo, useState } from 'react'
import {
  Button,
  Callout,
  Card,
  FormGroup,
  HTMLTable,
  InputGroup,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useRole } from '../hooks/useRole'
import { useRevokeAllUserSessions, useRevokeUserSession, useUserSessions } from '../hooks/useUserSessions'
import { logout } from '../api/auth'
import { getApiErrorMessage } from '../api/client'

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default function SecurityPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { isAdmin } = useRole()
  const [targetEmailDraft, setTargetEmailDraft] = useState('')
  const [targetEmail, setTargetEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const targetParams = useMemo(
    () => (targetEmail.trim().length > 0 ? { user_email: targetEmail.trim().toLowerCase() } : undefined),
    [targetEmail],
  )

  const sessionsQuery = useUserSessions(targetParams, !!currentUser)
  const revokeSession = useRevokeUserSession()
  const revokeAll = useRevokeAllUserSessions()

  const sessions = sessionsQuery.data?.data ?? []
  const viewingOtherUser = Boolean(targetParams?.user_email && targetParams.user_email !== currentUser?.email)
  const activeSessions = sessions.filter(session => session.revoked_at == null)

  async function handleSignOutAllSessions() {
    setError(null)
    try {
      await logout({ allSessions: true })
      navigate('/login', { replace: true })
    } catch (sessionError) {
      setError(getApiErrorMessage(sessionError, 'Failed to sign out all sessions'))
    }
  }

  async function handleRevokeOthers() {
    setError(null)
    try {
      await revokeAll.mutateAsync({ keep_current: true })
    } catch (sessionError) {
      setError(getApiErrorMessage(sessionError, 'Failed to revoke other sessions'))
    }
  }

  async function handleAdminRevokeAll() {
    if (!targetParams) return
    setError(null)
    try {
      await revokeAll.mutateAsync(targetParams)
    } catch (sessionError) {
      setError(getApiErrorMessage(sessionError, 'Failed to revoke target sessions'))
    }
  }

  if (!currentUser) {
    return (
      <div className="page-content">
        <NonIdealState
          icon="lock"
          title="Security unavailable"
          description="You must be signed in to manage session security."
        />
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">Security</h2>
      </div>

      <Callout intent="primary" icon="shield" style={{ marginBottom: 16 }}>
        Manage active browser/API sessions, revoke stale tokens, and inspect your current access scope.
      </Callout>

      {error && (
        <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>
          {error}
        </Callout>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        <Card>
          <h3 className="bp6-heading" style={{ marginTop: 0 }}>Access Scope</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Tag intent={currentUser.role === 'admin' ? 'danger' : currentUser.role === 'commander' ? 'warning' : 'none'}>
              {currentUser.role}
            </Tag>
            <Tag minimal>Org: {currentUser.organization_id ?? 'global'}</Tag>
            <Tag minimal>AO: {currentUser.area_of_operation_id ?? 'all'}</Tag>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h3 className="bp6-heading" style={{ marginTop: 0 }}>Active Sessions</h3>
              <p className="bp6-text-muted" style={{ marginBottom: 0 }}>
                {viewingOtherUser
                  ? `Viewing session inventory for ${sessionsQuery.data?.meta.user_email ?? targetEmail}.`
                  : 'Review active devices, recent API clients, and revoke sessions you no longer trust.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!viewingOtherUser && (
                <>
                  <Button small icon="ban-circle" onClick={handleRevokeOthers} loading={revokeAll.isPending}>
                    Sign Out Other Sessions
                  </Button>
                  <Button small intent="danger" icon="log-out" onClick={handleSignOutAllSessions}>
                    Sign Out All Sessions
                  </Button>
                </>
              )}
            </div>
          </div>

          {isAdmin && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 16, flexWrap: 'wrap' }}>
              <FormGroup label="Admin target user email" style={{ marginBottom: 0, minWidth: 320 }}>
                <InputGroup
                  value={targetEmailDraft}
                  onChange={event => setTargetEmailDraft(event.currentTarget.value)}
                  placeholder="user@resilience.test"
                />
              </FormGroup>
              <Button small onClick={() => setTargetEmail(targetEmailDraft)}>
                Load Sessions
              </Button>
              {viewingOtherUser && (
                <>
                  <Button small icon="cross" onClick={() => { setTargetEmail(''); setTargetEmailDraft('') }}>
                    Reset
                  </Button>
                  <Button small intent="danger" icon="ban-circle" onClick={handleAdminRevokeAll} loading={revokeAll.isPending}>
                    Revoke All For Target
                  </Button>
                </>
              )}
            </div>
          )}

          {sessionsQuery.isPending && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
              <Spinner size={24} />
            </div>
          )}

          {sessionsQuery.isError && (
            <Callout intent="danger" icon="error" style={{ marginTop: 16 }}>
              {getApiErrorMessage(sessionsQuery.error, 'Failed to load sessions')}
            </Callout>
          )}

          {!sessionsQuery.isPending && !sessionsQuery.isError && sessions.length === 0 && (
            <NonIdealState
              icon="desktop"
              title="No sessions found"
              description="No tracked sessions matched the selected account."
            />
          )}

          {!sessionsQuery.isPending && !sessionsQuery.isError && sessions.length > 0 && (
            <HTMLTable striped interactive className="data-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Last Seen</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(session => (
                  <tr key={session.id}>
                    <td>
                      <div>{session.user_agent ?? 'Unknown client'}</div>
                      {session.current && (
                        <Tag minimal intent="primary" style={{ marginTop: 4 }}>
                          Current session
                        </Tag>
                      )}
                    </td>
                    <td>{session.ip_address ?? '—'}</td>
                    <td>{formatDateTime(session.last_seen_at)}</td>
                    <td>{formatDateTime(session.expires_at)}</td>
                    <td>
                      {session.revoked_at ? (
                        <Tag minimal intent="danger" title={session.revoke_reason ?? undefined}>
                          Revoked
                        </Tag>
                      ) : (
                        <Tag minimal intent="success">
                          Active
                        </Tag>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!session.current && session.revoked_at == null && (
                        <Button
                          small
                          intent="danger"
                          icon="cross"
                          loading={revokeSession.isPending}
                          onClick={async () => {
                            setError(null)
                            try {
                              await revokeSession.mutateAsync({ id: session.id, params: targetParams })
                            } catch (sessionError) {
                              setError(getApiErrorMessage(sessionError, 'Failed to revoke session'))
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          )}

          {!sessionsQuery.isPending && !sessionsQuery.isError && activeSessions.length > 0 && (
            <p className="bp6-text-muted" style={{ marginTop: 12, marginBottom: 0 }}>
              {activeSessions.length} active session{activeSessions.length === 1 ? '' : 's'} tracked.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
