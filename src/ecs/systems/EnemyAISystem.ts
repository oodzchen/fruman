import {
  DEFAULT_WEAPON_ATTACK_RADIUS,
  ENEMY_ATTACK_RANGE_BUFFER,
  ENEMY_RETREAT_EXTRA_DISTANCE,
} from '../../constants'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'
import type { WeaponSystem } from './WeaponSystem'

export class EnemyAISystem extends System {
  private player?: Entity
  private weaponSystem?: WeaponSystem

  constructor() {
    super()
    const transformType = componentRegistry.getComponentType('Transform')
    const inputType = componentRegistry.getComponentType('Input')
    const factionType = componentRegistry.getComponentType('Faction')
    const aiType = componentRegistry.getComponentType('EnemyAI')
    this.setRequiredComponents([transformType, inputType, factionType, aiType])
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
      const weaponRange =
        (entity.weapon?.attackRadius || DEFAULT_WEAPON_ATTACK_RADIUS) +
        ENEMY_ATTACK_RANGE_BUFFER
      const spacingTolerance = 0.2
      const facing = dx >= 0 ? 1 : -1
      entity.input.facingOverride = facing

      if (ai.attackDesire <= 0 || distance > ai.detectionRange) {
        entity.input.moveDirection = 0
        if (entity.weapon) {
          entity.weapon.attackQueued = false
        }
        ai.state = 'approach'
        ai.comboSwingsDone = 0
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

  private clamp01(value: number): number {
    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }
}
