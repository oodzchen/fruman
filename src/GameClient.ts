import { AudioManager } from './AudioManager'
import { ClientRenderer } from './ClientRenderer'
import { localizer } from './Localizer'
import { MenuManager, MenuMode } from './MenuManager'
import type { EditorMapData } from './editorMapTypes'
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
  private previewExitBtn: HTMLButtonElement | null = null
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
    const previewExitBtn = document.getElementById('previewExitBtn')
    this.previewExitBtn =
      previewExitBtn instanceof HTMLButtonElement ? previewExitBtn : null
    if (this.previewExitBtn) {
      this.previewExitBtn.textContent = localizer.t('editor_exit_preview')
      this.previewExitBtn.addEventListener('click', () => {
        this.exitPreview()
      })
    }

    onInitProgress?.(localizer.t('init_renderer'))

    // Cache bound functions once
    this.boundRenderLoop = this.renderLoop.bind(this)
    this.boundHandleWorkerMessage = this.handleWorkerMessage.bind(this)

    // Initialize Patterns
    onInitProgress?.(localizer.t('init_textures'))
    this.backgroundPattern = this.createBackgroundPattern()
    this.groundPattern = this.createGroundPattern()
    this.obstaclePattern = this.createObstaclePattern()

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

    // Prevent context menu on right click to allow for blocking
    window.addEventListener('contextmenu', (e) => {
      if (this.isEditorOverlayVisible()) {
        return
      }
      e.preventDefault()
    })

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

    this.ctx.fillStyle = this.groundPattern ?? '#654321'
    this.ctx.strokeStyle = '#000'
    this.ctx.lineWidth = 2

    for (let i = 0; i < this.currentMapData.shapes.length; i++) {
      const placedShape = this.currentMapData.shapes[i]
      if (placedShape.objectKind !== 'ground') {
        continue
      }

      const shape = placedShape.shape
      if (shape.kind === 'rect') {
        const centerX = shape.center.x
        const centerY = shape.center.y
        const halfWidth = shape.halfWidth
        const halfHeight = shape.halfHeight
        const rotation = shape.rotationRad

        this.ctx.save()
        this.ctx.translate(
          centerX * this.pixelsPerMeter,
          centerY * this.pixelsPerMeter
        )
        this.ctx.rotate(rotation)
        this.ctx.fillRect(
          -halfWidth * this.pixelsPerMeter,
          -halfHeight * this.pixelsPerMeter,
          halfWidth * 2 * this.pixelsPerMeter,
          halfHeight * 2 * this.pixelsPerMeter
        )
        this.ctx.restore()
      } else if (shape.kind === 'circle') {
        const centerX = shape.center.x
        const centerY = shape.center.y
        const radius = shape.radius

        this.ctx.beginPath()
        this.ctx.arc(
          centerX * this.pixelsPerMeter,
          centerY * this.pixelsPerMeter,
          radius * this.pixelsPerMeter,
          0,
          Math.PI * 2
        )
        this.ctx.fill()
      } else if (shape.kind === 'polygon') {
        const points = shape.points

        if (points.length < 6) {
          continue
        }

        this.ctx.beginPath()
        for (let j = 0; j < points.length; j += 2) {
          const x = points[j]
          const y = points[j + 1]
          const px = x * this.pixelsPerMeter
          const py = y * this.pixelsPerMeter
          if (j === 0) {
            this.ctx.moveTo(px, py)
          } else {
            this.ctx.lineTo(px, py)
          }
        }
        this.ctx.closePath()
        this.ctx.fill()
      }
    }
  }

  private drawObstacles() {
    if (!this.currentMapData) {
      return
    }

    this.ctx.fillStyle = this.obstaclePattern ?? '#d2691e'
    this.ctx.strokeStyle = '#000'
    this.ctx.lineWidth = 2

    for (let i = 0; i < this.currentMapData.shapes.length; i++) {
      const placedShape = this.currentMapData.shapes[i]
      if (placedShape.objectKind !== 'obstacle') {
        continue
      }

      const shape = placedShape.shape
      if (shape.kind === 'rect') {
        const centerX = shape.center.x
        const centerY = shape.center.y
        const halfWidth = shape.halfWidth
        const halfHeight = shape.halfHeight
        const rotation = shape.rotationRad

        this.ctx.save()
        this.ctx.translate(
          centerX * this.pixelsPerMeter,
          centerY * this.pixelsPerMeter
        )
        this.ctx.rotate(rotation)
        this.ctx.fillRect(
          -halfWidth * this.pixelsPerMeter,
          -halfHeight * this.pixelsPerMeter,
          halfWidth * 2 * this.pixelsPerMeter,
          halfHeight * 2 * this.pixelsPerMeter
        )
        this.ctx.strokeRect(
          -halfWidth * this.pixelsPerMeter,
          -halfHeight * this.pixelsPerMeter,
          halfWidth * 2 * this.pixelsPerMeter,
          halfHeight * 2 * this.pixelsPerMeter
        )
        this.ctx.restore()
      } else if (shape.kind === 'circle') {
        const centerX = shape.center.x
        const centerY = shape.center.y
        const radius = shape.radius

        this.ctx.beginPath()
        this.ctx.arc(
          centerX * this.pixelsPerMeter,
          centerY * this.pixelsPerMeter,
          radius * this.pixelsPerMeter,
          0,
          Math.PI * 2
        )
        this.ctx.fill()
        this.ctx.stroke()
      } else if (shape.kind === 'polygon') {
        const centerX = shape.center.x
        const centerY = shape.center.y
        const points = shape.points

        if (points.length < 6) {
          continue
        }

        this.ctx.beginPath()
        for (let j = 0; j < points.length; j += 2) {
          const x = points[j]
          const y = points[j + 1]
          const px = x * this.pixelsPerMeter
          const py = y * this.pixelsPerMeter
          if (j === 0) {
            this.ctx.moveTo(px, py)
          } else {
            this.ctx.lineTo(px, py)
          }
        }
        this.ctx.closePath()
        this.ctx.fill()
        this.ctx.stroke()
      }
    }
  }

  // Patterns (Copied exactly)
  private createBackgroundPattern(): CanvasPattern | null {
    const patternSize = 80
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#0b0c0e'
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    patternCtx.strokeStyle = '#394155'
    patternCtx.lineWidth = 1

    const drawTriangle = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number
    ) => {
      patternCtx.beginPath()
      patternCtx.moveTo(x1, y1)
      patternCtx.lineTo(x2, y2)
      patternCtx.lineTo(x3, y3)
      patternCtx.closePath()
      patternCtx.stroke()
    }

    const halfSize = patternSize / 2
    const height = (Math.sqrt(3) / 2) * halfSize

    drawTriangle(0, height, halfSize, 0, halfSize, height)
    drawTriangle(halfSize, 0, patternSize, height, halfSize, height)
    drawTriangle(0, height, halfSize, height * 2, halfSize, height)
    drawTriangle(halfSize, height * 2, patternSize, height, halfSize, height)

    patternCtx.beginPath()
    patternCtx.moveTo(0, height)
    patternCtx.lineTo(patternSize, height)
    patternCtx.stroke()

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  private createGroundPattern(): CanvasPattern | null {
    const size = 96
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#826343'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#a29f4f'
    patternCtx.lineWidth = 1

    const mid = size / 2
    patternCtx.beginPath()
    patternCtx.moveTo(0, mid)
    patternCtx.lineTo(mid, 0)
    patternCtx.lineTo(size, mid)
    patternCtx.lineTo(mid, size)
    patternCtx.closePath()
    patternCtx.stroke()

    patternCtx.beginPath()
    patternCtx.moveTo(mid / 2, mid)
    patternCtx.lineTo(mid, mid / 2)
    patternCtx.lineTo((mid * 3) / 2, mid)
    patternCtx.lineTo(mid, (mid * 3) / 2)
    patternCtx.closePath()
    patternCtx.stroke()

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  private createObstaclePattern(): CanvasPattern | null {
    const size = 88
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')
    if (!patternCtx) return null

    patternCtx.fillStyle = '#70400e'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#d7a168'
    patternCtx.lineWidth = 1

    const radius = size / 4
    const rowHeight = Math.sqrt(3) * radius

    const drawHex = (cx: number, cy: number) => {
      patternCtx.beginPath()
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i + Math.PI / 6
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        if (i === 0) {
          patternCtx.moveTo(x, y)
        } else {
          patternCtx.lineTo(x, y)
        }
      }
      patternCtx.closePath()
      patternCtx.stroke()
    }

    for (let row = -1; row <= 2; row += 1) {
      const y = row * rowHeight + rowHeight
      for (let col = -1; col <= 2; col += 1) {
        const xOffset = row % 2 === 0 ? 0 : radius
        const x = col * radius * 2 + radius + xOffset
        drawHex(x, y)
      }
    }

    return this.ctx.createPattern(patternCanvas, 'repeat')
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
    if (!this.previewExitBtn) {
      return
    }
    this.previewExitBtn.style.display = visible ? 'block' : 'none'
  }

  private exitPreview() {
    if (!this.previewActive) {
      return
    }
    this.previewActive = false
    this.setPreviewExitVisible(false)
    if (this.onExitPreviewCallback) {
      this.onExitPreviewCallback()
    }
  }
}
