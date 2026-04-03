import { fabric } from 'fabric'

import { DEFAULT_CAMERA_ZOOM } from '../constants'
import type {
  EditorMapData,
  EditorTreeData,
  EditorTreeNode,
  EditorTreeObjectType,
  MapCharacterBodyProfile,
  MapNpcTemplate,
  MapNpcWeapon,
  MapPlacedShape,
  MapSunPickup,
} from '../editorMapTypes'
import type { NormalAttackMovesetId, WeaponType } from '../types'
import { normalizeWeaponTypeAndSizeLevel } from '../weaponTypeUtils'
import {
  GROUND_CIRCLE_OPTIONS,
  GROUND_EDITABLE_POLYGON_OPTIONS,
  GROUND_RECT_OPTIONS,
  OBSTACLE_CIRCLE_OPTIONS,
  OBSTACLE_EDITABLE_POLYGON_OPTIONS,
  OBSTACLE_RECT_OPTIONS,
  acquirePoint,
} from './EditorConstants'
import { computeCameraOffsetFromCenter } from './EditorCoordinateUtils'
import type { EditorMarkerManager } from './EditorMarkerManager'
import type { EditorShapeManager } from './EditorShapeManager'
import type { EditorTerrainLayerManager } from './EditorTerrainLayerManager'
import type { ObjectType } from './types'

interface EditorObjectLike {
  id: number
  name: string
  parentId: number | null
  type: ObjectType
  object: fabric.Object
}

interface CameraViewLike {
  frame: fabric.Object
  zoom: number
}

interface EditorMapSerializerContext {
  getCanvas: () => HTMLCanvasElement
  getInvPixelsPerMeter: () => number
  getPixelsPerMeter: () => number
  getFabricCanvas: () => fabric.Canvas | null
  ensureFabricCanvas: () => void
  resizeEditorCanvas: () => void
  clearEditorScene: () => void

  markerManager: EditorMarkerManager
  shapeManager: EditorShapeManager
  terrainManager: EditorTerrainLayerManager

  spawnCameraViewFrame: (camera?: EditorMapData['camera']) => void
  renderObjectTree: () => void
  requestRenderAll: () => void
  getCameraViews: () => CameraViewLike[]
  getPlayerMarkerData: () => {
    radius: number
    bodyHeight: number
    bodyProfile?: MapCharacterBodyProfile
    moveSpeed: number
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    facing: number
    initialNormalMovesetId?: NormalAttackMovesetId
    debugNoDamage: boolean
    debugNoDeath: boolean
    mainWeapon?: WeaponType
    mainWeaponMarker?: fabric.Object
    secondaryWeapon?: WeaponType
    secondaryWeaponMarker?: fabric.Object
    factionId: string
    npcFactions: string[]
    allyFactions: string[]
  } | null
  getEditorObjects: () => EditorObjectLike[]
  getPolygonScratchPoint: () => fabric.Point
  applyTransform: (
    x: number,
    y: number,
    matrix: number[],
    out: fabric.Point
  ) => void

  // Dependencies for shape application
  setupEditablePolygon: (polygon: fabric.Polygon) => void
  registerEditorObject: (type: ObjectType, object: fabric.Object) => void
  applyGroundPatternToObject: (obj: fabric.Object) => void
  applyObstaclePatternToObject: (obj: fabric.Object) => void

  getFactions: () => string[]
  setFactions: (factions: string[]) => void
  getCustomNpcTemplates: () => MapNpcTemplate[]
  setCustomNpcTemplates: (templates: MapNpcTemplate[]) => void
}

export class EditorMapSerializer {
  private ctx: EditorMapSerializerContext

  constructor(ctx: EditorMapSerializerContext) {
    this.ctx = ctx
  }

  buildDefaultMapData(): EditorMapData {
    const canvas = this.ctx.getCanvas()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const width = canvas.width
    const height = canvas.height
    const spawnX = width * 0.5 * invPixelsPerMeter
    const spawnY = Math.max(0.8, height * invPixelsPerMeter - 1.6)
    return {
      version: 1,
      canvasWidth: width,
      canvasHeight: height,
      pixelsPerMeter: this.ctx.getPixelsPerMeter(),
      playerSpawn: { x: spawnX, y: spawnY },
      camera: { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM },
      shapes: [],
      npcs: [],
      weapons: [],
      checkpoints: [],
      hookAnchors: [],
      npcTemplates: [],
    }
  }

  serializeCurrentMapData(): EditorMapData {
    const base = this.buildDefaultMapData()
    const playerSpawn = this.serializePlayerSpawn(base)
    const player = this.serializePlayerProperties()
    const camera = this.serializeCamera(base)
    const shapes: MapPlacedShape[] = []
    const shapeIndexMap = new Map<fabric.Object, number>()
    this.serializeShapes(shapes, shapeIndexMap)
    const npcIndexMap = new Map<fabric.Object, number>()
    const npcs = this.serializeNpcs(npcIndexMap)
    const weaponIndexMap = new Map<fabric.Object, number>()
    const weapons = this.serializeWeapons(weaponIndexMap)
    const checkpointIndexMap = new Map<fabric.Object, number>()
    const checkpoints = this.serializeCheckpoints(checkpointIndexMap)
    const hookAnchorIndexMap = new Map<fabric.Object, number>()
    const hookAnchors = this.serializeHookAnchors(hookAnchorIndexMap)
    const sunPickupIndexMap = new Map<fabric.Object, number>()
    const sunPickups = this.serializeSunPickups(sunPickupIndexMap)
    const terrainIndexMap = new Map<fabric.Object, number>()
    const terrain = this.ctx.terrainManager.serialize(
      terrainIndexMap,
      this.ctx.getEditorObjects()
    )
    const editorTree = this.serializeEditorTree({
      shapeIndexMap,
      npcIndexMap,
      weaponIndexMap,
      checkpointIndexMap,
      hookAnchorIndexMap,
      sunPickupIndexMap,
      terrainIndexMap,
    })
    return {
      version: 1,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      pixelsPerMeter: base.pixelsPerMeter,
      playerSpawn,
      player,
      camera,
      shapes,
      terrain,
      npcs,
      weapons,
      checkpoints,
      hookAnchors,
      sunPickups,
      npcTemplates: this.ctx.getCustomNpcTemplates(),
      editorTree: editorTree ?? undefined,
      factions: this.ctx.getFactions(),
    }
  }

  applyMapData(data: EditorMapData) {
    this.ctx.ensureFabricCanvas()
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return
    }
    if (data.factions) {
      this.ctx.setFactions(data.factions)
    }
    this.ctx.setCustomNpcTemplates(data.npcTemplates ?? [])
    this.ctx.resizeEditorCanvas()
    this.ctx.clearEditorScene()
    this.ctx.terrainManager.applySerializedData(data.terrain)
    this.ctx.markerManager.spawnPlayerMarker(data.playerSpawn, data.player)
    this.ctx.spawnCameraViewFrame(data.camera)
    this.applyPlacedShapes(data.shapes)
    const npcs = data.npcs ?? data.enemies ?? []
    this.applyNpcs(npcs)
    this.applyWeapons(data.weapons)
    this.applyCheckpoints(data.checkpoints)
    this.applyHookAnchors(data.hookAnchors)
    this.applySunPickups(data.sunPickups)
    this.ctx.renderObjectTree()
    this.ctx.requestRenderAll()
  }

  private applyPlacedShapes(shapes: EditorMapData['shapes']) {
    for (let i = 0; i < shapes.length; i++) {
      const placed = shapes[i]
      if (placed.shape.kind === 'rect') {
        this.applyRectShape(placed)
        continue
      }
      if (placed.shape.kind === 'circle') {
        this.applyCircleShape(placed)
        continue
      }
      this.applyPolygonShape(placed)
    }
  }

  private applyRectShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'rect') {
      return
    }
    const pixelsPerMeter = this.ctx.getPixelsPerMeter()
    const rectOptions =
      placed.objectKind === 'ground'
        ? GROUND_RECT_OPTIONS
        : OBSTACLE_RECT_OPTIONS
    const rect = new fabric.Rect(rectOptions)
    const width = shape.halfWidth * pixelsPerMeter * 2
    const height = shape.halfHeight * pixelsPerMeter * 2
    rect.width = width
    rect.height = height
    rect.scaleX = 1
    rect.scaleY = 1
    rect.angle = (shape.rotationRad * 180) / Math.PI
    rect.left = shape.center.x * pixelsPerMeter
    rect.top = shape.center.y * pixelsPerMeter
    rect.setCoords()
    this.ctx.shapeManager.registerShapeResetData(rect, {
      kind: 'rect',
      width,
      height,
    })
    if (placed.objectKind === 'ground') {
      this.ctx.applyGroundPatternToObject(rect)
    } else {
      this.ctx.applyObstaclePatternToObject(rect)
    }
    const canvas = this.ctx.getFabricCanvas()
    canvas?.add(rect)

    // Hardcoded ObjectType
    const ObjectTypeGround = 'ground' as ObjectType
    const ObjectTypeObstacle = 'obstacle' as ObjectType

    this.ctx.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectTypeGround : ObjectTypeObstacle,
      rect
    )
  }

  private applyCircleShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'circle') {
      return
    }
    const pixelsPerMeter = this.ctx.getPixelsPerMeter()
    const circleOptions =
      placed.objectKind === 'ground'
        ? GROUND_CIRCLE_OPTIONS
        : OBSTACLE_CIRCLE_OPTIONS
    const circle = new fabric.Circle(circleOptions)
    const radius = shape.radius * pixelsPerMeter
    circle.radius = radius
    circle.scaleX = 1
    circle.scaleY = 1
    circle.left = shape.center.x * pixelsPerMeter
    circle.top = shape.center.y * pixelsPerMeter
    circle.setCoords()
    this.ctx.shapeManager.registerShapeResetData(circle, {
      kind: 'circle',
      radius,
    })
    if (placed.objectKind === 'ground') {
      this.ctx.applyGroundPatternToObject(circle)
    } else {
      this.ctx.applyObstaclePatternToObject(circle)
    }
    const canvas = this.ctx.getFabricCanvas()
    canvas?.add(circle)

    // Hardcoded ObjectType
    const ObjectTypeGround = 'ground' as ObjectType
    const ObjectTypeObstacle = 'obstacle' as ObjectType

    this.ctx.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectTypeGround : ObjectTypeObstacle,
      circle
    )
  }

  private applyPolygonShape(placed: MapPlacedShape) {
    const shape = placed.shape
    if (shape.kind !== 'polygon') {
      return
    }
    const pixelsPerMeter = this.ctx.getPixelsPerMeter()
    const centerXPx = shape.center.x * pixelsPerMeter
    const centerYPx = shape.center.y * pixelsPerMeter
    const localPoints: fabric.Point[] = []
    const resetPoints: Array<readonly [number, number]> = []
    for (let i = 0; i < shape.points.length; i += 2) {
      const absX = shape.points[i] * pixelsPerMeter
      const absY = shape.points[i + 1] * pixelsPerMeter
      const localX = absX - centerXPx
      const localY = absY - centerYPx
      localPoints.push(acquirePoint(localX, localY))
      resetPoints.push([localX, localY])
    }
    const options =
      placed.objectKind === 'ground'
        ? GROUND_EDITABLE_POLYGON_OPTIONS
        : OBSTACLE_EDITABLE_POLYGON_OPTIONS
    const polygon = new fabric.Polygon(localPoints, options)
    this.ctx.setupEditablePolygon(polygon)
    polygon.left = centerXPx + polygon.pathOffset.x
    polygon.top = centerYPx + polygon.pathOffset.y
    polygon.scaleX = 1
    polygon.scaleY = 1
    polygon.angle = 0
    polygon.setCoords()
    this.ctx.shapeManager.registerShapeResetData(polygon, {
      kind: 'polygon',
      points: resetPoints,
    })
    if (placed.objectKind === 'ground') {
      this.ctx.applyGroundPatternToObject(polygon)
    } else {
      this.ctx.applyObstaclePatternToObject(polygon)
    }
    const canvas = this.ctx.getFabricCanvas()
    canvas?.add(polygon)

    // Hardcoded ObjectType
    const ObjectTypeGround = 'ground' as ObjectType
    const ObjectTypeObstacle = 'obstacle' as ObjectType

    this.ctx.registerEditorObject(
      placed.objectKind === 'ground' ? ObjectTypeGround : ObjectTypeObstacle,
      polygon
    )
  }

  private applyNpcs(npcs: EditorMapData['npcs']) {
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]
      this.ctx.markerManager.spawnNpcMarker(npc.npcType, npc)
    }
  }

  private applyWeapons(weapons: EditorMapData['weapons']) {
    if (!weapons) {
      return
    }
    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i]
      const normalizedWeapon = normalizeWeaponTypeAndSizeLevel(
        weapon.weaponType,
        weapon.sizeLevel
      )
      if (!normalizedWeapon) {
        continue
      }
      this.ctx.markerManager.spawnWeaponMarker(
        normalizedWeapon.weaponType,
        weapon.category,
        {
          ...weapon,
          sizeLevel: normalizedWeapon.sizeLevel,
        }
      )
    }
  }

  private applyCheckpoints(checkpoints: EditorMapData['checkpoints']) {
    if (!checkpoints) {
      return
    }
    for (let i = 0; i < checkpoints.length; i++) {
      this.ctx.markerManager.spawnCheckpointMarker(checkpoints[i])
    }
  }

  private applyHookAnchors(anchors: EditorMapData['hookAnchors']) {
    if (!anchors) {
      return
    }
    for (let i = 0; i < anchors.length; i++) {
      this.ctx.markerManager.spawnHookAnchorMarker(anchors[i])
    }
  }

  private applySunPickups(pickups: EditorMapData['sunPickups']) {
    if (!pickups) return
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i]
      this.ctx.markerManager.spawnSunPickupMarker(p.isLarge, { x: p.x, y: p.y })
    }
  }

  private serializePlayerSpawn(base: EditorMapData) {
    const marker = this.ctx.markerManager.getPlayerMarker()
    if (!marker) {
      return base.playerSpawn
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const center = marker.getCenterPoint()
    const x = center.x * invPixelsPerMeter
    const y = center.y * invPixelsPerMeter
    return { x, y }
  }

  private serializeCamera(base: EditorMapData) {
    const cameraViews = this.ctx.getCameraViews()
    if (cameraViews.length === 0) {
      return base.camera
    }
    const data = cameraViews[0]
    const frame = data.frame
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const center = frame.getCenterPoint()
    const centerX = center.x * invPixelsPerMeter
    const centerY = center.y * invPixelsPerMeter
    const zoom = data.zoom > 0 ? data.zoom : 1
    const canvas = this.ctx.getCanvas()
    return computeCameraOffsetFromCenter(
      centerX,
      centerY,
      zoom,
      canvas.width,
      canvas.height,
      invPixelsPerMeter
    )
  }

  private serializeCheckpoints(
    indexMap?: Map<fabric.Object, number>
  ): EditorMapData['checkpoints'] {
    const markers = this.ctx.markerManager.getCheckpointMarkers()
    if (markers.length === 0) {
      return []
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const checkpoints: NonNullable<EditorMapData['checkpoints']> = []
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i].marker
      const center = marker.getCenterPoint()
      const x = center.x * invPixelsPerMeter
      const y = center.y * invPixelsPerMeter
      if (indexMap) {
        indexMap.set(marker, checkpoints.length)
      }
      checkpoints.push({ x, y })
    }
    return checkpoints
  }

  private serializeHookAnchors(
    indexMap?: Map<fabric.Object, number>
  ): EditorMapData['hookAnchors'] {
    const markers = this.ctx.markerManager.getHookAnchorMarkers()
    if (markers.length === 0) {
      return []
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const anchors: NonNullable<EditorMapData['hookAnchors']> = []
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i].marker
      const center = marker.getCenterPoint()
      const x = center.x * invPixelsPerMeter
      const y = center.y * invPixelsPerMeter
      if (indexMap) {
        indexMap.set(marker, anchors.length)
      }
      anchors.push({ x, y })
    }
    return anchors
  }

  private serializeSunPickups(
    indexMap?: Map<fabric.Object, number>
  ): MapSunPickup[] {
    const markers = this.ctx.markerManager.getSunPickupMarkers()
    if (markers.length === 0) return []
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const pickups: MapSunPickup[] = []
    for (let i = 0; i < markers.length; i++) {
      const { marker, isLarge } = markers[i]
      const center = marker.getCenterPoint()
      const x = center.x * invPixelsPerMeter
      const y = center.y * invPixelsPerMeter
      if (indexMap) indexMap.set(marker, pickups.length)
      pickups.push({ x, y, isLarge })
    }
    return pickups
  }

  private serializeEditorTree(data: {
    shapeIndexMap: Map<fabric.Object, number>
    npcIndexMap: Map<fabric.Object, number>
    weaponIndexMap: Map<fabric.Object, number>
    checkpointIndexMap: Map<fabric.Object, number>
    hookAnchorIndexMap: Map<fabric.Object, number>
    sunPickupIndexMap: Map<fabric.Object, number>
    terrainIndexMap: Map<fabric.Object, number>
  }): EditorTreeData | null {
    const editorObjects = this.ctx.getEditorObjects()
    if (editorObjects.length === 0) {
      return null
    }
    const nodes: EditorTreeNode[] = []
    const parents: number[] = []
    const idToIndex = new Map<number, number>()
    const playerMarker = this.ctx.markerManager.getPlayerMarker()
    const cameraViews = this.ctx.getCameraViews()
    const cameraFrame = cameraViews.length > 0 ? cameraViews[0].frame : null

    for (let i = 0; i < editorObjects.length; i++) {
      const dataItem = editorObjects[i]
      const node: EditorTreeNode = {
        type: dataItem.type as EditorTreeObjectType,
        name: dataItem.name,
      }
      if (dataItem.type === 'empty') {
        node.isGroupContainer =
          (dataItem.object as Partial<{ isGroupContainer: boolean }>)
            .isGroupContainer === true
      }
      if (dataItem.type === 'ground' || dataItem.type === 'obstacle') {
        const index = data.shapeIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
        node.objectKind = dataItem.type === 'ground' ? 'ground' : 'obstacle'
      } else if (dataItem.type === 'npc') {
        const index = data.npcIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'weapon') {
        const index = data.weaponIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'checkpoint') {
        const index = data.checkpointIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'hookAnchor') {
        const index = data.hookAnchorIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (
        dataItem.type === 'sunPickupSmall' ||
        dataItem.type === 'sunPickupLarge'
      ) {
        const index = data.sunPickupIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'terrain') {
        const index = data.terrainIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'player') {
        if (!playerMarker || dataItem.object !== playerMarker) {
          return null
        }
      } else if (dataItem.type === 'camera') {
        if (!cameraFrame || dataItem.object !== cameraFrame) {
          return null
        }
      }

      const nodeIndex = nodes.length
      nodes.push(node)
      parents.push(-1)
      idToIndex.set(dataItem.id, nodeIndex)
    }

    for (let i = 0; i < editorObjects.length; i++) {
      const dataItem = editorObjects[i]
      if (dataItem.parentId === null) {
        continue
      }
      const nodeIndex = idToIndex.get(dataItem.id)
      const parentIndex = idToIndex.get(dataItem.parentId)
      if (nodeIndex === undefined || parentIndex === undefined) {
        continue
      }
      parents[nodeIndex] = parentIndex
    }

    return { nodes, parents }
  }

  private serializePlayerProperties(): EditorMapData['player'] {
    const data = this.ctx.getPlayerMarkerData()
    if (!data) {
      return undefined
    }
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    let mainWeapon: MapNpcWeapon | undefined
    if (data.mainWeapon && data.mainWeaponMarker) {
      const weaponData = weaponMarkerMap.get(data.mainWeaponMarker)
      if (weaponData) {
        mainWeapon = {
          weaponType: weaponData.weaponType,
          sizeLevel: weaponData.sizeLevel,
          attackDamage: weaponData.attackDamage,
          postureDamage: weaponData.postureDamage,
          toughnessDamage: weaponData.toughnessDamage,
          bowAmmo: weaponData.bowAmmo,
        }
      }
    }

    let secondaryWeapon: MapNpcWeapon | undefined
    if (data.secondaryWeapon && data.secondaryWeaponMarker) {
      const weaponData = weaponMarkerMap.get(data.secondaryWeaponMarker)
      if (weaponData) {
        secondaryWeapon = {
          weaponType: weaponData.weaponType,
          sizeLevel: weaponData.sizeLevel,
          attackDamage: weaponData.attackDamage,
          postureDamage: weaponData.postureDamage,
          toughnessDamage: weaponData.toughnessDamage,
          bowAmmo: weaponData.bowAmmo,
        }
      }
    }

    return {
      radius: data.radius,
      bodyHeight: data.bodyHeight || undefined,
      bodyProfile: data.bodyProfile,
      moveSpeed: data.moveSpeed,
      maxHealth: data.maxHealth,
      maxPosture: data.maxPosture,
      maxToughness: data.maxToughness,
      color: data.color,
      facing: data.facing,
      initialNormalMovesetId: data.initialNormalMovesetId,
      debugNoDamage: data.debugNoDamage,
      debugNoDeath: data.debugNoDeath,
      mainWeapon,
      secondaryWeapon,
      factionId: data.factionId,
      npcFactions: data.npcFactions,
      allyFactions: data.allyFactions,
    }
  }

  private serializeShapes(
    out: MapPlacedShape[],
    indexMap?: Map<fabric.Object, number>
  ) {
    const editorObjects = this.ctx.getEditorObjects()
    for (let i = 0; i < editorObjects.length; i++) {
      const data = editorObjects[i]
      if (data.type !== 'ground' && data.type !== 'obstacle') {
        continue
      }
      const placed = this.serializeShapeObject(data)
      if (placed) {
        if (indexMap) {
          indexMap.set(data.object, out.length)
        }
        out.push(placed)
      }
    }
  }

  private serializeShapeObject(data: EditorObjectLike): MapPlacedShape | null {
    const object = data.object
    const objectKind = data.type === 'ground' ? 'ground' : 'obstacle'
    if (object instanceof fabric.Rect) {
      return this.serializeRectShape(objectKind, object)
    }
    if (object instanceof fabric.Circle) {
      return this.serializeCircleShape(objectKind, object)
    }
    if (object instanceof fabric.Polygon) {
      return this.serializePolygonShape(objectKind, object)
    }
    return null
  }

  private serializeRectShape(
    objectKind: 'ground' | 'obstacle',
    rect: fabric.Rect
  ): MapPlacedShape {
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const center = rect.getCenterPoint()
    const centerX = center.x * invPixelsPerMeter
    const centerY = center.y * invPixelsPerMeter
    const scaleX = rect.scaleX ?? 1
    const scaleY = rect.scaleY ?? 1
    const widthPx = (rect.width ?? 0) * scaleX
    const heightPx = (rect.height ?? 0) * scaleY
    const halfWidth = widthPx * invPixelsPerMeter * 0.5
    const halfHeight = heightPx * invPixelsPerMeter * 0.5
    const angleDeg = rect.angle ?? 0
    const rotationRad = (angleDeg * Math.PI) / 180
    return {
      objectKind,
      shape: {
        kind: 'rect',
        center: { x: centerX, y: centerY },
        halfWidth,
        halfHeight,
        rotationRad,
      },
    }
  }

  private serializeCircleShape(
    objectKind: 'ground' | 'obstacle',
    circle: fabric.Circle
  ): MapPlacedShape {
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const center = circle.getCenterPoint()
    const centerX = center.x * invPixelsPerMeter
    const centerY = center.y * invPixelsPerMeter
    const scaleX = circle.scaleX ?? 1
    const scaleY = circle.scaleY ?? 1
    const radiusPx = (circle.radius ?? 0) * Math.max(scaleX, scaleY)
    const radius = radiusPx * invPixelsPerMeter
    return {
      objectKind,
      shape: {
        kind: 'circle',
        center: { x: centerX, y: centerY },
        radius,
      },
    }
  }

  private serializePolygonShape(
    objectKind: 'ground' | 'obstacle',
    polygon: fabric.Polygon
  ): MapPlacedShape | null {
    if (!polygon.points || polygon.points.length < 3) {
      return null
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const center = polygon.getCenterPoint()
    const centerX = center.x * invPixelsPerMeter
    const centerY = center.y * invPixelsPerMeter
    const matrix = polygon.calcTransformMatrix()
    const pathOffset = polygon.pathOffset
    const points: number[] = []
    const scratch = this.ctx.getPolygonScratchPoint()
    for (let i = 0; i < polygon.points.length; i++) {
      const point = polygon.points[i]
      const localX = point.x - pathOffset.x
      const localY = point.y - pathOffset.y
      this.ctx.applyTransform(localX, localY, matrix, scratch)
      points.push(scratch.x * invPixelsPerMeter, scratch.y * invPixelsPerMeter)
    }
    return {
      objectKind,
      shape: {
        kind: 'polygon',
        center: { x: centerX, y: centerY },
        points,
      },
    }
  }

  private serializeNpcs(indexMap?: Map<fabric.Object, number>) {
    const npcs: EditorMapData['npcs'] = []
    const npcMarkers = this.ctx.markerManager.getNpcMarkers()
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    for (let i = 0; i < npcMarkers.length; i++) {
      const data = npcMarkers[i]
      const marker = data.marker

      let mainWeapon: MapNpcWeapon | undefined
      if (data.mainWeapon && data.mainWeaponMarker) {
        const weaponData = weaponMarkerMap.get(data.mainWeaponMarker)
        if (weaponData) {
          mainWeapon = {
            weaponType: weaponData.weaponType,
            sizeLevel: weaponData.sizeLevel,
            attackDamage: weaponData.attackDamage,
            postureDamage: weaponData.postureDamage,
            toughnessDamage: weaponData.toughnessDamage,
            bowAmmo: weaponData.bowAmmo,
          }
        }
      }

      let secondaryWeapon: MapNpcWeapon | undefined
      if (data.secondaryWeapon && data.secondaryWeaponMarker) {
        const weaponData = weaponMarkerMap.get(data.secondaryWeaponMarker)
        if (weaponData) {
          secondaryWeapon = {
            weaponType: weaponData.weaponType,
            sizeLevel: weaponData.sizeLevel,
            attackDamage: weaponData.attackDamage,
            postureDamage: weaponData.postureDamage,
            toughnessDamage: weaponData.toughnessDamage,
            bowAmmo: weaponData.bowAmmo,
          }
        }
      }

      if (indexMap) {
        indexMap.set(marker, npcs.length)
      }
      const center = marker.getCenterPoint()
      npcs.push({
        x: center.x * invPixelsPerMeter,
        y: center.y * invPixelsPerMeter,
        npcType: data.npcType,
        radius: data.radius,
        bodyHeight: data.bodyHeight || undefined,
        bodyProfile: data.bodyProfile,
        moveSpeed: data.moveSpeed,
        attackDesire: data.attackDesire,
        parryProficiency: data.parryProficiency,
        initialPatrolMode: data.initialPatrolMode,
        detectionRangeLevel: data.detectionRangeLevel,
        maxHealth: data.maxHealth,
        maxPosture: data.maxPosture,
        maxToughness: data.maxToughness,
        color: data.color,
        facing: data.facing,
        initialNormalMovesetId: data.initialNormalMovesetId,
        debugNoDamage: data.debugNoDamage,
        debugNoDeath: data.debugNoDeath,
        redTapeEnabled: data.redTapeEnabled,
        retreatEnabled: data.retreatEnabled,
        retreatDelaySec: data.retreatDelaySec,
        canBeFollower: data.canBeFollower,
        equipWeapon: data.equipWeapon,
        mainWeapon,
        secondaryWeapon,
        factionId: data.factionId,
        npcFactions: data.npcFactions,
        allyFactions: data.allyFactions,
      })
    }
    return npcs
  }

  private serializeWeapons(indexMap?: Map<fabric.Object, number>) {
    const weapons: EditorMapData['weapons'] = []
    const weaponMarkers = this.ctx.markerManager.getWeaponMarkers()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    for (let i = 0; i < weaponMarkers.length; i++) {
      const data = weaponMarkers[i]
      const marker = data.marker
      if (indexMap) {
        indexMap.set(marker, weapons.length)
      }
      const center = marker.getCenterPoint()
      weapons.push({
        x: center.x * invPixelsPerMeter,
        y: center.y * invPixelsPerMeter,
        weaponType: data.weaponType,
        category: data.category,
        sizeLevel: data.sizeLevel,
        attackDamage: data.attackDamage,
        postureDamage: data.postureDamage,
        toughnessDamage: data.toughnessDamage,
        bowAmmo: data.bowAmmo,
      })
    }
    return weapons
  }
}
