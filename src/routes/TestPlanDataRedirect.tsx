import { useParams, Navigate } from 'react-router-dom'
import { TestPlanDataView } from './TestPlanDataView'

export function TestPlanDataRedirect() {
  const { planId } = useParams<{ planId: string }>()
  if (!planId) return <Navigate to="/test-plans" replace />
  return <TestPlanDataView />
}
