import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Test } from '../types'

export function TestPlanDataRedirect() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!planId) return
    api
      .get<Test[]>('/tests', { params: { testPlanId: planId } })
      .then((r) => {
        if (r.data.length > 0) {
          navigate(`/tests/${r.data[0].id}/data`, { replace: true })
        } else {
          navigate(`/test-plans/${planId}/edit`, { replace: true })
        }
      })
      .catch(() => navigate('/test-plans', { replace: true }))
  }, [planId, navigate])

  return <p className="text-foreground/60">Loading...</p>
}
