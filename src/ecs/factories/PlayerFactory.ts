import {
  CATEGORY_ENEMY,
  CATEGORY_PLAYER,
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_JUMP_BUFFER_WINDOW,
  DEFAULT_JUMP_FORCE,
  DEFAULT_JUMP_FORCE_MULTIPLIER,
  DEFAULT_MAX_JUMP_DURATION,
  DEFAULT_MAX_WALL_JUMPS,
  DEFAULT_MOVE_SPEED,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_POSTURE_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WEIGHT,
  DEFAULT_WEAPON_WIDTH,
  ENEMY_DETECTION_RANGE,
  ENEMY_TEMPLATES,
  MASK_ENEMY,
  MASK_PLAYER,
  WEAPON_TEMPLATES,
} from '../../constants'
import type { EnemyType, MainModule, WeaponType, b2WorldId } from '../../types'
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
  WeaponSlotsComponent,
} from '../Component'
import type { Entity } from '../Entity'
import type { World } from '../World'

export function createPlayer(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  radius: number = DEFAULT_PLAYER_RADIUS
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
  shape.radius = radius
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
  movement.bodyFriction = DEFAULT_BODY_FRICTION
  movement.currentFriction = DEFAULT_BODY_FRICTION
  entity.addComponent(movement)

  const input = new InputComponent()
  input.inputBuffer.setDefaultBufferWindow(DEFAULT_JUMP_BUFFER_WINDOW)
  entity.addComponent(input)

  const stats = new StatsComponent()
  stats.maxHealth = DEFAULT_PLAYER_MAX_HEALTH
  stats.health = DEFAULT_PLAYER_MAX_HEALTH
  stats.maxPosture = DEFAULT_PLAYER_MAX_POSTURE
  stats.posture = DEFAULT_PLAYER_MAX_POSTURE
  stats.maxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.toughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  stats.combatExitTimeout = 30000 // 玩家30秒无攻击后脱战
  entity.addComponent(stats)

  const render = new RenderComponent()
  render.radius = radius
  entity.addComponent(render)

  const faction = new FactionComponent()
  faction.faction = Faction.Player
  entity.addComponent(faction)

  const sensor = new SensorComponent()
  sensor.radius = ENEMY_DETECTION_RANGE
  sensor.fov = (160 * Math.PI) / 180 // +/- 80 degrees
  entity.addComponent(sensor)

  const weapon = new WeaponComponent()
  weapon.width = DEFAULT_WEAPON_WIDTH
  weapon.height = DEFAULT_WEAPON_HEIGHT
  weapon.baseWidth = weapon.width
  weapon.blockWidthStart = weapon.width
  weapon.blockWidthTarget = weapon.width
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weight = DEFAULT_WEAPON_WEIGHT
  weapon.weaponType = 'sword'
  weapon.attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  weapon.postureDamage = DEFAULT_WEAPON_POSTURE_DAMAGE
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

  const weaponSlots = new WeaponSlotsComponent()
  weaponSlots.activeSlot = 'main'
  entity.addComponent(weaponSlots)

  return entity
}

export function createEnemy(
  world: World,
  box2d: MainModule,
  worldId: b2WorldId,
  x: number,
  y: number,
  groundTopY: number,
  enemyType: EnemyType = 'default'
): Entity {
  const template = ENEMY_TEMPLATES[enemyType]
  const enemy = createPlayer(
    world,
    box2d,
    worldId,
    x,
    y,
    groundTopY,
    template.radius
  )

  // 重置敌人的脱战超时为10秒
  if (enemy.stats) {
    enemy.stats.combatExitTimeout = 10000
    enemy.stats.maxHealth = template.maxHealth
    enemy.stats.health = template.maxHealth
    enemy.stats.maxPosture = template.maxPosture
    enemy.stats.posture = template.maxPosture
    enemy.stats.maxToughness = template.maxToughness
    enemy.stats.toughness = template.maxToughness
  }

  const ai = new EnemyAIComponent()
  ai.attackDesire = template.attackDesire
  ai.parryProficiency = template.parryProficiency
  ai.enemyType = enemyType
  ai.initialPatrolMode = template.initialPatrolMode
  ai.patrolCenter = { x, y }
  ai.lastPosition = { x, y }
  if (enemyType === 'archer') {
    ai.detectionRange = ENEMY_DETECTION_RANGE * 2
  }

  // 站岗模式复用空巡逻点逻辑
  if (ai.initialPatrolMode === 'guard') {
    ai.patrolWaypoints = []
  } else {
    // 默认巡逻路线：以出生点为中心，左右各5米的范围
    ai.patrolWaypoints = [
      { x: x - 5, y: y },
      { x: x + 5, y: y },
    ]
  }
  enemy.addComponent(ai)

  if (enemy.sensor) {
    enemy.sensor.radius = ai.detectionRange
    enemy.sensor.fov = (160 * Math.PI) / 180 // +/- 80 degrees
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
    enemy.render.color = template.color
  }

  if (enemy.movement) {
    enemy.movement.moveSpeed = template.moveSpeed
  }

  if (enemy.weapon && enemy.transform) {
    const facing = 1
    const followX = enemy.transform.x - facing * (template.radius + 0.2)
    const followY = enemy.transform.y + template.radius * -0.2
    const equippedTransform = {
      x: followX,
      y: followY,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }

    if (enemy.weaponSlots && enemyType === 'archer') {
      const swordTemplate = WEAPON_TEMPLATES.sword
      enemy.weaponSlots.main.hasWeapon = true
      enemy.weaponSlots.main.weaponType = 'sword'
      enemy.weaponSlots.main.width = swordTemplate.width
      enemy.weaponSlots.main.height = swordTemplate.height
      enemy.weaponSlots.main.baseWidth = swordTemplate.width
      enemy.weaponSlots.main.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
      enemy.weaponSlots.main.weight = swordTemplate.weight
      enemy.weaponSlots.main.attackDamage = swordTemplate.attackDamage
      enemy.weaponSlots.main.postureDamage = swordTemplate.postureDamage
      enemy.weaponSlots.main.toughnessDamage = swordTemplate.toughnessDamage

      const bowTemplate = WEAPON_TEMPLATES.bow
      enemy.weaponSlots.secondary.hasWeapon = true
      enemy.weaponSlots.secondary.weaponType = 'bow'
      enemy.weaponSlots.secondary.width = bowTemplate.width
      enemy.weaponSlots.secondary.height = bowTemplate.height
      enemy.weaponSlots.secondary.baseWidth = bowTemplate.width
      enemy.weaponSlots.secondary.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
      enemy.weaponSlots.secondary.weight = bowTemplate.weight
      enemy.weaponSlots.secondary.attackDamage = bowTemplate.attackDamage
      enemy.weaponSlots.secondary.postureDamage = bowTemplate.postureDamage
      enemy.weaponSlots.secondary.toughnessDamage = bowTemplate.toughnessDamage
      enemy.weaponSlots.secondary.bowAmmoMax = DEFAULT_BOW_AMMO_ENEMY
      enemy.weaponSlots.secondary.bowAmmo = DEFAULT_BOW_AMMO_ENEMY

      enemy.weaponSlots.activeSlot = 'secondary'
      enemy.weapon.width = bowTemplate.width
      enemy.weapon.height = bowTemplate.height
      enemy.weapon.baseWidth = bowTemplate.width
      enemy.weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
      enemy.weapon.weight = bowTemplate.weight
      enemy.weapon.weaponType = 'bow'
      enemy.weapon.attackDamage = bowTemplate.attackDamage
      enemy.weapon.postureDamage = bowTemplate.postureDamage
      enemy.weapon.toughnessDamage = bowTemplate.toughnessDamage
      enemy.weapon.bowAmmoMax = DEFAULT_BOW_AMMO_ENEMY
      enemy.weapon.bowAmmo = DEFAULT_BOW_AMMO_ENEMY
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

  if (enemyType === 'archer' && enemy.input) {
    enemy.input.lastMoveDirection = -1
    enemy.input.facingOverride = -1
  }

  return enemy
}

export function createWeapon(
  world: World,
  x: number,
  y: number,
  groundTopY: number,
  weaponType: WeaponType = 'sword'
): Entity {
  const entity = world.createEntity()

  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const template = WEAPON_TEMPLATES[weaponType]
  const weapon = new WeaponComponent()
  weapon.width = template.width
  weapon.height = template.height
  weapon.baseWidth = weapon.width
  weapon.blockWidthStart = weapon.width
  weapon.blockWidthTarget = weapon.width
  weapon.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  weapon.weight = template.weight
  weapon.weaponType = weaponType
  weapon.attackDamage = template.attackDamage
  weapon.postureDamage = template.postureDamage
  weapon.toughnessDamage = template.toughnessDamage
  if (weaponType === 'bow') {
    weapon.bowAmmoMax = DEFAULT_BOW_AMMO_PLAYER
    weapon.bowAmmo = DEFAULT_BOW_AMMO_PLAYER
  }
  const weaponY = groundTopY - weapon.height / 2
  weapon.position = {
    x: x,
    y: weaponY,
  }
  weapon.rotation = DEFAULT_WEAPON_GROUND_ROTATION_RAD
  weapon.isEquipped = false
  weapon.attackPhase = 'idle'
  weapon.attackElapsedMs = 0
  weapon.lastAttackTimestamp = 0
  weapon.attackStartTransform = {
    x: x,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.visual = {
    x: x,
    y: weaponY,
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
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.swingEndTransform = {
    x: x,
    y: weaponY,
    rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  }
  weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS

  entity.addComponent(weapon)

  return entity
}
