import { useEffect, useState } from 'react'
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
import type { DataField } from '../../types'

interface PlanFieldsEditorProps {
  formLayoutOrder: string[]
  onChange: (order: string[]) => void
  onCreateNew?: () => void
}

function SortableLayoutItem({
  id,
  index,
  fieldMap,
  setFieldSpan,
  removeItem,
  insertSeparatorBefore,
  removeSeparator,
}: {
  id: string
  index: number
  fieldMap: Map<string, DataField>
  setFieldSpan: (index: number, span: 1 | 2 | 3 | 4) => void
  removeItem: (index: number) => void
  insertSeparatorBefore: (index: number) => void
  removeSeparator: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

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

  const { fieldId, span } = parseFieldEntry(id)
  const field = fieldMap.get(fieldId)
  if (!field) return null

  return (
    <li ref={setNodeRef} style={style} className={`${baseClass} pointer-events-none border border-transparent`}>
      <span {...attributes} {...listeners} className="pointer-events-auto shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
        ⋮⋮
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground sm:text-base" title={field.label}>
        {field.label}
      </span>
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

export function PlanFieldsEditor({
  formLayoutOrder,
  onChange,
  onCreateNew,
}: PlanFieldsEditorProps) {
  const [allFields, setAllFields] = useState<DataField[]>([])
  const [search, setSearch] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const useTouchDnd = useIsTouchDevice()

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

  const availableFields = allFields.filter(
    (f) =>
      !fieldIdsInOrder.includes(f.id) &&
      (search === '' ||
        f.key.toLowerCase().includes(search.toLowerCase()) ||
        f.label.toLowerCase().includes(search.toLowerCase()))
  )

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
    onChange([...order, formatFieldEntry(fieldId, 3)])
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
      alert(err || 'Failed to add Status field')
    }
  }

  const removeItem = (index: number) => {
    const next = order.filter((_, i) => i !== index)
    onChange(next)
  }

  const insertSeparatorBefore = (index: number) => {
    const next = [...order]
    next.splice(index, 0, createSeparatorLineId())
    onChange(next)
  }

  const addSeparator = () => {
    onChange([...order, createSeparatorLineId()])
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

  const rows = buildFormRowsFromOrder(planFields, order)

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
                  onClick={() => onChange([...order, createSeparatorId()])}
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
                      <SortableLayoutItem
                        key={id}
                        id={id}
                        index={i}
                        fieldMap={fieldMap}
                        setFieldSpan={setFieldSpan}
                        removeItem={removeItem}
                        insertSeparatorBefore={insertSeparatorBefore}
                        removeSeparator={removeSeparator}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            ) : (
              <ul className="h-[25rem] space-y-1 overflow-y-auto overflow-x-hidden rounded border border-border bg-card p-2 [-webkit-overflow-scrolling:touch]">
                {order.map((id, i) => {
                  if (isSeparatorId(id)) {
                    return (
                      <li
                        key={id}
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
                    )
                  }
                  if (isSeparatorLineId(id)) {
                    return (
                      <li
                        key={id}
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
                    )
                  }
                  const { fieldId, span } = parseFieldEntry(id)
                  const field = fieldMap.get(fieldId)
                  if (!field) return null
                  return (
                    <li
                      key={id}
                      draggable
                      onDragStart={(e) => handleNativeDragStart(e, i)}
                      onDragOver={(e) => handleNativeDragOver(e, i)}
                      onDrop={handleNativeDrop}
                      onDragEnd={handleNativeDragEnd}
                      className={`flex cursor-grab items-center gap-1 rounded border border-transparent px-2 py-1.5 active:cursor-grabbing sm:gap-2 ${
                        draggedIndex === i ? 'opacity-50' : 'hover:bg-background/50'
                      }`}
                    >
                      <span className="shrink-0 cursor-grab text-foreground/40" title="Drag to reorder">
                        ⋮⋮
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground sm:text-base" title={field.label}>
                        {field.label}
                      </span>
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
                        (field.type === 'number' || field.type === 'fraction'
                          ? 0
                          : field.type === 'boolean'
                            ? false
                            : field.type === 'image' && field.config?.imageMultiple
                              ? []
                              : '') as string | number | boolean,
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
