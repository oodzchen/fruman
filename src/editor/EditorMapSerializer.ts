import { fabric } from 'fabric'

import type {
  EditorMapData,
  MapEnemyWeapon,
  MapPlacedShape,
} from '../editorMapTypes'
import type { WeaponType } from '../types'
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
import type { ObjectType } from './types'

interface EditorObjectLike {
  type: string
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

  spawnCameraViewFrame: (camera?: EditorMapData['camera']) => void
  renderObjectTree: () => void
  requestRenderAll: () => void
  getCameraViews: () => CameraViewLike[]
  getPlayerMarkerData: () => {
    radius: number
    moveSpeed: number
    maxHealth: number
    maxPosture: number
    maxToughness: number
    color: string
    facing: number
    debugNoDamage: boolean
    debugNoDeath: boolean
    mainWeapon?: WeaponType
    mainWeaponMarker?: fabric.Object
    secondaryWeapon?: WeaponType
    secondaryWeaponMarker?: fabric.Object
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
      camera: { x: 0, y: 0, zoom: 1 },
      shapes: [],
      enemies: [],
      weapons: [],
      checkpoints: [],
      hookAnchors: [],
    }
  }

  serializeCurrentMapData(): EditorMapData {
    const base = this.buildDefaultMapData()
    const playerSpawn = this.serializePlayerSpawn(base)
    const player = this.serializePlayerProperties()
    const camera = this.serializeCamera(base)
    const shapes: MapPlacedShape[] = []
    this.serializeShapes(shapes)
    const enemies = this.serializeEnemies()
    const weapons = this.serializeWeapons()
    const checkpoints = this.serializeCheckpoints()
    const hookAnchors = this.serializeHookAnchors()
    return {
      version: 1,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      pixelsPerMeter: base.pixelsPerMeter,
      playerSpawn,
      player,
      camera,
      shapes,
      enemies,
      weapons,
      checkpoints,
      hookAnchors,
    }
  }

  applyMapData(data: EditorMapData) {
    this.ctx.ensureFabricCanvas()
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return
    }
    this.ctx.resizeEditorCanvas()
    this.ctx.clearEditorScene()
    this.ctx.markerManager.spawnPlayerMarker(data.playerSpawn, data.player)
    this.ctx.spawnCameraViewFrame(data.camera)
    this.applyPlacedShapes(data.shapes)
    this.applyEnemies(data.enemies)
    this.applyWeapons(data.weapons)
    this.applyCheckpoints(data.checkpoints)
    this.applyHookAnchors(data.hookAnchors)
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
    const offset = polygon.pathOffset
    if (polygon.points) {
      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i]
        point.x += offset.x
        point.y += offset.y
      }
    }
    polygon.left = centerXPx
    polygon.top = centerYPx
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

  private applyEnemies(enemies: EditorMapData['enemies']) {
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i]
      this.ctx.markerManager.spawnEnemyMarker(enemy.enemyType, enemy)
    }
  }

  private applyWeapons(weapons: EditorMapData['weapons']) {
    if (!weapons) {
      return
    }
    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i]
      this.ctx.markerManager.spawnWeaponMarker(
        weapon.weaponType,
        weapon.category,
        weapon
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

  private serializePlayerSpawn(base: EditorMapData) {
    const marker = this.ctx.markerManager.getPlayerMarker()
    if (!marker) {
      return base.playerSpawn
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const x = (marker.left ?? 0) * invPixelsPerMeter
    const y = (marker.top ?? 0) * invPixelsPerMeter
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
    const centerX = (frame.left ?? 0) * invPixelsPerMeter
    const centerY = (frame.top ?? 0) * invPixelsPerMeter
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

  private serializeCheckpoints(): EditorMapData['checkpoints'] {
    const markers = this.ctx.markerManager.getCheckpointMarkers()
    if (markers.length === 0) {
      return []
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const checkpoints: NonNullable<EditorMapData['checkpoints']> = []
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i].marker
      const x = (marker.left ?? 0) * invPixelsPerMeter
      const y = (marker.top ?? 0) * invPixelsPerMeter
      checkpoints.push({ x, y })
    }
    return checkpoints
  }

  private serializeHookAnchors(): EditorMapData['hookAnchors'] {
    const markers = this.ctx.markerManager.getHookAnchorMarkers()
    if (markers.length === 0) {
      return []
    }
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const anchors: NonNullable<EditorMapData['hookAnchors']> = []
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i].marker
      const x = (marker.left ?? 0) * invPixelsPerMeter
      const y = (marker.top ?? 0) * invPixelsPerMeter
      anchors.push({ x, y })
    }
    return anchors
  }

  private serializePlayerProperties(): EditorMapData['player'] {
    const data = this.ctx.getPlayerMarkerData()
    if (!data) {
      return undefined
    }
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    let mainWeapon: MapEnemyWeapon | undefined
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

    let secondaryWeapon: MapEnemyWeapon | undefined
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
      moveSpeed: data.moveSpeed,
      maxHealth: data.maxHealth,
      maxPosture: data.maxPosture,
      maxToughness: data.maxToughness,
      color: data.color,
      facing: data.facing,
      debugNoDamage: data.debugNoDamage,
      debugNoDeath: data.debugNoDeath,
      mainWeapon,
      secondaryWeapon,
    }
  }

  private serializeShapes(out: MapPlacedShape[]) {
    const editorObjects = this.ctx.getEditorObjects()
    for (let i = 0; i < editorObjects.length; i++) {
      const data = editorObjects[i]
      if (data.type !== 'ground' && data.type !== 'obstacle') {
        continue
      }
      const placed = this.serializeShapeObject(data)
      if (placed) {
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
    const centerX = (rect.left ?? 0) * invPixelsPerMeter
    const centerY = (rect.top ?? 0) * invPixelsPerMeter
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
    const centerX = (circle.left ?? 0) * invPixelsPerMeter
    const centerY = (circle.top ?? 0) * invPixelsPerMeter
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
    const centerX = (polygon.left ?? 0) * invPixelsPerMeter
    const centerY = (polygon.top ?? 0) * invPixelsPerMeter
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

  private serializeEnemies() {
    const enemies: EditorMapData['enemies'] = []
    const enemyMarkers = this.ctx.markerManager.getEnemyMarkers()
    const weaponMarkerMap = this.ctx.markerManager.getWeaponMarkerMap()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    for (let i = 0; i < enemyMarkers.length; i++) {
      const data = enemyMarkers[i]
      const marker = data.marker

      let mainWeapon: MapEnemyWeapon | undefined
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

      let secondaryWeapon: MapEnemyWeapon | undefined
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

      enemies.push({
        x: (marker.left ?? 0) * invPixelsPerMeter,
        y: (marker.top ?? 0) * invPixelsPerMeter,
        enemyType: data.enemyType,
        radius: data.radius,
        moveSpeed: data.moveSpeed,
        attackDesire: data.attackDesire,
        parryProficiency: data.parryProficiency,
        initialPatrolMode: data.initialPatrolMode,
        maxHealth: data.maxHealth,
        maxPosture: data.maxPosture,
        maxToughness: data.maxToughness,
        color: data.color,
        facing: data.facing,
        debugNoDamage: data.debugNoDamage,
        debugNoDeath: data.debugNoDeath,
        equipWeapon: data.equipWeapon,
        mainWeapon,
        secondaryWeapon,
      })
    }
    return enemies
  }

  private serializeWeapons() {
    const weapons: EditorMapData['weapons'] = []
    const weaponMarkers = this.ctx.markerManager.getWeaponMarkers()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    for (let i = 0; i < weaponMarkers.length; i++) {
      const data = weaponMarkers[i]
      const marker = data.marker
      weapons.push({
        x: (marker.left ?? 0) * invPixelsPerMeter,
        y: (marker.top ?? 0) * invPixelsPerMeter,
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
