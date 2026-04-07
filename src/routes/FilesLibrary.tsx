import { FilesExplorer } from '@/components/files/FilesExplorer'

export function FilesLibrary() {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <h1 className="mb-2 text-2xl font-semibold text-foreground px-0.5">Files</h1>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FilesExplorer />
      </div>
    </div>
  )
}
