import { api } from './client'
import type { Test } from '../types'

export function getTests(planId: string, options?: { archived?: boolean }): Promise<Test[]> {
  const params = options?.archived ? { archived: 'true' } : {}
  return api.get<Test[]>(`/test-plans/${planId}/tests`, { params }).then((r) => r.data)
}

export function getTest(planId: string, testId: string): Promise<Test> {
  return api.get<Test>(`/test-plans/${planId}/tests/${testId}`).then((r) => r.data)
}

export function createTest(
  planId: string,
  body: { name: string; startDate?: string; endDate?: string }
): Promise<Test> {
  return api.post<Test>(`/test-plans/${planId}/tests`, body).then((r) => r.data)
}

export function updateTest(
  planId: string,
  testId: string,
  body: Partial<{ name: string; startDate: string; endDate: string; archived: boolean }>
): Promise<Test> {
  return api.put<Test>(`/test-plans/${planId}/tests/${testId}`, body).then((r) => r.data)
}

export function deleteTest(planId: string, testId: string): Promise<void> {
  return api.delete(`/test-plans/${planId}/tests/${testId}`).then(() => undefined)
}
