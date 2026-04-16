import { useState } from 'react'
import {
  Button, Callout, Classes, Dialog, DialogBody, DialogFooter,
  FormGroup, HTMLSelect, HTMLTable, Icon, Tag,
} from '@blueprintjs/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getUsers, updateUser, type UserRecord, type UserUpdateParams } from '../api/users'
import { getOrganizations, type Organization } from '../api/organizations'
import { getAreasOfOperation } from '../api/areas_of_operation'
import { getApiErrorMessage } from '../api/client'
import { useRole } from '../hooks/useRole'
import { useReplayGuardedMutation } from '../hooks/useReplayGuardedMutation'
import { timeAgo } from '../lib/formatters'

const ROLES = ['viewer', 'operator', 'commander', 'admin'] as const

export default function UsersPage() {
  const role = useRole()
  const canManageUsers = role.canManageUsers ?? role.isAdmin
  const queryClient = useQueryClient()

  const { data, isPending, error } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const orgsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  })
  const aosQuery = useQuery({
    queryKey: ['areas_of_operation', { per_page: 200 }],
    queryFn: () => getAreasOfOperation({ per_page: 200 }),
  })

  const users = data?.data ?? []
  const orgs = orgsQuery.data?.data ?? []
  const aos = aosQuery.data?.data ?? []

  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)
  const [formRole, setFormRole] = useState('')
  const [formOrgId, setFormOrgId] = useState<string>('')
  const [formAoId, setFormAoId] = useState<string>('')

  const updateMutation = useReplayGuardedMutation({
    mutationFn: ({ id, params }: { id: string; params: UserUpdateParams }) => updateUser(id, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      closeDialog()
    },
  })

  function openEdit(user: UserRecord) {
    setEditingUser(user)
    setFormRole(user.role)
    setFormOrgId(user.organization_id ?? '')
    setFormAoId(user.area_of_operation_id ?? '')
    updateMutation.reset()
  }

  function closeDialog() {
    setEditingUser(null)
    setFormAoId('')
    updateMutation.reset()
  }

  function handleSubmit() {
    if (!editingUser) return
    const params: UserUpdateParams = {
      role: formRole,
      organization_id: formOrgId || null,
      area_of_operation_id: formAoId || null,
    }
    updateMutation.mutate({ id: editingUser.id, params })
  }

  if (!canManageUsers) {
    return (
      <div className="page-content">
        <Callout intent="warning" icon="lock" title="Admin access required">
          User management is restricted to administrators.
        </Callout>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">
          <Icon icon="people" size={20} style={{ marginRight: 8 }} />
          Users
        </h2>
      </div>

      {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{getApiErrorMessage(error)}</Callout>}

      {isPending ? (
        <div className={Classes.SKELETON} style={{ width: '100%', height: 200 }}>&nbsp;</div>
      ) : users.length === 0 ? (
        <Callout icon="info-sign" intent="none">
          No users found.
        </Callout>
      ) : (
        <div className="dashboard-card">
          <HTMLTable compact striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Organization</th>
                <th>Area of Operation</th>
                <th>Created</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td style={{ fontWeight: 600 }}>{user.email}</td>
                  <td>
                    <RoleTag role={user.role} />
                  </td>
                  <td>{user.organization_name ?? <span className="bp6-text-muted">—</span>}</td>
                  <td>{user.area_of_operation_name ?? <span className="bp6-text-muted">—</span>}</td>
                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>{timeAgo(user.created_at)}</td>
                  <td>
                    <Button minimal small icon="edit" onClick={() => openEdit(user)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </div>
      )}

      <Dialog
        isOpen={editingUser !== null}
        onClose={closeDialog}
        title={`Edit User — ${editingUser?.email ?? ''}`}
        icon="person"
      >
        <DialogBody>
          {updateMutation.error && (
            <Callout intent="danger" compact style={{ marginBottom: 12 }}>
              {getApiErrorMessage(updateMutation.error)}
            </Callout>
          )}
          <FormGroup label="Role" labelFor="user-role">
            <HTMLSelect
              id="user-role"
              value={formRole}
              onChange={e => setFormRole(e.target.value)}
              fill
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </HTMLSelect>
          </FormGroup>
          <FormGroup label="Organization" labelFor="user-org">
            <HTMLSelect
              id="user-org"
              value={formOrgId}
              onChange={e => setFormOrgId(e.target.value)}
              fill
            >
              <option value="">— No organization —</option>
              {orgs.map((org: Organization) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </HTMLSelect>
          </FormGroup>
          <FormGroup label="Area of Operation" labelFor="user-area-of-operation">
            <HTMLSelect
              id="user-area-of-operation"
              value={formAoId}
              onChange={e => setFormAoId(e.target.value)}
              fill
            >
              <option value="">— No area of operation —</option>
              {aos.map(ao => (
                <option key={ao.id} value={ao.id}>{ao.name}</option>
              ))}
            </HTMLSelect>
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={closeDialog} />
              <Button
                intent="primary"
                text="Save"
                loading={updateMutation.isPending}
                onClick={handleSubmit}
              />
            </>
          }
        />
      </Dialog>
    </div>
  )
}

function RoleTag({ role }: { role: string }) {
  const intent = role === 'admin' ? 'danger' : role === 'commander' ? 'warning' : 'none'
  return <Tag minimal intent={intent}>{role}</Tag>
}
