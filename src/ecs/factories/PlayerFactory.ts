import {
  CATEGORY_ENEMY,
  CATEGORY_PLAYER,
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_ENEMY_ATTACK_DESIRE,
  DEFAULT_ENEMY_MOVE_SPEED,
  DEFAULT_JUMP_BUFFER_WINDOW,
  DEFAULT_JUMP_FORCE,
  DEFAULT_JUMP_FORCE_MULTIPLIER,
  DEFAULT_MAX_JUMP_DURATION,
  DEFAULT_MAX_WALL_JUMPS,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  DEFAULT_WEAPON_FOLLOW_OFFSET_X,
  DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WEIGHT,
  DEFAULT_WEAPON_WIDTH,
  ENEMY_DETECTION_RANGE,
  MASK_ENEMY,
  MASK_PLAYER,
} from '../../constants'
import type { MainModule, b2WorldId } from '../../types'
import {
  EnemyAIComponent,
  Faction,
  FactionComponent,
  InputComponent,
  MovementComponent,
  PhysicsComponent,
  RenderComponent,
  SensorComponent,
  StatsComponent,
  TransformComponent,
  WeaponComponent,
} from '../Component'
import type { Entity } from '../Entity'
import type { World } from '../World'

export function createPlayer(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number
): Entity {
  const entity = world.createEntity()

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const physics = new PhysicsComponent()
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2Capsule,
    b2DefaultShapeDef,
    b2CreateCapsuleShape,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(x, y)
  bodyDef.motionLocks.angularZ = true
  bodyDef.linearDamping = DEFAULT_BODY_LINEAR_DAMPING
  physics.bodyId = b2CreateBody(worldId, bodyDef)

  const shape = new b2Capsule()
  shape.center1.Set(0, 0)
  shape.center2.Set(0, 0)
  shape.radius = DEFAULT_PLAYER_RADIUS
  const fixtureDef = b2DefaultShapeDef()
  fixtureDef.density = 1.0
  fixtureDef.material.friction = DEFAULT_BODY_FRICTION
  fixtureDef.filter.categoryBits = CATEGORY_PLAYER
  fixtureDef.filter.maskBits = MASK_PLAYER
  physics.shapeId = b2CreateCapsuleShape(physics.bodyId, fixtureDef, shape)

  bodyDef.delete()
  shape.delete()
  fixtureDef.delete()

  entity.addComponent(physics)
  // ... (rest of function unchanged)

  const movement = new MovementComponent()
  movement.moveSpeed = DEFAULT_MOVE_SPEED
  movement.jumpForce = DEFAULT_JUMP_FORCE
  movement.maxJumpDuration = DEFAULT_MAX_JUMP_DURATION
  movement.jumpForceMultiplier = DEFAULT_JUMP_FORCE_MULTIPLIER
  movement.wallJumpPushAwayMultiplier = DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER
  movement.wallJumpUpwardMultiplier = DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER
  movement.maxWallJumps = DEFAULT_MAX_WALL_JUMPS
  movement.baseWeight = DEFAULT_PLAYER_WEIGHT
  movement.carryWeight = 0
  entity.addComponent(movement)

  const input = new InputComponent()
  input.inputBuffer.setDefaultBufferWindow(DEFAULT_JUMP_BUFFER_WINDOW)
  entity.addComponent(input)

  const stats = new StatsComponent()
  stats.maxHealth = DEFAULT_PLAYER_MAX_HEALTH
  stats.health = DEFAULT_PLAYER_MAX_HEALTH
  stats.maxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.toughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.combatExitTimeout = 30000 // 玩家30秒无攻击后脱战
  entity.addComponent(stats)

  const render = new RenderComponent()
  render.radius = DEFAULT_PLAYER_RADIUS
  entity.addComponent(render)

  const faction = new FactionComponent()
  faction.faction = Faction.Player
  entity.addComponent(faction)

  const sensor = new SensorComponent()
  sensor.radius = ENEMY_DETECTION_RANGE
  sensor.fov = (90 * Math.PI) / 180 // +/- 45 degrees
  entity.addComponent(sensor)

  const weapon = new WeaponComponent()
  weapon.width = DEFAULT_WEAPON_WIDTH
  weapon.height = DEFAULT_WEAPON_HEIGHT
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weight = DEFAULT_WEAPON_WEIGHT
  weapon.attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  weapon.toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
  const weaponX = 6
  const weaponY = groundTopY - DEFAULT_WEAPON_HEIGHT / 2
  weapon.position = {
    x: weaponX,
    y: weaponY,
  }
  weapon.rotation = DEFAULT_WEAPON_GROUND_ROTATION_RAD
  weapon.isEquipped = false
  weapon.visual = {
    x: weaponX,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.attackStartTransform = {
    x: weaponX,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.swingStartTransform = {
    x: weaponX,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.swingEndTransform = {
    x: weaponX,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.attackStartOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.swingStartOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.swingEndOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
  entity.addComponent(weapon)

  return entity
}

export function createEnemy(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  attackDesire: number = DEFAULT_ENEMY_ATTACK_DESIRE
): Entity {
  const enemy = createPlayer(world, box2d, worldId, x, y, groundTopY)

  // 重置敌人的脱战超时为10秒
  if (enemy.stats) {
    enemy.stats.combatExitTimeout = 10000
  }

  const ai = new EnemyAIComponent()
  ai.attackDesire = attackDesire
  ai.patrolCenter = { x, y }
  enemy.addComponent(ai)

  if (enemy.sensor) {
    enemy.sensor.radius = ENEMY_DETECTION_RANGE
    enemy.sensor.fov = (90 * Math.PI) / 180 // +/- 45 degrees
  }

  if (enemy.physics) {
    const { b2Shape_GetFilter, b2Shape_SetFilter } = box2d
    const filter = b2Shape_GetFilter(enemy.physics.shapeId)
    filter.categoryBits = CATEGORY_ENEMY
    filter.maskBits = MASK_ENEMY
    b2Shape_SetFilter(enemy.physics.shapeId, filter)
  }

  if (enemy.faction) {
    enemy.faction.faction = Faction.Enemy
  }

  if (enemy.render) {
    enemy.render.color = '#889357'
  }

  if (enemy.movement) {
    enemy.movement.moveSpeed = DEFAULT_ENEMY_MOVE_SPEED
  }

  if (enemy.weapon && enemy.transform) {
    const facing = 1
    const followX = enemy.transform.x - facing * DEFAULT_WEAPON_FOLLOW_OFFSET_X
    const followY = enemy.transform.y + DEFAULT_WEAPON_FOLLOW_OFFSET_Y
    const equippedTransform = {
      x: followX,
      y: followY,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }

    enemy.weapon.isEquipped = true
    enemy.weapon.position = { x: followX, y: followY }
    enemy.weapon.visual = { ...equippedTransform }
    enemy.weapon.attackStartTransform = { ...equippedTransform }
    enemy.weapon.swingStartTransform = { ...equippedTransform }
    enemy.weapon.swingEndTransform = { ...equippedTransform }
    enemy.weapon.attackStartOffset = {
      dx: followX - enemy.transform.x,
      dy: followY - enemy.transform.y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
    enemy.weapon.swingStartOffset = { ...enemy.weapon.attackStartOffset }
    enemy.weapon.swingEndOffset = { ...enemy.weapon.attackStartOffset }
    enemy.weapon.attackFacing = facing
    enemy.weapon.attackPhase = 'idle'
    enemy.weapon.attackQueued = false
    // 武器重量由MovementSystem自动读取
  }

  return enemy
}

export function createWeapon(
  world: World,
  x: number,
  y: number,
  groundTopY: number
): Entity {
  const entity = world.createEntity()

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const weapon = new WeaponComponent()
  weapon.width = DEFAULT_WEAPON_WIDTH
  weapon.height = DEFAULT_WEAPON_HEIGHT
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weight = DEFAULT_WEAPON_WEIGHT
  weapon.attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  weapon.toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
  weapon.position = {
    x: x,
    y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
  }
  weapon.rotation = DEFAULT_WEAPON_GROUND_ROTATION_RAD
  weapon.isEquipped = false
  weapon.attackPhase = 'idle'
  weapon.attackElapsedMs = 0
  weapon.lastAttackTimestamp = 0
  weapon.attackStartTransform = {
    x: x,
    y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.visual = {
    x: x,
    y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.attackQueued = false
  weapon.comboCount = 0
  weapon.swingDirection = 'toFront'
  weapon.nextSwingDirection = 'toFront'
  weapon.attackFacing = 1
  weapon.attackStartOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.swingStartOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.swingEndOffset = {
    dx: 0,
    dy: 0,
    rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  }
  weapon.swingStartTransform = {
    x: x,
    y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.swingEndTransform = {
    x: x,
    y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS

  entity.addComponent(weapon)

  return entity
}
