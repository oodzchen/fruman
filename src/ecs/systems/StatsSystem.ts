import {
  DEATH_CROSS_DURATION_MS,
  DEATH_PRE_SPLATTER_PAUSE_MS,
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_DEATH_FLASH_DURATION,
  DEFAULT_DEATH_FLATTEN_DURATION,
  DEFAULT_HIT_SHAKE_DURATION_MS,
  DEFAULT_HIT_SHAKE_INTENSITY,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_POSTURE_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  ENEMY_PROBE_CHASE_DURATION_MS,
  HIT_STUN_HEAVY_MS,
  HIT_STUN_LIGHT_MS,
  HIT_STUN_MEDIUM_MS,
  IMPACT_LEVEL_KNOCKBACK,
  PARRY_ENEMY_POSTURE_DAMAGE,
  PARRY_SELF_POSTURE_RECOVERY,
  SOUND_DB_BODY_HIT,
  SOUND_DB_SWORD_BLOCK,
  STAGGER_DAMAGE_MULTIPLIER,
  STAGGER_DURATION_MS,
  STAGGER_HIT_STUN_DURATION_MS,
  STAGGER_KNOCKBACK_MULTIPLIER,
} from '../../constants'
import type { MainModule, WeaponVisualType, b2WorldId } from '../../types'
import { SOUND_IDS } from '../../worker/effectsProtocol'
import type { ImpactLevel } from '../AttackMoveData'
import { PhysicsComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { SoundSystem } from './SoundSystem'
import type { WeaponSystem } from './WeaponSystem'

export type EffectsEmitter = {
  emitSpark: (x: number, y: number) => void
  emitBlood: (x: number, y: number, color: number) => void
  emitDeath: (x: number, y: number, color: number, radius: number) => void
  playSound: (soundId: number, playbackRate?: number) => void
}

type ForcedHitStunLevel = 'light' | 'medium' | 'heavy'

const LARGE_LAUNCH_IMPULSE_NUMERATOR = 9
const LARGE_LAUNCH_IMPULSE_DENOMINATOR = 10
const EXTREME_LAUNCH_IMPULSE_NUMERATOR = 3
const EXTREME_LAUNCH_IMPULSE_DENOMINATOR = 2
const ULTIMATE_COOLDOWN_HIT_REWARD_MS = 1000
const ULTIMATE_COOLDOWN_KILL_REWARD_MS = 2000

export class StatsSystem extends System {
  private box2d?: MainModule
  private worldId?: b2WorldId
  private tempVec?: InstanceType<MainModule['b2Vec2']>
  private currentDeltaTime = 0
  private currentTimeMs = 0
  private effectsEmitter?: EffectsEmitter
  private weaponSystem?: WeaponSystem
  private soundSystem: SoundSystem | null = null
  private bloodEffectsEnabled = false
  private colorCache = new Map<string, number>()

  constructor(box2d?: MainModule, worldId?: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    if (box2d) {
      this.tempVec = new box2d.b2Vec2(0, 0)
    }
    const statsType = componentRegistry.getComponentType('Stats')
    this.setRequiredComponents([statsType])
  }

  update(entities: Entity[], deltaTime: number): void {
    this.currentDeltaTime = deltaTime
    const deltaSeconds = deltaTime > 0 ? deltaTime : 0
    const deltaMs = deltaSeconds * 1000
    const deltaMsInt = deltaMs > 0 ? Math.round(deltaMs) : 0
    this.currentTimeMs += deltaMs
    for (const entity of entities) {
      if (!entity.stats) continue
      if (entity.stats.isDead) {
        if (!entity.stats.isVanished) {
          entity.stats.deathElapsedMs += deltaMsInt
          entity.stats.deathElapsedSec = entity.stats.deathElapsedMs / 1000

          if (
            !entity.stats.deathEffectTriggered &&
            entity.stats.deathElapsedMs >= DEATH_CROSS_DURATION_MS
          ) {
            entity.stats.deathEffectTriggered = true
            if (entity.render && entity.transform && this.effectsEmitter) {
              const colorInt = this.parseColor(entity.render.color)
              const radius = entity.render.radius || DEFAULT_PLAYER_RADIUS
              this.effectsEmitter.emitDeath(
                entity.transform.x,
                entity.transform.y,
                colorInt,
                radius
              )
            }
            this.playSound(SOUND_IDS.DEATH_SPLASH)
          }

          const totalDurationMs =
            Math.round(
              (entity.stats.deathFlashDurationSec +
                entity.stats.deathFlattenDurationSec) *
                1000
            ) + DEATH_CROSS_DURATION_MS
          if (entity.stats.deathElapsedMs >= totalDurationMs) {
            entity.stats.isVanished = true
            if (entity.render) {
              entity.render.visible = false
            }
            this.removePhysics(entity)
          }
        }
        continue
      }

      if (entity.stats.hitShakeDurationMs > 0) {
        entity.stats.hitShakeElapsedMs += deltaMs
        if (entity.stats.hitShakeElapsedMs >= entity.stats.hitShakeDurationMs) {
          entity.stats.hitShakeDurationMs = 0
          entity.stats.hitShakeElapsedMs = 0
        }
      }

      // 检查架势归零触发崩塌
      if (!entity.stats.isStaggered && entity.stats.posture <= 0) {
        this.triggerStagger(entity)
      }

      // 处理崩塌状态
      if (entity.stats.isStaggered) {
        entity.stats.staggerElapsedTime += deltaTime
        entity.stats.staggerAnimationElapsed += deltaMs
        this.updateStaggerAnimation(entity)

        const elapsedMs = entity.stats.staggerElapsedTime * 1000
        if (elapsedMs >= entity.stats.staggerDuration) {
          entity.stats.isStaggered = false
          entity.stats.staggerElapsedTime = 0
          entity.stats.staggerAnimationPhase = 'none'
          entity.stats.staggerAnimationElapsed = 0
          entity.stats.posture = entity.stats.maxPosture

          // 崩塌自动恢复时重置连击状态
          if (entity.weapon) {
            entity.weapon.comboCount = 0
            entity.weapon.swingDirection = 'toFront'
            entity.weapon.nextSwingDirection = 'toFront'
            entity.weapon.attackPhase = 'idle'
            entity.weapon.attackElapsedMs = 0
            entity.weapon.attackQueued = false
            entity.weapon.isBlocking = false
            entity.weapon.isParrying = false
            entity.weapon.parryElapsedTime = 0
            entity.weapon.hitEntityIds.clear()
          }

          if (entity.enemyAI) {
            entity.enemyAI.state = 'approach'
            entity.enemyAI.comboSwingsDone = 0
            entity.enemyAI.probeSwitchTimerMs = 0
            entity.enemyAI.probePaceTimerMs = 0
            entity.enemyAI.probePaceDirection = 1
            entity.enemyAI.probePaceMovedDistance = 0
            entity.enemyAI.probeLastPositionX = 0
            entity.enemyAI.probeLastPositionY = 0
            entity.enemyAI.probeHasTriggered = false
            if (entity.movement) {
              entity.movement.moveSpeed = entity.enemyAI.moveSpeed
            }
          }
        }
        continue
      }

      if (entity.stats.posture < entity.stats.maxPosture) {
        let recoveryRate = entity.stats.postureRecoveryPerSecond
        if (entity.weapon?.isBlocking) {
          recoveryRate *= 2
        }
        const recovery = recoveryRate * deltaSeconds
        entity.stats.posture = Math.min(
          entity.stats.maxPosture,
          entity.stats.posture + recovery
        )
      }

      if (
        entity.stats.toughness < entity.stats.maxToughness &&
        !entity.stats.isStaggered
      ) {
        const isInHitStun =
          entity.movement &&
          entity.movement.knockbackDuration > 0 &&
          entity.movement.knockbackElapsedTime * 1000 <
            entity.movement.knockbackDuration
        if (!isInHitStun) {
          const recovery =
            entity.stats.toughnessRecoveryPerSecond * deltaSeconds
          entity.stats.toughness = Math.min(
            entity.stats.maxToughness,
            entity.stats.toughness + recovery
          )
        }
      }

      // 战斗状态管理
      if (entity.stats.isInCombat) {
        const isPlayer = entity.faction?.faction === 'player'

        if (isPlayer) {
          // 玩家：基于deltaTime累积计时，每次战斗动作重置
          entity.stats.combatExitTimer += deltaMs
          if (entity.stats.combatExitTimer >= entity.stats.combatExitTimeout) {
            if (entity.weapon?.bowFreeAim) {
              entity.stats.combatExitTimer = 0
            } else {
              entity.stats.isInCombat = false
              entity.stats.combatExitTimer = 0
              if (entity.weapon) {
                entity.weapon.comboCount = 0
                entity.weapon.attackQueued = false
                entity.weapon.nextSwingDirection = 'toFront'
              }
            }
          }
        } else {
          // 敌人：基于检测目标
          const hasTarget = entity.sensor?.detectedTargetId !== null
          if (hasTarget) {
            entity.stats.combatExitTimer = 0
          } else {
            entity.stats.combatExitTimer += deltaMs
            if (
              entity.stats.combatExitTimer >= entity.stats.combatExitTimeout
            ) {
              entity.stats.isInCombat = false
              entity.stats.combatExitTimer = 0
              if (entity.weapon) {
                entity.weapon.comboCount = 0
                entity.weapon.attackQueued = false
                entity.weapon.nextSwingDirection = 'toFront'
              }
            }
          }
        }
      }

      if (entity.stats.hudVisibleTimer > 0) {
        entity.stats.hudVisibleTimer = Math.max(
          0,
          entity.stats.hudVisibleTimer - deltaMs
        )
      }
    }
  }

  enterCombat(entity: Entity): void {
    if (!entity.stats) return
    entity.stats.isInCombat = true
    entity.stats.combatExitTimer = 0
  }

  exitCombat(entity: Entity): void {
    if (!entity.stats) return
    entity.stats.isInCombat = false
    entity.stats.combatExitTimer = 0
  }

  setEffectsEmitter(emitter: EffectsEmitter | null): void {
    this.effectsEmitter = emitter ?? undefined
  }

  setWeaponSystem(weaponSystem: WeaponSystem | null): void {
    this.weaponSystem = weaponSystem ?? undefined
  }

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setBloodEffectsEnabled(enabled: boolean): void {
    this.bloodEffectsEnabled = enabled
  }

  emitSpark(x: number, y: number): void {
    if (!this.effectsEmitter) return
    this.effectsEmitter.emitSpark(x, y)
  }

  emitDeath(x: number, y: number, color: number, radius: number): void {
    if (!this.effectsEmitter) return
    this.effectsEmitter.emitDeath(x, y, color, radius)
  }

  playSound(soundId: number, playbackRate?: number): void {
    if (!this.effectsEmitter) return
    this.effectsEmitter.playSound(soundId, playbackRate)
  }

  private emitSoundFromEntity(entity: Entity, db: number): void {
    if (!this.soundSystem || !entity.transform) return
    const radius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    this.soundSystem.emitSoundAt(
      entity.transform.x,
      entity.transform.y,
      radius,
      db
    )
  }

  applyForcedHitStun(
    entity: Entity,
    level: ForcedHitStunLevel,
    durationOverrideMs?: number
  ): void {
    if (!entity.movement) return
    const durationMs =
      durationOverrideMs ?? this.getForcedHitStunDuration(level)
    if (durationMs <= 0) return
    const currentDuration = entity.movement.knockbackDuration
    const currentElapsedMs = entity.movement.knockbackElapsedTime * 1000
    const isActive = currentDuration > 0 && currentElapsedMs < currentDuration
    if (isActive && currentDuration > durationMs) {
      return
    }
    entity.movement.knockbackDuration = durationMs
    entity.movement.knockbackElapsedTime = 0
    entity.movement.knockbackEndTime = this.currentTimeMs + durationMs
  }

  applyParryDamage(defender: Entity, attacker: Entity): boolean {
    if (!defender.stats || !attacker.stats) {
      return false
    }

    const newPosture = attacker.stats.posture - PARRY_ENEMY_POSTURE_DAMAGE
    attacker.stats.posture = Math.max(0, newPosture)

    defender.stats.posture = Math.min(
      defender.stats.maxPosture,
      defender.stats.posture + PARRY_SELF_POSTURE_RECOVERY
    )

    return newPosture <= 0
  }

  applyParryRecovery(defender: Entity): void {
    if (!defender.stats) return

    defender.stats.posture = Math.min(
      defender.stats.maxPosture,
      defender.stats.posture + PARRY_SELF_POSTURE_RECOVERY
    )
  }

  applyImpulse(entity: Entity, impulseX: number, impulseY: number): void {
    if (!entity.physics || !this.box2d || !this.tempVec) return

    const { b2Body_ApplyLinearImpulseToCenter } = this.box2d
    this.tempVec.x = impulseX
    this.tempVec.y = impulseY
    b2Body_ApplyLinearImpulseToCenter(entity.physics.bodyId, this.tempVec, true)
  }

  triggerStagger(entity: Entity): void {
    if (!entity.stats) return

    this.playSound(SOUND_IDS.BODY_HIT, 0.3)
    this.emitSoundFromEntity(entity, SOUND_DB_BODY_HIT)

    entity.stats.isStaggered = true
    entity.stats.staggerElapsedTime = 0
    entity.stats.staggerDuration = STAGGER_DURATION_MS
    entity.stats.staggerAnimationPhase = 'rotateBack'
    entity.stats.staggerAnimationElapsed = 0

    // 崩塌时打断攻击并启动武器掉落
    if (entity.weapon && entity.transform) {
      entity.weapon.attackPhase = 'idle'
      entity.weapon.attackElapsedMs = 0
      entity.weapon.attackQueued = false
      entity.weapon.isBlocking = false
      entity.weapon.isParrying = false
      entity.weapon.parryElapsedTime = 0
      entity.weapon.hitEntityIds.clear()

      // 启动武器掉落 logic
      const weapon = entity.weapon
      weapon.isDropping = true
      weapon.isDropped = false
      weapon.isRecovering = false
      weapon.dropElapsedTime = 0

      // 计算起始相对偏移（当前武器位置相对于玩家）
      const dx = weapon.visual.x - entity.transform.x
      const dy = weapon.visual.y - entity.transform.y
      weapon.dropStartOffset.dx = dx
      weapon.dropStartOffset.dy = dy
      weapon.dropStartOffset.rotation = weapon.visual.rotation

      // 目标相对偏移：角色脚下横放（位于角色中心正下方地面）
      const radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
      weapon.dropEndOffset.dx = 0
      weapon.dropEndOffset.dy = radius - DEFAULT_WEAPON_HEIGHT / 2
      weapon.dropEndOffset.rotation = 0
    }
  }

  private updateStaggerAnimation(entity: Entity): void {
    if (!entity.stats || !entity.movement) return

    const elapsed = entity.stats.staggerAnimationElapsed
    const facing = entity.input?.lastMoveDirection || 1

    // Phase 1: 向后旋转 (0 - 300ms)
    // 目标角度: 向后倾斜30度 (PI/6)
    // 如果面向右(1)，向后是逆时针(-)，即 -30度
    // 如果面向左(-1)，向后是顺时针(+)，即 +30度
    const backAngle = -facing * (Math.PI / 6)

    // Phase 2: 向前俯趴 (300 - 500ms)
    // 目标角度: 向前倒下90度 (PI/2)
    // 如果面向右(1)，向前是顺时针(+)，即 +90度
    // 如果面向左(-1)，向前是逆时针(-)，即 -90度
    const proneAngle = facing * (Math.PI / 2)

    if (elapsed < 1200) {
      entity.stats.staggerAnimationPhase = 'rotateBack'
      const t = elapsed / 1200
      // 缓动
      const easedT = 1 - Math.pow(1 - t, 2)
      entity.movement.rollAngle = backAngle * easedT
    } else if (elapsed < 1500) {
      entity.stats.staggerAnimationPhase = 'prone'
      const t = (elapsed - 1200) / 300
      // 缓动
      const easedT = t * t // 加速倒下
      entity.movement.rollAngle = backAngle + (proneAngle - backAngle) * easedT
    } else {
      // 保持俯趴姿态
      entity.stats.staggerAnimationPhase = 'prone'
      entity.movement.rollAngle = proneAngle
    }
  }

  applyStandardHit(entity: Entity): void {
    this.applyWeaponHit(entity)
  }

  applyWeaponHit(
    entity: Entity,
    weapon?: {
      attackDamage: number
      postureDamage: number
      toughnessDamage: number
      impactLevel?: ImpactLevel
      weaponType?: WeaponVisualType
    },
    hitSource?: { x: number; y: number },
    attacker?: Entity
  ): void {
    const attackDamage = Math.max(
      0,
      weapon?.attackDamage ?? DEFAULT_WEAPON_ATTACK_DAMAGE
    )
    const postureDamage = Math.max(
      0,
      weapon?.postureDamage ?? DEFAULT_WEAPON_POSTURE_DAMAGE
    )
    const toughnessDamage = Math.max(
      0,
      weapon?.toughnessDamage ?? DEFAULT_WEAPON_TOUGHNESS_DAMAGE
    )
    const impactLevel: ImpactLevel = weapon?.impactLevel ?? 'small'
    this.applyDamage(
      entity,
      attackDamage,
      postureDamage,
      toughnessDamage,
      impactLevel,
      hitSource,
      weapon?.weaponType,
      attacker
    )
  }

  private applyDamage(
    entity: Entity,
    healthDamage: number,
    postureDamage: number,
    toughnessDamage: number,
    impactLevel: ImpactLevel,
    hitSource?: { x: number; y: number },
    weaponType?: WeaponVisualType,
    attacker?: Entity
  ): void {
    if (!entity.stats) return
    if (entity.stats.isDead) return
    if (entity.stats.isInvincible) return

    // Enter combat state on damage taken
    this.enterCombat(entity)
    if (entity.enemyAI && hitSource && entity.transform) {
      const dx = hitSource.x - entity.transform.x
      entity.enemyAI.forcedChaseDirection = dx >= 0 ? 1 : -1
      entity.enemyAI.forcedChaseDistanceRemaining =
        entity.enemyAI.detectionRange * 2
      entity.enemyAI.forcedChaseLastX = entity.transform.x
    }
    if (entity.enemyAI && weaponType === 'arrow' && entity.stats) {
      const parryProficiency = entity.enemyAI.parryProficiency
      if (parryProficiency > 50) {
        const shouldDefend =
          parryProficiency >= 100 ||
          Math.random() < (parryProficiency - 50) / 50
        if (shouldDefend) {
          entity.enemyAI.arrowDefenseTimeRemainingMs =
            entity.stats.combatExitTimeout
          entity.enemyAI.arrowDefenseActive = true
          entity.enemyAI.arrowDefenseSwitchTimerMs =
            parryProficiency >= 100 ? 0 : 2000 + Math.random() * 2000
        } else {
          entity.enemyAI.arrowDefenseTimeRemainingMs = 0
          entity.enemyAI.arrowDefenseActive = false
          entity.enemyAI.arrowDefenseSwitchTimerMs = 0
        }
      } else {
        entity.enemyAI.arrowDefenseTimeRemainingMs = 0
        entity.enemyAI.arrowDefenseActive = false
        entity.enemyAI.arrowDefenseSwitchTimerMs = 0
      }
    }

    // 翻滚期间无敌
    if (entity.movement?.isRolling) return

    let finalHealthDamage = Math.max(0, healthDamage)
    let finalPostureDamage = Math.max(0, postureDamage)
    let finalToughnessDamage = Math.max(0, toughnessDamage)
    let finalKnockback = IMPACT_LEVEL_KNOCKBACK[impactLevel]

    // 崩塌期间受击：伤害翻倍、击退加强、解除崩塌
    const wasStaggered = entity.stats.isStaggered
    if (wasStaggered) {
      finalHealthDamage *= STAGGER_DAMAGE_MULTIPLIER
      finalKnockback *= STAGGER_KNOCKBACK_MULTIPLIER
      finalPostureDamage = 0
      entity.stats.isStaggered = false
      entity.stats.staggerElapsedTime = 0
      entity.stats.staggerAnimationPhase = 'none'
      entity.stats.staggerAnimationElapsed = 0
      entity.stats.posture = entity.stats.maxPosture

      // 崩塌受击解除时重置连击状态
      if (entity.weapon) {
        entity.weapon.comboCount = 0
        entity.weapon.swingDirection = 'toFront'
        entity.weapon.nextSwingDirection = 'toFront'
        entity.weapon.attackPhase = 'idle'
        entity.weapon.attackElapsedMs = 0
        entity.weapon.attackQueued = false
        entity.weapon.isBlocking = false
        entity.weapon.isParrying = false
        entity.weapon.parryElapsedTime = 0
        entity.weapon.hitEntityIds.clear()
      }
    }

    // 格挡逻辑
    let isBlockingSuccessfully = false
    if (entity.weapon?.isBlocking && hitSource && entity.transform) {
      const dx = hitSource.x - entity.transform.x
      // 获取当前朝向
      const facing =
        entity.input?.lastMoveDirection !== 0
          ? (entity.input?.lastMoveDirection ?? 1)
          : entity.weapon.attackFacing || 1

      // 判断攻击来源是否在前方
      const isFrontalHit = (facing > 0 && dx > 0) || (facing < 0 && dx < 0)

      if (isFrontalHit) {
        isBlockingSuccessfully = true
        finalHealthDamage = 0
        finalKnockback = 0
        finalToughnessDamage = 0
        this.playSound(SOUND_IDS.SWORD_BLOCK)
        this.emitSoundFromEntity(entity, SOUND_DB_SWORD_BLOCK)
      }
    }

    if (entity.enemyAI && entity.enemyAI.state === 'probe') {
      entity.enemyAI.state = 'approach'
      entity.enemyAI.comboSwingsDone = 0
      entity.enemyAI.probeSwitchTimerMs = ENEMY_PROBE_CHASE_DURATION_MS
      entity.enemyAI.probePaceTimerMs = 0
      entity.enemyAI.probePaceDirection = 1
      entity.enemyAI.probePaceMovedDistance = 0
      entity.enemyAI.probeLastPositionX = 0
      entity.enemyAI.probeLastPositionY = 0
      entity.enemyAI.probeHasTriggered = true
      if (entity.movement) {
        entity.movement.moveSpeed = entity.enemyAI.moveSpeed
      }
    }

    if (entity.stats.debugNoDamage) {
      finalHealthDamage = 0
      finalPostureDamage = 0
      finalToughnessDamage = 0
      finalKnockback = 0
    }

    const healthBefore = entity.stats.health
    entity.stats.health = Math.max(0, entity.stats.health - finalHealthDamage)
    entity.stats.posture = Math.max(
      0,
      entity.stats.posture - finalPostureDamage
    )
    const toughnessBefore = entity.stats.toughness
    entity.stats.toughness = Math.max(
      0,
      entity.stats.toughness - finalToughnessDamage
    )
    const isLethalHit =
      finalHealthDamage > 0 && healthBefore > 0 && entity.stats.health === 0
    const toughnessBroken = toughnessBefore > 0 && entity.stats.toughness <= 0
    const isInHitStun = !!(
      entity.movement &&
      entity.movement.knockbackDuration > 0 &&
      entity.movement.knockbackElapsedTime * 1000 <
        entity.movement.knockbackDuration
    )
    const shouldTriggerHitEffects =
      finalHealthDamage > 0 && !toughnessBroken && !isInHitStun

    this.rewardUltimateCooldown(
      attacker,
      entity,
      ULTIMATE_COOLDOWN_HIT_REWARD_MS
    )

    if (entity.stats.posture <= 0 && !wasStaggered) {
      this.triggerStagger(entity)
    }

    // 极大冲击力在韧性被清空时强制触发倒地
    let extremeKnockdown = false
    if (
      impactLevel === 'extreme' &&
      toughnessBroken &&
      !wasStaggered &&
      !entity.stats.isStaggered
    ) {
      this.triggerStagger(entity)
      extremeKnockdown = true
    }

    if (hitSource && entity.transform) {
      const dirX = entity.transform.x - hitSource.x
      const dirY = entity.transform.y - hitSource.y
      const distance = Math.hypot(dirX, dirY)
      const normalizedDirX = distance > 0 ? dirX / distance : 1

      if (toughnessBroken) {
        entity.stats.hitShakeElapsedMs = 0
        entity.stats.hitShakeDurationMs = 0
      }

      if (shouldTriggerHitEffects) {
        entity.stats.hitShakeElapsedMs = 0
        entity.stats.hitShakeDurationMs = DEFAULT_HIT_SHAKE_DURATION_MS
        entity.stats.hitShakeIntensity = DEFAULT_HIT_SHAKE_INTENSITY
        entity.stats.hitShakeDirectionX = normalizedDirX
        if (this.bloodEffectsEnabled && entity.render && this.effectsEmitter) {
          const radius = entity.render.radius || DEFAULT_PLAYER_RADIUS
          const invDistance = distance > 0 ? 1 / distance : 0
          const hitX = entity.transform.x - dirX * invDistance * radius
          const hitY = entity.transform.y - dirY * invDistance * radius
          const colorInt = this.parseColor(entity.render.color)
          this.effectsEmitter.emitBlood(hitX, hitY, colorInt)
        }
        this.playSound(
          isLethalHit ? SOUND_IDS.BODY_HIT_SHARP : SOUND_IDS.BODY_HIT
        )
        this.emitSoundFromEntity(entity, SOUND_DB_BODY_HIT)
      } else if (toughnessBroken) {
        this.playSound(
          isLethalHit ? SOUND_IDS.BODY_HIT_SHARP : SOUND_IDS.BODY_HIT
        )
        this.emitSoundFromEntity(entity, SOUND_DB_BODY_HIT)
      }

      if (
        (toughnessBroken || wasStaggered || extremeKnockdown) &&
        !isBlockingSuccessfully
      ) {
        const hitStunOverrideMs = wasStaggered
          ? STAGGER_HIT_STUN_DURATION_MS
          : undefined
        this.applyForcedHitStun(entity, 'medium', hitStunOverrideMs)

        if (entity.weapon) {
          entity.weapon.attackPhase = 'idle'
          entity.weapon.attackElapsedMs = 0
          entity.weapon.attackQueued = false
          entity.weapon.isColliding = false
          entity.weapon.isBlocking = false
          entity.weapon.isParrying = false
          entity.weapon.parryElapsedTime = 0
          entity.weapon.hitEntityIds.clear()
          entity.weapon.comboCount = 0
          entity.weapon.swingDirection = 'toFront'
          entity.weapon.nextSwingDirection = 'toFront'
          // 保持 isInCombat 为 true，因为受击通常意味着还在战斗中
        }

        // 重置敌人AI状态
        if (entity.enemyAI) {
          entity.enemyAI.state = 'approach'
          entity.enemyAI.comboSwingsDone = 0
          entity.enemyAI.probeSwitchTimerMs = ENEMY_PROBE_CHASE_DURATION_MS
          entity.enemyAI.probePaceTimerMs = 0
          entity.enemyAI.probePaceDirection = 1
          entity.enemyAI.probePaceMovedDistance = 0
          entity.enemyAI.probeLastPositionX = 0
          entity.enemyAI.probeLastPositionY = 0
          entity.enemyAI.probeHasTriggered = true
          if (entity.movement) {
            entity.movement.moveSpeed = entity.enemyAI.moveSpeed
          }
        }
      }

      if (
        finalKnockback > 0 &&
        (toughnessBroken || wasStaggered) &&
        entity.physics &&
        this.box2d &&
        this.tempVec
      ) {
        const { b2Body_ApplyLinearImpulseToCenter, b2Body_GetMass } = this.box2d
        const mass = b2Body_GetMass(entity.physics.bodyId)

        const impulseX = normalizedDirX * finalKnockback * 2 * mass
        let impulseY = 0
        if (impactLevel === 'extreme') {
          impulseY = -(
            (finalKnockback * EXTREME_LAUNCH_IMPULSE_NUMERATOR * mass) /
            EXTREME_LAUNCH_IMPULSE_DENOMINATOR
          )
        } else if (impactLevel === 'large') {
          impulseY = -(
            (finalKnockback * LARGE_LAUNCH_IMPULSE_NUMERATOR * mass) /
            LARGE_LAUNCH_IMPULSE_DENOMINATOR
          )
        }
        this.tempVec.x = impulseX
        this.tempVec.y = impulseY

        b2Body_ApplyLinearImpulseToCenter(
          entity.physics.bodyId,
          this.tempVec,
          true
        )

        if (impulseY < 0 && entity.movement) {
          entity.movement.isGrounded = false
          entity.movement.wasGrounded = false
        }

        // 仅对物理击退进行冲量处理
      }
    }

    if (entity.stats.health === 0) {
      if (entity.stats.debugNoDeath) {
        entity.stats.health = entity.stats.maxHealth
        entity.stats.posture = entity.stats.maxPosture
        entity.stats.toughness = entity.stats.maxToughness
        return
      }

      this.rewardUltimateCooldown(
        attacker,
        entity,
        ULTIMATE_COOLDOWN_KILL_REWARD_MS
      )

      this.dropWeaponsOnDeath(entity)
      entity.stats.isDead = true
      entity.stats.isVanished = false
      entity.stats.deathElapsedSec = 0
      entity.stats.deathElapsedMs = 0
      entity.stats.deathFlashDurationSec = DEFAULT_DEATH_FLASH_DURATION
      entity.stats.deathFlattenDurationSec = DEFAULT_DEATH_FLATTEN_DURATION
      entity.stats.deathEffectTriggered = false
      if (entity.render) {
        entity.render.visible = true
      }
      if (entity.input) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
        entity.input.attackRequested = false
      }
      if (entity.weapon) {
        entity.weapon.attackPhase = 'idle'
        entity.weapon.attackElapsedMs = 0
        entity.weapon.attackQueued = false
        entity.weapon.isColliding = false
        entity.weapon.isBlocking = false
        entity.weapon.isParrying = false
        entity.weapon.parryElapsedTime = 0
        entity.weapon.hitEntityIds.clear()
      }
      this.stabilizeBody(entity)
    }
  }

  private rewardUltimateCooldown(
    attacker: Entity | undefined,
    target: Entity,
    rewardMs: number
  ): void {
    if (!attacker?.attackSlots || rewardMs <= 0) return
    if (target.faction?.faction !== 'enemy') return
    const slot = attacker.attackSlots.ultimate
    if (!slot.hasMoveset || slot.cooldownRemainingMs <= 0) return
    slot.cooldownRemainingMs = Math.max(0, slot.cooldownRemainingMs - rewardMs)
  }

  revive(entity: Entity): void {
    if (!entity.stats) return

    entity.stats.health = entity.stats.maxHealth
    entity.stats.posture = entity.stats.maxPosture
    entity.stats.toughness = entity.stats.maxToughness
    entity.stats.isDead = false
    entity.stats.isVanished = false
    entity.stats.deathElapsedSec = 0
    entity.stats.deathElapsedMs = 0
    entity.stats.deathEffectTriggered = false
    if (entity.render) {
      entity.render.visible = true
    }
    if (!entity.physics) {
      this.recreatePhysics(entity)
    }
  }

  private dropWeaponsOnDeath(entity: Entity): void {
    if (!this.weaponSystem) return
    this.weaponSystem.dropWeaponsOnDeath(entity)
  }

  private stabilizeBody(entity: Entity): void {
    if (!this.box2d || !entity.physics || !this.tempVec) return

    const { b2Body_SetLinearVelocity, b2Body_SetLinearDamping } = this.box2d
    this.tempVec.x = 0
    this.tempVec.y = 0
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
    b2Body_SetLinearDamping(entity.physics.bodyId, 10)

    if (entity.physics.shapeId) {
      const { b2Shape_SetFriction } = this.box2d
      b2Shape_SetFriction(entity.physics.shapeId, 3)
    }
  }

  private removePhysics(entity: Entity): void {
    if (!this.box2d) return
    if (!entity.physics) return

    const { b2DestroyBody } = this.box2d
    b2DestroyBody(entity.physics.bodyId)
    entity.removeComponent('Physics')
  }

  private recreatePhysics(entity: Entity): void {
    if (!this.box2d || !this.worldId) return
    if (!entity.transform) return

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2Capsule,
      b2DefaultShapeDef,
      b2CreateCapsuleShape,
    } = this.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(entity.transform.x, entity.transform.y)
    bodyDef.motionLocks.angularZ = true
    bodyDef.linearDamping = DEFAULT_BODY_LINEAR_DAMPING
    const bodyId = b2CreateBody(this.worldId, bodyDef)

    const shape = new b2Capsule()
    shape.center1.Set(0, 0)
    shape.center2.Set(0, 0)
    shape.radius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    const fixtureDef = b2DefaultShapeDef()
    fixtureDef.density = 1.0
    fixtureDef.material.friction = DEFAULT_BODY_FRICTION
    const shapeId = b2CreateCapsuleShape(bodyId, fixtureDef, shape)

    bodyDef.delete()
    shape.delete()
    fixtureDef.delete()

    const physics = new PhysicsComponent()
    physics.bodyId = bodyId
    physics.shapeId = shapeId
    entity.addComponent(physics)
  }

  private parseColor(color: string): number {
    const cached = this.colorCache.get(color)
    if (cached !== undefined) return cached
    if (color.startsWith('#')) {
      const hex = color.slice(1)
      const value = parseInt(hex, 16)
      this.colorCache.set(color, value)
      return value
    }
    return 0
  }

  private getForcedHitStunDuration(level: ForcedHitStunLevel): number {
    switch (level) {
      case 'light':
        return HIT_STUN_LIGHT_MS
      case 'medium':
        return HIT_STUN_MEDIUM_MS
      case 'heavy':
        return HIT_STUN_HEAVY_MS
      default:
        return 0
    }
  }
}
