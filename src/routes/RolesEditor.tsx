import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import { ROLE_EDITOR_MODULE_NESTING, getPermissionLabel } from '@/lib/permissionsCatalog'
import { useAlertConfirm } from '@/contexts/AlertConfirmContext'

type RoleRow = { slug: string; label: string; permissions: string[] }

type ApiResponse = {
  roles: RoleRow[]
  catalog: { id: string; label: string; group: string }[]
}

function defaultNewRolePermissions(): Set<string> {
  return new Set(['module.home', 'module.testing'])
}

/** Other roles (excluding `slug`) that already have full access. */
function countOtherStarRoles(roles: RoleRow[], excludeSlug: string): number {
  return roles.filter((r) => r.slug !== excludeSlug && r.permissions.includes('*')).length
}

function isOnlyStarRole(roles: RoleRow[], slug: string): boolean {
  const withStar = roles.filter((r) => r.permissions.includes('*'))
  return withStar.length === 1 && withStar[0].slug === slug
}

export function RolesEditor() {
  const { showAlert, showConfirm } = useAlertConfirm()
  const [loading, setLoading] = useState(true)
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [modal, setModal] = useState<null | { type: 'create' } | { type: 'edit'; slug: string }>(null)
  const [draftSlug, setDraftSlug] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftPerms, setDraftPerms] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api
      .get<ApiResponse>('/roles')
      .then((r) => setRoles(r.data.roles))
      .catch(() => showAlert('Failed to load roles'))
      .finally(() => setLoading(false))
  }, [showAlert])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setModal({ type: 'create' })
    setDraftSlug('')
    setDraftLabel('')
    setDraftPerms(defaultNewRolePermissions())
  }

  const openEdit = (r: RoleRow) => {
    setModal({ type: 'edit', slug: r.slug })
    setDraftSlug(r.slug)
    setDraftLabel(r.label)
    setDraftPerms(new Set(r.permissions))
  }

  const closeModal = () => {
    setModal(null)
  }

  const togglePerm = (id: string) => {
    if (id === '*') {
      setDraftPerms(new Set(['*']))
      return
    }
    setDraftPerms((prev) => {
      const next = new Set(prev)
      next.delete('*')
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (!modal) return
    const permissions = Array.from(draftPerms).sort()
    if (permissions.length === 0) {
      showAlert('Select at least one permission (or *).')
      return
    }
    if (modal.type === 'create') {
      if (!permissions.includes('*') && !roles.some((r) => r.permissions.includes('*'))) {
        showAlert(
          'At least one role must have full access (*). Add * to this role, or keep another role with * first.'
        )
        return
      }
    } else {
      if (!permissions.includes('*') && countOtherStarRoles(roles, modal.slug) === 0) {
        showAlert(
          'At least one role must have full access (*). Grant * on another role first, or keep * on this role.'
        )
        return
      }
    }
    setSaving(true)
    try {
      if (modal.type === 'create') {
        const slug = draftSlug.trim().toLowerCase()
        if (!slug) {
          showAlert('Enter a slug for the new role.')
          setSaving(false)
          return
        }
        await api.post('/roles', {
          slug,
          label: draftLabel.trim() || slug,
          permissions,
        })
      } else {
        await api.put(`/roles/${modal.slug}`, {
          label: draftLabel.trim() || undefined,
          permissions,
        })
      }
      closeModal()
      load()
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to save role')
    } finally {
      setSaving(false)
    }
  }

  const confirmAndDeleteRole = async (slug: string, label: string): Promise<boolean> => {
    const row = roles.find((r) => r.slug === slug)
    if (row?.permissions.includes('*') && isOnlyStarRole(roles, slug)) {
      showAlert(
        'At least one role must have full access (*). Grant * on another role before deleting this one.'
      )
      return false
    }
    const ok = await showConfirm(
      `Delete role "${label}" (${slug})? This cannot be undone. Users must not be assigned this role.`,
      { title: 'Delete role', variant: 'danger', confirmLabel: 'Delete' }
    )
    if (!ok) return false
    try {
      await api.delete(`/roles/${encodeURIComponent(slug)}`)
      return true
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to delete role')
      return false
    }
  }

  const deleteFromEditModal = async () => {
    if (modal?.type !== 'edit') return
    if (await confirmAndDeleteRole(modal.slug, draftLabel.trim() || modal.slug)) {
      closeModal()
      load()
    }
  }

  if (loading) return <p className="text-foreground/60">Loading roles…</p>

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="mb-2 text-2xl font-semibold text-foreground">Roles</h1>
          <p className="text-sm text-foreground/70">
            Define roles and their permissions. Users can be assigned one or more roles under{' '}
            <strong>Administration → Users</strong>; effective access is merged from all assigned roles.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Add role
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-card">
            <tr>
              <th className="px-4 py-2 font-medium text-foreground">Slug</th>
              <th className="px-4 py-2 font-medium text-foreground">Label</th>
              <th className="px-4 py-2 font-medium text-foreground">Permissions</th>
              <th className="px-4 py-2 text-right font-medium text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {roles.map((r) => (
              <tr key={r.slug} className="bg-background">
                <td className="px-4 py-2 font-mono text-foreground">{r.slug}</td>
                <td className="px-4 py-2 text-foreground">{r.label}</td>
                <td className="max-w-md px-4 py-2 text-xs text-foreground/80">
                  {r.permissions.includes('*') ? (
                    <span className="font-medium text-primary">All (*)</span>
                  ) : (
                    <span className="line-clamp-2">{r.permissions.join(', ')}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="text-primary hover:underline"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal
          onClick={closeModal}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-xl border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">
                {modal.type === 'create' ? 'Add role' : `Edit role: ${modal.slug}`}
              </h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {modal.type === 'create' ? (
              <>
                <label className="mb-1 block text-sm font-medium text-foreground">Slug</label>
                <input
                  value={draftSlug}
                  onChange={(e) => setDraftSlug(e.target.value)}
                  placeholder="e.g. warehouse_lead"
                  className="mb-4 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                  autoComplete="off"
                />
                <p className="mb-4 text-xs text-foreground/60">
                  Lowercase letters, numbers, hyphen, underscore; must start with a letter. Slug must be unique.
                  At least one role in the system must keep full access (*).
                </p>
              </>
            ) : null}
            <label className="mb-1 block text-sm font-medium text-foreground">Label</label>
            <input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              className="mb-6 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            />
            <p className="mb-3 text-sm font-medium text-foreground">Permissions</p>
            <div className="space-y-5 pr-1">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">Modules</p>
                <ul className="space-y-4">
                  {ROLE_EDITOR_MODULE_NESTING.map(({ moduleId, nestedIds }) => (
                    <li key={moduleId} className="rounded-lg border border-border/80 bg-background/40 p-3">
                      <label className="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={draftPerms.has(moduleId)}
                          onChange={() => togglePerm(moduleId)}
                        />
                        <span>
                          <span className="font-mono text-xs font-normal text-foreground/70">{moduleId}</span>
                          <span className="ml-2">{getPermissionLabel(moduleId)}</span>
                        </span>
                      </label>
                      {nestedIds.length > 0 && (
                        <ul className="ml-1 mt-3 space-y-2 border-l-2 border-border/80 pl-4">
                          {nestedIds.map((nid) => (
                            <li key={nid}>
                              <label className="flex cursor-pointer items-start gap-2 text-sm font-normal">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={draftPerms.has(nid)}
                                  onChange={() => togglePerm(nid)}
                                />
                                <span>
                                  <span className="font-mono text-xs text-foreground/70">{nid}</span>
                                  <span className="ml-2 text-foreground">{getPermissionLabel(nid)}</span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">Superuser</p>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draftPerms.has('*')}
                    onChange={() => togglePerm('*')}
                  />
                  <span>
                    <span className="font-mono text-xs text-foreground/80">*</span>
                    <span className="ml-2 text-foreground">{getPermissionLabel('*')}</span>
                  </span>
                </label>
              </div>
            </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-6 py-4">
              {modal.type === 'edit' ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void deleteFromEditModal()}
                  className="mr-auto rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                >
                  Delete role
                </button>
              ) : null}
              <div
                className={
                  modal.type === 'edit'
                    ? 'flex flex-wrap items-center gap-2'
                    : 'ml-auto flex flex-wrap items-center gap-2'
                }
              >
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
                >
                  {saving ? 'Saving…' : modal.type === 'create' ? 'Create role' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
