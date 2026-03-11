import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { AdminGuard } from './components/auth/AdminGuard'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/layout/Layout'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { FieldsList } from './routes/FieldsList'
import { FieldEditor } from './routes/FieldEditor'
import { TestPlansList } from './routes/TestPlansList'
import { TestPlanDataRedirect } from './routes/TestPlanDataRedirect'
import { TestPlanEditor } from './routes/TestPlanEditor'
import { ResultsList } from './routes/ResultsList'
import { ResultDetail } from './routes/ResultDetail'
import { Users } from './routes/Users'
import { DbTablesViewer } from './routes/DbTablesViewer'
import { Settings } from './routes/Settings'
import { useAuthStore } from './store/authStore'
import { api } from './api/client'
import { AlertConfirmProvider } from './contexts/AlertConfirmContext'

const REHYDRATE_DELAY_MS = 300

function AuthInit() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const setInitializing = useAuthStore((s) => s.setInitializing)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const user = useAuthStore((s) => s.user)
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
    if (user && accessToken) return
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

    api
      .post<{ accessToken: string }>('/auth/refresh', { refreshToken: currentRefresh })
      .then((r) => {
        setAccessToken(r.data.accessToken)
        return api.get<{ id: string; username: string; name?: string; role: string }>('/auth/me')
      })
      .then((r) => {
        const token = useAuthStore.getState().accessToken
        if (token) setAuth(r.data, token, currentRefresh)
      })
      .catch(() => {
        useAuthStore.getState().logout()
      })
      .finally(() => {
        clearTimeout(timeout)
        useAuthStore.getState().setInitializing(false)
      })

    return () => clearTimeout(timeout)
  }, [hydrationDone, refreshToken, user, setAuth, setAccessToken, setInitializing])

  return null
}

function App() {
  return (
    <AlertConfirmProvider>
      <AuthInit />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Dashboard />} />
          <Route
            path="fields"
            element={
              <AdminGuard>
                <FieldsList />
              </AdminGuard>
            }
          />
          <Route
            path="fields/:id"
            element={
              <AdminGuard>
                <FieldEditor />
              </AdminGuard>
            }
          />
          <Route path="test-plans" element={<TestPlansList />} />
          <Route path="test-plans/new" element={<AdminGuard><ErrorBoundary fallbackTitle="Could not load plan editor" backTo="/test-plans" backLabel="Back to Test plans"><TestPlanEditor /></ErrorBoundary></AdminGuard>} />
          <Route path="test-plans/:planId" element={<Navigate to="data" replace />} />
          <Route path="test-plans/:planId/data" element={<TestPlanDataRedirect />} />
          <Route path="test-plans/:planId/edit" element={<AdminGuard><ErrorBoundary fallbackTitle="Could not load plan editor" backTo="/test-plans" backLabel="Back to Test plans"><TestPlanEditor /></ErrorBoundary></AdminGuard>} />
          <Route path="results" element={<ResultsList />} />
          <Route path="results/:id" element={<ResultDetail />} />
          <Route path="settings" element={<AdminGuard><Settings /></AdminGuard>} />
          <Route path="export" element={<Navigate to="/test-plans" replace />} />
          <Route
            path="users"
            element={
              <AdminGuard>
                <Users />
              </AdminGuard>
            }
          />
          <Route
            path="admin/db"
            element={
              <AdminGuard>
                <DbTablesViewer />
              </AdminGuard>
            }
          />
        </Route>
        <Route path="tests" element={<Navigate to="/test-plans" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AlertConfirmProvider>
  )
}

export default App
