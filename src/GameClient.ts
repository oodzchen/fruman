import {
  Application,
  Container,
  FillPattern,
  type Graphics,
  Matrix,
  Text,
  Texture,
  TilingSprite,
} from 'pixi.js'

import { AudioManager } from './AudioManager'
import { ClientRenderer } from './ClientRenderer'
import { DialogManager } from './DialogManager'
import { localizer } from './Localizer'
import { MenuAction, MenuManager, MenuMode } from './MenuManager'
import { saveManager } from './SaveManager'
import type { EditorMapData } from './editorMapTypes'
import { collectStaticRenderLayers } from './mapObjectLayers'
import { PatternCreator } from './renderer/PatternCreator'
import { PixiRenderContext2D } from './renderer/RenderContext2D'
import { ShapeRenderer } from './renderer/ShapeRenderer'
import type { SaveData } from './saveTypes'
import { getDefaultMap } from './storage'
import { hasTerrainContent } from './terrain/TerrainDataUtils'
import { TerrainRenderer } from './terrain/TerrainRenderer'
import GameWorker from './worker/gameWorker?worker'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  WorkerInputMessage,
  WorkerSaveResponseMessage,
  WorkerToMainMessage,
} from './worker/protocol'

export class GameClient {
  private static readonly START_MENU_CAMERA_STABLE_MS = 150
  private static readonly PREVIEW_CAPTURE_MIN_RENDER_FRAMES = 6
  private static readonly PREVIEW_CAPTURE_STABLE_FRAMES = 3
  private static readonly PREVIEW_CAPTURE_MAX_RENDER_FRAMES = 24
  private worker: Worker
  private app: Application
  private appCanvas: HTMLCanvasElement

  // PixiJS scene elements
  private backgroundSprite: TilingSprite | null = null
  private fpsTextEl: Text | null = null
  private worldContainer: Container
  private hudContainer: Container
  private worldRenderContext: PixiRenderContext2D
  private hudRenderContext: PixiRenderContext2D
  private staticTerrainGraphics: Graphics[] = []
  private staticShapeGraphics: Graphics[] = []
  private readonly reusableDOMMatrix = new DOMMatrix()
  private readonly reusablePixiMatrix = new Matrix()

  private renderer: ClientRenderer
  private audioManager: AudioManager
  private menuManager: MenuManager
  private dialogManager: DialogManager
  private pixelsPerMeter = 50

  private camera = { x: 0, y: 0 }
  private renderFps = 0
  private fpsText = '0 FPS'
  private lastDeltaTime = 0
  private frameCount = 0
  private fpsUpdateTime = 0
  private renderFrameRevision = 0
  private workerStateRevision = 0

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
  private inputTarget: HTMLElement
  private previewActionsContainer: HTMLDivElement | null = null
  private previewExitBtn: HTMLButtonElement | null = null
  private previewPauseBtn: HTMLButtonElement | null = null
  private previewActive = false
  private previewAwaitStateRevision = 0
  private previewFirstRenderRevision = 0
  private previewCameraStableFrames = 0
  private previewTrackedCameraX = 0
  private previewTrackedCameraY = 0
  private previewTrackedZoom = 1000
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
  private boundHandleWorkerMessage: (
    e: MessageEvent<WorkerToMainMessage>
  ) => void
  private boundHandleAutoFocusPointerDown: (event: PointerEvent) => void
  private boundHandleAutoFocusIn: (event: FocusEvent) => void
  private focusOptions: FocusOptions = { preventScroll: true }

  // Canvas2D patterns for world canvas
  private groundPattern: FillPattern | null = null
  private obstaclePattern: FillPattern | null = null

  private editorPreview = false
  private currentMapData: EditorMapData | null = null
  private staticRenderLayers: number[] = []

  private currentSaveId: string | null = null
  private currentSaveData: SaveData | null = null
  private pendingSaveResolve: ((meta: SaveData | null) => void) | null = null
  private pendingSaveThumbnail: string | null = null
  private pendingCheckpointAutosave = false
  private pendingCheckpointCapture = false
  private pendingCheckpointCaptureAfterState = false
  private autoReloadPending = false
  private onEditorActionCallback?: () => void
  private onExitActionCallback?: () => Promise<boolean>
  private pendingStartMenuDelayMs = -1
  private pendingStartMenuSkipAnimation = false
  private startMenuPauseArmed = false
  private startMenuStableElapsedMs = 0
  private lastStartMenuCameraX = 0
  private lastStartMenuCameraY = 0

  static async create(
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement,
    onInitProgress?: (step: string) => void
  ): Promise<GameClient> {
    onInitProgress?.('init_renderer')
    const app = new Application()
    await app.init({
      resizeTo: inputTarget,
      antialias: true,
      autoDensity: true,
      resolution: 1,
      preserveDrawingBuffer: false,
    })
    const appCanvas = app.canvas as HTMLCanvasElement
    appCanvas.id = 'gameCanvas'
    appCanvas.classList.add('game-canvas')
    inputTarget.prepend(appCanvas)
    return new GameClient(app, menuOverlay, inputTarget, onInitProgress)
  }

  private constructor(
    app: Application,
    menuOverlay: HTMLDivElement,
    inputTarget: HTMLElement,
    onInitProgress?: (step: string) => void
  ) {
    this.app = app
    this.appCanvas = app.canvas as HTMLCanvasElement

    const width = app.renderer.width
    const height = app.renderer.height

    // PixiJS scene hierarchy
    onInitProgress?.('init_textures')
    const bgTexture = PatternCreator.createBackgroundTexture()
    this.backgroundSprite = new TilingSprite({
      texture: bgTexture ?? Texture.WHITE,
      width,
      height,
    })
    if (!bgTexture) {
      this.backgroundSprite.tint = 0x0d0b18
    }
    app.stage.addChild(this.backgroundSprite)

    this.worldContainer = new Container()
    this.worldContainer.sortableChildren = true
    app.stage.addChild(this.worldContainer)

    this.hudContainer = new Container()
    this.hudContainer.sortableChildren = true
    app.stage.addChild(this.hudContainer)
    this.worldRenderContext = new PixiRenderContext2D(
      this.worldContainer,
      width,
      height
    )
    this.hudRenderContext = new PixiRenderContext2D(
      this.hudContainer,
      width,
      height
    )

    // FPS text
    this.fpsTextEl = new Text({
      text: '0 FPS',
      style: {
        fontFamily: 'monospace',
        fontSize: 20,
        fill: '#00ff00',
        stroke: { color: '#000000', width: 3 },
      },
    })
    this.fpsTextEl.anchor.set(1, 0)
    this.fpsTextEl.position.set(width - 10, 10)
    this.hudContainer.addChild(this.fpsTextEl)

    const groundTexture = PatternCreator.createGroundTexture()
    this.groundPattern = groundTexture
      ? new FillPattern(groundTexture, 'repeat')
      : null
    const obstacleTexture = PatternCreator.createObstacleTexture()
    this.obstaclePattern = obstacleTexture
      ? new FillPattern(obstacleTexture, 'repeat')
      : null

    // Renderer + managers
    this.renderer = new ClientRenderer(
      this.worldRenderContext,
      this.hudRenderContext,
      this.pixelsPerMeter
    )
    this.audioManager = new AudioManager()
    this.menuManager = new MenuManager(this.appCanvas, menuOverlay, inputTarget)
    const uiLayer = menuOverlay.parentElement as HTMLDivElement
    this.inputTarget = inputTarget
    if (this.inputTarget.tabIndex < 0) {
      this.inputTarget.tabIndex = 0
    }
    this.dialogManager = new DialogManager(uiLayer, this.inputTarget)
    this.menuManager.setDialogManager(this.dialogManager)
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

    // Bind handlers
    this.boundHandleWorkerMessage = this.handleWorkerMessage.bind(this)
    this.boundHandleAutoFocusPointerDown =
      this.handleAutoFocusPointerDown.bind(this)
    this.boundHandleAutoFocusIn = this.handleAutoFocusIn.bind(this)

    // Initialize Worker
    onInitProgress?.('init_game_logic')
    this.worker = new GameWorker()
    this.worker.onmessage = this.boundHandleWorkerMessage

    this.worker.postMessage({
      type: 'init',
      canvasWidth: width,
      canvasHeight: height,
      pixelsPerMeter: this.pixelsPerMeter,
    } as MainToWorkerMessage)

    onInitProgress?.('init_input')
    this.setupInput()
    this.setupAudioResume()

    onInitProgress?.('init_audio')
    this.audioManager.init().catch((error) => {
      console.error('Failed to initialize audio:', error)
    })

    this.setupMenuActions()

    // Resize: sync Pixi render surfaces
    app.renderer.on('resize', (newWidth: number, newHeight: number) => {
      if (this.backgroundSprite) {
        this.backgroundSprite.width = newWidth
        this.backgroundSprite.height = newHeight
      }
      this.worldRenderContext.resize(newWidth, newHeight)
      this.hudRenderContext.resize(newWidth, newHeight)
      if (this.fpsTextEl) {
        this.fpsTextEl.position.set(newWidth - 10, 10)
      }
    })

    // Ticker-based render loop (replaces requestAnimationFrame)
    app.ticker.add(() => this.renderLoopTick())
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
    this.previewAwaitStateRevision = this.workerStateRevision + 1
    this.previewFirstRenderRevision = 0
    this.previewCameraStableFrames = 0
    this.previewTrackedCameraX = 0
    this.previewTrackedCameraY = 0
    this.previewTrackedZoom = 1000
    this.setPreviewExitVisible(true)
    this.currentMapData = map
    this.staticRenderLayers = collectStaticRenderLayers(map)
    this.renderer.setCharacterBodyMap(map)
    this.rebuildStaticScene()

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
    const passiveListenerOptions: AddEventListenerOptions = { passive: true }
    const resumeAudio = () => {
      this.audioManager.resumeContext()
    }
    this.inputTarget.addEventListener('keydown', resumeAudio)
    this.inputTarget.addEventListener(
      'pointerdown',
      resumeAudio,
      passiveListenerOptions
    )
    this.inputTarget.addEventListener(
      'touchstart',
      resumeAudio,
      passiveListenerOptions
    )
  }

  private handleWorkerMessage(e: MessageEvent<WorkerToMainMessage>) {
    const msg = e.data
    if (msg.type === 'state') {
      this.workerStateRevision++
      this.renderer.updateState(
        msg.entitiesBuffer,
        msg.entityCount,
        msg.ropePointCount
      )
      if (!this.editorPreview) {
        this.renderer.applyEffects(msg.entitiesBuffer, msg.effectsCount)
      }
      this.camera.x = msg.camera.x
      this.camera.y = msg.camera.y
      this.renderZoom = msg.zoom
      this.renderer.setCamera(this.camera.x, this.camera.y, this.renderZoom)
      this.releaseStateBuffer(msg.entitiesBuffer)
      this.hasReceivedFirstState = true
      if (this.pendingCheckpointCaptureAfterState) {
        this.pendingCheckpointCaptureAfterState = false
        this.pendingCheckpointCapture = true
      }
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
      this.staticRenderLayers = collectStaticRenderLayers(msg.map)
      this.renderer.setCharacterBodyMap(msg.map)
      this.rebuildStaticScene()
      if (
        msg.map.camera &&
        msg.map.camera.zoom > 0 &&
        Number.isFinite(msg.map.camera.zoom)
      ) {
        this.targetZoom = msg.map.camera.zoom
        this.renderZoom = msg.map.camera.zoom
      }
    } else if (msg.type === 'save_response') {
      this.handleSaveResponse(msg)
    } else if (msg.type === 'checkpoint_activated') {
      void this.handleCheckpointAutosave()
    } else if (msg.type === 'player_dead') {
      void this.handlePlayerDead()
    }
  }

  private handleSaveResponse(msg: WorkerSaveResponseMessage): void {
    if (!this.currentSaveData) return

    const nextThumbnail =
      this.pendingSaveThumbnail ?? this.currentSaveData.meta.thumbnail
    const updatedSaveData: SaveData = {
      ...this.currentSaveData,
      playTimeMs: msg.playTimeMs,
      worldStateReady: true,
      activeCheckpoint: msg.activeCheckpoint,
      player: msg.player,
      npcs: msg.npcs,
      groundWeapons: msg.groundWeapons,
      groundSunPickups: msg.groundSunPickups,
      camera: msg.camera,
      meta: {
        ...this.currentSaveData.meta,
        thumbnail: nextThumbnail ?? undefined,
      },
    }

    this.currentSaveData = updatedSaveData
    this.pendingSaveThumbnail = null

    saveManager.save(msg.saveId, updatedSaveData).then((meta) => {
      if (this.pendingSaveResolve) {
        this.pendingSaveResolve(meta ? updatedSaveData : null)
        this.pendingSaveResolve = null
      }
    })
  }

  private handleCheckpointAutosave(): void {
    if (!this.currentSaveId || !this.currentSaveData) {
      return
    }
    if (this.pendingSaveResolve) {
      return
    }
    if (this.pendingCheckpointAutosave) {
      return
    }
    this.pendingCheckpointAutosave = true
    this.pendingCheckpointCaptureAfterState = true
  }

  private async handleAutoReload(): Promise<void> {
    if (this.autoReloadPending) {
      return
    }
    if (!this.currentSaveId) {
      return
    }
    this.autoReloadPending = true
    await this.loadSaveById(this.currentSaveId)
    this.autoReloadPending = false
  }

  private async handlePlayerDead(): Promise<void> {
    if (this.previewActive) {
      this.handlePreviewRespawn()
      return
    }
    await this.handleAutoReload()
  }

  private handlePreviewRespawn(): void {
    if (!this.previewActive || !this.currentMapData) {
      return
    }

    this.worker.postMessage({
      type: 'map_preview',
      map: this.currentMapData,
    } as MainToWorkerMessage)

    this.start()
    this.setInputEnabled(true)
  }

  private async captureCheckpointAutosave(): Promise<void> {
    if (!this.pendingCheckpointAutosave) {
      return
    }
    if (this.pendingSaveResolve) {
      this.pendingCheckpointAutosave = false
      return
    }
    this.pendingSaveThumbnail = await this.captureSaveThumbnail()
    await this.requestSave()
    this.pendingCheckpointAutosave = false
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
    this.inputTarget.addEventListener(
      'pointerdown',
      this.boundHandleAutoFocusPointerDown,
      true
    )
    this.inputTarget.addEventListener(
      'focusin',
      this.boundHandleAutoFocusIn,
      true
    )

    this.inputTarget.addEventListener(
      'keydown',
      (e) => {
        if (this.shouldIgnoreKeyEvent(e)) {
          return
        }
        const key = e.key.toLowerCase()

        if (key === 'escape') {
          if (this.isEditorOverlayVisible()) {
            return
          }
          if (e.defaultPrevented) {
            return
          }
          e.preventDefault()
          if (this.previewActive) {
            this.togglePreviewPause()
            return
          }
          if (this.menuManager.isVisible()) {
            if (this.menuManager.getMode() !== MenuMode.Pause) {
              return
            }
            this.menuManager.hide()
            this.resumeGameInput()
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
      },
      true
    )

    this.inputTarget.addEventListener(
      'keyup',
      (e) => {
        if (this.shouldIgnoreKeyEvent(e)) {
          return
        }
        if (this.menuManager.isVisible() || !this.inputEnabled) {
          return
        }
        this.keys.delete(e.key.toLowerCase())
        this.sendInput()
      },
      true
    )

    this.inputTarget.addEventListener('mousedown', (e) => {
      if (
        e.button === 2 &&
        !this.isEditorOverlayVisible() &&
        (document.pointerLockElement === this.appCanvas ||
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

    this.inputTarget.addEventListener('mouseup', (e) => {
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

    this.inputTarget.addEventListener('mouseenter', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = true
      this.mouseCaptured = true
      this.sendInput()
    })

    this.inputTarget.addEventListener('mouseleave', () => {
      if (this.menuManager.isVisible() || !this.inputEnabled) return
      this.mouseInside = false
      this.mouseCaptured = false
      this.sendInput()
    })

    this.inputTarget.addEventListener('mousemove', (e) => {
      if (this.menuManager.isVisible() || !this.inputEnabled) {
        return
      }
      const canvasWidth = this.app.renderer.width
      const canvasHeight = this.app.renderer.height
      if (document.pointerLockElement === this.appCanvas) {
        this.mouseX += e.movementX
        this.mouseY += e.movementY
        if (this.mouseX < 0) this.mouseX = 0
        if (this.mouseY < 0) this.mouseY = 0
        if (this.mouseX > canvasWidth) this.mouseX = canvasWidth
        if (this.mouseY > canvasHeight) this.mouseY = canvasHeight
      } else {
        const rect = this.appCanvas.getBoundingClientRect()
        const x = Math.floor(e.clientX - rect.left)
        const y = Math.floor(e.clientY - rect.top)
        this.mouseX = x < 0 ? 0 : x > canvasWidth ? canvasWidth : x
        this.mouseY = y < 0 ? 0 : y > canvasHeight ? canvasHeight : y
      }
      this.mouseCaptured = true
      this.sendInput()
    })

    this.inputTarget.addEventListener(
      'contextmenu',
      (e) => {
        if (this.isEditorOverlayVisible()) {
          return
        }
        if (document.pointerLockElement === this.appCanvas) {
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

    this.inputTarget.addEventListener('wheel', (e) => {
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

  private handleAutoFocusPointerDown(event: PointerEvent) {
    if (!this.shouldForceGameFocus()) {
      return
    }
    const target = event.target
    if (this.shouldAllowTargetFocus(target)) {
      return
    }
    if (document.activeElement !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  private handleAutoFocusIn(event: FocusEvent) {
    if (!this.shouldForceGameFocus()) {
      return
    }
    const target = event.target
    if (this.shouldAllowTargetFocus(target)) {
      return
    }
    if (target !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  requestGameFocus() {
    if (!this.shouldForceGameFocus()) {
      return
    }
    if (document.activeElement !== this.inputTarget) {
      this.inputTarget.focus(this.focusOptions)
    }
  }

  private shouldAllowTargetFocus(target: EventTarget | null): boolean {
    if (this.dialogManager.isDialogOpen()) {
      return true
    }
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true
    }
    return false
  }

  private shouldForceGameFocus(): boolean {
    if (!this.inputEnabled) return false
    if (this.menuManager.isVisible()) return false
    if (this.isEditorOverlayVisible()) return false
    if (this.dialogManager.isDialogOpen()) return false
    return true
  }

  private shouldIgnoreKeyEvent(e: KeyboardEvent): boolean {
    if (this.dialogManager.isDialogOpen()) {
      return true
    }
    const target = e.target
    if (target instanceof HTMLInputElement) return true
    if (target instanceof HTMLTextAreaElement) return true
    if (target instanceof HTMLSelectElement) return true
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true
    }
    return false
  }

  private sendInput() {
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
    const rect = this.appCanvas.getBoundingClientRect()
    const left = Math.floor(rect.left)
    const right = Math.floor(rect.right)
    const top = Math.floor(rect.top)
    const bottom = Math.floor(rect.bottom)
    return (
      clientX >= left && clientX <= right && clientY >= top && clientY <= bottom
    )
  }

  private renderLoopTick() {
    const deltaMs = Math.min(this.app.ticker.deltaMS, 100)
    const deltaTime = deltaMs / 1000
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
    this.updateStartMenuFlow(deltaMs | 0)
    this.render(deltaMs | 0)
    this.renderFrameRevision++
    this.updatePreviewCaptureState()

    if (this.pendingCheckpointCapture) {
      this.pendingCheckpointCapture = false
      void this.captureCheckpointAutosave()
    }

    if (
      !this.isFirstFrameRendered &&
      this.hasReceivedFirstState &&
      this.onFirstFrameRendered
    ) {
      this.isFirstFrameRendered = true
      this.onFirstFrameRendered()
    }
  }

  private render(deltaMs: number) {
    const width = this.app.renderer.width
    const height = this.app.renderer.height
    this.worldRenderContext.beginFrame()
    this.hudRenderContext.beginFrame()

    if (!this.editorPreview) {
      const centerX = width / 2
      const bottomY = height
      const zoom = this.renderZoom
      const worldMatrix = this.reusableDOMMatrix
      worldMatrix.a = 1
      worldMatrix.b = 0
      worldMatrix.c = 0
      worldMatrix.d = 1
      worldMatrix.e = 0
      worldMatrix.f = 0
      worldMatrix.translateSelf(centerX, bottomY)
      worldMatrix.scaleSelf(zoom, zoom)
      worldMatrix.translateSelf(-centerX, -bottomY)

      const shakeOffsetX = this.renderer.getCameraShakeOffsetX()
      const shakeOffsetY = this.renderer.getCameraShakeOffsetY()
      if (shakeOffsetX !== 0 || shakeOffsetY !== 0) {
        worldMatrix.translateSelf(shakeOffsetX, shakeOffsetY)
      }

      worldMatrix.translateSelf(
        -this.camera.x * this.pixelsPerMeter,
        -this.camera.y * this.pixelsPerMeter
      )
      const pixiMatrix = this.reusablePixiMatrix
      pixiMatrix.a = worldMatrix.a
      pixiMatrix.b = worldMatrix.b
      pixiMatrix.c = worldMatrix.c
      pixiMatrix.d = worldMatrix.d
      pixiMatrix.tx = worldMatrix.e
      pixiMatrix.ty = worldMatrix.f
      this.worldContainer.setFromMatrix(pixiMatrix)

      this.renderer.render(deltaMs, this.staticRenderLayers, (layer) => {
        this.worldRenderContext.setRenderZIndex(layer * 10 + 5)
      })

      if (this.cameraDebug.enabled) {
        this.renderCameraDebug()
      }

      // Player UI in screen space
      this.renderer.renderPlayerUI()
    }

    // Update FPS display
    if (this.fpsTextEl) {
      this.fpsTextEl.text = this.fpsText
    }

    // Menu (DOM-based)
    this.menuManager.render(deltaMs / 1000)
  }

  private updatePreviewCaptureState(): void {
    if (!this.previewActive) {
      return
    }
    if (this.workerStateRevision < this.previewAwaitStateRevision) {
      return
    }

    const cameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    const cameraY = Math.round(this.camera.y * this.pixelsPerMeter)
    const zoom = Math.round(this.renderZoom * 1000)

    if (this.previewFirstRenderRevision === 0) {
      this.previewFirstRenderRevision = this.renderFrameRevision
      this.previewCameraStableFrames = 1
      this.previewTrackedCameraX = cameraX
      this.previewTrackedCameraY = cameraY
      this.previewTrackedZoom = zoom
      return
    }

    if (
      this.previewTrackedCameraX === cameraX &&
      this.previewTrackedCameraY === cameraY &&
      this.previewTrackedZoom === zoom
    ) {
      this.previewCameraStableFrames++
      return
    }

    this.previewTrackedCameraX = cameraX
    this.previewTrackedCameraY = cameraY
    this.previewTrackedZoom = zoom
    this.previewCameraStableFrames = 1
  }

  private renderCameraDebug(): void {
    const ctx = this.hudRenderContext
    const canvasWidth = this.app.renderer.width
    const canvasHeight = this.app.renderer.height
    ctx.setRenderZIndex(100000)
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

  scheduleStartMenu(delayMs: number, skipAnimation = false) {
    this.pendingStartMenuDelayMs = Math.max(0, delayMs | 0)
    this.pendingStartMenuSkipAnimation = skipAnimation
    this.startMenuPauseArmed = false
    this.startMenuStableElapsedMs = 0
  }

  showStartMenu(skipAnimation = false) {
    this.pendingStartMenuDelayMs = -1
    this.pendingStartMenuSkipAnimation = false
    this.setInputEnabled(false)
    void this.menuManager
      .showWithSaveRefresh(MenuMode.Start, skipAnimation)
      .then(() => {
        if (
          this.menuManager.isVisible() &&
          this.menuManager.getMode() === MenuMode.Start
        ) {
          this.armStartMenuPause()
        }
      })
  }

  setAudioMuted(muted: boolean): void {
    this.audioManager.setMuted(muted)
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
      setWeaponWeight: (_v: number) => {},
      applyHit: () => {},
      revive: () => {},
      setAlive: (_alive: boolean) => {},
    }
  }

  setRopeDensity(value: number): void {
    this.updateParam('ropeDensity', value)
  }

  setRopeLinearDamping(value: number): void {
    this.updateParam('ropeLinearDamping', value)
  }

  setRopeHertz(value: number): void {
    this.updateParam('ropeHertz', value)
  }

  setRopeDampingRatio(value: number): void {
    this.updateParam('ropeDampingRatio', value)
  }

  setSwingForce(value: number): void {
    this.updateParam('swingForce', value)
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
    this.menuManager.hide()
    if (this.onExitPreviewCallback) {
      this.onExitPreviewCallback()
    }
  }

  async initSaveSystem(): Promise<void> {
    await this.menuManager.initSaveState()
    this.setupMenuActions()
  }

  private setupMenuActions(): void {
    this.menuManager.onAction(async (action, saveId) => {
      switch (action) {
        case MenuAction.NewGame:
          await this.startNewGame()
          break
        case MenuAction.Continue:
          await this.continueGame()
          break
        case MenuAction.SaveListSelect:
          if (saveId) {
            await this.loadSaveById(saveId)
          }
          break
        case MenuAction.SaveListNew:
          await this.startNewGame()
          break
        case MenuAction.Resume:
          this.menuManager.hide()
          this.resumeGameInput()
          break
        case MenuAction.SaveGame:
          this.dialogManager.showLoading(localizer.t('saving'))
          this.pendingSaveThumbnail = await this.captureSaveThumbnail()
          const saveResult = await this.requestSave()
          this.dialogManager.hideLoading()
          if (saveResult) {
            await this.dialogManager.alert(localizer.t('save_success'))
          } else {
            await this.dialogManager.alert(localizer.t('save_failed'))
          }
          this.menuManager.hide()
          this.resumeGameInput()
          break
        case MenuAction.MainMenu:
          if (this.currentSaveId) {
            await this.requestSave()
          }
          this.clearMapPreview()
          this.setEditorPreview(false)
          this.menuManager.hide()
          this.showStartMenu()
          break
        case MenuAction.Exit:
          if (this.onExitActionCallback) {
            const confirmed = await this.onExitActionCallback()
            if (confirmed) {
              window.close()
            }
          } else if (confirm(localizer.t('confirm_exit_game'))) {
            window.close()
          }
          break
        case MenuAction.Editor:
          if (this.onEditorActionCallback) {
            this.onEditorActionCallback()
          }
          break
      }
    })
  }

  private async startNewGame(): Promise<void> {
    const defaultMap = await getDefaultMap()
    if (!defaultMap) {
      console.error('No default map found')
      return
    }

    const saveCount = (await saveManager.listSaves()).length
    const saveName = localizer
      .t('save_default_name')
      .replace('{0}', String(saveCount + 1))

    const playerMaxHealth = defaultMap.data.player?.maxHealth ?? 20
    const meta = await saveManager.createSave(
      saveName,
      defaultMap.meta.id,
      defaultMap.meta.name,
      defaultMap.data,
      playerMaxHealth
    )

    if (!meta) {
      console.error('Failed to create save')
      return
    }

    const saveData = await saveManager.loadSave(meta.id)
    if (!saveData) {
      console.error('Failed to load newly created save')
      return
    }

    this.currentSaveId = meta.id
    this.currentSaveData = saveData

    this.setEditorPreview(false)
    if (this.previewActive) {
      this.clearMapPreview()
    }

    this.worker.postMessage({
      type: 'load_save',
      saveData,
    } as MainToWorkerMessage)

    this.clearStartMenuFlow()
    this.menuManager.hide()
    this.resumeGameInput()
  }

  private async continueGame(): Promise<void> {
    const lastSaveId = await saveManager.getLastSaveId()
    if (!lastSaveId) {
      await this.startNewGame()
      return
    }

    await this.loadSaveById(lastSaveId)
  }

  private async loadSaveById(saveId: string): Promise<void> {
    const saveData = await saveManager.loadSave(saveId)
    if (!saveData) {
      console.error('Failed to load save:', saveId)
      return
    }

    this.currentSaveId = saveId
    this.currentSaveData = saveData

    this.setEditorPreview(false)
    if (this.previewActive) {
      this.clearMapPreview()
    }

    this.worker.postMessage({
      type: 'load_save',
      saveData,
    } as MainToWorkerMessage)

    this.clearStartMenuFlow()
    this.menuManager.hide()
    this.resumeGameInput()
  }

  private resumeGameInput() {
    this.clearStartMenuFlow()
    this.start()
    this.inputEnabled = true
    this.requestGameFocus()
  }

  private updateStartMenuFlow(deltaMs: number) {
    if (this.pendingStartMenuDelayMs >= 0) {
      this.pendingStartMenuDelayMs -= deltaMs
      if (this.pendingStartMenuDelayMs <= 0) {
        const skipAnimation = this.pendingStartMenuSkipAnimation
        this.pendingStartMenuDelayMs = -1
        this.pendingStartMenuSkipAnimation = false
        this.showStartMenu(skipAnimation)
      }
    }

    if (!this.startMenuPauseArmed) {
      return
    }

    if (
      !this.menuManager.isVisible() ||
      this.menuManager.getMode() !== MenuMode.Start
    ) {
      this.startMenuPauseArmed = false
      this.startMenuStableElapsedMs = 0
      return
    }

    const cameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    const cameraY = Math.round(this.camera.y * this.pixelsPerMeter)
    if (
      cameraX === this.lastStartMenuCameraX &&
      cameraY === this.lastStartMenuCameraY
    ) {
      this.startMenuStableElapsedMs += deltaMs
    } else {
      this.startMenuStableElapsedMs = 0
      this.lastStartMenuCameraX = cameraX
      this.lastStartMenuCameraY = cameraY
    }

    if (
      this.startMenuStableElapsedMs >= GameClient.START_MENU_CAMERA_STABLE_MS
    ) {
      this.stop()
      this.startMenuPauseArmed = false
      this.startMenuStableElapsedMs = 0
    }
  }

  private armStartMenuPause() {
    this.startMenuPauseArmed = true
    this.startMenuStableElapsedMs = 0
    this.lastStartMenuCameraX = Math.round(this.camera.x * this.pixelsPerMeter)
    this.lastStartMenuCameraY = Math.round(this.camera.y * this.pixelsPerMeter)
  }

  private clearStartMenuFlow() {
    this.pendingStartMenuDelayMs = -1
    this.pendingStartMenuSkipAnimation = false
    this.startMenuPauseArmed = false
    this.startMenuStableElapsedMs = 0
  }

  requestSave(): Promise<SaveData | null> {
    if (!this.currentSaveId || !this.currentSaveData) {
      return Promise.resolve(null)
    }

    return new Promise((resolve) => {
      this.pendingSaveResolve = resolve
      this.worker.postMessage({
        type: 'save_request',
        saveId: this.currentSaveId,
      } as MainToWorkerMessage)

      setTimeout(() => {
        if (this.pendingSaveResolve === resolve) {
          this.pendingSaveResolve = null
          this.pendingSaveThumbnail = null
          resolve(null)
        }
      }, 5000)
    })
  }

  private rebuildStaticScene(): void {
    this.destroyStaticGraphics(this.staticTerrainGraphics)
    this.staticTerrainGraphics.length = 0
    this.destroyStaticGraphics(this.staticShapeGraphics)
    this.staticShapeGraphics.length = 0

    const mapData = this.currentMapData
    if (!mapData) {
      return
    }

    const terrain = mapData.terrain
    if (terrain && hasTerrainContent(terrain)) {
      this.staticTerrainGraphics = TerrainRenderer.createPixiTerrainGraphics(
        terrain,
        terrain.cellSize * this.pixelsPerMeter,
        { drawStroke: true }
      )
      for (let i = 0; i < this.staticTerrainGraphics.length; i++) {
        this.worldContainer.addChild(this.staticTerrainGraphics[i])
      }
    }

    if (mapData.shapes.length > 0) {
      const groundGraphics = ShapeRenderer.createPixiShapeGraphics(
        mapData.shapes,
        'ground',
        this.pixelsPerMeter,
        {
          fill: this.groundPattern ?? '#654321',
          drawStroke: false,
        }
      )
      const obstacleGraphics = ShapeRenderer.createPixiShapeGraphics(
        mapData.shapes,
        'obstacle',
        this.pixelsPerMeter,
        {
          fill: this.obstaclePattern ?? '#d2691e',
          strokeColor: '#000',
          strokeWidth: 2,
          drawStroke: true,
        }
      )
      for (let i = 0; i < groundGraphics.length; i++) {
        this.staticShapeGraphics.push(groundGraphics[i])
        this.worldContainer.addChild(groundGraphics[i])
      }
      for (let i = 0; i < obstacleGraphics.length; i++) {
        this.staticShapeGraphics.push(obstacleGraphics[i])
        this.worldContainer.addChild(obstacleGraphics[i])
      }
    }
  }

  private destroyStaticGraphics(list: Graphics[]): void {
    for (let i = 0; i < list.length; i++) {
      const graphics = list[i]
      if (graphics.parent) {
        graphics.parent.removeChild(graphics)
      }
      graphics.destroy()
    }
  }

  private captureSaveThumbnail(): Promise<string | null> {
    const w = this.app.renderer.width
    const h = this.app.renderer.height
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = w
    thumbCanvas.height = h
    const thumbCtx = thumbCanvas.getContext('2d')
    if (!thumbCtx) return Promise.resolve(null)
    thumbCtx.fillStyle = '#0d0b18'
    thumbCtx.fillRect(0, 0, w, h)
    thumbCtx.drawImage(this.appCanvas, 0, 0)
    const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.8)
    return this.resizeThumbnail(dataUrl, 200, 160)
  }

  captureCurrentThumbnail(): Promise<string | null> {
    return this.captureSaveThumbnail()
  }

  waitForPreviewThumbnailReady(): Promise<void> {
    if (!this.previewActive) {
      return Promise.resolve()
    }

    const targetStateRevision = this.previewAwaitStateRevision
    return new Promise((resolve) => {
      const poll = () => {
        if (!this.previewActive) {
          resolve()
          return
        }
        if (this.workerStateRevision < targetStateRevision) {
          requestAnimationFrame(poll)
          return
        }
        if (this.previewFirstRenderRevision === 0) {
          requestAnimationFrame(poll)
          return
        }

        const settledFrames =
          this.renderFrameRevision - this.previewFirstRenderRevision
        if (
          settledFrames >= GameClient.PREVIEW_CAPTURE_MAX_RENDER_FRAMES ||
          (settledFrames >= GameClient.PREVIEW_CAPTURE_MIN_RENDER_FRAMES &&
            this.previewCameraStableFrames >=
              GameClient.PREVIEW_CAPTURE_STABLE_FRAMES)
        ) {
          resolve()
          return
        }

        requestAnimationFrame(poll)
      }

      requestAnimationFrame(poll)
    })
  }

  private resizeThumbnail(
    dataUrl: string,
    width: number,
    height: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        const srcRatio = img.width / img.height
        const dstRatio = width / height

        let drawW = width
        let drawH = height
        let offsetX = 0
        let offsetY = 0

        if (srcRatio > dstRatio) {
          drawH = height
          drawW = height * srcRatio
          offsetX = (width - drawW) / 2
        } else {
          drawW = width
          drawH = width / srcRatio
          offsetY = (height - drawH) / 2
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  getCurrentSaveId(): string | null {
    return this.currentSaveId
  }

  setOnEditorAction(callback: () => void): void {
    this.onEditorActionCallback = callback
  }

  setOnExitAction(callback: () => Promise<boolean>): void {
    this.onExitActionCallback = callback
  }
}
