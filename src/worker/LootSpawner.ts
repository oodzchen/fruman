import { ArrowPools } from '../ecs/ArrowPools'
import type { ImpactLevel } from '../ecs/AttackMoveData'
import type { Entity } from '../ecs/Entity'
import type { SpatialHash } from '../ecs/SpatialHash'
import type { World } from '../ecs/World'
import { createWeapon } from '../ecs/factories/PlayerFactory'
import type { WeaponSystem } from '../ecs/systems/WeaponSystem'
import { isWeaponDropItemType } from '../npcDropUtils'
import {
  getObstacleCollisionCategory,
  getObstacleCollisionMask,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../physicsLayers'
import {
  getTerrainMaterialByCode,
  getTerrainMaterialById,
} from '../terrain/TerrainMaterialRegistry'
import type { TerrainImpactResult } from '../terrain/TerrainRuntimeState'
import type { MainModule, b2BodyId } from '../types'

type WorldId = ReturnType<MainModule['b2CreateWorld']>

type SunPickupFactory = (
  x: number,
  y: number,
  isLarge: boolean,
  renderLayer: number,
  velocityX?: number,
  velocityY?: number,
  mapSpawnIndex?: number
) => Entity | null

type ExpOrbFactory = (
  x: number,
  y: number,
  renderLayer: number,
  velocityX?: number,
  velocityY?: number
) => Entity | null

type BodyVelocityWriter = (
  bodyId: b2BodyId,
  velocityX: number,
  velocityY: number
) => void

export interface CratePlankDebrisSource {
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  rotationRad: number
  debrisVariant: number
}

export interface CrateDebrisSource {
  seed: number
  planks: readonly CratePlankDebrisSource[]
}

const MAX_TERRAIN_DEBRIS_PER_IMPACT = 10
const MAX_TERRAIN_DEBRIS_ACTIVE = 96
const TERRAIN_DEBRIS_LIFETIME_MS = 1100
const TERRAIN_DEBRIS_FADE_START_MS = 700
const CRATE_RETAINED_DEBRIS_MIN_COUNT = 2
const CRATE_RETAINED_DEBRIS_MAX_COUNT = 3
const CRATE_RETAINED_DEBRIS_LIFETIME_MS = 180000
const CRATE_RETAINED_DEBRIS_FADE_DURATION_MS = 1200
const CRATE_RETAINED_DEBRIS_LINEAR_DAMPING = 0.06
const CRATE_RETAINED_DEBRIS_ANGULAR_DAMPING = 0.14
const CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 = 2600
const CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 = 2600
const TERRAIN_DEBRIS_MIN_SIZE1000 = 140
const TERRAIN_DEBRIS_SIZE_RANGE1000 = 160
const TERRAIN_DEBRIS_BASE_SPEED1000 = 3400
const TERRAIN_DEBRIS_SPEED_RANGE1000 = 2200
const TERRAIN_DEBRIS_UPWARD_SPEED1000 = 3600
const TERRAIN_DEBRIS_UPWARD_RANGE1000 = 1600
const TERRAIN_DEBRIS_ANGULAR_BASE1000 = 5000
const TERRAIN_DEBRIS_ANGULAR_RANGE1000 = 4500
const TERRAIN_DEBRIS_OUTER_OFFSET_MIN1000 = 260
const TERRAIN_DEBRIS_OUTER_OFFSET_MAX1000 = 900
const TERRAIN_DEBRIS_OUTER_SPEED_BONUS1000 = 2600
const TERRAIN_DEBRIS_OUTER_UPWARD_BONUS1000 = 1400
const TERRAIN_DEBRIS_SPAWN_LIFT1000 = 120
const WOOD_MATERIAL = getTerrainMaterialById('wood')

export class LootSpawner {
  private world: World | null = null
  private box2d: MainModule | null = null
  private worldId: WorldId | null = null
  private groundTopY = 0
  private weaponSystem: WeaponSystem | null = null
  private arrowPools: ArrowPools | null = null
  private spatialHash: SpatialHash | null = null
  private fixedStepMs = 16
  private createSunPickupEntity: SunPickupFactory | null = null
  private createExpOrbEntity: ExpOrbFactory | null = null
  private setBodyLinearVelocity: BodyVelocityWriter | null = null

  setRuntime(
    world: World,
    box2d: MainModule,
    worldId: WorldId,
    groundTopY: number,
    weaponSystem: WeaponSystem,
    arrowPools: ArrowPools,
    spatialHash: SpatialHash,
    fixedStepMs: number
  ): void {
    this.world = world
    this.box2d = box2d
    this.worldId = worldId
    this.groundTopY = groundTopY
    this.weaponSystem = weaponSystem
    this.arrowPools = arrowPools
    this.spatialHash = spatialHash
    this.fixedStepMs = fixedStepMs
  }

  setFactories(
    createSunPickupEntity: SunPickupFactory,
    createExpOrbEntity: ExpOrbFactory,
    setBodyLinearVelocity: BodyVelocityWriter
  ): void {
    this.createSunPickupEntity = createSunPickupEntity
    this.createExpOrbEntity = createExpOrbEntity
    this.setBodyLinearVelocity = setBodyLinearVelocity
  }

  dropNpcConfiguredLoot(entity: Entity): void {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.weaponSystem ||
      !this.createSunPickupEntity ||
      !this.createExpOrbEntity ||
      !this.setBodyLinearVelocity ||
      !entity.transform ||
      !entity.npcDropTable ||
      entity.npcDropTable.items.length === 0
    ) {
      return
    }

    const drops = entity.npcDropTable.items
    const renderLayer = entity.render?.renderLayer ?? 0
    let spawnCount = 0

    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i]
      if (!rollDropChance(drop.chance)) {
        continue
      }
      const dropCount = drop.count > 0 ? drop.count : 1
      for (let j = 0; j < dropCount; j++) {
        const offsetX = getNpcDropOffsetX(spawnCount)
        const velocityX = getNpcDropVelocityX(spawnCount)
        const velocityY = getNpcDropVelocityY(spawnCount)
        const spawnX = entity.transform.x + offsetX
        const spawnY = entity.transform.y

        if (isWeaponDropItemType(drop.itemType)) {
          const weaponEntity = createWeapon(
            this.world,
            this.box2d,
            this.worldId,
            spawnX,
            spawnY,
            this.groundTopY,
            drop.itemType,
            renderLayer
          )
          if (weaponEntity.physics) {
            this.setBodyLinearVelocity(
              weaponEntity.physics.bodyId,
              velocityX,
              velocityY
            )
          }
          this.weaponSystem.setGroundWeaponPickupCooldown(weaponEntity, 500)
        } else if (drop.itemType === 'expOrb') {
          this.createExpOrbEntity(
            spawnX,
            spawnY,
            renderLayer,
            velocityX,
            velocityY
          )
        } else {
          this.createSunPickupEntity(
            spawnX,
            spawnY,
            drop.itemType === 'sunPickupLarge',
            renderLayer,
            velocityX,
            velocityY
          )
        }

        spawnCount += 1
      }
    }
  }

  getRemainingTerrainDebrisBudget(): number {
    const remaining =
      MAX_TERRAIN_DEBRIS_ACTIVE - this.countActiveTerrainDebris()
    return remaining > 0 ? remaining : 0
  }

  countActiveTerrainDebris(): number {
    if (!this.world) {
      return 0
    }
    const entities = this.world.getEntities()
    let count = 0
    for (let i = 0; i < entities.length; i++) {
      if (
        entities[i].terrainDebris &&
        (entities[i].terrainDebris?.lifeMs ?? 0) > 0
      ) {
        count += 1
      }
    }
    return count
  }

  countSelectedCratePlanks(mask: number): number {
    let count = 0
    let bits = mask >>> 0
    while (bits !== 0) {
      count += bits & 1
      bits >>>= 1
    }
    return count
  }

  selectRetainedCratePlankMask(
    crate: CrateDebrisSource,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    maxSelectableCount: number
  ): number {
    const plankCount = crate.planks.length
    if (plankCount <= 0 || maxSelectableCount <= 0) {
      return 0
    }
    const impactX1000 = Math.round(impactX * 1000)
    const impactY1000 = Math.round(impactY * 1000)
    const seed = hashTerrainDebrisSeed(crate.seed, impactX1000, impactY1000)
    const desiredCount = Math.min(
      plankCount,
      maxSelectableCount,
      impactLevel === 'extreme'
        ? CRATE_RETAINED_DEBRIS_MAX_COUNT
        : CRATE_RETAINED_DEBRIS_MIN_COUNT +
            (((seed >>> 30) & 1) % (CRATE_RETAINED_DEBRIS_MAX_COUNT - 1))
    )
    if (desiredCount <= 0) {
      return 0
    }

    let firstIndex = -1
    let secondIndex = -1
    let thirdIndex = -1
    let firstScore = -1
    let secondScore = -1
    let thirdScore = -1

    for (let i = 0; i < plankCount; i++) {
      const plank = crate.planks[i]
      const sizeKey =
        (Math.round(plank.halfWidth * 1000) << 12) ^
        Math.round(plank.halfHeight * 1000) ^
        (plank.debrisVariant << 24)
      const score =
        hashTerrainDebrisSeed(
          seed ^ Math.imul(i + 1, 131),
          sizeKey,
          crate.seed
        ) >>> 0

      if (score > firstScore) {
        thirdScore = secondScore
        thirdIndex = secondIndex
        secondScore = firstScore
        secondIndex = firstIndex
        firstScore = score
        firstIndex = i
        continue
      }
      if (score > secondScore) {
        thirdScore = secondScore
        thirdIndex = secondIndex
        secondScore = score
        secondIndex = i
        continue
      }
      if (score > thirdScore) {
        thirdScore = score
        thirdIndex = i
      }
    }

    let mask = 0
    if (firstIndex >= 0) {
      mask |= 1 << firstIndex
    }
    if (desiredCount >= 2 && secondIndex >= 0) {
      mask |= 1 << secondIndex
    }
    if (desiredCount >= 3 && thirdIndex >= 0) {
      mask |= 1 << thirdIndex
    }
    return mask
  }

  spawnTerrainDebrisFromImpact(
    result: TerrainImpactResult,
    request: {
      worldX: number
      worldY: number
      radius: number
      impactPower: number
      renderLayer: number
    }
  ): void {
    const destroyedCells1000 = result.destroyedCells1000
    const destroyedCount = Math.floor(destroyedCells1000.length / 3)
    if (destroyedCount <= 0) {
      return
    }

    const remainingBudget = this.getRemainingTerrainDebrisBudget()
    if (remainingBudget <= 0) {
      return
    }

    const spawnCount = Math.min(
      MAX_TERRAIN_DEBRIS_PER_IMPACT,
      remainingBudget,
      destroyedCount
    )
    if (spawnCount <= 0) {
      return
    }

    const step1000 = Math.max(
      1000,
      Math.floor((destroyedCount * 1000) / spawnCount)
    )
    const impactX1000 = Math.round(request.worldX * 1000)
    const impactY1000 = Math.round(request.worldY * 1000)
    const radius1000 = Math.max(1, Math.round(request.radius * 1000))
    const terrainRadius1000 = Math.max(1, Math.floor((radius1000 * 3) / 4))

    for (let i = 0; i < spawnCount; i++) {
      const sampleIndex = Math.min(
        destroyedCount - 1,
        Math.floor(((i * 2 + 1) * step1000) / 2000)
      )
      const sampleOffset = sampleIndex * 3
      this.spawnTerrainDebrisEntity(
        destroyedCells1000[sampleOffset] | 0,
        destroyedCells1000[sampleOffset + 1] | 0,
        destroyedCells1000[sampleOffset + 2] | 0,
        impactX1000,
        impactY1000,
        terrainRadius1000,
        request.renderLayer,
        i
      )
    }
  }

  updateTerrainDebrisEntities(entities: Entity[]): void {
    if (!this.box2d || !this.world || !this.spatialHash || !this.arrowPools) {
      return
    }
    const { b2Body_GetRotation, b2Rot_GetAngle, b2DestroyBody } = this.box2d

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      const debris = entity.terrainDebris
      const physics = entity.physics
      const transform = entity.transform
      if (!debris || !physics || !transform) {
        continue
      }
      if (debris.lifeMs <= 0) {
        continue
      }

      debris.elapsedMs += this.fixedStepMs
      const rotation = b2Body_GetRotation(physics.bodyId)
      transform.rotation = b2Rot_GetAngle(rotation)
      rotation.delete()

      if (debris.elapsedMs < debris.lifeMs) {
        continue
      }

      debris.lifeMs = 0
      if (entity.render) {
        entity.render.visible = false
      }
      this.spatialHash.removeEntity(entity)
      b2DestroyBody(physics.bodyId)
      this.arrowPools.releasePhysics(physics)
      entity.removeComponent('Physics')
      this.world.destroyEntity(entity)
    }
  }

  spawnCratePlankDebrisEntity(
    plank: CratePlankDebrisSource,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    renderLayer: number,
    seedBase: number,
    plankIndex: number
  ): void {
    const runtime = this.readDebrisRuntime()
    if (!runtime) {
      return
    }
    const seed = hashTerrainDebrisSeed(
      Math.round(plank.centerX * 1000),
      Math.round(plank.centerY * 1000),
      (seedBase + plankIndex * 17) | 0
    )
    const dx1000 = Math.round((plank.centerX - impactX) * 1000)
    const dy1000 = Math.round((plank.centerY - impactY) * 1000)
    const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
    const dirX1000 =
      distanceBase1000 > 0
        ? Math.floor((dx1000 * 1000) / distanceBase1000)
        : (seed & 1) === 0
          ? 1000
          : -1000
    const dirY1000 =
      distanceBase1000 > 0
        ? Math.floor((dy1000 * 1000) / distanceBase1000)
        : -1000
    const sideX1000 = -dirY1000
    const sideY1000 = dirX1000
    const sideSpeed1000 = getCrateDebrisVisualSideSpeed1000(impactLevel, seed)
    const outwardSpeed1000 = getCrateDebrisVisualOutwardSpeed1000(
      impactLevel,
      seed
    )
    const upwardSpeed1000 = getCrateDebrisVisualUpwardSpeed1000(
      impactLevel,
      seed
    )
    const spawnY = plank.centerY - 0.05
    const velocityX =
      (dirX1000 * outwardSpeed1000 + sideX1000 * sideSpeed1000) / 1000000
    const velocityY =
      (-(upwardSpeed1000 * 1000) +
        dirY1000 * outwardSpeed1000 +
        Math.floor((sideY1000 * sideSpeed1000) / 2)) /
      1000000
    const angularVelocity =
      ((seed >>> 2) & 1) === 0
        ? 4 + ((seed >>> 7) % 5)
        : -(4 + ((seed >>> 7) % 5))

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2DefaultShapeDef,
      b2MakeBox,
      b2CreatePolygonShape,
      b2Body_SetAngularVelocity,
    } = runtime.box2d

    const entity = runtime.world.createEntity()
    const transform = runtime.arrowPools.acquireTransform()
    transform.x = plank.centerX
    transform.y = spawnY
    transform.rotation = plank.rotationRad
    entity.addComponent(transform)

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(plank.centerX, spawnY)
    bodyDef.rotation.SetAngle(plank.rotationRad)
    bodyDef.linearDamping = 0.09
    bodyDef.angularDamping = 0.21
    const bodyId = b2CreateBody(runtime.worldId, bodyDef)

    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.16
    shapeDef.material.friction = 0.09
    shapeDef.material.restitution = 0.14
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

    const box = b2MakeBox(plank.halfWidth, plank.halfHeight)
    b2CreatePolygonShape(bodyId, shapeDef, box)
    runtime.setBodyLinearVelocity(bodyId, velocityX, velocityY)
    b2Body_SetAngularVelocity(bodyId, angularVelocity)
    bodyDef.delete()
    shapeDef.delete()
    box.delete()

    const physics = runtime.arrowPools.acquirePhysics()
    physics.bodyId = bodyId
    entity.addComponent(physics)

    const render = runtime.arrowPools.acquireRender()
    render.visible = true
    render.renderLayer = renderLayer
    render.radius = Math.max(plank.halfWidth, plank.halfHeight)
    render.color =
      WOOD_MATERIAL.fillPalette[(seed >>> 3) % WOOD_MATERIAL.fillPalette.length]
    render.borderColor = WOOD_MATERIAL.strokeColor
    entity.addComponent(render)

    const debris = runtime.arrowPools.acquireTerrainDebris()
    debris.width = plank.halfWidth * 2
    debris.height = plank.halfHeight * 2
    debris.variant = plank.debrisVariant
    debris.lifeMs = TERRAIN_DEBRIS_LIFETIME_MS
    debris.elapsedMs = 0
    debris.fadeStartMs = TERRAIN_DEBRIS_FADE_START_MS
    debris.receivesWeaponImpulse = false
    entity.addComponent(debris)
  }

  retainCratePlankDebrisEntity(
    plank: CratePlankDebrisSource,
    impactX: number,
    impactY: number,
    impactLevel: ImpactLevel,
    renderLayer: number,
    seedBase: number,
    plankIndex: number
  ): boolean {
    const runtime = this.readDebrisRuntime()
    if (!runtime) {
      return false
    }

    const seed = hashTerrainDebrisSeed(
      Math.round(plank.centerX * 1000),
      Math.round(plank.centerY * 1000),
      (seedBase + plankIndex * 29) | 0
    )
    const dx1000 = Math.round((plank.centerX - impactX) * 1000)
    const dy1000 = Math.round((plank.centerY - impactY) * 1000)
    const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
    const dirX1000 =
      distanceBase1000 > 0
        ? Math.floor((dx1000 * 1000) / distanceBase1000)
        : (seed & 1) === 0
          ? 1000
          : -1000
    const dirY1000 =
      distanceBase1000 > 0
        ? Math.floor((dy1000 * 1000) / distanceBase1000)
        : -1000
    const sideX1000 = -dirY1000
    const sideY1000 = dirX1000
    const sideSpeed1000 = getCrateDebrisRetainedSideSpeed1000(impactLevel, seed)
    const outwardSpeed1000 = getCrateDebrisRetainedOutwardSpeed1000(
      impactLevel,
      seed
    )
    const upwardSpeed1000 = getCrateDebrisRetainedUpwardSpeed1000(
      impactLevel,
      seed
    )
    const angularVelocity1000 = getCrateDebrisRetainedAngularVelocity1000(
      impactLevel,
      seed
    )
    const collisionCategoryBits =
      getObstacleCollisionCategory(renderLayer) |
      getWeaponCollisionCategory(renderLayer)
    const collisionMaskBits =
      getObstacleCollisionMask(renderLayer) |
      getWeaponCollisionMask(renderLayer)
    const fadeStartMs = Math.max(
      0,
      CRATE_RETAINED_DEBRIS_LIFETIME_MS - CRATE_RETAINED_DEBRIS_FADE_DURATION_MS
    )
    const woodPalette = WOOD_MATERIAL.fillPalette

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2DefaultShapeDef,
      b2MakeBox,
      b2CreatePolygonShape,
      b2Body_SetAngularVelocity,
      b2Body_SetAwake,
    } = runtime.box2d

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(plank.centerX, plank.centerY)
    bodyDef.rotation.SetAngle(plank.rotationRad)
    bodyDef.linearDamping = CRATE_RETAINED_DEBRIS_LINEAR_DAMPING
    bodyDef.angularDamping = CRATE_RETAINED_DEBRIS_ANGULAR_DAMPING
    const bodyId = b2CreateBody(runtime.worldId, bodyDef)

    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.11
    shapeDef.material.friction = 0.05
    shapeDef.material.restitution = 0.16
    shapeDef.filter.categoryBits = collisionCategoryBits
    shapeDef.filter.maskBits = collisionMaskBits
    const box = b2MakeBox(plank.halfWidth, plank.halfHeight)
    const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)

    runtime.setBodyLinearVelocity(
      bodyId,
      (dirX1000 * outwardSpeed1000 + sideX1000 * sideSpeed1000) / 1000000,
      (-(upwardSpeed1000 * 1000) +
        dirY1000 * outwardSpeed1000 +
        Math.floor((sideY1000 * sideSpeed1000) / 2)) /
        1000000
    )
    b2Body_SetAngularVelocity(bodyId, angularVelocity1000 / 1000)
    b2Body_SetAwake(bodyId, true)
    bodyDef.delete()
    shapeDef.delete()
    box.delete()

    const entity = runtime.world.createEntity()
    const transform = runtime.arrowPools.acquireTransform()
    transform.x = plank.centerX
    transform.y = plank.centerY
    transform.rotation = plank.rotationRad
    entity.addComponent(transform)

    const physics = runtime.arrowPools.acquirePhysics()
    physics.bodyId = bodyId
    physics.shapeId = shapeId
    entity.addComponent(physics)

    const render = runtime.arrowPools.acquireRender()
    render.visible = true
    render.renderLayer = renderLayer
    render.radius = Math.max(plank.halfWidth, plank.halfHeight)
    render.color = woodPalette[(seed >>> 3) % woodPalette.length]
    render.borderColor = WOOD_MATERIAL.strokeColor
    entity.addComponent(render)

    const debris = runtime.arrowPools.acquireTerrainDebris()
    debris.width = plank.halfWidth * 2
    debris.height = plank.halfHeight * 2
    debris.variant = plank.debrisVariant
    debris.lifeMs = CRATE_RETAINED_DEBRIS_LIFETIME_MS
    debris.elapsedMs = 0
    debris.fadeStartMs = fadeStartMs
    debris.receivesWeaponImpulse = true
    entity.addComponent(debris)
    return true
  }

  private spawnTerrainDebrisEntity(
    worldX1000: number,
    worldY1000: number,
    materialCode: number,
    impactX1000: number,
    impactY1000: number,
    terrainRadius1000: number,
    renderLayer: number,
    sampleIndex: number
  ): void {
    const runtime = this.readDebrisRuntime()
    if (!runtime) {
      return
    }
    const material = getTerrainMaterialByCode(materialCode)
    if (!material) {
      return
    }

    const seed = hashTerrainDebrisSeed(worldX1000, worldY1000, sampleIndex)
    const width1000 =
      TERRAIN_DEBRIS_MIN_SIZE1000 + (seed % (TERRAIN_DEBRIS_SIZE_RANGE1000 + 1))
    const height1000 =
      TERRAIN_DEBRIS_MIN_SIZE1000 +
      ((seed >>> 8) % (TERRAIN_DEBRIS_SIZE_RANGE1000 + 1))
    const rotationMilliRad = (seed >>> 16) % 6283 | 0
    const rotationRad = rotationMilliRad / 1000
    const dx1000 = worldX1000 - impactX1000
    const dy1000 = worldY1000 - impactY1000
    const distanceBase1000 = Math.abs(dx1000) + Math.abs(dy1000)
    const dirX1000 =
      distanceBase1000 > 0
        ? Math.floor((dx1000 * 1000) / distanceBase1000)
        : (seed & 1) === 0
          ? 1000
          : -1000
    const dirY1000 =
      distanceBase1000 > 0
        ? Math.floor((dy1000 * 1000) / distanceBase1000)
        : -1000
    const outerLaunch = (sampleIndex & 1) === 0
    const sideX1000 = -dirY1000
    const sideY1000 = dirX1000
    const sideSpeed1000 = (((seed >>> 3) % 1601) - 800) | 0
    const outwardSpeed1000 =
      TERRAIN_DEBRIS_BASE_SPEED1000 +
      ((seed >>> 11) % (TERRAIN_DEBRIS_SPEED_RANGE1000 + 1))
    const upwardSpeed1000 =
      TERRAIN_DEBRIS_UPWARD_SPEED1000 +
      ((seed >>> 21) % (TERRAIN_DEBRIS_UPWARD_RANGE1000 + 1))
    const outerOffset1000 = outerLaunch
      ? Math.min(
          TERRAIN_DEBRIS_OUTER_OFFSET_MAX1000,
          Math.max(
            TERRAIN_DEBRIS_OUTER_OFFSET_MIN1000,
            Math.floor(terrainRadius1000 / 3)
          )
        )
      : 0
    const outerSpeedBonus1000 = outerLaunch
      ? TERRAIN_DEBRIS_OUTER_SPEED_BONUS1000
      : 0
    const upwardBonus1000 = outerLaunch
      ? TERRAIN_DEBRIS_OUTER_UPWARD_BONUS1000
      : 0
    const spawnX1000 =
      worldX1000 +
      Math.floor((dirX1000 * outerOffset1000) / 1000) +
      Math.floor((sideX1000 * sideSpeed1000) / 4000)
    const spawnY1000 =
      worldY1000 -
      TERRAIN_DEBRIS_SPAWN_LIFT1000 -
      Math.floor((Math.max(0, dirY1000) * outerOffset1000) / 2000)
    const velocityX1000 =
      Math.floor((dirX1000 * (outwardSpeed1000 + outerSpeedBonus1000)) / 1000) +
      Math.floor((sideX1000 * sideSpeed1000) / 1000)
    const velocityY1000 =
      -(upwardSpeed1000 + upwardBonus1000) +
      Math.floor((dirY1000 * outwardSpeed1000) / 1600) +
      Math.floor((sideY1000 * sideSpeed1000) / 2000)
    const angularVelocity1000 =
      ((seed >>> 1) & 1) === 0
        ? TERRAIN_DEBRIS_ANGULAR_BASE1000 +
          ((seed >>> 5) % (TERRAIN_DEBRIS_ANGULAR_RANGE1000 + 1))
        : -(
            TERRAIN_DEBRIS_ANGULAR_BASE1000 +
            ((seed >>> 5) % (TERRAIN_DEBRIS_ANGULAR_RANGE1000 + 1))
          )
    const worldX = spawnX1000 / 1000
    const worldY = spawnY1000 / 1000

    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2BodyType,
      b2DefaultShapeDef,
      b2MakeBox,
      b2CreatePolygonShape,
      b2Body_SetAngularVelocity,
    } = runtime.box2d

    const entity = runtime.world.createEntity()
    const transform = runtime.arrowPools.acquireTransform()
    transform.x = worldX
    transform.y = worldY
    transform.rotation = rotationRad
    entity.addComponent(transform)

    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(worldX, worldY)
    bodyDef.rotation.SetAngle(rotationRad)
    bodyDef.linearDamping = 1.25
    bodyDef.angularDamping = 2.2
    const bodyId = b2CreateBody(runtime.worldId, bodyDef)

    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = 0.65
    shapeDef.material.friction = 0.55
    shapeDef.material.restitution = 0.08
    shapeDef.filter.categoryBits = getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits = getWeaponCollisionMask(renderLayer)

    const box = b2MakeBox(width1000 / 2000, height1000 / 2000)
    b2CreatePolygonShape(bodyId, shapeDef, box)
    runtime.setBodyLinearVelocity(
      bodyId,
      velocityX1000 / 1000,
      velocityY1000 / 1000
    )
    b2Body_SetAngularVelocity(bodyId, angularVelocity1000 / 1000)
    bodyDef.delete()
    shapeDef.delete()
    box.delete()

    const physics = runtime.arrowPools.acquirePhysics()
    physics.bodyId = bodyId
    entity.addComponent(physics)

    const render = runtime.arrowPools.acquireRender()
    render.visible = true
    render.renderLayer = renderLayer
    render.radius = Math.max(width1000, height1000) / 2000
    render.color = material.fillPalette[seed % material.fillPalette.length]
    render.borderColor = material.strokeColor
    entity.addComponent(render)

    const debris = runtime.arrowPools.acquireTerrainDebris()
    debris.width = width1000 / 1000
    debris.height = height1000 / 1000
    debris.variant = (seed >>> 27) & 3
    debris.lifeMs = TERRAIN_DEBRIS_LIFETIME_MS
    debris.elapsedMs = 0
    debris.fadeStartMs = TERRAIN_DEBRIS_FADE_START_MS
    debris.receivesWeaponImpulse = false
    entity.addComponent(debris)
  }

  private readDebrisRuntime(): {
    world: World
    box2d: MainModule
    worldId: WorldId
    arrowPools: ArrowPools
    setBodyLinearVelocity: BodyVelocityWriter
  } | null {
    if (
      !this.world ||
      !this.box2d ||
      !this.worldId ||
      !this.arrowPools ||
      !this.setBodyLinearVelocity
    ) {
      return null
    }
    return {
      world: this.world,
      box2d: this.box2d,
      worldId: this.worldId,
      arrowPools: this.arrowPools,
      setBodyLinearVelocity: this.setBodyLinearVelocity,
    }
  }
}

function hashTerrainDebrisSeed(a: number, b: number, c: number): number {
  let hash =
    Math.imul(a | 0, 73856093) ^
    Math.imul(b | 0, 19349663) ^
    Math.imul(c | 0, 83492791)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}

function getCrateDebrisVisualOutwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4600 + ((seed >>> 11) % 2601)
  }
  if (impactLevel === 'large') {
    return 1800 + ((seed >>> 11) % 1601)
  }
  return 700 + ((seed >>> 11) % 701)
}

function getCrateDebrisVisualUpwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4200 + ((seed >>> 19) % 2601)
  }
  if (impactLevel === 'large') {
    return 1800 + ((seed >>> 19) % 1401)
  }
  return 900 + ((seed >>> 19) % 701)
}

function getCrateDebrisVisualSideSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return (((seed >>> 5) % 4201) - 2100) | 0
  }
  if (impactLevel === 'large') {
    return (((seed >>> 5) % 2201) - 1100) | 0
  }
  return (((seed >>> 5) % 801) - 400) | 0
}

function getCrateDebrisRetainedOutwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 4200 + ((seed >>> 12) % 2601)
  }
  if (impactLevel === 'large') {
    return 2200 + ((seed >>> 12) % 1801)
  }
  return 450 + ((seed >>> 12) % 551)
}

function getCrateDebrisRetainedUpwardSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return 5200 + ((seed >>> 20) % 2801)
  }
  if (impactLevel === 'large') {
    return 2800 + ((seed >>> 20) % 1801)
  }
  return 500 + ((seed >>> 20) % 701)
}

function getCrateDebrisRetainedSideSpeed1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return (((seed >>> 6) % 4801) - 2400) | 0
  }
  if (impactLevel === 'large') {
    return (((seed >>> 6) % 2601) - 1300) | 0
  }
  return (((seed >>> 6) % 901) - 450) | 0
}

function getCrateDebrisRetainedAngularVelocity1000(
  impactLevel: ImpactLevel,
  seed: number
): number {
  if (impactLevel === 'extreme') {
    return ((seed >>> 2) & 1) === 0
      ? 5200 + ((seed >>> 8) % 3201)
      : -(5200 + ((seed >>> 8) % 3201))
  }
  if (impactLevel === 'large') {
    return ((seed >>> 2) & 1) === 0
      ? 3200 + ((seed >>> 8) % 2201)
      : -(3200 + ((seed >>> 8) % 2201))
  }
  return ((seed >>> 2) & 1) === 0
    ? CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 +
        ((seed >>> 8) % (CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 + 1))
    : -(
        CRATE_RETAINED_DEBRIS_ANGULAR_BASE1000 +
        ((seed >>> 8) % (CRATE_RETAINED_DEBRIS_ANGULAR_RANGE1000 + 1))
      )
}

function rollDropChance(chance: number): boolean {
  return ((Math.random() * 100) | 0) < chance
}

function getNpcDropOffsetX(dropIndex: number): number {
  if (dropIndex <= 0) {
    return 0
  }
  const ring = (dropIndex + 1) >> 1
  return (dropIndex & 1) === 0 ? ring * 0.28 : -ring * 0.28
}

function getNpcDropVelocityX(dropIndex: number): number {
  if (dropIndex <= 0) {
    return 0
  }
  const ring = (dropIndex + 1) >> 1
  return (dropIndex & 1) === 0 ? 2 + ring : -(2 + ring)
}

function getNpcDropVelocityY(dropIndex: number): number {
  return -(6 + (dropIndex % 3))
}
