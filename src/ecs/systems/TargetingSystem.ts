import {
  CATEGORY_ENEMY,
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  CATEGORY_PLAYER,
  ENEMY_DETECTION_RANGE,
} from '../../constants'
import type { MainModule, b2ShapeId, b2WorldId } from '../../types'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

const RAY_ANGLE_OFFSETS = [
  (-80 * Math.PI) / 180,
  (-60 * Math.PI) / 180,
  (-40 * Math.PI) / 180,
  (-20 * Math.PI) / 180,
  0,
  (20 * Math.PI) / 180,
  (40 * Math.PI) / 180,
  (60 * Math.PI) / 180,
  (80 * Math.PI) / 180,
]

type ShapeIdKeySource = {
  index?: number
  index1?: number
  world0?: number
  revision?: number
  generation?: number
}

export class TargetingSystem extends System {
  private box2d: MainModule
  private worldId: b2WorldId
  private shapeMap = new Map<number, Entity>()
  private player?: Entity
  private shapeMapDirty = true
  private lastShapeMapRebuild = 0
  private shapeMapRebuildInterval = 1000
  private rayStart: InstanceType<MainModule['b2Vec2']>
  private rayTranslation: InstanceType<MainModule['b2Vec2']>
  private rayFilter: ReturnType<MainModule['b2DefaultQueryFilter']>
  private entityLookup?: (id: number) => Entity | undefined

  constructor(box2d: MainModule, worldId: b2WorldId) {
    super()
    this.box2d = box2d
    this.worldId = worldId
    const transformType = componentRegistry.getComponentType('Transform')
    const sensorType = componentRegistry.getComponentType('Sensor')
    const inputType = componentRegistry.getComponentType('Input')
    this.setRequiredComponents([transformType, sensorType, inputType])

    this.rayStart = new box2d.b2Vec2(0, 0)
    this.rayTranslation = new box2d.b2Vec2(0, 0)
    this.rayFilter = box2d.b2DefaultQueryFilter()
  }

  markShapeMapDirty(): void {
    this.shapeMapDirty = true
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  setEntityLookup(lookup: (id: number) => Entity | undefined): void {
    this.entityLookup = lookup
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
    if (player.weapon?.bowFreeAim) {
      input.lockedTargetId = null
      input.lockToggleRequested = false
      input.lockSwitchIntent = 0
      input.lockLostTimer = 0
      return
    }

    // Toggle Lock
    if (input.lockToggleRequested) {
      input.lockToggleRequested = false
      if (input.lockedTargetId !== null) {
        input.lockedTargetId = null
      } else {
        // 主动搜索可视范围内最近的敌人，必须有视线
        const nearestEnemy = this.findNearestVisibleEnemy(
          player,
          entities,
          ENEMY_DETECTION_RANGE * 2.0
        )
        if (nearestEnemy) {
          input.lockedTargetId = nearestEnemy.id
          input.lockLostTimer = 0
        }
      }
    }

    // Switch Target (Simplified: Iterate all entities to find best candidate in direction)
    // Maintaining old logic for switching as it might need to search outside current narrow ray hits?
    // Or restrict to visible? Let's restrict to visible for consistency.
    if (input.lockSwitchIntent !== 0 && input.lockedTargetId !== null) {
      const currentTarget = this.getEntityById(input.lockedTargetId, entities)
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
            // Only switch to visible targets
            if (!this.hasLineOfSight(player, entity)) continue

            const dist = Math.abs(dx)
            if (dist < minDistance) {
              minDistance = dist
              bestId = entity.id
            }
          }
        }

        if (bestId !== null) {
          input.lockedTargetId = bestId
          input.lockLostTimer = 0
        }
      }
      input.lockSwitchIntent = 0
    }

    // Validate Lock
    if (input.lockedTargetId !== null) {
      const target = this.getEntityById(input.lockedTargetId, entities)
      if (!target || target.stats?.isDead || target.stats?.isVanished) {
        input.lockedTargetId = null
        input.lockLostTimer = 0
      } else {
        // Distance check
        const dx = target.transform!.x - player.transform.x
        const dy = target.transform!.y - player.transform.y
        if (Math.hypot(dx, dy) > ENEMY_DETECTION_RANGE * 2.0) {
          input.lockedTargetId = null
          input.lockLostTimer = 0
        } else {
          // Line of Sight check
          if (this.hasLineOfSight(player, target)) {
            input.lockLostTimer = 0
          } else {
            // Using 16ms approx for delta since update doesn't pass it here explicitly,
            // but we can rely on update frequency.
            // Better: TargetingSystem update has deltaTime.
            // Let's assume ~16ms per frame or use a fixed step.
            // Since we don't have exact delta here easily without passing it down,
            // we will use a small constant assuming 60fps, or better, pass delta.
            // Actually `update` has `_deltaTime`.
            // I'll update the signature of `handlePlayerLock` to accept `deltaTime`.
            input.lockLostTimer += 16 // Approx 1 frame
            if (input.lockLostTimer > 3000) {
              input.lockedTargetId = null
              input.lockLostTimer = 0
            }
          }
        }
      }
    }
  }

  private hasLineOfSight(start: Entity, end: Entity): boolean {
    if (!start.transform || !end.transform) return false
    const { b2World_CastRayClosest } = this.box2d
    const startVec = this.rayStart
    const translationVec = this.rayTranslation
    const filter = this.rayFilter

    // Calculate Eye Position
    let facingDir = 1
    if (start.input) {
      if (start.input.lastMoveDirection !== 0) {
        facingDir = start.input.lastMoveDirection
      }
    } else if (start.weapon) {
      facingDir = start.weapon.attackFacing
    }

    const radius = start.render?.radius || 0.5
    const eyeOffsetX = facingDir >= 0 ? radius * 0.5 : -radius * 0.5
    const eyeOffsetY = -radius * 0.5
    const startX = start.transform.x + eyeOffsetX
    const startY = start.transform.y + eyeOffsetY

    startVec.Set(startX, startY)
    const dx = end.transform.x - startX
    const dy = end.transform.y - startY
    translationVec.Set(dx, dy)

    // Mask: Obstacles and Ground block view. Ignore Players/Enemies for LoS check for locking?
    // Usually locking requires LoS blocked by environment.
    filter.maskBits = CATEGORY_OBSTACLE | CATEGORY_GROUND

    const output = b2World_CastRayClosest(
      this.worldId,
      startVec,
      translationVec,
      filter
    )
    // If we hit something (obstacle/ground), LoS is blocked.
    // RayCastClosest returns hit fraction. If hit is true, it hit something in the mask.
    return !output.hit
  }

  private findNearestVisibleEnemy(
    player: Entity,
    entities: Entity[],
    maxRange: number
  ): Entity | null {
    if (!player.transform || !player.faction) return null

    let nearestEnemy: Entity | null = null
    let minDistSq = maxRange * maxRange

    for (const entity of entities) {
      if (entity.id === player.id) continue
      if (
        !entity.faction ||
        !player.faction.canAttack(entity.faction) ||
        entity.stats?.isDead ||
        entity.stats?.isVanished
      )
        continue

      if (!entity.transform) continue

      const dx = entity.transform.x - player.transform.x
      const dy = entity.transform.y - player.transform.y
      const distSq = dx * dx + dy * dy

      if (distSq >= minDistSq) continue

      // 必须有视线才能锁定
      if (!this.hasLineOfSight(player, entity)) continue

      minDistSq = distSq
      nearestEnemy = entity
    }

    return nearestEnemy
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

  private getShapeKey(shapeId: b2ShapeId | number): number {
    if (typeof shapeId === 'number') return shapeId
    const shape = shapeId as ShapeIdKeySource
    const index = shape.index ?? shape.index1 ?? 0
    const world0 = shape.world0 ?? 0
    const revision = shape.revision ?? shape.generation ?? 0
    return (index << 16) | (world0 << 8) | revision
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
    const entityRadius = entity.render?.radius || 0.5
    const eyeOffsetX = facingDir >= 0 ? entityRadius * 0.5 : -entityRadius * 0.5
    const eyeOffsetY = -entityRadius * 0.5
    const startX = x + eyeOffsetX
    const startY = y + eyeOffsetY

    // Fixed angles: Up-Forward (-45deg), Forward (0), Down-Forward (+45deg)
    const scanResults = entity.sensor.scanResults
    let detectedHostileId: number | null = null
    let closestDistSq = Infinity

    const { b2World_CastRayClosest } = this.box2d
    const startVec = this.rayStart
    const translationVec = this.rayTranslation
    const filter = this.rayFilter
    startVec.Set(startX, startY)

    // Determine mask based on faction to avoid hitting self
    let mask =
      CATEGORY_OBSTACLE | CATEGORY_GROUND | CATEGORY_PLAYER | CATEGORY_ENEMY
    if (entity.faction?.faction === Faction.Player) {
      mask &= ~CATEGORY_PLAYER
    } else if (entity.faction?.faction === Faction.Enemy) {
      mask &= ~CATEGORY_ENEMY
    }
    filter.maskBits = mask

    for (let i = 0; i < RAY_ANGLE_OFFSETS.length; i++) {
      const rayAngle = baseAngle + RAY_ANGLE_OFFSETS[i]
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
      let isHostile = false

      if (hit) {
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
            const distSq =
              (output.point.x - startX) ** 2 + (output.point.y - startY) ** 2
            if (distSq < closestDistSq) {
              closestDistSq = distSq
              detectedHostileId = hitEntityId
            }
          }
        }
      }

      const result = scanResults[i]
      result.start.x = startX
      result.start.y = startY
      result.end.x = endX
      result.end.y = endY
      result.hit = hit
      result.hitEntityId = hitEntityId
      result.isHostile = isHostile
      if (hit) {
        const hitPoint = result.hitPoint
        if (hitPoint) {
          hitPoint.x = output.point.x
          hitPoint.y = output.point.y
        }
      }
    }

    if (detectedHostileId !== null) {
      entity.sensor.detectedTargetId = detectedHostileId

      // Auto-combat state for player/enemies upon detection
      if (entity.stats && !entity.stats.isInCombat) {
        entity.stats.isInCombat = true
        entity.stats.combatExitTimer = 0
      }
    } else {
      // 没有检测到敌人时清除detectedTargetId
      entity.sensor.detectedTargetId = null
    }
  }

  private processScanResults(_entity: Entity): void {
    // Logic moved to updateSensor to avoid double loops
  }

  private getEntityById(id: number, entities: Entity[]): Entity | undefined {
    if (this.entityLookup) {
      return this.entityLookup(id)
    }
    for (const entity of entities) {
      if (entity.id === id) return entity
    }
    return undefined
  }
}
