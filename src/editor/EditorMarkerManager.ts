import { fabric } from 'fabric'

import {
  CHARACTER_DEFAULT_DATA,
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import type {
  MapEnemyWeapon,
  MapPlayerProperties,
  WeaponCategory,
} from '../editorMapTypes'
import type { EnemyPatrolMode, EnemyType, WeaponType } from '../types'
import {
  DEFAULT_ENEMY_TYPE,
  EDITOR_PIXELS_PER_METER,
  PLAYER_BODY_COLOR,
} from './EditorConstants'
import type { EditorObjectFactory } from './EditorObjectFactory'
import type {
  EnemyMarker,
  EnemyMarkerData,
  ObjectType,
  PlayerMarker,
  PlayerMarkerData,
  WeaponMarker,
  WeaponMarkerData,
  WeaponShape,
} from './types'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

interface WeaponRenderDimensions {
  widthPx: number
  heightPx: number
  boundingWidthPx: number
  boundingHeightPx: number
}

interface EditorMarkerManagerContext {
  getCanvas: () => fabric.Canvas | null
  getViewportCenter: () => { x: number; y: number }
  registerEditorObject: (type: ObjectType, object: fabric.Object) => void
  handleCanvasSelection: (object: fabric.Object) => void
  computeEnemyBodyRadiusPx: (radiusMeters: number, ppm: number) => number
  computeWeaponRenderDimensions: (
    template: WeaponTemplate,
    sizeLevel: number,
    ppm: number,
    isBow: boolean
  ) => WeaponRenderDimensions
  requestRender: () => void
}

export class EditorMarkerManager {
  private ctx: EditorMarkerManagerContext
  private objectFactory: EditorObjectFactory

  private playerMarker: PlayerMarker | null = null
  private playerMarkerData: PlayerMarkerData | null = null
  private enemyMarkers: EnemyMarkerData[] = []
  private weaponMarkers: WeaponMarkerData[] = []
  private enemyMarkerMap = new Map<fabric.Object, EnemyMarkerData>()
  private weaponMarkerMap = new Map<fabric.Object, WeaponMarkerData>()
  private tempEnemyPos = { x: 0, y: 0 }
  private tempWeaponTransform = { x: 0, y: 0, rotation: 0 }

  constructor(
    ctx: EditorMarkerManagerContext,
    objectFactory: EditorObjectFactory
  ) {
    this.ctx = ctx
    this.objectFactory = objectFactory
  }

  clear() {
    this.playerMarker = null
    this.playerMarkerData = null
    this.enemyMarkers.length = 0
    this.enemyMarkerMap.clear()
    this.weaponMarkers.length = 0
    this.weaponMarkerMap.clear()
  }

  getPlayerMarker() {
    return this.playerMarker
  }

  getPlayerMarkerData() {
    return this.playerMarkerData
  }

  getEnemyMarkers() {
    return this.enemyMarkers
  }

  getWeaponMarkers() {
    return this.weaponMarkers
  }

  getWeaponMarkerMap() {
    return this.weaponMarkerMap
  }

  getEnemyMarkerMap() {
    return this.enemyMarkerMap
  }

  isPlayerMarker(object: fabric.Object | null): object is PlayerMarker {
    return (
      object instanceof fabric.Group &&
      (object as PlayerMarker).editorShape === 'player-marker'
    )
  }

  isEnemyMarker(object: fabric.Object | null): object is EnemyMarker {
    return (
      object instanceof fabric.Group &&
      (object as EnemyMarker).editorShape === 'enemy-marker'
    )
  }

  isWeaponMarker(object: fabric.Object | null): object is WeaponMarker {
    return (
      object instanceof fabric.Group &&
      (object as WeaponMarker).editorShape === 'weapon-marker'
    )
  }

  removePlayerMarker(marker: fabric.Object) {
    if (this.playerMarker === marker) {
      this.playerMarker = null
      this.playerMarkerData = null
    }
  }

  removeEnemyMarker(marker: fabric.Object) {
    const data = this.enemyMarkerMap.get(marker)
    if (data) {
      const index = this.enemyMarkers.indexOf(data)
      if (index !== -1) {
        this.enemyMarkers.splice(index, 1)
      }
      this.enemyMarkerMap.delete(marker)
    }
  }

  removeWeaponMarker(marker: fabric.Object) {
    const data = this.weaponMarkerMap.get(marker)
    if (data) {
      const index = this.weaponMarkers.indexOf(data)
      if (index !== -1) {
        this.weaponMarkers.splice(index, 1)
      }
      this.weaponMarkerMap.delete(marker)
    }
  }

  spawnPlayerMarker(
    spawn?: { x: number; y: number },
    data?: MapPlayerProperties
  ) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      // console.warn('[marker-manager] Fabric canvas not ready')
      return
    }
    const nextRadius =
      typeof data?.radius === 'number' &&
      Number.isFinite(data.radius) &&
      data.radius > 0
        ? data.radius
        : DEFAULT_PLAYER_RADIUS
    const nextMaxHealth =
      typeof data?.maxHealth === 'number' &&
      Number.isFinite(data.maxHealth) &&
      data.maxHealth > 0
        ? data.maxHealth
        : DEFAULT_PLAYER_MAX_HEALTH
    const nextMaxPosture =
      typeof data?.maxPosture === 'number' &&
      Number.isFinite(data.maxPosture) &&
      data.maxPosture > 0
        ? data.maxPosture
        : DEFAULT_PLAYER_MAX_POSTURE
    const nextMaxToughness =
      typeof data?.maxToughness === 'number' &&
      Number.isFinite(data.maxToughness) &&
      data.maxToughness > 0
        ? data.maxToughness
        : DEFAULT_PLAYER_MAX_TOUGHNESS
    const nextColor =
      typeof data?.color === 'string' && data.color.length > 0
        ? data.color
        : PLAYER_BODY_COLOR
    const nextFacing =
      data?.facing === 1 || data?.facing === -1 ? data.facing : 1
    const nextMoveSpeed =
      typeof data?.moveSpeed === 'number' &&
      Number.isFinite(data.moveSpeed) &&
      data.moveSpeed >= 0
        ? data.moveSpeed
        : DEFAULT_MOVE_SPEED
    let spawnX: number
    let spawnY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      spawnX = spawn.x * EDITOR_PIXELS_PER_METER
      spawnY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.ctx.getViewportCenter()
      spawnX = center.x
      spawnY = center.y
    }
    if (this.playerMarker && this.playerMarker.canvas) {
      this.playerMarker.left = spawnX
      this.playerMarker.top = spawnY
      this.playerMarker.setCoords()
      this.updatePlayerMarkerVisual(
        this.playerMarker,
        nextRadius,
        nextColor,
        nextFacing
      )
      if (this.playerMarkerData) {
        this.playerMarkerData.radius = nextRadius
        this.playerMarkerData.moveSpeed = nextMoveSpeed
        this.playerMarkerData.maxHealth = nextMaxHealth
        this.playerMarkerData.maxPosture = nextMaxPosture
        this.playerMarkerData.maxToughness = nextMaxToughness
        this.playerMarkerData.color = nextColor
        this.playerMarkerData.facing = nextFacing
      }
      canvas.setActiveObject(this.playerMarker)
      this.ctx.handleCanvasSelection(this.playerMarker)
      canvas.requestRenderAll()
      return
    }
    // Hardcoded ObjectType.Player ('player') to match enum
    const ObjectTypePlayer = 'player' as ObjectType

    const marker = this.objectFactory.createPlayerMarker() as PlayerMarker
    marker.left = spawnX
    marker.top = spawnY
    marker.setCoords()
    marker.radius = nextRadius
    marker.maxHealth = nextMaxHealth
    marker.maxPosture = nextMaxPosture
    marker.maxToughness = nextMaxToughness
    marker.color = nextColor
    marker.facing = nextFacing
    this.updatePlayerMarkerVisual(marker, nextRadius, nextColor, nextFacing)
    this.playerMarker = marker
    this.playerMarkerData = {
      marker,
      radius: nextRadius,
      moveSpeed: nextMoveSpeed,
      maxHealth: nextMaxHealth,
      maxPosture: nextMaxPosture,
      maxToughness: nextMaxToughness,
      color: nextColor,
      facing: nextFacing,
    }
    if (data?.mainWeapon) {
      this.createPlayerWeaponFromConfig(
        this.playerMarkerData,
        data.mainWeapon,
        'main',
        marker.left ?? 0,
        marker.top ?? 0
      )
    }
    if (data?.secondaryWeapon) {
      this.createPlayerWeaponFromConfig(
        this.playerMarkerData,
        data.secondaryWeapon,
        'secondary',
        marker.left ?? 0,
        marker.top ?? 0
      )
    }
    this.updatePlayerMarkerVisual(marker, nextRadius, nextColor, nextFacing)
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypePlayer, marker)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  updatePlayerMarkerVisual(
    marker: PlayerMarker,
    nextRadius: number,
    nextColor: string,
    nextFacing: number
  ) {
    const body = marker.item(1)
    const eye = marker.item(3)
    const bodyRadiusPx = nextRadius * EDITOR_PIXELS_PER_METER
    const eyeRadiusPx = 0.08 * EDITOR_PIXELS_PER_METER
    const eyeOffsetX = bodyRadiusPx * 0.5 * nextFacing
    const eyeOffsetY = -bodyRadiusPx * 0.5

    marker.scaleX = 1
    marker.scaleY = 1
    marker.width = bodyRadiusPx * 2
    marker.height = bodyRadiusPx * 2

    if (body instanceof fabric.Circle) {
      body.set('radius', bodyRadiusPx)
      body.set('fill', nextColor)
      body.set('stroke', nextColor)
    }
    if (eye instanceof fabric.Circle) {
      eye.set('radius', eyeRadiusPx)
      eye.set('left', eyeOffsetX)
      eye.set('top', eyeOffsetY)
    }

    marker.radius = nextRadius
    marker.color = nextColor
    marker.facing = nextFacing
    this.updatePlayerWeaponVisual(marker)
    marker.setCoords()
  }

  private updatePlayerWeaponVisual(marker: PlayerMarker) {
    const weaponBackShape = marker.weaponBackShape
    const weaponFrontShape = marker.weaponFrontShape
    if (!weaponBackShape || !weaponFrontShape) {
      return
    }

    const playerData = this.playerMarkerData
    if (!playerData || playerData.marker !== marker) {
      weaponBackShape.visible = false
      weaponFrontShape.visible = false
      return
    }

    const weaponMarker = playerData.mainWeaponMarker
    const weaponType = playerData.mainWeapon
    if (!weaponType) {
      weaponBackShape.visible = false
      weaponFrontShape.visible = false
      return
    }

    const template = WEAPON_DEFAULT_DATA[weaponType]
    const weaponData = weaponMarker
      ? this.weaponMarkerMap.get(weaponMarker)
      : undefined
    const sizeLevel = weaponData?.sizeLevel ?? template.sizeLevel
    const isBow = weaponType === 'bow'
    const dims = this.ctx.computeWeaponRenderDimensions(
      template,
      sizeLevel,
      EDITOR_PIXELS_PER_METER,
      isBow
    )
    const weaponWidthPx = Math.round(dims.widthPx)
    const weaponHeightPx = Math.round(dims.heightPx)
    const weaponBoundingWidthPx = Math.round(dims.boundingWidthPx)
    const weaponBoundingHeightPx = Math.round(dims.boundingHeightPx)

    weaponBackShape.weaponWidthPx = weaponWidthPx
    weaponBackShape.weaponHeightPx = weaponHeightPx
    weaponBackShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponBackShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponBackShape.weaponRenderType = isBow ? 'bow' : 'sword'
    weaponBackShape.width = weaponBoundingWidthPx
    weaponBackShape.height = weaponBoundingHeightPx

    weaponFrontShape.weaponWidthPx = weaponWidthPx
    weaponFrontShape.weaponHeightPx = weaponHeightPx
    weaponFrontShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponFrontShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponFrontShape.weaponRenderType = isBow ? 'bow' : 'sword'
    weaponFrontShape.width = weaponBoundingWidthPx
    weaponFrontShape.height = weaponBoundingHeightPx

    this.tempEnemyPos.x = 0
    this.tempEnemyPos.y = 0
    setWeaponBackTransform(
      this.tempEnemyPos,
      marker.facing,
      this.tempWeaponTransform,
      marker.radius,
      weaponType
    )

    const weaponLeft = Math.round(
      this.tempWeaponTransform.x * EDITOR_PIXELS_PER_METER
    )
    const weaponTop = Math.round(
      this.tempWeaponTransform.y * EDITOR_PIXELS_PER_METER
    )
    const weaponAngle = Math.round(
      (this.tempWeaponTransform.rotation * 180) / Math.PI
    )

    weaponBackShape.left = weaponLeft
    weaponBackShape.top = weaponTop
    weaponBackShape.angle = weaponAngle
    weaponFrontShape.left = weaponLeft
    weaponFrontShape.top = weaponTop
    weaponFrontShape.angle = weaponAngle

    if (marker.facing < 0) {
      weaponBackShape.visible = true
      weaponFrontShape.visible = false
    } else {
      weaponBackShape.visible = false
      weaponFrontShape.visible = true
    }
  }

  spawnEnemyMarker(
    enemyType: EnemyType = DEFAULT_ENEMY_TYPE,
    spawn?: {
      x: number
      y: number
      radius?: number
      moveSpeed?: number
      attackDesire?: number
      parryProficiency?: number
      initialPatrolMode?: EnemyPatrolMode
      maxHealth?: number
      maxPosture?: number
      maxToughness?: number
      color?: string
      facing?: number
      equipWeapon?: boolean
      mainWeapon?: MapEnemyWeapon
      secondaryWeapon?: MapEnemyWeapon
    }
  ) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      // console.warn('[marker-manager] Fabric canvas not ready')
      return
    }
    const template =
      CHARACTER_DEFAULT_DATA[enemyType] ?? CHARACTER_DEFAULT_DATA.default
    const radius = spawn?.radius ?? template.radius
    const moveSpeed = spawn?.moveSpeed ?? template.moveSpeed
    const attackDesire = spawn?.attackDesire ?? template.attackDesire
    const parryProficiency =
      spawn?.parryProficiency ?? template.parryProficiency
    const initialPatrolMode =
      spawn?.initialPatrolMode ?? template.initialPatrolMode
    const maxHealth = spawn?.maxHealth ?? template.maxHealth
    const maxPosture = spawn?.maxPosture ?? template.maxPosture
    const maxToughness = spawn?.maxToughness ?? template.maxToughness
    const color = spawn?.color ?? template.color
    const facing = spawn?.facing ?? 1
    const equipWeapon =
      spawn?.equipWeapon ?? !!(spawn?.mainWeapon || spawn?.secondaryWeapon)
    let centerX: number
    let centerY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      centerX = spawn.x * EDITOR_PIXELS_PER_METER
      centerY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.ctx.getViewportCenter()
      centerX = center.x
      centerY = center.y
    }

    // Hardcoded ObjectType.Enemy ('enemy')
    const ObjectTypeEnemy = 'enemy' as ObjectType

    const marker = this.objectFactory.createEnemyMarker(
      enemyType,
      radius,
      color,
      equipWeapon
    ) as EnemyMarker
    marker.radius = radius
    marker.moveSpeed = moveSpeed
    marker.attackDesire = attackDesire
    marker.parryProficiency = parryProficiency
    marker.initialPatrolMode = initialPatrolMode
    marker.maxHealth = maxHealth
    marker.maxPosture = maxPosture
    marker.maxToughness = maxToughness
    marker.color = color
    marker.facing = facing
    marker.equipWeapon = equipWeapon
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypeEnemy, marker)
    const enemyData: EnemyMarkerData = {
      marker,
      enemyType,
      radius,
      moveSpeed,
      attackDesire,
      parryProficiency,
      initialPatrolMode,
      maxHealth,
      maxPosture,
      maxToughness,
      color,
      facing,
      equipWeapon,
      mainWeapon: spawn?.mainWeapon?.weaponType,
      secondaryWeapon: spawn?.secondaryWeapon?.weaponType,
    }
    this.enemyMarkers.push(enemyData)
    this.enemyMarkerMap.set(marker, enemyData)

    if (spawn?.mainWeapon) {
      this.createEnemyWeaponFromConfig(
        enemyData,
        spawn.mainWeapon,
        'main',
        centerX,
        centerY
      )
    }

    if (spawn?.secondaryWeapon) {
      this.createEnemyWeaponFromConfig(
        enemyData,
        spawn.secondaryWeapon,
        'secondary',
        centerX,
        centerY
      )
    }

    this.updateEnemyMarkerVisual(marker, radius, color, facing)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  spawnWeaponMarker(
    weaponType: WeaponType,
    category: WeaponCategory,
    spawn?: {
      x?: number
      y?: number
      sizeLevel?: number
      attackDamage?: number
      postureDamage?: number
      toughnessDamage?: number
      bowAmmo?: number
    }
  ) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      // console.warn('[marker-manager] Fabric canvas not ready')
      return
    }
    let centerX: number
    let centerY: number
    if (spawn && spawn.x !== undefined && spawn.y !== undefined) {
      centerX = spawn.x * EDITOR_PIXELS_PER_METER
      centerY = spawn.y * EDITOR_PIXELS_PER_METER
    } else {
      const center = this.ctx.getViewportCenter()
      centerX = center.x
      centerY = center.y
    }
    const template = WEAPON_DEFAULT_DATA[weaponType]
    const sizeLevel = spawn?.sizeLevel ?? template.sizeLevel
    const attackDamage = spawn?.attackDamage ?? template.attackDamage
    const postureDamage = spawn?.postureDamage ?? template.postureDamage
    const toughnessDamage = spawn?.toughnessDamage ?? template.toughnessDamage
    const bowAmmo =
      spawn?.bowAmmo ??
      (weaponType === 'bow' ? DEFAULT_BOW_AMMO_PLAYER : undefined)

    // Hardcoded ObjectType.Weapon ('weapon')
    const ObjectTypeWeapon = 'weapon' as ObjectType

    const marker = this.objectFactory.createWeaponMarker(
      weaponType,
      category,
      sizeLevel,
      attackDamage,
      postureDamage,
      toughnessDamage,
      bowAmmo,
      template
    ) as WeaponMarker
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypeWeapon, marker)
    const weaponData: WeaponMarkerData = {
      marker,
      weaponType,
      category,
      sizeLevel,
      attackDamage,
      postureDamage,
      toughnessDamage,
      bowAmmo,
    }
    this.weaponMarkers.push(weaponData)
    this.weaponMarkerMap.set(marker, weaponData)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  updateEnemyMarkerVisual(
    marker: EnemyMarker,
    nextRadius: number,
    nextColor: string,
    nextFacing: number
  ) {
    const body = marker.item(1)
    const eye = marker.item(3)
    const bodyRadiusPx = this.ctx.computeEnemyBodyRadiusPx(
      nextRadius,
      EDITOR_PIXELS_PER_METER
    )
    const eyeRadiusPx = 0.08 * EDITOR_PIXELS_PER_METER
    // Adjust eye offset based on facing
    const eyeOffsetX = bodyRadiusPx * 0.5 * nextFacing
    const eyeOffsetY = -bodyRadiusPx * 0.5

    marker.scaleX = 1
    marker.scaleY = 1
    marker.width = bodyRadiusPx * 2
    marker.height = bodyRadiusPx * 2

    if (body instanceof fabric.Circle) {
      body.set('radius', bodyRadiusPx)
      body.set('fill', nextColor)
      body.set('stroke', nextColor)
    }
    if (eye instanceof fabric.Circle) {
      eye.set('radius', eyeRadiusPx)
      eye.set('left', eyeOffsetX)
      eye.set('top', eyeOffsetY)
    }

    marker.radius = nextRadius
    marker.color = nextColor
    marker.facing = nextFacing
    this.updateEnemyWeaponVisual(marker)
    marker.setCoords()
  }

  private updateEnemyWeaponVisual(marker: EnemyMarker) {
    const weaponBackShape = marker.weaponBackShape
    const weaponFrontShape = marker.weaponFrontShape
    if (!weaponBackShape || !weaponFrontShape) {
      return
    }

    const enemyData = this.enemyMarkerMap.get(marker)
    if (!enemyData || !marker.equipWeapon) {
      weaponBackShape.visible = false
      weaponFrontShape.visible = false
      return
    }

    const weaponMarker =
      enemyData.mainWeaponMarker ?? enemyData.secondaryWeaponMarker
    const weaponType =
      enemyData.mainWeapon ?? enemyData.secondaryWeapon ?? undefined

    if (!weaponType) {
      weaponBackShape.visible = false
      weaponFrontShape.visible = false
      return
    }

    const template = WEAPON_DEFAULT_DATA[weaponType]
    const weaponData = weaponMarker
      ? this.weaponMarkerMap.get(weaponMarker)
      : undefined
    const sizeLevel = weaponData?.sizeLevel ?? template.sizeLevel
    const isBow = weaponType === 'bow'
    const dims = this.ctx.computeWeaponRenderDimensions(
      template,
      sizeLevel,
      EDITOR_PIXELS_PER_METER,
      isBow
    )
    const weaponWidthPx = Math.round(dims.widthPx)
    const weaponHeightPx = Math.round(dims.heightPx)
    const weaponBoundingWidthPx = Math.round(dims.boundingWidthPx)
    const weaponBoundingHeightPx = Math.round(dims.boundingHeightPx)

    weaponBackShape.weaponWidthPx = weaponWidthPx
    weaponBackShape.weaponHeightPx = weaponHeightPx
    weaponBackShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponBackShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponBackShape.weaponRenderType = isBow ? 'bow' : 'sword'
    weaponBackShape.width = weaponBoundingWidthPx
    weaponBackShape.height = weaponBoundingHeightPx

    weaponFrontShape.weaponWidthPx = weaponWidthPx
    weaponFrontShape.weaponHeightPx = weaponHeightPx
    weaponFrontShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponFrontShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponFrontShape.weaponRenderType = isBow ? 'bow' : 'sword'
    weaponFrontShape.width = weaponBoundingWidthPx
    weaponFrontShape.height = weaponBoundingHeightPx

    this.tempEnemyPos.x = 0
    this.tempEnemyPos.y = 0
    setWeaponBackTransform(
      this.tempEnemyPos,
      marker.facing,
      this.tempWeaponTransform,
      marker.radius,
      weaponType
    )

    const weaponLeft = Math.round(
      this.tempWeaponTransform.x * EDITOR_PIXELS_PER_METER
    )
    const weaponTop = Math.round(
      this.tempWeaponTransform.y * EDITOR_PIXELS_PER_METER
    )
    const weaponAngle = Math.round(
      (this.tempWeaponTransform.rotation * 180) / Math.PI
    )

    weaponBackShape.left = weaponLeft
    weaponBackShape.top = weaponTop
    weaponBackShape.angle = weaponAngle
    weaponFrontShape.left = weaponLeft
    weaponFrontShape.top = weaponTop
    weaponFrontShape.angle = weaponAngle

    if (marker.facing < 0) {
      weaponBackShape.visible = true
      weaponFrontShape.visible = false
    } else {
      weaponBackShape.visible = false
      weaponFrontShape.visible = true
    }
  }

  updateWeaponMarkerVisual(marker: WeaponMarker, nextSizeLevel: number) {
    const item = marker.item(0)
    if (!(item instanceof fabric.Object)) {
      return
    }
    const shape = item as unknown as WeaponShape
    const template = WEAPON_DEFAULT_DATA[marker.weaponType]
    const isBow = marker.weaponType === 'bow'
    const dims = this.ctx.computeWeaponRenderDimensions(
      template,
      nextSizeLevel,
      EDITOR_PIXELS_PER_METER,
      isBow
    )

    shape.weaponWidthPx = dims.widthPx
    shape.weaponHeightPx = dims.heightPx
    shape.weaponBoundingWidthPx = dims.boundingWidthPx
    shape.weaponBoundingHeightPx = dims.boundingHeightPx
    shape.width = dims.boundingWidthPx
    shape.height = dims.boundingHeightPx
    shape.setCoords()

    marker.sizeLevel = nextSizeLevel
    marker.width = dims.boundingWidthPx
    marker.height = dims.boundingHeightPx
    marker.setCoords()

    let updatedEnemy = false
    for (let i = 0; i < this.enemyMarkers.length; i++) {
      const enemyData = this.enemyMarkers[i]
      if (
        enemyData.mainWeaponMarker === marker ||
        enemyData.secondaryWeaponMarker === marker
      ) {
        this.updateEnemyMarkerVisual(
          enemyData.marker,
          enemyData.radius,
          enemyData.color,
          enemyData.facing
        )
        updatedEnemy = true
      }
    }
    if (updatedEnemy) {
      this.ctx.requestRender()
    }
    const playerData = this.playerMarkerData
    if (
      playerData &&
      (playerData.mainWeaponMarker === marker ||
        playerData.secondaryWeaponMarker === marker)
    ) {
      this.updatePlayerMarkerVisual(
        playerData.marker,
        playerData.radius,
        playerData.color,
        playerData.facing
      )
      this.ctx.requestRender()
    }
  }

  getOrCreateEnemyWeaponMarker(
    enemyData: EnemyMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ): WeaponMarker | null {
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    const weaponKey = slot === 'main' ? 'mainWeapon' : 'secondaryWeapon'
    let weaponMarker = enemyData[markerKey]

    if (weaponMarker && weaponMarker.weaponType !== weaponType) {
      this.weaponMarkerMap.delete(weaponMarker)
      weaponMarker = undefined
      enemyData[markerKey] = undefined
      enemyData[weaponKey] = undefined
    }

    if (!weaponMarker) {
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const result = this.objectFactory.createEnemyWeaponMarkerFromConfig(
        {
          weaponType,
          sizeLevel: template.sizeLevel,
          attackDamage: template.attackDamage,
          postureDamage: template.postureDamage,
          toughnessDamage: template.toughnessDamage,
          bowAmmo: weaponType === 'bow' ? DEFAULT_BOW_AMMO_ENEMY : undefined,
        },
        slot,
        enemyData.marker.left ?? 0,
        enemyData.marker.top ?? 0,
        WEAPON_DEFAULT_DATA
      )

      weaponMarker = result.weaponMarker as WeaponMarker
      const weaponData = result.weaponData as WeaponMarkerData
      this.weaponMarkerMap.set(weaponMarker, weaponData)
      enemyData[markerKey] = weaponMarker
      enemyData[weaponKey] = weaponType
    }

    return weaponMarker
  }

  getOrCreatePlayerWeaponMarker(
    playerData: PlayerMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ): WeaponMarker | null {
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    const weaponKey = slot === 'main' ? 'mainWeapon' : 'secondaryWeapon'
    let weaponMarker = playerData[markerKey]

    if (weaponMarker && weaponMarker.weaponType !== weaponType) {
      this.weaponMarkerMap.delete(weaponMarker)
      weaponMarker = undefined
      playerData[markerKey] = undefined
      playerData[weaponKey] = undefined
    }

    if (!weaponMarker) {
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const result = this.objectFactory.createEnemyWeaponMarkerFromConfig(
        {
          weaponType,
          sizeLevel: template.sizeLevel,
          attackDamage: template.attackDamage,
          postureDamage: template.postureDamage,
          toughnessDamage: template.toughnessDamage,
          bowAmmo: weaponType === 'bow' ? DEFAULT_BOW_AMMO_PLAYER : undefined,
        },
        slot,
        playerData.marker.left ?? 0,
        playerData.marker.top ?? 0,
        WEAPON_DEFAULT_DATA
      )

      weaponMarker = result.weaponMarker as WeaponMarker
      const weaponData = result.weaponData as WeaponMarkerData
      this.weaponMarkerMap.set(weaponMarker, weaponData)
      playerData[markerKey] = weaponMarker
      playerData[weaponKey] = weaponType
    }

    return weaponMarker
  }

  private createEnemyWeaponFromConfig(
    enemyData: EnemyMarkerData,
    config: MapEnemyWeapon,
    slot: 'main' | 'secondary',
    x: number,
    y: number
  ) {
    const { weaponMarker, weaponData } =
      this.objectFactory.createEnemyWeaponMarkerFromConfig(
        config,
        slot,
        x,
        y,
        WEAPON_DEFAULT_DATA
      )

    // Cast to WeaponMarker as the factory returns a fabric.Group that needs to be treated as one
    const typedWeaponMarker = weaponMarker as WeaponMarker
    const typedWeaponData = weaponData as WeaponMarkerData

    this.weaponMarkerMap.set(typedWeaponMarker, typedWeaponData)

    if (slot === 'main') {
      enemyData.mainWeaponMarker = typedWeaponMarker
    } else {
      enemyData.secondaryWeaponMarker = typedWeaponMarker
    }
  }

  private createPlayerWeaponFromConfig(
    playerData: PlayerMarkerData,
    config: MapEnemyWeapon,
    slot: 'main' | 'secondary',
    x: number,
    y: number
  ) {
    const { weaponMarker, weaponData } =
      this.objectFactory.createEnemyWeaponMarkerFromConfig(
        config,
        slot,
        x,
        y,
        WEAPON_DEFAULT_DATA
      )

    const typedWeaponMarker = weaponMarker as WeaponMarker
    const typedWeaponData = weaponData as WeaponMarkerData

    this.weaponMarkerMap.set(typedWeaponMarker, typedWeaponData)

    if (slot === 'main') {
      playerData.mainWeaponMarker = typedWeaponMarker
      playerData.mainWeapon = config.weaponType
    } else {
      playerData.secondaryWeaponMarker = typedWeaponMarker
      playerData.secondaryWeapon = config.weaponType
    }
  }
}
