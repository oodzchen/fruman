import {
  MOBILE_BACKSTEP_KEY,
  MOBILE_FULL_JUMP_KEY,
  MOBILE_FULL_JUMP_LEFT_KEY,
  MOBILE_FULL_JUMP_RIGHT_KEY,
  MOBILE_ROLL_LEFT_KEY,
  MOBILE_ROLL_RIGHT_KEY,
} from './constants'
import type { RenderContext2D } from './renderer/RenderContext2D'
import type { MobileGrapplePhase } from './worker/protocol'

type MobileJumpInputKey =
  | typeof MOBILE_FULL_JUMP_KEY
  | typeof MOBILE_FULL_JUMP_LEFT_KEY
  | typeof MOBILE_FULL_JUMP_RIGHT_KEY

type MobileEvadeInputKey =
  | typeof MOBILE_ROLL_LEFT_KEY
  | typeof MOBILE_ROLL_RIGHT_KEY
  | typeof MOBILE_BACKSTEP_KEY

export type MobileInputKey =
  | MobileJumpInputKey
  | MobileEvadeInputKey
  | 'w'
  | 'a'
  | 's'
  | 'd'
  | 'shift'
  | 'j'
  | 'k'

export type MobileHudAction =
  | 'weapon-main'
  | 'weapon-secondary'
  | 'skill'
  | 'ultimate'

export const MOBILE_HUD_MAIN = 1 << 0
export const MOBILE_HUD_SECONDARY = 1 << 1
export const MOBILE_HUD_SKILL = 1 << 2
export const MOBILE_HUD_ULTIMATE = 1 << 3

interface MobileControlsCallbacks {
  onKeyChange: (key: MobileInputKey, pressed: boolean) => void
  onHudAction: (action: MobileHudAction, pressed: boolean) => void
  findGrappleAnchor: (x: number, y: number) => number
  onGrappleAnchor: (targetId: number, phase: MobileGrapplePhase) => void
  findInteractTarget: (x: number, y: number) => number
  onInteractTarget: (targetId: number) => void
  isRecoverActionAt: (x: number, y: number) => boolean
  onRecover: () => void
  findLockTarget: (x: number, y: number) => number
  onLockTarget: (targetId: number) => void
  onPause: () => void
}

const CONTROL_JOYSTICK = 0
const CONTROL_ATTACK = 1
const CONTROL_DEFENSE = 2
const CONTROL_PAUSE = 3
const CONTROL_WEAPON_MAIN = 4
const CONTROL_WEAPON_SECONDARY = 5
const CONTROL_SKILL = 6
const CONTROL_ULTIMATE = 7
const CONTROL_COUNT = 8
const FIRST_HUD_CONTROL = CONTROL_WEAPON_MAIN
const NO_POINTER = -1
const LAYOUT_SCALE = 100
const HUD_SLOT_SIZE = 46
const HUD_SLOT_SPACING = 14
const HUD_SLOT_MARGIN = 16
const HUD_SKILL_SIZE = 42
const HUD_SKILL_ULTIMATE_SPACING = 12
const HUD_ULTIMATE_SIZE = 52
const ACTION_BUTTON_RADIUS = 28
const ACTION_BUTTON_GAP = 14
const MOBILE_SMALL_SIDE = 450
const MAX_GESTURE_POINTERS = 2
const ACTION_SWIPE_MAX_DURATION_MS = 220
const ACTION_SWIPE_MIN_SPEED_PX_PER_SECOND = 320
const ACTION_SWIPE_CLASSIFY_DURATION_MS = 80
const GESTURE_PENDING = 0
const GESTURE_JUMP = 1
const GESTURE_EVADE = 2
const GESTURE_ACTION_NONE = 0
const GESTURE_ACTION_ATTACK = 1
const GESTURE_ACTION_DEFENSE = 2
const GESTURE_ACTION_LOCK_TARGET = 3
const GESTURE_ACTION_GRAPPLE = 4
const GESTURE_ACTION_INTERACT = 5
const GESTURE_ACTION_RECOVER = 6

const HUD_ACTIONS: ReadonlyArray<MobileHudAction> = [
  'weapon-main',
  'weapon-secondary',
  'skill',
  'ultimate',
]
const JOYSTICK_KEYS: ReadonlyArray<MobileInputKey> = [
  'w',
  'a',
  's',
  'd',
  'shift',
]

export function isMobileGameDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }
  if (navigator.maxTouchPoints <= 0) {
    return false
  }
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(hover: none)').matches
  )
}

export class MobileControls {
  private readonly target: HTMLElement
  private readonly callbacks: MobileControlsCallbacks
  private readonly previousTouchAction: string
  private readonly abortController = new AbortController()
  private readonly controlX = new Int32Array(CONTROL_COUNT)
  private readonly controlY = new Int32Array(CONTROL_COUNT)
  private readonly controlRadius = new Int32Array(CONTROL_COUNT)
  private readonly controlPointer = new Int32Array(CONTROL_COUNT)
  private readonly controlPressed = new Uint8Array(CONTROL_COUNT)
  private readonly controlAvailable = new Uint8Array(CONTROL_COUNT)
  private readonly joystickKeys = new Uint8Array(5)
  private readonly gesturePointer = new Int32Array(MAX_GESTURE_POINTERS)
  private readonly gestureStartX = new Int32Array(MAX_GESTURE_POINTERS)
  private readonly gestureStartY = new Int32Array(MAX_GESTURE_POINTERS)
  private readonly gestureStartTimeMs = new Float64Array(MAX_GESTURE_POINTERS)
  private readonly gestureState = new Uint8Array(MAX_GESTURE_POINTERS)
  private readonly gestureAction = new Uint8Array(MAX_GESTURE_POINTERS)
  private readonly gestureTargetId = new Int32Array(MAX_GESTURE_POINTERS)
  private enabled = false
  private dirty = true
  private canvasWidth = 0
  private canvasHeight = 0
  private boundsLeft = 0
  private boundsTop = 0
  private boundsScaleX1024 = 1024
  private boundsScaleY1024 = 1024
  private joystickThumbX = 0
  private joystickThumbY = 0
  private jumpPointerCount = 0
  private defensePointerCount = 0
  private attackDefenseGesturesEnabled = false
  private jumpInputKey: MobileJumpInputKey = MOBILE_FULL_JUMP_KEY

  constructor(target: HTMLElement, callbacks: MobileControlsCallbacks) {
    this.target = target
    this.callbacks = callbacks
    this.previousTouchAction = this.target.style.touchAction
    this.controlPointer.fill(NO_POINTER)
    this.gesturePointer.fill(NO_POINTER)
    this.gestureTargetId.fill(NO_POINTER)
    this.controlAvailable[CONTROL_JOYSTICK] = 1
    this.controlAvailable[CONTROL_ATTACK] = 1
    this.controlAvailable[CONTROL_DEFENSE] = 1
    this.controlAvailable[CONTROL_PAUSE] = 1
    this.target.style.touchAction = 'none'

    const options: AddEventListenerOptions = {
      capture: true,
      passive: false,
      signal: this.abortController.signal,
    }
    this.target.addEventListener(
      'pointerdown',
      (event) => this.handlePointerDown(event),
      options
    )
    this.target.addEventListener(
      'pointermove',
      (event) => this.handlePointerMove(event),
      options
    )
    this.target.addEventListener(
      'pointerup',
      (event) => this.handlePointerEnd(event),
      options
    )
    this.target.addEventListener(
      'pointercancel',
      (event) => this.handlePointerEnd(event),
      options
    )
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return
    }
    this.enabled = enabled
    if (!enabled) {
      this.resetPressedState(true)
    }
    this.dirty = true
  }

  setHudAvailability(flags: number): void {
    this.setControlAvailable(
      CONTROL_WEAPON_MAIN,
      (flags & MOBILE_HUD_MAIN) !== 0
    )
    this.setControlAvailable(
      CONTROL_WEAPON_SECONDARY,
      (flags & MOBILE_HUD_SECONDARY) !== 0
    )
    this.setControlAvailable(CONTROL_SKILL, (flags & MOBILE_HUD_SKILL) !== 0)
    this.setControlAvailable(
      CONTROL_ULTIMATE,
      (flags & MOBILE_HUD_ULTIMATE) !== 0
    )
  }

  setAttackDefenseGesturesEnabled(enabled: boolean): void {
    if (this.attackDefenseGesturesEnabled !== enabled) {
      this.attackDefenseGesturesEnabled = enabled
      for (let gesture = 0; gesture < MAX_GESTURE_POINTERS; gesture++) {
        const action = this.gestureAction[gesture]
        if (
          action === GESTURE_ACTION_ATTACK ||
          action === GESTURE_ACTION_DEFENSE
        ) {
          this.releaseGestureAction(gesture, true, false)
        }
      }
    }
    const buttonsEnabled = !enabled
    this.setControlAvailable(CONTROL_ATTACK, buttonsEnabled)
    this.setControlAvailable(CONTROL_DEFENSE, buttonsEnabled)
    this.dirty = true
  }

  resize(width: number, height: number): void {
    const nextWidth = width | 0
    const nextHeight = height | 0
    if (this.canvasWidth === nextWidth && this.canvasHeight === nextHeight) {
      return
    }
    this.canvasWidth = nextWidth
    this.canvasHeight = nextHeight
    this.layoutControls()
    this.dirty = true
  }

  isHudDirty(width: number, height: number): boolean {
    this.resize(width, height)
    return this.dirty
  }

  render(ctx: RenderContext2D): void {
    this.dirty = false
    if (!this.enabled) {
      return
    }

    if (this.controlPressed[CONTROL_JOYSTICK] !== 0) {
      this.drawJoystick(ctx)
    }
    if (!this.attackDefenseGesturesEnabled) {
      this.drawActionButton(ctx, CONTROL_DEFENSE)
      this.drawActionButton(ctx, CONTROL_ATTACK)
    }
    this.drawPauseButton(ctx)
    for (let control = FIRST_HUD_CONTROL; control < CONTROL_COUNT; control++) {
      if (this.controlPressed[control] !== 0) {
        this.drawHudPressedEffect(ctx, control)
      }
    }
  }

  reset(): void {
    this.resetPressedState(false)
  }

  destroy(): void {
    this.resetPressedState(true)
    this.abortController.abort()
    this.target.style.touchAction = this.previousTouchAction
  }

  private handlePointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!this.enabled) {
      return
    }

    this.syncPointerBounds()
    const x = this.toCanvasX(event.clientX)
    const y = this.toCanvasY(event.clientY)
    if (this.beginInteractionGesture(event, x, y)) {
      return
    }
    const control = this.findButtonAt(x, y)
    if (control < 0) {
      this.beginGesture(event, x, y)
      return
    }
    if (
      this.controlPointer[control] !== NO_POINTER ||
      this.controlAvailable[control] === 0
    ) {
      return
    }

    this.controlPointer[control] = event.pointerId
    this.target.setPointerCapture(event.pointerId)

    this.controlPressed[control] = 1
    this.dirty = true
    if (control === CONTROL_PAUSE) {
      this.callbacks.onPause()
      return
    }
    if (control >= FIRST_HUD_CONTROL) {
      this.callbacks.onHudAction(HUD_ACTIONS[control - FIRST_HUD_CONTROL], true)
      return
    }

    if (control === CONTROL_ATTACK) {
      this.callbacks.onKeyChange('j', true)
    } else if (control === CONTROL_DEFENSE) {
      this.callbacks.onKeyChange('k', true)
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return
    }
    const control = this.findControlByPointer(event.pointerId)
    const gesture =
      control < 0 ? this.findGestureByPointer(event.pointerId) : -1
    if (control < 0 && gesture < 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const x = this.toCanvasX(event.clientX)
    const y = this.toCanvasY(event.clientY)
    if (control === CONTROL_JOYSTICK) {
      this.updateJoystick(x, y)
    } else if (gesture >= 0) {
      this.updateGesture(gesture, x, y, Math.round(event.timeStamp))
    }
  }

  private handlePointerEnd(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return
    }
    const control = this.findControlByPointer(event.pointerId)
    const gesture =
      control < 0 ? this.findGestureByPointer(event.pointerId) : -1
    if (control < 0 && gesture < 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (control >= 0) {
      this.releaseControl(control, true)
    } else {
      this.releaseGesture(gesture, true, event.type === 'pointerup')
    }
  }

  private beginInteractionGesture(
    event: PointerEvent,
    x: number,
    y: number
  ): boolean {
    if (this.callbacks.isRecoverActionAt(x, y)) {
      this.beginGesture(event, x, y, GESTURE_ACTION_RECOVER)
      return true
    }
    const grappleAnchorId = this.callbacks.findGrappleAnchor(x, y)
    if (grappleAnchorId !== NO_POINTER) {
      this.beginGesture(event, x, y, GESTURE_ACTION_GRAPPLE, grappleAnchorId)
      return true
    }
    const interactTargetId = this.callbacks.findInteractTarget(x, y)
    if (interactTargetId !== NO_POINTER) {
      this.beginGesture(event, x, y, GESTURE_ACTION_INTERACT, interactTargetId)
      return true
    }
    const lockTargetId = this.callbacks.findLockTarget(x, y)
    if (lockTargetId === NO_POINTER) {
      return false
    }
    this.beginGesture(event, x, y, GESTURE_ACTION_LOCK_TARGET, lockTargetId)
    return true
  }

  private beginGesture(
    event: PointerEvent,
    x: number,
    y: number,
    action = GESTURE_ACTION_NONE,
    targetId = NO_POINTER
  ): void {
    const gesture = this.findAvailableGesture()
    if (gesture < 0) {
      return
    }
    this.gesturePointer[gesture] = event.pointerId
    this.gestureStartX[gesture] = x
    this.gestureStartY[gesture] = y
    this.gestureStartTimeMs[gesture] = Math.round(event.timeStamp)
    this.gestureState[gesture] = GESTURE_PENDING
    this.gestureAction[gesture] = action
    this.gestureTargetId[gesture] = targetId
    if (action === GESTURE_ACTION_GRAPPLE) {
      this.callbacks.onGrappleAnchor(targetId, 'press')
    } else if (action === GESTURE_ACTION_NONE) {
      this.beginScreenAction(gesture, x)
    }
    this.target.setPointerCapture(event.pointerId)
  }

  private beginScreenAction(gesture: number, x: number): void {
    if (!this.attackDefenseGesturesEnabled) {
      return
    }
    if (x < this.canvasWidth >> 1) {
      this.gestureAction[gesture] = GESTURE_ACTION_DEFENSE
      this.defensePointerCount++
      if (this.defensePointerCount === 1) {
        this.callbacks.onKeyChange('k', true)
      }
      return
    }
    this.gestureAction[gesture] = GESTURE_ACTION_ATTACK
  }

  private releaseGestureAction(
    gesture: number,
    emitRelease: boolean,
    triggerTap: boolean
  ): void {
    const action = this.gestureAction[gesture]
    const targetId = this.gestureTargetId[gesture]
    this.gestureAction[gesture] = GESTURE_ACTION_NONE
    this.gestureTargetId[gesture] = NO_POINTER
    if (
      action === GESTURE_ACTION_LOCK_TARGET &&
      emitRelease &&
      triggerTap &&
      targetId !== NO_POINTER
    ) {
      this.callbacks.onLockTarget(targetId)
      return
    }
    if (
      action === GESTURE_ACTION_INTERACT &&
      emitRelease &&
      triggerTap &&
      targetId !== NO_POINTER
    ) {
      this.callbacks.onInteractTarget(targetId)
      return
    }
    if (action === GESTURE_ACTION_RECOVER) {
      if (emitRelease && triggerTap) {
        this.callbacks.onRecover()
      }
      return
    }
    if (action === GESTURE_ACTION_GRAPPLE && targetId !== NO_POINTER) {
      this.callbacks.onGrappleAnchor(
        targetId,
        emitRelease && triggerTap ? 'release' : 'cancel'
      )
      return
    }
    this.releaseAction(action, emitRelease, triggerTap)
  }

  private releaseAction(
    action: number,
    emitRelease: boolean,
    triggerTap: boolean
  ): void {
    if (action === GESTURE_ACTION_DEFENSE) {
      this.defensePointerCount--
      if (emitRelease && this.defensePointerCount === 0) {
        this.callbacks.onKeyChange('k', false)
      }
      return
    }
    if (emitRelease && triggerTap && action === GESTURE_ACTION_ATTACK) {
      this.callbacks.onKeyChange('j', true)
      this.callbacks.onKeyChange('j', false)
    }
  }

  private cancelGestureActionForMovement(gesture: number): void {
    const action = this.gestureAction[gesture]
    if (
      action === GESTURE_ACTION_ATTACK ||
      action === GESTURE_ACTION_LOCK_TARGET ||
      action === GESTURE_ACTION_INTERACT ||
      action === GESTURE_ACTION_RECOVER
    ) {
      this.gestureAction[gesture] = GESTURE_ACTION_NONE
      this.gestureTargetId[gesture] = NO_POINTER
    } else if (action === GESTURE_ACTION_GRAPPLE) {
      const targetId = this.gestureTargetId[gesture]
      this.gestureAction[gesture] = GESTURE_ACTION_NONE
      this.gestureTargetId[gesture] = NO_POINTER
      if (targetId !== NO_POINTER) {
        this.callbacks.onGrappleAnchor(targetId, 'cancel')
      }
    } else if (
      action === GESTURE_ACTION_DEFENSE &&
      this.controlPointer[CONTROL_JOYSTICK] === NO_POINTER
    ) {
      this.releaseGestureAction(gesture, true, false)
    }
  }

  private updateGesture(
    gesture: number,
    pointerX: number,
    pointerY: number,
    eventTimeMs: number
  ): void {
    if (this.gestureState[gesture] !== GESTURE_PENDING) {
      return
    }

    const dx = pointerX - this.gestureStartX[gesture]
    const dy = pointerY - this.gestureStartY[gesture]
    const distanceSquared = dx * dx + dy * dy
    const joystickThreshold = this.getJoystickActivationThreshold()
    if (distanceSquared < joystickThreshold * joystickThreshold) {
      return
    }
    this.cancelGestureActionForMovement(gesture)

    const elapsedMs = Math.max(
      1,
      eventTimeMs - this.gestureStartTimeMs[gesture]
    )
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    const primaryDistance = Math.max(absDx, absDy)
    const swipeDistance = this.controlRadius[CONTROL_JOYSTICK]
    const upwardSwipe = dy < 0 && absDy >= absDx
    const downwardSwipe = dy > 0 && absDy >= absDx
    const horizontalSwipe = absDx > absDy
    const withinSwipeWindow = elapsedMs <= ACTION_SWIPE_MAX_DURATION_MS
    const fastSwipe =
      withinSwipeWindow &&
      primaryDistance >= swipeDistance &&
      primaryDistance * 1000 >= elapsedMs * ACTION_SWIPE_MIN_SPEED_PX_PER_SECOND
    if (fastSwipe) {
      if (upwardSwipe) {
        this.gestureState[gesture] = GESTURE_JUMP
        this.jumpPointerCount++
        if (this.jumpPointerCount === 1) {
          this.jumpInputKey = this.resolveJumpInputKey(dx, joystickThreshold)
          this.callbacks.onKeyChange(this.jumpInputKey, true)
        }
      } else if (downwardSwipe) {
        this.triggerEvadeGesture(gesture, MOBILE_BACKSTEP_KEY)
      } else if (horizontalSwipe) {
        this.triggerEvadeGesture(
          gesture,
          dx < 0 ? MOBILE_ROLL_LEFT_KEY : MOBILE_ROLL_RIGHT_KEY
        )
      }
      return
    }

    const mayBecomeFastSwipe =
      withinSwipeWindow &&
      primaryDistance < swipeDistance &&
      (elapsedMs < ACTION_SWIPE_CLASSIFY_DURATION_MS ||
        primaryDistance * 1000 >=
          elapsedMs * ACTION_SWIPE_MIN_SPEED_PX_PER_SECOND)
    if (mayBecomeFastSwipe) {
      return
    }
    if (this.controlPointer[CONTROL_JOYSTICK] !== NO_POINTER) {
      return
    }

    this.controlPointer[CONTROL_JOYSTICK] = this.gesturePointer[gesture]
    this.controlX[CONTROL_JOYSTICK] = this.gestureStartX[gesture]
    this.controlY[CONTROL_JOYSTICK] = this.gestureStartY[gesture]
    this.gesturePointer[gesture] = NO_POINTER
    this.updateJoystick(pointerX, pointerY)
  }

  private triggerEvadeGesture(gesture: number, key: MobileEvadeInputKey): void {
    this.gestureState[gesture] = GESTURE_EVADE
    this.callbacks.onKeyChange(key, true)
    this.callbacks.onKeyChange(key, false)
  }

  private releaseGesture(
    gesture: number,
    emitRelease: boolean,
    triggerTap: boolean
  ): void {
    this.gesturePointer[gesture] = NO_POINTER
    const state = this.gestureState[gesture]
    this.gestureState[gesture] = GESTURE_PENDING
    this.releaseGestureAction(
      gesture,
      emitRelease,
      triggerTap && state === GESTURE_PENDING
    )
    if (state !== GESTURE_JUMP) {
      return
    }
    this.jumpPointerCount--
    if (this.jumpPointerCount === 0) {
      if (emitRelease) {
        this.callbacks.onKeyChange(this.jumpInputKey, false)
      }
      this.jumpInputKey = MOBILE_FULL_JUMP_KEY
    }
  }

  private resolveJumpInputKey(
    dx: number,
    joystickThreshold: number
  ): MobileJumpInputKey {
    if (this.controlPressed[CONTROL_JOYSTICK] !== 0) {
      if (this.joystickKeys[1] !== 0) {
        return MOBILE_FULL_JUMP_LEFT_KEY
      }
      if (this.joystickKeys[3] !== 0) {
        return MOBILE_FULL_JUMP_RIGHT_KEY
      }
      return MOBILE_FULL_JUMP_KEY
    }
    const directionThreshold = Math.max(1, ((joystickThreshold * 3) / 5) | 0)
    if (dx <= -directionThreshold) {
      return MOBILE_FULL_JUMP_LEFT_KEY
    }
    if (dx >= directionThreshold) {
      return MOBILE_FULL_JUMP_RIGHT_KEY
    }
    return MOBILE_FULL_JUMP_KEY
  }

  private releaseControl(control: number, emitRelease: boolean): void {
    this.controlPointer[control] = NO_POINTER
    this.controlPressed[control] = 0
    this.dirty = true

    if (control === CONTROL_JOYSTICK) {
      this.resetJoystick(emitRelease)
      return
    }
    if (control === CONTROL_PAUSE) {
      return
    }
    if (control >= FIRST_HUD_CONTROL) {
      if (emitRelease) {
        this.callbacks.onHudAction(
          HUD_ACTIONS[control - FIRST_HUD_CONTROL],
          false
        )
      }
      return
    }

    if (!emitRelease) {
      return
    }
    if (control === CONTROL_ATTACK) {
      this.callbacks.onKeyChange('j', false)
    } else if (control === CONTROL_DEFENSE) {
      this.callbacks.onKeyChange('k', false)
    }
  }

  private updateJoystick(pointerX: number, pointerY: number): void {
    const radius = this.controlRadius[CONTROL_JOYSTICK]
    const dx = pointerX - this.controlX[CONTROL_JOYSTICK]
    const dy = pointerY - this.controlY[CONTROL_JOYSTICK]
    const threshold = this.getJoystickActivationThreshold()
    const distanceSquared = dx * dx + dy * dy
    const thresholdSquared = threshold * threshold
    if (
      this.controlPressed[CONTROL_JOYSTICK] === 0 &&
      distanceSquared < thresholdSquared
    ) {
      return
    }
    if (this.controlPressed[CONTROL_JOYSTICK] === 0) {
      this.controlPressed[CONTROL_JOYSTICK] = 1
      this.dirty = true
    }

    const thumbLimit = ((radius * 3) / 5) | 0
    const nextThumbX = this.clamp(dx, -thumbLimit, thumbLimit)
    const nextThumbY = this.clamp(dy, -thumbLimit, thumbLimit)
    if (
      this.joystickThumbX !== nextThumbX ||
      this.joystickThumbY !== nextThumbY
    ) {
      this.joystickThumbX = nextThumbX
      this.joystickThumbY = nextThumbY
      this.dirty = true
    }

    const moving = distanceSquared >= thresholdSquared
    const directionThreshold = ((threshold * 3) / 5) | 0
    const left = moving && dx < -directionThreshold
    const right = moving && dx > directionThreshold
    const up = moving && dy < -directionThreshold
    const down = moving && dy > directionThreshold
    const sprintThreshold = ((radius * 2) / 3) | 0
    const sprint =
      (left || right) && distanceSquared >= sprintThreshold * sprintThreshold
    this.setJoystickKey(0, 'w', up)
    this.setJoystickKey(1, 'a', left)
    this.setJoystickKey(2, 's', down)
    this.setJoystickKey(3, 'd', right)
    this.setJoystickKey(4, 'shift', sprint)
  }

  private getJoystickActivationThreshold(): number {
    const radius = this.controlRadius[CONTROL_JOYSTICK]
    return Math.max(18, ((radius * 2) / 5) | 0)
  }

  private resetJoystick(emitRelease: boolean): void {
    this.joystickThumbX = 0
    this.joystickThumbY = 0
    for (let i = 0; i < this.joystickKeys.length; i++) {
      if (this.joystickKeys[i] === 0) {
        continue
      }
      this.joystickKeys[i] = 0
      if (emitRelease) {
        this.callbacks.onKeyChange(JOYSTICK_KEYS[i], false)
      }
    }
    this.dirty = true
  }

  private setJoystickKey(
    index: number,
    key: MobileInputKey,
    pressed: boolean
  ): void {
    const next = pressed ? 1 : 0
    if (this.joystickKeys[index] === next) {
      return
    }
    this.joystickKeys[index] = next
    this.callbacks.onKeyChange(key, pressed)
  }

  private resetPressedState(emitRelease: boolean): void {
    for (let control = 0; control < CONTROL_COUNT; control++) {
      if (this.controlPointer[control] !== NO_POINTER) {
        this.releaseControl(control, emitRelease)
      }
    }
    for (let gesture = 0; gesture < MAX_GESTURE_POINTERS; gesture++) {
      if (this.gesturePointer[gesture] !== NO_POINTER) {
        this.releaseGesture(gesture, emitRelease, false)
      }
    }
    this.resetJoystick(emitRelease)
  }

  private setControlAvailable(control: number, available: boolean): void {
    const next = available ? 1 : 0
    if (this.controlAvailable[control] === next) {
      return
    }
    this.controlAvailable[control] = next
    if (!available && this.controlPointer[control] !== NO_POINTER) {
      this.releaseControl(control, true)
    }
  }

  private layoutControls(): void {
    const shortSide = Math.min(this.canvasWidth, this.canvasHeight)
    const scale = shortSide < MOBILE_SMALL_SIDE ? 84 : LAYOUT_SCALE
    this.controlRadius[CONTROL_JOYSTICK] = this.scaleValue(62, scale)

    const pauseRadius = this.scaleValue(22, scale)
    const bottomActionCenterY =
      this.canvasHeight - HUD_SLOT_MARGIN - (HUD_ULTIMATE_SIZE >> 1)
    this.setCircle(
      CONTROL_PAUSE,
      HUD_SLOT_MARGIN + pauseRadius,
      bottomActionCenterY,
      pauseRadius
    )

    const weaponTotalWidth = HUD_SLOT_SIZE * 2 + HUD_SLOT_SPACING
    const weaponStartX = this.canvasWidth - HUD_SLOT_MARGIN - weaponTotalWidth
    this.setCircle(
      CONTROL_WEAPON_MAIN,
      weaponStartX + (HUD_SLOT_SIZE >> 1),
      HUD_SLOT_MARGIN + (HUD_SLOT_SIZE >> 1),
      HUD_SLOT_SIZE >> 1
    )
    this.setCircle(
      CONTROL_WEAPON_SECONDARY,
      weaponStartX + HUD_SLOT_SIZE + HUD_SLOT_SPACING + (HUD_SLOT_SIZE >> 1),
      HUD_SLOT_MARGIN + (HUD_SLOT_SIZE >> 1),
      HUD_SLOT_SIZE >> 1
    )
    const ultimateX = this.canvasWidth >> 1
    const ultimateY = bottomActionCenterY
    this.setCircle(
      CONTROL_ULTIMATE,
      ultimateX,
      ultimateY,
      HUD_ULTIMATE_SIZE >> 1
    )
    this.setCircle(
      CONTROL_SKILL,
      ultimateX -
        (HUD_ULTIMATE_SIZE >> 1) -
        HUD_SKILL_ULTIMATE_SPACING -
        (HUD_SKILL_SIZE >> 1),
      ultimateY,
      HUD_SKILL_SIZE >> 1
    )
    const actionRadius = this.scaleValue(ACTION_BUTTON_RADIUS, scale)
    const attackX = this.canvasWidth - HUD_SLOT_MARGIN - actionRadius
    this.setCircle(CONTROL_ATTACK, attackX, bottomActionCenterY, actionRadius)
    this.setCircle(
      CONTROL_DEFENSE,
      attackX - (actionRadius << 1) - ACTION_BUTTON_GAP,
      bottomActionCenterY,
      actionRadius
    )
  }

  private setCircle(
    control: number,
    x: number,
    y: number,
    radius: number
  ): void {
    this.controlX[control] = x | 0
    this.controlY[control] = y | 0
    this.controlRadius[control] = radius | 0
  }

  private scaleValue(value: number, scale: number): number {
    return ((value * scale) / LAYOUT_SCALE) | 0
  }

  private findButtonAt(x: number, y: number): number {
    for (
      let control = CONTROL_COUNT - 1;
      control >= CONTROL_ATTACK;
      control--
    ) {
      if (this.controlAvailable[control] === 0) {
        continue
      }
      const dx = x - this.controlX[control]
      const dy = y - this.controlY[control]
      const radius = this.controlRadius[control]
      if (dx * dx + dy * dy <= radius * radius) {
        return control
      }
    }
    return -1
  }

  private findControlByPointer(pointerId: number): number {
    for (let control = 0; control < CONTROL_COUNT; control++) {
      if (this.controlPointer[control] === pointerId) {
        return control
      }
    }
    return -1
  }

  private findAvailableGesture(): number {
    for (let gesture = 0; gesture < MAX_GESTURE_POINTERS; gesture++) {
      if (this.gesturePointer[gesture] === NO_POINTER) {
        return gesture
      }
    }
    return -1
  }

  private findGestureByPointer(pointerId: number): number {
    for (let gesture = 0; gesture < MAX_GESTURE_POINTERS; gesture++) {
      if (this.gesturePointer[gesture] === pointerId) {
        return gesture
      }
    }
    return -1
  }

  private syncPointerBounds(): void {
    const rect = this.target.getBoundingClientRect()
    const width = Math.max(1, rect.width | 0)
    const height = Math.max(1, rect.height | 0)
    this.boundsLeft = rect.left | 0
    this.boundsTop = rect.top | 0
    this.boundsScaleX1024 = ((this.canvasWidth << 10) / width) | 0
    this.boundsScaleY1024 = ((this.canvasHeight << 10) / height) | 0
  }

  private toCanvasX(clientX: number): number {
    return (((clientX - this.boundsLeft) * this.boundsScaleX1024) >> 10) | 0
  }

  private toCanvasY(clientY: number): number {
    return (((clientY - this.boundsTop) * this.boundsScaleY1024) >> 10) | 0
  }

  private drawJoystick(ctx: RenderContext2D): void {
    const x = this.controlX[CONTROL_JOYSTICK]
    const y = this.controlY[CONTROL_JOYSTICK]
    const radius = this.controlRadius[CONTROL_JOYSTICK]
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(15, 13, 20, 0.24)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - radius + 18, y)
    ctx.lineTo(x + radius - 18, y)
    ctx.moveTo(x, y - radius + 18)
    ctx.lineTo(x, y + radius - 18)
    ctx.stroke()

    const pressed = this.controlPressed[CONTROL_JOYSTICK] !== 0
    const thumbRadius = (radius * 21) / 50
    ctx.fillStyle = pressed
      ? 'rgba(225, 190, 112, 0.34)'
      : 'rgba(255, 255, 255, 0.2)'
    ctx.strokeStyle = pressed
      ? 'rgba(255, 244, 210, 0.9)'
      : 'rgba(255, 255, 255, 0.5)'
    ctx.lineWidth = pressed ? 3 : 2
    ctx.beginPath()
    ctx.arc(
      x + this.joystickThumbX,
      y + this.joystickThumbY,
      thumbRadius,
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  private drawPauseButton(ctx: RenderContext2D): void {
    const radius = this.controlRadius[CONTROL_PAUSE]
    const x = this.controlX[CONTROL_PAUSE]
    const y = this.controlY[CONTROL_PAUSE]
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(15, 13, 20, 0.38)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
    this.drawPauseIcon(ctx, x, y, radius)
    ctx.restore()
  }

  private drawActionButton(ctx: RenderContext2D, control: number): void {
    const pressed = this.controlPressed[control] !== 0
    const radius = this.controlRadius[control] + (pressed ? 3 : 0)
    const x = this.controlX[control]
    const y = this.controlY[control]
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = pressed
      ? 'rgba(225, 190, 112, 0.3)'
      : 'rgba(15, 13, 20, 0.38)'
    ctx.strokeStyle = pressed
      ? 'rgba(255, 244, 210, 0.92)'
      : 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = pressed ? 3 : 2
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = pressed
      ? 'rgba(255, 255, 255, 1)'
      : 'rgba(255, 255, 255, 0.78)'
    if (control === CONTROL_ATTACK) {
      this.drawAttackIcon(ctx, x, y, radius, pressed)
    } else if (control === CONTROL_DEFENSE) {
      this.drawDefenseIcon(ctx, x, y, radius, pressed)
    }
    ctx.restore()
  }

  private drawAttackIcon(
    ctx: RenderContext2D,
    x: number,
    y: number,
    radius: number,
    pressed: boolean
  ): void {
    const unit = Math.max(2, (radius / 12) | 0)
    ctx.strokeStyle = pressed
      ? 'rgba(255, 244, 210, 1)'
      : 'rgba(255, 255, 255, 0.68)'
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, unit)
    ctx.beginPath()
    ctx.moveTo(x - unit * 8, y - unit * 3)
    ctx.quadraticCurveTo(x - unit, y - unit * 10, x + unit * 9, y - unit * 5)
    ctx.stroke()
    ctx.lineWidth = Math.max(1, unit - 1)
    ctx.beginPath()
    ctx.moveTo(x - unit * 6, y - unit * 6)
    ctx.quadraticCurveTo(x + unit, y - unit * 11, x + unit * 8, y - unit * 8)
    ctx.stroke()

    ctx.fillStyle = pressed
      ? 'rgba(255, 255, 255, 1)'
      : 'rgba(255, 255, 255, 0.86)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + unit * 7, y - unit * 7)
    ctx.lineTo(x + unit * 2, y - unit * 5)
    ctx.lineTo(x - unit * 4, y + unit)
    ctx.lineTo(x - unit * 2, y + unit * 3)
    ctx.lineTo(x + unit * 4, y - unit * 3)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.lineWidth = Math.max(2, unit)
    ctx.beginPath()
    ctx.moveTo(x - unit * 6, y)
    ctx.lineTo(x, y + unit * 6)
    ctx.stroke()
    ctx.lineWidth = Math.max(2, unit + 1)
    ctx.beginPath()
    ctx.moveTo(x - unit * 3, y + unit * 3)
    ctx.lineTo(x - unit * 6, y + unit * 6)
    ctx.stroke()
  }

  private drawDefenseIcon(
    ctx: RenderContext2D,
    x: number,
    y: number,
    radius: number,
    pressed: boolean
  ): void {
    const unit = Math.max(2, (radius / 10) | 0)
    ctx.fillStyle = pressed
      ? 'rgba(255, 244, 210, 0.52)'
      : 'rgba(255, 255, 255, 0.2)'
    ctx.strokeStyle = pressed
      ? 'rgba(255, 255, 255, 1)'
      : 'rgba(255, 255, 255, 0.82)'
    ctx.lineWidth = Math.max(2, unit)
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y - unit * 7)
    ctx.lineTo(x + unit * 6, y - unit * 5)
    ctx.lineTo(x + unit * 5, y + unit * 2)
    ctx.quadraticCurveTo(x + unit * 3, y + unit * 6, x, y + unit * 8)
    ctx.quadraticCurveTo(x - unit * 3, y + unit * 6, x - unit * 5, y + unit * 2)
    ctx.lineTo(x - unit * 6, y - unit * 5)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.lineWidth = Math.max(1, unit - 1)
    ctx.beginPath()
    ctx.moveTo(x, y - unit * 5)
    ctx.lineTo(x, y + unit * 5)
    ctx.stroke()
  }

  private drawPauseIcon(
    ctx: RenderContext2D,
    x: number,
    y: number,
    radius: number
  ): void {
    const barWidth = Math.max(3, radius >> 2)
    const barHeight = radius
    const gap = Math.max(2, radius >> 3)
    ctx.fillRect(x - gap - barWidth, y - (barHeight >> 1), barWidth, barHeight)
    ctx.fillRect(x + gap, y - (barHeight >> 1), barWidth, barHeight)
  }

  private drawHudPressedEffect(ctx: RenderContext2D, control: number): void {
    const radius = this.controlRadius[control] + 3
    const x = this.controlX[control]
    const y = this.controlY[control]
    ctx.save()
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(225, 190, 112, 0.12)'
    ctx.strokeStyle = 'rgba(255, 244, 210, 0.95)'
    ctx.lineWidth = 3
    if (
      control === CONTROL_WEAPON_MAIN ||
      control === CONTROL_WEAPON_SECONDARY
    ) {
      const size = radius << 1
      ctx.fillRect(x - radius, y - radius, size, size)
      ctx.strokeRect(x - radius, y - radius, size, size)
    } else {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  private clamp(value: number, min: number, max: number): number {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
