import { Fragment, useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '../../api/client'
import { renderFormField } from './FormFieldRenderer'
import {
  buildFormRowsFromOrder,
  createSeparatorId,
  createSeparatorLineId,
  formatFieldEntry,
  getFieldIdsFromOrder,
  isSeparatorId,
  isSeparatorLineId,
  parseFieldEntry,
} from '../../utils/formLayout'
import { getDefaultValueForField } from '../../utils/fieldDefaults'
import { getFormulaReferencedFieldKeys } from '../../utils/formulaEvaluator'
import { useAlertConfirm } from '../../contexts/AlertConfirmContext'
import type { DataField } from '../../types'

interface PlanFieldsEditorProps {
  formLayoutOrder: string[]
  onChange: (order: string[]) => void
  /** Field ids marked hidden (not shown in data table / edit / result) */
  hiddenFieldIds?: string[]
  onHiddenFieldIdsChange?: (ids: string[]) => void
  /** Field ids that are required when entering records for this plan */
  requiredFieldIds?: string[]
  onRequiredFieldIdsChange?: (ids: string[]) => void
  onCreateNew?: () => void
  /** Default values by field key (from test plan); shown in Live preview when set */
  fieldDefaults?: Record<string, string | number | boolean | string[]>
  /** Rendered just above the Live preview block */
  renderAbovePreview?: React.ReactNode
  /** Current plan id; used to highlight plan-specific fields for this plan. */
  planId?: string
}

function SortableLayoutItem({
  id,
  index,
  fieldMap,
  setFieldSpan,
  removeItem,
  insertSeparatorBefore,
  removeSeparator,
  hiddenFieldIds,
  onHiddenFieldIdsChange,
  isRequired,
  planId,
}: {
  id: string
  index: number
  fieldMap: Map<string, DataField>
  setFieldSpan: (index: number, span: 1 | 2 | 3 | 4) => void
  removeItem: (index: number) => void
  insertSeparatorBefore: (index: number) => void
  removeSeparator: (id: string) => void
  hiddenFieldIds: string[]
  onHiddenFieldIdsChange?: (ids: string[]) => void
  /** Whether this field is required; used only for display. */
  isRequired: boolean
  planId?: string
}) {
  const { fieldId } = parseFieldEntry(id)
  const isHidden = hiddenFieldIds.includes(fieldId)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: isHidden,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    touchAction: (isDragging ? 'none' : 'pan-y') as const,
  }

  const baseClass = `flex cursor-grab items-center gap-1 rounded px-2 py-1.5 active:cursor-grabbing sm:gap-2 ${
    isDragging ? 'opacity-50' : 'hover:bg-background/50'
  }`

  if (isSeparatorId(id)) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className={`${baseClass} pointer-events-none border border-dashed border-foreground/30`}
      >
        <span {...attributes} {...listeners} className="pointer-events-auto shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
          ⋮⋮
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/70 sm:text-sm">— New line —</span>
        <button
          type="button"
          onClick={() => insertSeparatorBefore(index)}
          className="pointer-events-auto rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
          title="Add separator before"
        >
          —
        </button>
        <button type="button" onClick={() => removeSeparator(id)} className="pointer-events-auto text-red-500 hover:underline">
          Remove
        </button>
      </li>
    )
  }

  if (isSeparatorLineId(id)) {
    return (
      <li
        ref={setNodeRef}
        style={style}
        className={`${baseClass} pointer-events-none border border-dashed border-foreground/30`}
      >
        <span {...attributes} {...listeners} className="pointer-events-auto shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
          ⋮⋮
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/70 sm:text-sm">— Separator —</span>
        <button
          type="button"
          onClick={() => insertSeparatorBefore(index)}
          className="pointer-events-auto rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
          title="Add separator before"
        >
          —
        </button>
        <button type="button" onClick={() => removeSeparator(id)} className="pointer-events-auto text-red-500 hover:underline">
          Remove
        </button>
      </li>
    )
  }

  const { span } = parseFieldEntry(id)
  const field = fieldMap.get(fieldId)
  if (!field) return null
  const isPlanSpecific = !!planId && field.ownerTestPlanId === planId

  const toggleHidden = () => {
    if (!onHiddenFieldIdsChange) return
    if (isHidden) {
      onHiddenFieldIdsChange(hiddenFieldIds.filter((x) => x !== fieldId))
    } else {
      onHiddenFieldIdsChange([...hiddenFieldIds, fieldId])
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`${baseClass} pointer-events-none border border-transparent ${
        isHidden ? 'opacity-75' : ''
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        className={`pointer-events-auto shrink-0 ${
          isHidden ? 'cursor-default text-foreground/30' : 'cursor-grab text-foreground/40'
        }`}
        title={isHidden ? 'Hidden fields are fixed at the bottom' : 'Drag to reorder'}
      >
        ⋮⋮
      </span>
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground sm:text-base"
        title={field.label}
      >
        {field.label}
        {isPlanSpecific && (
          <span className="ml-2 inline-flex items-center rounded-full border border-yellow-500 bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-900 dark:border-yellow-400 dark:bg-yellow-500/30 dark:text-yellow-50">
            Plan
          </span>
        )}
      </span>
      {isRequired && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-foreground/70 sm:px-2 sm:py-0.5" title="Required when entering data">
          Required
        </span>
      )}
      {onHiddenFieldIdsChange != null && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleHidden() }}
          className={`pointer-events-auto shrink-0 rounded px-1.5 py-0.5 text-xs sm:px-2 sm:py-0.5 ${isHidden ? 'bg-amber-200 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100' : 'text-foreground/60 hover:bg-background'}`}
          title={isHidden ? 'Show in data table and forms' : 'Hide from data table and forms'}
        >
          {isHidden ? 'Hidden' : 'Hide'}
        </button>
      )}
      <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded border border-border bg-background/50 p-0.5 sm:gap-1 sm:p-1">
        <span className="text-xs text-foreground/60 sm:text-sm">
          {span === 1 ? '⅓' : span === 4 ? '½' : span === 2 ? '⅔' : 'Full'}
        </span>
        {([1, 4, 2, 3] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setFieldSpan(index, s)
            }}
            className={`rounded px-1 py-0.5 text-xs sm:px-1.5 sm:py-0.5 sm:text-sm ${
              span === s
                ? 'bg-orange-200 text-orange-900 dark:bg-orange-800/60 dark:text-orange-100'
                : 'text-foreground/60 hover:bg-background'
            }`}
            title={
              s === 1 ? '1/3 width' : s === 4 ? '1/2 width' : s === 2 ? '2/3 width' : 'Full width (new line)'
            }
          >
            {s === 1 ? '⅓' : s === 4 ? '½' : s === 2 ? '⅔' : '▬'}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => insertSeparatorBefore(index)}
        className="pointer-events-auto rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
        title="Add separator before this field"
      >
        —
      </button>
      <button type="button" onClick={() => removeItem(index)} className="pointer-events-auto text-red-500 hover:underline">
        Remove
      </button>
    </li>
  )
}

function useIsTouchDevice() {
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )
  return isTouch
}

export function PlanFieldsEditor(props: PlanFieldsEditorProps) {
  const {
    formLayoutOrder,
    onChange,
    hiddenFieldIds: hiddenFieldIdsProp,
    onHiddenFieldIdsChange,
    requiredFieldIds: requiredFieldIdsProp,
    onRequiredFieldIdsChange,
    onCreateNew,
    fieldDefaults,
    renderAbovePreview,
    planId,
  } = props
  // Ensure these arrays are always defined so downstream code never sees an undefined variable.
  const hiddenFieldIds = hiddenFieldIdsProp ?? []
  const requiredFieldIds = requiredFieldIdsProp ?? []
  const [allFields, setAllFields] = useState<DataField[]>([])
  const [search, setSearch] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const useTouchDnd = useIsTouchDevice()
  const { showAlert } = useAlertConfirm()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 300, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    api
      .get<DataField[]>('/fields')
      .then((r) => setAllFields(r.data))
      .catch(() => setAllFields([]))
  }, [])

  const fieldIdsInOrder = getFieldIdsFromOrder(formLayoutOrder)
  const fieldMap = new Map(allFields.map((f) => [f.id, f]))
  const planFields = fieldIdsInOrder
    .map((id) => fieldMap.get(id))
    .filter(Boolean) as DataField[]
  const order = formLayoutOrder.length > 0 ? formLayoutOrder : fieldIdsInOrder

  function partitionOrderByHidden(o: string[], hiddenIds: string[]) {
    const set = new Set(hiddenIds)
    const visible: string[] = []
    const hidden: string[] = []
    for (const entry of o) {
      if (isSeparatorId(entry) || isSeparatorLineId(entry)) visible.push(entry)
      else {
        if (set.has(parseFieldEntry(entry).fieldId)) hidden.push(entry)
        else visible.push(entry)
      }
    }
    return { visible, hidden }
  }

  const availableFields = allFields
    .filter((f) => {
      // Do not allow adding a plan-specific field to other plans.
      if (f.ownerTestPlanId && (!planId || f.ownerTestPlanId !== planId)) return false
      if (fieldIdsInOrder.includes(f.id)) return false
      if (search === '') return true
      const q = search.toLowerCase()
      return f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (!planId) return 0
      const aPlan = a.ownerTestPlanId === planId
      const bPlan = b.ownerTestPlanId === planId
      if (aPlan === bPlan) return 0
      return aPlan ? -1 : 1
    })

  const handleDndDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = order.indexOf(String(active.id))
      const newIndex = order.indexOf(String(over.id))
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(order, oldIndex, newIndex))
      }
    }
  }

  const handleNativeDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleNativeDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIndex === null || draggedIndex === index) return
    const next = [...order]
    const [removed] = next.splice(draggedIndex, 1)
    next.splice(index, 0, removed)
    onChange(next)
    setDraggedIndex(index)
  }

  const handleNativeDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDraggedIndex(null)
  }

  const handleNativeDragEnd = () => setDraggedIndex(null)

  const addField = (fieldId: string) => {
    const field = allFields.find((f) => f.id === fieldId)
    const refKeys =
      field && (field.type === 'formula' || (field.type === 'status' && field.config?.formula))
        ? getFormulaReferencedFieldKeys(field.config?.formula ?? '')
        : []
    const missingRefIds: string[] = []
    for (const key of refKeys) {
      const refField = allFields.find((f) => f.key === key)
      if (refField && !fieldIdsInOrder.includes(refField.id)) missingRefIds.push(refField.id)
    }
    const newEntries = [
      ...missingRefIds.map((id) => formatFieldEntry(id, 3)),
      formatFieldEntry(fieldId, 3),
    ]
    const { visible, hidden } = partitionOrderByHidden(order, hiddenFieldIds)
    onChange([...visible, ...newEntries, ...hidden])
  }

  const addStatusField = async () => {
    const existing = allFields.find((f) => f.type === 'status')
    if (existing) {
      if (fieldIdsInOrder.includes(existing.id)) return
      addField(existing.id)
      return
    }
    try {
      const { data } = await api.post<DataField>('/fields', {
        key: 'status',
        label: 'Status',
        type: 'status',
        config: {},
      })
      setAllFields((prev) => [...prev, data])
      addField(data.id)
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      showAlert(err || 'Failed to add Status field')
    }
  }

  const removeItem = (index: number) => {
    const next = order.filter((_, i) => i !== index)
    const removedEntry = order[index]
    if (!isSeparatorId(removedEntry) && !isSeparatorLineId(removedEntry)) {
      const { fieldId: removedFieldId } = parseFieldEntry(removedEntry)
      const removedField = allFields.find((f) => f.id === removedFieldId)
      const removedKey = removedField?.key
      if (removedKey) {
        const remainingIds = getFieldIdsFromOrder(next)
        const formulaFieldsUsing = allFields.filter(
          (f) =>
            remainingIds.includes(f.id) &&
            (f.type === 'formula' || (f.type === 'status' && f.config?.formula)) &&
            getFormulaReferencedFieldKeys(f.config?.formula ?? '').includes(removedKey)
        )
        if (formulaFieldsUsing.length > 0) {
          const names = formulaFieldsUsing.map((f) => f.label || f.key).join(', ')
          showAlert(`Cannot remove this field. It is used in a formula in: ${names}. Remove or update those formulas first.`)
          return
        }
      }
    }
    onChange(next)
  }

  const insertSeparatorBefore = (index: number) => {
    const next = [...order]
    next.splice(index, 0, createSeparatorLineId())
    onChange(next)
  }

  const addSeparator = () => {
    const { visible, hidden } = partitionOrderByHidden(order, hiddenFieldIds)
    onChange([...visible, createSeparatorLineId(), ...hidden])
  }

  const removeSeparator = (id: string) => {
    onChange(order.filter((x) => x !== id))
  }

  const setFieldSpan = (index: number, span: 1 | 2 | 3 | 4) => {
    const id = order[index]
    if (isSeparatorId(id) || isSeparatorLineId(id)) return
    const { fieldId } = parseFieldEntry(id)
    const next = [...order]
    next[index] = formatFieldEntry(fieldId, span)
    onChange(next)
  }

  const hiddenSet = new Set(hiddenFieldIds)
  const previewOrder = order.filter((entry) => {
    if (isSeparatorId(entry) || isSeparatorLineId(entry)) return true
    const { fieldId } = parseFieldEntry(entry)
    return !hiddenSet.has(fieldId)
  })

  const rows = buildFormRowsFromOrder(planFields, previewOrder)

  /** True if this order entry is a hidden field (not separator). */
  function isEntryHidden(entry: string): boolean {
    if (isSeparatorId(entry) || isSeparatorLineId(entry)) return false
    return hiddenSet.has(parseFieldEntry(entry).fieldId)
  }

  /** True if this index is the first hidden field in the list (so we show "Hidden fields" divider before it). */
  function isFirstHiddenIndex(idx: number): boolean {
    if (idx >= order.length) return false
    if (!isEntryHidden(order[idx])) return false
    if (idx === 0) return true
    return !isEntryHidden(order[idx - 1])
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-foreground"
        />
        {onCreateNew && (
          <button
            type="button"
            onClick={onCreateNew}
            className="rounded-lg border border-border px-4 py-2 text-foreground hover:bg-background"
          >
            Create new field
          </button>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border p-4">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-foreground">
                Form layout
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addStatusField}
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                >
                  + Status
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { visible, hidden } = partitionOrderByHidden(order, hiddenFieldIds)
                    onChange([...visible, createSeparatorId(), ...hidden])
                  }}
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                >
                  + New line
                </button>
                <button
                  type="button"
                  onClick={addSeparator}
                  className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-background"
                >
                  + Separator
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
            {useTouchDnd ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDndDragEnd}
              >
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                  <ul className="h-[25rem] space-y-1 overflow-y-auto overflow-x-hidden rounded border border-border bg-card p-2 [-webkit-overflow-scrolling:touch]">
                    {order.map((id, i) => (
                      <Fragment key={id}>
                        {isFirstHiddenIndex(i) && (
                          <li className="border-t border-border pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
                            <span className="text-xs font-medium text-foreground/60">Hidden fields</span>
                          </li>
                        )}
                        <SortableLayoutItem
                          id={id}
                          index={i}
                          fieldMap={fieldMap}
                          setFieldSpan={setFieldSpan}
                          removeItem={removeItem}
                          insertSeparatorBefore={insertSeparatorBefore}
                          removeSeparator={removeSeparator}
                          hiddenFieldIds={hiddenFieldIds}
                          onHiddenFieldIdsChange={onHiddenFieldIdsChange}
                          isRequired={(requiredFieldIds ?? []).includes(parseFieldEntry(id).fieldId)}
                          planId={planId}
                        />
                      </Fragment>
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            ) : (
              <ul className="h-[25rem] space-y-1 overflow-y-auto overflow-x-hidden rounded border border-border bg-card p-2 [-webkit-overflow-scrolling:touch]">
                {order.map((id, i) => {
                  const showHiddenDivider = isFirstHiddenIndex(i)
                  if (isSeparatorId(id)) {
                    return (
                      <Fragment key={id}>
                        {showHiddenDivider && (
                          <li className="border-t border-border pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
                            <span className="text-xs font-medium text-foreground/60">Hidden fields</span>
                          </li>
                        )}
                        <li
                          draggable
                          onDragStart={(e) => handleNativeDragStart(e, i)}
                          onDragOver={(e) => handleNativeDragOver(e, i)}
                          onDrop={handleNativeDrop}
                          onDragEnd={handleNativeDragEnd}
                          className={`flex cursor-grab items-center gap-1 rounded border border-dashed border-foreground/30 px-2 py-1.5 active:cursor-grabbing sm:gap-2 ${
                            draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
                          }`}
                        >
                          <span className="shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
                            ⋮⋮
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground/70 sm:text-sm">— New line —</span>
                          <button
                            type="button"
                            onClick={() => insertSeparatorBefore(i)}
                            className="rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
                            title="Add separator before"
                          >
                            —
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSeparator(id)}
                            className="text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      </Fragment>
                    )
                  }
                  if (isSeparatorLineId(id)) {
                    return (
                      <Fragment key={id}>
                        {showHiddenDivider && (
                          <li className="border-t border-border pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
                            <span className="text-xs font-medium text-foreground/60">Hidden fields</span>
                          </li>
                        )}
                        <li
                          draggable
                          onDragStart={(e) => handleNativeDragStart(e, i)}
                          onDragOver={(e) => handleNativeDragOver(e, i)}
                          onDrop={handleNativeDrop}
                          onDragEnd={handleNativeDragEnd}
                          className={`flex cursor-grab items-center gap-1 rounded border border-dashed border-foreground/30 px-2 py-1.5 active:cursor-grabbing sm:gap-2 ${
                            draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
                          }`}
                        >
                          <span className="shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
                            ⋮⋮
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-foreground/70 sm:text-sm">— Separator —</span>
                          <button
                            type="button"
                            onClick={() => insertSeparatorBefore(i)}
                            className="rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
                            title="Add separator before"
                          >
                            —
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSeparator(id)}
                            className="text-red-500 hover:underline"
                          >
                            Remove
                          </button>
                        </li>
                      </Fragment>
                    )
                  }
                  const { fieldId, span } = parseFieldEntry(id)
                  const field = fieldMap.get(fieldId)
                  if (!field) return null
                  const itemHidden = (hiddenFieldIds ?? []).includes(fieldId)
                  return (
                    <Fragment key={id}>
                      {showHiddenDivider && (
                        <li className="border-t border-border pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
                          <span className="text-xs font-medium text-foreground/60">Hidden fields</span>
                        </li>
                      )}
                      <li
                        draggable={!itemHidden}
                        onDragStart={itemHidden ? undefined : (e) => handleNativeDragStart(e, i)}
                        onDragOver={itemHidden ? undefined : (e) => handleNativeDragOver(e, i)}
                        onDrop={handleNativeDrop}
                        onDragEnd={handleNativeDragEnd}
                        className={`flex items-center gap-1 rounded border border-transparent px-2 py-1.5 sm:gap-2 ${
                          itemHidden ? 'cursor-default opacity-75' : `cursor-grab active:cursor-grabbing ${draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'}`
                        }`}
                      >
                        <span className={`shrink-0 ${itemHidden ? 'cursor-default text-foreground/30' : 'cursor-grab text-foreground/40'}`} title={itemHidden ? 'Hidden (fixed at bottom)' : 'Drag to reorder'}>
                          ⋮⋮
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-foreground sm:text-base" title={field.label}>
                          {field.label}
                          {planId && field.ownerTestPlanId === planId && (
                            <span className="ml-2 inline-flex items-center rounded-full border border-yellow-500 bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-900 dark:border-yellow-400 dark:bg-yellow-500/30 dark:text-yellow-50">
                              Plan
                            </span>
                          )}
                        </span>
                        {!itemHidden && (requiredFieldIds ?? []).includes(fieldId) && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-foreground/70 sm:px-2 sm:py-0.5">
                            Required
                          </span>
                        )}
                        {itemHidden && (
                          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-amber-200 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100 sm:px-2 sm:py-0.5">
                            Hidden
                          </span>
                        )}
                        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded border border-border bg-background/50 p-0.5 sm:gap-1 sm:p-1">
                        <span className="text-xs text-foreground/60 sm:text-sm">
                          {span === 1 ? '⅓' : span === 4 ? '½' : span === 2 ? '⅔' : 'Full'}
                        </span>
                        {([1, 4, 2, 3] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFieldSpan(i, s)
                            }}
                            className={`rounded px-1 py-0.5 text-xs sm:px-1.5 sm:py-0.5 sm:text-sm ${
                              span === s
                                ? 'bg-orange-200 text-orange-900 dark:bg-orange-800/60 dark:text-orange-100'
                                : 'text-foreground/60 hover:bg-background'
                            }`}
                            title={
                              s === 1 ? '1/3 width' : s === 4 ? '1/2 width' : s === 2 ? '2/3 width' : 'Full width (new line)'
                            }
                          >
                            {s === 1 ? '⅓' : s === 4 ? '½' : s === 2 ? '⅔' : '▬'}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => insertSeparatorBefore(i)}
                        className="rounded px-1.5 py-0.5 text-xs text-foreground/60 hover:bg-background"
                        title="Add separator before this field"
                      >
                        —
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                    </Fragment>
                  )
                })}
              </ul>
            )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border p-4">
            <h3 className="mb-2 shrink-0 text-sm font-medium text-foreground">
              Available
            </h3>
            <ul className="h-[25rem] space-y-1 overflow-y-auto overflow-x-hidden rounded border border-border bg-card p-2 [-webkit-overflow-scrolling:touch]">
              {availableFields.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => addField(f.id)}
                    className="w-full truncate rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-card sm:text-sm"
                    title={f.label}
                  >
                    {f.label}
                    {planId && f.ownerTestPlanId === planId && (
                      <span className="ml-2 inline-flex items-center rounded-full border border-yellow-500 bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-yellow-900 dark:border-yellow-400 dark:bg-yellow-500/30 dark:text-yellow-50">
                        Plan
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {availableFields.length === 0 && (
                <li className="px-2 py-1.5 text-sm text-foreground/50">
                  No more fields to add
                </li>
              )}
            </ul>
          </div>
        </div>
        {renderAbovePreview}
        <div>
          <p className="mb-2 text-xs font-medium text-foreground/60">
            Live preview
          </p>
          <div className="space-y-3 rounded border border-border bg-card p-3 sm:space-y-4 sm:p-4">
            {rows.map((row, ri) =>
              Array.isArray(row) ? (
                <div key={ri} className="grid grid-cols-6 gap-2 sm:gap-4">
                  {row.map(({ field, span }) => (
                    <div
                      key={field.id}
                      className={`min-w-0 ${span === 1 ? 'col-span-2' : span === 4 ? 'col-span-3' : span === 2 ? 'col-span-4' : 'col-span-6'}`}
                    >
                      <label className="mb-1 block truncate text-xs font-medium text-foreground sm:text-sm" title={field.label}>
                        {field.label}
                      </label>
                      {renderFormField(
                        field,
                        getDefaultValueForField(field, fieldDefaults) as string | number | boolean,
                        () => {},
                        { disabled: true }
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div key={ri} className="my-4 border-t-2 border-border" />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
