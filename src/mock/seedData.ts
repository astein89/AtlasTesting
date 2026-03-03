// Dev fallback when API is unavailable - remove when backend is complete
export const mockFields = [
  {
    id: '1',
    key: 'cycle_time_sec',
    label: 'Cycle Time (sec)',
    type: 'number' as const,
    config: { unit: 'sec', min: 0, max: 300, required: true },
  },
  {
    id: '2',
    key: 'result',
    label: 'Result',
    type: 'select' as const,
    config: { options: ['Pass', 'Fail', 'N/A'], required: true },
  },
]

export const mockTests = [
  {
    id: '1',
    name: 'Pallet Cycle Test',
    description: 'Standard cycle time verification',
    fieldIds: ['1', '2'],
  },
]
