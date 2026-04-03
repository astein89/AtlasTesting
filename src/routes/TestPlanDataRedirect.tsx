import { useParams, Navigate } from 'react-router-dom'
import { TestPlanDataView } from './TestPlanDataView'
import { testingPath } from '../lib/appPaths'

export function TestPlanDataRedirect() {
  const { planId, testId } = useParams<{ planId: string; testId?: string }>()
  if (!planId) return <Navigate to={testingPath('test-plans')} replace />
  if (!testId) return <Navigate to={testingPath('test-plans', planId)} replace />
  return <TestPlanDataView />
}
