import {
  DEBUG_DRAW_CAMERA,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_PLAYER_RADIUS,
} from '../constants'
import type { Entity } from '../ecs/Entity'
import type { World } from '../ecs/World'
import type { EditorMapData } from '../editorMapTypes'
import type { MainModule } from '../types'
import type { CameraDebugData } from './protocol'

export const DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y = 0.8
export const DEFAULT_CAMERA_TIME_SCALE_1000 = 1000

const TRANSITION_DURATION = 3
const VERTICAL_TRANSITION_DURATION = 6
const UNLOCK_COOLDOWN = 0.2
const OUTSIDE_THIRD_RELOCK_DELAY = 0.15
const CAMERA_FORWARD_OFFSET = 0.67
const HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOCK_SCREEN_RATIO = 0.5
const VERTICAL_FOLLOW_LERP = 0.08
const VERTICAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOOK_AHEAD_TIME = 0.18
const VERTICAL_LOOK_AHEAD_MAX = 1.2
const VERTICAL_LOOK_AHEAD_LERP = 0.2
const ULTIMATE_CAMERA_SCREEN_RATIO_Y = 0.62
const ULTIMATE_CAMERA_SWORD_ZOOM = 0.5
const ULTIMATE_CAMERA_SPEAR_ZOOM = 0.48
const ULTIMATE_CAMERA_HAMMER_ZOOM = 0.42
const HAMMER_ULTIMATE_CAMERA_FOCUS_OFFSET_Y = 4
const ASSASSINATION_CAMERA_ZOOM = 1.45
const ASSASSINATION_CAMERA_FOCUS_OFFSET_Y = 1
const ASSASSINATION_TIME_SCALE_1000 = 250
const TIME_STEP = 1 / 60

type UltimatePhase = NonNullable<Entity['weapon']>['ultimatePhase']

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function isHammerUltimatePhase(
  phase: UltimatePhase | null | undefined
): boolean {
  return typeof phase === 'string' && phase.startsWith('hammer_')
}

function isSpearUltimatePhase(
  phase: UltimatePhase | null | undefined
): boolean {
  return typeof phase === 'string' && phase.startsWith('spear_')
}

export class CameraDirector {
  readonly camera = { x: 0, y: 0 }

  private box2d: MainModule | null = null
  private world: World | null = null
  private playerEntity: Entity | null = null
  private canvasWidth = 0
  private canvasHeight = 0
  private pixelsPerMeter = 50
  private currentTime = 0
  private isThumbnailCameraCapture = false

  private zoom = DEFAULT_CAMERA_ZOOM
  private requestedZoom = DEFAULT_CAMERA_ZOOM
  private targetZoom = DEFAULT_CAMERA_ZOOM
  private timeScale1000 = DEFAULT_CAMERA_TIME_SCALE_1000

  private isCameraLocked = false
  private isTransitioning = false
  private transitionStartTime = 0
  private transitionStartCameraX = 0
  private lastVelocityDirection = 0
  private needsReturnToCenter = false
  private lastUnlockTime = 0
  private outOfCenterTime = 0
  private horizontalForceCenterAfterEmergency = false

  private isVerticalCameraLocked = false
  private isVerticalTransitioning = false
  private verticalTransitionStartTime = 0
  private verticalTransitionStartCameraY = 0
  private verticalOutOfCenterTime = 0
  private lastVerticalUnlockTime = 0
  private initialPlayerScreenRatioY =
    DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y
  private verticalLookAheadOffsetY = 0
  private verticalForceCenterAfterEmergency = false

  private ultimateCameraActive = false
  private ultimateCameraTargetX = 0
  private ultimateCameraTargetY = 0
  private ultimateCameraTargetZoom = DEFAULT_CAMERA_ZOOM

  constructor(private readonly debugCameraData: CameraDebugData) {}

  syncRuntime(
    box2d: MainModule,
    world: World,
    playerEntity: Entity | null,
    canvasWidth: number,
    canvasHeight: number,
    pixelsPerMeter: number,
    currentTime: number,
    isThumbnailCameraCapture: boolean
  ): void {
    this.box2d = box2d
    this.world = world
    this.playerEntity = playerEntity
    this.canvasWidth = canvasWidth
    this.canvasHeight = canvasHeight
    this.pixelsPerMeter = pixelsPerMeter
    this.currentTime = currentTime
    this.isThumbnailCameraCapture = isThumbnailCameraCapture
  }

  getZoom(): number {
    return this.zoom
  }

  getTimeScale1000(): number {
    return this.timeScale1000
  }

  requestZoom(nextZoom: number): void {
    this.requestedZoom = nextZoom
  }

  getViewHalfWidth(): number {
    return Math.round(this.canvasWidth / (this.pixelsPerMeter * this.zoom) / 2)
  }

  getMouseWorldX(mouseX: number): number {
    const anchorX = this.canvasWidth * 0.5
    const invZoom = 1 / this.zoom
    const camPxX = this.camera.x * this.pixelsPerMeter
    const worldPxX = (mouseX - anchorX) * invZoom + anchorX + camPxX
    return worldPxX / this.pixelsPerMeter
  }

  getMouseWorldY(mouseY: number): number {
    const anchorY = this.canvasHeight
    const invZoom = 1 / this.zoom
    const camPxY = this.camera.y * this.pixelsPerMeter
    const worldPxY = (mouseY - anchorY) * invZoom + anchorY + camPxY
    return worldPxY / this.pixelsPerMeter
  }

  setSnapshot(x: number, y: number, zoom: number): void {
    this.camera.x = x
    this.camera.y = y
    this.zoom = zoom
    this.requestedZoom = zoom
    this.targetZoom = zoom
  }

  resetAllState(): void {
    this.isCameraLocked = false
    this.isTransitioning = false
    this.transitionStartTime = 0
    this.transitionStartCameraX = 0
    this.lastVelocityDirection = 0
    this.needsReturnToCenter = false
    this.lastUnlockTime = 0
    this.outOfCenterTime = 0
    this.horizontalForceCenterAfterEmergency = false

    this.isVerticalCameraLocked = false
    this.isVerticalTransitioning = false
    this.verticalTransitionStartTime = 0
    this.verticalTransitionStartCameraY = 0
    this.verticalOutOfCenterTime = 0
    this.lastVerticalUnlockTime = 0
    this.initialPlayerScreenRatioY =
      DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y
    this.verticalLookAheadOffsetY = 0
    this.verticalForceCenterAfterEmergency = false

    this.ultimateCameraActive = false
    this.ultimateCameraTargetX = 0
    this.ultimateCameraTargetY = 0
    this.ultimateCameraTargetZoom = DEFAULT_CAMERA_ZOOM
    this.timeScale1000 = DEFAULT_CAMERA_TIME_SCALE_1000
  }

  initializeDefaultCamera(): void {
    this.setSnapshot(0, 0, DEFAULT_CAMERA_ZOOM)
    const player = this.playerEntity
    if (!player?.transform) {
      return
    }
    const centerX = this.canvasWidth / 2
    this.camera.x = player.transform.x - centerX / this.pixelsPerMeter
    this.camera.y = 0
    this.initialPlayerScreenRatioY =
      DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y
    this.isCameraLocked = true
  }

  applyMapCamera(map: EditorMapData): void {
    const zoomValue =
      map.camera.zoom > 0 && Number.isFinite(map.camera.zoom)
        ? map.camera.zoom
        : DEFAULT_CAMERA_ZOOM

    this.setSnapshot(map.camera.x, map.camera.y, zoomValue)

    if (this.isThumbnailCameraCapture) {
      this.applyThumbnailCaptureCamera()
      return
    }

    const isDefaultCamera =
      Math.abs(map.camera.x) < 0.01 &&
      Math.abs(map.camera.y) < 0.01 &&
      Math.abs(map.camera.zoom - 1) < 0.01
    const player = this.playerEntity

    if (isDefaultCamera && player?.transform) {
      const centerX = this.canvasWidth / 2
      this.camera.x = player.transform.x - centerX / this.pixelsPerMeter
      this.initialPlayerScreenRatioY =
        DEFAULT_CAMERA_INITIAL_PLAYER_SCREEN_RATIO_Y
      this.isCameraLocked = true
      this.isVerticalCameraLocked = false
      this.verticalLookAheadOffsetY = 0
      this.verticalForceCenterAfterEmergency = false
      return
    }

    this.isCameraLocked = false
    this.isVerticalCameraLocked = false
    this.verticalLookAheadOffsetY = 0
    this.verticalForceCenterAfterEmergency = false
  }

  applyThumbnailCaptureCamera(): void {
    const player = this.playerEntity
    if (!player?.transform) {
      return
    }

    const centerX = this.canvasWidth / 2
    const canvasHeightInMeters = this.canvasHeight / this.pixelsPerMeter
    const playerRadius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const playerFeetY = player.transform.y + playerRadius

    this.camera.x = player.transform.x - centerX / this.pixelsPerMeter
    this.camera.y =
      playerFeetY -
      canvasHeightInMeters * ((VERTICAL_LOCK_SCREEN_RATIO - 1) / this.zoom + 1)

    this.isCameraLocked = false
    this.isTransitioning = false
    this.needsReturnToCenter = false
    this.outOfCenterTime = 0
    this.horizontalForceCenterAfterEmergency = false

    this.isVerticalCameraLocked = false
    this.isVerticalTransitioning = false
    this.verticalOutOfCenterTime = 0
    this.verticalLookAheadOffsetY = 0
    this.verticalForceCenterAfterEmergency = false
  }

  syncTimeScaleState(): void {
    const weapon = this.playerEntity?.weapon
    if (
      weapon &&
      weapon.assassinationPhase !== null &&
      weapon.assassinationTargetId > 0
    ) {
      this.setTimeScale1000(ASSASSINATION_TIME_SCALE_1000)
      return
    }
    this.setTimeScale1000(DEFAULT_CAMERA_TIME_SCALE_1000)
  }

  syncUltimateCameraState(): void {
    const weapon = this.playerEntity?.weapon
    const phase = weapon?.ultimatePhase
    const hasAssassinationCamera =
      weapon?.assassinationPhase !== null &&
      (weapon?.assassinationTargetId ?? 0) > 0
    if ((phase === null || phase === undefined) && !hasAssassinationCamera) {
      if (this.ultimateCameraActive) {
        this.ultimateCameraActive = false
        this.resetCameraTrackingState()
      }
      return
    }

    if (!this.ultimateCameraActive) {
      this.activateUltimateCamera()
      return
    }

    if (!this.updateUltimateCameraTarget()) {
      this.ultimateCameraActive = false
      this.resetCameraTrackingState()
    }
  }

  updateZoom(): void {
    this.targetZoom = this.ultimateCameraActive
      ? this.ultimateCameraTargetZoom
      : this.requestedZoom
    const zoomDiff = this.targetZoom - this.zoom
    if (Math.abs(zoomDiff) > 0.001) {
      this.zoom += zoomDiff * 0.15
    } else {
      this.zoom = this.targetZoom
    }
  }

  update(): void {
    const player = this.playerEntity
    const world = this.world
    const box2d = this.box2d
    if (!player?.transform || !world || !box2d) {
      return
    }
    if (this.isThumbnailCameraCapture) {
      this.applyThumbnailCaptureCamera()
      return
    }
    const playerX = player.transform.x

    if (this.ultimateCameraActive) {
      if (!this.updateUltimateCameraTarget()) {
        this.ultimateCameraActive = false
        this.resetCameraTrackingState()
      } else {
        const diffX = this.ultimateCameraTargetX - this.camera.x
        if (Math.abs(diffX) > 0.001) {
          this.camera.x += diffX * 0.15
        } else {
          this.camera.x = this.ultimateCameraTargetX
        }

        const diffY = this.ultimateCameraTargetY - this.camera.y
        if (Math.abs(diffY) > 0.001) {
          this.camera.y += diffY * 0.12
        } else {
          this.camera.y = this.ultimateCameraTargetY
        }

        if (DEBUG_DRAW_CAMERA) {
          const radius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
          const playerFeetY = player.transform.y + radius
          const playerScreenY =
            this.canvasHeight +
            ((playerFeetY - this.camera.y) * this.pixelsPerMeter -
              this.canvasHeight) *
              this.zoom
          this.debugCameraData.topLimitRatio =
            1 - ULTIMATE_CAMERA_SCREEN_RATIO_Y
          this.debugCameraData.bottomLimitRatio = ULTIMATE_CAMERA_SCREEN_RATIO_Y
          this.debugCameraData.playerScreenY = playerScreenY
          this.debugCameraData.playerFeetY = playerFeetY
          this.debugCameraData.cameraY = this.camera.y
          this.debugCameraData.zoom = this.zoom
          this.debugCameraData.isOutsideVerticalZone = false
        }

        return
      }
    }

    const canvasWidthInMeters =
      this.canvasWidth / (this.pixelsPerMeter * this.zoom)
    let isNpcLocked = false
    let targetEntityX = 0

    if (player.input && player.input.lockedTargetId !== null) {
      const targetEntity = world.getEntityById(player.input.lockedTargetId)
      if (targetEntity?.transform) {
        const dist = Math.abs(targetEntity.transform.x - playerX)
        if (dist > canvasWidthInMeters * 0.9) {
          player.input.lockedTargetId = null
        } else {
          targetEntityX = targetEntity.transform.x
          isNpcLocked = true
        }
      }
    }

    const centerX = this.canvasWidth / 2
    let desiredCameraX = this.camera.x

    if (isNpcLocked) {
      const midPointX = (playerX + targetEntityX) * 0.5
      desiredCameraX = midPointX - centerX / this.pixelsPerMeter
    } else {
      const currentCameraX = this.camera.x
      const playerScreenX =
        centerX +
        ((playerX - currentCameraX) * this.pixelsPerMeter - centerX) * this.zoom

      const leftThird = this.canvasWidth / 3
      const rightThird = (2 * this.canvasWidth) / 3
      const isOutsideCenterZone =
        playerScreenX < leftThird || playerScreenX > rightThird
      const edgeMargin = this.canvasWidth * 0.1
      const isNearEdge =
        playerScreenX < edgeMargin ||
        playerScreenX > this.canvasWidth - edgeMargin
      const isInCenterZone = !isOutsideCenterZone

      if (this.isCameraLocked) {
        this.outOfCenterTime = 0
      } else if (isOutsideCenterZone) {
        this.outOfCenterTime += TIME_STEP
      } else {
        this.outOfCenterTime = 0
      }

      if (this.needsReturnToCenter && isInCenterZone) {
        this.needsReturnToCenter = false
      }

      if (!this.isCameraLocked) {
        const timeSinceUnlock = this.currentTime - this.lastUnlockTime
        const canRelockWhileReturning =
          !this.needsReturnToCenter ||
          this.outOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY
        const normalLockCondition =
          canRelockWhileReturning && timeSinceUnlock > UNLOCK_COOLDOWN
        const emergencyLock = isNearEdge

        if (isOutsideCenterZone && (normalLockCondition || emergencyLock)) {
          this.isCameraLocked = true
          this.isTransitioning = true
          this.transitionStartTime = this.currentTime
          this.transitionStartCameraX = this.camera.x

          if (emergencyLock) {
            this.needsReturnToCenter = false
          }

          if (player.physics) {
            const vel = box2d.b2Body_GetLinearVelocity(player.physics.bodyId)
            this.lastVelocityDirection =
              vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
            vel.delete()
          }
        }
      }

      if (this.isCameraLocked && player.physics) {
        const vel = box2d.b2Body_GetLinearVelocity(player.physics.bodyId)
        const speed = Math.abs(vel.x)
        const currentDirection = vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
        vel.delete()

        if (!this.horizontalForceCenterAfterEmergency) {
          if (speed < 0.1 && !this.isTransitioning) {
            this.isCameraLocked = false
            this.lastVelocityDirection = 0
            this.needsReturnToCenter = true
            this.lastUnlockTime = this.currentTime
          } else if (
            this.lastVelocityDirection !== 0 &&
            currentDirection !== 0
          ) {
            if (this.lastVelocityDirection !== currentDirection) {
              this.isCameraLocked = false
              this.isTransitioning = false
              this.lastVelocityDirection = 0
              this.needsReturnToCenter = true
              this.lastUnlockTime = this.currentTime
            } else {
              this.lastVelocityDirection = currentDirection
            }
          } else if (
            currentDirection !== 0 &&
            this.lastVelocityDirection === 0
          ) {
            this.lastVelocityDirection = currentDirection
          }
        } else if (speed < 0.1) {
          this.lastVelocityDirection = 0
        } else if (currentDirection !== 0) {
          this.lastVelocityDirection = currentDirection
        }
      }

      if (this.isCameraLocked) {
        const forwardOffset = this.lastVelocityDirection * CAMERA_FORWARD_OFFSET
        if (this.isTransitioning) {
          const elapsed = this.currentTime - this.transitionStartTime
          const progress = Math.min(elapsed / TRANSITION_DURATION, 1)

          if (progress >= 1) {
            this.isTransitioning = false
            desiredCameraX =
              playerX + forwardOffset - centerX / this.pixelsPerMeter
          } else {
            const targetX =
              playerX + forwardOffset - centerX / this.pixelsPerMeter
            const easedProgress = easeOutCubic(progress)
            desiredCameraX =
              this.transitionStartCameraX +
              (targetX - this.transitionStartCameraX) * easedProgress
          }
        } else {
          desiredCameraX =
            playerX + forwardOffset - centerX / this.pixelsPerMeter
        }
      } else {
        desiredCameraX = currentCameraX
      }
    }

    const diffX = desiredCameraX - this.camera.x
    if (Math.abs(diffX) > 0.001) {
      this.camera.x += diffX * 0.15
    } else {
      this.camera.x = desiredCameraX
    }

    this.applyHorizontalEmergencyClamp(player, playerX, centerX)
    this.updateVerticalCamera(player, box2d)
  }

  private setTimeScale1000(nextScale1000: number): void {
    if (!Number.isFinite(nextScale1000)) {
      this.timeScale1000 = DEFAULT_CAMERA_TIME_SCALE_1000
      return
    }
    if (nextScale1000 < 1) {
      this.timeScale1000 = 1
      return
    }
    if (nextScale1000 > 4000) {
      this.timeScale1000 = 4000
      return
    }
    this.timeScale1000 = Math.round(nextScale1000)
  }

  private resetCameraTrackingState(): void {
    this.isCameraLocked = false
    this.isTransitioning = false
    this.transitionStartTime = 0
    this.transitionStartCameraX = this.camera.x
    this.lastVelocityDirection = 0
    this.needsReturnToCenter = false
    this.lastUnlockTime = this.currentTime
    this.outOfCenterTime = 0
    this.horizontalForceCenterAfterEmergency = false

    this.isVerticalCameraLocked = false
    this.isVerticalTransitioning = false
    this.verticalTransitionStartTime = 0
    this.verticalTransitionStartCameraY = this.camera.y
    this.verticalOutOfCenterTime = 0
    this.lastVerticalUnlockTime = this.currentTime
    this.verticalLookAheadOffsetY = 0
    this.verticalForceCenterAfterEmergency = false
  }

  private updateUltimateCameraTarget(): boolean {
    const player = this.playerEntity
    const world = this.world
    if (!player?.transform || !player.weapon || !world) {
      return false
    }

    const weapon = player.weapon
    const assassinationTargetId = weapon.assassinationTargetId
    if (weapon.assassinationPhase !== null && assassinationTargetId > 0) {
      const target = world.getEntityById(assassinationTargetId)
      if (!target?.transform) {
        return false
      }
      const radius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const targetRadius = target.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const focusX = (player.transform.x + target.transform.x) * 0.5
      const focusY =
        (player.transform.y + radius + (target.transform.y + targetRadius)) *
          0.5 -
        ASSASSINATION_CAMERA_FOCUS_OFFSET_Y
      const canvasHeightInMeters = this.canvasHeight / this.pixelsPerMeter
      this.ultimateCameraTargetZoom = Math.max(
        this.requestedZoom,
        ASSASSINATION_CAMERA_ZOOM
      )
      this.ultimateCameraTargetX =
        focusX - this.canvasWidth / (this.pixelsPerMeter * 2)
      this.ultimateCameraTargetY =
        focusY -
        canvasHeightInMeters *
          ((ULTIMATE_CAMERA_SCREEN_RATIO_Y - 1) /
            this.ultimateCameraTargetZoom +
            1)
      return true
    }

    const phase = weapon.ultimatePhase
    if (phase === null) {
      return false
    }

    const radius = player.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const playerFeetY = player.transform.y + radius
    let focusX = player.transform.x
    let focusY = playerFeetY
    let zoomTarget = this.requestedZoom

    if (isHammerUltimatePhase(phase)) {
      focusX = (player.transform.x + weapon.ultimateHammerLandX) * 0.5
      focusY = playerFeetY - HAMMER_ULTIMATE_CAMERA_FOCUS_OFFSET_Y
      zoomTarget = Math.min(this.requestedZoom, ULTIMATE_CAMERA_HAMMER_ZOOM)
    } else if (isSpearUltimatePhase(phase)) {
      focusX = (player.transform.x + weapon.ultimateSpearCrossX) * 0.5
      zoomTarget = Math.min(this.requestedZoom, ULTIMATE_CAMERA_SPEAR_ZOOM)
    } else {
      focusX = (player.transform.x + weapon.ultimateGiantX) * 0.5
      zoomTarget = Math.min(this.requestedZoom, ULTIMATE_CAMERA_SWORD_ZOOM)
    }

    const canvasHeightInMeters = this.canvasHeight / this.pixelsPerMeter
    this.ultimateCameraTargetZoom = zoomTarget
    this.ultimateCameraTargetX =
      focusX - this.canvasWidth / (this.pixelsPerMeter * 2)
    this.ultimateCameraTargetY =
      focusY -
      canvasHeightInMeters *
        ((ULTIMATE_CAMERA_SCREEN_RATIO_Y - 1) / this.ultimateCameraTargetZoom +
          1)
    return true
  }

  private activateUltimateCamera(): void {
    if (!this.updateUltimateCameraTarget()) {
      this.ultimateCameraActive = false
      return
    }
    this.ultimateCameraActive = true
    this.resetCameraTrackingState()
  }

  private applyHorizontalEmergencyClamp(
    player: Entity,
    playerX: number,
    centerX: number
  ): void {
    if (!player.transform) {
      return
    }
    const currentCameraX = this.camera.x
    const playerScreenX =
      centerX +
      ((playerX - currentCameraX) * this.pixelsPerMeter - centerX) * this.zoom
    const leftLimit = this.canvasWidth / 3
    const rightLimit = (2 * this.canvasWidth) / 3
    let didEmergencyClamp = false

    if (playerScreenX < leftLimit) {
      const targetScreenX = leftLimit
      this.camera.x =
        playerX -
        ((targetScreenX - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      didEmergencyClamp = true
    } else if (playerScreenX > rightLimit) {
      const targetScreenX = rightLimit
      this.camera.x =
        playerX -
        ((targetScreenX - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      this.isCameraLocked = true
      this.isTransitioning = true
      this.transitionStartTime = this.currentTime
      this.transitionStartCameraX = this.camera.x
      this.outOfCenterTime = 0
      this.horizontalForceCenterAfterEmergency = true
      this.needsReturnToCenter = false
    }

    if (
      this.isCameraLocked &&
      !this.isTransitioning &&
      this.horizontalForceCenterAfterEmergency
    ) {
      const centerScreenX = 0.5 * this.canvasWidth
      const centerDelta = Math.abs(playerScreenX - centerScreenX)
      const centerEpsilon =
        HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO * this.canvasWidth
      if (centerDelta <= centerEpsilon) {
        this.isCameraLocked = false
        this.lastUnlockTime = this.currentTime
        this.outOfCenterTime = 0
        this.horizontalForceCenterAfterEmergency = false
        this.needsReturnToCenter = false
        this.lastVelocityDirection = 0
      }
    }
  }

  private updateVerticalCamera(player: Entity, box2d: MainModule): void {
    const canvasHeightInMeters = this.canvasHeight / this.pixelsPerMeter
    let desiredCameraY = this.camera.y
    const bottomLimitRatio = this.initialPlayerScreenRatioY
    const topLimitRatio = 1 - bottomLimitRatio
    const topLimit = topLimitRatio * this.canvasHeight
    const bottomLimit = bottomLimitRatio * this.canvasHeight

    if (player.transform) {
      const playerY = player.transform.y
      const playerFeetY = playerY + DEFAULT_PLAYER_RADIUS
      const currentCameraY = this.camera.y
      let playerVelocityY = 0
      if (player.physics) {
        const vel = box2d.b2Body_GetLinearVelocity(player.physics.bodyId)
        playerVelocityY = vel.y
        vel.delete()
      }

      const playerScreenY =
        this.canvasHeight +
        ((playerFeetY - currentCameraY) * this.pixelsPerMeter -
          this.canvasHeight) *
          this.zoom

      const isOutsideVerticalZone =
        playerScreenY < topLimit || playerScreenY > bottomLimit

      if (DEBUG_DRAW_CAMERA) {
        this.debugCameraData.topLimitRatio = topLimitRatio
        this.debugCameraData.bottomLimitRatio = bottomLimitRatio
        this.debugCameraData.playerScreenY = playerScreenY
        this.debugCameraData.playerFeetY = playerFeetY
        this.debugCameraData.cameraY = currentCameraY
        this.debugCameraData.zoom = this.zoom
        this.debugCameraData.isOutsideVerticalZone = isOutsideVerticalZone
      }

      if (this.isVerticalCameraLocked) {
        this.verticalOutOfCenterTime = 0
      } else if (isOutsideVerticalZone) {
        this.verticalOutOfCenterTime += TIME_STEP
      } else {
        this.verticalOutOfCenterTime = 0
      }

      if (!this.isVerticalCameraLocked) {
        const timeSinceUnlock = this.currentTime - this.lastVerticalUnlockTime

        if (
          isOutsideVerticalZone &&
          this.verticalOutOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY &&
          timeSinceUnlock > UNLOCK_COOLDOWN
        ) {
          this.isVerticalCameraLocked = true
          this.isVerticalTransitioning = true
          this.verticalTransitionStartTime = this.currentTime
          this.verticalTransitionStartCameraY = this.camera.y
          this.verticalForceCenterAfterEmergency = false
        }
      }

      const lookAheadTarget = Math.max(
        -VERTICAL_LOOK_AHEAD_MAX,
        Math.min(
          VERTICAL_LOOK_AHEAD_MAX,
          playerVelocityY * VERTICAL_LOOK_AHEAD_TIME
        )
      )
      this.verticalLookAheadOffsetY +=
        (lookAheadTarget - this.verticalLookAheadOffsetY) *
        VERTICAL_LOOK_AHEAD_LERP

      if (this.isVerticalCameraLocked || this.isVerticalTransitioning) {
        const trackedFeetY = playerFeetY + this.verticalLookAheadOffsetY
        const targetY =
          trackedFeetY -
          canvasHeightInMeters *
            ((VERTICAL_LOCK_SCREEN_RATIO - 1) / this.zoom + 1)

        if (this.isVerticalTransitioning) {
          const elapsed = this.currentTime - this.verticalTransitionStartTime
          const progress = Math.min(elapsed / VERTICAL_TRANSITION_DURATION, 1)

          if (progress >= 1) {
            this.isVerticalTransitioning = false
            desiredCameraY = targetY
          } else {
            const eased = easeOutCubic(progress)
            desiredCameraY =
              this.verticalTransitionStartCameraY +
              (targetY - this.verticalTransitionStartCameraY) * eased
          }
        } else {
          desiredCameraY = targetY
        }
      } else {
        desiredCameraY = currentCameraY
      }
    }

    const diffY = desiredCameraY - this.camera.y
    if (Math.abs(diffY) > 0.001) {
      this.camera.y += diffY * VERTICAL_FOLLOW_LERP
    } else {
      this.camera.y = desiredCameraY
    }

    this.applyVerticalEmergencyClamp(
      player,
      canvasHeightInMeters,
      topLimit,
      bottomLimit,
      topLimitRatio,
      bottomLimitRatio
    )
  }

  private applyVerticalEmergencyClamp(
    player: Entity,
    canvasHeightInMeters: number,
    topLimit: number,
    bottomLimit: number,
    topLimitRatio: number,
    bottomLimitRatio: number
  ): void {
    if (!player.transform) {
      return
    }
    let didEmergencyClamp = false
    const playerFeetY = player.transform.y + DEFAULT_PLAYER_RADIUS
    const currentCameraY = this.camera.y
    const playerScreenY =
      this.canvasHeight +
      ((playerFeetY - currentCameraY) * this.pixelsPerMeter -
        this.canvasHeight) *
        this.zoom

    if (playerScreenY < topLimit) {
      const ratio = topLimitRatio
      this.camera.y =
        playerFeetY - canvasHeightInMeters * ((ratio - 1) / this.zoom + 1)
      didEmergencyClamp = true
    } else if (playerScreenY > bottomLimit) {
      const ratio = bottomLimitRatio
      this.camera.y =
        playerFeetY - canvasHeightInMeters * ((ratio - 1) / this.zoom + 1)
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      this.isVerticalCameraLocked = true
      this.isVerticalTransitioning = true
      this.verticalTransitionStartTime = this.currentTime
      this.verticalTransitionStartCameraY = this.camera.y
      this.verticalOutOfCenterTime = 0
      this.verticalForceCenterAfterEmergency = true
    }

    if (this.isVerticalCameraLocked && !this.isVerticalTransitioning) {
      if (!this.verticalForceCenterAfterEmergency) {
        const isInsideVerticalZone =
          playerScreenY >= topLimit && playerScreenY <= bottomLimit
        if (isInsideVerticalZone) {
          this.isVerticalCameraLocked = false
          this.lastVerticalUnlockTime = this.currentTime
          this.verticalOutOfCenterTime = 0
        }
      } else {
        const centerScreenY = VERTICAL_LOCK_SCREEN_RATIO * this.canvasHeight
        const centerDelta = Math.abs(playerScreenY - centerScreenY)
        const centerEpsilon =
          VERTICAL_CENTER_UNLOCK_EPSILON_RATIO * this.canvasHeight
        if (centerDelta <= centerEpsilon) {
          this.isVerticalCameraLocked = false
          this.lastVerticalUnlockTime = this.currentTime
          this.verticalOutOfCenterTime = 0
          this.verticalForceCenterAfterEmergency = false
        }
      }
      if (!this.isVerticalCameraLocked) {
        this.verticalForceCenterAfterEmergency = false
        this.isVerticalCameraLocked = false
      }
    }
  }
}
