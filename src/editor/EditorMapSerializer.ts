import { fabric } from 'fabric'

import type {
  EditorMapData,
  MapEnemyWeapon,
  MapPlacedShape,
  WeaponCategory,
} from '../editorMapTypes'
import type { EnemyPatrolMode, EnemyType, WeaponType } from '../types'

interface EditorObjectLike {
  type: string
  object: fabric.Object
}

interface CameraViewLike {
  frame: fabric.Object
  zoom: number
}

interface EnemyMarkerDataLike {
  marker: fabric.Object
  enemyType: EnemyType
  radius: number
  moveSpeed: number
  attackDesire: number
  parryProficiency: number
  initialPatrolMode: EnemyPatrolMode
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  equipWeapon: boolean
  mainWeapon?: WeaponType
  secondaryWeapon?: WeaponType
  mainWeaponMarker?: fabric.Object
  secondaryWeaponMarker?: fabric.Object
}

interface WeaponMarkerDataLike {
  marker: fabric.Object
  weaponType: WeaponType
  category: WeaponCategory
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

interface EditorMapSerializerContext {
  getCanvas: () => HTMLCanvasElement
  getInvPixelsPerMeter: () => number
  getPixelsPerMeter: () => number
  getFabricCanvas: () => fabric.Canvas | null
  ensureFabricCanvas: () => void
  resizeEditorCanvas: () => void
  clearEditorScene: () => void
  spawnPlayerMarker: (spawn?: EditorMapData['playerSpawn']) => void
  spawnCameraViewFrame: (camera?: EditorMapData['camera']) => void
  applyPlacedShapes: (shapes: EditorMapData['shapes']) => void
  applyEnemies: (enemies: EditorMapData['enemies']) => void
  applyWeapons: (weapons: EditorMapData['weapons']) => void
  renderObjectTree: () => void
  requestRenderAll: () => void
  getPlayerMarker: () => fabric.Object | null
  getCameraViews: () => CameraViewLike[]
  getEditorObjects: () => EditorObjectLike[]
  getEnemyMarkers: () => EnemyMarkerDataLike[]
  getWeaponMarkers: () => WeaponMarkerDataLike[]
  getWeaponMarkerMap: () => Map<fabric.Object, WeaponMarkerDataLike>
  getPolygonScratchPoint: () => fabric.Point
  applyTransform: (
    x: number,
    y: number,
    matrix: number[],
    out: fabric.Point
  ) => void
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
    }
  }

  serializeCurrentMapData(): EditorMapData {
    const base = this.buildDefaultMapData()
    const playerSpawn = this.serializePlayerSpawn(base)
    const camera = this.serializeCamera(base)
    const shapes: MapPlacedShape[] = []
    this.serializeShapes(shapes)
    const enemies = this.serializeEnemies()
    const weapons = this.serializeWeapons()
    return {
      version: 1,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      pixelsPerMeter: base.pixelsPerMeter,
      playerSpawn,
      camera,
      shapes,
      enemies,
      weapons,
    }
  }

  computeCameraOffsetFromCenter(
    centerX: number,
    centerY: number,
    zoom: number
  ) {
    const canvas = this.ctx.getCanvas()
    const invZoom = zoom > 0 ? 1 / zoom : 1
    const canvasWidthMeters = canvas.width * this.ctx.getInvPixelsPerMeter()
    const canvasHeightMeters = canvas.height * this.ctx.getInvPixelsPerMeter()
    const anchorX = canvasWidthMeters * 0.5
    const anchorY = canvasHeightMeters
    const viewWidth = canvasWidthMeters * invZoom
    const viewHeight = canvasHeightMeters * invZoom
    const desiredLeft = centerX - viewWidth * 0.5
    const desiredTop = centerY - viewHeight * 0.5
    const cameraX = desiredLeft - anchorX * (1 - invZoom)
    const cameraY = desiredTop - anchorY * (1 - invZoom)
    return { x: cameraX, y: cameraY, zoom }
  }

  computeCameraCenterFromOffset(camera: EditorMapData['camera']) {
    const canvas = this.ctx.getCanvas()
    const zoom = camera.zoom > 0 ? camera.zoom : 1
    const invZoom = 1 / zoom
    const canvasWidthMeters = canvas.width * this.ctx.getInvPixelsPerMeter()
    const canvasHeightMeters = canvas.height * this.ctx.getInvPixelsPerMeter()
    const anchorX = canvasWidthMeters * 0.5
    const anchorY = canvasHeightMeters
    const viewWidth = canvasWidthMeters * invZoom
    const viewHeight = canvasHeightMeters * invZoom
    const left = anchorX * (1 - invZoom) + camera.x
    const top = anchorY * (1 - invZoom) + camera.y
    const centerX = left + viewWidth * 0.5
    const centerY = top + viewHeight * 0.5
    return { centerX, centerY, zoom }
  }

  applyMapData(data: EditorMapData) {
    this.ctx.ensureFabricCanvas()
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return
    }
    this.ctx.resizeEditorCanvas()
    this.ctx.clearEditorScene()
    this.ctx.spawnPlayerMarker(data.playerSpawn)
    this.ctx.spawnCameraViewFrame(data.camera)
    this.ctx.applyPlacedShapes(data.shapes)
    this.ctx.applyEnemies(data.enemies)
    this.ctx.applyWeapons(data.weapons)
    this.ctx.renderObjectTree()
    this.ctx.requestRenderAll()
  }

  private serializePlayerSpawn(base: EditorMapData) {
    const marker = this.ctx.getPlayerMarker()
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
    return this.computeCameraOffsetFromCenter(centerX, centerY, zoom)
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
    const enemyMarkers = this.ctx.getEnemyMarkers()
    const weaponMarkerMap = this.ctx.getWeaponMarkerMap()
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
        equipWeapon: data.equipWeapon,
        mainWeapon,
        secondaryWeapon,
      })
    }
    return enemies
  }

  private serializeWeapons() {
    const weapons: EditorMapData['weapons'] = []
    const weaponMarkers = this.ctx.getWeaponMarkers()
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
