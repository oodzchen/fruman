import * as fabric from 'fabric'

import { DEFAULT_CAMERA_ZOOM } from '../constants'
import { normalizeNpcAttackMoves } from '../ecs/AttackMoveRegistry'
import type {
  EditorMapData,
  EditorTreeData,
  EditorTreeNode,
  EditorTreeObjectType,
  MapAttackPickup,
  MapCharacterBodyProfile,
  MapEnvironmentObject,
  MapExpOrb,
  MapNpcTemplate,
  MapSettings,
  MapSunPickup,
} from '../editorMapTypes'
import { DEFAULT_MAP_TIME_PHASE } from '../editorMapTypes'
import { cloneEnvironmentFlowerOptions } from '../environmentFlowerOptions'
import { normalizeEnvironmentKeyText } from '../environmentKeyUtils'
import {
  DEFAULT_ENVIRONMENT_SCALE_PERMILLE,
  type EnvironmentTransformOffset,
  getEnvironmentEffectiveScalePermille,
  normalizeEnvironmentRotationDeg,
  writeEnvironmentTransformedOffset,
} from '../environmentTransformUtils'
import { normalizeNpcDropListWithWeapons } from '../npcDropUtils'
import {
  getDefaultShapeRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { isEnvironmentCellStrokeSupported } from '../renderer/ProceduralEnvironmentFactory'
import { normalizeSkeletalBodyProfile } from '../skeletalBodyProfile'
import type {
  CharacterAttackSpeedLevel,
  NormalAttackMovesetId,
  WeaponType,
} from '../types'
import { normalizeWeaponTypeAndSizeLevel } from '../weaponTypeUtils'
import { computeCameraOffsetFromCenter } from './EditorCoordinateUtils'
import type { EditorMarkerManager } from './EditorMarkerManager'
import type { EditorTerrainLayerManager } from './terrain/EditorTerrainLayerManager'
import type { EditorLayeredObject, ObjectType } from './types'

interface EditorObjectLike {
  id: number
  name: string
  parentId: number | null
  type: ObjectType
  object: fabric.Object
  isLocked: boolean
  isVisible: boolean
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
  terrainManager: EditorTerrainLayerManager

  spawnCameraViewFrame: (
    camera?: EditorMapData['camera'],
    options?: { select?: boolean; render?: boolean }
  ) => void
  beginObjectBatchMutation: () => void
  endObjectBatchMutation: () => void
  renderObjectTree: () => void
  requestRenderAll: () => void
  setObjectRenderLayer: (
    object: fabric.Object,
    renderLayer: number | undefined
  ) => void
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
    attackSpeedLevel: CharacterAttackSpeedLevel
    maxComboCount: number
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

  getMapSettings: () => MapSettings
  setMapSettings: (settings: MapSettings | undefined) => void
  getFactions: () => string[]
  setFactions: (factions: string[]) => void
  getCustomNpcTemplates: () => MapNpcTemplate[]
  setCustomNpcTemplates: (templates: MapNpcTemplate[]) => void
}

export interface EditorMapSerializeOptions {
  shareTerrainData?: boolean
}

export class EditorMapSerializer {
  private ctx: EditorMapSerializerContext
  private readonly tempEnvironmentAnchorOffset: EnvironmentTransformOffset = {
    x: 0,
    y: 0,
  }

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
      version: 3,
      canvasWidth: width,
      canvasHeight: height,
      pixelsPerMeter: this.ctx.getPixelsPerMeter(),
      playerSpawn: { x: spawnX, y: spawnY },
      settings: { initialTimePhase: DEFAULT_MAP_TIME_PHASE },
      camera: { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM },
      shapes: [],
      npcs: [],
      weapons: [],
      checkpoints: [],
      hookAnchors: [],
      attackPickups: [],
      npcTemplates: [],
    }
  }

  serializeCurrentMapData(options?: EditorMapSerializeOptions): EditorMapData {
    const base = this.buildDefaultMapData()
    const playerSpawn = this.serializePlayerSpawn(base)
    const player = this.serializePlayerProperties()
    const camera = this.serializeCamera(base)
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
    const expOrbIndexMap = new Map<fabric.Object, number>()
    const expOrbs = this.serializeExpOrbs(expOrbIndexMap)
    const attackPickupIndexMap = new Map<fabric.Object, number>()
    const attackPickups = this.serializeAttackPickups(attackPickupIndexMap)
    const environmentIndexMap = new Map<fabric.Object, number>()
    const environmentObjects =
      this.serializeEnvironmentObjects(environmentIndexMap)
    const terrainIndexMap = new Map<fabric.Object, number>()
    const terrain = this.ctx.terrainManager.serialize(
      terrainIndexMap,
      this.ctx.getEditorObjects(),
      { shareData: options?.shareTerrainData === true }
    )
    const referenceLineIndexMap = new Map<fabric.Object, number>()
    const referenceLines = this.ctx.terrainManager.serializeReferenceLines(
      referenceLineIndexMap,
      this.ctx.getEditorObjects()
    )
    const editorTree = this.serializeEditorTree({
      npcIndexMap,
      weaponIndexMap,
      checkpointIndexMap,
      hookAnchorIndexMap,
      sunPickupIndexMap,
      expOrbIndexMap,
      attackPickupIndexMap,
      environmentIndexMap,
      terrainIndexMap,
      referenceLineIndexMap,
    })
    return {
      version: 3,
      canvasWidth: base.canvasWidth,
      canvasHeight: base.canvasHeight,
      pixelsPerMeter: base.pixelsPerMeter,
      playerSpawn,
      settings: this.ctx.getMapSettings(),
      player,
      camera,
      shapes: [],
      terrain,
      referenceLines,
      npcs,
      weapons,
      checkpoints,
      hookAnchors,
      sunPickups,
      expOrbs,
      attackPickups,
      environmentObjects,
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
    const prevRenderOnAddRemove = canvas.renderOnAddRemove
    const batchSpawnOptions = { select: false, render: false } as const
    const npcs = data.npcs ?? data.enemies ?? []
    canvas.renderOnAddRemove = false
    if (data.factions) {
      this.ctx.setFactions(data.factions)
    }
    this.ctx.setMapSettings(data.settings)
    this.ctx.setCustomNpcTemplates(data.npcTemplates ?? [])
    this.ctx.beginObjectBatchMutation()
    try {
      this.ctx.resizeEditorCanvas()
      this.ctx.clearEditorScene()
      this.ctx.terrainManager.applySerializedData(data.terrain)
      this.ctx.terrainManager.applySerializedReferenceLines(data.referenceLines)
      this.ctx.markerManager.spawnPlayerMarker(
        data.playerSpawn,
        data.player,
        batchSpawnOptions
      )
      this.ctx.spawnCameraViewFrame(data.camera, batchSpawnOptions)
      this.applyNpcs(npcs, batchSpawnOptions)
      this.applyWeapons(data.weapons, batchSpawnOptions)
      this.applyCheckpoints(data.checkpoints, batchSpawnOptions)
      this.applyHookAnchors(data.hookAnchors, batchSpawnOptions)
      this.applySunPickups(data.sunPickups, batchSpawnOptions)
      this.applyExpOrbs(data.expOrbs, batchSpawnOptions)
      this.applyAttackPickups(data.attackPickups, batchSpawnOptions)
      this.applyEnvironmentObjects(data.environmentObjects, batchSpawnOptions)
    } finally {
      this.ctx.endObjectBatchMutation()
      canvas.renderOnAddRemove = prevRenderOnAddRemove
    }
    this.ctx.requestRenderAll()
  }

  private applyNpcs(
    npcs: EditorMapData['npcs'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i]
      const mainWeaponType = normalizeWeaponTypeAndSizeLevel(
        npc.mainWeapon?.weaponType,
        npc.mainWeapon?.sizeLevel
      )?.weaponType
      const normalizedNpc = {
        ...npc,
        attackMoves: normalizeNpcAttackMoves(npc.attackMoves, mainWeaponType),
      }
      this.ctx.markerManager.spawnNpcMarker(
        npc.npcType,
        normalizedNpc,
        spawnOptions
      )
    }
  }

  private applyWeapons(
    weapons: EditorMapData['weapons'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
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
        },
        spawnOptions
      )
    }
  }

  private applyCheckpoints(
    checkpoints: EditorMapData['checkpoints'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!checkpoints) {
      return
    }
    for (let i = 0; i < checkpoints.length; i++) {
      this.ctx.markerManager.spawnCheckpointMarker(checkpoints[i], spawnOptions)
    }
  }

  private applyHookAnchors(
    anchors: EditorMapData['hookAnchors'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!anchors) {
      return
    }
    for (let i = 0; i < anchors.length; i++) {
      this.ctx.markerManager.spawnHookAnchorMarker(anchors[i], spawnOptions)
    }
  }

  private applySunPickups(
    pickups: EditorMapData['sunPickups'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!pickups) return
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i]
      this.ctx.markerManager.spawnSunPickupMarker(
        p.isLarge,
        { x: p.x, y: p.y },
        spawnOptions
      )
    }
  }

  private applyExpOrbs(
    expOrbs: EditorMapData['expOrbs'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!expOrbs) return
    for (let i = 0; i < expOrbs.length; i++) {
      const expOrb = expOrbs[i]
      this.ctx.markerManager.spawnExpOrbMarker(
        { x: expOrb.x, y: expOrb.y },
        spawnOptions
      )
    }
  }

  private applyAttackPickups(
    attackPickups: EditorMapData['attackPickups'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!attackPickups) return
    for (let i = 0; i < attackPickups.length; i++) {
      const pickup = attackPickups[i]
      const normalizedWeapon = normalizeWeaponTypeAndSizeLevel(
        pickup.weaponType,
        undefined
      )
      if (!normalizedWeapon) {
        continue
      }
      this.ctx.markerManager.spawnAttackPickupMarker(
        normalizedWeapon.weaponType,
        pickup.kind,
        { x: pickup.x, y: pickup.y },
        spawnOptions
      )
    }
  }

  private applyEnvironmentObjects(
    envObjects: EditorMapData['environmentObjects'],
    spawnOptions?: { select?: boolean; render?: boolean }
  ) {
    if (!envObjects) return
    for (let i = 0; i < envObjects.length; i++) {
      const obj = envObjects[i]
      const marker = this.ctx.markerManager.spawnEnvironmentMarker(
        obj.type,
        obj,
        spawnOptions
      )
      if (marker && typeof obj.renderLayer === 'number') {
        this.ctx.setObjectRenderLayer(marker, obj.renderLayer)
      }
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
      const checkpoint = markers[i]
      checkpoints.push({
        x,
        y,
        cellStroke:
          checkpoint.cellStroke === true || marker.cellStroke === true
            ? true
            : undefined,
      })
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

  private serializeExpOrbs(indexMap?: Map<fabric.Object, number>): MapExpOrb[] {
    const markers = this.ctx.markerManager.getExpOrbMarkers()
    if (markers.length === 0) return []
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const expOrbs: MapExpOrb[] = []
    for (let i = 0; i < markers.length; i++) {
      const { marker } = markers[i]
      const center = marker.getCenterPoint()
      const x = center.x * invPixelsPerMeter
      const y = center.y * invPixelsPerMeter
      if (indexMap) indexMap.set(marker, expOrbs.length)
      expOrbs.push({ x, y })
    }
    return expOrbs
  }

  private serializeAttackPickups(
    indexMap?: Map<fabric.Object, number>
  ): MapAttackPickup[] {
    const markers = this.ctx.markerManager.getAttackPickupMarkers()
    if (markers.length === 0) return []
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const attackPickups: MapAttackPickup[] = []
    for (let i = 0; i < markers.length; i++) {
      const { marker, weaponType, kind } = markers[i]
      const center = marker.getCenterPoint()
      const x = center.x * invPixelsPerMeter
      const y = center.y * invPixelsPerMeter
      if (indexMap) indexMap.set(marker, attackPickups.length)
      attackPickups.push({ x, y, weaponType, kind })
    }
    return attackPickups
  }

  private serializeEnvironmentObjects(
    indexMap?: Map<fabric.Object, number>
  ): MapEnvironmentObject[] {
    const markers = this.ctx.markerManager.getEnvironmentMarkers()
    if (markers.length === 0) return []
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    const result: MapEnvironmentObject[] = []
    for (let i = 0; i < markers.length; i++) {
      const { marker, envType, envSeed, cellStroke, flowerOptions } = markers[i]
      const center = marker.getCenterPoint()
      const rotationDeg = normalizeEnvironmentRotationDeg(marker.angle ?? 0)
      const scaleXPermille = getEnvironmentEffectiveScalePermille(
        marker.scaleXPermille,
        marker.scaleX
      )
      const scaleYPermille = getEnvironmentEffectiveScalePermille(
        marker.scaleYPermille,
        marker.scaleY
      )
      writeEnvironmentTransformedOffset(
        marker.anchorDX,
        marker.anchorDY,
        rotationDeg,
        scaleXPermille,
        scaleYPermille,
        this.tempEnvironmentAnchorOffset
      )
      const anchorX =
        (center.x + this.tempEnvironmentAnchorOffset.x) * invPixelsPerMeter
      const anchorY =
        (center.y + this.tempEnvironmentAnchorOffset.y) * invPixelsPerMeter
      if (indexMap) indexMap.set(marker, result.length)
      const envObject: MapEnvironmentObject = {
        type: envType,
        x: anchorX,
        y: anchorY,
        seed: envSeed,
        renderLayer: this.getObjectRenderLayer(marker),
      }
      if (envType === 'custom' && marker.envAssetId.length > 0) {
        envObject.assetId = marker.envAssetId
      }
      if (rotationDeg !== 0) {
        envObject.rotationDeg = rotationDeg
      }
      if (scaleXPermille !== DEFAULT_ENVIRONMENT_SCALE_PERMILLE) {
        envObject.scaleXPermille = scaleXPermille
      }
      if (scaleYPermille !== DEFAULT_ENVIRONMENT_SCALE_PERMILLE) {
        envObject.scaleYPermille = scaleYPermille
      }
      if (
        isEnvironmentCellStrokeSupported(envType) &&
        (cellStroke === true || marker.cellStroke === true)
      ) {
        envObject.cellStroke = true
      }
      if (envType === 'flower') {
        const serializedFlowerOptions = cloneEnvironmentFlowerOptions(
          flowerOptions ?? marker.flowerOptions
        )
        if (serializedFlowerOptions) {
          envObject.flowerOptions = serializedFlowerOptions
        }
      }
      if (envType === 'key') {
        envObject.keyText = normalizeEnvironmentKeyText(marker.keyText)
      }
      result.push(envObject)
    }
    return result
  }

  private serializeEditorTree(data: {
    npcIndexMap: Map<fabric.Object, number>
    weaponIndexMap: Map<fabric.Object, number>
    checkpointIndexMap: Map<fabric.Object, number>
    hookAnchorIndexMap: Map<fabric.Object, number>
    sunPickupIndexMap: Map<fabric.Object, number>
    expOrbIndexMap: Map<fabric.Object, number>
    attackPickupIndexMap: Map<fabric.Object, number>
    environmentIndexMap: Map<fabric.Object, number>
    terrainIndexMap: Map<fabric.Object, number>
    referenceLineIndexMap: Map<fabric.Object, number>
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
        renderLayer: this.getObjectRenderLayer(dataItem.object),
      }
      if (dataItem.type === 'empty') {
        node.isGroupContainer =
          (dataItem.object as Partial<{ isGroupContainer: boolean }>)
            .isGroupContainer === true
      }
      if (!dataItem.isVisible) {
        node.isVisible = false
      }
      node.isLocked = dataItem.isLocked === true
      if (dataItem.type === 'npc') {
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
      } else if (dataItem.type === 'expOrb') {
        const index = data.expOrbIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (dataItem.type === 'attackPickup') {
        const index = data.attackPickupIndexMap.get(dataItem.object)
        if (index === undefined) {
          return null
        }
        node.index = index
      } else if (
        dataItem.type === 'envTree' ||
        dataItem.type === 'envHill' ||
        dataItem.type === 'envHouse' ||
        dataItem.type === 'envCrate' ||
        dataItem.type === 'envGrass' ||
        dataItem.type === 'envFlower' ||
        dataItem.type === 'envCloud' ||
        dataItem.type === 'envKey' ||
        dataItem.type === 'envCustom'
      ) {
        const index = data.environmentIndexMap.get(dataItem.object)
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
      } else if (dataItem.type === 'referenceLine') {
        const index = data.referenceLineIndexMap.get(dataItem.object)
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
    const mainWeapon = this.ctx.markerManager.getPlayerWeaponConfig(
      data,
      'main'
    )
    const secondaryWeapon = this.ctx.markerManager.getPlayerWeaponConfig(
      data,
      'secondary'
    )

    return {
      radius: data.radius,
      bodyHeight: data.bodyHeight || undefined,
      bodyProfile: normalizeSkeletalBodyProfile(data.bodyProfile),
      moveSpeed: data.moveSpeed,
      maxHealth: data.maxHealth,
      maxPosture: data.maxPosture,
      maxToughness: data.maxToughness,
      color: data.color,
      facing: data.facing,
      initialNormalMovesetId: data.initialNormalMovesetId,
      attackSpeedLevel: data.attackSpeedLevel,
      maxComboCount: data.maxComboCount,
      debugNoDamage: data.debugNoDamage,
      debugNoDeath: data.debugNoDeath,
      mainWeapon,
      secondaryWeapon,
      factionId: data.factionId,
      npcFactions: data.npcFactions,
      allyFactions: data.allyFactions,
    }
  }

  private serializeNpcs(indexMap?: Map<fabric.Object, number>) {
    const npcs: EditorMapData['npcs'] = []
    const npcMarkers = this.ctx.markerManager.getNpcMarkers()
    const invPixelsPerMeter = this.ctx.getInvPixelsPerMeter()
    for (let i = 0; i < npcMarkers.length; i++) {
      const data = npcMarkers[i]
      const marker = data.marker

      const mainWeapon = this.ctx.markerManager.getNpcWeaponConfig(data, 'main')
      const secondaryWeapon = this.ctx.markerManager.getNpcWeaponConfig(
        data,
        'secondary'
      )

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
        bodyProfile: normalizeSkeletalBodyProfile(data.bodyProfile),
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
        attackMoves: data.attackMoves,
        attackSpeedLevel: data.attackSpeedLevel,
        maxComboCount: data.maxComboCount,
        debugNoDamage: data.debugNoDamage,
        debugNoDeath: data.debugNoDeath,
        redTapeEnabled: data.redTapeEnabled,
        retreatEnabled: data.retreatEnabled,
        retreatDelaySec: data.retreatDelaySec,
        canBeFollower: data.canBeFollower,
        equipWeapon: data.equipWeapon,
        mainWeapon,
        secondaryWeapon,
        drops: normalizeNpcDropListWithWeapons(
          data.drops,
          mainWeapon?.weaponType,
          secondaryWeapon?.weaponType
        ),
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

  private getObjectRenderLayer(object: fabric.Object): number {
    const terrainRenderLayer =
      this.ctx.terrainManager.getProxyRenderLayer(object)
    if (terrainRenderLayer !== null) {
      return normalizeRenderLayer(terrainRenderLayer, terrainRenderLayer)
    }
    return normalizeRenderLayer(
      (object as EditorLayeredObject).renderLayer,
      getDefaultShapeRenderLayer()
    )
  }
}
