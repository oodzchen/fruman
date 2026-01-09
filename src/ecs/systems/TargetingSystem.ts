import {
  CATEGORY_ENEMY,
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  CATEGORY_PLAYER,
  ENEMY_DETECTION_RANGE,
} from '../../constants'
import type { MainModule, b2ShapeId, b2WorldId } from '../../types'
import { Faction, SensorComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class TargetingSystem extends System {
  private box2d: MainModule
  private worldId: b2WorldId
  private shapeMap: Map<string, Entity> = new Map()
  private player?: Entity
  private shapeMapDirty = true
  private lastShapeMapRebuild = 0
  private shapeMapRebuildInterval = 1000

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    const transformType = componentRegistry.getComponentType('Transform')
    const sensorType = componentRegistry.getComponentType('Sensor')
    const inputType = componentRegistry.getComponentType('Input')
    this.setRequiredComponents([transformType, sensorType, inputType])
  }

  markShapeMapDirty(): void {
    this.shapeMapDirty = true
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  update(entities: Entity[], _deltaTime: number): void {
    const now = Date.now()

    // 1. 只在必要时重建 Shape ID 映射表
    if (
      this.shapeMapDirty ||
      now - this.lastShapeMapRebuild > this.shapeMapRebuildInterval
    ) {
      this.rebuildShapeMap(entities)
      this.shapeMapDirty = false
      this.lastShapeMapRebuild = now
    }

    // 2. 更新所有带有传感器的实体
    for (const entity of entities) {
      if (!entity.transform || !entity.sensor) continue
      if (entity.stats?.isDead || entity.stats?.isVanished) continue

      // 频率限制
      if (
        now - entity.sensor.lastScanTimestamp <
        entity.sensor.scanIntervalMs
      ) {
        continue
      }
      entity.sensor.lastScanTimestamp = now

      this.updateSensor(entity)
    }

    // 3. 处理玩家锁定逻辑
    if (this.player) {
      this.handlePlayerLock(this.player, entities)
    }
  }

  private handlePlayerLock(player: Entity, entities: Entity[]): void {
    if (!player.input || !player.transform) return
    const input = player.input

    // Toggle Lock
    if (input.lockToggleRequested) {
      input.lockToggleRequested = false
      if (input.lockedTargetId !== null) {
        input.lockedTargetId = null
      } else {
        // Lock onto the closest detected target from sensor
        // If sensor detected someone, use it.
        // Note: sensor.detectedTargetId is the closest hostile already.
        if (player.sensor && player.sensor.detectedTargetId !== null) {
          input.lockedTargetId = player.sensor.detectedTargetId
        }
      }
    }

    // Switch Target (Simplified: Iterate all entities to find best candidate in direction)
    // Maintaining old logic for switching as it might need to search outside current narrow ray hits?
    // Or restrict to visible? Let's restrict to visible for consistency.
    if (input.lockSwitchIntent !== 0 && input.lockedTargetId !== null) {
      const currentTarget = entities.find((e) => e.id === input.lockedTargetId)
      if (currentTarget && currentTarget.transform) {
        const switchDir = input.lockSwitchIntent
        let bestId: number | null = null
        let minDistance = Infinity

        // Search inside scan results first? Or global?
        // Let's use global but check visibility if we can, or just distance.
        // Given the request for "Raycast detection", locking should probably imply visibility.
        // But for switching, maybe we just search entities list.
        for (const entity of entities) {
          if (entity.id === player.id || entity.id === currentTarget.id)
            continue
          if (
            entity.faction?.faction !== Faction.Enemy ||
            entity.stats?.isDead ||
            entity.stats?.isVanished
          )
            continue

          const dx = entity.transform!.x - currentTarget.transform.x
          if ((switchDir > 0 && dx > 0) || (switchDir < 0 && dx < 0)) {
            const dist = Math.abs(dx)
            if (dist < minDistance) {
              minDistance = dist
              bestId = entity.id
            }
          }
        }

        if (bestId !== null) {
          input.lockedTargetId = bestId
        }
      }
      input.lockSwitchIntent = 0
    }

    // Validate Lock
    if (input.lockedTargetId !== null) {
      const target = entities.find((e) => e.id === input.lockedTargetId)
      if (!target || target.stats?.isDead || target.stats?.isVanished) {
        input.lockedTargetId = null
      } else {
        // Distance check
        const dx = target.transform!.x - player.transform.x
        const dy = target.transform!.y - player.transform.y
        if (Math.hypot(dx, dy) > ENEMY_DETECTION_RANGE * 2.0) {
          input.lockedTargetId = null
        }
      }
    }
  }

  private rebuildShapeMap(entities: Entity[]): void {
    this.shapeMap.clear()
    for (const entity of entities) {
      if (entity.physics && entity.physics.shapeId) {
        // 假设 box2d-wasm 的 shapeId 包含 index 属性
        // 如果 shapeId 是数字则直接使用
        const key = this.getShapeKey(entity.physics.shapeId)
        this.shapeMap.set(key, entity)
      }
    }
  }

  private getShapeKey(shapeId: any): string {
    if (typeof shapeId === 'object' && shapeId !== null) {
      // Box2D v3 uses index1, world0, generation

      const index = shapeId.index ?? shapeId.index1 ?? 0

      const world0 = shapeId.world0 ?? 0

      const revision = shapeId.revision ?? shapeId.generation ?? 0

      return `${index}_${world0}_${revision}`
    }

    return String(shapeId)
  }

  private updateSensor(entity: Entity): void {
    if (!entity.transform || !entity.sensor) return

    const { radius } = entity.sensor
    const { x, y } = entity.transform

    let facingDir = 1
    if (entity.input) {
      if (
        entity.input.facingOverride !== null &&
        entity.input.facingOverride !== 0
      ) {
        facingDir = entity.input.facingOverride
      } else if (entity.input.lastMoveDirection !== 0) {
        facingDir = entity.input.lastMoveDirection
      }
    } else if (entity.weapon) {
      facingDir = entity.weapon.attackFacing
    }

    // Default to right if facingDir is >= 0. Left if < 0.
    const baseAngle = facingDir >= 0 ? 0 : Math.PI

    // Ray starts from eye position (offset from entity center)
    const eyeOffsetX = facingDir >= 0 ? 0.25 : -0.25
    const eyeOffsetY = -0.25
    const startX = x + eyeOffsetX
    const startY = y + eyeOffsetY

    // Fixed angles: Up-Forward (-45deg), Forward (0), Down-Forward (+45deg)
    const angles = [baseAngle - Math.PI / 4, baseAngle, baseAngle + Math.PI / 4]

    entity.sensor.scanResults = []
    let detectedHostileId: number | null = null

    const { b2Vec2, b2World_CastRayClosest, b2DefaultQueryFilter } = this.box2d

    const startVec = new b2Vec2(startX, startY)
    const translationVec = new b2Vec2(0, 0)
    const filter = b2DefaultQueryFilter()

    // Determine mask based on faction to avoid hitting self
    let mask =
      CATEGORY_OBSTACLE | CATEGORY_GROUND | CATEGORY_PLAYER | CATEGORY_ENEMY
    if (entity.faction?.faction === Faction.Player) {
      mask &= ~CATEGORY_PLAYER
    } else if (entity.faction?.faction === Faction.Enemy) {
      mask &= ~CATEGORY_ENEMY
    }
    filter.maskBits = mask

    for (const rayAngle of angles) {
      const dx = Math.cos(rayAngle) * radius
      const dy = Math.sin(rayAngle) * radius
      const endX = startX + dx
      const endY = startY + dy
      translationVec.Set(dx, dy)

      const output = b2World_CastRayClosest(
        this.worldId,
        startVec,
        translationVec,
        filter
      )

      const hit = output.hit
      let hitEntityId: number | undefined
      let hitPoint: { x: number; y: number } | undefined
      let isHostile = false

      if (hit) {
        hitPoint = { x: output.point.x, y: output.point.y }

        const shapeKey = this.getShapeKey(output.shapeId)
        const hitEntity = this.shapeMap.get(shapeKey)

        if (hitEntity) {
          hitEntityId = hitEntity.id

          // Check for hostile
          if (
            entity.faction &&
            hitEntity.faction &&
            entity.faction.canAttack(hitEntity.faction) &&
            !hitEntity.stats?.isDead &&
            !hitEntity.stats?.isVanished
          ) {
            isHostile = true
            detectedHostileId = hitEntityId
          }
        }
      }

      entity.sensor.scanResults.push({
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        hit,
        hitPoint,
        hitEntityId,
        isHostile,
      })
    }

    translationVec.delete()
    startVec.delete()
    filter.delete()

    if (detectedHostileId !== null) {
      entity.sensor.detectedTargetId = detectedHostileId

      // Auto-combat state for player/enemies upon detection
      if (entity.weapon && !entity.weapon.isInCombat) {
        entity.weapon.isInCombat = true
        entity.weapon.lastAttackTimestamp = Date.now()
      }
    }
  }

  private processScanResults(_entity: Entity): void {
    // Logic moved to updateSensor to avoid double loops
  }
}
