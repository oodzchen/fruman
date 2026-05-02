import {
  DEBUG_DRAW_BREAKABLE_CRATE_HEALTH,
  DEFAULT_PLAYER_RADIUS,
  SOUND_DB_SWORD_HIT_OBSTACLE,
  SOUND_RANGE_MULTIPLIER_WEAPON,
} from '../constants'
import {
  GrappleTargetComponent,
  RenderComponent,
  StatsComponent,
  TerrainDebrisComponent,
  TransformComponent,
} from '../ecs/Component'
import type { Entity } from '../ecs/Entity'
import type { World } from '../ecs/World'
import type { ArrowSystem } from '../ecs/systems/ArrowSystem'
import type { GrappleSystem } from '../ecs/systems/GrappleSystem'
import type { SoundSystem } from '../ecs/systems/SoundSystem'
import type { EffectsEmitter } from '../ecs/systems/StatsSystem'
import type {
  ObstacleCollider,
  WeaponSystem,
} from '../ecs/systems/WeaponSystem'
import type { EditorMapData } from '../editorMapTypes'
import { createEnvironmentCrateLayout } from '../environmentCrateUtils'
import {
  DEFAULT_ENVIRONMENT_SCALE_PERMILLE,
  getEnvironmentRotationDeg,
  getEnvironmentScaleXPermille,
  getEnvironmentScaleYPermille,
} from '../environmentTransformUtils'
import type { MapObjectLayerLookup } from '../mapObjectLayers'
import {
  getObstacleCollisionCategory,
  getObstacleCollisionMask,
  getWeaponCollisionCategory,
  getWeaponCollisionMask,
} from '../physicsLayers'
import { getTerrainMaterialById } from '../terrain/TerrainMaterialRegistry'
import type { MainModule, b2BodyId, b2ShapeId } from '../types'
import {
  BREAKABLE_CRATE_MAX_HEALTH,
  BREAKABLE_CRATE_SPAWN_FALL_DAMAGE_GRACE_MS,
  type BreakableCrateBreakRequest,
  type BreakableCratePlankRuntime,
  type BreakableCrateRuntime,
  type ImpactPhysics,
} from './ImpactPhysics'
import type { LootSpawner } from './LootSpawner'
import { computeRectWorldVertices } from './PolygonUtils'
import { SOUND_IDS } from './effectsProtocol'

export type RuntimeObstacleCollider = ObstacleCollider & {
  mainShapeId: b2ShapeId
  capBodyId: b2BodyId
  capShapeId: b2ShapeId
}

interface BreakableCrateManagerRuntime {
  box2d: MainModule
  worldId: ReturnType<MainModule['b2CreateWorld']>
  world: World
  impactPhysics: ImpactPhysics
  lootSpawner: LootSpawner
  effectsEmitter: EffectsEmitter
  soundSystem: SoundSystem | null
  weaponSystem: WeaponSystem | null
  arrowSystem: ArrowSystem | null
  grappleSystem: GrappleSystem | null
}

interface CreateBreakableCratesOptions {
  mapLayerLookup: MapObjectLayerLookup
  obstacles: RuntimeObstacleCollider[]
  pixelsPerMeter: number
  playTimeMs: number
}

const WOOD_MATERIAL = getTerrainMaterialById('wood')

const DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING = 0.6
const DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING = 1.8
const DEFAULT_BREAKABLE_CRATE_DENSITY = 3.6
const DEFAULT_BREAKABLE_CRATE_FRICTION = 25.6
const DEFAULT_BREAKABLE_CRATE_RESTITUTION = 0.02

export class BreakableCrateManager {
  private runtime: BreakableCrateManagerRuntime | null = null
  private nextBreakableCrateId = 1
  private readonly breakableCrates = new Map<number, BreakableCrateRuntime>()
  private readonly breakableCratePlanksByShapeId = new Map<
    b2ShapeId,
    BreakableCratePlankRuntime
  >()
  private readonly brokenEnvironmentIndices = new Set<number>()
  private breakableCrateLinearDamping = DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING
  private breakableCrateAngularDamping = DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING
  private breakableCrateDensity = DEFAULT_BREAKABLE_CRATE_DENSITY
  private breakableCrateFriction = DEFAULT_BREAKABLE_CRATE_FRICTION
  private breakableCrateRestitution = DEFAULT_BREAKABLE_CRATE_RESTITUTION

  syncRuntime(runtime: BreakableCrateManagerRuntime): void {
    this.runtime = runtime
  }

  reset(): void {
    this.breakableCrates.clear()
    this.breakableCratePlanksByShapeId.clear()
    this.brokenEnvironmentIndices.clear()
    this.runtime?.impactPhysics.clearPendingBreaks()
    this.nextBreakableCrateId = 1
  }

  getCrates(): Map<number, BreakableCrateRuntime> {
    return this.breakableCrates
  }

  getPlanksByShapeId(): Map<b2ShapeId, BreakableCratePlankRuntime> {
    return this.breakableCratePlanksByShapeId
  }

  getBrokenEnvironmentIndices(): Set<number> {
    return this.brokenEnvironmentIndices
  }

  getCrateCount(): number {
    return this.breakableCrates.size
  }

  updateParam(id: string | undefined, value: number | undefined): boolean {
    if (id === undefined || value === undefined) {
      return false
    }
    if (id === 'breakableCrateDensity') {
      this.breakableCrateDensity = Math.max(0, value)
      this.applyPreBreakParams()
      return true
    }
    if (id === 'breakableCrateFriction') {
      this.breakableCrateFriction = Math.max(0, value)
      this.applyPreBreakParams()
      return true
    }
    if (id === 'breakableCrateLinearDamping') {
      this.breakableCrateLinearDamping = Math.max(0, value)
      this.applyPreBreakParams()
      return true
    }
    if (id === 'breakableCrateAngularDamping') {
      this.breakableCrateAngularDamping = Math.max(0, value)
      this.applyPreBreakParams()
      return true
    }
    if (id === 'breakableCrateRestitution') {
      this.breakableCrateRestitution = Math.max(0, value)
      this.applyPreBreakParams()
      return true
    }
    return false
  }

  createFromMap(
    map: EditorMapData,
    options: CreateBreakableCratesOptions
  ): void {
    const runtime = this.runtime
    if (!runtime) {
      return
    }
    const envObjects = map.environmentObjects
    if (!envObjects || envObjects.length === 0) {
      return
    }
    const invPixelsPerMeter =
      options.pixelsPerMeter > 0 ? 1 / options.pixelsPerMeter : 0
    for (let i = 0; i < envObjects.length; i++) {
      const env = envObjects[i]
      if (
        env.type !== 'crate' ||
        env.hidden === true ||
        invPixelsPerMeter <= 0
      ) {
        continue
      }
      const renderLayer = getIndexedLayer(
        options.mapLayerLookup.environmentObjectLayers,
        i
      )
      const layout = createEnvironmentCrateLayout(
        env.seed,
        options.pixelsPerMeter
      )
      const rotationDeg = getEnvironmentRotationDeg(env)
      const scaleXPermille = getEnvironmentScaleXPermille(env)
      const scaleYPermille = getEnvironmentScaleYPermille(env)
      const scaleX = scaleXPermille / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
      const scaleY = scaleYPermille / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
      const rotationRad = (rotationDeg * Math.PI) / 180
      const cos = Math.cos(rotationRad)
      const sin = Math.sin(rotationRad)
      const crateHitHalfWidth = Math.max(
        0.02,
        layout.width * scaleX * invPixelsPerMeter * 0.5
      )
      const crateHitHalfHeight = Math.max(
        0.02,
        layout.height * scaleY * invPixelsPerMeter * 0.5
      )
      const crateHitLocalCenterX = 0
      const crateHitLocalCenterY = -crateHitHalfHeight

      const crateId = this.nextBreakableCrateId++
      const plankRuntimes: BreakableCratePlankRuntime[] = []
      let massArea = 0
      let massCenterX = 0
      let massCenterY = 0
      for (
        let plankIndex = 0;
        plankIndex < layout.planks.length;
        plankIndex++
      ) {
        const plank = layout.planks[plankIndex]
        const localCenterX = plank.localCenterX * scaleX * invPixelsPerMeter
        const localCenterY = plank.localCenterY * scaleY * invPixelsPerMeter
        const halfWidth = Math.max(
          0.02,
          plank.width * scaleX * invPixelsPerMeter * 0.5
        )
        const halfHeight = Math.max(
          0.02,
          plank.height * scaleY * invPixelsPerMeter * 0.5
        )
        const plankRuntime: BreakableCratePlankRuntime = {
          crateId,
          entity: null,
          bodyId: 0 as unknown as b2BodyId,
          shapeId: 0 as unknown as b2ShapeId,
          obstacleIndex: -1,
          localCenterX,
          localCenterY,
          centerX: 0,
          centerY: 0,
          halfWidth,
          halfHeight,
          rotationRad,
          debrisVariant: plank.debrisVariant,
        }
        plankRuntimes.push(plankRuntime)
        const area = halfWidth * halfHeight
        massArea += area
        massCenterX += localCenterX * area
        massCenterY += localCenterY * area
      }
      const centerOfMassLocalX = massArea > 0 ? massCenterX / massArea : 0
      const centerOfMassLocalY = massArea > 0 ? massCenterY / massArea : 0
      const bodyCenterX =
        env.x + centerOfMassLocalX * cos - centerOfMassLocalY * sin
      const bodyCenterY =
        env.y + centerOfMassLocalX * sin + centerOfMassLocalY * cos
      const adjustedHitLocalCenterX = crateHitLocalCenterX - centerOfMassLocalX
      const adjustedHitLocalCenterY = crateHitLocalCenterY - centerOfMassLocalY
      const crateHitCenterX =
        bodyCenterX +
        adjustedHitLocalCenterX * cos -
        adjustedHitLocalCenterY * sin
      const crateHitCenterY =
        bodyCenterY +
        adjustedHitLocalCenterX * sin +
        adjustedHitLocalCenterY * cos
      for (
        let plankIndex = 0;
        plankIndex < plankRuntimes.length;
        plankIndex++
      ) {
        const plankRuntime = plankRuntimes[plankIndex]
        plankRuntime.localCenterX -= centerOfMassLocalX
        plankRuntime.localCenterY -= centerOfMassLocalY
        plankRuntime.centerX =
          bodyCenterX +
          plankRuntime.localCenterX * cos -
          plankRuntime.localCenterY * sin
        plankRuntime.centerY =
          bodyCenterY +
          plankRuntime.localCenterX * sin +
          plankRuntime.localCenterY * cos
      }

      const crate: BreakableCrateRuntime = {
        id: crateId,
        envIndex: i,
        seed: env.seed,
        renderLayer,
        destroyed: false,
        health: BREAKABLE_CRATE_MAX_HEALTH,
        bodyId: 0 as unknown as b2BodyId,
        centerX: bodyCenterX,
        centerY: bodyCenterY,
        rotationRad,
        isGrounded: false,
        wasGrounded: false,
        fallTrackingActive: false,
        fallDamageIgnoreUntilMs:
          options.playTimeMs + BREAKABLE_CRATE_SPAWN_FALL_DAMAGE_GRACE_MS,
        maxFallVelocity1000: 0,
        fallStartY1000: 0,
        fallContactCount: 0,
        fallSolidContactCount: 0,
        sleepSynced: false,
        hitObstacleIndex: -1,
        hitLocalCenterX: adjustedHitLocalCenterX,
        hitLocalCenterY: adjustedHitLocalCenterY,
        hitHalfWidth: crateHitHalfWidth,
        hitHalfHeight: crateHitHalfHeight,
        planks: plankRuntimes,
      }
      crate.bodyId = this.createRuntimeBody(
        bodyCenterX,
        bodyCenterY,
        rotationRad,
        renderLayer,
        crate.planks
      )
      crate.hitObstacleIndex = options.obstacles.length
      options.obstacles.push({
        bodyId: crate.bodyId,
        mainShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
        capBodyId: crate.bodyId,
        capShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
        centerX: crateHitCenterX,
        centerY: crateHitCenterY,
        width: crateHitHalfWidth,
        height: crateHitHalfHeight,
        rotationRad,
        renderLayer,
        materialTag: 'obstacle',
        breakableId: crate.id,
        breakableHitProxy: true,
        worldVertices: computeRectWorldVertices(
          crateHitCenterX,
          crateHitCenterY,
          crateHitHalfWidth,
          crateHitHalfHeight,
          rotationRad
        ),
      })
      for (let plankIndex = 0; plankIndex < crate.planks.length; plankIndex++) {
        const plankRuntime = crate.planks[plankIndex]
        plankRuntime.bodyId = crate.bodyId
        plankRuntime.entity = this.createPlankEntity(
          plankRuntime,
          renderLayer,
          crate.seed,
          plankIndex
        )
        plankRuntime.obstacleIndex = options.obstacles.length
        options.obstacles.push({
          bodyId: crate.bodyId,
          mainShapeId: plankRuntime.shapeId,
          capBodyId: crate.bodyId,
          capShapeId: plankRuntime.shapeId,
          centerX: plankRuntime.centerX,
          centerY: plankRuntime.centerY,
          width: plankRuntime.halfWidth,
          height: plankRuntime.halfHeight,
          rotationRad: plankRuntime.rotationRad,
          renderLayer,
          materialTag: 'obstacle',
          breakableId: crate.id,
          worldVertices: computeRectWorldVertices(
            plankRuntime.centerX,
            plankRuntime.centerY,
            plankRuntime.halfWidth,
            plankRuntime.halfHeight,
            plankRuntime.rotationRad
          ),
        })
      }
      this.syncRuntimeCrate(crate, options.obstacles, options.playTimeMs)
      this.breakableCrates.set(crate.id, crate)
    }
  }

  applyPreBreakParams(): void {
    const runtime = this.runtime
    if (!runtime || this.breakableCrates.size === 0) {
      return
    }
    const {
      b2Body_SetLinearDamping,
      b2Body_SetAngularDamping,
      b2Shape_SetDensity,
      b2Shape_SetFriction,
      b2Shape_SetRestitution,
    } = runtime.box2d
    for (const crate of this.breakableCrates.values()) {
      if (crate.destroyed) {
        continue
      }
      b2Body_SetLinearDamping(crate.bodyId, this.breakableCrateLinearDamping)
      b2Body_SetAngularDamping(crate.bodyId, this.breakableCrateAngularDamping)
      for (let i = 0; i < crate.planks.length; i++) {
        const plank = crate.planks[i]
        b2Shape_SetDensity(
          plank.shapeId,
          this.breakableCrateDensity,
          i === crate.planks.length - 1
        )
        b2Shape_SetFriction(plank.shapeId, this.breakableCrateFriction)
        b2Shape_SetRestitution(plank.shapeId, this.breakableCrateRestitution)
      }
    }
  }

  syncRuntimes(obstacles: RuntimeObstacleCollider[], playTimeMs: number): void {
    const runtime = this.runtime
    if (!runtime || this.breakableCrates.size === 0) {
      return
    }
    for (const crate of this.breakableCrates.values()) {
      this.syncRuntimeCrate(crate, obstacles, playTimeMs)
    }
  }

  refreshObstacleIndices(obstacles: RuntimeObstacleCollider[]): void {
    for (const crate of this.breakableCrates.values()) {
      crate.hitObstacleIndex = -1
      for (let i = 0; i < crate.planks.length; i++) {
        crate.planks[i].obstacleIndex = -1
      }
    }
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i]
      const crateId = obstacle.breakableId
      if (crateId === undefined) {
        continue
      }
      const crate = this.breakableCrates.get(crateId)
      if (!crate || crate.destroyed) {
        continue
      }
      if (obstacle.breakableHitProxy) {
        crate.hitObstacleIndex = i
        continue
      }
      const plank = this.breakableCratePlanksByShapeId.get(obstacle.mainShapeId)
      if (!plank || plank.crateId !== crateId) {
        continue
      }
      plank.obstacleIndex = i
    }
  }

  appendActiveObstacles(obstacles: RuntimeObstacleCollider[]): void {
    if (this.breakableCrates.size <= 0) {
      return
    }
    for (const crate of this.breakableCrates.values()) {
      if (crate.destroyed) {
        continue
      }
      const cos = Math.cos(crate.rotationRad)
      const sin = Math.sin(crate.rotationRad)
      const hitCenterX =
        crate.centerX +
        crate.hitLocalCenterX * cos -
        crate.hitLocalCenterY * sin
      const hitCenterY =
        crate.centerY +
        crate.hitLocalCenterX * sin +
        crate.hitLocalCenterY * cos
      crate.hitObstacleIndex = obstacles.length
      obstacles.push({
        bodyId: crate.bodyId,
        mainShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
        capBodyId: crate.bodyId,
        capShapeId: crate.planks[0]?.shapeId ?? (0 as unknown as b2ShapeId),
        centerX: hitCenterX,
        centerY: hitCenterY,
        width: crate.hitHalfWidth,
        height: crate.hitHalfHeight,
        rotationRad: crate.rotationRad,
        renderLayer: crate.renderLayer,
        materialTag: 'obstacle',
        breakableId: crate.id,
        breakableHitProxy: true,
        worldVertices: computeRectWorldVertices(
          hitCenterX,
          hitCenterY,
          crate.hitHalfWidth,
          crate.hitHalfHeight,
          crate.rotationRad
        ),
      })
      for (let i = 0; i < crate.planks.length; i++) {
        const plank = crate.planks[i]
        plank.obstacleIndex = obstacles.length
        obstacles.push({
          bodyId: crate.bodyId,
          mainShapeId: plank.shapeId,
          capBodyId: crate.bodyId,
          capShapeId: plank.shapeId,
          centerX: plank.centerX,
          centerY: plank.centerY,
          width: plank.halfWidth,
          height: plank.halfHeight,
          rotationRad: plank.rotationRad,
          renderLayer: crate.renderLayer,
          materialTag: 'obstacle',
          breakableId: crate.id,
          worldVertices: computeRectWorldVertices(
            plank.centerX,
            plank.centerY,
            plank.halfWidth,
            plank.halfHeight,
            plank.rotationRad
          ),
        })
      }
    }
  }

  breakCrate(
    request: BreakableCrateBreakRequest,
    obstacles: RuntimeObstacleCollider[]
  ): boolean {
    const runtime = this.runtime
    if (
      !runtime ||
      !runtime.soundSystem ||
      !runtime.weaponSystem ||
      !runtime.arrowSystem ||
      !runtime.grappleSystem
    ) {
      return false
    }
    const crate = this.breakableCrates.get(request.crateId)
    if (!crate || crate.destroyed) {
      return false
    }
    crate.destroyed = true
    this.breakableCrates.delete(crate.id)
    this.brokenEnvironmentIndices.add(crate.envIndex)
    runtime.effectsEmitter.playSoundAt(
      SOUND_IDS.WOOD_BOX_BROKEN,
      request.impactX,
      request.impactY
    )
    this.emitBreakSound(request)
    let remainingDebrisBudget =
      runtime.lootSpawner.getRemainingTerrainDebrisBudget()
    const retainedPlankMask = runtime.lootSpawner.selectRetainedCratePlankMask(
      crate,
      request.impactX,
      request.impactY,
      request.impactLevel,
      remainingDebrisBudget
    )
    remainingDebrisBudget -=
      runtime.lootSpawner.countSelectedCratePlanks(retainedPlankMask)

    for (let i = 0; i < crate.planks.length; i++) {
      const plank = crate.planks[i]
      if (plank.entity) {
        plank.entity.removeComponent('GrappleTarget')
        runtime.world.markCacheDirty()
        runtime.grappleSystem.markAnchorsDirty()
        runtime.world.destroyEntity(plank.entity)
        plank.entity = null
      }
      this.breakableCratePlanksByShapeId.delete(plank.shapeId)
      const shouldRetain = ((retainedPlankMask >>> i) & 1) !== 0
      if (shouldRetain) {
        if (
          !runtime.lootSpawner.retainCratePlankDebrisEntity(
            plank,
            request.impactX,
            request.impactY,
            request.impactLevel,
            crate.renderLayer,
            crate.seed,
            i
          )
        ) {
          continue
        }
        continue
      }
      if (remainingDebrisBudget > 0) {
        runtime.lootSpawner.spawnCratePlankDebrisEntity(
          plank,
          request.impactX,
          request.impactY,
          request.impactLevel,
          crate.renderLayer,
          crate.seed,
          i
        )
        remainingDebrisBudget -= 1
      }
    }
    runtime.box2d.b2DestroyBody(crate.bodyId)

    for (let i = obstacles.length - 1; i >= 0; i--) {
      if (obstacles[i].breakableId === crate.id) {
        obstacles.splice(i, 1)
      }
    }
    this.refreshObstacleIndices(obstacles)
    runtime.weaponSystem.setObstacles(obstacles)
    runtime.arrowSystem.setObstacles(obstacles)
    return true
  }

  private createPlankEntity(
    plank: BreakableCratePlankRuntime,
    renderLayer: number,
    seedBase: number,
    plankIndex: number
  ): Entity | null {
    const runtime = this.runtime
    if (!runtime) {
      return null
    }
    const seed = hashTerrainDebrisSeed(
      Math.round(plank.centerX * 1000),
      Math.round(plank.centerY * 1000),
      (seedBase + plankIndex * 11) | 0
    )
    const entity = runtime.world.createEntity()
    const transform = new TransformComponent()
    transform.x = plank.centerX
    transform.y = plank.centerY
    transform.rotation = plank.rotationRad
    entity.addComponent(transform)

    const render = new RenderComponent()
    render.visible = true
    render.renderLayer = renderLayer
    render.radius = Math.max(plank.halfWidth, plank.halfHeight)
    render.color =
      WOOD_MATERIAL.fillPalette[(seed >>> 3) % WOOD_MATERIAL.fillPalette.length]
    render.borderColor = WOOD_MATERIAL.strokeColor
    entity.addComponent(render)

    const debris = new TerrainDebrisComponent()
    debris.width = plank.halfWidth * 2
    debris.height = plank.halfHeight * 2
    debris.variant = plank.debrisVariant
    debris.lifeMs = 0
    debris.elapsedMs = 0
    debris.fadeStartMs = 0
    debris.receivesWeaponImpulse = false
    entity.addComponent(debris)

    const stats = new StatsComponent()
    const isDebugHealthPlank =
      DEBUG_DRAW_BREAKABLE_CRATE_HEALTH && plankIndex === 0
    stats.maxHealth = isDebugHealthPlank ? BREAKABLE_CRATE_MAX_HEALTH : 0
    stats.health = isDebugHealthPlank ? BREAKABLE_CRATE_MAX_HEALTH : 0
    entity.addComponent(stats)

    const grappleTarget = new GrappleTargetComponent()
    grappleTarget.bodyId = plank.bodyId
    grappleTarget.shapeId = plank.shapeId
    grappleTarget.anchorLocalX = plank.localCenterX
    grappleTarget.anchorLocalY = plank.localCenterY
    grappleTarget.toughness = 0
    grappleTarget.canPull = true
    grappleTarget.canTether = true
    entity.addComponent(grappleTarget)
    return entity
  }

  private createRuntimeBody(
    centerX: number,
    centerY: number,
    rotationRad: number,
    renderLayer: number,
    planks: readonly BreakableCratePlankRuntime[]
  ): b2BodyId {
    const runtime = this.runtime
    if (!runtime) {
      return 0 as unknown as b2BodyId
    }
    const {
      b2BodyType,
      b2DefaultBodyDef,
      b2CreateBody,
      b2Body_ApplyMassFromShapes,
      b2DefaultShapeDef,
      b2CreatePolygonShape,
      b2MakeOffsetBox,
      b2Vec2,
      b2Rot,
    } = runtime.box2d
    const bodyDef = b2DefaultBodyDef()
    bodyDef.type = b2BodyType.b2_dynamicBody
    bodyDef.position.Set(centerX, centerY)
    bodyDef.rotation.SetAngle(rotationRad)
    bodyDef.linearDamping = this.breakableCrateLinearDamping
    bodyDef.angularDamping = this.breakableCrateAngularDamping
    const bodyId = b2CreateBody(runtime.worldId, bodyDef)

    const shapeDef = b2DefaultShapeDef()
    shapeDef.density = this.breakableCrateDensity
    shapeDef.material.friction = this.breakableCrateFriction
    shapeDef.material.restitution = this.breakableCrateRestitution
    shapeDef.filter.categoryBits =
      getObstacleCollisionCategory(renderLayer) |
      getWeaponCollisionCategory(renderLayer)
    shapeDef.filter.maskBits =
      getObstacleCollisionMask(renderLayer) |
      getWeaponCollisionMask(renderLayer)

    const localCenter = new b2Vec2(0, 0)
    const localRotation = new b2Rot()
    localRotation.SetAngle(0)
    for (let i = 0; i < planks.length; i++) {
      const plank = planks[i]
      localCenter.Set(plank.localCenterX, plank.localCenterY)
      const box = b2MakeOffsetBox(
        plank.halfWidth,
        plank.halfHeight,
        localCenter,
        localRotation
      )
      plank.shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)
      this.breakableCratePlanksByShapeId.set(plank.shapeId, plank)
      box.delete()
    }
    b2Body_ApplyMassFromShapes(bodyId)

    localCenter.delete()
    localRotation.delete()
    shapeDef.delete()
    bodyDef.delete()
    return bodyId
  }

  private syncRuntimeCrate(
    crate: BreakableCrateRuntime,
    obstacles: RuntimeObstacleCollider[],
    playTimeMs: number
  ): void {
    const runtime = this.runtime
    if (!runtime || crate.destroyed) {
      return
    }
    const isAwake = runtime.box2d.b2Body_IsAwake(crate.bodyId)
    if (!isAwake && crate.sleepSynced) {
      return
    }
    const position = runtime.box2d.b2Body_GetPosition(crate.bodyId)
    const rotation = runtime.box2d.b2Body_GetRotation(crate.bodyId)
    const velocity = runtime.box2d.b2Body_GetLinearVelocity(crate.bodyId)
    const angle = runtime.box2d.b2Rot_GetAngle(rotation)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    crate.centerX = position.x
    crate.centerY = position.y
    crate.rotationRad = angle
    runtime.impactPhysics.syncBreakableCrateDebugStats(crate)
    runtime.impactPhysics.handleBreakableCrateFallDamage(
      crate,
      Math.round(velocity.y * 1000),
      playTimeMs
    )
    const hitCenterX =
      crate.centerX + crate.hitLocalCenterX * cos - crate.hitLocalCenterY * sin
    const hitCenterY =
      crate.centerY + crate.hitLocalCenterX * sin + crate.hitLocalCenterY * cos
    const hitObstacle = obstacles[crate.hitObstacleIndex]
    if (
      hitObstacle?.breakableHitProxy &&
      hitObstacle.breakableId === crate.id
    ) {
      hitObstacle.centerX = hitCenterX
      hitObstacle.centerY = hitCenterY
      hitObstacle.rotationRad = angle
      hitObstacle.worldVertices = computeRectWorldVertices(
        hitCenterX,
        hitCenterY,
        crate.hitHalfWidth,
        crate.hitHalfHeight,
        angle,
        hitObstacle.worldVertices
      )
    }

    for (let i = 0; i < crate.planks.length; i++) {
      const plank = crate.planks[i]
      const worldX =
        crate.centerX + plank.localCenterX * cos - plank.localCenterY * sin
      const worldY =
        crate.centerY + plank.localCenterX * sin + plank.localCenterY * cos
      plank.centerX = worldX
      plank.centerY = worldY
      plank.rotationRad = angle

      const obstacle = obstacles[plank.obstacleIndex]
      if (obstacle?.breakableId === crate.id && !obstacle.breakableHitProxy) {
        obstacle.centerX = worldX
        obstacle.centerY = worldY
        obstacle.rotationRad = angle
        obstacle.worldVertices = computeRectWorldVertices(
          worldX,
          worldY,
          plank.halfWidth,
          plank.halfHeight,
          angle,
          obstacle.worldVertices
        )
      }

      const entity = plank.entity
      if (entity?.transform) {
        entity.transform.x = worldX
        entity.transform.y = worldY
        entity.transform.rotation = angle
      }
    }

    crate.sleepSynced = !isAwake
    position.delete()
    rotation.delete()
    velocity.delete()
  }

  private emitBreakSound(request: BreakableCrateBreakRequest): void {
    const runtime = this.runtime
    const soundSystem = runtime?.soundSystem
    if (!runtime || !soundSystem) {
      return
    }
    let sourceRadius = DEFAULT_PLAYER_RADIUS
    if (request.sourceEntityId > 0) {
      const source = runtime.world.getEntityById(request.sourceEntityId)
      sourceRadius = source?.render?.radius ?? DEFAULT_PLAYER_RADIUS
    }
    soundSystem.emitSoundAt(
      request.impactX,
      request.impactY,
      sourceRadius,
      SOUND_DB_SWORD_HIT_OBSTACLE,
      SOUND_RANGE_MULTIPLIER_WEAPON,
      request.sourceEntityId
    )
  }
}

function getIndexedLayer(layers: readonly number[], index: number): number {
  return layers[index] ?? 0
}

function hashTerrainDebrisSeed(a: number, b: number, c: number): number {
  let hash = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b)
  hash ^= Math.imul(b ^ 0xc2b2ae35, 0x27d4eb2f)
  hash ^= Math.imul(c ^ 0x165667b1, 0x9e3779b1)
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return hash >>> 0
}
