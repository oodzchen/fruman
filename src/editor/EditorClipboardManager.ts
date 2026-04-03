import { fabric } from 'fabric'

import type { MapNpcWeapon, MapPlayerProperties } from '../editorMapTypes'
import type { WeaponCategory } from '../editorMapTypes'
import type {
  MapTerrainChunk,
  TerrainMaterialId,
} from '../terrain/TerrainTypes'
import type {
  NormalAttackMovesetId,
  NpcDetectionRangeLevel,
  NpcPatrolMode,
  NpcType,
  WeaponType,
} from '../types'
import type { EditorCameraManager } from './EditorCameraManager'
import {
  EDITOR_CLIPBOARD_PASTE_OFFSET_PX,
  GROUND_CIRCLE_OPTIONS,
  GROUND_EDITABLE_POLYGON_OPTIONS,
  GROUND_RECT_OPTIONS,
  GROUND_TRIANGLE_OPTIONS,
  OBSTACLE_CIRCLE_OPTIONS,
  OBSTACLE_EDITABLE_POLYGON_OPTIONS,
  OBSTACLE_RECT_OPTIONS,
  OBSTACLE_TRIANGLE_OPTIONS,
  acquirePoint,
} from './EditorConstants'
import { computeCameraOffsetFromCenter } from './EditorCoordinateUtils'
import type { EditorMarkerManager } from './EditorMarkerManager'
import type { EditorObjectManager } from './EditorObjectManager'
import type { EditorPatternManager } from './EditorPatternManager'
import type {
  EditablePolygon,
  EditorPolygonEditor,
} from './EditorPolygonEditor'
import type { EditorShapeManager } from './EditorShapeManager'
import type {
  EditorTerrainLayerManager,
  TerrainClipboardLayerSnapshot,
} from './EditorTerrainLayerManager'
import { ObjectType } from './types'
import type {
  CameraFrame,
  CheckpointMarker,
  HookAnchorMarker,
  NpcMarker,
  PlayerMarker,
  ShapeResetData,
  WeaponMarker,
} from './types'

type ClipboardKind =
  | 'none'
  | 'shape'
  | 'terrain'
  | 'npc'
  | 'player'
  | 'weapon'
  | 'camera'
  | 'checkpoint'
  | 'hookAnchor'

interface EditorClipboardManagerContext {
  getCanvas: () => fabric.Canvas | null
  getInvPixelsPerMeter: () => number
  editorCanvas: HTMLCanvasElement
  markerManager: EditorMarkerManager
  shapeManager: EditorShapeManager
  terrainManager: EditorTerrainLayerManager
  cameraManager: EditorCameraManager
  patternManager: EditorPatternManager
  objectManager: EditorObjectManager
  polygonEditor: EditorPolygonEditor
  handleCanvasSelection: (object: fabric.Object | null) => void
  isEditablePolygon: (obj: fabric.Object | null) => obj is EditablePolygon
  hasObjectOfType: (type: ObjectType) => boolean
}

type RectResetData = Extract<ShapeResetData, { kind: 'rect' }>
type CircleResetData = Extract<ShapeResetData, { kind: 'circle' }>
type PolygonResetData = Extract<ShapeResetData, { kind: 'polygon' }>
type TriangleResetData = Extract<ShapeResetData, { kind: 'triangle' }>

export class EditorClipboardManager {
  private ctx: EditorClipboardManagerContext
  private kind: ClipboardKind = 'none'
  private sourceLeft = 0
  private sourceTop = 0
  private pasteIndex = 0
  private pasteBaseLeft = 0
  private pasteBaseTop = 0

  private shapeObjectType: ObjectType | null = null
  private shapeKind: 'rect' | 'circle' | 'polygon' = 'rect'
  private shapeIsEditable = false
  private shapeWidth = 0
  private shapeHeight = 0
  private shapeRadius = 0
  private shapeAngle = 0
  private shapeScaleX = 1
  private shapeScaleY = 1
  private shapePoints: number[] = []
  private shapePointCount = 0

  private resetKind: ShapeResetData['kind'] = 'rect'
  private resetWidth = 0
  private resetHeight = 0
  private resetRadius = 0
  private resetPoints: number[] = []
  private resetPointCount = 0
  private resetPointPairs: [number, number][] = []
  private shapeResetRectData: RectResetData = {
    kind: 'rect',
    width: 0,
    height: 0,
  }
  private shapeResetCircleData: CircleResetData = { kind: 'circle', radius: 0 }
  private shapeResetPolygonData: PolygonResetData = {
    kind: 'polygon',
    points: this.resetPointPairs,
  }
  private shapeResetTriangleData: TriangleResetData = {
    kind: 'triangle',
    points: this.resetPointPairs,
  }
  private terrainMaterialId: TerrainMaterialId = 'dirt'
  private terrainOffsetCellX = 0
  private terrainOffsetCellY = 0
  private terrainChunks: MapTerrainChunk[] = []

  private npcType: NpcType = 'default'
  private npcRadius = 0
  private npcMoveSpeed = 0
  private npcAttackDesire = 0
  private npcParryProficiency = 0
  private npcInitialPatrolMode: NpcPatrolMode = 'guard'
  private npcDetectionRangeLevel: NpcDetectionRangeLevel = 'near'
  private npcMaxHealth = 0
  private npcMaxPosture = 0
  private npcMaxToughness = 0
  private npcColor = ''
  private npcFacing = 1
  private npcInitialNormalMovesetId: NormalAttackMovesetId = 'sword_default'
  private npcDebugNoDamage = false
  private npcDebugNoDeath = false
  private npcRedTapeEnabled = false
  private npcRetreatEnabled = false
  private npcRetreatDelaySec = 0
  private npcCanBeFollower = false
  private npcEquipWeapon = false
  private npcFactionId = ''
  private npcFactions: string[] = []
  private npcAllyFactions: string[] = []
  private npcHasMainWeapon = false
  private npcHasSecondaryWeapon = false
  private npcMainWeaponData: MapNpcWeapon = {
    weaponType: 'sword',
    sizeLevel: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  }
  private npcSecondaryWeaponData: MapNpcWeapon = {
    weaponType: 'sword',
    sizeLevel: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  }
  private npcSpawnConfig = {
    x: 0,
    y: 0,
    radius: 0,
    moveSpeed: 0,
    attackDesire: 0,
    parryProficiency: 0,
    initialPatrolMode: 'guard' as NpcPatrolMode,
    detectionRangeLevel: 'near' as NpcDetectionRangeLevel,
    maxHealth: 0,
    maxPosture: 0,
    maxToughness: 0,
    color: '',
    facing: 1,
    initialNormalMovesetId: 'sword_default' as NormalAttackMovesetId,
    debugNoDamage: false,
    debugNoDeath: false,
    redTapeEnabled: false,
    retreatEnabled: false,
    retreatDelaySec: 0,
    canBeFollower: false,
    equipWeapon: false,
    mainWeapon: undefined as MapNpcWeapon | undefined,
    secondaryWeapon: undefined as MapNpcWeapon | undefined,
    factionId: undefined as string | undefined,
    npcFactions: undefined as string[] | undefined,
    allyFactions: undefined as string[] | undefined,
  }

  private playerRadius = 0
  private playerMoveSpeed = 0
  private playerMaxHealth = 0
  private playerMaxPosture = 0
  private playerMaxToughness = 0
  private playerColor = ''
  private playerFacing = 1
  private playerInitialNormalMovesetId: NormalAttackMovesetId = 'sword_thrust'
  private playerDebugNoDamage = false
  private playerDebugNoDeath = false
  private playerFactionId = ''
  private playerNpcFactions: string[] = []
  private playerAllyFactions: string[] = []
  private playerHasMainWeapon = false
  private playerHasSecondaryWeapon = false
  private playerMainWeaponData: MapNpcWeapon = {
    weaponType: 'sword',
    sizeLevel: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  }
  private playerSecondaryWeaponData: MapNpcWeapon = {
    weaponType: 'sword',
    sizeLevel: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
  }
  private playerSpawn = { x: 0, y: 0 }
  private playerProperties: MapPlayerProperties = {}

  private weaponType: WeaponType = 'sword'
  private weaponCategory: WeaponCategory = 'main'
  private weaponSizeLevel = 1
  private weaponAttackDamage = 0
  private weaponPostureDamage = 0
  private weaponToughnessDamage = 0
  private weaponBowAmmo: number | undefined = undefined
  private weaponSpawnConfig = {
    x: 0,
    y: 0,
    sizeLevel: 1,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    bowAmmo: undefined as number | undefined,
  }

  private checkpointSpawn = { x: 0, y: 0 }
  private hookAnchorSpawn = { x: 0, y: 0 }

  private cameraZoom = 1
  private cameraOffset = { x: 0, y: 0, zoom: 1 }

  private batchTargets: fabric.Object[] = []
  private batchTargetsScratch: fabric.Object[] = []
  private batchPasteIndex = 0

  constructor(ctx: EditorClipboardManagerContext) {
    this.ctx = ctx
  }

  hasData(): boolean {
    return this.kind !== 'none' || this.batchTargets.length > 0
  }

  hasBatchData(): boolean {
    return this.batchTargets.length > 0
  }

  canCopy(target: fabric.Object): boolean {
    if (this.ctx.cameraManager.isCameraFrame(target)) {
      return false
    }
    if (this.ctx.markerManager.isPlayerMarker(target)) {
      return false
    }
    return true
  }

  copyBatch(targets: fabric.Object[]): boolean {
    this.batchTargets.length = 0
    this.batchPasteIndex = 0
    for (let i = 0; i < targets.length; i++) {
      if (this.canCopy(targets[i])) {
        this.batchTargets.push(targets[i])
      }
    }
    if (this.batchTargets.length === 0) return false
    this.kind = 'none'
    return true
  }

  pasteBatch(): fabric.Object[] {
    if (this.batchTargets.length === 0) return []
    this.batchTargetsScratch.length = 0
    for (let i = 0; i < this.batchTargets.length; i++) {
      this.batchTargetsScratch.push(this.batchTargets[i])
    }
    const savedIndex = this.batchPasteIndex
    const offset = EDITOR_CLIPBOARD_PASTE_OFFSET_PX * (savedIndex + 1)
    const results: fabric.Object[] = []
    for (let i = 0; i < this.batchTargetsScratch.length; i++) {
      const target = this.batchTargetsScratch[i]
      this.copy(target)
      if (this.kind !== 'none') {
        const pasted = this.pasteAt(
          this.sourceLeft + offset,
          this.sourceTop + offset
        )
        if (pasted) results.push(pasted)
      }
    }
    this.batchTargets.length = 0
    for (let i = 0; i < this.batchTargetsScratch.length; i++) {
      this.batchTargets.push(this.batchTargetsScratch[i])
    }
    this.batchPasteIndex = savedIndex + 1
    this.kind = 'none'
    return results
  }

  copy(target: fabric.Object): boolean {
    this.pasteIndex = 0
    this.batchTargets.length = 0
    this.batchPasteIndex = 0
    if (this.ctx.cameraManager.isCameraFrame(target)) {
      return this.copyCameraFrame(target)
    }
    if (this.ctx.markerManager.isPlayerMarker(target)) {
      return this.copyPlayerMarker(target)
    }
    if (this.ctx.markerManager.isNpcMarker(target)) {
      return this.copyNpcMarker(target)
    }
    if (this.ctx.markerManager.isWeaponMarker(target)) {
      return this.copyWeaponMarker(target)
    }
    if (this.ctx.markerManager.isCheckpointMarker(target)) {
      return this.copyCheckpointMarker(target)
    }
    if (this.ctx.markerManager.isHookAnchorMarker(target)) {
      return this.copyHookAnchorMarker(target)
    }
    if (this.ctx.terrainManager.isTerrainProxy(target)) {
      return this.copyTerrain(target)
    }
    return this.copyShape(target)
  }

  paste(): fabric.Object | null {
    return this.pasteWithBase(this.sourceLeft, this.sourceTop, true)
  }

  pasteAt(canvasX: number, canvasY: number): fabric.Object | null {
    return this.pasteWithBase(canvasX, canvasY, false)
  }

  private pasteWithBase(
    baseLeft: number,
    baseTop: number,
    useSourceOffset: boolean
  ): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas || this.kind === 'none') {
      return null
    }
    this.pasteBaseLeft = baseLeft
    this.pasteBaseTop = baseTop
    const offset = EDITOR_CLIPBOARD_PASTE_OFFSET_PX * this.pasteIndex
    const appliedOffset = useSourceOffset
      ? offset + EDITOR_CLIPBOARD_PASTE_OFFSET_PX
      : offset
    let result: fabric.Object | null = null
    switch (this.kind) {
      case 'shape':
        result = this.pasteShape(appliedOffset)
        break
      case 'terrain':
        result = this.pasteTerrain(appliedOffset)
        break
      case 'npc':
        result = this.pasteNpc(appliedOffset)
        break
      case 'player':
        result = this.pastePlayer(appliedOffset)
        break
      case 'weapon':
        result = this.pasteWeapon(appliedOffset)
        break
      case 'camera':
        result = this.pasteCamera(appliedOffset)
        break
      case 'checkpoint':
        result = this.pasteCheckpoint(appliedOffset)
        break
      case 'hookAnchor':
        result = this.pasteHookAnchor(appliedOffset)
        break
      default:
        result = null
        break
    }
    if (result) {
      this.pasteIndex += 1
    }
    return result
  }

  private copyShape(target: fabric.Object): boolean {
    const data = this.ctx.objectManager.getEditorObjectMap().get(target)
    if (!data || (data.type !== 'ground' && data.type !== 'obstacle')) {
      return false
    }
    if (
      !(
        target instanceof fabric.Rect ||
        target instanceof fabric.Circle ||
        target instanceof fabric.Polygon
      )
    ) {
      return false
    }
    this.kind = 'shape'
    this.shapeObjectType = data.type
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.shapeAngle = target.angle ?? 0
    this.shapeScaleX = target.scaleX ?? 1
    this.shapeScaleY = target.scaleY ?? 1
    if (target instanceof fabric.Rect) {
      this.shapeKind = 'rect'
      this.shapeWidth = target.width ?? 0
      this.shapeHeight = target.height ?? 0
      this.shapeRadius = 0
      this.shapePointCount = 0
      this.shapePoints.length = 0
    } else if (target instanceof fabric.Circle) {
      this.shapeKind = 'circle'
      this.shapeRadius = target.radius ?? 0
      this.shapeWidth = 0
      this.shapeHeight = 0
      this.shapePointCount = 0
      this.shapePoints.length = 0
    } else {
      this.shapeKind = 'polygon'
      this.shapeIsEditable = this.ctx.isEditablePolygon(target)
      const points = target.points ?? []
      const count = points.length
      this.shapePointCount = count
      this.shapePoints.length = count * 2
      const offsetX = target.pathOffset?.x ?? 0
      const offsetY = target.pathOffset?.y ?? 0
      for (let i = 0; i < count; i++) {
        const baseIndex = i * 2
        const point = points[i]
        this.shapePoints[baseIndex] = point.x - offsetX
        this.shapePoints[baseIndex + 1] = point.y - offsetY
      }
    }
    this.copyShapeResetData(target)
    return true
  }

  private copyTerrain(target: fabric.Object): boolean {
    const snapshot = this.ctx.terrainManager.createClipboardSnapshot(target)
    if (!snapshot) {
      return false
    }
    this.kind = 'terrain'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.assignTerrainClipboardSnapshot(snapshot)
    return true
  }

  private copyShapeResetData(target: fabric.Object) {
    const resetData = this.ctx.shapeManager.getShapeResetData(target)
    if (!resetData) {
      if (target instanceof fabric.Rect) {
        this.resetKind = 'rect'
        this.resetWidth = target.width ?? 0
        this.resetHeight = target.height ?? 0
        this.resetRadius = 0
        this.resetPointCount = 0
        this.resetPoints.length = 0
        return
      }
      if (target instanceof fabric.Circle) {
        this.resetKind = 'circle'
        this.resetRadius = target.radius ?? 0
        this.resetWidth = 0
        this.resetHeight = 0
        this.resetPointCount = 0
        this.resetPoints.length = 0
        return
      }
      if (target instanceof fabric.Polygon) {
        this.resetKind = 'polygon'
        this.resetWidth = 0
        this.resetHeight = 0
        this.resetRadius = 0
        const points = target.points ?? []
        const count = points.length
        this.resetPointCount = count
        this.resetPoints.length = count * 2
        const offsetX = target.pathOffset?.x ?? 0
        const offsetY = target.pathOffset?.y ?? 0
        for (let i = 0; i < count; i++) {
          const baseIndex = i * 2
          const point = points[i]
          this.resetPoints[baseIndex] = point.x - offsetX
          this.resetPoints[baseIndex + 1] = point.y - offsetY
        }
        this.syncResetPointPairs()
      }
      return
    }
    this.resetKind = resetData.kind
    if (resetData.kind === 'rect') {
      this.resetWidth = resetData.width
      this.resetHeight = resetData.height
      this.resetRadius = 0
      this.resetPointCount = 0
      this.resetPoints.length = 0
      return
    }
    if (resetData.kind === 'circle') {
      this.resetRadius = resetData.radius
      this.resetWidth = 0
      this.resetHeight = 0
      this.resetPointCount = 0
      this.resetPoints.length = 0
      return
    }
    const points = resetData.points
    const count = points.length
    this.resetPointCount = count
    this.resetPoints.length = count * 2
    for (let i = 0; i < count; i++) {
      const baseIndex = i * 2
      const point = points[i]
      this.resetPoints[baseIndex] = point[0]
      this.resetPoints[baseIndex + 1] = point[1]
    }
    this.syncResetPointPairs()
  }

  private syncResetPointPairs() {
    const count = this.resetPointCount
    while (this.resetPointPairs.length < count) {
      this.resetPointPairs.push([0, 0])
    }
    this.resetPointPairs.length = count
    for (let i = 0; i < count; i++) {
      const baseIndex = i * 2
      const pair = this.resetPointPairs[i]
      pair[0] = this.resetPoints[baseIndex]
      pair[1] = this.resetPoints[baseIndex + 1]
    }
  }

  private pasteShape(offset: number): fabric.Object | null {
    if (!this.shapeObjectType) {
      return null
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const isGround = this.shapeObjectType === 'ground'
    let shapeObject: fabric.Object | null = null
    if (this.shapeKind === 'rect') {
      const options = isGround ? GROUND_RECT_OPTIONS : OBSTACLE_RECT_OPTIONS
      const rect = new fabric.Rect(options)
      rect.width = this.shapeWidth
      rect.height = this.shapeHeight
      rect.scaleX = this.shapeScaleX
      rect.scaleY = this.shapeScaleY
      rect.angle = this.shapeAngle
      rect.left = this.pasteBaseLeft + offset
      rect.top = this.pasteBaseTop + offset
      rect.setCoords()
      shapeObject = rect
    } else if (this.shapeKind === 'circle') {
      const options = isGround ? GROUND_CIRCLE_OPTIONS : OBSTACLE_CIRCLE_OPTIONS
      const circle = new fabric.Circle(options)
      circle.radius = this.shapeRadius
      circle.scaleX = this.shapeScaleX
      circle.scaleY = this.shapeScaleY
      circle.angle = this.shapeAngle
      circle.left = this.pasteBaseLeft + offset
      circle.top = this.pasteBaseTop + offset
      circle.setCoords()
      shapeObject = circle
    } else {
      const points: fabric.Point[] = new Array(this.shapePointCount)
      for (let i = 0; i < this.shapePointCount; i++) {
        const baseIndex = i * 2
        points[i] = acquirePoint(
          this.shapePoints[baseIndex],
          this.shapePoints[baseIndex + 1]
        )
      }
      const options = this.shapeIsEditable
        ? isGround
          ? GROUND_EDITABLE_POLYGON_OPTIONS
          : OBSTACLE_EDITABLE_POLYGON_OPTIONS
        : isGround
          ? GROUND_TRIANGLE_OPTIONS
          : OBSTACLE_TRIANGLE_OPTIONS
      const polygon = new fabric.Polygon(points, options)
      if (this.shapeIsEditable) {
        this.ctx.polygonEditor.setupEditablePolygon(polygon)
      }
      polygon.scaleX = this.shapeScaleX
      polygon.scaleY = this.shapeScaleY
      polygon.angle = this.shapeAngle
      polygon.left = this.pasteBaseLeft + offset + polygon.pathOffset.x
      polygon.top = this.pasteBaseTop + offset + polygon.pathOffset.y
      polygon.setCoords()
      shapeObject = polygon
    }

    if (!shapeObject) {
      return null
    }

    if (isGround) {
      this.ctx.patternManager.applyGroundPatternToObject(shapeObject)
    } else {
      this.ctx.patternManager.applyObstaclePatternToObject(shapeObject)
    }

    if (this.resetKind === 'rect') {
      const data = this.shapeResetRectData
      data.width = this.resetWidth
      data.height = this.resetHeight
      this.ctx.shapeManager.registerShapeResetData(shapeObject, data)
    } else if (this.resetKind === 'circle') {
      const data = this.shapeResetCircleData
      data.radius = this.resetRadius
      this.ctx.shapeManager.registerShapeResetData(shapeObject, data)
    } else if (this.resetKind === 'triangle') {
      this.ctx.shapeManager.registerShapeResetData(
        shapeObject,
        this.shapeResetTriangleData
      )
    } else {
      this.ctx.shapeManager.registerShapeResetData(
        shapeObject,
        this.shapeResetPolygonData
      )
    }

    canvas.add(shapeObject)
    this.ctx.objectManager.registerEditorObject(
      this.shapeObjectType,
      shapeObject
    )
    canvas.setActiveObject(shapeObject)
    this.ctx.handleCanvasSelection(shapeObject)
    canvas.requestRenderAll()
    return shapeObject
  }

  private pasteTerrain(offset: number): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas || this.terrainChunks.length === 0) {
      return null
    }
    const targetLeft = this.pasteBaseLeft + offset
    const targetTop = this.pasteBaseTop + offset
    const snapshot = this.buildTerrainClipboardSnapshot()
    const proxy = this.ctx.terrainManager.pasteClipboardSnapshot(
      snapshot,
      this.sourceLeft,
      this.sourceTop,
      targetLeft,
      targetTop
    )
    if (!proxy) {
      return null
    }
    canvas.setActiveObject(proxy)
    this.ctx.handleCanvasSelection(proxy)
    canvas.requestRenderAll()
    return proxy
  }

  private assignTerrainClipboardSnapshot(
    snapshot: TerrainClipboardLayerSnapshot
  ): void {
    this.terrainMaterialId = snapshot.materialId
    this.terrainOffsetCellX = snapshot.offsetCellX
    this.terrainOffsetCellY = snapshot.offsetCellY
    this.terrainChunks.length = snapshot.chunks.length
    for (let i = 0; i < snapshot.chunks.length; i++) {
      const chunk = snapshot.chunks[i]
      const existing = this.terrainChunks[i]
      const cells = new Array<number>(chunk.cells.length)
      for (let cellIndex = 0; cellIndex < chunk.cells.length; cellIndex++) {
        cells[cellIndex] = chunk.cells[cellIndex] | 0
      }
      if (existing) {
        existing.chunkX = chunk.chunkX
        existing.chunkY = chunk.chunkY
        existing.cells = cells
      } else {
        this.terrainChunks[i] = {
          chunkX: chunk.chunkX,
          chunkY: chunk.chunkY,
          cells,
        }
      }
    }
  }

  private buildTerrainClipboardSnapshot(): TerrainClipboardLayerSnapshot {
    const chunks = new Array<MapTerrainChunk>(this.terrainChunks.length)
    for (let i = 0; i < this.terrainChunks.length; i++) {
      const chunk = this.terrainChunks[i]
      const cells = new Array<number>(chunk.cells.length)
      for (let cellIndex = 0; cellIndex < chunk.cells.length; cellIndex++) {
        cells[cellIndex] = chunk.cells[cellIndex] | 0
      }
      chunks[i] = {
        chunkX: chunk.chunkX,
        chunkY: chunk.chunkY,
        cells,
      }
    }
    return {
      materialId: this.terrainMaterialId,
      offsetCellX: this.terrainOffsetCellX,
      offsetCellY: this.terrainOffsetCellY,
      chunks,
    }
  }

  private copyNpcMarker(target: NpcMarker): boolean {
    const npcData = this.ctx.markerManager.getNpcMarkerMap().get(target)
    if (!npcData) {
      return false
    }
    this.kind = 'npc'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.npcType = npcData.npcType
    this.npcRadius = npcData.radius
    this.npcMoveSpeed = npcData.moveSpeed
    this.npcAttackDesire = npcData.attackDesire
    this.npcParryProficiency = npcData.parryProficiency
    this.npcInitialPatrolMode = npcData.initialPatrolMode
    this.npcDetectionRangeLevel = npcData.detectionRangeLevel
    this.npcMaxHealth = npcData.maxHealth
    this.npcMaxPosture = npcData.maxPosture
    this.npcMaxToughness = npcData.maxToughness
    this.npcColor = npcData.color
    this.npcFacing = npcData.facing
    this.npcInitialNormalMovesetId = npcData.initialNormalMovesetId
    this.npcDebugNoDamage = npcData.debugNoDamage
    this.npcDebugNoDeath = npcData.debugNoDeath
    this.npcRedTapeEnabled = npcData.redTapeEnabled
    this.npcRetreatEnabled = npcData.retreatEnabled
    this.npcRetreatDelaySec = npcData.retreatDelaySec
    this.npcCanBeFollower = npcData.canBeFollower
    this.npcEquipWeapon = npcData.equipWeapon
    this.npcFactionId = npcData.factionId
    this.npcFactions.length = 0
    for (let i = 0; i < npcData.npcFactions.length; i++) {
      this.npcFactions.push(npcData.npcFactions[i])
    }
    this.npcAllyFactions.length = 0
    for (let i = 0; i < npcData.allyFactions.length; i++) {
      this.npcAllyFactions.push(npcData.allyFactions[i])
    }
    this.npcHasMainWeapon = false
    this.npcHasSecondaryWeapon = false
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    if (npcData.mainWeaponMarker) {
      const weaponData = weaponMarkerMap.get(npcData.mainWeaponMarker)
      if (weaponData) {
        this.npcHasMainWeapon = true
        this.npcMainWeaponData.weaponType = weaponData.weaponType
        this.npcMainWeaponData.sizeLevel = weaponData.sizeLevel
        this.npcMainWeaponData.attackDamage = weaponData.attackDamage
        this.npcMainWeaponData.postureDamage = weaponData.postureDamage
        this.npcMainWeaponData.toughnessDamage = weaponData.toughnessDamage
        this.npcMainWeaponData.bowAmmo = weaponData.bowAmmo
      }
    }
    if (npcData.secondaryWeaponMarker) {
      const weaponData = weaponMarkerMap.get(npcData.secondaryWeaponMarker)
      if (weaponData) {
        this.npcHasSecondaryWeapon = true
        this.npcSecondaryWeaponData.weaponType = weaponData.weaponType
        this.npcSecondaryWeaponData.sizeLevel = weaponData.sizeLevel
        this.npcSecondaryWeaponData.attackDamage = weaponData.attackDamage
        this.npcSecondaryWeaponData.postureDamage = weaponData.postureDamage
        this.npcSecondaryWeaponData.toughnessDamage = weaponData.toughnessDamage
        this.npcSecondaryWeaponData.bowAmmo = weaponData.bowAmmo
      }
    }
    return true
  }

  private pasteNpc(offset: number): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const spawnX = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    const spawnY = (this.pasteBaseTop + offset) * invPixelsPerMeter
    this.npcSpawnConfig.x = spawnX
    this.npcSpawnConfig.y = spawnY
    this.npcSpawnConfig.radius = this.npcRadius
    this.npcSpawnConfig.moveSpeed = this.npcMoveSpeed
    this.npcSpawnConfig.attackDesire = this.npcAttackDesire
    this.npcSpawnConfig.parryProficiency = this.npcParryProficiency
    this.npcSpawnConfig.initialPatrolMode = this.npcInitialPatrolMode
    this.npcSpawnConfig.detectionRangeLevel = this.npcDetectionRangeLevel
    this.npcSpawnConfig.maxHealth = this.npcMaxHealth
    this.npcSpawnConfig.maxPosture = this.npcMaxPosture
    this.npcSpawnConfig.maxToughness = this.npcMaxToughness
    this.npcSpawnConfig.color = this.npcColor
    this.npcSpawnConfig.facing = this.npcFacing
    this.npcSpawnConfig.initialNormalMovesetId = this.npcInitialNormalMovesetId
    this.npcSpawnConfig.debugNoDamage = this.npcDebugNoDamage
    this.npcSpawnConfig.debugNoDeath = this.npcDebugNoDeath
    this.npcSpawnConfig.redTapeEnabled = this.npcRedTapeEnabled
    this.npcSpawnConfig.retreatEnabled = this.npcRetreatEnabled
    this.npcSpawnConfig.canBeFollower = this.npcCanBeFollower
    this.npcSpawnConfig.retreatDelaySec = this.npcRetreatDelaySec
    this.npcSpawnConfig.equipWeapon = this.npcEquipWeapon
    this.npcSpawnConfig.mainWeapon = this.npcHasMainWeapon
      ? this.npcMainWeaponData
      : undefined
    this.npcSpawnConfig.secondaryWeapon = this.npcHasSecondaryWeapon
      ? this.npcSecondaryWeaponData
      : undefined
    this.npcSpawnConfig.factionId = this.npcFactionId
    this.npcSpawnConfig.npcFactions = this.npcFactions
    this.npcSpawnConfig.allyFactions = this.npcAllyFactions
    this.ctx.markerManager.spawnNpcMarker(this.npcType, this.npcSpawnConfig)
    return canvas.getActiveObject() ?? null
  }

  private copyPlayerMarker(target: PlayerMarker): boolean {
    const playerData = this.ctx.markerManager.getPlayerMarkerData()
    if (!playerData || playerData.marker !== target) {
      return false
    }
    this.kind = 'player'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.playerRadius = playerData.radius
    this.playerMoveSpeed = playerData.moveSpeed
    this.playerMaxHealth = playerData.maxHealth
    this.playerMaxPosture = playerData.maxPosture
    this.playerMaxToughness = playerData.maxToughness
    this.playerColor = playerData.color
    this.playerFacing = playerData.facing
    this.playerInitialNormalMovesetId = playerData.initialNormalMovesetId
    this.playerDebugNoDamage = playerData.debugNoDamage
    this.playerDebugNoDeath = playerData.debugNoDeath
    this.playerFactionId = playerData.factionId
    this.playerNpcFactions.length = 0
    for (let i = 0; i < playerData.npcFactions.length; i++) {
      this.playerNpcFactions.push(playerData.npcFactions[i])
    }
    this.playerAllyFactions.length = 0
    for (let i = 0; i < playerData.allyFactions.length; i++) {
      this.playerAllyFactions.push(playerData.allyFactions[i])
    }
    this.playerHasMainWeapon = false
    this.playerHasSecondaryWeapon = false
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    if (playerData.mainWeaponMarker) {
      const weaponData = weaponMarkerMap.get(playerData.mainWeaponMarker)
      if (weaponData) {
        this.playerHasMainWeapon = true
        this.playerMainWeaponData.weaponType = weaponData.weaponType
        this.playerMainWeaponData.sizeLevel = weaponData.sizeLevel
        this.playerMainWeaponData.attackDamage = weaponData.attackDamage
        this.playerMainWeaponData.postureDamage = weaponData.postureDamage
        this.playerMainWeaponData.toughnessDamage = weaponData.toughnessDamage
        this.playerMainWeaponData.bowAmmo = weaponData.bowAmmo
      }
    }
    if (playerData.secondaryWeaponMarker) {
      const weaponData = weaponMarkerMap.get(playerData.secondaryWeaponMarker)
      if (weaponData) {
        this.playerHasSecondaryWeapon = true
        this.playerSecondaryWeaponData.weaponType = weaponData.weaponType
        this.playerSecondaryWeaponData.sizeLevel = weaponData.sizeLevel
        this.playerSecondaryWeaponData.attackDamage = weaponData.attackDamage
        this.playerSecondaryWeaponData.postureDamage = weaponData.postureDamage
        this.playerSecondaryWeaponData.toughnessDamage =
          weaponData.toughnessDamage
        this.playerSecondaryWeaponData.bowAmmo = weaponData.bowAmmo
      }
    }
    return true
  }

  private pastePlayer(offset: number): fabric.Object | null {
    if (this.ctx.hasObjectOfType(ObjectType.Player)) {
      return null
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const spawnX = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    const spawnY = (this.pasteBaseTop + offset) * invPixelsPerMeter
    this.playerSpawn.x = spawnX
    this.playerSpawn.y = spawnY
    this.playerProperties.radius = this.playerRadius
    this.playerProperties.moveSpeed = this.playerMoveSpeed
    this.playerProperties.maxHealth = this.playerMaxHealth
    this.playerProperties.maxPosture = this.playerMaxPosture
    this.playerProperties.maxToughness = this.playerMaxToughness
    this.playerProperties.color = this.playerColor
    this.playerProperties.facing = this.playerFacing
    this.playerProperties.initialNormalMovesetId =
      this.playerInitialNormalMovesetId
    this.playerProperties.debugNoDamage = this.playerDebugNoDamage
    this.playerProperties.debugNoDeath = this.playerDebugNoDeath
    this.playerProperties.mainWeapon = this.playerHasMainWeapon
      ? this.playerMainWeaponData
      : undefined
    this.playerProperties.secondaryWeapon = this.playerHasSecondaryWeapon
      ? this.playerSecondaryWeaponData
      : undefined
    this.playerProperties.factionId = this.playerFactionId
    this.playerProperties.npcFactions = this.playerNpcFactions
    this.playerProperties.allyFactions = this.playerAllyFactions
    this.ctx.markerManager.spawnPlayerMarker(
      this.playerSpawn,
      this.playerProperties
    )
    return canvas.getActiveObject() ?? null
  }

  private copyWeaponMarker(target: WeaponMarker): boolean {
    const weaponData = this.ctx.markerManager.getWeaponMarkerMap().get(target)
    if (!weaponData) {
      return false
    }
    this.kind = 'weapon'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.weaponType = weaponData.weaponType
    this.weaponCategory = weaponData.category
    this.weaponSizeLevel = weaponData.sizeLevel
    this.weaponAttackDamage = weaponData.attackDamage
    this.weaponPostureDamage = weaponData.postureDamage
    this.weaponToughnessDamage = weaponData.toughnessDamage
    this.weaponBowAmmo = weaponData.bowAmmo
    return true
  }

  private pasteWeapon(offset: number): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const spawnX = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    const spawnY = (this.pasteBaseTop + offset) * invPixelsPerMeter
    this.weaponSpawnConfig.x = spawnX
    this.weaponSpawnConfig.y = spawnY
    this.weaponSpawnConfig.sizeLevel = this.weaponSizeLevel
    this.weaponSpawnConfig.attackDamage = this.weaponAttackDamage
    this.weaponSpawnConfig.postureDamage = this.weaponPostureDamage
    this.weaponSpawnConfig.toughnessDamage = this.weaponToughnessDamage
    this.weaponSpawnConfig.bowAmmo = this.weaponBowAmmo
    this.ctx.markerManager.spawnWeaponMarker(
      this.weaponType,
      this.weaponCategory,
      this.weaponSpawnConfig
    )
    return canvas.getActiveObject() ?? null
  }

  private copyCheckpointMarker(target: CheckpointMarker): boolean {
    this.kind = 'checkpoint'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    return true
  }

  private pasteCheckpoint(offset: number): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    this.checkpointSpawn.x = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    this.checkpointSpawn.y = (this.pasteBaseTop + offset) * invPixelsPerMeter
    this.ctx.markerManager.spawnCheckpointMarker(this.checkpointSpawn)
    return canvas.getActiveObject() ?? null
  }

  private copyHookAnchorMarker(target: HookAnchorMarker): boolean {
    this.kind = 'hookAnchor'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    return true
  }

  private pasteHookAnchor(offset: number): fabric.Object | null {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    this.hookAnchorSpawn.x = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    this.hookAnchorSpawn.y = (this.pasteBaseTop + offset) * invPixelsPerMeter
    this.ctx.markerManager.spawnHookAnchorMarker(this.hookAnchorSpawn)
    return canvas.getActiveObject() ?? null
  }

  private copyCameraFrame(target: CameraFrame): boolean {
    const data = this.ctx.cameraManager.getCameraViewMap().get(target)
    if (!data) {
      return false
    }
    this.kind = 'camera'
    this.sourceLeft = target.left ?? 0
    this.sourceTop = target.top ?? 0
    this.cameraZoom = data.zoom
    return true
  }

  private pasteCamera(offset: number): fabric.Object | null {
    if (this.ctx.hasObjectOfType(ObjectType.Camera)) {
      return null
    }
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const centerX = (this.pasteBaseLeft + offset) * invPixelsPerMeter
    const centerY = (this.pasteBaseTop + offset) * invPixelsPerMeter
    const result = computeCameraOffsetFromCenter(
      centerX,
      centerY,
      this.cameraZoom,
      this.ctx.editorCanvas.width,
      this.ctx.editorCanvas.height,
      invPixelsPerMeter
    )
    this.cameraOffset.x = result.x
    this.cameraOffset.y = result.y
    this.cameraOffset.zoom = result.zoom
    this.ctx.cameraManager.spawnCameraViewFrame(
      this.cameraOffset,
      ObjectType.Camera
    )
    return canvas.getActiveObject() ?? null
  }
}
