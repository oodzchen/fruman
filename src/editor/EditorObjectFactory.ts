import { fabric } from 'fabric'

import {
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
} from '../constants'
import type { MapEnemyWeapon, WeaponCategory } from '../editorMapTypes'
import { renderBody } from '../renderer/BodyRenderer'
import type { WeaponType } from '../types'
import {
  getWeaponGroundRotationRad,
  isSecondaryWeaponType,
  normalizeWeaponTypeAndSizeLevel,
} from '../weaponTypeUtils'
import { HOOK_ANCHOR_BORDER_COLOR, HOOK_ANCHOR_COLOR } from './EditorConstants'
import type { CharacterBodyShapeObject } from './types'

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
  enemyEyeColor: string
  computeEnemyBodyRadiusPx: (radiusMeters: number, ppm: number) => number
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

type WeaponShape = fabric.Object & {
  weaponType: WeaponType
  weaponWidthPx: number
  weaponHeightPx: number
  weaponBoundingWidthPx: number
  weaponBoundingHeightPx: number
  weaponRenderType: 'bow' | 'grape' | 'sword' | 'spear' | 'hammer' | 'hook'
}

export class EditorObjectFactory {
  private pixelsPerMeter: number
  private defaultPlayerRadius: number
  private playerBodyColor: string
  private playerEyeColor: string
  private enemyEyeColor: string
  private computeEnemyBodyRadiusPx: (
    radiusMeters: number,
    ppm: number
  ) => number
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
    this.enemyEyeColor = options.enemyEyeColor
    this.computeEnemyBodyRadiusPx = options.computeEnemyBodyRadiusPx
    this.computeWeaponRenderDimensions = options.computeWeaponRenderDimensions
    this.renderWeapon = options.renderWeapon
  }

  private createCharacterBodyShape(color: string): CharacterBodyShapeObject {
    const pixelsPerMeter = this.pixelsPerMeter
    const bodyShapeClass = fabric.util.createClass(fabric.Object, {
      type: 'customCharacterBody',
      bodyRadiusXPx: 0,
      bodyRadiusYPx: 0,
      bodyColor: color,
      bodyFacing: 1,
      eyeColor: '#000000',
      bodyProfile: null,
      bodyTextureImage: null,
      initialize(options?: fabric.IObjectOptions) {
        this.callSuper('initialize', options)
      },
      _render(ctx: CanvasRenderingContext2D) {
        const self = this as CharacterBodyShapeObject
        renderBody(
          ctx,
          self.bodyRadiusXPx,
          self.bodyColor,
          pixelsPerMeter,
          self.bodyFacing,
          self.bodyRadiusYPx * 2,
          '',
          0,
          self.bodyProfile,
          self.bodyTextureImage,
          true,
          self.eyeColor
        )
      },
    })

    return new bodyShapeClass({
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
    const renderWeapon = this.renderWeapon
    const weaponShapeClass = fabric.util.createClass(fabric.Object, {
      type: 'customPlayerWeapon',
      weaponWidthPx: 0,
      weaponHeightPx: 0,
      weaponBoundingWidthPx: 0,
      weaponBoundingHeightPx: 0,
      weaponRenderType: 'sword',
      _render(ctx: CanvasRenderingContext2D) {
        const self = this as WeaponShape
        renderWeapon(
          ctx,
          self.weaponRenderType,
          self.weaponWidthPx,
          self.weaponHeightPx,
          '#b4bdc7',
          false
        )
      },
    })

    const weaponBackShape = new weaponShapeClass({
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      selectable: false,
      visible: false,
    }) as WeaponShape

    const weaponFrontShape = new weaponShapeClass({
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      selectable: false,
      visible: false,
    }) as WeaponShape

    const group = new fabric.Group([weaponBackShape, body, weaponFrontShape], {
      originX: 'center',
      originY: 'center',
      selectable: true,
      hasControls: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
    })
    ;(group as unknown as { editorShape: string }).editorShape = 'player-marker'
    ;(group as unknown as { weaponBackShape: WeaponShape }).weaponBackShape =
      weaponBackShape
    ;(group as unknown as { weaponFrontShape: WeaponShape }).weaponFrontShape =
      weaponFrontShape
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
    })
    ;(group as unknown as { editorShape: string }).editorShape =
      'checkpoint-marker'
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
    })
    ;(
      group as unknown as { editorShape: string; isLarge: boolean }
    ).editorShape = 'sun-pickup-marker'
    ;(group as unknown as { editorShape: string; isLarge: boolean }).isLarge =
      isLarge
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
    })
    ;(group as unknown as { editorShape: string }).editorShape =
      'hook-anchor-marker'
    return group
  }

  createEnemyMarker(
    enemyType: string,
    radiusMeters: number,
    color: string,
    equipWeapon: boolean
  ) {
    const radius = this.computeEnemyBodyRadiusPx(
      radiusMeters,
      this.pixelsPerMeter
    )
    const body = this.createCharacterBodyShape(color)
    body.bodyRadiusXPx = radius
    body.bodyRadiusYPx = radius
    body.bodyColor = color
    body.bodyFacing = 1
    body.eyeColor = this.enemyEyeColor
    body.width = radius * 2
    body.height = radius * 2
    const renderWeapon = this.renderWeapon
    const weaponShapeClass = fabric.util.createClass(fabric.Object, {
      type: 'customEnemyWeapon',
      weaponWidthPx: 0,
      weaponHeightPx: 0,
      weaponBoundingWidthPx: 0,
      weaponBoundingHeightPx: 0,
      weaponRenderType: 'sword',
      _render(ctx: CanvasRenderingContext2D) {
        const self = this as WeaponShape
        renderWeapon(
          ctx,
          self.weaponRenderType,
          self.weaponWidthPx,
          self.weaponHeightPx,
          '#b4bdc7',
          false
        )
      },
    })

    const weaponBackShape = new weaponShapeClass({
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      selectable: false,
      visible: false,
    }) as WeaponShape

    const weaponFrontShape = new weaponShapeClass({
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      selectable: false,
      visible: false,
    }) as WeaponShape

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
    })
    ;(group as unknown as { editorShape: string }).editorShape = 'enemy-marker'
    ;(group as unknown as { enemyType: string }).enemyType = enemyType
    ;(group as unknown as { color: string }).color = color
    ;(group as unknown as { equipWeapon: boolean }).equipWeapon = equipWeapon
    ;(group as unknown as { weaponBackShape: WeaponShape }).weaponBackShape =
      weaponBackShape
    ;(group as unknown as { weaponFrontShape: WeaponShape }).weaponFrontShape =
      weaponFrontShape
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
    const renderWeapon = this.renderWeapon

    const weaponShape = new (fabric.util.createClass(fabric.Object, {
      type: 'customWeapon',
      weaponType,
      weaponWidthPx: dims.widthPx,
      weaponHeightPx: dims.heightPx,
      weaponBoundingWidthPx: dims.boundingWidthPx,
      weaponBoundingHeightPx: dims.boundingHeightPx,
      weaponRenderType: renderType,
      initialize(options?: fabric.IObjectOptions) {
        this.callSuper('initialize', options)
        const self = this as WeaponShape
        self.width = self.weaponBoundingWidthPx
        self.height = self.weaponBoundingHeightPx
        this.weaponType = weaponType
      },
      _render(ctx: CanvasRenderingContext2D) {
        const self = this as WeaponShape
        renderWeapon(
          ctx,
          self.weaponRenderType,
          self.weaponWidthPx,
          self.weaponHeightPx,
          color,
          false
        )
      },
    }))({
      originX: 'center',
      originY: 'center',
      objectCaching: false,
    }) as WeaponShape

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
    })
    ;(group as unknown as { editorShape: string }).editorShape = 'weapon-marker'
    ;(group as unknown as { weaponType: WeaponType }).weaponType = weaponType
    ;(group as unknown as { category: WeaponCategory }).category = category
    ;(group as unknown as { sizeLevel: number }).sizeLevel = sizeLevel
    ;(group as unknown as { attackDamage: number }).attackDamage = attackDamage
    ;(group as unknown as { postureDamage: number }).postureDamage =
      postureDamage
    ;(group as unknown as { toughnessDamage: number }).toughnessDamage =
      toughnessDamage
    ;(group as unknown as { bowAmmo?: number }).bowAmmo = bowAmmo
    return group
  }

  createEnemyWeaponMarkerFromConfig(
    config: MapEnemyWeapon,
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

    const weaponShape = new fabric.Rect({
      width: dims.boundingWidthPx,
      height: dims.boundingHeightPx,
      fill: 'transparent',
      stroke: 'transparent',
      strokeWidth: 0,
    }) as unknown as WeaponShape

    weaponShape.weaponWidthPx = dims.widthPx
    weaponShape.weaponHeightPx = dims.heightPx
    weaponShape.weaponBoundingWidthPx = dims.boundingWidthPx
    weaponShape.weaponBoundingHeightPx = dims.boundingHeightPx
    weaponShape.weaponRenderType =
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

    const weaponMarker = new fabric.Group([weaponShape], {
      left: x,
      top: y,
      selectable: false,
      visible: false,
    })
    ;(weaponMarker as unknown as { weaponType: WeaponType }).weaponType =
      weaponType
    ;(weaponMarker as unknown as { sizeLevel: number }).sizeLevel =
      normalizedConfig.sizeLevel
    ;(weaponMarker as unknown as { category: WeaponCategory }).category =
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
