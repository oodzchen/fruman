import {
  getCharacterEyeOffsetX,
  getCharacterEyeOffsetY,
} from '../../characterBodyProfile'
import { ENEMY_DETECTION_RANGE } from '../../constants'
import { getEnvironmentCollisionMask } from '../../physicsLayers'
import type { MainModule, b2BodyId, b2WorldId } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'

// 扇形射线数量，在 FOV 内均匀分布
const FAN_RAY_COUNT = 9
const PLAYER_LOCK_RANGE = ENEMY_DETECTION_RANGE * 2.0
const PLAYER_LOCK_RANGE_SQ = PLAYER_LOCK_RANGE * PLAYER_LOCK_RANGE

export class TargetingSystem extends System {
  private box2d: MainModule
  private worldId: b2WorldId
  private player?: Entity
  private spatialHash: SpatialHash | null = null
  private rayStart: InstanceType<MainModule['b2Vec2']>
  private rayTranslation: InstanceType<MainModule['b2Vec2']>
  private rayFilter: ReturnType<MainModule['b2DefaultQueryFilter']>
  private hostileBuffer: Entity[] = []
  private hostileDistSqBuffer: number[] = []
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
    const maxHostiles = 16
    this.hostileBuffer = new Array<Entity>(maxHostiles)
    this.hostileDistSqBuffer = new Array<number>(maxHostiles)
  }

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  setPlayer(player: Entity): void {
    this.player = player
  }

  setEntityLookup(lookup: (id: number) => Entity | undefined): void {
    this.entityLookup = lookup
  }

  update(entities: Entity[], deltaTime: number): void {
    const deltaMs = deltaTime > 0 ? deltaTime * 1000 : 0

    // 1. 更新所有带有传感器的实体
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

    // 2. 处理玩家锁定逻辑
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
      input.lockSwitchIntentX = 0
      input.lockSwitchIntentY = 0
      input.lockLostTimer = 0
      return
    }

    // Toggle Lock
    if (input.lockToggleRequested) {
      input.lockToggleRequested = false
      if (input.lockedTargetId !== null) {
        input.lockedTargetId = null
      } else {
        // 主动搜索可视范围内最近的可锁定目标，必须有视线
        const nearestTarget = this.findNearestVisibleTarget(
          player,
          entities,
          PLAYER_LOCK_RANGE
        )
        if (nearestTarget) {
          input.lockedTargetId = nearestTarget.id
          input.lockLostTimer = 0
        }
      }
    }

    if (
      (input.lockSwitchIntentX !== 0 || input.lockSwitchIntentY !== 0) &&
      input.lockedTargetId !== null
    ) {
      const currentTarget = this.getEntityById(input.lockedTargetId, entities)
      if (currentTarget && currentTarget.transform) {
        const bestId = this.findSwitchTarget(
          player,
          currentTarget,
          entities,
          input.lockSwitchIntentX,
          input.lockSwitchIntentY
        )
        if (bestId !== null) {
          input.lockedTargetId = bestId
          input.lockLostTimer = 0
        }
      }
      input.lockSwitchIntentX = 0
      input.lockSwitchIntentY = 0
    }

    // Validate Lock
    if (input.lockedTargetId !== null) {
      const target = this.getEntityById(input.lockedTargetId, entities)
      if (!target || !this.canPlayerLockTarget(player, target)) {
        input.lockedTargetId = null
        input.lockLostTimer = 0
      } else {
        // Distance check
        const dx = target.transform!.x - player.transform.x
        const dy = target.transform!.y - player.transform.y
        if (dx * dx + dy * dy > PLAYER_LOCK_RANGE_SQ) {
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

  private findSwitchTarget(
    player: Entity,
    currentTarget: Entity,
    entities: Entity[],
    directionX: number,
    directionY: number
  ): number | null {
    if (!player.transform || !currentTarget.transform) return null

    let bestId: number | null = null
    let bestDistSq = Infinity
    const candidates = this.getNearbyEntities(
      entities,
      currentTarget.transform.x,
      currentTarget.transform.y,
      PLAYER_LOCK_RANGE
    )
    const candidateCount = this.getNearbyEntityCount(entities)

    for (let i = 0; i < candidateCount; i++) {
      const entity = candidates[i]
      if (entity.id === player.id || entity.id === currentTarget.id) continue
      if (!this.canPlayerLockTarget(player, entity)) continue

      const playerDx = entity.transform.x - player.transform.x
      const playerDy = entity.transform.y - player.transform.y
      if (playerDx * playerDx + playerDy * playerDy > PLAYER_LOCK_RANGE_SQ) {
        continue
      }

      const targetDx = entity.transform.x - currentTarget.transform.x
      const targetDy = entity.transform.y - currentTarget.transform.y
      const targetDistSq = targetDx * targetDx + targetDy * targetDy
      if (targetDistSq > PLAYER_LOCK_RANGE_SQ || targetDistSq === 0) {
        continue
      }

      const forward = targetDx * directionX + targetDy * directionY
      if (forward <= 0) continue
      if (!this.hasLineOfSight(player, entity)) continue

      if (targetDistSq < bestDistSq) {
        bestDistSq = targetDistSq
        bestId = entity.id
      }
    }

    return bestId
  }

  private canPlayerLockTarget(
    player: Entity,
    target: Entity
  ): target is Entity & { transform: NonNullable<Entity['transform']> } {
    if (target.id === player.id || !target.transform) {
      return false
    }
    if (
      (target.render?.renderLayer ?? 0) !== (player.render?.renderLayer ?? 0)
    ) {
      return false
    }
    if (target.stats && (target.stats.isDead || target.stats.isVanished)) {
      return false
    }

    const grappleTarget = target.grappleTarget
    if (grappleTarget) {
      return (
        player.grapple?.hasGrapple === true &&
        grappleTarget.canPull &&
        this.getTargetBodyId(target) !== null
      )
    }

    return (
      target.faction !== undefined &&
      player.faction?.canAttackEntity(target.faction, target.id.toString()) ===
        true
    )
  }

  private getTargetBodyId(entity: Entity): b2BodyId | null {
    const bodyId = entity.physics?.bodyId ?? entity.grappleTarget?.bodyId
    if (!bodyId || !this.box2d.b2Body_IsValid(bodyId)) {
      return null
    }
    return bodyId
  }

  private areBodyIdsEqual(a: b2BodyId, b: b2BodyId): boolean {
    return (
      a.index1 === b.index1 &&
      a.world0 === b.world0 &&
      a.generation === b.generation
    )
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

    filter.categoryBits = 0xffffffff
    filter.maskBits = getEnvironmentCollisionMask(
      start.render?.renderLayer ?? 0
    )

    const output = b2World_CastRayClosest(
      this.worldId,
      startVec,
      translationVec,
      filter
    )
    if (!output.hit) {
      return true
    }

    const targetBodyId = this.getTargetBodyId(end)
    if (!targetBodyId) {
      return false
    }

    const hitBodyId = this.box2d.b2Shape_GetBody(output.shapeId)
    return this.areBodyIdsEqual(hitBodyId, targetBodyId)
  }

  private findNearestVisibleTarget(
    player: Entity,
    entities: Entity[],
    maxRange: number
  ): Entity | null {
    if (!player.transform || !player.faction) return null

    let nearestTarget: Entity | null = null
    let minDistSq = maxRange * maxRange
    const candidates = this.getNearbyEntities(
      entities,
      player.transform.x,
      player.transform.y,
      maxRange
    )
    const candidateCount = this.getNearbyEntityCount(entities)

    for (let i = 0; i < candidateCount; i++) {
      const entity = candidates[i]
      if (entity.id === player.id) continue
      if (!this.canPlayerLockTarget(player, entity)) continue

      const dx = entity.transform.x - player.transform.x
      const dy = entity.transform.y - player.transform.y
      const distSq = dx * dx + dy * dy

      if (distSq >= minDistSq) continue

      // 必须有视线才能锁定
      if (!this.hasLineOfSight(player, entity)) continue

      minDistSq = distSq
      nearestTarget = entity
    }

    return nearestTarget
  }

  private updateSensor(entity: Entity, entities: Entity[]): void {
    if (!entity.transform || !entity.sensor) return

    const { radius } = entity.sensor
    const { x, y } = entity.transform
    const radiusSq = radius * radius
    const nearbyEntities = this.getNearbyEntities(entities, x, y, radius)
    const nearbyCount = this.getNearbyEntityCount(entities)

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
      for (let i = 0; i < nearbyCount; i++) {
        const target = nearbyEntities[i]
        if (target.id === entity.id) continue
        if (!target.transform || !target.faction) continue
        if (
          (target.render?.renderLayer ?? 0) !==
          (entity.render?.renderLayer ?? 0)
        )
          continue
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

    const { b2World_CastRayClosest } = this.box2d
    const startVec = this.rayStart
    const translationVec = this.rayTranslation
    const filter = this.rayFilter
    startVec.Set(startX, startY)

    // categoryBits 必须显式设为 0xFFFFFFFF，否则 Box2D 默认值 1 会导致
    // 地形的 maskBits (不含 ground bit) 与射线 categoryBits 按位与为 0，射线穿透所有地形
    filter.categoryBits = 0xffffffff
    filter.maskBits = getEnvironmentCollisionMask(
      entity.render?.renderLayer ?? 0
    )

    // 收集 FOV 内的敌对目标及其到眼睛的距离平方
    const entityLayer = entity.render?.renderLayer ?? 0
    let hostileCount = 0
    for (let i = 0; i < nearbyCount; i++) {
      const target = nearbyEntities[i]
      if (target.id === entity.id) continue
      if (!target.transform) continue
      if ((target.render?.renderLayer ?? 0) !== entityLayer) continue
      if (!entity.faction || !target.faction) continue
      if (!entity.faction.canAttackEntity(target.faction, target.id.toString()))
        continue
      if (target.stats?.isDead || target.stats?.isVanished) continue
      const cdx = target.transform.x - startX
      const cdy = target.transform.y - startY
      const cdSq = cdx * cdx + cdy * cdy
      if (cdSq > radiusSq || cdSq === 0) continue
      const cdist = Math.sqrt(cdSq)
      const dot = (cdx * forwardX + cdy * forwardY) / cdist
      if (dot < halfFovCos) continue
      this.hostileBuffer[hostileCount] = target
      this.hostileDistSqBuffer[hostileCount] = cdSq
      hostileCount++
      if (hostileCount >= this.hostileBuffer.length) break
    }

    // 扇形射线扫描：在 FOV 内均匀分布射线
    const baseAngle = forwardX >= 0 ? 0 : Math.PI
    const halfFov = entity.sensor.fov * 0.5
    const rayCount = Math.min(FAN_RAY_COUNT, scanResults.length)
    const angleStep = rayCount > 1 ? entity.sensor.fov / (rayCount - 1) : 0

    for (let r = 0; r < rayCount; r++) {
      const rayAngle = baseAngle - halfFov + angleStep * r
      const dx = Math.cos(rayAngle) * radius
      const dy = Math.sin(rayAngle) * radius

      translationVec.Set(dx, dy)
      const output = b2World_CastRayClosest(
        this.worldId,
        startVec,
        translationVec,
        filter
      )

      // 射线的最远可达距离（fraction=1 表示全程无阻挡）
      const rayReachSq = output.hit
        ? (output.point.x - startX) * (output.point.x - startX) +
          (output.point.y - startY) * (output.point.y - startY)
        : radiusSq

      // 检查此射线方向上是否能看到某个敌对目标
      let hitHostileId: number | undefined
      let isHostile = false
      for (let h = 0; h < hostileCount; h++) {
        const target = this.hostileBuffer[h]
        const targetDistSq = this.hostileDistSqBuffer[h]
        // 目标比障碍物远则被遮挡
        if (targetDistSq > rayReachSq) continue
        const targetRadius = target.render?.radius || 0.5
        // 判断目标是否在此射线方向附近（角度容差 = atan(targetRadius / distance)）
        const tdx = target.transform!.x - startX
        const tdy = target.transform!.y - startY
        const rayDirX = Math.cos(rayAngle)
        const rayDirY = Math.sin(rayAngle)
        const crossAbs = Math.abs(tdx * rayDirY - tdy * rayDirX)
        if (crossAbs > targetRadius) continue
        isHostile = true
        hitHostileId = target.id
        if (targetDistSq < closestDistSq) {
          closestDistSq = targetDistSq
          detectedHostileId = target.id
        }
        break
      }

      if (r < scanResults.length) {
        const result = scanResults[r]
        result.start.x = startX
        result.start.y = startY
        result.end.x = startX + dx
        result.end.y = startY + dy
        result.hit = output.hit
        result.hitEntityId = hitHostileId
        result.isHostile = isHostile
        if (output.hit) {
          const hitPoint = result.hitPoint
          if (hitPoint) {
            hitPoint.x = output.point.x
            hitPoint.y = output.point.y
          }
        }
      }
    }

    // 清除多余的 scanResult 槽位
    const maxResults = scanResults.length
    for (let i = rayCount; i < maxResults; i++) {
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

      if (entity.stats && !entity.stats.isInCombat) {
        let shouldEnterCombat = true
        if (entity.npcAI) {
          shouldEnterCombat =
            closestDistSq <=
            entity.npcAI.detectionRange * entity.npcAI.detectionRange
        }
        if (shouldEnterCombat) {
          entity.stats.isInCombat = true
          entity.stats.combatExitTimer = 0
        }
      }
    } else {
      entity.sensor.detectedTargetId = null
    }
  }

  private processScanResults(_entity: Entity): void {
    // Logic moved to updateSensor to avoid double loops
  }

  private getNearbyEntities(
    entities: Entity[],
    x: number,
    y: number,
    radius: number
  ): Entity[] {
    if (!this.spatialHash) {
      return entities
    }
    return this.spatialHash.query(x, y, radius)
  }

  private getNearbyEntityCount(entities: Entity[]): number {
    if (!this.spatialHash) {
      return entities.length
    }
    return this.spatialHash.getQueryResultLength()
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
