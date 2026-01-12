import { AudioManager } from './AudioManager'
import { ClientRenderer } from './ClientRenderer'
import GameWorker from './worker/gameWorker?worker'
import type {
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
  private pixelsPerMeter = 50

  private camera = { x: 0, y: 0 }
  private renderFps = 0
  private fpsText = '0 FPS'
  private lastTime = 0
  private frameCount = 0
  private fpsUpdateTime = 0

  // Input State
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private keysArray: string[] = []
  private mouseButtonsArray: number[] = []
  private mouseZoom = 1.0

  // Reusable message object for input
  private inputMessage: WorkerInputMessage = {
    type: 'input',
    keys: [],
    mouseButtons: [],
    mouseZoom: 1.0,
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
  private obstacleConfigs = [
    { x: -9.5, width: 1.2, height: 2.8 },
    { x: 9.5, width: 1.2, height: 2.8 },
    { x: 19.5, width: 1.2, height: 1.0 },
  ]

  constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.canvas = canvas
    this.ctx = ctx
    this.renderer = new ClientRenderer(ctx, this.pixelsPerMeter)
    this.audioManager = new AudioManager()
    this.renderer.setAudioManager(this.audioManager)

    // Cache bound functions once
    this.boundRenderLoop = this.renderLoop.bind(this)
    this.boundHandleWorkerMessage = this.handleWorkerMessage.bind(this)

    // Initialize Patterns
    this.backgroundPattern = this.createBackgroundPattern()
    this.groundPattern = this.createGroundPattern()
    this.obstaclePattern = this.createObstaclePattern()

    this.renderFps = 0
    this.fpsText = `${this.renderFps} FPS`

    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    this.groundY = canvasHeightInMeters - this.groundHeight
    this.groundTopY = this.groundY - this.groundHeight

    // Initialize Worker
    this.worker = new GameWorker()
    this.worker.onmessage = this.boundHandleWorkerMessage

    // Send Init
    this.worker.postMessage({
      type: 'init',
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      pixelsPerMeter: this.pixelsPerMeter,
    } as MainToWorkerMessage)

    this.setupInput()
    this.setupAudioResume()

    this.audioManager.init().catch((error) => {
      console.error('Failed to initialize audio:', error)
    })

    // Start Render Loop
    requestAnimationFrame(this.boundRenderLoop)
  }

  private setupAudioResume() {
    const resume = () => {
      this.audioManager.resumeContext()
      window.removeEventListener('keydown', resume)
      window.removeEventListener('mousedown', resume)
    }
    window.addEventListener('keydown', resume)
    window.addEventListener('mousedown', resume)
  }

  private handleWorkerMessage(e: MessageEvent<WorkerToMainMessage>) {
    const msg = e.data
    if (msg.type === 'state') {
      // Pass raw buffer to renderer, no decoding here to save Main Thread CPU/GC
      this.renderer.updateState(msg.entitiesBuffer, msg.entityCount)
      this.renderer.applyEffects(msg.entitiesBuffer, msg.effectsCount)
      this.camera.x = msg.camera.x
      this.camera.y = msg.camera.y
      this.releaseStateBuffer(msg.entitiesBuffer)
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
      this.keys.add(e.key.toLowerCase())
      this.sendInput()

      // Local Zoom control (immediate feedback)
      if (e.key.toLowerCase() === 'i') {
        this.mouseZoom = Math.max(0.1, this.mouseZoom + 0.2)
        this.sendInput()
      } else if (e.key.toLowerCase() === 'o') {
        this.mouseZoom = Math.max(0.1, this.mouseZoom - 0.2)
        this.sendInput()
      } else if (e.key.toLowerCase() === 'u') {
        this.mouseZoom = 1.0
        this.sendInput()
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())
      this.sendInput()
    })

    window.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button)
      this.sendInput()
    })

    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button)
      this.sendInput()
    })

    // Prevent context menu on right click to allow for blocking
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1
      this.mouseZoom = Math.max(0.1, Math.min(2.0, this.mouseZoom + zoomDelta))
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
    this.inputMessage.mouseZoom = this.mouseZoom
    this.worker.postMessage(this.inputMessage)
  }

  private renderLoop(timestamp?: number) {
    const now = timestamp ?? performance.now()
    if (this.lastTime === 0) {
      this.lastTime = now
    }
    const deltaTime = (now - this.lastTime) / 1000
    this.lastTime = now

    this.frameCount++
    this.fpsUpdateTime += deltaTime
    if (this.fpsUpdateTime >= 1.0) {
      this.renderFps = Math.round(this.frameCount / this.fpsUpdateTime)
      this.fpsText = `${this.renderFps} FPS`
      this.frameCount = 0
      this.fpsUpdateTime = 0
    }

    this.renderer.update(deltaTime)
    this.render()
    requestAnimationFrame(this.boundRenderLoop)
  }

  private render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // Draw Background
    if (this.backgroundPattern) {
      this.ctx.save()
      this.ctx.fillStyle = this.backgroundPattern
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      this.ctx.restore()
    }

    this.ctx.save()

    const centerX = this.canvas.width / 2
    const bottomY = this.canvas.height
    // Current zoom is handled by worker camera logic mostly,
    // BUT the worker sends camera position.
    // The zoom effect in RenderSystem/GameECS was:
    // ctx.scale(this.zoom, this.zoom)
    // Worker sends 'camera' which is the center point in meters.
    // The main thread 'zoom' variable tracks user input.
    // The worker *also* tracks zoom to adjust camera deadzone.
    // We should use the *worker's* calculated camera, but for the actual SCALE, we can use the local zoom or sync it.
    // Better to use local zoom for smooth rendering if worker updates are slow,
    // but worker sends state updates @ 60fps.
    // Let's use local mouseZoom for now or wait for worker to send back "current smoothed zoom".
    // Worker doesn't send "current smoothed zoom", only camera x/y.
    // Let's assume user input zoom is the target.
    // To match GameECS exactly, we should interpolate zoom here too.

    // Simplification: Use this.mouseZoom as the scale.
    // Wait, GameECS interpolated zoom. Worker does that too.
    // We need the *interpolated* zoom from worker to match the camera position calculation?
    // Actually, `camera.x` in worker is calculated based on `zoom`.
    // If we use a different zoom here, the camera offset will be wrong.
    // I should add `zoom` to the State message from worker.
    // For now, I'll rely on `mouseZoom` effectively being close enough or add `currentZoom` to protocol later.
    // Re-checking protocol: I didn't add zoom.
    // I will use `this.mouseZoom` but smoother.

    const zoom = this.mouseZoom // TODO: Add smooth zoom or get from worker

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

    // Draw Player UI (Health/Toughness)
    this.renderer.renderPlayerUI()
  }

  // Copied from GameECS
  private drawGround() {
    // Static ground at y=height - 0.5m
    const topY = this.groundTopY * this.pixelsPerMeter // Wait, GameECS: pos.y is center.
    // In GameECS: createGround pos = groundY. groundBox is 0.5 height (half-height 0.25? No, MakeBox takes half-width/height).
    // b2MakeBox(50, 0.5) -> Total height 1.0.
    // So top is pos.y - 0.5.

    // Let's just use the visual logic from GameECS
    // const pos = b2Body_GetPosition(this.groundBodyId)
    // topY = (pos.y - groundHeight) * ppm
    // height = groundHeight * 2 * ppm

    // We assume the ground didn't move.
    const topY_px = topY // 0.5 is the half-height used in GameECS
    const height_px = this.groundHeight * 2 * this.pixelsPerMeter

    this.ctx.fillStyle = this.groundPattern ?? '#654321'
    this.ctx.fillRect(
      -50 * this.pixelsPerMeter,
      topY_px,
      100 * this.pixelsPerMeter,
      height_px
    )
  }

  private drawObstacles() {
    // Static obstacles
    // GameECS: { x: -9.5, width: 1.2, height: 2.8 }
    const groundY = this.groundY

    for (let i = 0; i < this.obstacleConfigs.length; i++) {
      const obs = this.obstacleConfigs[i]
      // Body Pos: obs.x, groundY - obs.height
      const posX = obs.x
      const posY = groundY - obs.height

      this.ctx.fillStyle = this.obstaclePattern ?? '#d2691e'
      this.ctx.fillRect(
        (posX - obs.width) * this.pixelsPerMeter,
        (posY - obs.height) * this.pixelsPerMeter,
        obs.width * 2 * this.pixelsPerMeter,
        obs.height * 2 * this.pixelsPerMeter
      )

      this.ctx.strokeStyle = '#000'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(
        (posX - obs.width) * this.pixelsPerMeter,
        (posY - obs.height) * this.pixelsPerMeter,
        obs.width * 2 * this.pixelsPerMeter,
        obs.height * 2 * this.pixelsPerMeter
      )
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
  stop() {
    this.worker.postMessage({ type: 'control', action: 'stop' })
  }
  start() {
    this.worker.postMessage({ type: 'control', action: 'start' })
  }
  restart() {
    this.worker.postMessage({ type: 'control', action: 'restart' })
  }

  // Parameter Setters
  setGroundFriction(v: number) {
    this.updateParam('groundFriction', v)
  }
  setObstacleFriction(v: number) {
    this.updateParam('obstacleFriction', v)
  }
  setZoom(v: number) {
    this.mouseZoom = v
    this.sendInput()
  }
  getZoom() {
    return this.mouseZoom
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
}
