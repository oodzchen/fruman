import { fabric } from 'fabric'

import type { MapEnemyWeapon, WeaponCategory } from '../editorMapTypes'
import type { WeaponType } from '../types'

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
    type: 'sword' | 'bow',
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
  weaponRenderType: 'bow' | 'sword'
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

  createPlayerMarker() {
    const radius = this.defaultPlayerRadius * this.pixelsPerMeter
    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = radius * 0.5
    const eyeOffsetY = -radius * 0.5
    const body = new fabric.Circle({
      radius,
      fill: this.playerBodyColor,
      stroke: this.playerBodyColor,
      strokeWidth: 3,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
    })
    const eye = new fabric.Circle({
      radius: eyeRadius,
      fill: this.playerEyeColor,
      stroke: this.playerEyeColor,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: eyeOffsetX,
      top: eyeOffsetY,
      objectCaching: false,
    })
    const group = new fabric.Group([body, eye], {
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
    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = radius * 0.5
    const eyeOffsetY = -radius * 0.5
    const body = new fabric.Circle({
      radius,
      fill: color,
      stroke: color,
      strokeWidth: 3,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
    })
    const eye = new fabric.Circle({
      radius: eyeRadius,
      fill: this.enemyEyeColor,
      stroke: this.enemyEyeColor,
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: eyeOffsetX,
      top: eyeOffsetY,
      objectCaching: false,
    })
    const group = new fabric.Group([body, eye], {
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
    const renderType: WeaponShape['weaponRenderType'] = isBow ? 'bow' : 'sword'
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
    const weaponType = config.weaponType
    const isBow = weaponType === 'bow'
    const category: WeaponCategory = isBow ? 'secondary' : 'main'
    const template = templates[weaponType]
    const dims = this.computeWeaponRenderDimensions(
      template,
      config.sizeLevel,
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
    weaponShape.weaponRenderType = isBow ? 'bow' : 'sword'

    const weaponMarker = new fabric.Group([weaponShape], {
      left: x,
      top: y,
      selectable: false,
      visible: false,
    })
    ;(weaponMarker as unknown as { weaponType: WeaponType }).weaponType =
      weaponType
    ;(weaponMarker as unknown as { sizeLevel: number }).sizeLevel =
      config.sizeLevel
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
