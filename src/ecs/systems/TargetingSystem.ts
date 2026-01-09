import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_PLAYER_RADIUS,
  ENEMY_DETECTION_RANGE,
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class TargetingSystem extends System {
  private player?: Entity
  private box2d: MainModule
  private worldId: b2WorldId

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    const transformType = componentRegistry.getComponentType('Transform')
    const inputType = componentRegistry.getComponentType('Input')
    const factionType = componentRegistry.getComponentType('Faction')
    this.setRequiredComponents([transformType, inputType, factionType])
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  update(entities: Entity[], _deltaTime: number): void {
    if (!this.player || !this.player.input || !this.player.transform) return

    const input = this.player.input

    const playerPos = this.player.transform
    let enemyInDetectionRange = false

    // 处理锁定切换

    if (input.lockSwitchIntent !== 0 && input.lockedTargetId !== null) {
      const currentTarget = entities.find((e) => e.id === input.lockedTargetId)

      if (currentTarget && currentTarget.transform) {
        const switchDir = input.lockSwitchIntent

        let bestCandidateId: number | null = null

        let minDistance = Infinity

        for (const entity of entities) {
          if (entity.id === this.player.id || entity.id === currentTarget.id)
            continue

          if (
            !entity.transform ||
            !entity.faction ||
            entity.stats?.isDead ||
            entity.stats?.isVanished
          )
            continue

          if (entity.faction.faction !== Faction.Enemy) continue

          const dx = entity.transform.x - currentTarget.transform.x

          // 只找指定方向的敌人（例如按右键只找右边的）

          if ((switchDir > 0 && dx > 0) || (switchDir < 0 && dx < 0)) {
            const dist = Math.abs(dx) // 简单使用X轴距离作为优先级

            if (dist < minDistance) {
              minDistance = dist

              bestCandidateId = entity.id
            }
          }
        }

        if (bestCandidateId !== null) {
          input.lockedTargetId = bestCandidateId
        }
      }

      input.lockSwitchIntent = 0
    }

    // 处理锁定/解锁

    if (input.lockToggleRequested) {
      input.lockToggleRequested = false

      if (input.lockedTargetId !== null) {
        // 已锁定 -> 解锁

        input.lockedTargetId = null
      } else {
        // 未锁定 -> 寻找最近敌人

        let nearestDist = Infinity

        let nearestTargetId: number | null = null

        for (const entity of entities) {
          if (entity.id === this.player.id) continue

          if (
            !entity.transform ||
            !entity.faction ||
            entity.stats?.isDead ||
            entity.stats?.isVanished
          )
            continue

          if (entity.faction.faction !== Faction.Enemy) continue

          const dx = entity.transform.x - playerPos.x

          const dy = entity.transform.y - playerPos.y

          const dist = Math.hypot(dx, dy)

          if (dist > ENEMY_DETECTION_RANGE * 1.5) continue

          if (dist < nearestDist) {
            nearestDist = dist

            nearestTargetId = entity.id
          }
        }

        input.lockedTargetId = nearestTargetId
      }
    }

    // 验证当前目标是否有效（例如死亡或超出范围），如果无效则解除锁定

    if (input.lockedTargetId !== null) {
      const target = entities.find((e) => e.id === input.lockedTargetId)

      if (
        !target ||
        !target.transform ||
        target.stats?.isDead ||
        target.stats?.isVanished
      ) {
        input.lockedTargetId = null
      } else {
        const dx = target.transform.x - playerPos.x

        const dy = target.transform.y - playerPos.y

        const dist = Math.hypot(dx, dy)

        if (dist > ENEMY_DETECTION_RANGE * 2.0) {
          // 超出最大锁定距离自动脱锁

          input.lockedTargetId = null
        }
      }
    }

    // 自动检测范围内的敌人以进入战斗状态
    for (const entity of entities) {
      if (entity.id === this.player.id) continue
      if (
        !entity.transform ||
        !entity.faction ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      )
        continue
      if (entity.faction.faction !== Faction.Enemy) continue

      const dx = entity.transform.x - playerPos.x
      const dy = entity.transform.y - playerPos.y
      const dist = Math.hypot(dx, dy)

      if (dist <= ENEMY_DETECTION_RANGE) {
        if (this.checkLineOfSight(playerPos, entity.transform)) {
          enemyInDetectionRange = true
          break // 只要发现一个敌人就足够进入战斗状态
        }
      }
    }

    if (enemyInDetectionRange && this.player.weapon?.isEquipped) {
      this.player.weapon.isInCombat = true
      this.player.weapon.lastAttackTimestamp = Date.now()
    }
  }

  private checkLineOfSight(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): boolean {
    const { b2World_CastRayClosest, b2Vec2, b2DefaultQueryFilter } = this.box2d

    const startVec = new b2Vec2(start.x, start.y)
    const endVec = new b2Vec2(end.x, end.y)
    const filter = b2DefaultQueryFilter()
    filter.maskBits = CATEGORY_OBSTACLE | CATEGORY_GROUND

    const output = b2World_CastRayClosest(
      this.worldId,
      startVec,
      endVec,
      filter
    )
    const hit = output.hit
    let visible = true

    if (hit) {
      visible = false
    }

    startVec.delete()
    endVec.delete()
    filter.delete()
    output.delete()
    return visible
  }
}
