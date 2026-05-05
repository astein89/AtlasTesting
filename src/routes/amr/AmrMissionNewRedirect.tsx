import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { amrPath } from '@/lib/appPaths'
import { useAmrMissionNewModal } from '@/contexts/AmrMissionNewModalContext'

/** Opens the new-mission modal and replaces `/amr/missions/new` with `/amr/missions` (bookmark / deep-link compat). */
export function AmrMissionNewRedirect() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const ctx = useAmrMissionNewModal()

  useEffect(() => {
    ctx?.openNewMission({ search: search || undefined })
    navigate(amrPath('missions'), { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  return null
}
