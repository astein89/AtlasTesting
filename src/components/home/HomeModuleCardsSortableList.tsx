import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { appModules, type AppModule } from '@/config/modules'
import { HomeModuleCardIcon } from '@/components/home/HomeModuleCardIcon'
import { ModuleCardOverrideModal } from '@/components/home/ModuleCardOverrideModal'
import { resolveModuleCardForHome } from '@/lib/moduleCardPresentation'
import type { ModuleCardOverride } from '@/types/homePage'

function SortableModuleRow({
  module: m,
  hideFromHome,
  onToggleHideFromHome,
  moduleCardOverrides,
  onEditModule,
}: {
  module: AppModule
  hideFromHome: boolean
  onToggleHideFromHome: () => void
  moduleCardOverrides: Record<string, ModuleCardOverride> | undefined
  onEditModule?: () => void
}) {
  const { title, description, moduleIconId } = resolveModuleCardForHome(m, moduleCardOverrides)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: m.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  return (
    <li ref={setNodeRef} style={style} className={isDragging ? 'opacity-60' : ''}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/50 py-2 pl-1 pr-2">
        <button
          type="button"
          className="touch-none cursor-grab rounded p-1.5 text-foreground/45 hover:bg-background hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder module"
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm6-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
          </svg>
        </button>
        <HomeModuleCardIcon moduleId={moduleIconId} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{title}</div>
          <div className="truncate text-xs text-foreground/55">{description}</div>
        </div>
        {onEditModule ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onEditModule()
            }}
            className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-background/80"
          >
            Edit
          </button>
        ) : null}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground/75 sm:shrink-0">
          <input
            type="checkbox"
            checked={hideFromHome}
            onChange={onToggleHideFromHome}
            className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary"
          />
          Hide on home
        </label>
      </div>
    </li>
  )
}

export function HomeModuleCardsSortableList({
  moduleOrder,
  onModuleOrderChange,
  modulesHiddenFromHome,
  onToggleHideFromHome,
  moduleCardOverrides,
  onModuleCardOverridesChange,
}: {
  moduleOrder: string[]
  onModuleOrderChange: (order: string[]) => void
  modulesHiddenFromHome: string[]
  onToggleHideFromHome: (moduleId: string) => void
  moduleCardOverrides?: Record<string, ModuleCardOverride>
  onModuleCardOverridesChange?: (next: Record<string, ModuleCardOverride>) => void
}) {
  const [editModuleId, setEditModuleId] = useState<string | null>(null)
  const overrides = moduleCardOverrides ?? {}
  const editingModule = editModuleId ? appModules.find((mod) => mod.id === editModuleId) ?? null : null
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleModuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = moduleOrder.indexOf(String(active.id))
    const newIndex = moduleOrder.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onModuleOrderChange(arrayMove(moduleOrder, oldIndex, newIndex))
  }

  const hidden = new Set(modulesHiddenFromHome)

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
        <SortableContext items={moduleOrder} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {moduleOrder.map((id) => {
              const m = appModules.find((mod) => mod.id === id)
              if (!m) return null
              return (
                <SortableModuleRow
                  key={id}
                  module={m}
                  hideFromHome={hidden.has(id)}
                  onToggleHideFromHome={() => onToggleHideFromHome(id)}
                  moduleCardOverrides={moduleCardOverrides}
                  onEditModule={
                    onModuleCardOverridesChange ? () => setEditModuleId(id) : undefined
                  }
                />
              )
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {onModuleCardOverridesChange ? (
        <ModuleCardOverrideModal
          open={editModuleId !== null}
          module={editingModule}
          overrides={overrides}
          onClose={() => setEditModuleId(null)}
          onApply={(next) => {
            onModuleCardOverridesChange(next)
          }}
        />
      ) : null}
    </>
  )
}
