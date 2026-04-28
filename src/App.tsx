import { Suspense, useEffect, useState, lazy } from 'react'
import {
  Outlet,
  Route,
  Navigate,
  useLocation,
  createBrowserRouter,
  createRoutesFromElements,
} from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { ForcedPasswordChangeModal } from './components/auth/ForcedPasswordChangeModal'
import { PermissionGuard } from './components/auth/PermissionGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/layout/Layout'
import { HomePage } from './routes/HomePage'
import { AdminIndexRedirect } from './routes/AdminIndexRedirect'
import { useAuthStore } from './store/authStore'
import { api, ensureAccessToken } from './api/client'
import { AlertConfirmProvider } from './contexts/AlertConfirmContext'
import { DateTimeConfigProvider } from './contexts/DateTimeConfigContext'
import { ConditionalFormatPresetsProvider } from './contexts/ConditionalFormatPresetsContext'
import { testingPath } from './lib/appPaths'
import { SiteBrandingHead } from './components/layout/SiteBrandingHead'

const FieldsList = lazy(() => import('./routes/FieldsList').then((m) => ({ default: m.FieldsList })))
const FieldEditor = lazy(() => import('./routes/FieldEditor').then((m) => ({ default: m.FieldEditor })))
const TestPlansList = lazy(() => import('./routes/TestPlansList').then((m) => ({ default: m.TestPlansList })))
const TestPlanOverview = lazy(() => import('./routes/TestPlanOverview').then((m) => ({ default: m.TestPlanOverview })))
const TestPlanDataRedirect = lazy(() => import('./routes/TestPlanDataRedirect').then((m) => ({ default: m.TestPlanDataRedirect })))
const TestPlanEditor = lazy(() => import('./routes/TestPlanEditor').then((m) => ({ default: m.TestPlanEditor })))
const ResultsList = lazy(() => import('./routes/ResultsList').then((m) => ({ default: m.ResultsList })))
const ResultDetail = lazy(() => import('./routes/ResultDetail').then((m) => ({ default: m.ResultDetail })))
const Users = lazy(() => import('./routes/Users').then((m) => ({ default: m.Users })))
const DbTablesViewer = lazy(() => import('./routes/DbTablesViewer').then((m) => ({ default: m.DbTablesViewer })))
const AdminStatusPage = lazy(() => import('./routes/AdminStatusPage').then((m) => ({ default: m.AdminStatusPage })))
const Settings = lazy(() => import('./routes/Settings').then((m) => ({ default: m.Settings })))
const BackupPage = lazy(() => import('./routes/BackupPage').then((m) => ({ default: m.BackupPage })))
const Locations = lazy(() => import('./routes/Locations').then((m) => ({ default: m.Locations })))
const LocationSchemas = lazy(() =>
  import('./routes/LocationSchemas').then((m) => ({ default: m.LocationSchemas }))
)
const LocationSchemaDetail = lazy(() =>
  import('./routes/LocationSchemaDetail').then((m) => ({ default: m.LocationSchemaDetail }))
)
const LocationZones = lazy(() =>
  import('./routes/LocationZones').then((m) => ({ default: m.LocationZones }))
)
const LocationZoneDetail = lazy(() =>
  import('./routes/LocationZoneDetail').then((m) => ({ default: m.LocationZoneDetail }))
)
const RolesEditor = lazy(() => import('./routes/RolesEditor').then((m) => ({ default: m.RolesEditor })))
const WikiIndex = lazy(() => import('./routes/wiki/WikiIndex').then((m) => ({ default: m.WikiIndex })))
const WikiCatchAll = lazy(() =>
  import('./routes/wiki/WikiCatchAll').then((m) => ({ default: m.WikiCatchAll }))
)
const WikiRecycleBin = lazy(() =>
  import('./routes/wiki/WikiRecycleBin').then((m) => ({ default: m.WikiRecycleBin }))
)
const FilesLibrary = lazy(() => import('./routes/FilesLibrary').then((m) => ({ default: m.FilesLibrary })))
const FilesRecycleBin = lazy(() =>
  import('./routes/FilesRecycleBin').then((m) => ({ default: m.FilesRecycleBin }))
)
const HomeLinksPage = lazy(() =>
  import('./routes/HomeLinksPage').then((m) => ({ default: m.HomeLinksPage }))
)

const REHYDRATE_DELAY_MS = 300

const testingLayout = (
  <AuthGuard>
    <PermissionGuard permission="module.testing">
      <DateTimeConfigProvider>
        <ConditionalFormatPresetsProvider>
          <Layout />
        </ConditionalFormatPresetsProvider>
      </DateTimeConfigProvider>
    </PermissionGuard>
  </AuthGuard>
)

const locationsLayout = (
  <AuthGuard>
    <PermissionGuard permission="module.locations">
      <DateTimeConfigProvider>
        <ConditionalFormatPresetsProvider>
          <Layout />
        </ConditionalFormatPresetsProvider>
      </DateTimeConfigProvider>
    </PermissionGuard>
  </AuthGuard>
)

const wikiLayout = (
  <AuthGuard>
    <PermissionGuard permission="module.wiki">
      <DateTimeConfigProvider>
        <ConditionalFormatPresetsProvider>
          <Layout />
        </ConditionalFormatPresetsProvider>
      </DateTimeConfigProvider>
    </PermissionGuard>
  </AuthGuard>
)

const filesLayout = (
  <AuthGuard>
    <PermissionGuard permission="module.files">
      <DateTimeConfigProvider>
        <ConditionalFormatPresetsProvider>
          <Layout />
        </ConditionalFormatPresetsProvider>
      </DateTimeConfigProvider>
    </PermissionGuard>
  </AuthGuard>
)

/** Home hub: no auth required; module cards and links still respect permissions when logged in. */
const publicHomeLayout = (
  <DateTimeConfigProvider>
    <ConditionalFormatPresetsProvider>
      <Layout showSidebar={false} />
    </ConditionalFormatPresetsProvider>
  </DateTimeConfigProvider>
)

const adminLayout = (
  <AuthGuard>
    <PermissionGuard permission="module.admin">
      <DateTimeConfigProvider>
        <ConditionalFormatPresetsProvider>
          <Layout />
        </ConditionalFormatPresetsProvider>
      </DateTimeConfigProvider>
    </PermissionGuard>
  </AuthGuard>
)

const tp = testingPath('test-plans')

/** Dev + client-side parity with server legacy redirects for old bookmark URLs. */
function LegacyBookmarkToTesting() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/testing${pathname}${search}`} replace />
}

function RootShell() {
  return (
    <AlertConfirmProvider>
      <SiteBrandingHead />
      <AuthInit />
      <ForcedPasswordChangeModal />
      <Outlet />
    </AlertConfirmProvider>
  )
}

/** Session user fields returned by `GET /auth/me` (keep in sync with server). */
type AuthMeUser = {
  id: string
  username: string
  shortName?: string
  name?: string
  role: string
  roles?: string[]
  permissions?: string[]
  mustChangePassword?: boolean
}

function AuthInit() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const setInitializing = useAuthStore((s) => s.setInitializing)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const [hydrationDone, setHydrationDone] = useState(false)

  useEffect(() => {
    const persist = useAuthStore.persist
    let done = false
    const markDone = () => {
      if (!done) {
        done = true
        setHydrationDone(true)
      }
    }
    if (persist.hasHydrated?.()) {
      markDone()
      return
    }
    const unsub = persist.onFinishHydration?.(markDone)
    const fallback = setTimeout(markDone, 500)
    return () => {
      unsub?.()
      clearTimeout(fallback)
    }
  }, [])

  useEffect(() => {
    if (!hydrationDone) return

    const accessToken = useAuthStore.getState().accessToken
    if (user && accessToken) {
      setInitializing(false)
      return
    }
    const currentRefresh = useAuthStore.getState().refreshToken
    if (!currentRefresh) {
      const t = setTimeout(() => {
        if (!useAuthStore.getState().refreshToken) {
          useAuthStore.getState().setInitializing(false)
        }
      }, REHYDRATE_DELAY_MS)
      return () => clearTimeout(t)
    }

    setInitializing(true)
    const timeout = setTimeout(() => {
      useAuthStore.getState().setInitializing(false)
    }, 15000)

    void ensureAccessToken()
      .then((ok) => {
        if (!ok) throw new Error('refresh failed')
        return api.get<AuthMeUser>('/auth/me')
      })
      .then((r) => {
        const token = useAuthStore.getState().accessToken
        if (token) {
          setAuth(
            {
              id: r.data.id,
              username: r.data.username,
              shortName: r.data.shortName,
              name: r.data.name,
              role: r.data.role,
              roles: r.data.roles,
              permissions: r.data.permissions,
              mustChangePassword: r.data.mustChangePassword ?? false,
            },
            token,
            currentRefresh
          )
        }
      })
      .catch(() => {
        useAuthStore.getState().logout()
      })
      .finally(() => {
        clearTimeout(timeout)
        useAuthStore.getState().setInitializing(false)
      })

    return () => clearTimeout(timeout)
  }, [hydrationDone, refreshToken, user, setAuth, setInitializing])

  useEffect(() => {
    if (!hydrationDone) return
    if (!userId || !accessToken || !refreshToken) return
    let cancelled = false
    void api
      .get<AuthMeUser>('/auth/me')
      .then((r) => {
        if (cancelled) return
        const tok = useAuthStore.getState().accessToken
        const rt = useAuthStore.getState().refreshToken
        if (!tok || !rt || useAuthStore.getState().user?.id !== r.data.id) return
        setAuth(
          {
            id: r.data.id,
            username: r.data.username,
            shortName: r.data.shortName,
            name: r.data.name,
            role: r.data.role,
            roles: r.data.roles,
            permissions: r.data.permissions,
            mustChangePassword: r.data.mustChangePassword ?? false,
          },
          tok,
          rt
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hydrationDone, userId, accessToken, refreshToken, setAuth])

  return null
}

export function createAppBrowserRouter(basePath: string) {
  return createBrowserRouter(
    createRoutesFromElements(
      <Route element={<RootShell />}>
          <Route path="/login" element={<Navigate to="/?login=1" replace />} />
          <Route path="/" element={publicHomeLayout}>
            <Route index element={<HomePage />} />
          </Route>
          <Route path="/links" element={publicHomeLayout}>
            <Route
              index
              element={
                <Suspense fallback={<div className="p-6 text-sm text-foreground/60">Loading…</div>}>
                  <HomeLinksPage />
                </Suspense>
              }
            />
          </Route>
          <Route path="/links/manage" element={<Navigate to="/links?manage=1" replace />} />
          <Route path="/testing" element={testingLayout}>
            <Route index element={<Navigate to={tp} replace />} />
            <Route
              path="fields"
              element={
                <PermissionGuard permission="fields.manage">
                  <FieldsList />
                </PermissionGuard>
              }
            />
            <Route
              path="fields/:id"
              element={
                <PermissionGuard permission="fields.manage">
                  <FieldEditor />
                </PermissionGuard>
              }
            />
            <Route path="test-plans" element={<TestPlansList />} />
            <Route
              path="test-plans/new"
              element={
                <PermissionGuard permission="testing.plans.manage">
                  <ErrorBoundary fallbackTitle="Could not load plan editor" backTo={tp} backLabel="Back to Test plans">
                    <TestPlanEditor />
                  </ErrorBoundary>
                </PermissionGuard>
              }
            />
            <Route
              path="test-plans/:planId"
              element={
                <ErrorBoundary fallbackTitle="Could not load test plan" backTo={tp} backLabel="Back to Test plans">
                  <TestPlanOverview />
                </ErrorBoundary>
              }
            />
            <Route
              path="test-plans/:planId/data"
              element={
                <ErrorBoundary fallbackTitle="Could not load test plan data" backTo={tp} backLabel="Back to Test plans">
                  <TestPlanDataRedirect />
                </ErrorBoundary>
              }
            />
            <Route
              path="test-plans/:planId/tests/:testId/data"
              element={
                <ErrorBoundary fallbackTitle="Could not load test plan data" backTo={tp} backLabel="Back to Test plans">
                  <TestPlanDataRedirect />
                </ErrorBoundary>
              }
            />
            <Route
              path="test-plans/:planId/edit"
              element={
                <PermissionGuard permission="testing.plans.manage">
                  <ErrorBoundary fallbackTitle="Could not load plan editor" backTo={tp} backLabel="Back to Test plans">
                    <TestPlanEditor />
                  </ErrorBoundary>
                </PermissionGuard>
              }
            />
            <Route path="results" element={<ResultsList />} />
            <Route path="results/:id" element={<ResultDetail />} />
            <Route path="settings" element={<Navigate to="/admin/settings" replace />} />
            <Route path="export" element={<Navigate to={tp} replace />} />
            <Route path="users" element={<Navigate to="/admin/users" replace />} />
            <Route path="admin/db" element={<Navigate to="/admin/db" replace />} />
          </Route>
          <Route path="/admin" element={adminLayout}>
            <Route index element={<AdminIndexRedirect />} />
            <Route path="status" element={<AdminStatusPage />} />
            <Route
              path="roles"
              element={
                <PermissionGuard permission="roles.manage">
                  <RolesEditor />
                </PermissionGuard>
              }
            />
            <Route
              path="users"
              element={
                <PermissionGuard permission="users.manage">
                  <Users />
                </PermissionGuard>
              }
            />
            <Route
              path="db"
              element={
                <PermissionGuard permission="admin.db">
                  <DbTablesViewer />
                </PermissionGuard>
              }
            />
            <Route
              path="settings"
              element={
                <PermissionGuard permission="settings.access">
                  <Settings />
                </PermissionGuard>
              }
            />
            <Route
              path="backup"
              element={
                <PermissionGuard permission="backup.manage">
                  <BackupPage />
                </PermissionGuard>
              }
            />
          </Route>
          <Route path="/wiki" element={wikiLayout}>
            <Route index element={<WikiIndex />} />
            <Route
              path="recycle"
              element={
                <PermissionGuard permission="wiki.recycle">
                  <WikiRecycleBin />
                </PermissionGuard>
              }
            />
            <Route path="*" element={<WikiCatchAll />} />
          </Route>
          <Route path="/files" element={filesLayout}>
            <Route index element={<FilesLibrary />} />
            <Route
              path="recycle"
              element={
                <PermissionGuard permission="files.recycle">
                  <FilesRecycleBin />
                </PermissionGuard>
              }
            />
          </Route>
          <Route path="/locations" element={locationsLayout}>
            <Route
              index
              element={
                <PermissionGuard permission="module.locations">
                  <Locations />
                </PermissionGuard>
              }
            />
            <Route
              path="schemas"
              element={
                <PermissionGuard permission="module.locations">
                  <LocationSchemas />
                </PermissionGuard>
              }
            />
            <Route
              path="schemas/:schemaId"
              element={
                <PermissionGuard permission="module.locations">
                  <LocationSchemaDetail />
                </PermissionGuard>
              }
            />
            <Route
              path="zones"
              element={
                <PermissionGuard permission="module.locations">
                  <LocationZones />
                </PermissionGuard>
              }
            />
            <Route
              path="zones/:zoneId"
              element={
                <PermissionGuard permission="module.locations">
                  <LocationZoneDetail />
                </PermissionGuard>
              }
            />
          </Route>
          <Route path="/export" element={<Navigate to={tp} replace />} />
          <Route path="/export/*" element={<Navigate to={tp} replace />} />
          <Route path="/tests" element={<Navigate to={tp} replace />} />
          <Route path="/tests/*" element={<Navigate to={tp} replace />} />
          <Route path="/test-plans" element={<LegacyBookmarkToTesting />} />
          <Route path="/test-plans/*" element={<LegacyBookmarkToTesting />} />
          <Route path="/results" element={<LegacyBookmarkToTesting />} />
          <Route path="/results/*" element={<LegacyBookmarkToTesting />} />
          <Route path="/fields" element={<LegacyBookmarkToTesting />} />
          <Route path="/fields/*" element={<LegacyBookmarkToTesting />} />
          <Route path="/users" element={<LegacyBookmarkToTesting />} />
          <Route path="/users/*" element={<LegacyBookmarkToTesting />} />
          <Route path="/settings" element={<Navigate to="/admin/settings" replace />} />
          <Route path="/settings/*" element={<Navigate to="/admin/settings" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    ),
    {
      basename: basePath,
      future: { v7_relativeSplatPath: true, v7_startTransition: true },
    }
  )
}
