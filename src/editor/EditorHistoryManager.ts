import type { EditorMapData } from '../editorMapTypes'

export interface EditorHistoryManagerContext {
  serializeCurrentMapData: () => EditorMapData
  applyMapData: (data: EditorMapData) => void
}

interface EditorHistoryEntry {
  data: EditorMapData
  id: number
}

export class EditorHistoryManager {
  private ctx: EditorHistoryManagerContext
  private undoStack: EditorHistoryEntry[] = []
  private redoStack: EditorHistoryEntry[] = []
  private entryPool: EditorHistoryEntry[] = []
  private suspended = false
  private maxEntries: number
  private nextEntryId = 1

  constructor(ctx: EditorHistoryManagerContext, maxEntries: number) {
    this.ctx = ctx
    this.maxEntries = maxEntries
  }

  setSuspended(value: boolean) {
    this.suspended = value
  }

  reset(data: EditorMapData) {
    this.clearStacks()
    this.pushUndoData(data)
  }

  getCurrentEntryId(): number {
    const entry = this.undoStack[this.undoStack.length - 1]
    return entry ? entry.id : 0
  }

  capture() {
    if (this.suspended) {
      return
    }
    const data = this.ctx.serializeCurrentMapData()
    this.pushUndoData(data)
    this.clearRedoStack()
  }

  undo(): boolean {
    if (this.undoStack.length <= 1) {
      return false
    }
    const current = this.undoStack.pop()
    if (!current) {
      return false
    }
    this.redoStack.push(current)
    const previous = this.undoStack[this.undoStack.length - 1]
    if (!previous) {
      return false
    }
    this.applySnapshot(previous.data)
    return true
  }

  redo(): boolean {
    if (this.redoStack.length === 0) {
      return false
    }
    const entry = this.redoStack.pop()
    if (!entry) {
      return false
    }
    this.undoStack.push(entry)
    this.applySnapshot(entry.data)
    return true
  }

  private applySnapshot(data: EditorMapData) {
    this.suspended = true
    this.ctx.applyMapData(data)
    this.suspended = false
  }

  private pushUndoData(data: EditorMapData) {
    const entry = this.acquireEntry(data)
    this.undoStack.push(entry)
    if (this.undoStack.length > this.maxEntries) {
      const removed = this.undoStack.shift()
      if (removed) {
        this.releaseEntry(removed)
      }
    }
  }

  private clearRedoStack() {
    while (this.redoStack.length > 0) {
      const entry = this.redoStack.pop()
      if (entry) {
        this.releaseEntry(entry)
      }
    }
  }

  private clearStacks() {
    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop()
      if (entry) {
        this.releaseEntry(entry)
      }
    }
    this.clearRedoStack()
  }

  private acquireEntry(data: EditorMapData): EditorHistoryEntry {
    const entry = this.entryPool.pop()
    if (entry) {
      entry.data = data
      entry.id = this.nextEntryId
      this.nextEntryId += 1
      return entry
    }
    const nextEntry: EditorHistoryEntry = {
      data,
      id: this.nextEntryId,
    }
    this.nextEntryId += 1
    return nextEntry
  }

  private releaseEntry(entry: EditorHistoryEntry) {
    this.entryPool.push(entry)
  }
}
