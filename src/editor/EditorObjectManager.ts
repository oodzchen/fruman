import { fabric } from 'fabric'

import { localizer } from '../Localizer'
import { ObjectType } from './types'
import type { EditorEmptyObject, EditorObjectData, WeaponMarker } from './types'

const EDITOR_LOCKED_SELECTION_BORDER_COLOR = 'rgba(190, 66, 66, 0.92)'
const EDITOR_LOCKED_SELECTION_CORNER_COLOR = 'rgba(220, 92, 92, 0.95)'
const EDITOR_LOCKED_SELECTION_CORNER_STROKE_COLOR = 'rgba(42, 8, 8, 0.85)'

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
  private defaultNameCounts = new Map<string, number>()
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

    const scratch = this.treeReorderScratch
    scratch.length = 0
    for (let i = 0; i < count; i++) {
      const data = this.getEditorObjectById(order[i])
      if (!data) {
        return false
      }
      const parentId = parentIds[i] === -1 ? null : parentIds[i]
      data.parentId = parentId
      data.object.setCoords()
      scratch.push(data)
    }

    this.editorObjects.length = 0
    for (let i = 0; i < scratch.length; i++) {
      this.editorObjects.push(scratch[i])
    }
    this.synchronizeGroupMemberships()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  hasObjectOfType(type: ObjectType): boolean {
    return this.editorObjects.some((obj) => obj.type === type)
  }

  registerEditorObject(
    type: ObjectType,
    object: fabric.Object,
    preferredName?: string
  ) {
    const existing = this.editorObjectMap.get(object)
    if (existing) {
      return existing
    }
    const data = this.createEditorObjectData(type, object, preferredName)
    this.applyObjectLockState(data)
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

    if (this.isTrackedGroupedObject(object)) {
      this.detachObjectFromGroup(object)
    }
    if (this.isGroupContainerObject(object)) {
      this.detachGroupChildren(data.id)
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
    this.selectedEditorObjectIds = this.selectedEditorObjectIds.filter(
      (selectedId) => selectedId !== data.id
    )
    this.selectedEditorObjectId =
      this.selectedEditorObjectIds.length > 0
        ? this.selectedEditorObjectIds[0]
        : -1
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
    const terrainCanvasIndex = this.moveObjectsByType(
      canvas,
      ObjectType.Terrain,
      0
    )
    this.moveObjectsByType(canvas, null, terrainCanvasIndex)
    if (
      this.focusedEditorObject &&
      this.focusedEditorObject.canvas === canvas
    ) {
      const focusedData = this.editorObjectMap.get(this.focusedEditorObject)
      if (focusedData?.type !== ObjectType.Terrain) {
        this.bringFocusedObjectToFront(this.focusedEditorObject)
      }
    }
    canvas.requestRenderAll()
  }

  private bringFocusedObjectToFront(object: fabric.Object) {
    object.bringToFront()
    this.ctx.onBringToFront(object)
  }

  private moveObjectsByType(
    canvas: fabric.Canvas,
    type: ObjectType | null,
    canvasIndex: number
  ): number {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if ((type === null) === (data.type === ObjectType.Terrain)) {
        continue
      }
      const obj = data.object
      if (obj.canvas !== canvas || this.isTrackedGroupedObject(obj)) {
        continue
      }
      canvas.moveTo(obj, canvasIndex)
      canvasIndex += 1
    }
    return canvasIndex
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

  getSubtreeObjectIds(rootIds: readonly number[]): number[] {
    const rootSet = new Set<number>(this.getTopLevelObjectIds(rootIds))
    const result: number[] = []
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      for (const rootId of rootSet) {
        if (data.id === rootId || this.isDescendant(data.id, rootId)) {
          result.push(data.id)
          break
        }
      }
    }
    return result
  }

  getTopLevelObjectIds(ids: readonly number[]): number[] {
    if (ids.length === 0) {
      return []
    }
    const result: number[] = []
    for (let i = 0; i < ids.length; i++) {
      const rootId = ids[i]
      if (!this.getEditorObjectById(rootId)) {
        continue
      }
      let hasAncestorInSelection = false
      for (let j = 0; j < ids.length; j++) {
        const candidateId = ids[j]
        if (candidateId === rootId) {
          continue
        }
        if (this.isDescendant(rootId, candidateId)) {
          hasAncestorInSelection = true
          break
        }
      }
      if (!hasAncestorInSelection && !result.includes(rootId)) {
        result.push(rootId)
      }
    }
    return result
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
    const selectionTarget = this.resolveSelectableObject(data.object)
    canvas.setActiveObject(selectionTarget)
    this.handleCanvasSelection([selectionTarget])
    canvas.requestRenderAll()
  }

  getSelectionTarget(object: fabric.Object): fabric.Object {
    return this.resolveSelectableObject(object)
  }

  isObjectLocked(object: fabric.Object | null): boolean {
    if (!object) {
      return false
    }
    const data = this.editorObjectMap.get(this.resolveSelectableObject(object))
    return data?.isLocked === true
  }

  hasLockedObjects(ids: readonly number[]): boolean {
    const subtreeIds = this.getSubtreeObjectIds(ids)
    for (let i = 0; i < subtreeIds.length; i++) {
      const data = this.getEditorObjectById(subtreeIds[i])
      if (data?.isLocked) {
        return true
      }
    }
    return false
  }

  setObjectLocked(object: fabric.Object, locked: boolean): boolean {
    const target = this.resolveSelectableObject(object)
    const data = this.editorObjectMap.get(target)
    if (!data || data.isLocked === locked) {
      return false
    }
    data.isLocked = locked
    this.applyObjectLockState(data)
    if (locked && this.renamingEditorObjectId === data.id) {
      this.renamingEditorObjectId = -1
    }
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  applyObjectLockStates(): void {
    for (let i = 0; i < this.editorObjects.length; i++) {
      this.applyObjectLockState(this.editorObjects[i])
    }
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
  }

  handleCanvasSelection(targets: fabric.Object[]) {
    const previousFocus = this.focusedEditorObject
    const nextIds: number[] = []
    let nextFocus: fabric.Object | null = null
    for (let i = 0; i < targets.length; i++) {
      const target = this.resolveSelectableObject(targets[i])
      if (
        nextFocus === target ||
        nextIds.includes(this.editorObjectMap.get(target)?.id ?? -1)
      ) {
        continue
      }
      const data = this.editorObjectMap.get(target)
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
    for (let i = 0; i < movingData.length; i++) {
      const data = movingData[i]
      if (data.isLocked) {
        return false
      }
      if (data.parentId !== null) {
        const currentParent = this.getEditorObjectById(data.parentId)
        if (currentParent?.isLocked) {
          return false
        }
      }
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
        if (targetData.isLocked) {
          return false
        }
        newParentId = targetId
      } else {
        newParentId = targetData.parentId
      }
    } else {
      newParentId = null
    }

    const nextParentData =
      newParentId === null ? null : this.getEditorObjectById(newParentId)
    if (nextParentData?.isLocked) {
      return false
    }
    if (
      nextParentData &&
      this.isGroupContainerObject(nextParentData.object) &&
      !this.canObjectsEnterGroup(movingData, nextParentData.id)
    ) {
      return false
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
      data.parentId = newParentId
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

    this.synchronizeGroupMemberships()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  canGroupObjects(ids: readonly number[]): boolean {
    if (ids.length < 2) {
      return false
    }

    let sharedParentId: number | null | undefined
    for (let i = 0; i < ids.length; i++) {
      const data = this.getEditorObjectById(ids[i])
      if (!data) {
        return false
      }
      if (data.isLocked) {
        return false
      }
      if (this.isGroupContainerObject(data.object)) {
        return false
      }
      if (sharedParentId === undefined) {
        sharedParentId = data.parentId
        continue
      }
      if (sharedParentId !== data.parentId) {
        return false
      }
    }
    if (sharedParentId === undefined || sharedParentId === null) {
      return true
    }

    const parentData = this.getEditorObjectById(sharedParentId)
    return (
      (!parentData || !this.isGroupContainerObject(parentData.object)) &&
      parentData?.isLocked !== true
    )
  }

  createGroupObject(
    ids: readonly number[],
    groupObject: EditorEmptyObject
  ): EditorObjectData | null {
    if (!this.canGroupObjects(ids)) {
      return null
    }
    const canvas = this.ctx.fabricCanvas()
    if (!canvas) {
      return null
    }

    const selectedIdSet = new Set<number>(ids)
    const selectedData: EditorObjectData[] = []
    let insertIndex = -1
    let parentId: number | null = null

    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (!selectedIdSet.has(data.id)) {
        continue
      }
      if (insertIndex === -1) {
        insertIndex = i
        parentId = data.parentId
      }
      selectedData.push(data)
    }

    if (selectedData.length < 2 || insertIndex === -1) {
      return null
    }

    canvas.add(groupObject)
    const groupData = this.createEditorObjectData(ObjectType.Empty, groupObject)
    groupData.parentId = parentId
    this.editorObjectMap.set(groupObject, groupData)

    for (let i = 0; i < selectedData.length; i++) {
      selectedData[i].parentId = groupData.id
    }

    const nextObjects: EditorObjectData[] = []
    let inserted = false
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (selectedIdSet.has(data.id)) {
        if (!inserted) {
          nextObjects.push(groupData)
          for (let j = 0; j < selectedData.length; j++) {
            nextObjects.push(selectedData[j])
          }
          inserted = true
        }
        continue
      }
      nextObjects.push(data)
    }

    if (!inserted) {
      nextObjects.push(groupData)
      for (let i = 0; i < selectedData.length; i++) {
        nextObjects.push(selectedData[i])
      }
    }

    this.editorObjects = nextObjects
    this.synchronizeGroupMemberships()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return groupData
  }

  canConvertEmptyObjectToGroup(object: fabric.Object): boolean {
    const data = this.editorObjectMap.get(object)
    if (
      !data ||
      data.type !== ObjectType.Empty ||
      this.isGroupContainerObject(object) ||
      data.isLocked
    ) {
      return false
    }
    let childCount = 0
    for (let i = 0; i < this.editorObjects.length; i++) {
      const childData = this.editorObjects[i]
      if (childData.parentId !== data.id) {
        continue
      }
      childCount += 1
      if (this.isGroupContainerObject(childData.object) || childData.isLocked) {
        return false
      }
    }
    return childCount >= 2
  }

  convertEmptyObjectToGroup(object: fabric.Object): boolean {
    if (!this.canConvertEmptyObjectToGroup(object)) {
      return false
    }
    const groupObject = object as EditorEmptyObject
    groupObject.isGroupContainer = true
    this.synchronizeGroupMemberships()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  ungroupObject(groupObject: fabric.Object): boolean {
    const data = this.editorObjectMap.get(groupObject)
    if (!this.isGroupContainerObject(groupObject) || data?.isLocked) {
      return false
    }
    this.detachGroupChildren(data?.id ?? -1)
    groupObject.isGroupContainer = false
    groupObject.setCoords()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
  }

  setParent(childId: number, parentId: number | null): boolean {
    return this.moveObjects([childId], parentId, 'inside')
  }

  applyParentAssignments(
    childIds: readonly number[],
    parentIds: readonly (number | null)[]
  ): boolean {
    if (childIds.length !== parentIds.length) {
      return false
    }
    for (let i = 0; i < childIds.length; i++) {
      const childData = this.getEditorObjectById(childIds[i])
      if (!childData) {
        return false
      }
      if (childData.isLocked) {
        return false
      }
      const parentId = parentIds[i]
      if (parentId === null) {
        continue
      }
      const parentData = this.getEditorObjectById(parentId)
      if (!parentData || parentData.isLocked) {
        return false
      }
      if (
        childData.id === parentId ||
        this.isDescendant(parentId, childData.id)
      ) {
        return false
      }
    }

    for (let i = 0; i < childIds.length; i++) {
      const childData = this.getEditorObjectById(childIds[i])
      if (!childData) {
        return false
      }
      childData.parentId = parentIds[i]
      childData.object.setCoords()
    }

    this.synchronizeGroupMemberships()
    this.applyEditorObjectStacking()
    this.ctx.renderObjectTree()
    return true
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
    if (!data || data.isLocked) {
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
    if (data.isLocked) {
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
    this.defaultNameCounts.clear()
    this.nextEditorObjectId = 1
    this.selectedEditorObjectId = -1
    this.selectedEditorObjectIds.length = 0
    this.renamingEditorObjectId = -1
    this.focusedEditorObject = null
    this.dragObjectId = -1
  }

  isLegacyDefaultName(type: ObjectType, name: string): boolean {
    const typeLabel = localizer.t(`editor_object_${type}`)
    if (!name.startsWith(typeLabel)) {
      return false
    }
    const suffix = name.slice(typeLabel.length)
    if (suffix.length === 0) {
      return false
    }
    for (let i = 0; i < suffix.length; i++) {
      const charCode = suffix.charCodeAt(i)
      if (charCode < 48 || charCode > 57) {
        return false
      }
    }
    return true
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
    const parent = child.group
    if (!parent || !this.editorObjectMap.has(parent)) {
      return
    }
    parent.removeWithUpdate(child)
    if (canvas) {
      canvas.add(child)
    }
    child.setCoords()
    parent.setCoords()
  }

  private orphanChildren(parentId: number): void {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.parentId === parentId) {
        data.parentId = null
      }
    }
  }

  private getDefaultObjectNameBase(
    type: ObjectType,
    object: fabric.Object
  ): string {
    if (type === ObjectType.Empty && this.isGroupContainerObject(object)) {
      return localizer.t('editor_object_group')
    }
    if (type === ObjectType.Weapon) {
      const weaponName = this.getWeaponObjectName(object)
      if (weaponName.length > 0) {
        return weaponName
      }
    }
    return localizer.t(`editor_object_${type}`)
  }

  private getWeaponObjectName(object: fabric.Object): string {
    const weaponMarker = object as WeaponMarker
    const sizeLevel = weaponMarker.sizeLevel

    if (weaponMarker.weaponType === 'hook') {
      return localizer.t('editor_weapon_hook')
    }
    if (weaponMarker.weaponType === 'bow') {
      return localizer.t(
        sizeLevel >= 2 ? 'editor_weapon_size_bow_2' : 'editor_weapon_size_bow_1'
      )
    }
    if (weaponMarker.weaponType === 'grape') {
      return localizer.t('editor_weapon_size_grape_1')
    }
    if (weaponMarker.weaponType === 'hammer') {
      return localizer.t(
        sizeLevel >= 2
          ? 'editor_weapon_size_hammer_2'
          : 'editor_weapon_size_hammer_1'
      )
    }
    if (weaponMarker.weaponType === 'spear') {
      return localizer.t('editor_weapon_size_spear_1')
    }
    if (weaponMarker.weaponType === 'sword') {
      if (sizeLevel <= 1) {
        return localizer.t('editor_weapon_size_sword_1')
      }
      if (sizeLevel === 2) {
        return localizer.t('editor_weapon_size_sword_2')
      }
      if (sizeLevel === 3) {
        return localizer.t('editor_weapon_size_sword_3')
      }
      return localizer.t('editor_weapon_size_sword_4')
    }

    return localizer.t('editor_object_weapon')
  }

  private createEditorObjectData(
    type: ObjectType,
    object: fabric.Object,
    preferredName?: string
  ): EditorObjectData {
    const id = this.nextEditorObjectId
    this.nextEditorObjectId += 1
    const defaultNameBase = this.getDefaultObjectNameBase(type, object)
    const nextCount = (this.defaultNameCounts.get(defaultNameBase) ?? 0) + 1
    this.defaultNameCounts.set(defaultNameBase, nextCount)
    const generatedName = `${defaultNameBase}${nextCount}`
    const name =
      preferredName && preferredName.length > 0 ? preferredName : generatedName
    return {
      id,
      name,
      type,
      object,
      parentId: null,
      isLocked: false,
      hasControlsWhenUnlocked: object.hasControls === true,
      borderColorWhenUnlocked: object.borderColor,
      cornerColorWhenUnlocked: object.cornerColor,
      cornerStrokeColorWhenUnlocked: object.cornerStrokeColor,
    }
  }

  private synchronizeGroupMemberships(): void {
    for (let i = 0; i < this.editorObjects.length; i++) {
      this.detachObjectFromGroup(this.editorObjects[i].object)
    }

    for (let i = 0; i < this.editorObjects.length; i++) {
      const data = this.editorObjects[i]
      if (data.parentId === null) {
        continue
      }
      if (this.isGroupContainerObject(data.object)) {
        continue
      }
      const parentData = this.getEditorObjectById(data.parentId)
      if (!parentData || !this.isGroupContainerObject(parentData.object)) {
        continue
      }
      this.attachObjectToGroup(data.object, parentData.object)
    }
  }

  private attachObjectToGroup(
    child: fabric.Object,
    parent: EditorEmptyObject
  ): void {
    const canvas = this.ctx.fabricCanvas()
    if (child === parent || child.group === parent) {
      return
    }
    if (this.isTrackedGroupedObject(child)) {
      this.detachObjectFromGroup(child)
    }
    if (canvas && child.canvas === canvas) {
      canvas.remove(child)
    }
    parent.addWithUpdate(child)
    child.setCoords()
    parent.setCoords()
  }

  private detachGroupChildren(groupId: number): void {
    for (let i = 0; i < this.editorObjects.length; i++) {
      const childData = this.editorObjects[i]
      if (childData.parentId !== groupId) {
        continue
      }
      this.detachObjectFromGroup(childData.object)
    }
  }

  private isTrackedGroupedObject(object: fabric.Object): boolean {
    return !!object.group && this.editorObjectMap.has(object.group)
  }

  private canObjectsEnterGroup(
    movingData: readonly EditorObjectData[],
    _groupId: number
  ): boolean {
    for (let i = 0; i < movingData.length; i++) {
      if (
        this.isGroupContainerObject(movingData[i].object) ||
        movingData[i].isLocked
      ) {
        return false
      }
    }
    return true
  }

  private applyObjectLockState(data: EditorObjectData): void {
    const object = data.object
    object.lockMovementX = data.isLocked
    object.lockMovementY = data.isLocked
    object.hasControls = data.isLocked ? false : data.hasControlsWhenUnlocked
    object.borderColor = data.isLocked
      ? EDITOR_LOCKED_SELECTION_BORDER_COLOR
      : data.borderColorWhenUnlocked
    object.cornerColor = data.isLocked
      ? EDITOR_LOCKED_SELECTION_CORNER_COLOR
      : data.cornerColorWhenUnlocked
    object.cornerStrokeColor = data.isLocked
      ? EDITOR_LOCKED_SELECTION_CORNER_STROKE_COLOR
      : data.cornerStrokeColorWhenUnlocked
  }

  private isGroupContainerObject(
    object: fabric.Object | null
  ): object is EditorEmptyObject {
    if (!object) {
      return false
    }
    return (
      (object as Partial<EditorEmptyObject>).editorShape === 'editor-empty' &&
      (object as Partial<EditorEmptyObject>).isGroupContainer === true
    )
  }

  private resolveSelectableObject(object: fabric.Object): fabric.Object {
    let current = object
    while (current.group && this.editorObjectMap.has(current.group)) {
      current = current.group
    }
    return current
  }
}
