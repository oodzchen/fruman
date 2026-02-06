import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import { ObjectType } from './types'
import type { EditorObjectData } from './types'

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
  private selectedEditorObjectIds: number[] = []
  private renamingEditorObjectId = -1
  private focusedEditorObject: fabric.Object | null = null
  private treeReorderScratch: EditorObjectData[] = []
  private dragObjectId = -1

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

  getSelectedEditorObjectIds() {
    return this.selectedEditorObjectIds
  }

  getRenamingEditorObjectId() {
    return this.renamingEditorObjectId
  }

  getDragId() {
    return this.dragObjectId
  }

  setDragId(id: number) {
    this.dragObjectId = id
  }

  fillTreeSnapshot(order: number[], parentIds: number[]) {
    const count = this.editorObjects.length
    order.length = count
    parentIds.length = count
    for (let i = 0; i < count; i++) {
      const data = this.editorObjects[i]
      order[i] = data.id
      parentIds[i] = data.parentId ?? -1
    }
  }

  applyTreeSnapshot(order: number[], parentIds: number[]): boolean {
    const count = this.editorObjects.length
    if (order.length !== count || parentIds.length !== count) {
      return false
    }

    for (let i = 0; i < count; i++) {
      if (!this.getEditorObjectById(order[i])) {
        return false
      }
    }

    for (let i = 0; i < count; i++) {
      const obj = this.editorObjects[i].object
      if (obj.group) {
        this.detachObjectFromGroup(obj)
      }
    }

    const scratch = this.treeReorderScratch
    scratch.length = 0
    for (let i = 0; i < count; i++) {
      const data = this.getEditorObjectById(order[i])
      if (!data) {
        return false
      }
      const parentId = parentIds[i] === -1 ? null : parentIds[i]
      data.parentId = parentId
      this.detachObjectFromGroup(data.object)
      data.object.setCoords()
      scratch.push(data)
    }

    this.editorObjects.length = 0
    for (let i = 0; i < scratch.length; i++) {
      this.editorObjects.push(scratch[i])
    }
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
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
    const data: EditorObjectData = { id, name, type, object, parentId: null }
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

    this.ctx.onObjectRemoved(object)

    if (data.type === ObjectType.Empty) {
      this.orphanChildren(data.id)
    }
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
    // Only move top-level objects on the canvas.
    // Children within groups are managed by their parent group's internal stacking.
    let canvasIndex = 0
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      const obj = data.object
      if (obj.canvas !== canvas) {
        continue
      }
      canvas.moveTo(obj, canvasIndex++)
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
    this.handleCanvasSelection([data.object])
    canvas.requestRenderAll()
  }

  handleCanvasSelection(targets: fabric.Object[]) {
    const previousFocus = this.focusedEditorObject
    const nextIds: number[] = []
    let nextFocus: fabric.Object | null = null
    for (let i = 0; i < targets.length; i++) {
      const data = this.editorObjectMap.get(targets[i])
      if (!data) {
        continue
      }
      nextIds.push(data.id)
      if (!nextFocus) {
        nextFocus = data.object
      }
    }
    this.selectedEditorObjectIds = nextIds
    this.selectedEditorObjectId = nextIds.length > 0 ? nextIds[0] : -1
    if (
      this.renamingEditorObjectId !== -1 &&
      this.renamingEditorObjectId !== this.selectedEditorObjectId
    ) {
      this.renamingEditorObjectId = -1
    }
    if (previousFocus && previousFocus !== nextFocus) {
      this.focusedEditorObject = null
      this.applyEditorObjectStacking()
    }
    this.focusedEditorObject = nextFocus
    this.applyEditorObjectStacking()

    this.ctx.onSelectionChanged(nextFocus)
    this.ctx.renderObjectTree()
  }

  setSelectedIds(ids: number[]) {
    this.selectedEditorObjectIds = ids
    this.selectedEditorObjectId = ids.length > 0 ? ids[0] : -1
    if (
      this.renamingEditorObjectId !== -1 &&
      !ids.includes(this.renamingEditorObjectId)
    ) {
      this.renamingEditorObjectId = -1
    }
    this.ctx.renderObjectTree()
  }

  moveObjects(
    ids: number[],
    targetId: number | null,
    position: 'before' | 'after' | 'inside'
  ): boolean {
    if (ids.length === 0) {
      return false
    }

    const movingData: EditorObjectData[] = []
    const movingIds = new Set<number>()
    for (const id of ids) {
      const data = this.getEditorObjectById(id)
      if (data) {
        movingData.push(data)
        movingIds.add(id)
      }
    }

    if (movingData.length === 0) {
      return false
    }

    let newParentId: number | null = null
    if (targetId !== null) {
      const targetData = this.getEditorObjectById(targetId)
      if (!targetData) {
        return false
      }

      for (const data of movingData) {
        if (data.id === targetId || this.isDescendant(targetId, data.id)) {
          return false
        }
      }

      if (position === 'inside') {
        newParentId = targetId
      } else {
        newParentId = targetData.parentId
      }
    } else {
      newParentId = null
    }

    const extracted: EditorObjectData[] = []
    const remaining: EditorObjectData[] = []
    for (const data of this.editorObjects) {
      if (movingIds.has(data.id)) {
        extracted.push(data)
      } else {
        remaining.push(data)
      }
    }

    for (const data of extracted) {
      const oldParentId = data.parentId
      if (oldParentId !== newParentId) {
        data.parentId = newParentId
        this.detachObjectFromGroup(data.object)
      }
      data.object.setCoords()
    }

    let insertIndex = -1
    if (targetId === null) {
      insertIndex = remaining.length
    } else {
      const targetInData = remaining.find((d) => d.id === targetId)
      if (targetInData) {
        const idx = remaining.indexOf(targetInData)
        if (position === 'before') {
          insertIndex = idx
        } else if (position === 'after') {
          insertIndex = idx + 1
        } else {
          // 'inside' - place after target and its current children in the flat list
          let lastChildIdx = idx
          for (let i = idx + 1; i < remaining.length; i++) {
            if (this.isDescendant(remaining[i].id, targetId)) {
              lastChildIdx = i
            } else {
              break
            }
          }
          insertIndex = lastChildIdx + 1
        }
      } else {
        insertIndex = remaining.length
      }
    }

    remaining.splice(insertIndex, 0, ...extracted)
    this.editorObjects = remaining

    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  setParent(childId: number, parentId: number | null): boolean {
    return this.moveObjects([childId], parentId, 'inside')
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
    this.selectedEditorObjectIds.length = 0
    this.renamingEditorObjectId = -1
    this.focusedEditorObject = null
    this.dragObjectId = -1
  }

  private isDescendant(candidateId: number, ancestorId: number): boolean {
    let current = this.getEditorObjectById(candidateId)
    while (current && current.parentId !== null) {
      if (current.parentId === ancestorId) {
        return true
      }
      current = this.getEditorObjectById(current.parentId)
    }
    return false
  }

  private detachObjectFromGroup(child: fabric.Object): void {
    const canvas = this.ctx.fabricCanvas()
    if (child.group) {
      const parent = child.group
      parent.removeWithUpdate(child)
      if (canvas && child.canvas !== canvas) {
        canvas.add(child)
      }
      child.setCoords()
      parent.setCoords()
    }
  }

  private orphanChildren(parentId: number): void {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.parentId === parentId) {
        data.parentId = null
      }
    }
  }
}
