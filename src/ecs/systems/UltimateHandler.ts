import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
} from '../../constants'
import type { MainModule } from '../../types'
import type { WeaponVisualType } from '../../types'
import { ULTIMATE_COOLDOWN_MS } from '../Component'
import type { WeaponTransform } from '../Component'
import type { Entity } from '../Entity'
import {
  FRONT_SWING_TILT_RAD,
  clamp01,
  getFrontTransform,
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
const HAMMER_AOE_RADIUS = 4 // 落地AOE伤害范围（米）
export const HAMMER_ULTIMATE_MAX_DIST = 12 // 落地点最大距离（米）= 约可视范围一半

export class UltimateHandler {
  private statsSystem?: StatsSystem
  private allEntities: Entity[] = []
  private entityLookup?: (id: number) => Entity | undefined
  private box2d?: MainModule
  private tempVec?: InstanceType<MainModule['b2Vec2']>

  private tempTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  private tempVisualPos = { x: 0, y: 0 }
  private tempPlayerPos = { x: 0, y: 0 }

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

  handleUltimatePhases(
    entity: Entity,
    weapon: NonNullable<Entity['weapon']>,
    playerPos: { x: number; y: number },
    deltaMs: number
  ): void {
    weapon.ultimateElapsedMs += deltaMs

    const facing = weapon.ultimateFacing
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
      if (!target.faction || !attacker.faction.canAttack(target.faction))
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
        { x: giantX, y: groundY }
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
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const frontAngle =
      facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
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
          if (
            entity.input?.lockedTargetId !== null &&
            entity.input?.lockedTargetId !== undefined &&
            this.entityLookup
          ) {
            const locked = this.entityLookup(entity.input.lockedTargetId)
            if (locked?.transform && locked.stats && !locked.stats.isDead) {
              const newLandX =
                locked.transform.x -
                Math.cos(frontAngle) * (radius + weapon.width / 2)
              const baseX = entity.transform?.x ?? playerPos.x
              const rawDx = newLandX - baseX
              const clampedDx =
                rawDx > HAMMER_ULTIMATE_MAX_DIST
                  ? HAMMER_ULTIMATE_MAX_DIST
                  : rawDx < -HAMMER_ULTIMATE_MAX_DIST
                    ? -HAMMER_ULTIMATE_MAX_DIST
                    : rawDx
              weapon.ultimateHammerLandX = baseX + clampedDx
            }
          }
          weapon.ultimateHammerVisualDX =
            weapon.ultimateHammerLandX - (entity.transform?.x ?? playerPos.x)
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
        }
        break
      }
      case 'hammer_fall': {
        const t = clamp01(weapon.ultimateElapsedMs / HAMMER_FALL_MS)
        const fallEase = t * t
        weapon.ultimateHammerJumpOffsetY =
          Math.round(HAMMER_JUMP_HEIGHT * (1 - fallEase) * 100) / 100
        getTransformAtAngle(visualPos, frontAngle, radius, weapon.visual)
        if (t >= 1) {
          weapon.ultimateHammerJumpOffsetY = 0
          this.teleportEntityToLanding(entity, weapon)
          this.tempPlayerPos.x = entity.transform?.x ?? playerPos.x
          this.tempPlayerPos.y = entity.transform?.y ?? playerPos.y
          weapon.ultimateHammerVisualDX = 0
          getTransformAtAngle(
            this.tempPlayerPos,
            frontAngle,
            radius,
            weapon.visual
          )
          const halfLen = weapon.width / 2
          weapon.ultimateGiantX =
            weapon.visual.x + Math.cos(frontAngle) * halfLen
          weapon.ultimateGiantGroundY =
            weapon.visual.y + Math.sin(frontAngle) * halfLen
          if (!weapon.ultimateDamageDealt) {
            weapon.ultimateDamageDealt = true
            this.applyHammerUltimateAOEDamage(entity)
          }
          weapon.ultimatePhase = 'hammer_land'
          weapon.ultimateElapsedMs = 0
          weapon.ultimateHammerImpact100 = 0
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
    entity.transform.x = weapon.ultimateHammerLandX
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
      if (!target.faction || !attacker.faction.canAttack(target.faction))
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
        { x: cx, y: cy }
      )
    }
  }

  handleUltimateRequest(entity: Entity, maxLandDist?: number): void {
    if (!entity.attackSlots || !entity.weapon || !entity.input) return
    if (!entity.transform) return
    const slot = entity.attackSlots.ultimate
    if (!slot.hasMoveset) return
    if (!entity.weapon.isEquipped) return
    const wt = entity.weapon.weaponType
    if (wt !== 'sword' && wt !== 'hammer') return
    if (slot.cooldownRemainingMs > 0) return
    if (entity.weapon.attackPhase !== 'idle') return
    if (entity.weapon.ultimatePhase !== null) return

    if (wt === 'hammer') {
      this.handleHammerUltimateRequest(entity, maxLandDist)
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

    const frontAngle =
      facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
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
    weapon.ultimateHammerImpact100 = 0
    weapon.ultimateDamageDealt = false
    weapon.ultimateGiantX = 0
    weapon.ultimateGiantGroundY = 0
    weapon.isUnstoppable = true
    weapon.attackFacing = facing
    if (entity.stats) entity.stats.isInvincible = true
  }
}
