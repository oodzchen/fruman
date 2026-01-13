import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_SPRINT_SPEED,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
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
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { EnemyAIComponent, Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { WeaponSystem } from './WeaponSystem'

export class EnemyAISystem extends System {
  private player?: Entity
  private weaponSystem?: WeaponSystem
  private box2d: MainModule
  private worldId: b2WorldId

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

  update(entities: Entity[], deltaTime: number): void {
    if (!this.player?.transform || this.player.stats?.isDead) {
      this.resetEnemies(entities)
      return
    }

    const now = Date.now()
    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0
    for (const entity of entities) {
      if (!entity.transform || !entity.input || !entity.enemyAI) continue
      if (entity.faction?.faction !== Faction.Enemy) continue
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

      const dx = this.player.transform.x - entity.transform.x
      const dy = this.player.transform.y - entity.transform.y
      const distance = Math.hypot(dx, dy)

      // 计算武器的有效攻击半径（与 WeaponSystem.getAttackRadius 相同逻辑）
      const weaponAttackRadius = this.getWeaponAttackRadius(entity)
      // 考虑目标（玩家）的半径，得到实际可攻击的距离
      const playerRadius = this.player.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const weaponRange = weaponAttackRadius + playerRadius

      // 使用传感器结果判断视线
      const hasLineOfSight =
        entity.sensor && entity.sensor.detectedTargetId === this.player.id
      const isPlayerSwinging = this.player.weapon
        ? this.player.weapon.attackPhase === 'swing'
        : false
      this.updateParryState(
        entity,
        ai,
        isPlayerSwinging,
        distance,
        weaponRange,
        !!hasLineOfSight
      )
      const isEngaged = !!hasLineOfSight || !!entity.stats?.isInCombat
      this.updateProbeCycle(
        entity,
        ai,
        deltaMs,
        isEngaged,
        distance,
        weaponRange
      )

      if (now - ai.lastDecisionTimestamp < ai.decisionCooldownMs) {
        continue
      }
      ai.lastDecisionTimestamp = now

      const facing = dx >= 0 ? 1 : -1
      entity.input.facingOverride = facing

      ai.hasLineOfSight = !!hasLineOfSight

      // 战斗状态管理由StatsSystem负责，这里只记录是否有视线
      if (hasLineOfSight) {
        ai.targetLostTimer = 0
      } else {
        ai.targetLostTimer += deltaMs
      }

      const lostInterest = !hasLineOfSight && !entity.stats?.isInCombat

      // 计算当前位置距离巡逻中心的距离
      const distFromPatrolCenter = Math.hypot(
        entity.transform.x - ai.patrolCenter.x,
        entity.transform.y - ai.patrolCenter.y
      )
      // 如果超出了从巡逻区域边缘（patrolRange）开始计算的可视距离（detectionRange），
      // 且当前没有看到玩家，则不再追击
      const isTooFarFromPatrol =
        distFromPatrolCenter > ai.patrolRange + ai.detectionRange
      const shouldRetreatDueToDistance = isTooFarFromPatrol && !hasLineOfSight

      if (
        ai.attackDesire <= 0 ||
        distance > ai.detectionRange ||
        lostInterest ||
        shouldRetreatDueToDistance
      ) {
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

      // 敌人锁定玩家（进入战斗状态）
      if (entity.input && entity.input.lockedTargetId !== this.player.id) {
        entity.input.lockedTargetId = this.player.id
        entity.input.lockLostTimer = 0
      }

      if (ai.state === 'probe') {
        this.handleProbeState(
          entity,
          ai,
          distance,
          weaponRange,
          facing,
          deltaMs
        )
        continue
      }

      if (ai.state === 'approach') {
        // 如果正在进行跨越障碍跳跃序列，优先处理
        if (ai.obstacleJumpStage > 0) {
          entity.input.moveDirection = facing // 保持向前移动
          this.handleObstacleJump(entity, ai, now, facing)
          continue
        }

        if (distance > weaponRange) {
          entity.input.moveDirection = facing
          if (entity.movement && hasLineOfSight) {
            // 如果基础速度小于奔跑速度（人类奔跑速度），则尝试奔跑
            if (entity.movement.moveSpeed < DEFAULT_SPRINT_SPEED) {
              entity.input.sprintRequested = true
            } else {
              entity.input.sprintRequested = false
            }
          } else {
            entity.input.sprintRequested = false
          }

          // 检测是否被阻挡（每300ms检查一次位置变化）
          if (now - ai.lastPositionUpdateTime >= ai.positionCheckInterval) {
            const deltaX = Math.abs(entity.transform.x - ai.lastPosition.x)
            const deltaY = Math.abs(entity.transform.y - ai.lastPosition.y)
            // 300ms内移动距离小于0.3认为被阻挡（正常速度3m/s应该移动0.9m）
            const positionChanged = deltaX > 0.3 || deltaY > 0.3

            // 在追击状态下（战斗中）检测阻挡，即使视线被遮挡
            const isChasing = entity.stats?.isInCombat || hasLineOfSight
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
          ai.state = 'combo'
          ai.comboSwingsDone = 0
          ai.comboSwingTarget = Math.max(ai.comboSwingTarget, 3)
          ai.lastFacing = facing
          if (entity.weapon) {
            entity.weapon.attackQueued = false
            entity.weapon.comboCount = 0
            entity.weapon.nextSwingDirection = 'toFront'
            entity.weapon.swingDirection = 'toFront'
          }
          entity.input.moveDirection = 0
          entity.input.sprintRequested = false
          ai.stuckTimer = 0
          this.queueAttack(entity, facing, ai)
        }
        continue
      }

      if (ai.state === 'combo') {
        ai.lastFacing = facing
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
          if (distance > weaponRange) {
            ai.state = 'approach'
            ai.comboSwingsDone = 0
            continue
          }
        }

        this.queueAttack(entity, facing, ai)
        const weapon = entity.weapon
        const comboFinished =
          weapon &&
          ai.comboSwingsDone >= ai.comboSwingTarget &&
          weapon.attackPhase === 'idle' &&
          !weapon.attackQueued
        if (comboFinished) {
          ai.state = 'retreat'
          ai.retreatDirection = (ai.lastFacing === 1 ? -1 : 1) as -1 | 1
          ai.retreatTargetDistance = weaponRange + ENEMY_RETREAT_EXTRA_DISTANCE
          entity.input.moveDirection = ai.retreatDirection
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
          entity.input.moveDirection = 0
          this.queueAttack(entity, facing, ai)
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
        if (hasLineOfSight) {
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

        // 检查是否需要切换方向或进入暂停
        if (now - ai.lastPaceSwitchTimestamp >= ai.paceSwitchIntervalMs) {
          // 切换踱步方向：前进和后退交替
          ai.paceDirection = (ai.paceDirection === 1 ? -1 : 1) as -1 | 1
          ai.lastPaceSwitchTimestamp = now
          ai.nextPaceResumeTimestamp = now + ai.pacePauseMs
          entity.input.moveDirection = 0
          // console.log(
          //   `[Pacing] Switching direction to ${ai.paceDirection}, pausing for ${ai.pacePauseMs}ms`
          // )
          continue
        }

        // 前后踱步：朝向玩家方向移动或远离
        // paceDirection=1 表示靠近玩家，-1 表示远离玩家
        const computedMoveDir = (facing * ai.paceDirection) as -1 | 1
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

    ai.probeSwitchTimerMs = 0
    ai.probePaceTimerMs = 0
    ai.probePaceDirection = 1
    ai.probePaceMovedDistance = 0
    ai.probeLastPositionX = 0
    ai.probeLastPositionY = 0
    ai.probeHasTriggered = false
    if (entity.movement) {
      entity.movement.moveSpeed = ai.moveSpeed
    }

    // 如果没有设置巡逻点，使用默认的原地待机逻辑
    if (!ai.patrolWaypoints || ai.patrolWaypoints.length === 0) {
      entity.input.moveDirection = 0
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
      entity.input.moveDirection = facing
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

  private updateProbeCycle(
    entity: Entity,
    ai: EnemyAIComponent,
    deltaMs: number,
    isEngaged: boolean,
    distance: number,
    weaponRange: number
  ): void {
    if (ai.parryProficiency < 50 || !isEngaged) {
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
        this.startProbeState(entity, ai)
        return
      }
    }

    if (ai.state === 'probe') {
      if (ai.probeSwitchTimerMs <= 0) {
        this.startProbeState(entity, ai)
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

    this.startProbeState(entity, ai)
  }

  private startProbeState(entity: Entity, ai: EnemyAIComponent): void {
    ai.state = 'probe'
    ai.probeHasTriggered = true
    ai.probeSwitchTimerMs = this.getProbeDurationMs()
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
      return
    }

    if (distance > maxDistance) {
      entity.input.moveDirection = facing as -1 | 1
      ai.probePaceTimerMs = 0
      ai.probePaceMovedDistance = 0
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

  private getProbeDurationMs(): number {
    const range = ENEMY_PROBE_DURATION_MAX_MS - ENEMY_PROBE_DURATION_MIN_MS
    return ENEMY_PROBE_DURATION_MIN_MS + Math.random() * range
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

  private queueAttack(
    entity: Entity,
    facing: number,
    ai: Entity['enemyAI']
  ): void {
    if (!entity.weapon || !entity.input || !ai) return
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
      if (!entity.input || entity.faction?.faction !== Faction.Enemy) continue
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
}
