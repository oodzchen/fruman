import type {
  EditorCharacterBodyDrawerHistoryContext,
  EditorCharacterBodyDrawerHistoryEntry,
  EditorCharacterBodyDrawerHistorySnapshot,
} from './EditorBodyDrawerTypes'

export class EditorCharacterBodyDrawerHistoryManager {
  private ctx: EditorCharacterBodyDrawerHistoryContext
  private undoStack: EditorCharacterBodyDrawerHistoryEntry[] = []
  private redoStack: EditorCharacterBodyDrawerHistoryEntry[] = []
  private entryPool: EditorCharacterBodyDrawerHistoryEntry[] = []
  private suspended = false
  private maxEntries: number

  constructor(
    ctx: EditorCharacterBodyDrawerHistoryContext,
    maxEntries: number
  ) {
    this.ctx = ctx
    this.maxEntries = maxEntries
  }

  reset() {
    this.clearStacks()
    this.pushUndoSnapshot(this.ctx.captureSnapshot())
  }

  capture() {
    if (this.suspended) {
      return
    }
    this.pushUndoSnapshot(this.ctx.captureSnapshot())
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
    this.applySnapshot(previous.snapshot)
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
    this.applySnapshot(entry.snapshot)
    return true
  }

  private applySnapshot(snapshot: EditorCharacterBodyDrawerHistorySnapshot) {
    this.suspended = true
    this.ctx.applySnapshot(snapshot)
    this.suspended = false
  }

  private pushUndoSnapshot(snapshot: EditorCharacterBodyDrawerHistorySnapshot) {
    const entry = this.acquireEntry(snapshot)
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

  private acquireEntry(
    snapshot: EditorCharacterBodyDrawerHistorySnapshot
  ): EditorCharacterBodyDrawerHistoryEntry {
    const entry = this.entryPool.pop()
    if (entry) {
      entry.snapshot = snapshot
      return entry
    }
    return { snapshot }
  }

  private releaseEntry(entry: EditorCharacterBodyDrawerHistoryEntry) {
    this.entryPool.push(entry)
  }
}
