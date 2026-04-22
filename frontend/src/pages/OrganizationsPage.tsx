import { useState } from 'react'
import {
  Button, Callout, Classes, Dialog, DialogBody, DialogFooter,
  FormGroup, HTMLTable, Icon, InputGroup, Tag,
} from '@blueprintjs/core'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getOrganizations, createOrganization, updateOrganization, deleteOrganization,
  type Organization, type OrganizationParams,
} from '../api/organizations'
import { getApiErrorMessage } from '../api/client'
import { useRole } from '../hooks/useRole'
import { useReplayGuardedMutation } from '../hooks/useReplayGuardedMutation'
import { useReferenceTimeMs } from '../hooks/useReferenceTimeMs'
import { timeAgo } from '../lib/formatters'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function OrganizationsPage() {
  const role = useRole()
  const canManageOrganizations = role.canManageOrganizations ?? role.isAdmin
  const queryClient = useQueryClient()
  const referenceTimeMs = useReferenceTimeMs()

  const { data, isPending, error } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  })

  const orgs = data?.data ?? []

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null)
  const [formName, setFormName] = useState('')
  const [formSlug, setFormSlug] = useState('')
  const [autoSlug, setAutoSlug] = useState(true)

  const createMutation = useReplayGuardedMutation({
    mutationFn: (params: OrganizationParams) => createOrganization(params),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['organizations'] }); closeDialog() },
  })

  const updateMutation = useReplayGuardedMutation({
    mutationFn: ({ id, params }: { id: string; params: Partial<OrganizationParams> }) =>
      updateOrganization(id, params),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['organizations'] }); closeDialog() },
  })

  const deleteMutation = useReplayGuardedMutation({
    mutationFn: (id: string) => deleteOrganization(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['organizations'] }); setDeleteTarget(null) },
  })

  const activeMutation = editingOrg ? updateMutation : createMutation

  function openCreate() {
    setEditingOrg(null)
    setFormName('')
    setFormSlug('')
    setAutoSlug(true)
    setDialogOpen(true)
  }

  function openEdit(org: Organization) {
    setEditingOrg(org)
    setFormName(org.name)
    setFormSlug(org.slug)
    setAutoSlug(false)
    setDialogOpen(true)
  }

  function closeDialog() {
    setDialogOpen(false)
    setEditingOrg(null)
    createMutation.reset()
    updateMutation.reset()
  }

  function handleNameChange(value: string) {
    setFormName(value)
    if (autoSlug && !editingOrg) setFormSlug(slugify(value))
  }

  function handleSlugChange(value: string) {
    setAutoSlug(false)
    setFormSlug(value)
  }

  function handleSubmit() {
    if (editingOrg) {
      updateMutation.mutate({ id: editingOrg.id, params: { name: formName, slug: formSlug } })
    } else {
      createMutation.mutate({ name: formName, slug: formSlug })
    }
  }

  if (!canManageOrganizations) {
    return (
      <div className="page-content">
        <Callout intent="warning" icon="lock" title="Admin access required">
          Organization management is restricted to administrators.
        </Callout>
      </div>
    )
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2 className="bp6-heading">
          <Icon icon="office" size={20} style={{ marginRight: 8 }} />
          Organizations
        </h2>
        <Button icon="add" intent="primary" text="New Organization" onClick={openCreate} />
      </div>

      {error && <Callout intent="danger" compact style={{ marginBottom: 12 }}>{getApiErrorMessage(error)}</Callout>}

      {isPending ? (
        <div className={Classes.SKELETON} style={{ width: '100%', height: 200 }}>&nbsp;</div>
      ) : orgs.length === 0 ? (
        <Callout icon="info-sign" intent="none">
          No organizations created yet. Create one to start assigning users and sites.
        </Callout>
      ) : (
        <div className="dashboard-card">
          <HTMLTable compact striped style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Users</th>
                <th>Sites</th>
                <th>Created</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => (
                <tr key={org.id}>
                  <td style={{ fontWeight: 600 }}>{org.name}</td>
                  <td>
                    <Tag minimal style={{ fontFamily: 'monospace', fontSize: 11 }}>{org.slug}</Tag>
                  </td>
                  <td>{org.user_count}</td>
                  <td>{org.site_count}</td>
                  <td className="bp6-text-muted" style={{ fontSize: 12 }}>{timeAgo(org.created_at, referenceTimeMs)}</td>
                  <td>
                    <Button minimal small icon="edit" onClick={() => openEdit(org)} style={{ marginRight: 4 }} />
                    <Button
                      minimal small icon="trash" intent="danger"
                      disabled={org.user_count > 0 || org.site_count > 0}
                      onClick={() => setDeleteTarget(org)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog
        isOpen={dialogOpen}
        onClose={closeDialog}
        title={editingOrg ? 'Edit Organization' : 'New Organization'}
        icon="office"
      >
        <DialogBody>
          {activeMutation.error && (
            <Callout intent="danger" compact style={{ marginBottom: 12 }}>
              {getApiErrorMessage(activeMutation.error)}
            </Callout>
          )}
          <FormGroup label="Name" labelFor="org-name">
            <InputGroup
              id="org-name"
              value={formName}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Acme Operations"
              autoFocus
            />
          </FormGroup>
          <FormGroup
            label="Slug"
            labelFor="org-slug"
            helperText="Lowercase alphanumeric with hyphens. Used in URLs and API scoping."
          >
            <InputGroup
              id="org-slug"
              value={formSlug}
              onChange={e => handleSlugChange(e.target.value)}
              placeholder="acme-operations"
            />
          </FormGroup>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={closeDialog} />
              <Button
                intent="primary"
                text={editingOrg ? 'Save' : 'Create'}
                loading={activeMutation.isPending}
                disabled={!formName.trim() || !formSlug.trim()}
                onClick={handleSubmit}
              />
            </>
          }
        />
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Organization"
        icon="warning-sign"
      >
        <DialogBody>
          {deleteMutation.error && (
            <Callout intent="danger" compact style={{ marginBottom: 12 }}>
              {getApiErrorMessage(deleteMutation.error)}
            </Callout>
          )}
          <p>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            This action cannot be undone.
          </p>
        </DialogBody>
        <DialogFooter
          actions={
            <>
              <Button text="Cancel" onClick={() => setDeleteTarget(null)} />
              <Button
                intent="danger"
                text="Delete"
                loading={deleteMutation.isPending}
                onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              />
            </>
          }
        />
      </Dialog>
    </div>
  )
}
