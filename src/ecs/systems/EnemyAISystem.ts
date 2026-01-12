import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  ENEMY_ATTACK_RANGE_BUFFER,
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
        continue
      }

      if (ai.state === 'approach') {
        if (distance > weaponRange) {
          entity.input.moveDirection = facing
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
          this.queueAttack(entity, facing, ai)
        }
        continue
      }

      if (ai.state === 'combo') {
        ai.lastFacing = facing
        entity.input.moveDirection = 0
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
    }
  }

  private getWeaponAttackRadius(entity: Entity): number {
    const weapon = entity.weapon
    if (!weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const entityRadius = entity.render?.radius || DEFAULT_PLAYER_RADIUS
    // 使用武器长度计算攻击半径：玩家半径 + 武器长度的一半 + 安全间隙
    const minRadius =
      entityRadius + weapon.width / 2 + DEFAULT_WEAPON_PLAYER_CLEARANCE
    return Math.max(DEFAULT_WEAPON_ATTACK_RADIUS, minRadius)
  }
}
