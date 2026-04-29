import * as fabric from 'fabric'

import {
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
} from '../constants'
import type {
  MapEnvironmentObjectType,
  MapNpcWeapon,
  WeaponCategory,
} from '../editorMapTypes'
import { DEFAULT_ENVIRONMENT_SCALE_PERMILLE } from '../environmentTransformUtils'
import { renderBody } from '../renderer/BodyRenderer'
import {
  type CheckpointTreeTextureSource,
  createCheckpointTreeTextureSource,
} from '../renderer/CheckpointTreeTextureFactory'
import {
  createCustomEnvironmentTextureSource,
  createEnvironmentTextureSource,
  isEnvironmentCellStrokeSupported,
} from '../renderer/ProceduralEnvironmentFactory'
import { getSpinePreviewCanvas } from '../renderer/SpineBodyManager'
import type { NpcType, WeaponType } from '../types'
import {
  getWeaponGroundRotationRad,
  isSecondaryWeaponType,
  normalizeWeaponTypeAndSizeLevel,
} from '../weaponTypeUtils'
import { HOOK_ANCHOR_BORDER_COLOR, HOOK_ANCHOR_COLOR } from './EditorConstants'
import type {
  CharacterBodyShapeObject,
  CheckpointMarker,
  EnvironmentMarker,
  ExpOrbMarker,
  HookAnchorMarker,
  NpcMarker,
  PlayerMarker,
  SunPickupMarker,
  WeaponMarker,
} from './types'

interface WeaponTemplateLike {
  width: number
  height: number
  sizeLevel: number
}

interface WeaponRenderDimensions {
  widthPx: number
  heightPx: number
  boundingWidthPx: number
  boundingHeightPx: number
}

interface EditorObjectFactoryOptions {
  pixelsPerMeter: number
  defaultPlayerRadius: number
  playerBodyColor: string
  playerEyeColor: string
  npcEyeColor: string
  computeNpcBodyRadiusPx: (radiusMeters: number, ppm: number) => number
  computeWeaponRenderDimensions: (
    template: WeaponTemplateLike,
    sizeLevel: number,
    ppm: number,
    isBow: boolean
  ) => WeaponRenderDimensions
  renderWeapon: (
    ctx: CanvasRenderingContext2D,
    type: 'sword' | 'spear' | 'hammer' | 'bow' | 'grape' | 'hook' | 'bomb',
    width: number,
    height: number,
    color: string,
    flip?: boolean
  ) => void
}

interface EnvironmentMarkerTextureConfig {
  textureCanvas: HTMLCanvasElement
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
  anchorDX: number
  anchorDY: number
}

type FabricObjectOptions = Partial<fabric.FabricObjectProps>
type WeaponRenderType =
  | 'bow'
  | 'grape'
  | 'sword'
  | 'spear'
  | 'hammer'
  | 'hook'
  | 'bomb'

type WeaponShape = fabric.Object & {
  weaponType: WeaponType
  weaponWidthPx: number
  weaponHeightPx: number
  weaponBoundingWidthPx: number
  weaponBoundingHeightPx: number
  weaponRenderType: WeaponRenderType
}

class CharacterBodyRenderObject extends fabric.FabricObject {
  static override type = 'customCharacterBody'

  declare bodyRadiusXPx: number
  declare bodyRadiusYPx: number
  declare bodyColor: string
  declare bodyFacing: number
  declare eyeColor: string
  declare bodyProfile: CharacterBodyShapeObject['bodyProfile']
  declare bodyTextureImage: CharacterBodyShapeObject['bodyTextureImage']

  private readonly pixelsPerMeter: number

  constructor(
    pixelsPerMeter: number,
    color: string,
    options?: FabricObjectOptions
  ) {
    super(options)
    this.pixelsPerMeter = pixelsPerMeter
    this.bodyRadiusXPx = 0
    this.bodyRadiusYPx = 0
    this.bodyColor = color
    this.bodyFacing = 1
    this.eyeColor = '#000000'
    this.bodyProfile = null
    this.bodyTextureImage = null
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    renderBody(
      ctx,
      this.bodyRadiusXPx,
      this.bodyColor,
      this.pixelsPerMeter,
      this.bodyFacing,
      this.bodyRadiusYPx * 2,
      '',
      0,
      this.bodyProfile,
      this.bodyTextureImage,
      true,
      this.eyeColor
    )
  }
}

class WeaponRenderObject extends fabric.FabricObject {
  static override type = 'customWeapon'

  declare weaponType: WeaponType
  declare weaponWidthPx: number
  declare weaponHeightPx: number
  declare weaponBoundingWidthPx: number
  declare weaponBoundingHeightPx: number
  declare weaponRenderType: WeaponRenderType

  private readonly renderWeaponFn: EditorObjectFactoryOptions['renderWeapon']
  private readonly color: string

  constructor(
    renderWeaponFn: EditorObjectFactoryOptions['renderWeapon'],
    color: string,
    options?: FabricObjectOptions
  ) {
    super(options)
    this.renderWeaponFn = renderWeaponFn
    this.color = color
    this.weaponType = 'sword'
    this.weaponWidthPx = 0
    this.weaponHeightPx = 0
    this.weaponBoundingWidthPx = 0
    this.weaponBoundingHeightPx = 0
    this.weaponRenderType = 'sword'
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    this.renderWeaponFn(
      ctx,
      this.weaponRenderType,
      this.weaponWidthPx,
      this.weaponHeightPx,
      this.color,
      false
    )
  }
}

class CheckpointMarkerRenderObject extends fabric.FabricObject {
  static override type = 'customCheckpointMarker'

  declare editorShape: 'checkpoint-marker'
  declare cellStroke: boolean

  private textureCanvas: HTMLCanvasElement
  private drawOriginX: number
  private drawOriginY: number

  constructor(
    textureCanvas: HTMLCanvasElement,
    originX: number,
    originY: number,
    options?: FabricObjectOptions
  ) {
    super(options)
    this.textureCanvas = textureCanvas
    this.drawOriginX = originX
    this.drawOriginY = originY
    this.width = textureCanvas.width
    this.height = textureCanvas.height
    this.editorShape = 'checkpoint-marker'
    this.cellStroke = false
  }

  applyTextureSource(source: CheckpointTreeTextureSource): void {
    this.textureCanvas = source.canvas
    this.drawOriginX = source.originX
    this.drawOriginY = source.originY
    this.width = source.canvas.width
    this.height = source.canvas.height
    this.dirty = true
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.textureCanvas, -this.drawOriginX, -this.drawOriginY)
  }
}

class EnvironmentMarkerRenderObject extends fabric.FabricObject {
  static override type = 'customEnvironmentMarker'

  declare editorShape: EnvironmentMarker['editorShape']
  declare envType: EnvironmentMarker['envType']
  declare envSeed: EnvironmentMarker['envSeed']
  declare envAssetId: EnvironmentMarker['envAssetId']
  declare anchorDX: EnvironmentMarker['anchorDX']
  declare anchorDY: EnvironmentMarker['anchorDY']
  declare scaleXPermille: EnvironmentMarker['scaleXPermille']
  declare scaleYPermille: EnvironmentMarker['scaleYPermille']
  declare cellStroke: EnvironmentMarker['cellStroke']

  private textureCanvas: HTMLCanvasElement
  private drawOffsetX: number
  private drawOffsetY: number

  constructor(
    config: EnvironmentMarkerTextureConfig,
    options?: FabricObjectOptions
  ) {
    super(options)
    this.editorShape = 'environment-marker'
    this.envAssetId = ''
    this.textureCanvas = config.textureCanvas
    this.drawOffsetX = 0
    this.drawOffsetY = 0
    this.anchorDX = config.anchorDX
    this.anchorDY = config.anchorDY
    this.scaleXPermille = DEFAULT_ENVIRONMENT_SCALE_PERMILLE
    this.scaleYPermille = DEFAULT_ENVIRONMENT_SCALE_PERMILLE
    this.cellStroke = false
    this.applyTextureConfig(config)
  }

  applyTextureConfig(config: EnvironmentMarkerTextureConfig): void {
    this.textureCanvas = config.textureCanvas
    this.width = config.boundsWidth
    this.height = config.boundsHeight
    this.drawOffsetX = -(config.boundsWidth / 2) - config.boundsX
    this.drawOffsetY = -(config.boundsHeight / 2) - config.boundsY
    this.anchorDX = config.anchorDX
    this.anchorDY = config.anchorDY
    this.dirty = true
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.textureCanvas, this.drawOffsetX, this.drawOffsetY)
  }
}

class NpcMarkerRenderObject extends fabric.FabricObject {
  static override type = 'customNpcMarker'

  declare editorShape: NpcMarker['editorShape']
  declare npcType: NpcMarker['npcType']
  declare radius: NpcMarker['radius']
  declare bodyHeight: NpcMarker['bodyHeight']
  declare bodyProfile: NpcMarker['bodyProfile']
  declare moveSpeed: NpcMarker['moveSpeed']
  declare attackDesire: NpcMarker['attackDesire']
  declare parryProficiency: NpcMarker['parryProficiency']
  declare initialPatrolMode: NpcMarker['initialPatrolMode']
  declare detectionRangeLevel: NpcMarker['detectionRangeLevel']
  declare maxHealth: NpcMarker['maxHealth']
  declare maxPosture: NpcMarker['maxPosture']
  declare maxToughness: NpcMarker['maxToughness']
  declare color: NpcMarker['color']
  declare facing: NpcMarker['facing']
  declare initialNormalMovesetId: NpcMarker['initialNormalMovesetId']
  declare debugNoDamage: NpcMarker['debugNoDamage']
  declare debugNoDeath: NpcMarker['debugNoDeath']
  declare redTapeEnabled: NpcMarker['redTapeEnabled']
  declare retreatEnabled: NpcMarker['retreatEnabled']
  declare retreatDelaySec: NpcMarker['retreatDelaySec']
  declare canBeFollower: NpcMarker['canBeFollower']
  declare equipWeapon: NpcMarker['equipWeapon']
  declare factionId: NpcMarker['factionId']
  declare npcFactions: NpcMarker['npcFactions']
  declare allyFactions: NpcMarker['allyFactions']
  declare drops: NpcMarker['drops']
  declare mainWeapon: NpcMarker['mainWeapon']
  declare secondaryWeapon: NpcMarker['secondaryWeapon']
  declare bodyRadiusXPx: NpcMarker['bodyRadiusXPx']
  declare bodyRadiusYPx: NpcMarker['bodyRadiusYPx']
  declare bodyTextureImage: NpcMarker['bodyTextureImage']
  declare eyeColor: NpcMarker['eyeColor']
  declare weaponVisible: NpcMarker['weaponVisible']
  declare weaponWidthPx: NpcMarker['weaponWidthPx']
  declare weaponHeightPx: NpcMarker['weaponHeightPx']
  declare weaponBoundingWidthPx: NpcMarker['weaponBoundingWidthPx']
  declare weaponBoundingHeightPx: NpcMarker['weaponBoundingHeightPx']
  declare weaponRenderType: NpcMarker['weaponRenderType']
  declare weaponLeft: NpcMarker['weaponLeft']
  declare weaponTop: NpcMarker['weaponTop']
  declare weaponAngle: NpcMarker['weaponAngle']
  declare weaponDrawBehind: NpcMarker['weaponDrawBehind']

  private readonly pixelsPerMeter: number
  private readonly renderWeaponFn: EditorObjectFactoryOptions['renderWeapon']

  constructor(
    pixelsPerMeter: number,
    renderWeaponFn: EditorObjectFactoryOptions['renderWeapon'],
    eyeColor: string,
    options?: FabricObjectOptions
  ) {
    super(options)
    this.pixelsPerMeter = pixelsPerMeter
    this.renderWeaponFn = renderWeaponFn
    this.editorShape = 'npc-marker'
    this.npcType = 'default'
    this.radius = 0
    this.bodyHeight = 0
    this.bodyProfile = undefined
    this.moveSpeed = 0
    this.attackDesire = 0
    this.parryProficiency = 0
    this.initialPatrolMode = '' as NpcMarker['initialPatrolMode']
    this.detectionRangeLevel = 'near'
    this.maxHealth = 0
    this.maxPosture = 0
    this.maxToughness = 0
    this.color = '#000000'
    this.facing = 1
    this.initialNormalMovesetId = '' as NpcMarker['initialNormalMovesetId']
    this.debugNoDamage = false
    this.debugNoDeath = false
    this.redTapeEnabled = false
    this.retreatEnabled = false
    this.retreatDelaySec = 0
    this.canBeFollower = false
    this.equipWeapon = false
    this.factionId = ''
    this.npcFactions = []
    this.allyFactions = []
    this.drops = []
    this.mainWeapon = undefined
    this.secondaryWeapon = undefined
    this.bodyRadiusXPx = 0
    this.bodyRadiusYPx = 0
    this.bodyTextureImage = null
    this.eyeColor = eyeColor
    this.weaponVisible = false
    this.weaponWidthPx = 0
    this.weaponHeightPx = 0
    this.weaponBoundingWidthPx = 0
    this.weaponBoundingHeightPx = 0
    this.weaponRenderType = 'sword'
    this.weaponLeft = 0
    this.weaponTop = 0
    this.weaponAngle = 0
    this.weaponDrawBehind = false
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const spineKey = this.bodyProfile?.spineKey
    if (spineKey) {
      const preview = getSpinePreviewCanvas(spineKey)
      if (preview) {
        ctx.drawImage(preview, -(preview.width >> 1), -(preview.height >> 1))
        return
      }
    }
    if (this.weaponVisible && this.weaponDrawBehind) {
      this.renderEquippedWeapon(ctx)
    }
    renderBody(
      ctx,
      this.bodyRadiusXPx,
      this.color,
      this.pixelsPerMeter,
      this.facing,
      this.bodyRadiusYPx * 2,
      '',
      0,
      this.bodyProfile ?? null,
      this.bodyTextureImage,
      true,
      this.eyeColor
    )
    if (this.weaponVisible && !this.weaponDrawBehind) {
      this.renderEquippedWeapon(ctx)
    }
  }

  override _getCacheCanvasDimensions() {
    const dims = super._getCacheCanvasDimensions()
    const renderWidthPx = this.getRenderWidthPx()
    const renderHeightPx = this.getRenderHeightPx()
    const bodyWidthPx = this.bodyRadiusXPx * 2
    const bodyHeightPx = this.bodyRadiusYPx * 2

    if (renderWidthPx <= bodyWidthPx && renderHeightPx <= bodyHeightPx) {
      return dims
    }

    const objectScale = this.getTotalObjectScaling()
    const widthPadding = dims.width - Math.ceil(dims.x)
    const heightPadding = dims.height - Math.ceil(dims.y)
    const neededX = (renderWidthPx * objectScale.x) / this.scaleX
    const neededY = (renderHeightPx * objectScale.y) / this.scaleY

    if (neededX > dims.x) {
      dims.x = neededX
      dims.width = Math.ceil(neededX) + widthPadding
    }
    if (neededY > dims.y) {
      dims.y = neededY
      dims.height = Math.ceil(neededY) + heightPadding
    }

    return dims
  }

  private renderEquippedWeapon(ctx: CanvasRenderingContext2D): void {
    ctx.save()
    ctx.translate(this.weaponLeft, this.weaponTop)
    ctx.rotate((this.weaponAngle * Math.PI) / 180)
    this.renderWeaponFn(
      ctx,
      this.weaponRenderType,
      this.weaponWidthPx,
      this.weaponHeightPx,
      '#b4bdc7',
      false
    )
    ctx.restore()
  }

  private getRenderWidthPx(): number {
    let halfWidthPx = this.bodyRadiusXPx
    const spineKey = this.bodyProfile?.spineKey
    if (spineKey) {
      const preview = getSpinePreviewCanvas(spineKey)
      if (preview) {
        halfWidthPx = Math.max(halfWidthPx, Math.ceil(preview.width / 2))
      }
    }
    if (this.weaponVisible) {
      halfWidthPx = Math.max(
        halfWidthPx,
        Math.abs(this.weaponLeft) + Math.round(this.weaponBoundingWidthPx / 2)
      )
    }
    return halfWidthPx * 2
  }

  private getRenderHeightPx(): number {
    let halfHeightPx = this.bodyRadiusYPx
    const spineKey = this.bodyProfile?.spineKey
    if (spineKey) {
      const preview = getSpinePreviewCanvas(spineKey)
      if (preview) {
        halfHeightPx = Math.max(halfHeightPx, Math.ceil(preview.height / 2))
      }
    }
    if (this.weaponVisible) {
      halfHeightPx = Math.max(
        halfHeightPx,
        Math.abs(this.weaponTop) + Math.round(this.weaponBoundingHeightPx / 2)
      )
    }
    return halfHeightPx * 2
  }
}

export class EditorObjectFactory {
  private pixelsPerMeter: number
  private defaultPlayerRadius: number
  private playerBodyColor: string
  private playerEyeColor: string
  private npcEyeColor: string
  private computeNpcBodyRadiusPx: (radiusMeters: number, ppm: number) => number
  private computeWeaponRenderDimensions: (
    template: WeaponTemplateLike,
    sizeLevel: number,
    ppm: number,
    isBow: boolean
  ) => WeaponRenderDimensions
  private renderWeapon: EditorObjectFactoryOptions['renderWeapon']

  constructor(options: EditorObjectFactoryOptions) {
    this.pixelsPerMeter = options.pixelsPerMeter
    this.defaultPlayerRadius = options.defaultPlayerRadius
    this.playerBodyColor = options.playerBodyColor
    this.playerEyeColor = options.playerEyeColor
    this.npcEyeColor = options.npcEyeColor
    this.computeNpcBodyRadiusPx = options.computeNpcBodyRadiusPx
    this.computeWeaponRenderDimensions = options.computeWeaponRenderDimensions
    this.renderWeapon = options.renderWeapon
  }

  private createCharacterBodyShape(color: string): CharacterBodyShapeObject {
    return new CharacterBodyRenderObject(this.pixelsPerMeter, color, {
      originX: 'center',
      originY: 'center',
      objectCaching: true,
      selectable: false,
    }) as CharacterBodyShapeObject
  }

  createPlayerMarker() {
    const radius = this.defaultPlayerRadius * this.pixelsPerMeter
    const body = this.createCharacterBodyShape(this.playerBodyColor)
    body.bodyRadiusXPx = radius
    body.bodyRadiusYPx = radius
    body.bodyColor = this.playerBodyColor
    body.bodyFacing = 1
    body.eyeColor = this.playerEyeColor
    body.width = radius * 2
    body.height = radius * 2
    const weaponBackShape = new WeaponRenderObject(
      this.renderWeapon,
      '#b4bdc7',
      {
        originX: 'center',
        originY: 'center',
        objectCaching: true,
        selectable: false,
        visible: false,
      }
    ) as WeaponShape

    const weaponFrontShape = new WeaponRenderObject(
      this.renderWeapon,
      '#b4bdc7',
      {
        originX: 'center',
        originY: 'center',
        objectCaching: true,
        selectable: false,
        visible: false,
      }
    ) as WeaponShape

    const group = new fabric.Group([weaponBackShape, body, weaponFrontShape], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: true,
    }) as PlayerMarker
    group.editorShape = 'player-marker'
    group.weaponBackShape = weaponBackShape
    group.weaponFrontShape = weaponFrontShape
    return group
  }

  createCheckpointMarker(cellStroke = false) {
    const source = createCheckpointTreeTextureSource({
      radiusPx: this.pixelsPerMeter,
      leafColor: CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
      trunkColor: CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
      glow: false,
      cellStroke,
    })

    const marker = new CheckpointMarkerRenderObject(
      source.canvas,
      source.originX,
      source.originY,
      {
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: false,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        objectCaching: true,
      }
    ) as CheckpointMarker
    marker.cellStroke = cellStroke
    return marker
  }

  refreshCheckpointMarkerTexture(marker: CheckpointMarker): void {
    const source = createCheckpointTreeTextureSource({
      radiusPx: this.pixelsPerMeter,
      leafColor: CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
      trunkColor: CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
      glow: false,
      cellStroke: marker.cellStroke === true,
    })
    ;(marker as CheckpointMarkerRenderObject).applyTextureSource(source)
  }

  createSunPickupMarker(isLarge: boolean) {
    const baseRadius = Math.round((this.pixelsPerMeter * 20) / 100)
    const radius = isLarge ? baseRadius * 2 : baseRadius
    const rays = 8
    const outerR = radius
    const innerR = radius * 0.6
    const step = Math.PI / rays
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < rays * 2; i++) {
      const angle = i * step - Math.PI / 2
      const r = i % 2 === 0 ? outerR : innerR
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r })
    }
    const star = new fabric.Polygon(points, {
      fill: '#ffd700',
      stroke: isLarge ? '#c8a800' : 'transparent',
      strokeWidth: isLarge ? 1 : 0,
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    })
    const group = new fabric.Group([star], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: true,
    }) as SunPickupMarker
    group.editorShape = 'sun-pickup-marker'
    group.isLarge = isLarge
    return group
  }

  createExpOrbMarker() {
    const outerRadius = Math.max(
      4,
      Math.round((this.pixelsPerMeter * 16) / 100)
    )
    const coreRadius = Math.max(2, Math.round((outerRadius * 5) / 8))

    const glow = new fabric.Circle({
      radius: outerRadius,
      fill: 'rgba(61,127,255,0.2)',
      stroke: 'rgba(255,255,255,0.35)',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    })

    const core = new fabric.Circle({
      radius: coreRadius,
      fill: '#3d7fff',
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    })

    const group = new fabric.Group([glow, core], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: true,
    }) as ExpOrbMarker
    group.editorShape = 'exp-orb-marker'
    return group
  }

  createHookAnchorMarker() {
    const radius = Math.round((this.pixelsPerMeter * 28) / 100)
    const strokeWidth = Math.max(2, Math.round(radius * 0.18))
    const dotRadius = Math.max(2, Math.round(radius * 0.18))

    const ring = new fabric.Circle({
      radius,
      fill: 'transparent',
      stroke: HOOK_ANCHOR_COLOR,
      strokeWidth,
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    })

    const dot = new fabric.Circle({
      radius: dotRadius,
      fill: HOOK_ANCHOR_BORDER_COLOR,
      stroke: HOOK_ANCHOR_BORDER_COLOR,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    })

    const group = new fabric.Group([ring, dot], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: true,
    }) as HookAnchorMarker
    group.editorShape = 'hook-anchor-marker'
    return group
  }

  createNpcMarker(
    npcType: NpcType,
    radiusMeters: number,
    color: string,
    equipWeapon: boolean
  ) {
    const radius = this.computeNpcBodyRadiusPx(
      radiusMeters,
      this.pixelsPerMeter
    )
    const marker = new NpcMarkerRenderObject(
      this.pixelsPerMeter,
      this.renderWeapon,
      this.npcEyeColor,
      {
        width: radius * 2,
        height: radius * 2,
        strokeWidth: 0,
        originX: 'center',
        originY: 'center',
        selectable: true,
        hasControls: false,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        objectCaching: true,
      }
    ) as unknown as NpcMarker
    marker.editorShape = 'npc-marker'
    marker.npcType = npcType
    marker.color = color
    marker.equipWeapon = equipWeapon
    marker.bodyRadiusXPx = radius
    marker.bodyRadiusYPx = radius
    marker.eyeColor = this.npcEyeColor
    marker.attackMoves = []
    return marker
  }

  createWeaponMarker(
    weaponType: WeaponType,
    category: WeaponCategory,
    sizeLevel: number,
    attackDamage: number,
    postureDamage: number,
    toughnessDamage: number,
    bowAmmo: number | undefined,
    template: WeaponTemplateLike
  ) {
    const color = '#b4bdc7'
    const isBow = weaponType === 'bow'
    const dims = this.computeWeaponRenderDimensions(
      template,
      sizeLevel,
      this.pixelsPerMeter,
      isBow
    )
    if (weaponType === 'spear') {
      dims.widthPx *= 0.5
      dims.heightPx *= 0.5
      dims.boundingWidthPx *= 0.5
      dims.boundingHeightPx *= 0.5
    }
    const renderType: WeaponShape['weaponRenderType'] =
      weaponType === 'hook'
        ? 'hook'
        : weaponType === 'grape'
          ? 'grape'
          : weaponType === 'bomb'
            ? 'bomb'
            : isBow
              ? 'bow'
              : weaponType === 'hammer'
                ? 'hammer'
                : weaponType === 'spear'
                  ? 'spear'
                  : 'sword'
    const weaponShape = new WeaponRenderObject(this.renderWeapon, color, {
      originX: 'center',
      originY: 'center',
      objectCaching: true,
    }) as WeaponShape
    weaponShape.weaponType = weaponType
    weaponShape.weaponWidthPx = dims.widthPx
    weaponShape.weaponHeightPx = dims.heightPx
    weaponShape.weaponBoundingWidthPx = dims.boundingWidthPx
    weaponShape.weaponBoundingHeightPx = dims.boundingHeightPx
    weaponShape.weaponRenderType = renderType
    weaponShape.width = weaponShape.weaponBoundingWidthPx
    weaponShape.height = weaponShape.weaponBoundingHeightPx

    const group = new fabric.Group([weaponShape], {
      originX: 'center',
      originY: 'center',
      angle: Math.round(
        (getWeaponGroundRotationRad(weaponType) * 180) / Math.PI
      ),
      selectable: true,
      hasControls: false,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: true,
    }) as WeaponMarker
    group.editorShape = 'weapon-marker'
    group.weaponType = weaponType
    group.category = category
    group.sizeLevel = sizeLevel
    group.attackDamage = attackDamage
    group.postureDamage = postureDamage
    group.toughnessDamage = toughnessDamage
    group.bowAmmo = bowAmmo
    return group
  }

  createNpcWeaponMarkerFromConfig(
    config: MapNpcWeapon,
    slot: 'main' | 'secondary',
    x: number,
    y: number,
    templates: Record<WeaponType, WeaponTemplateLike>
  ) {
    const normalizedConfig = normalizeWeaponTypeAndSizeLevel(
      config.weaponType,
      config.sizeLevel
    )
    if (!normalizedConfig) {
      throw new Error(`Unsupported weapon type: ${config.weaponType}`)
    }
    const weaponType = normalizedConfig.weaponType
    const isBow = weaponType === 'bow'
    const category: WeaponCategory =
      weaponType === 'hook'
        ? 'item'
        : isSecondaryWeaponType(weaponType)
          ? 'secondary'
          : 'main'
    const template = templates[weaponType]
    const dims = this.computeWeaponRenderDimensions(
      template,
      normalizedConfig.sizeLevel,
      this.pixelsPerMeter,
      isBow
    )

    const weaponShape = Object.assign(
      new fabric.Rect({
        width: dims.boundingWidthPx,
        height: dims.boundingHeightPx,
        fill: 'transparent',
        stroke: 'transparent',
        strokeWidth: 0,
      }),
      {
        weaponWidthPx: dims.widthPx,
        weaponHeightPx: dims.heightPx,
        weaponBoundingWidthPx: dims.boundingWidthPx,
        weaponBoundingHeightPx: dims.boundingHeightPx,
        weaponRenderType:
          weaponType === 'hook'
            ? 'hook'
            : weaponType === 'grape'
              ? 'grape'
              : weaponType === 'bomb'
                ? 'bomb'
                : isBow
                  ? 'bow'
                  : weaponType === 'hammer'
                    ? 'hammer'
                    : weaponType === 'spear'
                      ? 'spear'
                      : 'sword',
      }
    ) as fabric.Rect & WeaponShape

    const weaponMarker = new fabric.Group([weaponShape], {
      left: x,
      top: y,
      selectable: false,
      visible: false,
    })
    ;(weaponMarker as fabric.Group & { weaponType: WeaponType }).weaponType =
      weaponType
    ;(weaponMarker as fabric.Group & { sizeLevel: number }).sizeLevel =
      normalizedConfig.sizeLevel
    ;(weaponMarker as fabric.Group & { category: WeaponCategory }).category =
      category

    const weaponData = {
      marker: weaponMarker,
      weaponType,
      category,
      sizeLevel: config.sizeLevel,
      attackDamage: config.attackDamage,
      postureDamage: config.postureDamage,
      toughnessDamage: config.toughnessDamage,
      bowAmmo: config.bowAmmo,
    }

    return { weaponMarker, weaponData, weaponType, category, slot }
  }

  createEnvironmentMarker(
    envType: MapEnvironmentObjectType,
    envSeed: number,
    envAssetId = '',
    cellStroke = false
  ) {
    return this.createEnvironmentMarkerWithScale(
      envType,
      envSeed,
      DEFAULT_ENVIRONMENT_SCALE_PERMILLE,
      DEFAULT_ENVIRONMENT_SCALE_PERMILLE,
      envAssetId,
      cellStroke
    )
  }

  createEnvironmentMarkerWithScale(
    envType: MapEnvironmentObjectType,
    envSeed: number,
    scaleXPermille: number,
    scaleYPermille: number,
    envAssetId = '',
    cellStroke = false
  ) {
    const drawCellStroke =
      isEnvironmentCellStrokeSupported(envType) && cellStroke
    const textureConfig = this.buildEnvironmentMarkerTextureConfig(
      envType,
      envSeed,
      scaleXPermille,
      scaleYPermille,
      envAssetId,
      drawCellStroke
    )
    const marker = new EnvironmentMarkerRenderObject(textureConfig, {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: true,
      lockRotation: false,
      lockScalingX: false,
      lockScalingY: false,
      lockScalingFlip: true,
      objectCaching: false,
    }) as EnvironmentMarker
    marker.envType = envType
    marker.envSeed = envSeed
    marker.envAssetId = envAssetId
    marker.scaleXPermille = scaleXPermille
    marker.scaleYPermille = scaleYPermille
    marker.cellStroke = drawCellStroke
    marker.scaleX = 1
    marker.scaleY = 1
    return marker
  }

  refreshEnvironmentMarkerTexture(
    marker: EnvironmentMarker,
    scaleXPermille: number,
    scaleYPermille: number
  ): void {
    const textureConfig = this.buildEnvironmentMarkerTextureConfig(
      marker.envType,
      marker.envSeed,
      scaleXPermille,
      scaleYPermille,
      marker.envAssetId,
      marker.cellStroke === true
    )
    ;(marker as EnvironmentMarkerRenderObject).applyTextureConfig(textureConfig)
    marker.scaleXPermille = scaleXPermille
    marker.scaleYPermille = scaleYPermille
    marker.scaleX = 1
    marker.scaleY = 1
  }

  private buildEnvironmentMarkerTextureConfig(
    envType: MapEnvironmentObjectType,
    envSeed: number,
    scaleXPermille: number,
    scaleYPermille: number,
    envAssetId = '',
    cellStroke = false
  ): EnvironmentMarkerTextureConfig {
    const source =
      envType === 'custom'
        ? createCustomEnvironmentTextureSource(
            envAssetId,
            this.pixelsPerMeter,
            scaleXPermille,
            scaleYPermille
          )
        : createEnvironmentTextureSource(
            envType,
            envSeed,
            this.pixelsPerMeter,
            scaleXPermille,
            scaleYPermille,
            cellStroke
          )
    return {
      textureCanvas: source.canvas,
      boundsX: source.boundsX,
      boundsY: source.boundsY,
      boundsWidth: source.boundsWidth,
      boundsHeight: source.boundsHeight,
      anchorDX: source.originX - (source.boundsX + source.boundsWidth / 2),
      anchorDY: source.originY - (source.boundsY + source.boundsHeight / 2),
    }
  }
}
