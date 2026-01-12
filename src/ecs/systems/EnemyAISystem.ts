import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_SPRINT_SPEED,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  ENEMY_ATTACK_RANGE_BUFFER,
  ENEMY_PACE_SPEED,
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
    for (const entity of entities) {
      if (!entity.transform || !entity.input || !entity.enemyAI) continue
      if (entity.faction?.faction !== Faction.Enemy) continue
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.sprintRequested = false
        if (entity.weapon) {
          entity.weapon.attackQueued = false
        }
        continue
      }

      // 如果处于击退硬直中，暂停AI控制，让物理引擎接管运动
      if (entity.movement && entity.movement.knockbackEndTime > now) {
        continue
      }

      const ai = entity.enemyAI
      if (now - ai.lastDecisionTimestamp < ai.decisionCooldownMs) {
        continue
      }
      ai.lastDecisionTimestamp = now

      const dx = this.player.transform.x - entity.transform.x
      const dy = this.player.transform.y - entity.transform.y
      const distance = Math.hypot(dx, dy)

      // 计算武器的有效攻击半径（与 WeaponSystem.getAttackRadius 相同逻辑）
      const weaponAttackRadius = this.getWeaponAttackRadius(entity)
      // 考虑目标（玩家）的半径，得到实际可攻击的距离
      const playerRadius = this.player.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const weaponRange = weaponAttackRadius + playerRadius

      const facing = dx >= 0 ? 1 : -1
      entity.input.facingOverride = facing

      // 使用传感器结果判断视线
      const hasLineOfSight =
        entity.sensor && entity.sensor.detectedTargetId === this.player.id
      ai.hasLineOfSight = !!hasLineOfSight

      // 战斗状态管理由StatsSystem负责，这里只记录是否有视线
      if (hasLineOfSight) {
        ai.targetLostTimer = 0
      } else {
        ai.targetLostTimer += deltaTime * 1000
      }

      const lostInterest = !hasLineOfSight && !entity.stats?.isInCombat

      if (
        ai.attackDesire <= 0 ||
        distance > ai.detectionRange ||
        lostInterest
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
                const isTouchingWall =
                  entity.movement && entity.movement.isTouchingWall

                // 只有接触墙壁时才启动序列（Stage 0 -> 1）
                if (isTouchingWall && ai.obstacleJumpStage === 0) {
                  // console.log('[Approach] Stuck at wall, starting jump sequence')
                  entity.input.jumpRequested = true
                  entity.input.inputBuffer.bufferAction('jump')
                  ai.obstacleJumpStage = 1
                  ai.jumpStartTimestamp = now
                  ai.jumpStartPosition.x = entity.transform.x
                  ai.jumpStartPosition.y = entity.transform.y
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

  private handlePatrol(
    entity: Entity,
    ai: EnemyAIComponent,
    now: number
  ): void {
    if (!entity.input || !entity.transform) return

    // 简单巡逻：如果在巡逻范围外，向中心移动；如果在范围内，随机停顿或移动
    const dx = entity.transform.x - ai.patrolCenter.x
    const dist = Math.abs(dx)

    if (dist > ai.patrolRange) {
      // 超出范围，返回中心
      entity.input.moveDirection = dx > 0 ? -1 : 1
      entity.input.facingOverride = entity.input.moveDirection
    } else {
      // 在范围内，随机移动
      // 使用简单的计时器来切换移动方向
      const patrolPeriod = 3000 // 3秒周期
      const phase = now % patrolPeriod
      if (phase < 1000) {
        entity.input.moveDirection = 1
        entity.input.facingOverride = 1
      } else if (phase < 2000) {
        entity.input.moveDirection = -1
        entity.input.facingOverride = -1
      } else {
        entity.input.moveDirection = 0
        entity.input.facingOverride = null
      }
    }

    // 重置战斗状态
    ai.state = 'approach'
    ai.comboSwingsDone = 0
    ai.obstacleJumpStage = 0
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
