import {
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
} from '../../characterBodyProfile'
import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  ENEMY_DETECTION_RANGE,
} from '../../constants'
import type { MainModule, b2ShapeId, b2WorldId } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

const VERTEX_OFFSETS = [-1, -1, 1, -1, 1, 1, -1, 1]

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
  private shapeMapRebuildInterval = 1000
  private shapeMapRebuildTimerMs = 0
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

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0
    this.shapeMapRebuildTimerMs += deltaMs

    // 1. 只在必要时重建 Shape ID 映射表
    if (
      this.shapeMapDirty ||
      this.shapeMapRebuildTimerMs >= this.shapeMapRebuildInterval
    ) {
      this.rebuildShapeMap(entities)
      this.shapeMapDirty = false
      this.shapeMapRebuildTimerMs = 0
    }

    // 2. 更新所有带有传感器的实体
    for (const entity of entities) {
      if (!entity.transform || !entity.sensor) continue
      if (entity.stats?.isDead || entity.stats?.isVanished) continue

      // 频率限制
      entity.sensor.scanElapsedMs += deltaMs
      if (entity.sensor.scanElapsedMs < entity.sensor.scanIntervalMs) {
        continue
      }
      entity.sensor.scanElapsedMs = 0

      this.updateSensor(entity, entities)
    }

    // 3. 处理玩家锁定逻辑
    if (this.player) {
      this.handlePlayerLock(this.player, entities, deltaMs)
    }
  }

  private handlePlayerLock(
    player: Entity,
    entities: Entity[],
    deltaMs: number
  ): void {
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
            !entity.faction ||
            !player.faction?.canAttackEntity(
              entity.faction,
              entity.id.toString()
            ) ||
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
            const lockDeltaMs = deltaMs > 0 ? deltaMs : 0
            input.lockLostTimer += lockDeltaMs
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
    const eyeOffsetX = getCharacterEyeOffsetX(
      start.render?.bodyProfile,
      radius,
      facingDir
    )
    const eyeOffsetY = getCharacterEyeOffsetY(
      start.render?.bodyProfile,
      radius,
      start.render?.bodyHeight ?? 0
    )
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
        !player.faction.canAttackEntity(entity.faction, entity.id.toString()) ||
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
        if (entity.physics.shapeIds.length > 0) {
          for (let i = 0; i < entity.physics.shapeIds.length; i++) {
            const key = this.getShapeKey(entity.physics.shapeIds[i])
            this.shapeMap.set(key, entity)
          }
          continue
        }
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

  private updateSensor(entity: Entity, entities: Entity[]): void {
    if (!entity.transform || !entity.sensor) return

    const { radius } = entity.sensor
    const { x, y } = entity.transform
    const radiusSq = radius * radius

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

    const forwardX = facingDir >= 0 ? 1 : -1
    const forwardY = 0
    const halfFovCos = Math.cos(entity.sensor.fov * 0.5)

    // Ray starts from eye position (offset from entity center)
    const entityRadius = entity.render?.radius || 0.5
    const eyeOffsetX = getCharacterEyeOffsetX(
      entity.render?.bodyProfile,
      entityRadius,
      facingDir
    )
    const eyeOffsetY = getCharacterEyeOffsetY(
      entity.render?.bodyProfile,
      entityRadius,
      entity.render?.bodyHeight ?? 0
    )
    const startX = x + eyeOffsetX
    const startY = y + eyeOffsetY

    // 预判：视野范围内非敌对但已锁定自己且处于战斗状态的单位，提前标记为临时敌人
    if (entity.faction) {
      for (const target of entities) {
        if (target.id === entity.id) continue
        if (!target.transform || !target.faction) continue
        if (target.stats?.isDead || target.stats?.isVanished) continue
        if (
          entity.faction.canAttackEntity(target.faction, target.id.toString())
        )
          continue
        if (!target.stats?.isInCombat) continue
        const targetingMe =
          target.sensor?.detectedTargetId === entity.id ||
          target.input?.lockedTargetId === entity.id
        if (!targetingMe) continue
        const pdx = target.transform.x - x
        const pdy = target.transform.y - y
        if (pdx * pdx + pdy * pdy > radiusSq) continue
        entity.faction.addTemporaryEnemy(target.id.toString())
      }
    }

    const scanResults = entity.sensor.scanResults
    let detectedHostileId: number | null = null
    let closestDistSq = Infinity
    let scanIndex = 0

    const { b2World_CastRayClosest } = this.box2d
    const startVec = this.rayStart
    const translationVec = this.rayTranslation
    const filter = this.rayFilter
    startVec.Set(startX, startY)

    // 只检测障碍物/地形阻挡，不依赖目标的物理分类
    // 射线未命中任何障碍物 = 视线畅通；命中障碍物 = 视线被阻断
    filter.maskBits = CATEGORY_OBSTACLE | CATEGORY_GROUND

    for (const target of entities) {
      if (target.id === entity.id) continue
      if (!target.transform) continue
      if (!entity.faction || !target.faction) continue
      if (!entity.faction.canAttackEntity(target.faction, target.id.toString()))
        continue
      if (target.stats?.isDead || target.stats?.isVanished) continue

      const centerDx = target.transform.x - startX
      const centerDy = target.transform.y - startY
      const centerDistSq = centerDx * centerDx + centerDy * centerDy
      if (centerDistSq > radiusSq) continue

      const targetRadius = target.render?.radius || 0.5
      for (let i = 0; i < VERTEX_OFFSETS.length; i += 2) {
        const vertexX = target.transform.x + VERTEX_OFFSETS[i] * targetRadius
        const vertexY =
          target.transform.y + VERTEX_OFFSETS[i + 1] * targetRadius
        const dx = vertexX - startX
        const dy = vertexY - startY
        const distSq = dx * dx + dy * dy
        if (distSq > radiusSq) continue
        if (distSq === 0) continue
        const dist = Math.sqrt(distSq)
        const dot = (dx * forwardX + dy * forwardY) / dist
        if (dot < halfFovCos) continue

        translationVec.Set(dx, dy)
        const output = b2World_CastRayClosest(
          this.worldId,
          startVec,
          translationVec,
          filter
        )

        // 没有命中障碍物 = 视线畅通 = 能看到目标
        const hasLineOfSight = !output.hit
        const isHostile = hasLineOfSight

        if (hasLineOfSight) {
          if (centerDistSq < closestDistSq) {
            closestDistSq = centerDistSq
            detectedHostileId = target.id
          }
        }

        if (scanIndex < scanResults.length) {
          const result = scanResults[scanIndex]
          result.start.x = startX
          result.start.y = startY
          result.end.x = startX + dx
          result.end.y = startY + dy
          result.hit = output.hit
          result.hitEntityId = hasLineOfSight ? target.id : undefined
          result.isHostile = isHostile
          if (output.hit) {
            const hitPoint = result.hitPoint
            if (hitPoint) {
              hitPoint.x = output.point.x
              hitPoint.y = output.point.y
            }
          }
        }
        scanIndex++
      }
    }

    const maxResults = scanResults.length
    for (let i = scanIndex; i < maxResults; i++) {
      const result = scanResults[i]
      result.start.x = startX
      result.start.y = startY
      result.end.x = startX
      result.end.y = startY
      result.hit = false
      result.hitEntityId = undefined
      result.isHostile = false
    }

    if (detectedHostileId !== null) {
      entity.sensor.detectedTargetId = detectedHostileId

      // Auto-combat state for player/enemies upon detection
      if (entity.stats && !entity.stats.isInCombat) {
        let shouldEnterCombat = true
        if (entity.enemyAI) {
          shouldEnterCombat =
            closestDistSq <=
            entity.enemyAI.detectionRange * entity.enemyAI.detectionRange
        }
        if (shouldEnterCombat) {
          entity.stats.isInCombat = true
          entity.stats.combatExitTimer = 0
        }
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
