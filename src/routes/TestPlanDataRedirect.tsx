import { useParams, Navigate } from 'react-router-dom'
import { TestPlanDataView } from './TestPlanDataView'

export function TestPlanDataRedirect() {
  const { planId, testId } = useParams<{ planId: string; testId?: string }>()
  if (!planId) return <Navigate to="/test-plans" replace />
  if (!testId) return <Navigate to={`/test-plans/${planId}`} replace />
  return <TestPlanDataView />
}
