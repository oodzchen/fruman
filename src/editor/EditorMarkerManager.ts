import * as fabric from 'fabric'

import { getCharacterBodyColor } from '../characterBodyProfile'
import {
  CHARACTER_DEFAULT_DATA,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { getDefaultNormalAttackMovesetId } from '../ecs/AttackMoveRegistry'
import { Faction } from '../ecs/Component'
import { setWeaponBackTransform } from '../ecs/WeaponPoseUtils'
import type {
  MapCharacterBodyProfile,
  MapCheckpoint,
  MapHookAnchor,
  MapNpcWeapon,
  MapPlayerProperties,
  WeaponCategory,
} from '../editorMapTypes'
import type {
  NormalAttackMovesetId,
  NpcDetectionRangeLevel,
  NpcPatrolMode,
  NpcType,
  WeaponType,
} from '../types'
import {
  getDefaultNpcAmmoForWeaponType,
  getDefaultPlayerAmmoForWeaponType,
  isRangedWeaponType,
  normalizeWeaponTypeAndSizeLevel,
  resolveWeaponStatsForSize,
} from '../weaponTypeUtils'
import {
  DEFAULT_NPC_TYPE,
  EDITOR_PIXELS_PER_METER,
  PLAYER_BODY_COLOR,
} from './EditorConstants'
import type { EditorObjectFactory } from './EditorObjectFactory'
import type {
  CharacterBodyShapeObject,
  CheckpointMarker,
  CheckpointMarkerData,
  HookAnchorMarker,
  HookAnchorMarkerData,
  NpcMarker,
  NpcMarkerData,
  ObjectType,
  PlayerMarker,
  PlayerMarkerData,
  SunPickupMarker,
  SunPickupMarkerData,
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
  computeNpcBodyRadiusPx: (radiusMeters: number, ppm: number) => number
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
  private npcMarkers: NpcMarkerData[] = []
  private weaponMarkers: WeaponMarkerData[] = []
  private checkpointMarkers: CheckpointMarkerData[] = []
  private hookAnchorMarkers: HookAnchorMarkerData[] = []
  private sunPickupMarkers: SunPickupMarkerData[] = []
  private npcMarkerMap = new Map<fabric.Object, NpcMarkerData>()
  private weaponMarkerMap = new Map<fabric.Object, WeaponMarkerData>()
  private checkpointMarkerMap = new Map<fabric.Object, CheckpointMarkerData>()
  private hookAnchorMarkerMap = new Map<fabric.Object, HookAnchorMarkerData>()
  private sunPickupMarkerMap = new Map<fabric.Object, SunPickupMarkerData>()
  private bodyTextureCache = new Map<string, HTMLImageElement>()
  private tempNpcPos = { x: 0, y: 0 }
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
    this.npcMarkers.length = 0
    this.npcMarkerMap.clear()
    this.weaponMarkers.length = 0
    this.weaponMarkerMap.clear()
    this.checkpointMarkers.length = 0
    this.checkpointMarkerMap.clear()
    this.hookAnchorMarkers.length = 0
    this.hookAnchorMarkerMap.clear()
    this.sunPickupMarkers.length = 0
    this.sunPickupMarkerMap.clear()
    this.bodyTextureCache.clear()
  }

  private getBodyTextureImage(
    profile: MapCharacterBodyProfile | undefined
  ): HTMLImageElement | null {
    const textureDataUrl = profile?.surfaceDataUrl ?? profile?.textureDataUrl
    if (!textureDataUrl || textureDataUrl.length === 0) {
      return null
    }
    const cached = this.bodyTextureCache.get(textureDataUrl)
    if (cached) {
      if (!cached.complete) {
        cached.addEventListener(
          'load',
          () => {
            this.ctx.requestRender()
          },
          { once: true }
        )
      }
      return cached
    }
    const image = new Image()
    image.onload = () => {
      this.ctx.requestRender()
    }
    image.src = textureDataUrl
    this.bodyTextureCache.set(textureDataUrl, image)
    return image
  }

  getPlayerMarker() {
    return this.playerMarker
  }

  getPlayerMarkerData() {
    return this.playerMarkerData
  }

  getNpcMarkers() {
    return this.npcMarkers
  }

  getWeaponMarkers() {
    return this.weaponMarkers
  }

  hasWeaponType(weaponType: WeaponType): boolean {
    for (let i = 0; i < this.weaponMarkers.length; i++) {
      if (this.weaponMarkers[i].weaponType === weaponType) {
        return true
      }
    }
    return false
  }

  getCheckpointMarkers() {
    return this.checkpointMarkers
  }

  getHookAnchorMarkers() {
    return this.hookAnchorMarkers
  }

  getSunPickupMarkers() {
    return this.sunPickupMarkers
  }

  getWeaponMarkerMap() {
    return this.weaponMarkerMap
  }

  getCheckpointMarkerMap() {
    return this.checkpointMarkerMap
  }

  getHookAnchorMarkerMap() {
    return this.hookAnchorMarkerMap
  }

  getNpcMarkerMap() {
    return this.npcMarkerMap
  }

  private isCharacterBodyShapeObject(
    object: fabric.Object | undefined
  ): object is CharacterBodyShapeObject {
    return (
      !!object &&
      'bodyRadiusXPx' in object &&
      'bodyRadiusYPx' in object &&
      'bodyFacing' in object
    )
  }

  private isWeaponShapeObject(
    object: fabric.Object | undefined
  ): object is WeaponShape {
    return (
      !!object &&
      'weaponWidthPx' in object &&
      'weaponHeightPx' in object &&
      'weaponBoundingWidthPx' in object &&
      'weaponBoundingHeightPx' in object &&
      'weaponRenderType' in object
    )
  }

  isPlayerMarker(object: fabric.Object | null): object is PlayerMarker {
    return (
      object instanceof fabric.Group &&
      (object as PlayerMarker).editorShape === 'player-marker'
    )
  }

  isNpcMarker(object: fabric.Object | null): object is NpcMarker {
    return (
      object instanceof fabric.Group &&
      (object as NpcMarker).editorShape === 'npc-marker'
    )
  }

  isWeaponMarker(object: fabric.Object | null): object is WeaponMarker {
    return (
      object instanceof fabric.Group &&
      (object as WeaponMarker).editorShape === 'weapon-marker'
    )
  }

  isCheckpointMarker(object: fabric.Object | null): object is CheckpointMarker {
    return (
      object instanceof fabric.Group &&
      (object as CheckpointMarker).editorShape === 'checkpoint-marker'
    )
  }

  isHookAnchorMarker(object: fabric.Object | null): object is HookAnchorMarker {
    return (
      object instanceof fabric.Group &&
      (object as HookAnchorMarker).editorShape === 'hook-anchor-marker'
    )
  }

  removePlayerMarker(marker: fabric.Object) {
    if (this.playerMarker === marker) {
      this.playerMarker = null
      this.playerMarkerData = null
    }
  }

  removeNpcMarker(marker: fabric.Object) {
    const data = this.npcMarkerMap.get(marker)
    if (data) {
      const index = this.npcMarkers.indexOf(data)
      if (index !== -1) {
        this.npcMarkers.splice(index, 1)
      }
      this.npcMarkerMap.delete(marker)
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

  removeCheckpointMarker(marker: fabric.Object) {
    const data = this.checkpointMarkerMap.get(marker)
    if (data) {
      const index = this.checkpointMarkers.indexOf(data)
      if (index !== -1) {
        this.checkpointMarkers.splice(index, 1)
      }
      this.checkpointMarkerMap.delete(marker)
    }
  }

  removeHookAnchorMarker(marker: fabric.Object) {
    const data = this.hookAnchorMarkerMap.get(marker)
    if (data) {
      const index = this.hookAnchorMarkers.indexOf(data)
      if (index !== -1) {
        this.hookAnchorMarkers.splice(index, 1)
      }
      this.hookAnchorMarkerMap.delete(marker)
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
    const nextBodyProfile = data?.bodyProfile
    const nextColor = getCharacterBodyColor(
      nextBodyProfile,
      typeof data?.color === 'string' && data.color.length > 0
        ? data.color
        : PLAYER_BODY_COLOR
    )
    const nextFacing =
      data?.facing === 1 || data?.facing === -1 ? data.facing : 1
    const nextMoveSpeed =
      typeof data?.moveSpeed === 'number' &&
      Number.isFinite(data.moveSpeed) &&
      data.moveSpeed >= 0
        ? data.moveSpeed
        : DEFAULT_MOVE_SPEED
    const nextDebugNoDamage = data?.debugNoDamage === true
    const nextDebugNoDeath = data?.debugNoDeath === true
    const nextInitialNormalMovesetId =
      data?.initialNormalMovesetId ?? getDefaultNormalAttackMovesetId('player')
    const nextBodyHeight =
      typeof data?.bodyHeight === 'number' && data.bodyHeight > 0
        ? data.bodyHeight
        : 0
    const nextFactionId = data?.factionId ?? Faction.Player
    const nextNpcFactions = data?.npcFactions ??
      data?.enemyFactions ?? [Faction.Enemy]
    const nextAllyFactions = data?.allyFactions ?? []
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
        nextBodyHeight,
        nextColor,
        nextFacing
      )
      if (this.playerMarkerData) {
        this.playerMarkerData.radius = nextRadius
        this.playerMarkerData.bodyHeight = nextBodyHeight
        this.playerMarkerData.bodyProfile = nextBodyProfile
        this.playerMarkerData.moveSpeed = nextMoveSpeed
        this.playerMarkerData.maxHealth = nextMaxHealth
        this.playerMarkerData.maxPosture = nextMaxPosture
        this.playerMarkerData.maxToughness = nextMaxToughness
        this.playerMarkerData.color = nextColor
        this.playerMarkerData.facing = nextFacing
        this.playerMarkerData.initialNormalMovesetId =
          nextInitialNormalMovesetId
        this.playerMarkerData.debugNoDamage = nextDebugNoDamage
        this.playerMarkerData.debugNoDeath = nextDebugNoDeath
        this.playerMarkerData.factionId = nextFactionId
        this.playerMarkerData.npcFactions = nextNpcFactions
        this.playerMarkerData.allyFactions = nextAllyFactions
      }
      this.playerMarker.initialNormalMovesetId = nextInitialNormalMovesetId
      this.playerMarker.bodyProfile = nextBodyProfile
      this.playerMarker.debugNoDamage = nextDebugNoDamage
      this.playerMarker.debugNoDeath = nextDebugNoDeath
      this.playerMarker.factionId = nextFactionId
      this.playerMarker.npcFactions = nextNpcFactions
      this.playerMarker.allyFactions = nextAllyFactions
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
    marker.bodyHeight = nextBodyHeight
    marker.bodyProfile = nextBodyProfile
    marker.maxHealth = nextMaxHealth
    marker.maxPosture = nextMaxPosture
    marker.maxToughness = nextMaxToughness
    marker.color = getCharacterBodyColor(marker.bodyProfile, nextColor)
    marker.facing = nextFacing
    marker.initialNormalMovesetId = nextInitialNormalMovesetId
    marker.debugNoDamage = nextDebugNoDamage
    marker.debugNoDeath = nextDebugNoDeath
    marker.factionId = nextFactionId
    marker.npcFactions = nextNpcFactions
    marker.allyFactions = nextAllyFactions
    this.updatePlayerMarkerVisual(
      marker,
      nextRadius,
      nextBodyHeight,
      nextColor,
      nextFacing
    )
    this.playerMarker = marker
    this.playerMarkerData = {
      marker,
      radius: nextRadius,
      bodyHeight: nextBodyHeight,
      bodyProfile: nextBodyProfile,
      moveSpeed: nextMoveSpeed,
      maxHealth: nextMaxHealth,
      maxPosture: nextMaxPosture,
      maxToughness: nextMaxToughness,
      color: nextColor,
      facing: nextFacing,
      initialNormalMovesetId: nextInitialNormalMovesetId,
      debugNoDamage: nextDebugNoDamage,
      debugNoDeath: nextDebugNoDeath,
      factionId: nextFactionId,
      npcFactions: nextNpcFactions,
      allyFactions: nextAllyFactions,
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
    this.updatePlayerMarkerVisual(
      marker,
      nextRadius,
      nextBodyHeight,
      nextColor,
      nextFacing
    )
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypePlayer, marker)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  updatePlayerMarkerVisual(
    marker: PlayerMarker,
    nextRadius: number,
    nextBodyHeight: number,
    nextColor: string,
    nextFacing: number
  ) {
    const bodyItem = marker.item(1)
    const body = this.isCharacterBodyShapeObject(bodyItem)
      ? bodyItem
      : undefined
    const bodyRadiusXPx = nextRadius * EDITOR_PIXELS_PER_METER
    const bodyRadiusYPx =
      nextBodyHeight > 0
        ? (nextBodyHeight * EDITOR_PIXELS_PER_METER) / 2
        : bodyRadiusXPx

    marker.scaleX = 1
    marker.scaleY = 1
    marker.width = bodyRadiusXPx * 2
    marker.height = bodyRadiusYPx * 2

    if (body) {
      body.bodyRadiusXPx = bodyRadiusXPx
      body.bodyRadiusYPx = bodyRadiusYPx
      body.bodyColor = getCharacterBodyColor(marker.bodyProfile, nextColor)
      body.bodyFacing = nextFacing
      body.bodyProfile = marker.bodyProfile ?? null
      body.bodyTextureImage = this.getBodyTextureImage(marker.bodyProfile)
      body.width = bodyRadiusXPx * 2
      body.height = bodyRadiusYPx * 2
      body.dirty = true
    }

    marker.radius = nextRadius
    marker.bodyHeight = nextBodyHeight
    marker.color = getCharacterBodyColor(marker.bodyProfile, nextColor)
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
    weaponBackShape.weaponRenderType = this.getWeaponRenderType(weaponType)
    weaponBackShape.width = weaponBoundingWidthPx
    weaponBackShape.height = weaponBoundingHeightPx

    weaponFrontShape.weaponWidthPx = weaponWidthPx
    weaponFrontShape.weaponHeightPx = weaponHeightPx
    weaponFrontShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponFrontShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponFrontShape.weaponRenderType = this.getWeaponRenderType(weaponType)
    weaponFrontShape.width = weaponBoundingWidthPx
    weaponFrontShape.height = weaponBoundingHeightPx

    this.tempNpcPos.x = 0
    this.tempNpcPos.y = 0
    setWeaponBackTransform(
      this.tempNpcPos,
      marker.facing,
      this.tempWeaponTransform,
      marker.radius,
      weaponType,
      weaponWidthPx / EDITOR_PIXELS_PER_METER
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

  spawnNpcMarker(
    npcType: NpcType = DEFAULT_NPC_TYPE,
    spawn?: {
      x: number
      y: number
      radius?: number
      bodyHeight?: number
      bodyProfile?: MapCharacterBodyProfile
      moveSpeed?: number
      attackDesire?: number
      parryProficiency?: number
      initialPatrolMode?: NpcPatrolMode
      detectionRangeLevel?: NpcDetectionRangeLevel
      maxHealth?: number
      maxPosture?: number
      maxToughness?: number
      color?: string
      facing?: number
      initialNormalMovesetId?: NormalAttackMovesetId
      debugNoDamage?: boolean
      debugNoDeath?: boolean
      redTapeEnabled?: boolean
      retreatEnabled?: boolean
      retreatDelaySec?: number
      canBeFollower?: boolean
      equipWeapon?: boolean
      mainWeapon?: MapNpcWeapon
      secondaryWeapon?: MapNpcWeapon
      factionId?: string
      npcFactions?: string[]
      enemyFactions?: string[]
      allyFactions?: string[]
    }
  ) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
      // console.warn('[marker-manager] Fabric canvas not ready')
      return
    }
    const template =
      CHARACTER_DEFAULT_DATA[npcType] ?? CHARACTER_DEFAULT_DATA.default
    const radius = spawn?.radius ?? template.radius
    const bodyHeight = spawn?.bodyHeight ?? 0
    const bodyProfile = spawn?.bodyProfile
    const moveSpeed = spawn?.moveSpeed ?? template.moveSpeed
    const attackDesire = spawn?.attackDesire ?? template.attackDesire
    const parryProficiency =
      spawn?.parryProficiency ?? template.parryProficiency
    const initialPatrolMode =
      spawn?.initialPatrolMode ?? template.initialPatrolMode
    const detectionRangeLevel: NpcDetectionRangeLevel =
      spawn?.detectionRangeLevel ?? (npcType === 'archer' ? 'medium' : 'near')
    const maxHealth = spawn?.maxHealth ?? template.maxHealth
    const maxPosture = spawn?.maxPosture ?? template.maxPosture
    const maxToughness = spawn?.maxToughness ?? template.maxToughness
    const color = spawn?.color ?? template.color
    const resolvedColor = getCharacterBodyColor(bodyProfile, color)
    const facing = spawn?.facing ?? 1
    const initialNormalMovesetId =
      spawn?.initialNormalMovesetId ?? getDefaultNormalAttackMovesetId('npc')
    const debugNoDamage = spawn?.debugNoDamage === true
    const debugNoDeath = spawn?.debugNoDeath === true
    const redTapeEnabled = spawn?.redTapeEnabled === true
    const retreatEnabled = spawn?.retreatEnabled === true
    const retreatDelaySec = spawn?.retreatDelaySec ?? 0
    const canBeFollower = spawn?.canBeFollower === true
    const equipWeapon =
      spawn?.equipWeapon ?? !!(spawn?.mainWeapon || spawn?.secondaryWeapon)
    const factionId = spawn?.factionId ?? Faction.Enemy
    const npcFactions = spawn?.npcFactions ??
      spawn?.enemyFactions ?? [Faction.Player]
    const allyFactions = spawn?.allyFactions ?? []
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

    // Hardcoded ObjectType.Npc ('npc')
    const objectTypeNpc = 'npc' as ObjectType

    const marker = this.objectFactory.createNpcMarker(
      npcType,
      radius,
      resolvedColor,
      equipWeapon
    ) as NpcMarker
    marker.radius = radius
    marker.bodyHeight = bodyHeight
    marker.bodyProfile = bodyProfile
    marker.moveSpeed = moveSpeed
    marker.attackDesire = attackDesire
    marker.parryProficiency = parryProficiency
    marker.initialPatrolMode = initialPatrolMode
    marker.detectionRangeLevel = detectionRangeLevel
    marker.maxHealth = maxHealth
    marker.maxPosture = maxPosture
    marker.maxToughness = maxToughness
    marker.color = resolvedColor
    marker.facing = facing
    marker.initialNormalMovesetId = initialNormalMovesetId
    marker.debugNoDamage = debugNoDamage
    marker.debugNoDeath = debugNoDeath
    marker.redTapeEnabled = redTapeEnabled
    marker.retreatEnabled = retreatEnabled
    marker.retreatDelaySec = retreatDelaySec
    marker.canBeFollower = canBeFollower
    marker.equipWeapon = equipWeapon
    marker.factionId = factionId
    marker.npcFactions = npcFactions
    marker.allyFactions = allyFactions
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(objectTypeNpc, marker)
    const npcData: NpcMarkerData = {
      marker,
      npcType,
      radius,
      bodyHeight,
      bodyProfile,
      moveSpeed,
      attackDesire,
      parryProficiency,
      initialPatrolMode,
      detectionRangeLevel,
      maxHealth,
      maxPosture,
      maxToughness,
      color: resolvedColor,
      facing,
      initialNormalMovesetId,
      debugNoDamage,
      debugNoDeath,
      redTapeEnabled,
      retreatEnabled,
      retreatDelaySec,
      canBeFollower,
      equipWeapon,
      factionId,
      npcFactions,
      allyFactions,
      mainWeapon: normalizeWeaponTypeAndSizeLevel(
        spawn?.mainWeapon?.weaponType,
        spawn?.mainWeapon?.sizeLevel
      )?.weaponType,
      secondaryWeapon: normalizeWeaponTypeAndSizeLevel(
        spawn?.secondaryWeapon?.weaponType,
        spawn?.secondaryWeapon?.sizeLevel
      )?.weaponType,
    }
    this.npcMarkers.push(npcData)
    this.npcMarkerMap.set(marker, npcData)

    if (spawn?.mainWeapon) {
      this.createNpcWeaponFromConfig(
        npcData,
        spawn.mainWeapon,
        'main',
        centerX,
        centerY
      )
    }

    if (spawn?.secondaryWeapon) {
      this.createNpcWeaponFromConfig(
        npcData,
        spawn.secondaryWeapon,
        'secondary',
        centerX,
        centerY
      )
    }

    this.updateNpcMarkerVisual(
      marker,
      radius,
      bodyHeight,
      resolvedColor,
      facing
    )
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
    if (weaponType === 'hook' && this.hasWeaponType('hook')) {
      return
    }
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
    const resolvedStats = resolveWeaponStatsForSize(
      template,
      sizeLevel,
      {
        attackDamage: spawn?.attackDamage,
        postureDamage: spawn?.postureDamage,
        toughnessDamage: spawn?.toughnessDamage,
      },
      true
    )
    const bowAmmo =
      spawn?.bowAmmo ??
      (isRangedWeaponType(weaponType)
        ? getDefaultPlayerAmmoForWeaponType(weaponType)
        : undefined)

    // Hardcoded ObjectType.Weapon ('weapon')
    const ObjectTypeWeapon = 'weapon' as ObjectType

    const marker = this.objectFactory.createWeaponMarker(
      weaponType,
      category,
      sizeLevel,
      resolvedStats.attackDamage,
      resolvedStats.postureDamage,
      resolvedStats.toughnessDamage,
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
      attackDamage: resolvedStats.attackDamage,
      postureDamage: resolvedStats.postureDamage,
      toughnessDamage: resolvedStats.toughnessDamage,
      bowAmmo,
    }
    this.weaponMarkers.push(weaponData)
    this.weaponMarkerMap.set(marker, weaponData)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  spawnCheckpointMarker(spawn?: MapCheckpoint) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
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

    const ObjectTypeCheckpoint = 'checkpoint' as ObjectType

    const marker =
      this.objectFactory.createCheckpointMarker() as CheckpointMarker
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypeCheckpoint, marker)
    const checkpointData: CheckpointMarkerData = { marker }
    this.checkpointMarkers.push(checkpointData)
    this.checkpointMarkerMap.set(marker, checkpointData)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  spawnHookAnchorMarker(spawn?: MapHookAnchor) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) {
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

    const ObjectTypeHookAnchor = 'hookAnchor' as ObjectType

    const marker =
      this.objectFactory.createHookAnchorMarker() as HookAnchorMarker
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(ObjectTypeHookAnchor, marker)
    const anchorData: HookAnchorMarkerData = { marker }
    this.hookAnchorMarkers.push(anchorData)
    this.hookAnchorMarkerMap.set(marker, anchorData)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  spawnSunPickupMarker(isLarge: boolean, spawn?: { x: number; y: number }) {
    const canvas = this.ctx.getCanvas()
    if (!canvas) return
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
    const objectType = (
      isLarge ? 'sunPickupLarge' : 'sunPickupSmall'
    ) as ObjectType
    const marker = this.objectFactory.createSunPickupMarker(
      isLarge
    ) as SunPickupMarker
    marker.left = centerX
    marker.top = centerY
    marker.setCoords()
    canvas.add(marker)
    this.ctx.registerEditorObject(objectType, marker)
    const data: SunPickupMarkerData = { marker, isLarge }
    this.sunPickupMarkers.push(data)
    this.sunPickupMarkerMap.set(marker, data)
    canvas.setActiveObject(marker)
    this.ctx.handleCanvasSelection(marker)
    canvas.renderAll()
  }

  updateNpcMarkerVisual(
    marker: NpcMarker,
    nextRadius: number,
    nextBodyHeight: number,
    nextColor: string,
    nextFacing: number
  ) {
    const bodyItem = marker.item(1)
    const body = this.isCharacterBodyShapeObject(bodyItem)
      ? bodyItem
      : undefined
    const bodyRadiusXPx = this.ctx.computeNpcBodyRadiusPx(
      nextRadius,
      EDITOR_PIXELS_PER_METER
    )
    const bodyRadiusYPx =
      nextBodyHeight > 0
        ? (nextBodyHeight * EDITOR_PIXELS_PER_METER) / 2
        : bodyRadiusXPx

    marker.scaleX = 1
    marker.scaleY = 1
    marker.width = bodyRadiusXPx * 2
    marker.height = bodyRadiusYPx * 2

    if (body) {
      body.bodyRadiusXPx = bodyRadiusXPx
      body.bodyRadiusYPx = bodyRadiusYPx
      body.bodyColor = getCharacterBodyColor(marker.bodyProfile, nextColor)
      body.bodyFacing = nextFacing
      body.bodyProfile = marker.bodyProfile ?? null
      body.bodyTextureImage = this.getBodyTextureImage(marker.bodyProfile)
      body.width = bodyRadiusXPx * 2
      body.height = bodyRadiusYPx * 2
      body.dirty = true
    }

    marker.radius = nextRadius
    marker.bodyHeight = nextBodyHeight
    marker.color = getCharacterBodyColor(marker.bodyProfile, nextColor)
    marker.facing = nextFacing
    this.updateNpcWeaponVisual(marker)
    marker.setCoords()
  }

  private updateNpcWeaponVisual(marker: NpcMarker) {
    const weaponBackShape = marker.weaponBackShape
    const weaponFrontShape = marker.weaponFrontShape
    if (!weaponBackShape || !weaponFrontShape) {
      return
    }

    const npcData = this.npcMarkerMap.get(marker)
    if (!npcData || !marker.equipWeapon) {
      weaponBackShape.visible = false
      weaponFrontShape.visible = false
      return
    }

    const weaponMarker =
      npcData.mainWeaponMarker ?? npcData.secondaryWeaponMarker
    const weaponType =
      npcData.mainWeapon ?? npcData.secondaryWeapon ?? undefined

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
    weaponBackShape.weaponRenderType = this.getWeaponRenderType(weaponType)
    weaponBackShape.width = weaponBoundingWidthPx
    weaponBackShape.height = weaponBoundingHeightPx

    weaponFrontShape.weaponWidthPx = weaponWidthPx
    weaponFrontShape.weaponHeightPx = weaponHeightPx
    weaponFrontShape.weaponBoundingWidthPx = weaponBoundingWidthPx
    weaponFrontShape.weaponBoundingHeightPx = weaponBoundingHeightPx
    weaponFrontShape.weaponRenderType = this.getWeaponRenderType(weaponType)
    weaponFrontShape.width = weaponBoundingWidthPx
    weaponFrontShape.height = weaponBoundingHeightPx

    this.tempNpcPos.x = 0
    this.tempNpcPos.y = 0
    setWeaponBackTransform(
      this.tempNpcPos,
      marker.facing,
      this.tempWeaponTransform,
      marker.radius,
      weaponType,
      weaponWidthPx / EDITOR_PIXELS_PER_METER
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
    if (!this.isWeaponShapeObject(item)) {
      return
    }
    const shape = item
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
    shape.weaponRenderType = this.getWeaponRenderType(marker.weaponType)
    shape.width = dims.boundingWidthPx
    shape.height = dims.boundingHeightPx
    shape.setCoords()

    marker.sizeLevel = nextSizeLevel
    marker.width = dims.boundingWidthPx
    marker.height = dims.boundingHeightPx
    marker.setCoords()

    let updatedNpc = false
    for (let i = 0; i < this.npcMarkers.length; i++) {
      const npcData = this.npcMarkers[i]
      if (
        npcData.mainWeaponMarker === marker ||
        npcData.secondaryWeaponMarker === marker
      ) {
        this.updateNpcMarkerVisual(
          npcData.marker,
          npcData.radius,
          npcData.bodyHeight,
          npcData.color,
          npcData.facing
        )
        updatedNpc = true
      }
    }
    if (updatedNpc) {
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
        playerData.bodyHeight,
        playerData.color,
        playerData.facing
      )
      this.ctx.requestRender()
    }
  }

  private getWeaponRenderType(
    weaponType: WeaponType
  ): WeaponShape['weaponRenderType'] {
    if (weaponType === 'hook') {
      return 'hook'
    }
    if (weaponType === 'bow') {
      return 'bow'
    }
    if (weaponType === 'grape') {
      return 'grape'
    }
    if (weaponType === 'hammer') {
      return 'hammer'
    }
    if (weaponType === 'spear') {
      return 'spear'
    }
    return 'sword'
  }

  getOrCreateNpcWeaponMarker(
    npcData: NpcMarkerData,
    weaponType: WeaponType,
    slot: 'main' | 'secondary'
  ): WeaponMarker | null {
    const markerKey =
      slot === 'main' ? 'mainWeaponMarker' : 'secondaryWeaponMarker'
    const weaponKey = slot === 'main' ? 'mainWeapon' : 'secondaryWeapon'
    let weaponMarker = npcData[markerKey]

    if (weaponMarker && weaponMarker.weaponType !== weaponType) {
      this.weaponMarkerMap.delete(weaponMarker)
      weaponMarker = undefined
      npcData[markerKey] = undefined
      npcData[weaponKey] = undefined
    }

    if (!weaponMarker) {
      const template = WEAPON_DEFAULT_DATA[weaponType]
      const resolvedStats = resolveWeaponStatsForSize(
        template,
        template.sizeLevel
      )
      const result = this.objectFactory.createNpcWeaponMarkerFromConfig(
        {
          weaponType,
          sizeLevel: template.sizeLevel,
          attackDamage: resolvedStats.attackDamage,
          postureDamage: resolvedStats.postureDamage,
          toughnessDamage: resolvedStats.toughnessDamage,
          bowAmmo: isRangedWeaponType(weaponType)
            ? getDefaultNpcAmmoForWeaponType(weaponType)
            : undefined,
        },
        slot,
        npcData.marker.left ?? 0,
        npcData.marker.top ?? 0,
        WEAPON_DEFAULT_DATA
      )

      weaponMarker = result.weaponMarker as WeaponMarker
      const weaponData = result.weaponData as WeaponMarkerData
      this.weaponMarkerMap.set(weaponMarker, weaponData)
      npcData[markerKey] = weaponMarker
      npcData[weaponKey] = weaponType
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
      const resolvedStats = resolveWeaponStatsForSize(
        template,
        template.sizeLevel
      )
      const result = this.objectFactory.createNpcWeaponMarkerFromConfig(
        {
          weaponType,
          sizeLevel: template.sizeLevel,
          attackDamage: resolvedStats.attackDamage,
          postureDamage: resolvedStats.postureDamage,
          toughnessDamage: resolvedStats.toughnessDamage,
          bowAmmo: isRangedWeaponType(weaponType)
            ? getDefaultPlayerAmmoForWeaponType(weaponType)
            : undefined,
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

  private createNpcWeaponFromConfig(
    npcData: NpcMarkerData,
    config: MapNpcWeapon,
    slot: 'main' | 'secondary',
    x: number,
    y: number
  ) {
    const { weaponMarker, weaponData } =
      this.objectFactory.createNpcWeaponMarkerFromConfig(
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
      npcData.mainWeaponMarker = typedWeaponMarker
    } else {
      npcData.secondaryWeaponMarker = typedWeaponMarker
    }
  }

  private createPlayerWeaponFromConfig(
    playerData: PlayerMarkerData,
    config: MapNpcWeapon,
    slot: 'main' | 'secondary',
    x: number,
    y: number
  ) {
    const { weaponMarker, weaponData } =
      this.objectFactory.createNpcWeaponMarkerFromConfig(
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
      playerData.mainWeapon = typedWeaponData.weaponType
    } else {
      playerData.secondaryWeaponMarker = typedWeaponMarker
      playerData.secondaryWeapon = typedWeaponData.weaponType
    }
  }
}
