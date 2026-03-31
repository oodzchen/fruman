import {
  BOW_MIN_WINDUP_MS,
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_SPRINT_SPEED,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  ENEMY_ALERT_ACCEL_RANGE_MULTIPLIER,
  ENEMY_ALERT_PACE_SPEED_MULTIPLIER,
  ENEMY_ALERT_RANGE_MULTIPLIER,
  ENEMY_LEAP_ATTACK_CHANCE,
  ENEMY_LEAP_ATTACK_COOLDOWN_MS,
  ENEMY_LEAP_ATTACK_MAX_DISTANCE_MULTIPLIER,
  ENEMY_LEAP_ATTACK_MAX_DURATION_MS,
  ENEMY_LEAP_ATTACK_MIN_DISTANCE_MULTIPLIER,
  ENEMY_PACE_MIN_DISTANCE,
  ENEMY_PACE_MIN_PAUSE_MS,
  ENEMY_PACE_MIN_SWITCH_INTERVAL_MS,
  ENEMY_PACE_SPEED,
  ENEMY_PROBE_CHASE_DURATION_MS,
  ENEMY_PROBE_DISTANCE_MULTIPLIER,
  ENEMY_PROBE_DURATION_MAX_MS,
  ENEMY_PROBE_DURATION_MIN_MS,
  ENEMY_PROBE_PACE_MIN_DISTANCE,
  ENEMY_PROBE_PACE_SWITCH_INTERVAL_MS,
  ENEMY_PROBE_RANGE_BUFFER_RATIO,
  ENEMY_PROBE_SPEED_MULTIPLIER,
  ENEMY_RETREAT_EXTRA_DISTANCE,
  WEAPON_DEFAULT_DATA,
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { ATTACK_MOVESETS } from '../AttackMoveRegistry'
import { EnemyAIComponent, Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { WeaponSystem } from './WeaponSystem'

const ARCHER_MELEE_RANGE_RATIO = 0.25
const ENEMY_LOCK_LOST_TIMEOUT_MS = 3000

export class EnemyAISystem extends System {
  private player?: Entity
  private weaponSystem?: WeaponSystem
  private box2d: MainModule
  private worldId: b2WorldId
  private currentTimeMs = 0

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    const transformType = componentRegistry.getComponentType('Transform')
    const inputType = componentRegistry.getComponentType('Input')
    const factionType = componentRegistry.getComponentType('Faction')
    const aiType = componentRegistry.getComponentType('EnemyAI')
    const sensorType = componentRegistry.getComponentType('Sensor')
    this.setRequiredComponents([
      transformType,
      inputType,
      factionType,
      aiType,
      sensorType,
    ])
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  setWeaponSystem(weaponSystem: WeaponSystem): void {
    this.weaponSystem = weaponSystem
  }

  private getArcherBowMinWindupMs(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon || weapon.weaponType === 'arrow') {
      return BOW_MIN_WINDUP_MS
    }
    const template = WEAPON_DEFAULT_DATA[weapon.weaponType]
    if (!template) {
      return BOW_MIN_WINDUP_MS
    }
    const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
    const currentLevel =
      Number.isFinite(weapon.sizeLevel) && weapon.sizeLevel > 0
        ? weapon.sizeLevel
        : baseLevel
    const numerator = Math.max(1, 3 + (currentLevel - baseLevel))
    return Math.max(1, Math.floor((BOW_MIN_WINDUP_MS * numerator) / 3))
  }

  update(entities: Entity[], deltaTime: number): void {
    if (!this.player?.transform) {
      this.resetEnemies(entities)
      return
    }

    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0
    this.currentTimeMs += deltaMs
    const now = this.currentTimeMs

    // Build entity lookup map for target resolution
    const entityMap = new Map<number, Entity>()
    for (const e of entities) {
      entityMap.set(e.id, e)
    }

    // Count active attackers (Red Tape System)
    let activeAttackers = 0
    for (const entity of entities) {
      if (
        !!entity.enemyAI &&
        !entity.stats?.isDead &&
        entity.enemyAI.state === 'combo'
      ) {
        activeAttackers++
      }
    }

    for (const entity of entities) {
      if (!entity.transform || !entity.input || !entity.enemyAI) continue

      // Resolve target: prefer sensor-detected, fall back to lockedTargetId, then player
      let target = this.player
      if (entity.sensor?.detectedTargetId != null) {
        const sensed = entityMap.get(entity.sensor.detectedTargetId)
        if (sensed?.transform && !sensed.stats?.isDead) target = sensed
      } else if (
        entity.input.lockedTargetId != null &&
        entity.input.lockedTargetId !== this.player.id
      ) {
        const locked = entityMap.get(entity.input.lockedTargetId)
        if (locked?.transform && !locked.stats?.isDead) target = locked
      }
      if (!target.transform) continue

      // No valid target for this entity — clear combat state
      if (
        entity.faction &&
        target.faction &&
        !entity.faction.canAttackEntity(target.faction, target.id.toString())
      ) {
        if (entity.stats?.isInCombat) entity.stats.isInCombat = false
        entity.enemyAI.forcedChaseDistanceRemaining = 0
        entity.enemyAI.alertChaseActive = false
        if (entity.input.lockedTargetId !== null) {
          entity.input.lockedTargetId = null
          entity.input.lockLostTimer = 0
        }
        if (entity.weapon) entity.weapon.attackQueued = false
        if (entity.enemyAI.retreatEnabled) {
          this.handlePatrol(entity, entity.enemyAI, now)
        } else {
          entity.input.moveDirection = 0
          entity.input.sprintRequested = false
        }
        continue
      }
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        entity.input.blockRequested = false
        if (entity.weapon) {
          entity.weapon.attackQueued = false
        }
        continue
      }

      // 如果处于击退硬直中，暂停AI控制，让物理引擎接管运动
      if (entity.movement && entity.movement.knockbackEndTime > now) {
        entity.input.blockRequested = false
        continue
      }

      const ai = entity.enemyAI

      const dx = target.transform.x - entity.transform.x
      const dy = target.transform.y - entity.transform.y
      const distance = Math.hypot(dx, dy)
      const facing = dx >= 0 ? 1 : -1
      if (Math.abs(dx) >= ENEMY_PACE_MIN_DISTANCE) {
        ai.lastFacing = facing
      }
      const stableFacing = ai.lastFacing

      // 跳跃攻击优先处理：每帧执行，绕过冷却/巡逻/警戒等干扰
      if (ai.state === 'leapAttack') {
        this.handleLeapAttack(entity, ai, facing, now)
        continue
      }

      // Red Tape System: High proficiency enemies wait their turn
      ai.isRedTapeActive = false
      if (
        ai.redTapeEnabled &&
        ai.parryProficiency > 50 &&
        activeAttackers > 0 &&
        ai.state !== 'combo'
      ) {
        ai.isRedTapeActive = true
      }
      const effectiveAttackDesire = ai.isRedTapeActive ? 0 : ai.attackDesire

      // 计算武器的有效攻击半径（与 WeaponSystem.getAttackRadius 相同逻辑）
      const weaponAttackRadius = this.getWeaponAttackRadius(entity)
      // 考虑目标的半径，得到实际可攻击的距离
      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const weaponRange = weaponAttackRadius + targetRadius

      // 使用传感器结果判断视线
      const hasSensorContact =
        entity.sensor && entity.sensor.detectedTargetId === target.id
      const alertRange = ai.detectionRange * ENEMY_ALERT_RANGE_MULTIPLIER
      const hasCombatLineOfSight =
        hasSensorContact && distance <= ai.detectionRange
      const hasAlertLineOfSight = hasSensorContact && distance <= alertRange
      const isTargetSwinging = target.weapon
        ? target.weapon.attackPhase === 'swing'
        : false
      this.updateParryState(
        entity,
        ai,
        isTargetSwinging,
        distance,
        weaponRange,
        !!hasCombatLineOfSight
      )
      const isEngaged =
        !!hasCombatLineOfSight ||
        !!entity.stats?.isInCombat ||
        ai.alertChaseActive
      this.updateProbeCycle(
        entity,
        ai,
        effectiveAttackDesire,
        deltaMs,
        isEngaged,
        distance,
        weaponRange
      )

      if (ai.parryProficiency <= 50 && ai.arrowDefenseTimeRemainingMs > 0) {
        ai.arrowDefenseTimeRemainingMs = 0
        ai.arrowDefenseSwitchTimerMs = 0
        ai.arrowDefenseActive = false
      }

      if (ai.arrowDefenseActive && distance <= weaponRange) {
        ai.arrowDefenseTimeRemainingMs = 0
        ai.arrowDefenseSwitchTimerMs = 0
        ai.arrowDefenseActive = false
      }

      if (ai.arrowDefenseTimeRemainingMs > 0) {
        ai.arrowDefenseTimeRemainingMs = Math.max(
          0,
          ai.arrowDefenseTimeRemainingMs - deltaMs
        )
        ai.arrowDefenseSwitchTimerMs -= deltaMs
        if (
          ai.arrowDefenseTimeRemainingMs > 0 &&
          ai.arrowDefenseSwitchTimerMs <= 0 &&
          ai.parryProficiency < 100
        ) {
          ai.arrowDefenseActive = !ai.arrowDefenseActive
          ai.arrowDefenseSwitchTimerMs = 2000 + Math.random() * 2000
        }
        if (ai.arrowDefenseTimeRemainingMs === 0) {
          ai.arrowDefenseActive = false
          ai.arrowDefenseSwitchTimerMs = 0
        }
      }

      const wasForcedChasing = ai.forcedChaseDistanceRemaining > 0
      if (wasForcedChasing) {
        const movedDistance = Math.abs(entity.transform.x - ai.forcedChaseLastX)
        ai.forcedChaseDistanceRemaining = Math.max(
          0,
          ai.forcedChaseDistanceRemaining - movedDistance
        )
        ai.forcedChaseLastX = entity.transform.x
        if (!hasCombatLineOfSight) {
          if (
            ai.enemyType === 'archer' &&
            entity.weapon?.weaponType === 'bow'
          ) {
            ai.forcedChaseDistanceRemaining = 0
            ai.forcedChaseLastX = entity.transform.x
          } else {
            entity.input.moveDirection = ai.forcedChaseDirection
            if (ai.arrowDefenseActive) {
              entity.input.blockRequested = true
              entity.input.sprintRequested = false
              if (entity.movement) {
                entity.movement.moveSpeed = ai.moveSpeed * 0.5
              }
            } else {
              entity.input.blockRequested = false
              entity.input.sprintRequested =
                !!entity.movement &&
                entity.movement.moveSpeed < DEFAULT_SPRINT_SPEED
              if (entity.movement) {
                entity.movement.moveSpeed = ai.moveSpeed
              }
            }
            entity.input.attackRequested = false
            entity.input.lockedTargetId = null
            entity.input.facingOverride = ai.forcedChaseDirection
            if (entity.weapon) {
              entity.weapon.attackQueued = false
            }
            continue
          }
        }
        ai.forcedChaseDistanceRemaining = 0
      }

      if (
        wasForcedChasing &&
        ai.forcedChaseDistanceRemaining === 0 &&
        !hasCombatLineOfSight &&
        entity.input.lockedTargetId === null
      ) {
        ai.arrowDefenseActive = false
        ai.arrowDefenseTimeRemainingMs = 0
        ai.arrowDefenseSwitchTimerMs = 0
        this.handlePatrol(entity, ai, now)
        if (entity.weapon) {
          entity.weapon.attackQueued = false
        }
        if (entity.input) {
          entity.input.sprintRequested = false
          entity.input.lockedTargetId = null
        }
        continue
      }

      const alertHandled = this.updateAlertState(
        entity,
        ai,
        distance,
        !!hasAlertLineOfSight,
        deltaMs,
        now,
        stableFacing,
        target
      )
      if (alertHandled) {
        continue
      }

      if (entity.input.lockedTargetId === target.id) {
        if (hasCombatLineOfSight) {
          entity.input.lockLostTimer = 0
        } else {
          entity.input.lockLostTimer += deltaMs
          if (entity.input.lockLostTimer > ENEMY_LOCK_LOST_TIMEOUT_MS) {
            entity.input.lockedTargetId = null
            entity.input.lockLostTimer = 0
          }
        }
      } else {
        entity.input.lockLostTimer = 0
      }

      if (now - ai.lastDecisionTimestamp < ai.decisionCooldownMs) {
        continue
      }
      ai.lastDecisionTimestamp = now

      entity.input.facingOverride = stableFacing

      ai.hasLineOfSight = !!hasCombatLineOfSight

      // 战斗状态管理由StatsSystem负责，这里只记录是否有视线
      if (hasCombatLineOfSight) {
        ai.targetLostTimer = 0
      } else {
        ai.targetLostTimer += deltaMs
      }

      // 撤回条件：无视线且已脱战
      const retreatConditionMet =
        !hasCombatLineOfSight &&
        !entity.stats?.isInCombat &&
        !ai.alertChaseActive

      if (retreatConditionMet) {
        ai.retreatDelayTimerMs += deltaMs
      } else {
        ai.retreatDelayTimerMs = 0
      }

      const retreatByTimer =
        ai.retreatEnabled &&
        retreatConditionMet &&
        ai.retreatDelayTimerMs >= ai.retreatDelayMs
      const shouldGoPatrol = effectiveAttackDesire <= 0 || retreatByTimer

      if (shouldGoPatrol) {
        // 巡逻逻辑
        this.handlePatrol(entity, ai, now)
        if (entity.weapon) {
          entity.weapon.attackQueued = false
        }
        if (entity.input) {
          entity.input.sprintRequested = false
          entity.input.lockedTargetId = null
        }
        continue
      }

      // 敌人锁定目标（进入战斗状态）
      if (
        hasCombatLineOfSight &&
        entity.input &&
        entity.input.lockedTargetId !== target.id
      ) {
        entity.input.lockedTargetId = target.id
        entity.input.lockLostTimer = 0
      }

      if (ai.enemyType === 'archer' && entity.weapon && entity.weaponSlots) {
        const meleeSwitchDistance = ai.detectionRange * ARCHER_MELEE_RANGE_RATIO
        const isUsingBow = entity.weapon.weaponType === 'bow'
        const bowAmmo = this.getArcherBowAmmo(entity)
        const hasBowAmmo = bowAmmo > 0

        if (distance > meleeSwitchDistance && hasBowAmmo) {
          // 远程逻辑
          // 只要有视野或者已经锁定，就维持远程攻击状态（防止射击间隙的射线检测失败导致丢失目标）
          const isLocked = entity.input.lockedTargetId === target.id
          if (hasCombatLineOfSight || isLocked) {
            // 有视野：使用弓箭远程射击，原地不动
            // 强制锁定并更新朝向
            entity.input.lockedTargetId = target.id
            entity.input.facingOverride = stableFacing

            if (this.weaponSystem) {
              if (entity.weaponSlots.activeSlot !== 'secondary') {
                this.weaponSystem.switchWeaponSlot(entity, 'secondary')
              } else {
                // 已经在用弓，执行连续射击逻辑
                const weapon = entity.weapon
                const minWindupMs = this.getArcherBowMinWindupMs(entity)
                // 如果正在后摇（recovery），等待；否则开始或保持蓄力
                if (weapon.bowRecoverElapsedMs > 0) {
                  entity.input.attackRequested = false
                } else if (
                  weapon.bowIsDrawing &&
                  weapon.bowDrawElapsedMs >= minWindupMs
                ) {
                  // 蓄力完成，释放攻击
                  entity.input.attackRequested = false
                } else {
                  // 开始蓄力
                  entity.input.attackRequested = true
                }
              }
            }
            // 保持原地不动
            entity.input.moveDirection = 0
            entity.input.sprintRequested = false
            entity.input.blockRequested = false
            if (entity.movement) {
              entity.movement.moveSpeed = ai.moveSpeed
            }
            continue
          } else {
            // 无视野且距离较远：放弃追击，回巡逻
            entity.input.attackRequested = false
            entity.input.lockedTargetId = null
            this.handlePatrol(entity, ai, now)
            continue
          }
        } else {
          // 近战逻辑 (<= meleeSwitchDistance)
          // 无论是否有视野，如果距离很近，都尝试切近战并追击（如果有视野直接打，无视野追过去）
          if (this.weaponSystem && entity.weaponSlots.activeSlot !== 'main') {
            this.weaponSystem.switchWeaponSlot(entity, 'main')
            entity.input.attackRequested = false
          }
          // 不使用 continue，让逻辑流转到下方的 approach/combo 状态处理近战行为
        }
      }

      if (ai.state === 'probe') {
        this.handleProbeState(
          entity,
          ai,
          distance,
          weaponRange,
          stableFacing,
          deltaMs
        )
        continue
      }

      if (ai.state === 'approach') {
        // 如果正在进行跨越障碍跳跃序列，优先处理
        if (ai.obstacleJumpStage > 0) {
          entity.input.moveDirection = ai.obstacleJumpDirection // 保持跳跃方向
          this.handleObstacleJump(entity, ai, now, stableFacing)
          continue
        }

        if (ai.arrowDefenseActive) {
          entity.input.moveDirection = stableFacing
          entity.input.blockRequested = true
          entity.input.sprintRequested = false
          if (entity.movement) {
            entity.movement.moveSpeed = ai.moveSpeed * 0.5
          }

          // 检测是否被阻挡（每300ms检查一次位置变化）
          if (now - ai.lastPositionUpdateTime >= ai.positionCheckInterval) {
            const deltaX = Math.abs(entity.transform.x - ai.lastPosition.x)
            const deltaY = Math.abs(entity.transform.y - ai.lastPosition.y)
            // 300ms内移动距离小于0.3认为被阻挡（正常速度3m/s应该移动0.9m）
            const positionChanged = deltaX > 0.3 || deltaY > 0.3

            if (!positionChanged) {
              ai.stuckTimer += ai.positionCheckInterval
              if (ai.stuckTimer >= ai.stuckThreshold) {
                if (this.tryTriggerObstacleJump(entity, ai, now)) {
                  ai.stuckTimer = 0
                } else {
                  ai.state = 'pacing'
                  ai.paceDirection = -1
                  ai.paceMovedDistance = 0
                  ai.paceLastPositionX = entity.transform?.x ?? 0
                  ai.paceLastPositionY = entity.transform?.y ?? 0
                  ai.lastPaceSwitchTimestamp = now
                  ai.nextPaceResumeTimestamp = 0
                  ai.stuckTimer = 0
                  ai.obstacleJumpStage = 0
                  if (entity.movement) {
                    entity.movement.moveSpeed = ENEMY_PACE_SPEED
                  }
                }
              }
            } else {
              ai.stuckTimer = 0
            }

            ai.lastPosition.x = entity.transform.x
            ai.lastPosition.y = entity.transform.y
            ai.lastPositionUpdateTime = now
          }
          continue
        }

        if (distance > weaponRange) {
          if (now - ai.lastAggressionCheckTimestamp > 1000) {
            ai.lastAggressionCheckTimestamp = now
            const hesitationChance = Math.max(
              0,
              (100 - effectiveAttackDesire) / 100
            )
            if (Math.random() < hesitationChance * 0.8) {
              this.startProbeState(entity, ai, effectiveAttackDesire)
              continue
            }
            // 跳跃攻击：距离较远时有概率直扑目标
            if (
              entity.movement?.isGrounded &&
              ai.leapAttackCooldownEndTimestamp <= now &&
              distance >
                weaponRange * ENEMY_LEAP_ATTACK_MIN_DISTANCE_MULTIPLIER &&
              distance <
                weaponRange * ENEMY_LEAP_ATTACK_MAX_DISTANCE_MULTIPLIER &&
              Math.random() < ENEMY_LEAP_ATTACK_CHANCE
            ) {
              this.startLeapAttack(entity, ai, stableFacing, now)
              continue
            }
          }

          entity.input.moveDirection = stableFacing
          if (entity.movement && hasCombatLineOfSight) {
            // 如果基础速度小于奔跑速度（人类奔跑速度），则尝试奔跑
            if (entity.movement.moveSpeed < DEFAULT_SPRINT_SPEED) {
              entity.input.sprintRequested = true
            } else {
              entity.input.sprintRequested = false
            }
          } else {
            entity.input.sprintRequested = false
          }
          if (ai.arrowDefenseActive) {
            entity.input.blockRequested = true
            entity.input.sprintRequested = false
            if (entity.movement) {
              entity.movement.moveSpeed = ai.moveSpeed * 0.5
            }
          } else if (entity.movement) {
            entity.movement.moveSpeed = ai.moveSpeed
          }

          // 检测是否被阻挡（每300ms检查一次位置变化）
          if (now - ai.lastPositionUpdateTime >= ai.positionCheckInterval) {
            const deltaX = Math.abs(entity.transform.x - ai.lastPosition.x)
            const deltaY = Math.abs(entity.transform.y - ai.lastPosition.y)
            // 300ms内移动距离小于0.3认为被阻挡（正常速度3m/s应该移动0.9m）
            const positionChanged = deltaX > 0.3 || deltaY > 0.3

            // 在追击状态下（战斗中）检测阻挡，即使视线被遮挡
            const isChasing = entity.stats?.isInCombat || hasCombatLineOfSight
            if (!positionChanged && isChasing) {
              ai.stuckTimer += ai.positionCheckInterval
              if (ai.stuckTimer >= ai.stuckThreshold) {
                // 尝试跨越障碍序列
                if (this.tryTriggerObstacleJump(entity, ai, now)) {
                  ai.stuckTimer = 0
                } else {
                  // 无法跳跃或已在序列中（不应发生），切换到踱步
                  ai.state = 'pacing'
                  ai.paceDirection = -1 // 初始方向为后退
                  ai.paceMovedDistance = 0
                  ai.paceLastPositionX = entity.transform?.x ?? 0
                  ai.paceLastPositionY = entity.transform?.y ?? 0
                  ai.lastPaceSwitchTimestamp = now
                  ai.nextPaceResumeTimestamp = 0
                  ai.stuckTimer = 0
                  ai.obstacleJumpStage = 0
                  if (entity.movement) {
                    entity.movement.moveSpeed = ENEMY_PACE_SPEED
                  }
                }
              }
            } else {
              ai.stuckTimer = 0
            }

            ai.lastPosition.x = entity.transform.x
            ai.lastPosition.y = entity.transform.y
            ai.lastPositionUpdateTime = now
          }
        } else {
          this.enterComboState(entity, ai, stableFacing)
        }
        continue
      }

      if (ai.state === 'combo') {
        ai.lastFacing = stableFacing
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false

        // For skilled enemies, check distance between attacks
        if (
          ai.parryProficiency >= 50 &&
          entity.weapon &&
          (entity.weapon.attackPhase === 'idle' ||
            entity.weapon.attackPhase === 'pause' ||
            entity.weapon.attackPhase === 'rebound')
        ) {
          if (distance > weaponRange + 0.5) {
            ai.state = 'approach'
            ai.comboSwingsDone = 0
            continue
          }
        }

        this.queueAttack(entity, stableFacing, ai)
        const weapon = entity.weapon
        const comboFinished =
          weapon &&
          ai.comboSwingsDone >= ai.comboSwingTarget &&
          weapon.attackPhase === 'idle' &&
          !weapon.attackQueued
        if (comboFinished) {
          const retreatChance = Math.max(0, (100 - effectiveAttackDesire) / 200)
          if (Math.random() < retreatChance) {
            ai.state = 'retreat'
            ai.retreatDirection = (ai.lastFacing === 1 ? -1 : 1) as -1 | 1
            ai.retreatTargetDistance =
              weaponRange + ENEMY_RETREAT_EXTRA_DISTANCE
            entity.input.moveDirection = ai.retreatDirection
          } else {
            ai.state = 'approach'
            ai.comboSwingsDone = 0
            entity.input.moveDirection = 0
          }
        }
        continue
      }

      if (ai.state === 'retreat') {
        entity.input.sprintRequested = false
        const targetDistance = weaponRange + ENEMY_RETREAT_EXTRA_DISTANCE
        // 如果在撤退时玩家紧追（处于攻击范围内），不再撤退而是直接迎击
        const tooCloseThreshold = weaponRange

        if (distance < tooCloseThreshold) {
          ai.state = 'combo'
          ai.comboSwingsDone = 0
          if (entity.weapon) {
            const movesetId =
              ai.movesetId ||
              (entity.attackSlots?.normal.hasMoveset
                ? entity.attackSlots.normal.movesetId
                : '')
            if (movesetId) {
              const moveset = ATTACK_MOVESETS[movesetId]
              if (moveset) {
                const seq = moveset.sequences.find(
                  (s: any) => s.id === moveset.defaultSequenceId
                )
                if (seq) {
                  ai.comboSwingTarget = seq.moves.length
                }
              }
            }
          }
          entity.input.moveDirection = 0
          this.queueAttack(entity, stableFacing, ai)
        } else if (distance < targetDistance) {
          entity.input.moveDirection = ai.retreatDirection
        } else {
          ai.state = 'approach'
          ai.comboSwingsDone = 0
          entity.input.moveDirection = 0
        }
        continue
      }

      if (ai.state === 'pacing') {
        entity.input.sprintRequested = false

        if (ai.obstacleJumpStage > 0) {
          entity.input.moveDirection = ai.obstacleJumpDirection
          this.handleObstacleJump(entity, ai, now, stableFacing)
          continue
        }
        if (ai.arrowDefenseActive) {
          entity.input.blockRequested = true
          entity.input.sprintRequested = false
          if (entity.movement) {
            entity.movement.moveSpeed = ai.moveSpeed * 0.5
          }
        } else if (entity.movement) {
          entity.movement.moveSpeed = ai.moveSpeed
        }

        // 调试日志
        // if (Math.random() < 0.05) {
        //   console.log(
        //     `[Pacing] locked:${entity.input.lockedTargetId} ` +
        //       `facing:${facing} ` +
        //       `moveDir:${entity.input.moveDirection} ` +
        //       `paceDir:${ai.paceDirection} ` +
        //       `speed:${entity.movement?.moveSpeed} ` +
        //       `pos:(${entity.transform.x.toFixed(2)},${entity.transform.y.toFixed(2)}) ` +
        //       `isPaused:${now < ai.nextPaceResumeTimestamp} ` +
        //       `timeSinceSwitch:${now - ai.lastPaceSwitchTimestamp}ms`
        //   )
        // }

        // 如果恢复视线，回到追击状态
        if (hasCombatLineOfSight) {
          // console.log('[Pacing] Line of sight restored, returning to approach')
          // 恢复正常移动速度
          if (entity.movement) {
            entity.movement.moveSpeed = ai.moveSpeed
          }
          ai.state = 'approach'
          ai.stuckTimer = 0
          ai.obstacleJumpStage = 0
          continue
        }

        // 如果完全丢失锁定，回到巡逻
        if (entity.input.lockedTargetId === null) {
          // console.log('[Pacing] Lost lock, returning to patrol')
          // 恢复正常移动速度
          if (entity.movement) {
            entity.movement.moveSpeed = ai.moveSpeed
          }
          this.handlePatrol(entity, ai, now)
          if (entity.weapon) {
            entity.weapon.attackQueued = false
          }
          continue
        }

        // 如果在暂停期间，保持不动
        if (now < ai.nextPaceResumeTimestamp) {
          entity.input.moveDirection = 0
          continue
        }

        if (entity.transform) {
          const deltaX = entity.transform.x - ai.paceLastPositionX
          const deltaY = entity.transform.y - ai.paceLastPositionY
          ai.paceMovedDistance += Math.abs(deltaX) + Math.abs(deltaY)
          ai.paceLastPositionX = entity.transform.x
          ai.paceLastPositionY = entity.transform.y
        }

        // 检查是否需要切换方向或进入暂停
        const paceSwitchIntervalMs = Math.max(
          ai.paceSwitchIntervalMs,
          ENEMY_PACE_MIN_SWITCH_INTERVAL_MS
        )
        if (
          now - ai.lastPaceSwitchTimestamp >= paceSwitchIntervalMs &&
          ai.paceMovedDistance >= ENEMY_PACE_MIN_DISTANCE
        ) {
          // 切换踱步方向：前进和后退交替
          ai.paceDirection = (ai.paceDirection === 1 ? -1 : 1) as -1 | 1
          ai.lastPaceSwitchTimestamp = now
          ai.nextPaceResumeTimestamp =
            now + Math.max(ai.pacePauseMs, ENEMY_PACE_MIN_PAUSE_MS)
          entity.input.moveDirection = 0
          ai.paceMovedDistance = 0
          // console.log(
          //   `[Pacing] Switching direction to ${ai.paceDirection}, pausing for ${ai.pacePauseMs}ms`
          // )
          continue
        }

        // 前后踱步：朝向玩家方向移动或远离
        // paceDirection=1 表示靠近玩家，-1 表示远离玩家
        const computedMoveDir = (stableFacing * ai.paceDirection) as -1 | 1
        entity.input.moveDirection = computedMoveDir
      }
    }
  }

  private updateParryState(
    entity: Entity,
    ai: EnemyAIComponent,
    isPlayerSwinging: boolean,
    distance: number,
    weaponRange: number,
    hasLineOfSight: boolean
  ): void {
    if (!entity.input || !entity.weapon) return

    if (ai.arrowDefenseActive) {
      entity.input.blockRequested = true
      ai.playerSwingActive = false
      ai.parryAttemptedThisSwing = true
      return
    }

    if (
      !entity.weapon.isEquipped ||
      entity.stats?.isDead ||
      entity.stats?.isStaggered
    ) {
      entity.input.blockRequested = false
      ai.playerSwingActive = false
      ai.parryAttemptedThisSwing = false
      return
    }

    entity.input.blockRequested = false

    if (!isPlayerSwinging) {
      ai.playerSwingActive = false
      ai.parryAttemptedThisSwing = false
      return
    }

    if (!ai.playerSwingActive) {
      ai.playerSwingActive = true
      ai.parryAttemptedThisSwing = false
    }

    if (!hasLineOfSight) return

    if (distance > weaponRange * 2) return

    if (ai.parryAttemptedThisSwing) return

    ai.parryAttemptedThisSwing = true
    if (this.shouldParry(ai.parryProficiency)) {
      entity.input.blockRequested = true
    }
  }

  private shouldParry(proficiency: number): boolean {
    if (proficiency <= 0) return false
    if (proficiency >= 100) return true
    return Math.random() * 100 < proficiency
  }

  private tryTriggerObstacleJump(
    entity: Entity,
    ai: EnemyAIComponent,
    now: number
  ): boolean {
    if (
      entity.movement &&
      entity.movement.isTouchingWall &&
      ai.obstacleJumpStage === 0
    ) {
      if (!entity.input) return false
      // console.log('[Obstacle] Stuck at wall, starting jump sequence')
      const moveDir =
        entity.input.moveDirection !== 0
          ? entity.input.moveDirection
          : entity.input.lastMoveDirection !== 0
            ? entity.input.lastMoveDirection
            : ai.lastFacing
      ai.obstacleJumpDirection = (moveDir >= 0 ? 1 : -1) as -1 | 1
      entity.input.jumpRequested = true
      entity.input.inputBuffer.bufferAction('jump')
      ai.obstacleJumpStage = 1
      ai.jumpStartTimestamp = now
      ai.jumpStartPosition.x = entity.transform?.x ?? 0
      ai.jumpStartPosition.y = entity.transform?.y ?? 0
      return true
    }
    return false
  }

  private handlePatrol(
    entity: Entity,
    ai: EnemyAIComponent,
    now: number
  ): void {
    if (!entity.input || !entity.transform) return

    entity.input.attackRequested = false
    ai.probeSwitchTimerMs = 0
    ai.probePaceTimerMs = 0
    ai.probePaceDirection = 1
    ai.probePaceMovedDistance = 0
    ai.probeLastPositionX = 0
    ai.probeLastPositionY = 0
    ai.probeHasTriggered = false
    ai.paceMovedDistance = 0
    ai.paceLastPositionX = 0
    ai.paceLastPositionY = 0
    ai.arrowDefenseTimeRemainingMs = 0
    ai.arrowDefenseSwitchTimerMs = 0
    ai.arrowDefenseActive = false
    ai.bowHoldTimerMs = 0
    ai.bowCooldownTimerMs = 0
    ai.archerShotCheckPending = false
    ai.alertTimeRemainingMs = 0
    ai.alertPaceDirection = 1
    ai.alertPaceMovedDistance = 0
    ai.alertPaceLastPositionX = 0
    ai.alertPaceLastPositionY = 0
    ai.alertLastPaceSwitchTimestamp = 0
    ai.alertNextPaceResumeTimestamp = 0
    ai.alertChaseActive = false
    if (entity.movement) {
      entity.movement.moveSpeed = ai.moveSpeed
    }

    // 站岗模式或无巡逻点时，返回站岗点并原地待机
    const shouldStandGuard =
      ai.initialPatrolMode === 'guard' ||
      !ai.patrolWaypoints ||
      ai.patrolWaypoints.length === 0
    if (shouldStandGuard) {
      const dx = ai.patrolCenter.x - entity.transform.x
      const dist = Math.abs(dx)
      const arrivalThreshold = 0.5

      if (dist <= arrivalThreshold) {
        entity.input.moveDirection = 0
        entity.input.facingOverride = null
        ai.patrolState = 'moving'
        ai.patrolStuckTimer = 0
        ai.lastPositionUpdateTime = 0
        ai.state = 'approach'
        ai.comboSwingsDone = 0
        return
      }

      const facing = dx > 0 ? 1 : -1

      if (ai.obstacleJumpStage > 0) {
        entity.input.moveDirection = ai.obstacleJumpDirection
        this.handleObstacleJump(entity, ai, now, facing)
        return
      }

      if (ai.lastPositionUpdateTime === 0) {
        ai.lastPositionUpdateTime = now
        ai.lastPosition.x = entity.transform.x
        ai.lastPosition.y = entity.transform.y
      }

      if (now - ai.lastPositionUpdateTime > 500) {
        const moveDist = Math.hypot(
          entity.transform.x - ai.lastPosition.x,
          entity.transform.y - ai.lastPosition.y
        )
        if (moveDist < 0.2) {
          ai.patrolStuckTimer += now - ai.lastPositionUpdateTime
        } else {
          ai.patrolStuckTimer = 0
        }
        ai.lastPosition.x = entity.transform.x
        ai.lastPosition.y = entity.transform.y
        ai.lastPositionUpdateTime = now
      }

      if (ai.patrolStuckTimer > 500) {
        if (this.tryTriggerObstacleJump(entity, ai, now)) {
          ai.patrolStuckTimer = 0
          return
        }
      }

      entity.input.moveDirection = facing
      entity.input.facingOverride = entity.input.moveDirection
      ai.state = 'approach'
      ai.comboSwingsDone = 0
      return
    }

    // 确保索引有效
    if (ai.currentWaypointIndex >= ai.patrolWaypoints.length) {
      ai.currentWaypointIndex = 0
    }

    const target = ai.patrolWaypoints[ai.currentWaypointIndex]
    const dx = target.x - entity.transform.x
    const facing = dx > 0 ? 1 : -1
    const dist = Math.abs(dx)
    const arrivalThreshold = 0.5

    // 优先处理跨越障碍跳跃序列
    if (ai.obstacleJumpStage > 0) {
      entity.input.moveDirection = ai.obstacleJumpDirection
      this.handleObstacleJump(entity, ai, now, facing)
      return
    }

    if (ai.patrolState === 'moving') {
      // 避免初始帧导致的大数值差异
      if (ai.lastPositionUpdateTime === 0) {
        ai.lastPositionUpdateTime = now
        ai.lastPosition.x = entity.transform.x
        ai.lastPosition.y = entity.transform.y
      }

      // 卡死检测：如果长时间未明显移动，视为到达（或无法到达）
      if (now - ai.lastPositionUpdateTime > 500) {
        const moveDist = Math.hypot(
          entity.transform.x - ai.lastPosition.x,
          entity.transform.y - ai.lastPosition.y
        )
        // 500ms内移动小于0.2米认为受阻
        if (moveDist < 0.2) {
          ai.patrolStuckTimer += now - ai.lastPositionUpdateTime
        } else {
          ai.patrolStuckTimer = 0
        }
        ai.lastPosition.x = entity.transform.x
        ai.lastPosition.y = entity.transform.y
        ai.lastPositionUpdateTime = now
      }

      // 尝试跳跃跨越障碍（当卡住且接触墙壁时）
      if (ai.patrolStuckTimer > 500) {
        if (this.tryTriggerObstacleJump(entity, ai, now)) {
          ai.patrolStuckTimer = 0
          return
        }
      }

      // 如果到达目标 OR 卡住超过2秒（且未能通过跳跃解决）
      if (dist <= arrivalThreshold || ai.patrolStuckTimer > 2000) {
        // 到达目标点，开始等待
        // console.log(`[Patrol] Arrived/Stuck at waypoint ${ai.currentWaypointIndex}, waiting...`)
        ai.patrolState = 'waiting'
        // 随机等待 2000-3000ms
        ai.patrolResumeTimestamp = now + 2000 + Math.random() * 1000
        ai.patrolStuckTimer = 0
        entity.input.moveDirection = 0
        // 等待时清除 facingOverride，保持之前的朝向（避免因为update中设置了朝向玩家而突然掉头）
        entity.input.facingOverride = null
      } else {
        // 向目标移动
        entity.input.moveDirection = facing
        entity.input.facingOverride = entity.input.moveDirection
      }
    } else if (ai.patrolState === 'waiting') {
      entity.input.moveDirection = 0
      // 同样在等待期间保持朝向
      entity.input.facingOverride = null

      if (now >= ai.patrolResumeTimestamp) {
        // 等待结束，前往下一个点
        // console.log(`[Patrol] Wait finished, moving to next waypoint`)
        ai.patrolState = 'moving'
        ai.currentWaypointIndex =
          (ai.currentWaypointIndex + 1) % ai.patrolWaypoints.length

        // 重置卡死检测状态，防止立即误判为卡死
        ai.patrolStuckTimer = 0
        ai.lastPositionUpdateTime = now
        ai.lastPosition.x = entity.transform.x
        ai.lastPosition.y = entity.transform.y
      }
    }

    // 重置战斗/追击相关的临时状态
    ai.state = 'approach'
    ai.comboSwingsDone = 0
  }

  private updateAlertState(
    entity: Entity,
    ai: EnemyAIComponent,
    distance: number,
    hasAlertLineOfSight: boolean,
    deltaMs: number,
    now: number,
    facing: number,
    target: Entity
  ): boolean {
    if (!entity.input) return false
    const detectionRange = ai.detectionRange
    const alertRange = detectionRange * ENEMY_ALERT_RANGE_MULTIPLIER

    if (ai.alertChaseActive) {
      if (distance > alertRange) {
        this.clearAlertState(entity, ai, target)
      }
      return false
    }
    if (!hasAlertLineOfSight) {
      if (ai.state === 'alert' || ai.alertTimeRemainingMs > 0) {
        this.clearAlertState(entity, ai, target)
      }
      return false
    }
    if (entity.stats?.isInCombat) {
      if (ai.state === 'alert' || ai.alertTimeRemainingMs > 0) {
        this.clearAlertState(entity, ai, target)
      }
      return false
    }

    const alertAccelerateRange =
      detectionRange * ENEMY_ALERT_ACCEL_RANGE_MULTIPLIER

    if (distance <= detectionRange) {
      if (ai.state === 'alert' || ai.alertTimeRemainingMs > 0) {
        this.clearAlertState(entity, ai, target)
      }
      ai.alertChaseActive = false
      return false
    }

    if (distance > alertRange) {
      if (ai.state === 'alert' || ai.alertTimeRemainingMs > 0) {
        this.clearAlertState(entity, ai, target)
      }
      if (ai.alertChaseActive) {
        ai.alertChaseActive = false
      }
      return false
    }

    if (ai.state !== 'alert') {
      ai.state = 'alert'
      ai.alertTimeRemainingMs = ai.alertDurationMs
      ai.alertPaceDirection = 1
      ai.alertPaceMovedDistance = 0
      if (entity.transform) {
        ai.alertPaceLastPositionX = entity.transform.x
        ai.alertPaceLastPositionY = entity.transform.y
      } else {
        ai.alertPaceLastPositionX = 0
        ai.alertPaceLastPositionY = 0
      }
      ai.alertLastPaceSwitchTimestamp = now
      ai.alertNextPaceResumeTimestamp = 0
    }

    if (ai.alertTimeRemainingMs > 0) {
      const countdownMultiplier = distance <= alertAccelerateRange ? 2 : 1
      ai.alertTimeRemainingMs = Math.max(
        0,
        ai.alertTimeRemainingMs - deltaMs * countdownMultiplier
      )
    }

    if (ai.alertTimeRemainingMs <= 0) {
      ai.alertChaseActive = true
      ai.state = 'approach'
      return false
    }

    entity.input.lockedTargetId = target.id
    entity.input.lockLostTimer = 0
    entity.input.attackRequested = false
    entity.input.sprintRequested = false
    entity.input.blockRequested = false
    entity.input.facingOverride = facing
    if (entity.weapon) {
      entity.weapon.attackQueued = false
    }
    if (entity.movement) {
      entity.movement.moveSpeed =
        ai.moveSpeed * ENEMY_ALERT_PACE_SPEED_MULTIPLIER
    }

    if (entity.transform) {
      const deltaX = entity.transform.x - ai.alertPaceLastPositionX
      const deltaY = entity.transform.y - ai.alertPaceLastPositionY
      ai.alertPaceMovedDistance += Math.abs(deltaX) + Math.abs(deltaY)
      ai.alertPaceLastPositionX = entity.transform.x
      ai.alertPaceLastPositionY = entity.transform.y
    }

    if (now < ai.alertNextPaceResumeTimestamp) {
      entity.input.moveDirection = 0
      return true
    }

    const paceSwitchIntervalMs = Math.max(
      ai.paceSwitchIntervalMs,
      ENEMY_PACE_MIN_SWITCH_INTERVAL_MS
    )
    if (
      now - ai.alertLastPaceSwitchTimestamp >= paceSwitchIntervalMs &&
      ai.alertPaceMovedDistance >= ENEMY_PACE_MIN_DISTANCE
    ) {
      ai.alertPaceDirection = (ai.alertPaceDirection === 1 ? -1 : 1) as -1 | 1
      ai.alertLastPaceSwitchTimestamp = now
      ai.alertNextPaceResumeTimestamp =
        now + Math.max(ai.pacePauseMs, ENEMY_PACE_MIN_PAUSE_MS)
      entity.input.moveDirection = 0
      ai.alertPaceMovedDistance = 0
      return true
    }

    const paceFacing =
      distance >= ENEMY_PACE_MIN_DISTANCE ? facing : ai.lastFacing
    entity.input.moveDirection = (paceFacing * ai.alertPaceDirection) as -1 | 1
    return true
  }

  private clearAlertState(
    entity: Entity,
    ai: EnemyAIComponent,
    target: Entity
  ): void {
    if (ai.state === 'alert') {
      ai.state = 'approach'
    }
    ai.alertTimeRemainingMs = 0
    ai.alertPaceDirection = 1
    ai.alertPaceMovedDistance = 0
    ai.alertPaceLastPositionX = 0
    ai.alertPaceLastPositionY = 0
    ai.alertLastPaceSwitchTimestamp = 0
    ai.alertNextPaceResumeTimestamp = 0
    ai.alertChaseActive = false
    if (
      entity.input &&
      entity.input.lockedTargetId === target.id &&
      !entity.stats?.isInCombat
    ) {
      entity.input.lockedTargetId = null
      entity.input.lockLostTimer = 0
    }
  }

  private updateProbeCycle(
    entity: Entity,
    ai: EnemyAIComponent,
    effectiveAttackDesire: number,
    deltaMs: number,
    isEngaged: boolean,
    distance: number,
    weaponRange: number
  ): void {
    if (
      (ai.parryProficiency < 50 && effectiveAttackDesire >= 50) ||
      !isEngaged
    ) {
      if (ai.state === 'probe') {
        ai.state = 'approach'
        if (entity.movement) {
          entity.movement.moveSpeed = ai.moveSpeed
        }
      }
      ai.probeSwitchTimerMs = 0
      ai.probePaceTimerMs = 0
      ai.probePaceDirection = 1
      ai.probePaceMovedDistance = 0
      ai.probeLastPositionX = 0
      ai.probeLastPositionY = 0
      ai.probeHasTriggered = false
      return
    }

    if (ai.state !== 'approach' && ai.state !== 'probe') {
      ai.probeSwitchTimerMs = 0
      ai.probePaceTimerMs = 0
      ai.probePaceMovedDistance = 0
      ai.probeLastPositionX = 0
      ai.probeLastPositionY = 0
      return
    }

    if (ai.state === 'approach' && !ai.probeHasTriggered) {
      const probeTargetDistance = weaponRange * ENEMY_PROBE_DISTANCE_MULTIPLIER
      const probeBuffer = weaponRange * ENEMY_PROBE_RANGE_BUFFER_RATIO
      const maxDistance = probeTargetDistance + probeBuffer
      if (distance <= maxDistance) {
        if (effectiveAttackDesire >= 90) {
          return
        }
        this.startProbeState(entity, ai, effectiveAttackDesire)
        return
      }
    }

    if (ai.state === 'probe') {
      if (ai.probeSwitchTimerMs <= 0) {
        this.startProbeState(entity, ai, effectiveAttackDesire)
        return
      }

      ai.probeSwitchTimerMs -= deltaMs
      if (ai.probeSwitchTimerMs > 0) {
        return
      }

      ai.state = 'approach'
      ai.probeSwitchTimerMs = ENEMY_PROBE_CHASE_DURATION_MS
      ai.probePaceTimerMs = 0
      ai.probePaceDirection = 1
      ai.probePaceMovedDistance = 0
      if (entity.movement) {
        entity.movement.moveSpeed = ai.moveSpeed
      }
      return
    }

    if (ai.probeSwitchTimerMs <= 0) {
      ai.probeSwitchTimerMs = ENEMY_PROBE_CHASE_DURATION_MS
      if (entity.movement && entity.movement.moveSpeed !== ai.moveSpeed) {
        entity.movement.moveSpeed = ai.moveSpeed
      }
      return
    }

    ai.probeSwitchTimerMs -= deltaMs
    if (ai.probeSwitchTimerMs > 0) {
      return
    }

    this.startProbeState(entity, ai, effectiveAttackDesire)
  }

  private startProbeState(
    entity: Entity,
    ai: EnemyAIComponent,
    effectiveAttackDesire: number
  ): void {
    ai.state = 'probe'
    ai.probeHasTriggered = true
    ai.probeSwitchTimerMs = this.getProbeDurationMs(effectiveAttackDesire)
    ai.probePaceTimerMs = 0
    ai.probePaceDirection = 1
    ai.probePaceMovedDistance = 0
    if (entity.transform) {
      ai.probeLastPositionX = entity.transform.x
      ai.probeLastPositionY = entity.transform.y
    }
    if (entity.movement) {
      entity.movement.moveSpeed = ai.moveSpeed * ENEMY_PROBE_SPEED_MULTIPLIER
    }
    if (entity.weapon) {
      entity.weapon.attackQueued = false
    }
  }

  private handleProbeState(
    entity: Entity,
    ai: EnemyAIComponent,
    distance: number,
    weaponRange: number,
    facing: number,
    deltaMs: number
  ): void {
    if (!entity.input) return

    if (entity.weapon) {
      entity.weapon.attackQueued = false
    }
    entity.input.sprintRequested = false

    if (entity.transform) {
      const deltaX = entity.transform.x - ai.probeLastPositionX
      const deltaY = entity.transform.y - ai.probeLastPositionY
      ai.probePaceMovedDistance += Math.abs(deltaX) + Math.abs(deltaY)
      ai.probeLastPositionX = entity.transform.x
      ai.probeLastPositionY = entity.transform.y
    }

    if (entity.movement) {
      entity.movement.moveSpeed = ai.moveSpeed * ENEMY_PROBE_SPEED_MULTIPLIER
    }

    const probeTargetDistance = weaponRange * ENEMY_PROBE_DISTANCE_MULTIPLIER
    const probeBuffer = weaponRange * ENEMY_PROBE_RANGE_BUFFER_RATIO
    const minDistance = probeTargetDistance - probeBuffer
    const maxDistance = probeTargetDistance + probeBuffer

    if (distance < minDistance) {
      entity.input.moveDirection = (facing * -1) as -1 | 1
      ai.probePaceTimerMs = 0
      ai.probePaceMovedDistance = 0
      ai.probePaceDirection = -1
      return
    }

    if (distance > maxDistance) {
      entity.input.moveDirection = facing as -1 | 1
      ai.probePaceTimerMs = 0
      ai.probePaceMovedDistance = 0
      ai.probePaceDirection = 1
      return
    }

    ai.probePaceTimerMs += deltaMs
    if (
      ai.probePaceTimerMs >= ENEMY_PROBE_PACE_SWITCH_INTERVAL_MS &&
      ai.probePaceMovedDistance >= ENEMY_PROBE_PACE_MIN_DISTANCE
    ) {
      ai.probePaceTimerMs = 0
      ai.probePaceMovedDistance = 0
      ai.probePaceDirection = (ai.probePaceDirection === 1 ? -1 : 1) as -1 | 1
    }

    entity.input.moveDirection = (facing * ai.probePaceDirection) as -1 | 1
  }

  private getProbeDurationMs(attackDesire: number): number {
    // scale duration based on desire: 100 desire -> 0.2x duration, 0 desire -> 1.0x duration
    const factor = Math.max(0.2, (100 - attackDesire) / 100)
    const range = ENEMY_PROBE_DURATION_MAX_MS - ENEMY_PROBE_DURATION_MIN_MS
    return (ENEMY_PROBE_DURATION_MIN_MS + Math.random() * range) * factor
  }

  private handleObstacleJump(
    entity: Entity,
    ai: EnemyAIComponent,
    now: number,
    facing: number
  ): void {
    if (!entity.movement || !entity.input || !entity.transform) return

    // Stage 1: 等待第一次跳跃到达高点（或经过一段时间）
    if (ai.obstacleJumpStage === 1) {
      const timeSinceJump = now - ai.jumpStartTimestamp
      // 约300ms后触发二段跳（蹬墙跳）
      // 这里的间隔是为了让角色跳起一定高度后再蹬墙
      if (timeSinceJump >= 300) {
        // console.log('[ObstacleJump] Triggering second jump (Wall Jump)')
        entity.input.jumpRequested = true
        entity.input.inputBuffer.bufferAction('jump')
        ai.obstacleJumpStage = 2
        ai.jumpStartTimestamp = now // 重置计时器用于检测落地
      }
      return
    }

    // Stage 2: 蹬墙跳后等待落地并检测是否跨越成功
    if (ai.obstacleJumpStage === 2) {
      const timeSinceSecondJump = now - ai.jumpStartTimestamp
      // 给一点时间让角色离地，避免刚跳就被判定为grounded
      if (timeSinceSecondJump < 500) return

      if (entity.movement.isGrounded) {
        // 落地了，检查位移
        const dx = Math.abs(entity.transform.x - ai.jumpStartPosition.x)
        const dy = Math.abs(entity.transform.y - ai.jumpStartPosition.y)
        const distanceMoved = Math.hypot(dx, dy)

        // 如果位移显著（例如大于2米），认为成功跨越
        if (distanceMoved > 2.0) {
          // console.log('[ObstacleJump] Success, resuming approach')
          ai.obstacleJumpStage = 0
        } else {
          // console.log('[ObstacleJump] Failed (still near start), switching to pacing')
          // 失败，切换到踱步
          ai.state = 'pacing'
          ai.paceDirection = -1
          ai.paceMovedDistance = 0
          ai.paceLastPositionX = entity.transform.x
          ai.paceLastPositionY = entity.transform.y
          ai.lastPaceSwitchTimestamp = now
          ai.nextPaceResumeTimestamp = 0
          ai.stuckTimer = 0
          ai.obstacleJumpStage = 0
          if (entity.movement) {
            entity.movement.moveSpeed = ENEMY_PACE_SPEED
          }
        }
      }
    }
  }

  private enterComboState(
    entity: Entity,
    ai: EnemyAIComponent,
    facing: number
  ): void {
    if (!entity.input) return
    ai.state = 'combo'
    ai.comboSwingTarget = Math.max(ai.comboSwingTarget, 3)
    ai.lastFacing = facing as -1 | 1
    if (entity.weapon) {
      const movesetId =
        ai.movesetId ||
        (entity.attackSlots?.normal.hasMoveset
          ? entity.attackSlots.normal.movesetId
          : '')
      if (movesetId) {
        const moveset = ATTACK_MOVESETS[movesetId]
        if (moveset) {
          const seq = moveset.sequences.find(
            (s: any) => s.id === moveset.defaultSequenceId
          )
          if (seq) {
            ai.comboSwingTarget = seq.moves.length
          }
        }
      }
      entity.weapon.attackQueued = false
      if (entity.weapon.attackPhase === 'idle') {
        entity.weapon.comboCount = 0
        entity.weapon.nextSwingDirection = 'toFront'
        entity.weapon.swingDirection = 'toFront'
        ai.comboSwingsDone = 0
      } else {
        ai.comboSwingsDone = entity.weapon.comboCount
      }
    } else {
      ai.comboSwingsDone = 0
    }
    entity.input.moveDirection = 0
    entity.input.sprintRequested = false
    ai.stuckTimer = 0
    this.queueAttack(entity, facing, ai)
  }

  private startLeapAttack(
    entity: Entity,
    ai: EnemyAIComponent,
    facing: number,
    now: number
  ): void {
    if (!entity.input) return
    ai.state = 'leapAttack'
    ai.leapAttackStage = 1
    ai.leapAttackTimestamp = now
    ai.comboSwingsDone = 0
    entity.input.jumpRequested = true
    entity.input.inputBuffer.bufferAction('jump')
    entity.input.moveDirection = facing as -1 | 1
    entity.input.sprintRequested = true
    entity.input.blockRequested = false
    if (entity.movement) {
      entity.movement.moveSpeed = ai.moveSpeed
    }
  }

  private handleLeapAttack(
    entity: Entity,
    ai: EnemyAIComponent,
    facing: number,
    now: number
  ): void {
    if (!entity.input || !entity.movement) return

    entity.input.blockRequested = false

    const elapsed = now - ai.leapAttackTimestamp

    if (elapsed > ENEMY_LEAP_ATTACK_MAX_DURATION_MS) {
      this.endLeapAttack(entity, ai, now, 'approach')
      return
    }

    // stage 1: 等待离地，维持跳跃力
    if (ai.leapAttackStage === 1) {
      entity.input.jumpRequested = true
      if (!entity.movement.isGrounded) {
        ai.leapAttackStage = 2
        this.queueAttack(entity, facing, ai)
      }
      entity.input.moveDirection = facing as -1 | 1
      entity.input.sprintRequested = true
      return
    }

    // stage 2: 空中飞行+攻击中，持续冲向目标，落地后交给combo
    entity.input.moveDirection = facing as -1 | 1
    entity.input.sprintRequested = true

    if (entity.movement.isGrounded && elapsed > 100) {
      this.endLeapAttack(entity, ai, now, 'combo')
      ai.lastFacing = facing as -1 | 1
      ai.comboSwingsDone = entity.weapon?.comboCount ?? 1
      ai.comboSwingTarget = Math.max(ai.comboSwingTarget, 3)
      ai.stuckTimer = 0
      ai.lastDecisionTimestamp = 0
    }
  }

  private endLeapAttack(
    entity: Entity,
    ai: EnemyAIComponent,
    now: number,
    nextState: 'approach' | 'combo' | null
  ): void {
    ai.leapAttackStage = 0
    ai.leapAttackCooldownEndTimestamp = now + ENEMY_LEAP_ATTACK_COOLDOWN_MS
    if (entity.input) {
      entity.input.sprintRequested = false
    }
    if (nextState) {
      ai.state = nextState
    }
  }

  private queueAttack(
    entity: Entity,
    facing: number,
    ai: Entity['enemyAI']
  ): void {
    if (!entity.weapon || !entity.input || !ai) return
    if (!entity.weapon.isEquipped) return
    if (!this.weaponSystem) return
    if (ai.comboSwingsDone >= ai.comboSwingTarget) return

    const weapon = entity.weapon
    const canQueue =
      weapon.attackPhase === 'idle' ||
      weapon.attackPhase === 'pause' ||
      weapon.attackPhase === 'rebound'

    if (!canQueue) return

    if (weapon.attackPhase === 'idle') {
      entity.input.lastMoveDirection =
        entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : (facing as -1 | 1)
      this.weaponSystem.startAttack(entity)
      ai.comboSwingsDone += 1
      return
    }

    if (!weapon.attackQueued) {
      weapon.attackQueued = true
      ai.comboSwingsDone += 1
    }
  }

  private resetEnemies(entities: Entity[]): void {
    for (const entity of entities) {
      if (!entity.input || !entity.enemyAI) continue
      entity.input.moveDirection = 0
      entity.input.facingOverride = null
      entity.input.blockRequested = false
      if (entity.enemyAI) {
        entity.enemyAI.state = 'approach'
        entity.enemyAI.probeSwitchTimerMs = 0
        entity.enemyAI.probePaceTimerMs = 0
        entity.enemyAI.probePaceDirection = 1
        entity.enemyAI.probePaceMovedDistance = 0
        entity.enemyAI.probeLastPositionX = 0
        entity.enemyAI.probeLastPositionY = 0
        entity.enemyAI.probeHasTriggered = false
        entity.enemyAI.forcedChaseDistanceRemaining = 0
        entity.enemyAI.paceMovedDistance = 0
        entity.enemyAI.paceLastPositionX = 0
        entity.enemyAI.paceLastPositionY = 0
        entity.enemyAI.arrowDefenseTimeRemainingMs = 0
        entity.enemyAI.arrowDefenseSwitchTimerMs = 0
        entity.enemyAI.arrowDefenseActive = false
        entity.enemyAI.bowHoldTimerMs = 0
        entity.enemyAI.bowCooldownTimerMs = 0
        entity.enemyAI.archerShotCheckPending = false
        entity.enemyAI.alertTimeRemainingMs = 0
        entity.enemyAI.alertPaceDirection = 1
        entity.enemyAI.alertPaceMovedDistance = 0
        entity.enemyAI.alertPaceLastPositionX = 0
        entity.enemyAI.alertPaceLastPositionY = 0
        entity.enemyAI.alertLastPaceSwitchTimestamp = 0
        entity.enemyAI.alertNextPaceResumeTimestamp = 0
        entity.enemyAI.alertChaseActive = false
      }
      if (entity.movement && entity.enemyAI) {
        entity.movement.moveSpeed = entity.enemyAI.moveSpeed
      }
      if (entity.weapon) {
        entity.weapon.attackQueued = false
      }
      if (entity.input) {
        entity.input.sprintRequested = false
      }
    }
  }

  private getWeaponAttackRadius(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const entityRadius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    // 使用武器长度计算攻击半径：玩家半径 + 武器长度的一半 + 安全间隙
    return entityRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
  }

  private getArcherBowAmmo(entity: Entity): number {
    if (entity.weapon?.weaponType === 'bow') {
      return entity.weapon.bowAmmo
    }
    if (entity.weaponSlots?.secondary.weaponType === 'bow') {
      return entity.weaponSlots.secondary.bowAmmo
    }
    return 0
  }
}
