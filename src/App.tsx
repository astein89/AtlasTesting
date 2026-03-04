import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { AdminGuard } from './components/auth/AdminGuard'
import { Layout } from './components/layout/Layout'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { FieldsList } from './routes/FieldsList'
import { FieldEditor } from './routes/FieldEditor'
import { TestPlansList } from './routes/TestPlansList'
import { TestPlanDataRedirect } from './routes/TestPlanDataRedirect'
import { TestPlanEditor } from './routes/TestPlanEditor'
import { TestsNew } from './routes/TestsNew'
import { TestEditor } from './routes/TestEditor'
import { TestData } from './routes/TestData'
import { ResultsList } from './routes/ResultsList'
import { ResultDetail } from './routes/ResultDetail'
import { Users } from './routes/Users'
import { DbTablesViewer } from './routes/DbTablesViewer'
import { useAuthStore } from './store/authStore'
import { api } from './api/client'

function AuthInit() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const setAccessToken = useAuthStore((s) => s.setAccessToken)
  const setInitializing = useAuthStore((s) => s.setInitializing)
  const refreshToken = useAuthStore((s) => s.refreshToken)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (user) return
    if (!refreshToken) return

    setInitializing(true)
    api
      .post<{ accessToken: string }>('/auth/refresh', { refreshToken })
      .then((r) => {
        setAccessToken(r.data.accessToken)
        return api.get<{ id: string; username: string; name?: string; role: string }>('/auth/me')
      })
      .then((r) => {
        const token = useAuthStore.getState().accessToken
        if (token) setAuth(r.data, token, refreshToken)
      })
      .catch(() => {
        useAuthStore.getState().logout()
      })
      .finally(() => {
        useAuthStore.getState().setInitializing(false)
      })
  }, [refreshToken, user, setAuth, setAccessToken, setInitializing])

  return null
}

function App() {
  return (
    <>
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
          <Route path="test-plans/new" element={<AdminGuard><TestPlanEditor /></AdminGuard>} />
          <Route path="test-plans/:planId" element={<Navigate to="data" replace />} />
          <Route path="test-plans/:planId/data" element={<TestPlanDataRedirect />} />
          <Route path="test-plans/:planId/edit" element={<AdminGuard><TestPlanEditor /></AdminGuard>} />
          <Route
            path="test-plans/:planId/tests/new"
            element={
              <AdminGuard>
                <TestsNew />
              </AdminGuard>
            }
          />
          <Route path="test-plans/:planId/tests" element={<Navigate to="../data" replace />} />
          <Route path="tests/:id" element={<TestEditor />} />
          <Route path="tests/:id/data" element={<TestData />} />
          <Route path="tests/:id/run" element={<Navigate to="../data" replace />} />
          <Route path="results" element={<ResultsList />} />
          <Route path="results/:id" element={<ResultDetail />} />
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
    </>
  )
}

export default App
