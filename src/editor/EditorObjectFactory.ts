import * as fabric from 'fabric'

import {
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
} from '../constants'
import type { MapNpcWeapon, WeaponCategory } from '../editorMapTypes'
import { renderBody } from '../renderer/BodyRenderer'
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
    type: 'sword' | 'spear' | 'hammer' | 'bow' | 'grape' | 'hook',
    width: number,
    height: number,
    color: string,
    flip?: boolean
  ) => void
}

type FabricObjectOptions = Partial<fabric.FabricObjectProps>
type WeaponRenderType = 'bow' | 'grape' | 'sword' | 'spear' | 'hammer' | 'hook'

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
      objectCaching: false,
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
        objectCaching: false,
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
        objectCaching: false,
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
      objectCaching: false,
    }) as PlayerMarker
    group.editorShape = 'player-marker'
    group.weaponBackShape = weaponBackShape
    group.weaponFrontShape = weaponFrontShape
    return group
  }

  createCheckpointMarker() {
    const canopyRadiusX = this.pixelsPerMeter * 0.6
    const canopyRadiusY = this.pixelsPerMeter * 0.4
    const canopyOffsetY = -this.pixelsPerMeter * 0.35
    const trunkHeight = this.pixelsPerMeter * 0.8
    const trunkTopWidth = this.pixelsPerMeter * 0.2
    const trunkBottomWidth = this.pixelsPerMeter * 0.35

    const canopy = new fabric.Ellipse({
      rx: canopyRadiusX,
      ry: canopyRadiusY,
      fill: CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
      stroke: CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      top: canopyOffsetY,
      objectCaching: false,
    })

    const trunk = new fabric.Polygon(
      [
        { x: -trunkTopWidth, y: 0 },
        { x: trunkTopWidth, y: 0 },
        { x: trunkBottomWidth, y: trunkHeight },
        { x: -trunkBottomWidth, y: trunkHeight },
      ],
      {
        fill: CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
        stroke: CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
        strokeWidth: 1,
        originX: 'center',
        originY: 'top',
        objectCaching: false,
      }
    )

    const group = new fabric.Group([trunk, canopy], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
    }) as CheckpointMarker
    group.editorShape = 'checkpoint-marker'
    return group
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
      objectCaching: false,
    })
    const group = new fabric.Group([star], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
    }) as SunPickupMarker
    group.editorShape = 'sun-pickup-marker'
    group.isLarge = isLarge
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
      objectCaching: false,
    })

    const dot = new fabric.Circle({
      radius: dotRadius,
      fill: HOOK_ANCHOR_BORDER_COLOR,
      stroke: HOOK_ANCHOR_BORDER_COLOR,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
    })

    const group = new fabric.Group([ring, dot], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
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
    const body = this.createCharacterBodyShape(color)
    body.bodyRadiusXPx = radius
    body.bodyRadiusYPx = radius
    body.bodyColor = color
    body.bodyFacing = 1
    body.eyeColor = this.npcEyeColor
    body.width = radius * 2
    body.height = radius * 2
    const weaponBackShape = new WeaponRenderObject(
      this.renderWeapon,
      '#b4bdc7',
      {
        originX: 'center',
        originY: 'center',
        objectCaching: false,
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
        objectCaching: false,
        selectable: false,
        visible: false,
      }
    ) as WeaponShape

    const group = new fabric.Group([weaponBackShape, body, weaponFrontShape], {
      width: radius * 2,
      height: radius * 2,
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
    }) as NpcMarker
    group.editorShape = 'npc-marker'
    group.npcType = npcType
    group.color = color
    group.equipWeapon = equipWeapon
    group.weaponBackShape = weaponBackShape
    group.weaponFrontShape = weaponFrontShape
    return group
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
      objectCaching: false,
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
      objectCaching: false,
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
}
