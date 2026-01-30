import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import type { EditorObjectData, ObjectType } from './types'

export interface EditorObjectManagerContext {
  fabricCanvas: () => fabric.Canvas | null
  onObjectRemoved: (object: fabric.Object) => void
  onSelectionChanged: (object: fabric.Object | null) => void
  onBringToFront: (object: fabric.Object) => void
  renderObjectTree: () => void
}

export class EditorObjectManager {
  private ctx: EditorObjectManagerContext
  private editorObjects: EditorObjectData[] = []
  private editorObjectMap = new Map<fabric.Object, EditorObjectData>()
  private objectTypeCounts = new Map<ObjectType, number>()
  private nextEditorObjectId = 1
  private selectedEditorObjectId = -1
  private renamingEditorObjectId = -1
  private focusedEditorObject: fabric.Object | null = null

  constructor(ctx: EditorObjectManagerContext) {
    this.ctx = ctx
  }

  getEditorObjects() {
    return this.editorObjects
  }

  getEditorObjectMap() {
    return this.editorObjectMap
  }

  getSelectedEditorObjectId() {
    return this.selectedEditorObjectId
  }

  getRenamingEditorObjectId() {
    return this.renamingEditorObjectId
  }

  getDragObjectId() {
    // EditorObjectManager doesn't seem to manage dragObjectId in the original code,
    // it was in EditorManager. But it makes sense to be here?
    // In EditorManager it was: private dragObjectId = -1
    // And passed to EditorObjectTreeManager.
    // I should probably manage it here if I move reorder logic.
    return -1 // Placeholder if I don't move state yet, but I should.
  }

  // I'll add dragObjectId state management here too.
  private dragObjectId = -1
  getDragId() {
    return this.dragObjectId
  }
  setDragId(id: number) {
    this.dragObjectId = id
  }

  hasObjectOfType(type: ObjectType): boolean {
    return this.editorObjects.some((obj) => obj.type === type)
  }

  registerEditorObject(type: ObjectType, object: fabric.Object) {
    const existing = this.editorObjectMap.get(object)
    if (existing) {
      return existing
    }
    const id = this.nextEditorObjectId
    this.nextEditorObjectId += 1
    const nextCount = (this.objectTypeCounts.get(type) ?? 0) + 1
    this.objectTypeCounts.set(type, nextCount)
    const typeLabel = localizer.t(`editor_object_${type}`)
    const name = `${typeLabel}${nextCount}`
    const data: EditorObjectData = { id, name, type, object }
    this.editorObjects.push(data)
    this.editorObjectMap.set(object, data)
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return data
  }

  unregisterEditorObject(object: fabric.Object) {
    const data = this.editorObjectMap.get(object)
    if (!data) {
      return
    }

    // Notify external managers to clean up their specific data (camera, markers, patterns)
    this.ctx.onObjectRemoved(object)

    this.editorObjectMap.delete(object)
    const index = this.editorObjects.indexOf(data)
    if (index !== -1) {
      this.editorObjects.splice(index, 1)
    }
    if (this.selectedEditorObjectId === data.id) {
      this.selectedEditorObjectId = -1
    }
    if (this.renamingEditorObjectId === data.id) {
      this.renamingEditorObjectId = -1
    }
    if (this.focusedEditorObject === object) {
      this.focusedEditorObject = null
    }

    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
  }

  applyEditorObjectStacking() {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }
    for (let i = 0; i < this.editorObjects.length; i++) {
      const obj = this.editorObjects[i].object
      if (obj.canvas !== canvas) {
        continue
      }
      canvas.moveTo(obj, i)
    }
    if (
      this.focusedEditorObject &&
      this.focusedEditorObject.canvas === canvas
    ) {
      this.bringFocusedObjectToFront(this.focusedEditorObject)
    }
    canvas.requestRenderAll()
  }

  private bringFocusedObjectToFront(object: fabric.Object) {
    object.bringToFront()
    this.ctx.onBringToFront(object)
  }

  getEditorObjectById(id: number) {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.id === id) {
        return data
      }
    }
    return null
  }

  focusEditorObjectById(id: number) {
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return
    }
    const data = this.getEditorObjectById(id)
    if (!data) {
      return
    }
    canvas.setActiveObject(data.object)
    this.handleCanvasSelection(data.object)
    canvas.requestRenderAll()
  }

  handleCanvasSelection(target: fabric.Object | null) {
    const previousFocus = this.focusedEditorObject
    const data = target ? (this.editorObjectMap.get(target) ?? null) : null
    this.selectedEditorObjectId = data ? data.id : -1
    if (
      this.renamingEditorObjectId !== -1 &&
      this.renamingEditorObjectId !== this.selectedEditorObjectId
    ) {
      this.renamingEditorObjectId = -1
    }
    if (previousFocus && previousFocus !== target) {
      this.focusedEditorObject = null
      this.applyEditorObjectStacking()
    }
    this.focusedEditorObject = target
    this.applyEditorObjectStacking()

    this.ctx.onSelectionChanged(target)
    this.ctx.renderObjectTree()
  }

  reorderEditorObjects(dragId: number, targetId: number, insertAfter: boolean) {
    if (dragId === targetId) {
      return
    }
    const dragIndex = this.findEditorObjectIndexById(dragId)
    const targetIndex = this.findEditorObjectIndexById(targetId)
    if (dragIndex === -1 || targetIndex === -1) {
      return
    }
    const dragData = this.editorObjects[dragIndex]
    this.editorObjects.splice(dragIndex, 1)
    let insertIndex = insertAfter ? targetIndex + 1 : targetIndex
    if (dragIndex < targetIndex) {
      insertIndex -= 1
    }
    if (insertIndex < 0) {
      insertIndex = 0
    }
    if (insertIndex > this.editorObjects.length) {
      insertIndex = this.editorObjects.length
    }
    this.editorObjects.splice(insertIndex, 0, dragData)
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
  }

  findEditorObjectIndexById(id: number) {
    for (let i = 0; i < this.editorObjects.length; i++) {
      if (this.editorObjects[i].id === id) {
        return i
      }
    }
    return -1
  }

  beginObjectRename(object: fabric.Object) {
    const data = this.editorObjectMap.get(object)
    if (!data) {
      return
    }
    this.renamingEditorObjectId = data.id
    this.ctx.renderObjectTree()
  }

  commitObjectRename(id: number, value: string): boolean {
    const data = this.getEditorObjectById(id)
    if (!data) {
      this.renamingEditorObjectId = -1
      this.ctx.renderObjectTree()
      return false
    }
    const trimmed = value.trim()
    let changed = false
    if (trimmed.length > 0 && trimmed !== data.name) {
      data.name = trimmed
      changed = true
    }
    this.renamingEditorObjectId = -1
    this.ctx.renderObjectTree()
    return changed
  }

  cancelObjectRename() {
    if (this.renamingEditorObjectId === -1) {
      return
    }
    this.renamingEditorObjectId = -1
    this.ctx.renderObjectTree()
  }

  clear() {
    const canvas = this.ctx.fabricCanvas()
    if (canvas) {
      for (let i = 0; i < this.editorObjects.length; i++) {
        const object = this.editorObjects[i].object
        if (object.canvas === canvas) {
          canvas.remove(object)
        }
      }
    }

    this.editorObjects.length = 0
    this.editorObjectMap.clear()
    this.objectTypeCounts.clear()
    this.nextEditorObjectId = 1
    this.selectedEditorObjectId = -1
    this.renamingEditorObjectId = -1
    this.focusedEditorObject = null
    this.dragObjectId = -1
  }
}
