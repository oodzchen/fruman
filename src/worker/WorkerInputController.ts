import { DEFAULT_GRAPPLE_RANGE, GRAPPLE_LONG_PRESS_MS } from '../constants'
import type { Entity } from '../ecs/Entity'
import type { World } from '../ecs/World'
import type { StatsSystem } from '../ecs/systems/StatsSystem'
import type { WeaponSystem } from '../ecs/systems/WeaponSystem'
import { isRangedWeaponType } from '../weaponTypeUtils'
import type { CameraDirector } from './CameraDirector'

const GRAPPLE_TARGET_RANGE_SQ = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
const LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX = 30
const LOCK_SWITCH_MOUSE_SWIPE_WINDOW_MS = 180
const LOCK_SWITCH_MOUSE_IDLE_RESET_MS = 120
const LOCK_SWITCH_MOUSE_SWIPE_MIN_SPEED_PX_PER_SEC = 240

export class WorkerInputController {
  private world: World | null = null
  private playerEntity: Entity | null = null
  private weaponSystem: WeaponSystem | null = null
  private statsSystem: StatsSystem | null = null
  private cameraDirector: CameraDirector | null = null
  private playTimeMs = 0
  private triggerUltimateFlash: (() => void) | null = null
  private prevKeys = new Set<string>()
  private currKeys = new Set<string>()
  private prevMouseButtons = new Set<number>()
  private currMouseButtons = new Set<number>()
  private rHoldMs = 0
  private rHoldActive = false
  private rHoldTriggered = false
  private eUsedForUltimate = false
  private lockCancelOnReleaseArmed = false
  private lockSwitchAttemptedDuringHold = false
  private lockSwitchMouseSwipeStartMs = -1
  private lockSwitchMouseLastMoveMs = -1
  private lockSwitchMouseSwipeAccumX = 0
  private lockSwitchMouseSwipeAccumY = 0
  private lockSwitchMouseSwipeConsumed = false

  constructor(private readonly fixedStepMs: number) {}

  syncRuntime(
    world: World | null,
    playerEntity: Entity | null,
    weaponSystem: WeaponSystem | null,
    statsSystem: StatsSystem | null,
    cameraDirector: CameraDirector | null,
    playTimeMs: number,
    triggerUltimateFlash: (() => void) | null
  ): void {
    this.world = world
    this.playerEntity = playerEntity
    this.weaponSystem = weaponSystem
    this.statsSystem = statsSystem
    this.cameraDirector = cameraDirector
    this.playTimeMs = playTimeMs
    this.triggerUltimateFlash = triggerUltimateFlash
  }

  resetAll(): void {
    this.prevKeys.clear()
    this.currKeys.clear()
    this.prevMouseButtons.clear()
    this.currMouseButtons.clear()
    this.rHoldMs = 0
    this.rHoldActive = false
    this.rHoldTriggered = false
    this.eUsedForUltimate = false
    this.lockCancelOnReleaseArmed = false
    this.lockSwitchAttemptedDuringHold = false
    this.resetLockSwitchMouseSwipe()
  }

  updateHoldState(): void {
    const playerEntity = this.playerEntity
    if (this.rHoldActive && !this.rHoldTriggered) {
      if (!this.currKeys.has('r')) {
        this.rHoldActive = false
        this.rHoldTriggered = false
        this.rHoldMs = 0
      } else if (playerEntity?.input) {
        const isPlayerDead = playerEntity.stats?.isDead ?? false
        if (isPlayerDead) {
          this.rHoldActive = false
          this.rHoldTriggered = false
          this.rHoldMs = 0
        } else {
          this.rHoldMs += this.fixedStepMs
          if (this.rHoldMs >= GRAPPLE_LONG_PRESS_MS) {
            this.rHoldTriggered = true
            const canPersistGrapple =
              playerEntity.input.lockedTargetId !== null ||
              playerEntity.grapple?.hasAnchorNearby === true
            if (canPersistGrapple) {
              playerEntity.input.grapplePersistentRequested = true
              playerEntity.input.inputBuffer.bufferAction('grapple')
            }
          }
        }
      }
    }
  }

  handleInput(
    activeKeys: string[],
    activeMouseButtons: number[],
    mouseZoomTarget: number,
    mouseX: number,
    mouseY: number,
    mouseDeltaX: number,
    mouseDeltaY: number,
    mouseCaptured: boolean
  ): void {
    const playerEntity = this.playerEntity
    const weaponSystem = this.weaponSystem
    const cameraDirector = this.cameraDirector
    if (!playerEntity || !weaponSystem || !cameraDirector) {
      return
    }

    const temp = this.prevKeys
    this.prevKeys = this.currKeys
    this.currKeys = temp
    this.currKeys.clear()
    for (let i = 0; i < activeKeys.length; i++) {
      this.currKeys.add(activeKeys[i])
    }

    const tempMouse = this.prevMouseButtons
    this.prevMouseButtons = this.currMouseButtons
    this.currMouseButtons = tempMouse
    this.currMouseButtons.clear()
    for (let i = 0; i < activeMouseButtons.length; i++) {
      this.currMouseButtons.add(activeMouseButtons[i])
    }

    const isPlayerDead = playerEntity.stats?.isDead ?? false
    const isUltimateActive = playerEntity.weapon?.ultimatePhase != null

    if (playerEntity.input) {
      const eHeld = this.currKeys.has('e')
      let moveDirection = 0
      if (this.currKeys.has('a') || this.currKeys.has('arrowleft')) {
        moveDirection -= 1
      }
      if (this.currKeys.has('d') || this.currKeys.has('arrowright')) {
        moveDirection += 1
      }

      const isRangedEquipped = isRangedWeaponType(
        playerEntity.weapon?.weaponType
      )

      playerEntity.input.moveDirection =
        isPlayerDead || isUltimateActive ? 0 : moveDirection

      if (isUltimateActive) {
        playerEntity.input.attackRequested = false
        playerEntity.input.blockRequested = false
        playerEntity.input.jumpRequested = false
        playerEntity.input.sprintRequested = false
        playerEntity.input.grappleHoldRequested = false
        playerEntity.input.grapplePersistentRequested = false
        playerEntity.input.grappleBreakRequested = false
        playerEntity.input.freeAimToggleRequested = false
        playerEntity.input.inputBuffer.clearAll()
        this.lockCancelOnReleaseArmed = false
        this.lockSwitchAttemptedDuringHold = false
        this.resetLockSwitchMouseSwipe()
        if (!eHeld) {
          this.eUsedForUltimate = false
        }
        return
      }

      if (this.currKeys.has(' ') && !this.prevKeys.has(' ') && !isPlayerDead) {
        if (playerEntity.isStunned()) {
          playerEntity.input.inputBuffer.clearAll()
        }
        playerEntity.input.inputBuffer.bufferAction('jump')
        playerEntity.input.jumpRequested = true
      } else if (!this.currKeys.has(' ')) {
        playerEntity.input.jumpRequested = false
      }

      const attackJustPressed =
        (this.currKeys.has('j') && !this.prevKeys.has('j')) ||
        (this.currMouseButtons.has(0) && !this.prevMouseButtons.has(0))
      const attackHeld = this.currKeys.has('j') || this.currMouseButtons.has(0)

      playerEntity.input.attackRequested = attackHeld && !isPlayerDead

      const rightClickJustPressed =
        this.currMouseButtons.has(2) && !this.prevMouseButtons.has(2)
      const freeAimToggleJustPressed =
        this.currKeys.has('k') && !this.prevKeys.has('k')
      playerEntity.input.freeAimToggleRequested = false
      if (
        !isPlayerDead &&
        isRangedEquipped &&
        (rightClickJustPressed || freeAimToggleJustPressed)
      ) {
        playerEntity.input.freeAimToggleRequested = true
      }

      const blockPressed =
        (this.currMouseButtons.has(2) && !isRangedEquipped) ||
        (this.currKeys.has('k') && !isRangedEquipped)
      playerEntity.input.blockRequested = blockPressed && !isPlayerDead

      if (
        attackJustPressed &&
        !isPlayerDead &&
        !isRangedWeaponType(playerEntity.weapon?.weaponType)
      ) {
        weaponSystem.startAttack(playerEntity)
      }

      if (this.currKeys.has('f') && !this.prevKeys.has('f') && !isPlayerDead) {
        weaponSystem.handleSkillRequest(playerEntity)
      }

      this.handleLockInput(
        playerEntity,
        mouseCaptured,
        mouseDeltaX,
        mouseDeltaY
      )

      if (
        this.currKeys.has('control') &&
        !this.prevKeys.has('control') &&
        !isPlayerDead
      ) {
        if (playerEntity.isStunned()) {
          playerEntity.input.inputBuffer.clearAll()
        }
        playerEntity.input.inputBuffer.bufferAction('roll')
      }

      const shiftHeld = this.currKeys.has('shift')
      playerEntity.input.sprintRequested =
        shiftHeld && !isPlayerDead && !playerEntity.weapon?.bowFreeAim
      playerEntity.input.grappleHoldRequested = shiftHeld && !isPlayerDead
      playerEntity.input.grapplePersistentRequested = false
      playerEntity.input.grappleBreakRequested = false

      this.handleRKeyInput(playerEntity, isPlayerDead)
      this.handleUltimateAndInteractInput(playerEntity, isPlayerDead)

      if (this.currKeys.has('1') && !this.prevKeys.has('1') && !isPlayerDead) {
        weaponSystem.switchWeaponSlot(playerEntity, 'main')
      }

      if (this.currKeys.has('2') && !this.prevKeys.has('2') && !isPlayerDead) {
        weaponSystem.switchWeaponSlot(playerEntity, 'secondary')
      }

      let aimAdjust = 0
      const upHeld =
        this.currKeys.has('w') ||
        this.currKeys.has('arrowup') ||
        this.currKeys.has('ArrowUp')
      const downHeld =
        this.currKeys.has('s') ||
        this.currKeys.has('arrowdown') ||
        this.currKeys.has('ArrowDown')
      if (upHeld) {
        aimAdjust -= 1
      }
      if (downHeld) {
        aimAdjust += 1
      }
      playerEntity.input.grappleClimbHeld = upHeld ? -1 : downHeld ? 1 : 0
      playerEntity.input.freeAimAdjust = aimAdjust

      playerEntity.input.moveSpeedScale = playerEntity.weapon?.bowFreeAim
        ? 0.5
        : 1

      playerEntity.input.mouseAimActive = mouseCaptured
      if (mouseCaptured) {
        const prevMouseX = playerEntity.input.mouseScreenX
        const prevMouseY = playerEntity.input.mouseScreenY
        playerEntity.input.mouseAimMoved =
          mouseX !== prevMouseX || mouseY !== prevMouseY
        playerEntity.input.mouseScreenX = mouseX
        playerEntity.input.mouseScreenY = mouseY
        playerEntity.input.mouseAimX = cameraDirector.getMouseWorldX(mouseX)
        playerEntity.input.mouseAimY = cameraDirector.getMouseWorldY(mouseY)
      } else {
        playerEntity.input.mouseAimMoved = false
      }
    }

    cameraDirector.requestZoom(mouseZoomTarget)
  }

  private handleLockInput(
    playerEntity: Entity,
    mouseCaptured: boolean,
    mouseDeltaX: number,
    mouseDeltaY: number
  ): void {
    if (!playerEntity.input) {
      return
    }
    const qHeld = this.currKeys.has('q')
    const qJustPressed = qHeld && !this.prevKeys.has('q')
    const qJustReleased = !qHeld && this.prevKeys.has('q')
    const isLocked = playerEntity.input.lockedTargetId !== null
    const isPlayerDead = playerEntity.stats?.isDead ?? false

    if (isPlayerDead) {
      this.lockCancelOnReleaseArmed = false
      this.lockSwitchAttemptedDuringHold = false
      this.resetLockSwitchMouseSwipe()
    } else {
      if (qJustPressed) {
        this.resetLockSwitchMouseSwipe()
        if (isLocked) {
          this.lockCancelOnReleaseArmed = true
          this.lockSwitchAttemptedDuringHold = false
        } else {
          this.lockCancelOnReleaseArmed = false
          this.lockSwitchAttemptedDuringHold = false
          playerEntity.input.lockToggleRequested = true
        }
      }

      if (qHeld && isLocked) {
        this.updateLockSwitchSwipe(
          playerEntity,
          mouseCaptured,
          mouseDeltaX,
          mouseDeltaY
        )
      }

      if (qJustReleased) {
        if (
          this.lockCancelOnReleaseArmed &&
          !this.lockSwitchAttemptedDuringHold &&
          playerEntity.input.lockedTargetId !== null
        ) {
          playerEntity.input.lockToggleRequested = true
        }
        this.lockCancelOnReleaseArmed = false
        this.lockSwitchAttemptedDuringHold = false
        this.resetLockSwitchMouseSwipe()
      }
    }
  }

  private updateLockSwitchSwipe(
    playerEntity: Entity,
    mouseCaptured: boolean,
    mouseDeltaX: number,
    mouseDeltaY: number
  ): void {
    if (!playerEntity.input) {
      return
    }
    let switchX = 0
    let switchY = 0

    if (mouseCaptured && (mouseDeltaX !== 0 || mouseDeltaY !== 0)) {
      const mouseMoveTimeMs = this.playTimeMs
      if (this.lockSwitchMouseSwipeConsumed) {
        const idleMs =
          this.lockSwitchMouseLastMoveMs >= 0
            ? mouseMoveTimeMs - this.lockSwitchMouseLastMoveMs
            : LOCK_SWITCH_MOUSE_IDLE_RESET_MS
        if (idleMs >= LOCK_SWITCH_MOUSE_IDLE_RESET_MS) {
          this.resetLockSwitchMouseSwipe()
        } else {
          this.lockSwitchMouseLastMoveMs = mouseMoveTimeMs
        }
      }

      if (!this.lockSwitchMouseSwipeConsumed) {
        if (
          this.lockSwitchMouseSwipeStartMs < 0 ||
          mouseMoveTimeMs - this.lockSwitchMouseSwipeStartMs >
            LOCK_SWITCH_MOUSE_SWIPE_WINDOW_MS
        ) {
          this.lockSwitchMouseSwipeStartMs = mouseMoveTimeMs
          this.lockSwitchMouseSwipeAccumX = 0
          this.lockSwitchMouseSwipeAccumY = 0
        }

        this.lockSwitchMouseSwipeAccumX += mouseDeltaX
        this.lockSwitchMouseSwipeAccumY += mouseDeltaY
        this.lockSwitchMouseLastMoveMs = mouseMoveTimeMs

        const swipeAbsX = Math.abs(this.lockSwitchMouseSwipeAccumX)
        const swipeAbsY = Math.abs(this.lockSwitchMouseSwipeAccumY)
        if (
          swipeAbsX >= LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX ||
          swipeAbsY >= LOCK_SWITCH_MOUSE_SWIPE_THRESHOLD_PX
        ) {
          const dominantSwipeAbs =
            swipeAbsX >= swipeAbsY ? swipeAbsX : swipeAbsY
          const swipeElapsedMs =
            mouseMoveTimeMs - this.lockSwitchMouseSwipeStartMs
          const speedElapsedMs =
            swipeElapsedMs > 0 ? swipeElapsedMs : this.fixedStepMs
          const hasEnoughSwipeSpeed =
            dominantSwipeAbs * 1000 >=
            LOCK_SWITCH_MOUSE_SWIPE_MIN_SPEED_PX_PER_SEC * speedElapsedMs

          if (hasEnoughSwipeSpeed) {
            if (swipeAbsX >= swipeAbsY) {
              switchX = this.lockSwitchMouseSwipeAccumX > 0 ? 1 : -1
            } else {
              switchY = this.lockSwitchMouseSwipeAccumY > 0 ? 1 : -1
            }
            this.lockSwitchMouseSwipeStartMs = -1
            this.lockSwitchMouseSwipeAccumX = 0
            this.lockSwitchMouseSwipeAccumY = 0
            this.lockSwitchMouseSwipeConsumed = true
          }
        }
      }
    }

    if (switchX !== 0 || switchY !== 0) {
      playerEntity.input.lockSwitchIntentX = switchX
      playerEntity.input.lockSwitchIntentY = switchY
      this.lockSwitchAttemptedDuringHold = true
    }
  }

  private handleRKeyInput(playerEntity: Entity, isPlayerDead: boolean): void {
    if (!playerEntity.input) {
      return
    }
    const rPressed = this.currKeys.has('r')
    const rJustPressed = rPressed && !this.prevKeys.has('r')
    const rJustReleased = !rPressed && this.prevKeys.has('r')

    if (rJustPressed) {
      if (!isPlayerDead) {
        this.rHoldActive = true
        this.rHoldTriggered = false
        this.rHoldMs = 0
      } else {
        this.rHoldActive = false
        this.rHoldTriggered = false
        this.rHoldMs = 0
      }
    }

    if (rJustReleased) {
      if (this.rHoldActive && !this.rHoldTriggered && !isPlayerDead) {
        const g = playerEntity.grapple
        const shouldBreakGrapple = g && g.isTethering
        const shouldGrapple =
          g &&
          (g.isPulling ||
            g.isTethering ||
            g.hasAnchorNearby ||
            this.canGrappleLockedTarget(playerEntity))
        if (shouldBreakGrapple) {
          playerEntity.input.grappleBreakRequested = true
          playerEntity.input.inputBuffer.bufferAction('grapple')
        } else if (shouldGrapple) {
          playerEntity.input.inputBuffer.bufferAction('grapple')
        } else {
          this.tryConsumeLargeSunPickup(playerEntity)
        }
      }
      this.rHoldActive = false
      this.rHoldTriggered = false
      this.rHoldMs = 0
    }
  }

  private handleUltimateAndInteractInput(
    playerEntity: Entity,
    isPlayerDead: boolean
  ): void {
    if (!playerEntity.input || !this.weaponSystem || !this.cameraDirector) {
      return
    }
    const eHeld = this.currKeys.has('e')
    const eJustPressed = eHeld && !this.prevKeys.has('e')
    const eJustReleased = !eHeld && this.prevKeys.has('e')
    const middleHeld = this.currMouseButtons.has(1)
    const middleJustPressed = middleHeld && !this.prevMouseButtons.has(1)

    const ultimateJustTriggered =
      ((eJustPressed && middleHeld) || (middleJustPressed && eHeld)) &&
      !isPlayerDead
    if (ultimateJustTriggered) {
      this.eUsedForUltimate = true
      const ultSlot = playerEntity.attackSlots?.ultimate
      const isBlocked =
        (ultSlot?.cooldownRemainingMs ?? 0) > 0 ||
        playerEntity.weapon?.ultimatePhase != null
      if (isBlocked) this.triggerUltimateFlash?.()
      const viewHalfWidth = this.cameraDirector.getViewHalfWidth()
      this.weaponSystem.handleUltimateRequest(playerEntity, viewHalfWidth)
    } else {
      if (eJustReleased && !isPlayerDead) {
        if (!this.eUsedForUltimate) {
          playerEntity.input.inputBuffer.bufferAction('interact')
        }
        this.eUsedForUltimate = false
      }
      if (middleJustPressed && !isPlayerDead) {
        playerEntity.input.inputBuffer.bufferAction('grapple')
      }
    }
  }

  private tryConsumeLargeSunPickup(playerEntity: Entity): void {
    const solar = playerEntity.solarEnergy
    const isGrounded = playerEntity.movement?.isGrounded ?? false
    const stats = playerEntity.stats
    if (
      solar &&
      solar.largeCount > 0 &&
      stats &&
      isGrounded &&
      stats.healingMs <= 0
    ) {
      solar.largeCount--
      stats.healingMs = 500
      stats.hudVisibleTimer = stats.combatExitTimeout
      if (playerEntity.transform && this.statsSystem) {
        this.statsSystem.emitHeal(
          playerEntity.transform.x,
          playerEntity.transform.y,
          playerEntity.render?.renderLayer ?? 0
        )
      }
    }
  }

  private canGrappleLockedTarget(player: Entity): boolean {
    const world = this.world
    if (!world || !player.input || !player.grapple || !player.transform) {
      return false
    }
    if (!player.grapple.hasGrapple) {
      return false
    }

    const targetId = player.input.lockedTargetId
    if (targetId === null) {
      return false
    }

    const target = world.getEntityById(targetId)
    if (
      !target ||
      target.id === player.id ||
      !target.transform ||
      (target.stats !== undefined &&
        (target.stats.isDead || target.stats.isVanished))
    ) {
      return false
    }

    const hasBody =
      target.grappleAnchor !== undefined ||
      target.physics !== undefined ||
      (target.grappleTarget !== undefined && target.grappleTarget.canPull)
    if (!hasBody) {
      return false
    }

    if (
      (target.render?.renderLayer ?? 0) !== (player.render?.renderLayer ?? 0)
    ) {
      return false
    }

    const dx = target.transform.x - player.transform.x
    const dy = target.transform.y - player.transform.y
    return dx * dx + dy * dy <= GRAPPLE_TARGET_RANGE_SQ
  }

  private resetLockSwitchMouseSwipe(): void {
    this.lockSwitchMouseSwipeStartMs = -1
    this.lockSwitchMouseLastMoveMs = -1
    this.lockSwitchMouseSwipeAccumX = 0
    this.lockSwitchMouseSwipeAccumY = 0
    this.lockSwitchMouseSwipeConsumed = false
  }
}
