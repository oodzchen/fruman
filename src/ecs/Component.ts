import { InputBuffer } from '../inputBuffer'
import type { b2BodyId, b2ShapeId } from '../types'
import { componentRegistry } from './ComponentRegistry'

export abstract class Component {
  abstract getName(): string

  getType(): number {
    return componentRegistry.getComponentType(this.getName())
  }
}

export class TransformComponent extends Component {
  x = 0
  y = 0
  rotation = 0

  getName(): string {
    return 'Transform'
  }
}

export class PhysicsComponent extends Component {
  bodyId!: b2BodyId
  shapeId!: b2ShapeId

  getName(): string {
    return 'Physics'
  }
}

export class MovementComponent extends Component {
  moveSpeed = 0
  jumpForce = 0
  maxJumpDuration = 0
  jumpForceMultiplier = 0
  wallJumpPushAwayMultiplier = 0
  wallJumpUpwardMultiplier = 0
  maxWallJumps = 0

  isGrounded = false
  isTouchingWall = false
  wallDirection = 0
  wallJumpCount = 0
  wallJumpTime = 0

  isJumping = false
  jumpStartTime = 0

  lastContactUpdate = 0
  contactUpdateIntervalMs = 16

  baseWeight = 0
  carryWeight = 0

  getName(): string {
    return 'Movement'
  }
}

export class InputComponent extends Component {
  moveDirection = 0
  jumpRequested = false
  attackRequested = false

  lastMoveDirection = 0
  inputBuffer = new InputBuffer()

  getName(): string {
    return 'Input'
  }
}

export class RenderComponent extends Component {
  radius = 0.5
  color = '#4CAF50'
  borderColor = '#FFD700'
  visible = true

  getName(): string {
    return 'Render'
  }
}

export type WeaponTransform = { x: number; y: number; rotation: number }
export type WeaponRelativeTransform = {
  dx: number
  dy: number
  rotation: number
}

export class WeaponComponent extends Component {
  width = 0
  height = 0
  cornerRadius = 0
  weight = 0
  isColliding = false
  position = { x: 0, y: 0 }
  rotation = 0
  isEquipped = false
  isInCombat = false
  attackPhase:
    | 'idle'
    | 'windup'
    | 'swing'
    | 'pause'
    | 'resetHead'
    | 'headHold'
    | 'recover'
    | 'finalWindup' = 'idle'
  attackElapsedMs = 0
  lastAttackTimestamp = 0
  attackStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  visual: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  attackQueued = false
  comboCount = 0
  swingDirection: 'toFront' | 'toHead' = 'toFront'
  nextSwingDirection: 'toFront' | 'toHead' = 'toFront'
  attackFacing = 1
  attackStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingEndOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  swingEndTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  attackRadius = 0

  getName(): string {
    return 'Weapon'
  }
}

export enum Faction {
  Player = 'player',
  Enemy = 'enemy',
  Neutral = 'neutral',
}

export class FactionComponent extends Component {
  faction: Faction = Faction.Neutral

  getName(): string {
    return 'Faction'
  }

  canAttack(other: FactionComponent): boolean {
    if (this.faction === Faction.Neutral || other.faction === Faction.Neutral) {
      return false
    }
    if (this.faction === Faction.Player && other.faction === Faction.Player) {
      return false
    }
    return this.faction !== other.faction
  }
}
