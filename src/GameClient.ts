import { AudioManager } from './AudioManager'
import { ClientRenderer } from './ClientRenderer'
import { localizer } from './Localizer'
import { MenuManager, MenuMode } from './MenuManager'
import type { EditorMapData } from './editorMapTypes'
import { PatternCreator } from './renderer/PatternCreator'
import { ShapeRenderer } from './renderer/ShapeRenderer'
import GameWorker from './worker/gameWorker?worker'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  WorkerInputMessage,
  WorkerToMainMessage,
} from './worker/protocol'

export class GameClient {
  private worker: Worker
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private renderer: ClientRenderer
  private audioManager: AudioManager
  private menuManager: MenuManager
  private pixelsPerMeter = 50

  private camera = { x: 0, y: 0 }
  private renderFps = 0
  private fpsText = '0 FPS'
  private lastTime = 0
  private lastDeltaTime = 0
  private frameCount = 0
  private fpsUpdateTime = 0

  private hasReceivedFirstState = false
  private isFirstFrameRendered = false
  private onFirstFrameRendered?: () => void

  // Input State
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private keysArray: string[] = []
  private mouseButtonsArray: number[] = []
  private targetZoom = 1.0
  private renderZoom = 1.0
  private mouseX = 0
  private mouseY = 0
  private mouseCaptured = false
  private mouseInside = false
  private inputEnabled = true
  private editorOverlay: HTMLDivElement | null = null
  private previewActionsContainer: HTMLDivElement | null = null
  private previewExitBtn: HTMLButtonElement | null = null
  private previewPauseBtn: HTMLButtonElement | null = null
  private previewActive = false
  private onExitPreviewCallback?: () => void
  private cameraDebug: CameraDebugData & { enabled: boolean } = {
    topLimitRatio: 0.5,
    bottomLimitRatio: 0.95,
    playerScreenY: 0,
    playerFeetY: 0,
    cameraY: 0,
    zoom: 1,
    isOutsideVerticalZone: false,
    enabled: false,
  }

  // Reusable message object for input
  private inputMessage: WorkerInputMessage = {
    type: 'input',
    keys: [],
    mouseButtons: [],
    mouseZoom: 1.0,
    mouseX: 0,
    mouseY: 0,
    mouseCaptured: false,
  }

  // Cached bound functions
  private boundRenderLoop: (timestamp?: number) => void
  private boundHandleWorkerMessage: (
    e: MessageEvent<WorkerToMainMessage>
  ) => void

  // Static Environment (Mirrored from constants/logic)
  private groundPattern: CanvasPattern | null = null
  private obstaclePattern: CanvasPattern | null = null
  private backgroundPattern: CanvasPattern | null = null

  private groundHeight = 0.5
  private groundY = 0
  private groundTopY = 0
  private editorPreview = false
  private currentMapData: EditorMapData | null = null

  constructor(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    menuOverlay: HTMLDivElement,
    onInitProgress?: (step: string) => void
  ) {
    this.canvas = canvas
    this.ctx = ctx
    this.renderer = new ClientRenderer(ctx, this.pixelsPerMeter)
    this.audioManager = new AudioManager()
    this.menuManager = new MenuManager(canvas, menuOverlay)
    this.renderer.setAudioManager(this.audioManager)
    const editorOverlay = document.getElementById('editorOverlay')
    this.editorOverlay =
      editorOverlay instanceof HTMLDivElement ? editorOverlay : null

    const previewActions = document.getElementById('previewActions')
    this.previewActionsContainer =
      previewActions instanceof HTMLDivElement ? previewActions : null

    const previewExitBtn = document.getElementById('previewExitBtn')
    this.previewExitBtn =
      previewExitBtn instanceof HTMLButtonElement ? previewExitBtn : null
    if (this.previewExitBtn) {
      this.previewExitBtn.textContent = localizer.t('editor_exit_preview')
      this.previewExitBtn.addEventListener('click', () => {
        this.exitPreview()
      })
    }

    const previewPauseBtn = document.getElementById('previewPauseBtn')
    this.previewPauseBtn =
      previewPauseBtn instanceof HTMLButtonElement ? previewPauseBtn : null
    if (this.previewPauseBtn) {
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
      this.previewPauseBtn.addEventListener('click', () => {
        this.togglePreviewPause()
      })
    }

    onInitProgress?.(localizer.t('init_renderer'))

    // Cache bound functions once
    this.boundRenderLoop = this.renderLoop.bind(this)
    this.boundHandleWorkerMessage = this.handleWorkerMessage.bind(this)

    // Initialize Patterns
    onInitProgress?.(localizer.t('init_textures'))
    this.backgroundPattern = PatternCreator.createBackgroundPattern(this.ctx)
    this.groundPattern = PatternCreator.createGroundPattern(this.ctx)
    this.obstaclePattern = PatternCreator.createObstaclePattern(this.ctx)

    this.renderFps = 0
    this.fpsText = `${this.renderFps} FPS`

    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    this.groundY = canvasHeightInMeters - this.groundHeight
    this.groundTopY = this.groundY - this.groundHeight

    // Initialize Worker
    onInitProgress?.(localizer.t('init_game_logic'))
    this.worker = new GameWorker()
    this.worker.onmessage = this.boundHandleWorkerMessage

    // Send Init
    this.worker.postMessage({
      type: 'init',
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      pixelsPerMeter: this.pixelsPerMeter,
    } as MainToWorkerMessage)

    onInitProgress?.(localizer.t('init_input'))
    this.setupInput()
    this.setupAudioResume()

    onInitProgress?.(localizer.t('init_audio'))
    this.audioManager.init().catch((error) => {
      console.error('Failed to initialize audio:', error)
    })

    // Start Render Loop
    requestAnimationFrame(this.boundRenderLoop)
  }

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled
  }

  setEditorPreview(enabled: boolean) {
    this.editorPreview = enabled
    if (enabled) {
      this.camera.x = 0
      this.camera.y = 0
      this.targetZoom = 1
      this.renderZoom = 1
      this.cameraDebug.enabled = false
      this.setPreviewExitVisible(false)
    }
  }

  applyMapPreview(map: EditorMapData) {
    this.setEditorPreview(false)
    this.previewActive = true
    this.setPreviewExitVisible(true)
    this.currentMapData = map

    if (map.camera && map.camera.zoom > 0 && Number.isFinite(map.camera.zoom)) {
      this.targetZoom = map.camera.zoom
      this.renderZoom = map.camera.zoom
    }

    this.worker.postMessage({
      type: 'map_preview',
      map,
    } as MainToWorkerMessage)
  }

  private setupAudioResume() {
    let hasUnlockedAudio = false
    const passiveListenerOptions: AddEventListenerOptions = { passive: true }
    const resume = () => {
      if (hasUnlockedAudio) return
      hasUnlockedAudio = true
      this.audioManager.resumeContext()
      window.removeEventListener('keydown', resume)
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('touchstart', resume)
    }
    window.addEventListener('keydown', resume)
    window.addEventListener('pointerdown', resume, passiveListenerOptions)
    window.addEventListener('touchstart', resume, passiveListenerOptions)
  }

  private handleWorkerMessage(e: MessageEvent<WorkerToMainMessage>) {
    const msg = e.data
    if (msg.type === 'state') {
      // Pass raw buffer to renderer, no decoding here to save Main Thread CPU/GC
      this.renderer.updateState(msg.entitiesBuffer, msg.entityCount)
      this.renderer.applyEffects(msg.entitiesBuffer, msg.effectsCount)
      this.camera.x = msg.camera.x
      this.camera.y = msg.camera.y
      this.renderZoom = msg.zoom
      this.renderer.setCamera(this.camera.x, this.camera.y, this.renderZoom)
      this.releaseStateBuffer(msg.entitiesBuffer)
      this.hasReceivedFirstState = true
    } else if (msg.type === 'debug') {
      this.renderer.setSensorDebugData(msg.sensors)
      this.renderer.setSoundDebugData(msg.soundWaves, msg.soundListeners)
      if (msg.camera) {
        this.cameraDebug.topLimitRatio = msg.camera.topLimitRatio
        this.cameraDebug.bottomLimitRatio = msg.camera.bottomLimitRatio
        this.cameraDebug.playerScreenY = msg.camera.playerScreenY
        this.cameraDebug.playerFeetY = msg.camera.playerFeetY
        this.cameraDebug.cameraY = msg.camera.cameraY
        this.cameraDebug.zoom = msg.camera.zoom
        this.cameraDebug.isOutsideVerticalZone =
          msg.camera.isOutsideVerticalZone
        this.cameraDebug.enabled = true
      } else {
        this.cameraDebug.enabled = false
      }
    } else if (msg.type === 'map_data') {
      this.currentMapData = msg.map
      if (
        msg.map.camera &&
        msg.map.camera.zoom > 0 &&
        Number.isFinite(msg.map.camera.zoom)
      ) {
        this.targetZoom = msg.map.camera.zoom
        this.renderZoom = msg.map.camera.zoom
      }
    }
  }

  private releaseStateBuffer(buffer: ArrayBuffer | SharedArrayBuffer) {
    if (this.isSharedBuffer(buffer)) {
      return
    }
    this.worker.postMessage({ type: 'buffer_release', buffer }, [buffer])
  }

  private isSharedBuffer(
    buffer: ArrayBuffer | SharedArrayBuffer
  ): buffer is SharedArrayBuffer {
    return (
      typeof SharedArrayBuffer !== 'undefined' &&
      buffer instanceof SharedArrayBuffer
    )
  }
  private setupInput() {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase()

      if (key === 'escape') {
        if (this.isEditorOverlayVisible()) {
          return
        }
        e.preventDefault()
        if (this.menuManager.isVisible()) {
          this.menuManager.hide()
          this.start()
          this.inputEnabled = true
        } else {
          this.stop()
          this.menuManager.show(MenuMode.Pause)
          this.inputEnabled = false
        }
        return
      }

      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }

      // Prevent browser default behavior for game keys (scrolling, tab switching, etc.)
      if (
        [
          'arrowup',
          'arrowdown',
          'arrowleft',
          'arrowright',
          ' ',
          'w',
          'a',
          's',
          'd',
        ].includes(key)
      ) {
        e.preventDefault()
      }

      this.keys.add(key)
      this.sendInput()

      // Local Zoom control (immediate feedback)
      if (e.key.toLowerCase() === 'i') {
        this.targetZoom = Math.max(0.1, this.targetZoom + 0.2)
        this.sendInput()
      } else if (e.key.toLowerCase() === 'o') {
        this.targetZoom = Math.max(0.1, this.targetZoom - 0.2)
        this.sendInput()
      } else if (e.key.toLowerCase() === 'u') {
        this.targetZoom = 1.0
        this.sendInput()
      }
    })

    window.addEventListener('keyup', (e) => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      this.keys.delete(e.key.toLowerCase())
      this.sendInput()
    })

    window.addEventListener('mousedown', (e) => {
      if (
        e.button === 2 &&
        !this.isEditorOverlayVisible() &&
        (document.pointerLockElement === this.canvas ||
          this.isPointInCanvas(e.clientX, e.clientY))
      ) {
        e.preventDefault()
      }
      if (
        this.menuManager.isVisible() ||
        !this.inputEnabled ||
        this.isEditorOverlayVisible()
      ) {
        return
      }
      this.mouseButtons.add(e.button)
      this.sendInput()
    })

    window.addEventListener('mouseup', (e) => {
      if (
        this.menuManager.isVisible() ||
        !this.inputEnabled ||
        this.isEditorOverlayVisible()
      ) {
        return
      }
      this.mouseButtons.delete(e.button)
      this.sendInput()
    })

    window.addEventListener('blur', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      this.resetInputState()
    })

    document.addEventListener('visibilitychange', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      if (document.hidden) {
        this.resetInputState()
      }
    })

    this.canvas.addEventListener('mouseenter', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = true
      this.mouseCaptured = true
      this.sendInput()
    })

    this.canvas.addEventListener('mouseleave', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = false
      this.mouseCaptured = false
      this.sendInput()
    })

    document.addEventListener('pointerlockchange', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      const isLocked = document.pointerLockElement === this.canvas
      this.mouseCaptured = isLocked || this.mouseInside
      this.sendInput()
    })

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      if (document.pointerLockElement === this.canvas) {
        this.mouseX += e.movementX
        this.mouseY += e.movementY
        if (this.mouseX < 0) this.mouseX = 0
        if (this.mouseY < 0) this.mouseY = 0
        if (this.mouseX > this.canvas.width) this.mouseX = this.canvas.width
        if (this.mouseY > this.canvas.height) this.mouseY = this.canvas.height
      } else {
        this.mouseX = e.offsetX
        this.mouseY = e.offsetY
      }
      this.mouseCaptured = true
      this.sendInput()
    })

    // Prevent context menu on right click inside game viewport to allow for blocking
    this.canvas.addEventListener('contextmenu', (e) => {
      if (this.isEditorOverlayVisible()) {
        return
      }
      e.preventDefault()
    })

    window.addEventListener(
      'contextmenu',
      (e) => {
        if (this.isEditorOverlayVisible()) {
          return
        }
        if (document.pointerLockElement === this.canvas) {
          this.resetInputState()
          e.preventDefault()
          return
        }
        if (this.isPointInCanvas(e.clientX, e.clientY)) {
          this.resetInputState()
          e.preventDefault()
        }
      },
      true
    )

    this.canvas.addEventListener('wheel', (e) => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      e.preventDefault()
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1
      this.targetZoom = Math.max(
        0.1,
        Math.min(2.0, this.targetZoom + zoomDelta)
      )
      this.sendInput()
    })
  }

  private sendInput() {
    // Reuse arrays to avoid allocation
    this.keysArray.length = 0
    for (const k of this.keys) {
      this.keysArray.push(k)
    }

    this.mouseButtonsArray.length = 0
    for (const b of this.mouseButtons) {
      this.mouseButtonsArray.push(b)
    }

    this.inputMessage.keys = this.keysArray
    this.inputMessage.mouseButtons = this.mouseButtonsArray
    this.inputMessage.mouseZoom = this.targetZoom
    this.inputMessage.mouseX = this.mouseX
    this.inputMessage.mouseY = this.mouseY
    this.inputMessage.mouseCaptured = this.mouseCaptured
    this.worker.postMessage(this.inputMessage)
  }

  private isEditorOverlayVisible() {
    return this.editorOverlay?.classList.contains('is-visible') ?? false
  }

  private resetInputState() {
    this.keys.clear()
    this.mouseButtons.clear()
    this.mouseCaptured = false
    this.sendInput()
  }

  private isPointInCanvas(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    const left = Math.floor(rect.left)
    const right = Math.floor(rect.right)
    const top = Math.floor(rect.top)
    const bottom = Math.floor(rect.bottom)
    return (
      clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
    )
  }

  private renderLoop(timestamp?: number) {
    const now = timestamp ?? performance.now()
    if (this.lastTime === 0) {
      this.lastTime = now
    }
    const deltaTime = (now - this.lastTime) / 1000
    this.lastTime = now
    this.lastDeltaTime = deltaTime

    this.frameCount++
    this.fpsUpdateTime += deltaTime
    if (this.fpsUpdateTime >= 1.0) {
      this.renderFps = Math.round(this.frameCount / this.fpsUpdateTime)
      this.fpsText = `${this.renderFps} FPS`
      this.frameCount = 0
      this.fpsUpdateTime = 0
    }

    if (!this.editorPreview) {
      this.renderer.update(deltaTime)
    }
    this.render(deltaTime)

    if (
      !this.isFirstFrameRendered &&
      this.hasReceivedFirstState &&
      this.onFirstFrameRendered
    ) {
      this.isFirstFrameRendered = true
      this.onFirstFrameRendered()
    }

    requestAnimationFrame(this.boundRenderLoop)
  }

  private render(deltaTime: number) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Draw Background
    if (this.backgroundPattern) {
      this.ctx.save()
      this.ctx.fillStyle = this.backgroundPattern
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      this.ctx.restore()
    }

    if (this.editorPreview) {
      return
    }

    this.ctx.save()

    const centerX = this.canvas.width / 2
    const bottomY = this.canvas.height
    // Use worker-smoothed zoom to keep camera and scale in sync.

    const zoom = this.renderZoom

    this.ctx.translate(centerX, bottomY)
    this.ctx.scale(zoom, zoom)
    this.ctx.translate(-centerX, -bottomY)

    this.ctx.translate(
      -this.camera.x * this.pixelsPerMeter,
      -this.camera.y * this.pixelsPerMeter
    )

    // Draw Static Environment (Ground/Obstacles)
    this.drawGround()
    this.drawObstacles()

    // Draw Entities
    // Renderer now handles data internally via binary buffer
    this.renderer.render()

    this.ctx.restore()

    if (this.cameraDebug.enabled) {
      this.renderCameraDebug()
    }

    // Draw FPS
    this.ctx.save()
    this.ctx.font = '20px monospace'
    this.ctx.fillStyle = '#00ff00'
    this.ctx.strokeStyle = '#000000'
    this.ctx.lineWidth = 3
    this.ctx.textAlign = 'right'
    const fpsX = this.canvas.width - 10
    this.ctx.strokeText(this.fpsText, fpsX, 30)
    this.ctx.fillText(this.fpsText, fpsX, 30)
    this.ctx.restore()

    // Draw Player UI (Health/Posture)
    this.renderer.renderPlayerUI()

    // Draw Menu if visible
    this.menuManager.render(deltaTime)
  }

  private renderCameraDebug(): void {
    const ctx = this.ctx
    const canvasWidth = this.canvas.width
    const canvasHeight = this.canvas.height
    const topLimitY = this.cameraDebug.topLimitRatio * canvasHeight
    const bottomLimitY = this.cameraDebug.bottomLimitRatio * canvasHeight

    ctx.save()
    ctx.lineWidth = 1
    ctx.strokeStyle = this.cameraDebug.isOutsideVerticalZone
      ? '#ff3b30'
      : '#00d2ff'

    ctx.beginPath()
    ctx.moveTo(0, topLimitY)
    ctx.lineTo(canvasWidth, topLimitY)
    ctx.moveTo(0, bottomLimitY)
    ctx.lineTo(canvasWidth, bottomLimitY)
    ctx.stroke()

    ctx.strokeStyle = '#ffb020'
    ctx.strokeRect(1, 1, canvasWidth - 2, canvasHeight - 2)
    ctx.restore()
  }

  private drawGround() {
    if (!this.currentMapData) {
      return
    }

    ShapeRenderer.drawShapes(
      this.ctx,
      this.currentMapData.shapes,
      'ground',
      this.pixelsPerMeter,
      {
        fillStyle: this.groundPattern ?? '#654321',
        strokeStyle: '#000',
        lineWidth: 2,
        drawStroke: false,
      }
    )
  }

  private drawObstacles() {
    if (!this.currentMapData) {
      return
    }

    ShapeRenderer.drawShapes(
      this.ctx,
      this.currentMapData.shapes,
      'obstacle',
      this.pixelsPerMeter,
      {
        fillStyle: this.obstaclePattern ?? '#d2691e',
        strokeStyle: '#000',
        lineWidth: 2,
        drawStroke: true,
      }
    )
  }

  // Public Control API (Proxy to Worker)
  setOnFirstFrameRendered(callback: () => void) {
    this.onFirstFrameRendered = callback
  }

  stop() {
    this.worker.postMessage({ type: 'control', action: 'stop' })
  }
  start() {
    this.worker.postMessage({ type: 'control', action: 'start' })
  }
  restart() {
    this.worker.postMessage({ type: 'control', action: 'restart' })
  }
  clearMapPreview() {
    this.previewActive = false
    this.setPreviewExitVisible(false)
    this.worker.postMessage({ type: 'control', action: 'clear_map_preview' })
  }

  isPreviewActive(): boolean {
    return this.previewActive
  }

  reloadDefaultMap() {
    this.worker.postMessage({ type: 'control', action: 'reload_default_map' })
  }

  setPreviewExitHandler(callback: () => void) {
    this.onExitPreviewCallback = callback
  }

  // Parameter Setters
  setGroundFriction(v: number) {
    this.updateParam('groundFriction', v)
  }
  setObstacleFriction(v: number) {
    this.updateParam('obstacleFriction', v)
  }
  setZoom(v: number) {
    this.targetZoom = v
    this.sendInput()
  }
  getZoom() {
    return this.targetZoom
  }

  setJumpBufferWindow(v: number) {
    this.updateParam('jumpBufferWindow', v)
  }

  getPlayer() {
    // Return a proxy object that mimics the old Player class method signatures
    return {
      setJumpForce: (v: number) => this.updateParam('jumpForce', v),
      setMaxJumpDuration: (v: number) => this.updateParam('maxJumpDuration', v),
      setJumpForceMultiplier: (v: number) =>
        this.updateParam('jumpForceMultiplier', v),
      setWallJumpPushAwayMultiplier: (v: number) =>
        this.updateParam('wallJumpPushAway', v),
      setWallJumpUpwardMultiplier: (v: number) =>
        this.updateParam('wallJumpUpward', v),
      setMaxWallJumps: (v: number) => this.updateParam('maxWallJumps', v),
      setMoveSpeed: (v: number) => this.updateParam('moveSpeed', v),
      setBodyFriction: (v: number) => this.updateParam('bodyFriction', v),
      setBodyLinearDamping: (v: number) =>
        this.updateParam('bodyLinearDamping', v),
      setBaseWeight: (v: number) => this.updateParam('baseWeight', v),
      setWeaponWeight: (v: number) => {
        /* Not implemented in worker sync yet */
      },
      applyHit: () => {
        /* Not easy to trigger arbitrary hit via param sync */
      },
      revive: () => {
        /* Not easy to trigger revive via param sync */
      },
      setAlive: (alive: boolean) => {
        /* Not implemented */
      },
    }
  }

  private updateParam(id: string, value: number) {
    this.worker.postMessage({
      type: 'control',
      action: 'update_param',
      paramId: id,
      value: value,
    })
  }

  getMenuManager(): MenuManager {
    return this.menuManager
  }

  private setPreviewExitVisible(visible: boolean) {
    if (this.previewActionsContainer) {
      this.previewActionsContainer.classList.toggle('is-visible', visible)
    }
    if (visible && this.previewPauseBtn) {
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
    }
  }

  private togglePreviewPause() {
    if (!this.previewActive || !this.previewPauseBtn) {
      return
    }
    if (this.inputEnabled) {
      this.stop()
      this.setInputEnabled(false)
      this.previewPauseBtn.textContent = localizer.t('ui_resume')
    } else {
      this.start()
      this.setInputEnabled(true)
      this.previewPauseBtn.textContent = localizer.t('ui_pause')
    }
  }

  private exitPreview() {
    if (!this.previewActive) {
      return
    }
    this.previewActive = false
    this.setPreviewExitVisible(false)
    this.menuManager.hide() // Ensure menu is closed
    if (this.onExitPreviewCallback) {
      this.onExitPreviewCallback()
    }
  }
}
