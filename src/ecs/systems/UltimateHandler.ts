import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
  SOUND_DB_BIG_HAMMER_HIT_ROCK,
  SOUND_RANGE_MULTIPLIER_MASSIVE,
} from '../../constants'
import {
  isGroundCollisionCategory,
  isObstacleCollisionCategory,
} from '../../physicsLayers'
import type { MainModule } from '../../types'
import type { WeaponVisualType } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import { ULTIMATE_COOLDOWN_MS } from '../Component'
import type { WeaponTransform } from '../Component'
import type { Entity } from '../Entity'
import { checkOBBvsCircle } from '../OBBCollision'
import {
  FRONT_SWING_TILT_RAD,
  clamp01,
  getFrontTransform,
  getThrustTransforms,
  getTransformAtAngle,
} from '../WeaponPoseUtils'
import type { StatsSystem } from './StatsSystem'

// 绝招动画参数
const ULTIMATE_SPIN_MS = 1200
const ULTIMATE_SPIN_MOVE_RATIO = 0.3 // spin 前30%用于移动到身前位置
const ULTIMATE_HOLD_MS = 500
const ULTIMATE_THRUST_MS = 350
const ULTIMATE_GIANT_WAIT_MS = 350 // 与 THRUST_MS 相等保证匀速穿屏
const ULTIMATE_GIANT_RECOVER_MS = 350
const ULTIMATE_THRUST_DIST = 3 // 手中剑向上飞行距离（米）
// 巨剑 = 10x 3档剑尺寸（16m 长，3m 厚）
// 护手宽度 = max(halfHeight+2, floor(height*90%)) = max(1+2, floor(2.7)) = 3m
const ULTIMATE_GIANT_HALF_WIDTH = 3 // AOE 水平伤害半径，覆盖护手全宽

// 锤子绝招动画参数
const HAMMER_SPIN_MS = 900
const HAMMER_SPIN_START_RATIO = 0.15 // 前15%从准备位置过渡到轨道起点
const HAMMER_JUMP_RISE_MS = 700
const HAMMER_JUMP_RISE_SWING_RATIO = 0.3 // 跳升前30%将武器从前方摆到举高位置
const HAMMER_JUMP_APEX_MS = 350
const HAMMER_FALL_MS = 550
const HAMMER_LAND_MS = 800
const HAMMER_RECOVER_MS = 600
const HAMMER_JUMP_HEIGHT = 8 // 跳跃视觉高度（米），约为普通跳跃4倍
export const HAMMER_AOE_RADIUS = 4 // 落地AOE伤害范围（米）
export const HAMMER_ULTIMATE_MAX_DIST = 12 // 落地点最大距离（米）= 约可视范围一半
const HAMMER_ULTIMATE_SHAKE_INTENSITY_PX = 18
const HAMMER_ULTIMATE_SHAKE_DURATION_MS = 280
const HAMMER_ULTIMATE_TERRAIN_IMPACT_POWER = 20

const SPEAR_ULTIMATE_SPIN_MS = 850
const SPEAR_ULTIMATE_HOLD_MS = 300
const SPEAR_ULTIMATE_THRUST_MS = 400
const SPEAR_ULTIMATE_RECOVER_MS = 500
const SPEAR_ULTIMATE_SIZE_NUMERATOR = 2
const SPEAR_ULTIMATE_DAMAGE_SCALE = 4
const SPEAR_ULTIMATE_FIXED_POINT_Y_SCALE = 2
const SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_NUMERATOR = 1
const SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_DENOMINATOR = 6

export interface TerrainImpactRequest {
  worldX: number
  worldY: number
  radius: number
  impactPower: number
  renderLayer: number
}

export type TerrainImpactCallback = (request: TerrainImpactRequest) => void

export class UltimateHandler {
  private statsSystem?: StatsSystem
  private allEntities: Entity[] = []
  private entityLookup?: (id: number) => Entity | undefined
  private box2d?: MainModule
  private tempVec?: InstanceType<MainModule['b2Vec2']>
  private terrainImpactCallback?: TerrainImpactCallback
  private viewportHeight = 9

  private tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  private tempVisualPos = { x: 0, y: 0 }
  private tempPlayerPos = { x: 0, y: 0 }

  private syncEntityFacing(entity: Entity, facing: number): void {
    if (!entity.input) return
    entity.input.lastMoveDirection = facing
    entity.input.facingOverride = facing
  }

  private releaseEntityFacing(entity: Entity): void {
    if (!entity.input) return
    entity.input.facingOverride = null
  }

  private getHammerFrontAngle(facing: number): number {
    return facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
  }

  private clampHammerUltimateLandX(baseX: number, targetX: number): number {
    const rawDx = targetX - baseX
    const clampedDx =
      rawDx > HAMMER_ULTIMATE_MAX_DIST
        ? HAMMER_ULTIMATE_MAX_DIST
        : rawDx < -HAMMER_ULTIMATE_MAX_DIST
          ? -HAMMER_ULTIMATE_MAX_DIST
          : rawDx
    return baseX + clampedDx
  }

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem
  }

  setAllEntities(entities: Entity[]): void {
    this.allEntities = entities
  }

  setEntityLookup(fn: (id: number) => Entity | undefined): void {
    this.entityLookup = fn
  }

  setBox2d(box2d: MainModule): void {
    this.box2d = box2d
    this.tempVec = new box2d.b2Vec2(0, 0)
  }

  setTerrainImpactCallback(callback: TerrainImpactCallback | undefined): void {
    this.terrainImpactCallback = callback
  }

  setViewportSize(_viewportWidth: number, viewportHeight: number): void {
    this.viewportHeight =
      viewportHeight > 0 ? viewportHeight : this.viewportHeight
  }

  handleUltimatePhases(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number },
    deltaMs: number
  ): void {
    weapon.ultimateElapsedMs += deltaMs

    const facing = weapon.ultimateFacing
    this.syncEntityFacing(entity, facing)
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const holdX = playerPos.x + facing * (radius + DEFAULT_WEAPON_WIDTH * 0.5)
    const holdY = playerPos.y
    const holdRot = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

    if (
      weapon.ultimatePhase !== null &&
      weapon.ultimatePhase.startsWith('hammer_')
    ) {
      this.handleHammerUltimatePhases(entity, weapon, playerPos, deltaMs)
      return
    }
    if (
      weapon.ultimatePhase !== null &&
      weapon.ultimatePhase.startsWith('spear_')
    ) {
      this.handleSpearUltimatePhases(entity, weapon, playerPos)
      return
    }

    switch (weapon.ultimatePhase) {
      case 'spin': {
        const t = clamp01(weapon.ultimateElapsedMs / ULTIMATE_SPIN_MS)
        if (t < ULTIMATE_SPIN_MOVE_RATIO) {
          const mt = t / ULTIMATE_SPIN_MOVE_RATIO
          const ease = mt * mt * (3 - 2 * mt)
          weapon.visual.x =
            weapon.ultimateSpinStartX +
            (holdX - weapon.ultimateSpinStartX) * ease
          weapon.visual.y =
            weapon.ultimateSpinStartY +
            (holdY - weapon.ultimateSpinStartY) * ease
          weapon.visual.rotation = weapon.ultimateSpinStartRot
        } else {
          const st =
            (t - ULTIMATE_SPIN_MOVE_RATIO) / (1 - ULTIMATE_SPIN_MOVE_RATIO)
          weapon.visual.x = holdX
          weapon.visual.y = holdY
          weapon.visual.rotation =
            weapon.ultimateSpinStartRot + facing * st * Math.PI * 2
        }
        if (t >= 1) {
          weapon.ultimatePhase = 'hold'
          weapon.ultimateElapsedMs = 0
          weapon.visual.rotation = holdRot
        }
        break
      }
      case 'hold': {
        weapon.visual.x = holdX
        weapon.visual.y = holdY
        weapon.visual.rotation = holdRot
        if (weapon.ultimateElapsedMs >= ULTIMATE_HOLD_MS) {
          weapon.ultimatePhase = 'thrust'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateGiantAlpha100 = 0
          this.statsSystem?.playSoundAt(
            SOUND_IDS.SWORD_ULTIMATE_GIANT_RISE,
            weapon.visual.x,
            weapon.visual.y
          )
        }
        break
      }
      case 'thrust': {
        const t = clamp01(weapon.ultimateElapsedMs / ULTIMATE_THRUST_MS)
        weapon.visual.x = holdX
        weapon.visual.y = holdY - t * ULTIMATE_THRUST_DIST
        weapon.visual.rotation = holdRot
        weapon.ultimateGiantRise100 = Math.round(t * 100)
        weapon.ultimateGiantAlpha100 = Math.round(t * 100)
        if (t >= 1) {
          if (!weapon.ultimateDamageDealt) {
            weapon.ultimateDamageDealt = true
            this.applyUltimateAOEDamage(entity)
          }
          weapon.ultimateGiantAlpha100 = 100
          weapon.ultimatePhase = 'giant_wait'
          weapon.ultimateElapsedMs = 0
        }
        break
      }
      case 'giant_wait': {
        const t = clamp01(weapon.ultimateElapsedMs / ULTIMATE_GIANT_WAIT_MS)
        weapon.visual.x = holdX
        weapon.visual.y = holdY - ULTIMATE_THRUST_DIST
        weapon.visual.rotation = holdRot
        weapon.ultimateGiantRise100 = 100 + Math.round(t * 100)
        weapon.ultimateGiantAlpha100 = 100
        if (t >= 1) {
          weapon.ultimateSpinStartX = weapon.visual.x
          weapon.ultimateSpinStartY = weapon.visual.y
          weapon.ultimatePhase = 'giant_recover'
          weapon.ultimateElapsedMs = 0
        }
        break
      }
      case 'giant_recover': {
        const t = clamp01(weapon.ultimateElapsedMs / ULTIMATE_GIANT_RECOVER_MS)
        getFrontTransform(
          playerPos,
          facing,
          this.tempTransform,
          radius,
          weapon.weaponType as WeaponVisualType,
          weapon.width
        )
        weapon.visual.x =
          weapon.ultimateSpinStartX +
          (this.tempTransform.x - weapon.ultimateSpinStartX) * t
        weapon.visual.y =
          weapon.ultimateSpinStartY +
          (this.tempTransform.y - weapon.ultimateSpinStartY) * t
        weapon.visual.rotation = holdRot
        weapon.ultimateGiantAlpha100 = 0
        weapon.ultimateGiantRise100 = 0
        if (t >= 1) {
          weapon.ultimatePhase = null
          weapon.ultimateElapsedMs = 0
          weapon.isUnstoppable = false
          weapon.attackPhase = 'idle'
          this.releaseEntityFacing(entity)
          if (entity.stats) entity.stats.isInvincible = false
          if (entity.attackSlots)
            entity.attackSlots.ultimate.cooldownRemainingMs =
              ULTIMATE_COOLDOWN_MS
        }
        break
      }
      default:
        break
    }
  }

  private handleSpearUltimatePhases(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number }
  ): void {
    this.syncEntityFacing(entity, weapon.ultimateFacing)
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const attackRadius =
      radius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
    getThrustTransforms(
      attackRadius,
      weapon.ultimateFacing,
      playerPos,
      weapon.weaponType,
      weapon.width,
      this.tempTransform,
      weapon.swingEndTransform
    )
    const holdX = this.tempTransform.x
    const holdY = this.tempTransform.y
    const thrustEndX = weapon.swingEndTransform.x
    const thrustEndY = weapon.swingEndTransform.y
    const thrustRot = this.tempTransform.rotation

    switch (weapon.ultimatePhase) {
      case 'spear_spin': {
        const t = clamp01(weapon.ultimateElapsedMs / SPEAR_ULTIMATE_SPIN_MS)
        const ease = t * t * (3 - 2 * t)
        weapon.visual.x =
          weapon.ultimateSpinStartX + (holdX - weapon.ultimateSpinStartX) * ease
        weapon.visual.y =
          weapon.ultimateSpinStartY + (holdY - weapon.ultimateSpinStartY) * ease
        weapon.visual.rotation =
          weapon.ultimateSpinStartRot +
          (thrustRot +
            weapon.ultimateFacing * Math.PI * 2 * 0.999 -
            weapon.ultimateSpinStartRot) *
            ease
        if (t >= 1) {
          weapon.ultimatePhase = 'spear_hold'
          weapon.ultimateElapsedMs = 0
          weapon.visual.x = holdX
          weapon.visual.y = holdY
          weapon.visual.rotation = thrustRot
        }
        break
      }
      case 'spear_hold': {
        weapon.visual.x = holdX
        weapon.visual.y = holdY
        weapon.visual.rotation = thrustRot
        weapon.ultimateSpearAlpha100 = 100
        if (weapon.ultimateElapsedMs >= SPEAR_ULTIMATE_HOLD_MS) {
          weapon.ultimatePhase = 'spear_thrust'
          weapon.ultimateElapsedMs = 0
          weapon.attackStartTransform.x = holdX
          weapon.attackStartTransform.y = holdY
          weapon.attackStartTransform.rotation = thrustRot
          this.statsSystem?.playSoundAt(
            SOUND_IDS.SPEAR_ULTIMATE_THRUST,
            weapon.visual.x,
            weapon.visual.y
          )
          if (!weapon.ultimateDamageDealt) {
            weapon.ultimateDamageDealt = true
            this.applySpearUltimateAOEDamage(entity)
          }
        }
        break
      }
      case 'spear_thrust': {
        const t = clamp01(weapon.ultimateElapsedMs / SPEAR_ULTIMATE_THRUST_MS)
        weapon.visual.x = holdX + (thrustEndX - holdX) * t
        weapon.visual.y = holdY + (thrustEndY - holdY) * t
        weapon.visual.rotation = thrustRot
        weapon.ultimateSpearAlpha100 = 100 - Math.round(t * 25)
        this.updateSpearUltimateVisuals(weapon, t)
        if (t >= 1) {
          weapon.ultimatePhase = 'spear_recover'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateSpinStartX = weapon.visual.x
          weapon.ultimateSpinStartY = weapon.visual.y
          weapon.ultimateSpinStartRot = weapon.visual.rotation
          weapon.ultimateSpearAlpha100 = 0
        }
        break
      }
      case 'spear_recover': {
        const t = clamp01(weapon.ultimateElapsedMs / SPEAR_ULTIMATE_RECOVER_MS)
        const ease = t * t * (3 - 2 * t)
        getFrontTransform(
          playerPos,
          weapon.ultimateFacing,
          this.tempTransform,
          radius,
          weapon.weaponType as WeaponVisualType,
          weapon.width
        )
        weapon.visual.x =
          weapon.ultimateSpinStartX +
          (this.tempTransform.x - weapon.ultimateSpinStartX) * ease
        weapon.visual.y =
          weapon.ultimateSpinStartY +
          (this.tempTransform.y - weapon.ultimateSpinStartY) * ease
        weapon.visual.rotation =
          weapon.ultimateSpinStartRot +
          (this.tempTransform.rotation - weapon.ultimateSpinStartRot) * ease
        if (t >= 1) {
          weapon.ultimatePhase = null
          weapon.ultimateElapsedMs = 0
          weapon.isUnstoppable = false
          weapon.attackPhase = 'idle'
          weapon.ultimateSpearAlpha100 = 0
          this.releaseEntityFacing(entity)
          if (entity.stats) entity.stats.isInvincible = false
          if (entity.attackSlots) {
            entity.attackSlots.ultimate.cooldownRemainingMs =
              ULTIMATE_COOLDOWN_MS
          }
        }
        break
      }
      default:
        break
    }
  }

  private applyUltimateAOEDamage(attacker: Entity): void {
    if (!this.statsSystem || !attacker.faction || !attacker.weapon) return
    const weapon = attacker.weapon
    const giantX = weapon.ultimateGiantX
    const groundY = weapon.ultimateGiantGroundY
    const damage = weapon.attackDamage * 5
    const posture = weapon.postureDamage * 5
    const toughness = weapon.toughnessDamage * 5
    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (!target || target.id === attacker.id) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if (
        !target.faction ||
        !attacker.faction.canAttackEntity(target.faction, target.id.toString())
      )
        continue
      const dx = Math.abs(target.transform.x - giantX)
      if (dx > ULTIMATE_GIANT_HALF_WIDTH) continue
      this.statsSystem.applyWeaponHit(
        target,
        {
          attackDamage: damage,
          postureDamage: posture,
          toughnessDamage: toughness,
          impactLevel: 'extreme',
          weaponType: 'sword',
        },
        { x: giantX, y: groundY },
        attacker
      )
    }
  }

  private handleHammerUltimatePhases(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number },
    _deltaMs: number
  ): void {
    const facing = weapon.ultimateFacing
    this.syncEntityFacing(entity, facing)
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const frontAngle = this.getHammerFrontAngle(facing)
    const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

    this.tempVisualPos.x = playerPos.x + weapon.ultimateHammerVisualDX
    this.tempVisualPos.y = playerPos.y - weapon.ultimateHammerJumpOffsetY
    const visualPos = this.tempVisualPos

    switch (weapon.ultimatePhase) {
      case 'hammer_spin': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_SPIN_MS)
        if (t < HAMMER_SPIN_START_RATIO) {
          const st = t / HAMMER_SPIN_START_RATIO
          const ease = st * st * (3 - 2 * st)
          getTransformAtAngle(playerPos, frontAngle, radius, this.tempTransform)
          weapon.visual.x =
            weapon.ultimateSpinStartX +
            (this.tempTransform.x - weapon.ultimateSpinStartX) * ease
          weapon.visual.y =
            weapon.ultimateSpinStartY +
            (this.tempTransform.y - weapon.ultimateSpinStartY) * ease
          weapon.visual.rotation =
            weapon.ultimateSpinStartRot +
            (this.tempTransform.rotation - weapon.ultimateSpinStartRot) * ease
        } else {
          const st =
            (t - HAMMER_SPIN_START_RATIO) / (1 - HAMMER_SPIN_START_RATIO)
          const spinAngle = frontAngle + -facing * st * Math.PI * 2
          getTransformAtAngle(playerPos, spinAngle, radius, weapon.visual)
        }
        if (t >= 1) {
          weapon.ultimatePhase = 'hammer_jump_rise'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateHammerJumpOffsetY = 0
          weapon.ultimateHammerVisualDX = 0
        }
        break
      }
      case 'hammer_jump_rise': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_JUMP_RISE_MS)
        const riseEase = 1 - (1 - t) * (1 - t)
        const startX = entity.transform?.x ?? playerPos.x
        weapon.ultimateHammerJumpOffsetY =
          Math.round(riseEase * HAMMER_JUMP_HEIGHT * 100) / 100
        weapon.ultimateHammerVisualDX =
          (weapon.ultimateHammerLandX - startX) * t
        visualPos.x = playerPos.x + weapon.ultimateHammerVisualDX
        visualPos.y = playerPos.y - weapon.ultimateHammerJumpOffsetY
        const overheadOffset = radius * 3
        if (t < HAMMER_JUMP_RISE_SWING_RATIO) {
          const st = t / HAMMER_JUMP_RISE_SWING_RATIO
          const swingEase = st * st * (3 - 2 * st)
          const spinOffX = Math.cos(frontAngle) * radius
          const spinOffY = Math.sin(frontAngle) * radius
          weapon.visual.x = visualPos.x + spinOffX + (0 - spinOffX) * swingEase
          weapon.visual.y =
            visualPos.y + spinOffY + (-overheadOffset - spinOffY) * swingEase
          weapon.visual.rotation =
            frontAngle + (headAngle - frontAngle) * swingEase
        } else {
          weapon.visual.x = visualPos.x
          weapon.visual.y = visualPos.y - overheadOffset
          weapon.visual.rotation = headAngle
        }
        if (t >= 1) {
          weapon.ultimatePhase = 'hammer_jump_apex'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateHammerJumpOffsetY = HAMMER_JUMP_HEIGHT
          weapon.ultimateHammerApexX = visualPos.x
          if (
            entity.input?.lockedTargetId !== null &&
            entity.input?.lockedTargetId !== undefined &&
            this.entityLookup
          ) {
            const locked = this.entityLookup(entity.input.lockedTargetId)
            if (locked?.transform && locked.stats && !locked.stats.isDead) {
              const targetFacing =
                locked.transform.x < weapon.ultimateHammerApexX ? -1 : 1
              const targetFrontAngle = this.getHammerFrontAngle(targetFacing)
              const targetLandX =
                locked.transform.x -
                Math.cos(targetFrontAngle) * (radius + weapon.width / 2)
              const baseX = entity.transform?.x ?? playerPos.x
              weapon.ultimateFacing = targetFacing
              weapon.attackFacing = targetFacing
              this.syncEntityFacing(entity, targetFacing)
              weapon.ultimateHammerLandX = this.clampHammerUltimateLandX(
                baseX,
                targetLandX
              )
            }
          }
          weapon.ultimateHammerVisualDX =
            weapon.ultimateHammerApexX - playerPos.x
        }
        break
      }
      case 'hammer_jump_apex': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_JUMP_APEX_MS)
        const overheadOffset = radius * 3
        const swingEase = t * t * (3 - 2 * t)
        getTransformAtAngle(visualPos, frontAngle, radius, this.tempTransform)
        weapon.visual.x =
          visualPos.x + (this.tempTransform.x - visualPos.x) * swingEase
        weapon.visual.y =
          visualPos.y -
          overheadOffset +
          (this.tempTransform.y - (visualPos.y - overheadOffset)) * swingEase
        weapon.visual.rotation =
          headAngle + (frontAngle - headAngle) * swingEase
        if (t >= 1) {
          weapon.ultimatePhase = 'hammer_fall'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateHammerPhysicalFallStarted = false
          weapon.ultimateHammerPhysicalFallStartY = 0
        }
        break
      }
      case 'hammer_fall': {
        if (weapon.ultimateHammerPhysicalFallStarted) {
          const fallDistance =
            (entity.transform?.y ?? playerPos.y) -
            weapon.ultimateHammerPhysicalFallStartY
          weapon.ultimateHammerJumpOffsetY = 0
          weapon.ultimateHammerVisualDX = 0
          getTransformAtAngle(playerPos, frontAngle, radius, weapon.visual)
          if (this.isEntityGroundedNow(entity)) {
            this.triggerHammerUltimateImpact(entity, weapon, frontAngle, radius)
          } else if (fallDistance > this.viewportHeight) {
            this.cancelHammerUltimateSlam(entity, weapon, playerPos, radius)
          }
          break
        }

        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_FALL_MS)
        const fallEase = t * t
        weapon.ultimateHammerJumpOffsetY =
          Math.round(HAMMER_JUMP_HEIGHT * (1 - fallEase) * 100) / 100
        weapon.ultimateHammerVisualDX =
          weapon.ultimateHammerApexX -
          playerPos.x +
          (weapon.ultimateHammerLandX - weapon.ultimateHammerApexX) * fallEase
        visualPos.x = playerPos.x + weapon.ultimateHammerVisualDX
        visualPos.y = playerPos.y - weapon.ultimateHammerJumpOffsetY
        getTransformAtAngle(visualPos, frontAngle, radius, weapon.visual)
        if (t >= 1) {
          this.startHammerUltimatePhysicalFall(entity, weapon, playerPos)
          this.tempPlayerPos.x = entity.transform?.x ?? playerPos.x
          this.tempPlayerPos.y = entity.transform?.y ?? playerPos.y
          getTransformAtAngle(
            this.tempPlayerPos,
            frontAngle,
            radius,
            weapon.visual
          )
        }
        break
      }
      case 'hammer_land': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_LAND_MS)
        weapon.ultimateHammerImpact100 = Math.round(t * 100)
        getTransformAtAngle(playerPos, frontAngle, radius, weapon.visual)
        if (t >= 1) {
          weapon.ultimatePhase = 'hammer_recover'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateHammerImpact100 = 0
          weapon.ultimateSpinStartX = weapon.visual.x
          weapon.ultimateSpinStartY = weapon.visual.y
          weapon.ultimateSpinStartRot = weapon.visual.rotation
        }
        break
      }
      case 'hammer_recover': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_RECOVER_MS)
        getFrontTransform(
          playerPos,
          facing,
          this.tempTransform,
          radius,
          weapon.weaponType as WeaponVisualType,
          weapon.width
        )
        const ease = t * t * (3 - 2 * t)
        weapon.visual.x =
          weapon.ultimateSpinStartX +
          (this.tempTransform.x - weapon.ultimateSpinStartX) * ease
        weapon.visual.y =
          weapon.ultimateSpinStartY +
          (this.tempTransform.y - weapon.ultimateSpinStartY) * ease
        weapon.visual.rotation =
          weapon.ultimateSpinStartRot +
          (DEFAULT_WEAPON_VERTICAL_ROTATION_RAD - weapon.ultimateSpinStartRot) *
            ease
        if (t >= 1) {
          weapon.ultimatePhase = null
          weapon.ultimateElapsedMs = 0
          weapon.isUnstoppable = false
          weapon.attackPhase = 'idle'
          weapon.ultimateHammerImpact100 = 0
          weapon.ultimateHammerJumpOffsetY = 0
          weapon.ultimateHammerVisualDX = 0
          weapon.ultimateHammerPhysicalFallStarted = false
          weapon.ultimateHammerPhysicalFallStartY = 0
          this.releaseEntityFacing(entity)
          if (entity.stats) entity.stats.isInvincible = false
          if (entity.attackSlots)
            entity.attackSlots.ultimate.cooldownRemainingMs =
              ULTIMATE_COOLDOWN_MS
        }
        break
      }
      default:
        break
    }
  }

  private startHammerUltimatePhysicalFall(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number }
  ): void {
    weapon.ultimateHammerJumpOffsetY = 0
    this.teleportEntityToLanding(entity, weapon)
    weapon.ultimateHammerVisualDX = 0
    weapon.ultimateHammerApexX = 0
    weapon.ultimateHammerPhysicalFallStarted = true
    weapon.ultimateHammerPhysicalFallStartY = entity.transform?.y ?? playerPos.y
    if (entity.movement) {
      entity.movement.isGrounded = false
      entity.movement.wasGrounded = false
      entity.movement.maxFallVelocity = 0
      entity.movement.fallStartY = weapon.ultimateHammerPhysicalFallStartY
    }
  }

  private triggerHammerUltimateImpact(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    frontAngle: number,
    radius: number
  ): void {
    this.tempPlayerPos.x = entity.transform?.x ?? weapon.ultimateHammerLandX
    this.tempPlayerPos.y =
      entity.transform?.y ?? weapon.ultimateHammerPhysicalFallStartY
    getTransformAtAngle(this.tempPlayerPos, frontAngle, radius, weapon.visual)
    const halfLen = weapon.width / 2
    weapon.ultimateGiantX = weapon.visual.x + Math.cos(frontAngle) * halfLen
    weapon.ultimateGiantGroundY =
      weapon.visual.y + Math.sin(frontAngle) * halfLen
    this.statsSystem?.playSoundAt(
      SOUND_IDS.HAMMER_ULTIMATE_LAND,
      weapon.ultimateGiantX,
      weapon.ultimateGiantGroundY
    )
    this.statsSystem?.emitSoundWaveAt(
      weapon.ultimateGiantX,
      weapon.ultimateGiantGroundY,
      entity,
      SOUND_DB_BIG_HAMMER_HIT_ROCK,
      SOUND_RANGE_MULTIPLIER_MASSIVE
    )
    this.statsSystem?.emitCameraShake(
      weapon.ultimateGiantX,
      weapon.ultimateGiantGroundY,
      HAMMER_ULTIMATE_SHAKE_INTENSITY_PX,
      HAMMER_ULTIMATE_SHAKE_DURATION_MS
    )
    if (!weapon.ultimateDamageDealt) {
      weapon.ultimateDamageDealt = true
      this.applyHammerUltimateAOEDamage(entity)
      this.terrainImpactCallback?.({
        worldX: weapon.ultimateGiantX,
        worldY: weapon.ultimateGiantGroundY,
        radius: HAMMER_AOE_RADIUS,
        impactPower: HAMMER_ULTIMATE_TERRAIN_IMPACT_POWER,
        renderLayer: entity.render?.renderLayer ?? 0,
      })
    }
    weapon.ultimatePhase = 'hammer_land'
    weapon.ultimateElapsedMs = 0
    weapon.ultimateHammerImpact100 = 0
    weapon.ultimateHammerPhysicalFallStarted = false
    weapon.ultimateHammerPhysicalFallStartY = 0
  }

  private cancelHammerUltimateSlam(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number },
    radius: number
  ): void {
    getFrontTransform(
      playerPos,
      weapon.ultimateFacing,
      weapon.visual,
      radius,
      weapon.weaponType as WeaponVisualType,
      weapon.width
    )
    weapon.ultimatePhase = null
    weapon.ultimateElapsedMs = 0
    weapon.isUnstoppable = false
    weapon.attackPhase = 'idle'
    weapon.ultimateHammerImpact100 = 0
    weapon.ultimateHammerJumpOffsetY = 0
    weapon.ultimateHammerVisualDX = 0
    weapon.ultimateHammerApexX = 0
    weapon.ultimateHammerPhysicalFallStarted = false
    weapon.ultimateHammerPhysicalFallStartY = 0
    weapon.ultimateGiantX = 0
    weapon.ultimateGiantGroundY = 0
    this.releaseEntityFacing(entity)
    if (entity.stats) entity.stats.isInvincible = false
    if (entity.attackSlots) {
      entity.attackSlots.ultimate.cooldownRemainingMs = ULTIMATE_COOLDOWN_MS
    }
  }

  private teleportEntityToLanding(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>
  ): void {
    if (!entity.physics || !entity.transform || !this.box2d || !this.tempVec)
      return
    const {
      b2Body_SetTransform,
      b2Body_GetRotation,
      b2Body_SetLinearVelocity,
      b2Body_SetAwake,
    } = this.box2d
    this.tempVec.x = weapon.ultimateHammerLandX
    this.tempVec.y = entity.transform.y
    b2Body_SetTransform(
      entity.physics.bodyId,
      this.tempVec,
      b2Body_GetRotation(entity.physics.bodyId)
    )
    this.tempVec.x = 0
    this.tempVec.y = 0
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    b2Body_SetAwake(entity.physics.bodyId, true)
    entity.transform.x = weapon.ultimateHammerLandX
  }

  private isEntityGroundedNow(entity: Entity): boolean {
    if (!entity.physics || !this.box2d) return false

    const {
      b2Body_GetContactData,
      b2Body_GetContactCapacity,
      b2Body_GetLinearVelocity,
      b2Shape_GetFilter,
    } = this.box2d

    const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const velY = vel.y
    const velX = vel.x
    vel.delete()

    const slopeGroundVelocityMin = -2.5
    const slopeMoveSpeedMin = 0.1
    const isMovingAlongSurface = Math.abs(velX) >= slopeMoveSpeedMin
    const isFallingOrStill =
      velY >= -0.1 || (isMovingAlongSurface && velY >= slopeGroundVelocityMin)
    if (!isFallingOrStill) return false

    const capacity = b2Body_GetContactCapacity(entity.physics.bodyId)
    const contactData = b2Body_GetContactData(entity.physics.bodyId, capacity)
    const groundNormalMin = 0.2

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      const absX = Math.abs(normal.x)
      const absY = Math.abs(normal.y)
      const filterA = b2Shape_GetFilter(contact.shapeIdA)
      const filterB = b2Shape_GetFilter(contact.shapeIdB)
      const categoryA = filterA.categoryBits
      const categoryB = filterB.categoryBits
      const isGroundA = isGroundCollisionCategory(categoryA)
      const isGroundB = isGroundCollisionCategory(categoryB)
      const isObstacleA = isObstacleCollisionCategory(categoryA)
      const isObstacleB = isObstacleCollisionCategory(categoryB)
      const isEnvironmentContact =
        isGroundA || isGroundB || isObstacleA || isObstacleB
      const isSteepSurface = isEnvironmentContact && absX > absY
      const grounded = !isSteepSurface && absY > groundNormalMin
      contact.delete()
      if (grounded) return true
    }

    return false
  }

  private applyHammerUltimateAOEDamage(attacker: Entity): void {
    if (!this.statsSystem || !attacker.faction || !attacker.weapon) return
    const weapon = attacker.weapon
    const cx = weapon.ultimateGiantX
    const cy = weapon.ultimateGiantGroundY
    const damage = weapon.attackDamage * 5
    const posture = weapon.postureDamage * 5
    const toughness = weapon.toughnessDamage * 5
    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (!target || target.id === attacker.id) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if (
        !target.faction ||
        !attacker.faction.canAttackEntity(target.faction, target.id.toString())
      )
        continue
      const dx = target.transform.x - cx
      const dy = target.transform.y - cy
      if (dx * dx + dy * dy > HAMMER_AOE_RADIUS * HAMMER_AOE_RADIUS) continue
      this.statsSystem.applyWeaponHit(
        target,
        {
          attackDamage: damage,
          postureDamage: posture,
          toughnessDamage: toughness,
          impactLevel: 'extreme',
          weaponType: 'hammer',
        },
        { x: cx, y: cy },
        attacker
      )
    }
  }

  private updateSpearUltimateVisuals(
    weapon: NonNullable<Entity['weapon']>,
    t: number
  ): void {
    const progress = clamp01(t)
    const topEndX =
      weapon.ultimateSpearCrossX * 2 - weapon.ultimateSpearTopStartX
    const topEndY =
      weapon.ultimateSpearCrossY * 2 - weapon.ultimateSpearTopStartY
    const bottomEndX =
      weapon.ultimateSpearCrossX * 2 - weapon.ultimateSpearBottomStartX
    const bottomEndY =
      weapon.ultimateSpearCrossY * 2 - weapon.ultimateSpearBottomStartY
    const fixedPointOffset =
      (weapon.ultimateGiantX *
        SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_NUMERATOR) /
      SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_DENOMINATOR

    const topFixedX =
      weapon.ultimateSpearTopStartX +
      (topEndX - weapon.ultimateSpearTopStartX) * progress
    const topFixedY =
      weapon.ultimateSpearTopStartY +
      (topEndY - weapon.ultimateSpearTopStartY) * progress
    const bottomFixedX =
      weapon.ultimateSpearBottomStartX +
      (bottomEndX - weapon.ultimateSpearBottomStartX) * progress
    const bottomFixedY =
      weapon.ultimateSpearBottomStartY +
      (bottomEndY - weapon.ultimateSpearBottomStartY) * progress

    weapon.ultimateSpearTopRot = Math.atan2(
      weapon.ultimateSpearCrossY - topFixedY,
      weapon.ultimateSpearCrossX - topFixedX
    )
    weapon.ultimateSpearBottomRot = Math.atan2(
      weapon.ultimateSpearCrossY - bottomFixedY,
      weapon.ultimateSpearCrossX - bottomFixedX
    )

    weapon.ultimateSpearTopX =
      topFixedX - Math.cos(weapon.ultimateSpearTopRot) * fixedPointOffset
    weapon.ultimateSpearTopY =
      topFixedY - Math.sin(weapon.ultimateSpearTopRot) * fixedPointOffset
    weapon.ultimateSpearBottomX =
      bottomFixedX - Math.cos(weapon.ultimateSpearBottomRot) * fixedPointOffset
    weapon.ultimateSpearBottomY =
      bottomFixedY - Math.sin(weapon.ultimateSpearBottomRot) * fixedPointOffset
  }

  private applySpearUltimateAOEDamage(attacker: Entity): void {
    if (!this.statsSystem || !attacker.faction || !attacker.weapon) return
    const weapon = attacker.weapon
    const ghostWidth = weapon.width * SPEAR_ULTIMATE_SIZE_NUMERATOR
    const ghostHeight = weapon.height * SPEAR_ULTIMATE_SIZE_NUMERATOR
    const damage = weapon.attackDamage * SPEAR_ULTIMATE_DAMAGE_SCALE
    const posture = weapon.postureDamage * SPEAR_ULTIMATE_DAMAGE_SCALE
    const toughness = weapon.toughnessDamage * SPEAR_ULTIMATE_DAMAGE_SCALE
    const topRot = Math.atan2(
      weapon.ultimateSpearCrossY - weapon.ultimateSpearTopStartY,
      weapon.ultimateSpearCrossX - weapon.ultimateSpearTopStartX
    )
    const bottomRot = Math.atan2(
      weapon.ultimateSpearCrossY - weapon.ultimateSpearBottomStartY,
      weapon.ultimateSpearCrossX - weapon.ultimateSpearBottomStartX
    )
    const topTravel = Math.hypot(
      weapon.ultimateSpearCrossX - weapon.ultimateSpearTopStartX,
      weapon.ultimateSpearCrossY - weapon.ultimateSpearTopStartY
    )
    const bottomTravel = Math.hypot(
      weapon.ultimateSpearCrossX - weapon.ultimateSpearBottomStartX,
      weapon.ultimateSpearCrossY - weapon.ultimateSpearBottomStartY
    )
    const topSweepWidth = topTravel * 2 + ghostWidth
    const bottomSweepWidth = bottomTravel * 2 + ghostWidth

    for (let i = 0; i < this.allEntities.length; i++) {
      const target = this.allEntities[i]
      if (!target || target.id === attacker.id) continue
      if (!target.transform || !target.stats || target.stats.isDead) continue
      if (
        !target.faction ||
        !attacker.faction.canAttackEntity(target.faction, target.id.toString())
      ) {
        continue
      }

      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const hitTop = checkOBBvsCircle(
        weapon.ultimateSpearCrossX,
        weapon.ultimateSpearCrossY,
        topSweepWidth,
        ghostHeight,
        topRot,
        target.transform.x,
        target.transform.y,
        targetRadius
      )
      const hitBottom = checkOBBvsCircle(
        weapon.ultimateSpearCrossX,
        weapon.ultimateSpearCrossY,
        bottomSweepWidth,
        ghostHeight,
        bottomRot,
        target.transform.x,
        target.transform.y,
        targetRadius
      )
      const hitHand = checkOBBvsCircle(
        (weapon.attackStartTransform.x + weapon.swingEndTransform.x) * 0.5,
        (weapon.attackStartTransform.y + weapon.swingEndTransform.y) * 0.5,
        Math.hypot(
          weapon.swingEndTransform.x - weapon.attackStartTransform.x,
          weapon.swingEndTransform.y - weapon.attackStartTransform.y
        ) + weapon.width,
        weapon.height,
        weapon.swingEndTransform.rotation,
        target.transform.x,
        target.transform.y,
        targetRadius
      )
      if (!hitTop && !hitBottom && !hitHand) continue

      this.statsSystem.applyWeaponHit(
        target,
        {
          attackDamage: damage,
          postureDamage: posture,
          toughnessDamage: toughness,
          impactLevel: 'extreme',
          weaponType: 'spear',
        },
        { x: weapon.ultimateSpearCrossX, y: weapon.ultimateSpearCrossY },
        attacker
      )
    }
  }

  private setupSpearUltimateVisuals(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    crossX: number,
    crossY: number
  ): void {
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const ghostWidth = weapon.width * SPEAR_ULTIMATE_SIZE_NUMERATOR
    const centerX = entity.transform?.x ?? crossX
    const centerY = entity.transform?.y ?? crossY
    const fixedPointOffset =
      (ghostWidth * SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_NUMERATOR) /
      SPEAR_ULTIMATE_FIXED_POINT_FORWARD_RATIO_DENOMINATOR

    weapon.ultimateSpearCrossX = crossX
    weapon.ultimateSpearCrossY = crossY
    weapon.ultimateSpearTopStartX = centerX
    weapon.ultimateSpearTopStartY =
      centerY - radius * SPEAR_ULTIMATE_FIXED_POINT_Y_SCALE
    weapon.ultimateSpearBottomStartX = centerX
    weapon.ultimateSpearBottomStartY =
      centerY + radius * SPEAR_ULTIMATE_FIXED_POINT_Y_SCALE
    weapon.ultimateSpearTopRot = Math.atan2(
      crossY - weapon.ultimateSpearTopStartY,
      crossX - weapon.ultimateSpearTopStartX
    )
    weapon.ultimateSpearBottomRot = Math.atan2(
      crossY - weapon.ultimateSpearBottomStartY,
      crossX - weapon.ultimateSpearBottomStartX
    )
    weapon.ultimateSpearTopX =
      weapon.ultimateSpearTopStartX -
      Math.cos(weapon.ultimateSpearTopRot) * fixedPointOffset
    weapon.ultimateSpearTopY =
      weapon.ultimateSpearTopStartY -
      Math.sin(weapon.ultimateSpearTopRot) * fixedPointOffset
    weapon.ultimateSpearBottomX =
      weapon.ultimateSpearBottomStartX -
      Math.cos(weapon.ultimateSpearBottomRot) * fixedPointOffset
    weapon.ultimateSpearBottomY =
      weapon.ultimateSpearBottomStartY -
      Math.sin(weapon.ultimateSpearBottomRot) * fixedPointOffset
    weapon.ultimateGiantX = ghostWidth
    weapon.ultimateGiantGroundY = weapon.height * SPEAR_ULTIMATE_SIZE_NUMERATOR
    weapon.ultimateSpearAlpha100 = 100
  }

  handleUltimateRequest(entity: Entity, maxLandDist?: number): void {
    if (!entity.attackSlots || !entity.weapon || !entity.input) return
    if (!entity.transform) return
    const slot = entity.attackSlots.ultimate
    if (!slot.hasMoveset) return
    if (!entity.weapon.isEquipped) return
    const wt = entity.weapon.weaponType
    if (wt !== 'sword' && wt !== 'hammer' && wt !== 'spear') return
    if (slot.cooldownRemainingMs > 0) return
    if (entity.weapon.attackPhase !== 'idle') return
    if (entity.weapon.ultimatePhase !== null) return

    if (wt === 'hammer') {
      this.handleHammerUltimateRequest(entity, maxLandDist)
      return
    }
    if (wt === 'spear') {
      this.handleSpearUltimateRequest(entity, maxLandDist)
      return
    }

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS

    weapon.ultimatePhase = 'spin'
    weapon.ultimateElapsedMs = 0
    weapon.ultimateFacing = facing
    weapon.ultimateSpinStartX = weapon.visual.x
    weapon.ultimateSpinStartY = weapon.visual.y
    weapon.ultimateSpinStartRot = weapon.visual.rotation
    if (this.entityLookup && entity.input.lockedTargetId !== null) {
      const lockedTarget = this.entityLookup(entity.input.lockedTargetId)
      if (
        lockedTarget?.transform &&
        lockedTarget.stats &&
        !lockedTarget.stats.isDead
      ) {
        weapon.ultimateGiantX = lockedTarget.transform.x
      } else {
        weapon.ultimateGiantX = entity.transform.x + facing * 2
      }
    } else {
      weapon.ultimateGiantX = entity.transform.x + facing * 2
    }
    weapon.ultimateGiantGroundY = entity.transform.y + radius
    weapon.ultimateGiantRise100 = 0
    weapon.ultimateGiantAlpha100 = 0
    weapon.ultimateDamageDealt = false
    weapon.isUnstoppable = true
    weapon.attackFacing = facing
    if (entity.stats) entity.stats.isInvincible = true
  }

  private handleSpearUltimateRequest(
    entity: Entity,
    maxLandDist?: number
  ): void {
    if (!entity.weapon || !entity.input || !entity.transform) return

    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const attackRadius =
      radius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE

    getThrustTransforms(
      attackRadius,
      facing,
      entity.transform,
      weapon.weaponType,
      weapon.width,
      weapon.attackStartTransform,
      weapon.swingEndTransform
    )

    const tipOffset = weapon.width / 2
    let crossX =
      weapon.swingEndTransform.x +
      Math.cos(weapon.swingEndTransform.rotation) * tipOffset
    let crossY =
      weapon.swingEndTransform.y +
      Math.sin(weapon.swingEndTransform.rotation) * tipOffset

    if (this.entityLookup && entity.input.lockedTargetId !== null) {
      const locked = this.entityLookup(entity.input.lockedTargetId)
      if (locked?.transform && locked.stats && !locked.stats.isDead) {
        const dx = locked.transform.x - entity.transform.x
        const dy = locked.transform.y - entity.transform.y
        const maxDist = maxLandDist ?? attackRadius
        const dist = Math.hypot(dx, dy)
        if (dist > maxDist && dist > 0) {
          const scale = maxDist / dist
          crossX = entity.transform.x + dx * scale
          crossY = entity.transform.y + dy * scale
        } else {
          crossX = locked.transform.x
          crossY = locked.transform.y
        }
      }
    }

    weapon.ultimatePhase = 'spear_spin'
    weapon.ultimateElapsedMs = 0
    weapon.ultimateFacing = facing
    weapon.ultimateSpinStartX = weapon.visual.x
    weapon.ultimateSpinStartY = weapon.visual.y
    weapon.ultimateSpinStartRot = weapon.visual.rotation
    weapon.ultimateDamageDealt = false
    weapon.isUnstoppable = true
    weapon.attackFacing = facing
    this.setupSpearUltimateVisuals(entity, weapon, crossX, crossY)
    if (entity.stats) entity.stats.isInvincible = true
  }

  private handleHammerUltimateRequest(
    entity: Entity,
    maxLandDist?: number
  ): void {
    if (!entity.weapon || !entity.input || !entity.transform) return
    const weapon = entity.weapon
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const maxDist = maxLandDist ?? HAMMER_ULTIMATE_MAX_DIST

    const frontAngle = this.getHammerFrontAngle(facing)
    const headOffset = Math.cos(frontAngle) * (radius + weapon.width / 2)
    let landX = entity.transform.x
    if (this.entityLookup && entity.input.lockedTargetId !== null) {
      const locked = this.entityLookup(entity.input.lockedTargetId)
      if (locked?.transform && locked.stats && !locked.stats.isDead) {
        landX = locked.transform.x - headOffset
      }
    }
    const rawDx = landX - entity.transform.x
    const clampedDx =
      rawDx > maxDist ? maxDist : rawDx < -maxDist ? -maxDist : rawDx
    landX = entity.transform.x + clampedDx

    weapon.ultimatePhase = 'hammer_spin'
    weapon.ultimateElapsedMs = 0
    weapon.ultimateFacing = facing
    weapon.ultimateSpinStartX = weapon.visual.x
    weapon.ultimateSpinStartY = weapon.visual.y
    weapon.ultimateSpinStartRot = weapon.visual.rotation
    weapon.ultimateHammerLandX = landX
    weapon.ultimateHammerJumpOffsetY = 0
    weapon.ultimateHammerVisualDX = 0
    weapon.ultimateHammerApexX = 0
    weapon.ultimateHammerPhysicalFallStarted = false
    weapon.ultimateHammerPhysicalFallStartY = 0
    weapon.ultimateHammerImpact100 = 0
    weapon.ultimateDamageDealt = false
    weapon.ultimateGiantX = 0
    weapon.ultimateGiantGroundY = 0
    weapon.isUnstoppable = true
    weapon.attackFacing = facing
    if (entity.stats) entity.stats.isInvincible = true
  }
}
