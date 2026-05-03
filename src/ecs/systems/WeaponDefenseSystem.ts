import {
  DEFAULT_FRAME_RATE,
  DEFAULT_PLAYER_RADIUS,
  PARRY_COUNTER_WINDOW_MS,
  SOUND_DB_PARRY,
} from '../../constants'
import {
  getWeaponStaggerDropRotationRad,
  isRangedAttackWeaponVisualType,
} from '../../weaponTypeUtils'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { WeaponTransform } from '../Component'
import { WeaponComponent } from '../Component'
import type { Entity } from '../Entity'
import { checkOBBvsOBB } from '../OBBCollision'
import {
  applyOffset,
  getFrontTransform,
  getOffsetFromTransform,
  lerpRelativeTransform,
  setWeaponBackTransform,
} from '../WeaponPoseUtils'
import { WeaponAssassinationSystem } from './WeaponAssassinationSystem'
import {
  BLOCK_VERTICAL_SCALE,
  PARRY_ACTIVE_START_FRAME,
  PARRY_WINDOW_FRAMES,
  getBodyHalfHeight,
} from './WeaponSystemShared'

export abstract class WeaponDefenseSystem extends WeaponAssassinationSystem {
  protected startBlock(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    weapon.attackPhase = 'block'
    weapon.parryElapsedTime = 0
    weapon.isParrying = true
    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.parryHitWeaponIds.clear()
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth * BLOCK_VERTICAL_SCALE

    // 初始化弹反起始和目标位置
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    getOffsetFromTransform(weapon.visual, playerPos, weapon.parryStartOffset)
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    weapon.parryStartTransform.x = weapon.visual.x
    weapon.parryStartTransform.y = weapon.visual.y
    weapon.parryStartTransform.rotation = weapon.visual.rotation

    weapon.parryEndTransform.x = playerPos.x + facing * (radius + 0.2)
    weapon.parryEndTransform.y = playerPos.y
    weapon.parryEndTransform.rotation = blockRotation
  }

  protected handleBlockPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // Update block target offset (parryEndOffset) immediately
    // ensuring we have the correct target for the current frame
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const blockRotation = -Math.PI / 2
    weapon.parryEndOffset.dx = facing * (radius + 0.2)
    weapon.parryEndOffset.dy = 0
    weapon.parryEndOffset.rotation = blockRotation

    // 硬直期间退出格挡
    if (entity.isStunned()) {
      weapon.attackPhase = 'idle'
      weapon.isBlocking = false
      weapon.isParrying = false
      weapon.parryElapsedTime = 0
      weapon.width = weapon.baseWidth
      return
    }

    // 弹反窗口结束后，松开格挡键才能退出
    if (!weapon.isParrying && entity.input && !entity.input.blockRequested) {
      // Vital fix: Ensure visual is up-to-date with current playerPos before capturing offset
      // Since we are in "Hold" state here, we snap visual to the calculated parryEndOffset
      applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
      this.startBlockReturn(entity, weapon, playerPos)
      return
    }

    weapon.isBlocking = true
    if (this.statsSystem) {
      this.statsSystem.enterCombat(entity)
    }
    weapon.lastAttackTimestamp = this.currentTimeMs

    // 弹反窗口期间（只在武器移动期间有效）
    if (weapon.isParrying) {
      weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
      const progress = Math.min(
        1,
        weapon.parryElapsedTime / PARRY_WINDOW_FRAMES
      )
      weapon.width =
        weapon.blockWidthStart +
        (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

      // 插值相对位置并应用
      lerpRelativeTransform(
        weapon.parryStartOffset,
        weapon.parryEndOffset,
        progress,
        this.tempRelativeTransform
      )
      applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

      // 弹反窗口内检测敌人武器碰撞（仅后半段有效帧）
      if (weapon.parryElapsedTime >= PARRY_ACTIVE_START_FRAME) {
        this.checkParryHits(entity)
      }

      // 弹反窗口结束
      if (weapon.parryElapsedTime >= PARRY_WINDOW_FRAMES) {
        weapon.isParrying = false
        // 如果弹反窗口结束时格挡键已松开，自动退出
        if (entity.input && !entity.input.blockRequested) {
          this.startBlockReturn(entity, weapon, playerPos)
          return
        }
      }
    } else {
      // 弹反窗口结束后，保持格挡姿态（相对于角色）
      applyOffset(weapon.parryEndOffset, playerPos, weapon.visual)
      weapon.width = weapon.blockWidthTarget
    }
  }

  protected startBlockReturn(
    entity: Entity,
    weapon: Entity['weapon'],
    playerPos: { x: number; y: number }
  ): void {
    if (!weapon) return
    weapon.attackPhase = 'blockReturn'
    weapon.isBlocking = false
    weapon.isParrying = false
    weapon.parryElapsedTime = 0 // 使用 parryElapsedTime 作为计时器（帧）
    weapon.blockWidthStart = weapon.width
    weapon.blockWidthTarget = weapon.baseWidth

    // 记录当前位置作为回归动画的起点 (存入 parryEndOffset)
    getOffsetFromTransform(weapon.visual, playerPos, weapon.parryEndOffset)

    // 计算 idle 状态的目标位置 (存入 parryStartOffset)
    // 注意：我们需要根据当前朝向计算 idle 位置
    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS

    // 复用 getFrontTransform 计算目标 offset (战斗姿态)
    getFrontTransform(
      playerPos,
      facing,
      this.tempTransform,
      radius,
      weapon.weaponType,
      weapon.width
    )
    getOffsetFromTransform(
      this.tempTransform,
      playerPos,
      weapon.parryStartOffset
    )
  }

  protected handleBlockReturnPhase(
    entity: Entity,
    playerPos: { x: number; y: number },
    facing: number
  ): void {
    if (!entity.weapon) return
    const weapon = entity.weapon

    // Remove interrupt check: allow full return animation

    weapon.parryElapsedTime += this.currentDeltaTime * DEFAULT_FRAME_RATE
    // 动画时间比发起格挡快一倍 (200ms -> 100ms)
    const durationFrames = PARRY_WINDOW_FRAMES / 2
    const progress = Math.min(1, weapon.parryElapsedTime / durationFrames)
    weapon.width =
      weapon.blockWidthStart +
      (weapon.blockWidthTarget - weapon.blockWidthStart) * progress

    // 插值相对位置并应用 (从 parryEndOffset 回到 parryStartOffset)
    lerpRelativeTransform(
      weapon.parryEndOffset, // Start (recorded current)
      weapon.parryStartOffset, // End (idle)
      progress,
      this.tempRelativeTransform
    )
    applyOffset(this.tempRelativeTransform, playerPos, weapon.visual)

    // 在撤回过程中不再检测弹反碰撞，确保无弹反/防御效果

    if (progress >= 1) {
      weapon.attackPhase = 'idle'
      weapon.parryElapsedTime = 0
      weapon.width = weapon.baseWidth
    }
  }

  protected checkParryHits(defender: Entity): void {
    if (!defender.weapon || !defender.faction || !defender.stats) return

    const weapon = defender.weapon
    const weaponX = weapon.visual.x
    const weaponY = weapon.visual.y
    const weaponWidth = weapon.width
    const weaponHeight = weapon.height
    const weaponRotation = weapon.visual.rotation

    for (const attacker of this.allEntities) {
      if (attacker.id === defender.id) continue
      if (!attacker.weapon || !attacker.faction || !attacker.stats) continue
      if (attacker.stats.isDead) continue
      if (
        !defender.faction.canAttackEntity(
          attacker.faction,
          attacker.id.toString()
        )
      )
        continue

      // 只检测正在攻击的敌人武器（swing 阶段）
      if (attacker.weapon.attackPhase !== 'swing') continue

      // 避免重复弹反同一个武器
      if (weapon.parryHitWeaponIds.has(attacker.id)) continue

      const attackerWeapon = attacker.weapon
      const attackerX = attackerWeapon.visual.x
      const attackerY = attackerWeapon.visual.y
      const attackerWidth = attackerWeapon.width
      const attackerHeight = attackerWeapon.height
      const attackerRotation = attackerWeapon.visual.rotation

      // 武器对武器 OBB 碰撞检测
      if (
        checkOBBvsOBB(
          weaponX,
          weaponY,
          weaponWidth,
          weaponHeight,
          weaponRotation,
          attackerX,
          attackerY,
          attackerWidth,
          attackerHeight,
          attackerRotation
        )
      ) {
        weapon.parryHitWeaponIds.add(attacker.id)
        const sparkX = (weaponX + attackerX) * 0.5
        const sparkY = (weaponY + attackerY) * 0.5
        this.statsSystem?.emitParrySpark(
          sparkX,
          sparkY,
          Math.atan2(weaponY - attackerY, weaponX - attackerX)
        )
        this.statsSystem?.playSoundAt(SOUND_IDS.SWORD_PARRY, sparkX, sparkY)
        this.emitSoundAt(sparkX, sparkY, defender, SOUND_DB_PARRY)
        this.applyParryEffect(defender, attacker)
      }
    }
  }

  protected applyParryEffect(defender: Entity, attacker: Entity): void {
    if (!this.statsSystem) return

    if (defender.weapon) {
      defender.weapon.parryCounterTimerMs = PARRY_COUNTER_WINDOW_MS
      defender.weapon.parryCounterActive = false
    }
    const weaponType = attacker.weapon?.weaponType
    const isRangedAttack = isRangedAttackWeaponVisualType(weaponType)
    if (attacker.weapon && !isRangedAttack) {
      this.resetAttackStateForInterrupt(attacker.weapon)
      if (attacker.input?.inputBuffer) {
        attacker.input.inputBuffer.clearAction('attack')
      }
      this.statsSystem.applyForcedHitStun(attacker, 'light')
    }
    let attackerStaggered = false
    if (isRangedAttack) {
      this.statsSystem.applyParryRecovery(defender)
    } else {
      attackerStaggered = this.statsSystem.applyParryDamage(defender, attacker)
    }
    this.statsSystem.applyParryKnockback(defender, attacker)

    if (attackerStaggered) {
      // 触发攻击者武器回弹效果
      // 具体的崩塌状态和武器掉落由 StatsSystem 统一处理
      if (attacker.weapon && attacker.transform) {
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, this.currentTimeMs)
      }
    } else {
      // 普通弹反
      if (
        attacker.weapon &&
        !attacker.weapon.isUnstoppable &&
        attacker.transform
      ) {
        // 非霸体攻击：仅触发回弹，无硬直
        this.tempPlayerPos.x = attacker.transform.x
        this.tempPlayerPos.y = attacker.transform.y
        this.startRebound(attacker, this.tempPlayerPos, this.currentTimeMs)
      }

      // 将防御者加入已击中列表，从而避免产生伤害（无论是霸体还是回弹，都要避免当次伤害）
      if (attacker.weapon) {
        attacker.weapon.hitEntityIds.add(defender.id)
      }
    }
  }

  protected startWeaponRecover(entity: Entity): void {
    if (!entity.weapon || !entity.transform) return

    const weapon = entity.weapon
    weapon.isRecovering = true
    weapon.dropElapsedTime = 0

    this.tempPlayerPos.x = entity.transform.x
    this.tempPlayerPos.y = entity.transform.y
    const playerPos = this.tempPlayerPos

    getOffsetFromTransform(weapon.visual, playerPos, weapon.dropStartOffset)
    this.destroyStaggerDropBody(weapon)

    const facing =
      entity.input && entity.input.lastMoveDirection !== 0
        ? entity.input.lastMoveDirection
        : weapon.attackFacing || 1
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    if (entity.stats?.isInCombat) {
      getFrontTransform(
        playerPos,
        facing,
        this.tempTransform,
        radius,
        weapon.weaponType,
        weapon.width
      )
    } else {
      setWeaponBackTransform(
        playerPos,
        facing,
        this.tempTransform,
        radius,
        weapon.weaponType,
        weapon.width,
        getBodyHalfHeight(entity.render, radius)
      )
    }
    getOffsetFromTransform(this.tempTransform, playerPos, weapon.dropEndOffset)
  }

  protected setStaggerDropTransform(
    entity: Entity,
    weapon: WeaponComponent,
    playerPos: { x: number; y: number },
    out: WeaponTransform
  ): void {
    const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const bodyHalfHeight = getBodyHalfHeight(entity.render, radius)
    out.x = playerPos.x
    out.y = playerPos.y + bodyHalfHeight + weapon.height / 2
    out.rotation = getWeaponStaggerDropRotationRad(weapon.weaponType)
  }
}
