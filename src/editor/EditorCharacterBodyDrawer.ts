import { localizer } from '../Localizer'
import {
  CHARACTER_BODY_DRAW_HALF,
  CHARACTER_BODY_DRAW_SIZE,
  DEFAULT_CHARACTER_EYE_X,
  DEFAULT_CHARACTER_EYE_Y,
  clampCharacterEyeCoord,
  getCharacterEyeDrawX,
  getCharacterEyeDrawY,
} from '../characterBodyProfile'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import { renderBodyEye } from '../renderer/BodyRenderer'
import { EditorUIHelper } from './EditorUIHelper'

type BodyDrawMode = 'shape' | 'erase' | 'texture' | 'eye'

interface EditorCharacterBodyDrawerOptions {
  title: string
  initialProfile?: MapCharacterBodyProfile
  initialColor?: string
  defaultBodyWidth?: number
  defaultBodyHeight?: number
}

const DISPLAY_SIZE = 320
const MIN_BRUSH_SIZE = 2
const MAX_BRUSH_SIZE = 24
const DEFAULT_BRUSH_SIZE = 8
const MASK_ALPHA_THRESHOLD = 16
const MAX_PROFILE_POINTS = 96
const EYE_CURSOR_SIZE = 14
const DRAWER_HISTORY_MAX_ENTRIES = 64

interface EditorCharacterBodyDrawerHistorySnapshot {
  mask: ImageData
  shape: ImageData
  texture: ImageData
  brushSize: string
  color: string
  eyeX: number
  eyeY: number
}

interface EditorCharacterBodyDrawerHistoryContext {
  captureSnapshot: () => EditorCharacterBodyDrawerHistorySnapshot
  applySnapshot: (snapshot: EditorCharacterBodyDrawerHistorySnapshot) => void
}

interface EditorCharacterBodyDrawerHistoryEntry {
  snapshot: EditorCharacterBodyDrawerHistorySnapshot
}

class EditorCharacterBodyDrawerHistoryManager {
  private ctx: EditorCharacterBodyDrawerHistoryContext
  private undoStack: EditorCharacterBodyDrawerHistoryEntry[] = []
  private redoStack: EditorCharacterBodyDrawerHistoryEntry[] = []
  private entryPool: EditorCharacterBodyDrawerHistoryEntry[] = []
  private suspended = false
  private maxEntries: number

  constructor(
    ctx: EditorCharacterBodyDrawerHistoryContext,
    maxEntries: number
  ) {
    this.ctx = ctx
    this.maxEntries = maxEntries
  }

  reset() {
    this.clearStacks()
    this.pushUndoSnapshot(this.ctx.captureSnapshot())
  }

  capture() {
    if (this.suspended) {
      return
    }
    this.pushUndoSnapshot(this.ctx.captureSnapshot())
    this.clearRedoStack()
  }

  undo(): boolean {
    if (this.undoStack.length <= 1) {
      return false
    }
    const current = this.undoStack.pop()
    if (!current) {
      return false
    }
    this.redoStack.push(current)
    const previous = this.undoStack[this.undoStack.length - 1]
    if (!previous) {
      return false
    }
    this.applySnapshot(previous.snapshot)
    return true
  }

  redo(): boolean {
    if (this.redoStack.length === 0) {
      return false
    }
    const entry = this.redoStack.pop()
    if (!entry) {
      return false
    }
    this.undoStack.push(entry)
    this.applySnapshot(entry.snapshot)
    return true
  }

  private applySnapshot(snapshot: EditorCharacterBodyDrawerHistorySnapshot) {
    this.suspended = true
    this.ctx.applySnapshot(snapshot)
    this.suspended = false
  }

  private pushUndoSnapshot(snapshot: EditorCharacterBodyDrawerHistorySnapshot) {
    const entry = this.acquireEntry(snapshot)
    this.undoStack.push(entry)
    if (this.undoStack.length > this.maxEntries) {
      const removed = this.undoStack.shift()
      if (removed) {
        this.releaseEntry(removed)
      }
    }
  }

  private clearRedoStack() {
    while (this.redoStack.length > 0) {
      const entry = this.redoStack.pop()
      if (entry) {
        this.releaseEntry(entry)
      }
    }
  }

  private clearStacks() {
    while (this.undoStack.length > 0) {
      const entry = this.undoStack.pop()
      if (entry) {
        this.releaseEntry(entry)
      }
    }
    this.clearRedoStack()
  }

  private acquireEntry(
    snapshot: EditorCharacterBodyDrawerHistorySnapshot
  ): EditorCharacterBodyDrawerHistoryEntry {
    const entry = this.entryPool.pop()
    if (entry) {
      entry.snapshot = snapshot
      return entry
    }
    return { snapshot }
  }

  private releaseEntry(entry: EditorCharacterBodyDrawerHistoryEntry) {
    this.entryPool.push(entry)
  }
}

export class EditorCharacterBodyDrawer {
  private maskCanvas = document.createElement('canvas')
  private shapeCanvas = document.createElement('canvas')
  private textureCanvas = document.createElement('canvas')
  private outputCanvas = document.createElement('canvas')

  constructor() {
    this.maskCanvas.width = CHARACTER_BODY_DRAW_SIZE
    this.maskCanvas.height = CHARACTER_BODY_DRAW_SIZE
    this.shapeCanvas.width = CHARACTER_BODY_DRAW_SIZE
    this.shapeCanvas.height = CHARACTER_BODY_DRAW_SIZE
    this.textureCanvas.width = CHARACTER_BODY_DRAW_SIZE
    this.textureCanvas.height = CHARACTER_BODY_DRAW_SIZE
    this.outputCanvas.width = CHARACTER_BODY_DRAW_SIZE
    this.outputCanvas.height = CHARACTER_BODY_DRAW_SIZE
  }

  async show(
    options: EditorCharacterBodyDrawerOptions
  ): Promise<MapCharacterBodyProfile | null | undefined> {
    const viewport = document.getElementById('gameViewport')
    if (!(viewport instanceof HTMLElement)) {
      return undefined
    }

    const { modal, close } = EditorUIHelper.createModal({ zIndex: 10002 })
    modal.tabIndex = -1
    modal.style.padding = '12px'
    modal.style.boxSizing = 'border-box'
    modal.style.overflow = 'auto'

    const form = EditorUIHelper.createFormContainer({ minWidth: '920px' })
    form.style.minWidth = 'min(920px, calc(100% - 24px))'
    form.style.width = 'min(920px, calc(100% - 24px))'
    form.style.maxWidth = 'calc(100% - 48px)'
    form.style.maxHeight = 'calc(100% - 48px)'
    form.style.padding = '20px'
    form.style.overflow = 'hidden'

    const title = EditorUIHelper.createFormTitle(options.title)
    form.appendChild(title)

    const content = document.createElement('div')
    content.style.cssText =
      'display:flex;gap:16px;align-items:stretch;min-height:0;flex:1 1 auto;overflow:auto;flex-wrap:wrap;'
    form.appendChild(content)

    const sidebar = document.createElement('div')
    sidebar.style.cssText =
      'width:220px;max-width:100%;display:flex;flex-direction:column;gap:12px;flex:0 0 auto;overflow-y:auto;'
    content.appendChild(sidebar)

    const canvasWrap = document.createElement('div')
    canvasWrap.style.cssText =
      'flex:1 1 320px;display:flex;align-items:center;justify-content:center;min-width:0;overflow:auto;position:relative;'
    content.appendChild(canvasWrap)

    const drawCanvas = document.createElement('canvas')
    drawCanvas.width = CHARACTER_BODY_DRAW_SIZE
    drawCanvas.height = CHARACTER_BODY_DRAW_SIZE
    drawCanvas.style.cssText = [
      `width:${DISPLAY_SIZE}px`,
      `height:${DISPLAY_SIZE}px`,
      'display:block',
      'image-rendering:pixelated',
      'background:rgba(0,0,0,0.65)',
      'border:1px solid rgba(255,255,255,0.2)',
      'touch-action:none',
      'pointer-events:auto',
      'user-select:none',
      'cursor:none',
    ].join(';')
    canvasWrap.appendChild(drawCanvas)

    const cursorEl = document.createElement('div')
    cursorEl.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'width:0',
      'height:0',
      'border:1px solid rgba(0,0,0,0.95)',
      'border-radius:50%',
      'pointer-events:none',
      'transform:translate(-50%,-50%)',
      'display:none',
      'box-sizing:border-box',
      'background:#ffffff',
      'box-shadow:0 0 0 1px rgba(255,255,255,0.95)',
      'opacity:0.95',
    ].join(';')
    canvasWrap.appendChild(cursorEl)

    const info = document.createElement('div')
    info.textContent = localizer.t('editor_body_drawer_hint')
    info.style.cssText =
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.72);'
    sidebar.appendChild(info)

    const modeRow = EditorUIHelper.createButtonRow({
      gap: '8px',
      marginTop: '0',
      justifyContent: 'flex-start',
    })
    sidebar.appendChild(modeRow)

    const brushRow = EditorUIHelper.createFormRow(
      localizer.t('editor_body_drawer_brush'),
      { labelWidth: '68px', marginBottom: '0' }
    )
    const brushControls = document.createElement('div')
    brushControls.style.cssText =
      'display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0;'
    const brushSlider = document.createElement('input')
    brushSlider.type = 'range'
    brushSlider.min = String(MIN_BRUSH_SIZE)
    brushSlider.max = String(MAX_BRUSH_SIZE)
    brushSlider.step = '1'
    brushSlider.value = String(DEFAULT_BRUSH_SIZE)
    brushSlider.style.cssText = 'width:120px;max-width:120px;cursor:pointer;'
    const brushValueText = document.createElement('span')
    brushValueText.textContent = String(DEFAULT_BRUSH_SIZE)
    brushValueText.style.cssText =
      'display:inline-block;min-width:24px;font-size:12px;text-align:right;'
    brushControls.appendChild(brushSlider)
    brushControls.appendChild(brushValueText)
    brushRow.row.appendChild(brushControls)
    sidebar.appendChild(brushRow.row)

    const colorRow = EditorUIHelper.createFormRow(
      localizer.t('editor_body_drawer_color'),
      { labelWidth: '68px', marginBottom: '0' }
    )
    const colorInput = EditorUIHelper.createColorInput('#d6a86c')
    colorInput.value =
      options.initialProfile?.color ?? options.initialColor ?? colorInput.value
    colorRow.row.appendChild(colorInput)
    sidebar.appendChild(colorRow.row)

    const actionRow = document.createElement('div')
    actionRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;'
    sidebar.appendChild(actionRow)

    const resetShapeBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_reset_shape')
    )
    const clearTextureBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_clear_texture')
    )
    actionRow.appendChild(resetShapeBtn)
    actionRow.appendChild(clearTextureBtn)

    const footer = EditorUIHelper.createButtonRow({
      gap: '12px',
      marginTop: '16px',
    })
    const confirmBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_confirm'),
      { primary: true }
    )
    const cancelBtn = EditorUIHelper.createButton(
      localizer.t('editor_btn_cancel')
    )
    footer.appendChild(confirmBtn)
    footer.appendChild(cancelBtn)
    form.appendChild(footer)

    modal.appendChild(form)
    viewport.appendChild(modal)
    modal.focus({ preventScroll: true })

    const drawCtx = drawCanvas.getContext('2d')
    const maskCtx = this.maskCanvas.getContext('2d')
    const shapeCtx = this.shapeCanvas.getContext('2d')
    const textureCtx = this.textureCanvas.getContext('2d')
    const outputCtx = this.outputCanvas.getContext('2d')
    if (!drawCtx || !maskCtx || !shapeCtx || !textureCtx || !outputCtx) {
      close()
      return undefined
    }

    let mode: BodyDrawMode = 'shape'
    let pointerActive = false
    let pointerChanged = false
    let settingsChanged = false
    let lastX = 0
    let lastY = 0
    let eyeX = DEFAULT_CHARACTER_EYE_X
    let eyeY = DEFAULT_CHARACTER_EYE_Y
    let resolved = false

    const captureHistorySnapshot =
      (): EditorCharacterBodyDrawerHistorySnapshot => {
        return {
          mask: maskCtx.getImageData(
            0,
            0,
            CHARACTER_BODY_DRAW_SIZE,
            CHARACTER_BODY_DRAW_SIZE
          ),
          shape: shapeCtx.getImageData(
            0,
            0,
            CHARACTER_BODY_DRAW_SIZE,
            CHARACTER_BODY_DRAW_SIZE
          ),
          texture: textureCtx.getImageData(
            0,
            0,
            CHARACTER_BODY_DRAW_SIZE,
            CHARACTER_BODY_DRAW_SIZE
          ),
          brushSize: brushSlider.value,
          color: colorInput.value,
          eyeX,
          eyeY,
        }
      }

    const applyHistorySnapshot = (
      snapshot: EditorCharacterBodyDrawerHistorySnapshot
    ) => {
      maskCtx.putImageData(snapshot.mask, 0, 0)
      shapeCtx.putImageData(snapshot.shape, 0, 0)
      textureCtx.putImageData(snapshot.texture, 0, 0)
      syncBrushValue(snapshot.brushSize)
      colorInput.value = snapshot.color
      eyeX = snapshot.eyeX
      eyeY = snapshot.eyeY
      renderComposite()
      updateCursorVisual()
    }

    const flushSettingHistory = () => {
      if (!settingsChanged) {
        return
      }
      settingsChanged = false
      historyManager.capture()
    }

    const historyManager = new EditorCharacterBodyDrawerHistoryManager(
      {
        captureSnapshot: captureHistorySnapshot,
        applySnapshot: applyHistorySnapshot,
      },
      DRAWER_HISTORY_MAX_ENTRIES
    )

    const shapeBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_shape'),
      { primary: true }
    )
    const eraseBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_erase')
    )
    const textureBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_texture')
    )
    const eyeBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_eye')
    )
    modeRow.appendChild(shapeBtn)
    modeRow.appendChild(eraseBtn)
    modeRow.appendChild(textureBtn)
    modeRow.appendChild(eyeBtn)

    const getBrushSize = (): number => {
      const parsed = Number.parseInt(brushSlider.value, 10)
      if (!Number.isFinite(parsed)) {
        return DEFAULT_BRUSH_SIZE
      }
      return Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, parsed))
    }

    const updateModeButtons = () => {
      const applyActive = (button: HTMLButtonElement, active: boolean) => {
        button.style.background = active
          ? 'rgba(255,255,255,0.18)'
          : 'rgba(255,255,255,0.08)'
        button.style.borderColor = active
          ? 'rgba(255,255,255,0.4)'
          : 'rgba(255,255,255,0.25)'
      }
      applyActive(shapeBtn, mode === 'shape')
      applyActive(eraseBtn, mode === 'erase')
      applyActive(textureBtn, mode === 'texture')
      applyActive(eyeBtn, mode === 'eye')
    }

    const updateCursorVisual = () => {
      const rect = drawCanvas.getBoundingClientRect()
      const sizePx =
        mode === 'eye'
          ? EYE_CURSOR_SIZE
          : Math.max(
              2,
              Math.round(
                (getBrushSize() * rect.width) / CHARACTER_BODY_DRAW_SIZE
              )
            )
      cursorEl.style.width = `${sizePx}px`
      cursorEl.style.height = `${sizePx}px`
      cursorEl.style.borderColor = 'rgba(0,0,0,0.95)'
      cursorEl.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.95)'
      cursorEl.style.background =
        mode === 'erase' ? 'rgba(245,245,240,0.92)' : colorInput.value
    }

    const renderComposite = () => {
      drawCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )

      drawCtx.drawImage(this.shapeCanvas, 0, 0)

      drawCtx.save()
      drawCtx.globalCompositeOperation = 'source-atop'
      drawCtx.drawImage(this.textureCanvas, 0, 0)
      drawCtx.restore()

      drawCtx.save()
      drawCtx.globalCompositeOperation = 'destination-over'
      drawCtx.fillStyle = '#090705'
      drawCtx.fillRect(0, 0, CHARACTER_BODY_DRAW_SIZE, CHARACTER_BODY_DRAW_SIZE)
      drawCtx.restore()

      drawCtx.save()
      drawCtx.translate(CHARACTER_BODY_DRAW_HALF, CHARACTER_BODY_DRAW_HALF)
      renderBodyEye(
        drawCtx,
        CHARACTER_BODY_DRAW_HALF,
        CHARACTER_BODY_DRAW_HALF,
        CHARACTER_BODY_DRAW_SIZE,
        1,
        { points: [], eyeX, eyeY },
        '#17120e'
      )
      drawCtx.restore()

      if (mode === 'eye') {
        drawCtx.save()
        drawCtx.translate(CHARACTER_BODY_DRAW_HALF, CHARACTER_BODY_DRAW_HALF)
        drawCtx.strokeStyle = 'rgba(255,245,220,0.95)'
        drawCtx.lineWidth = 1
        drawCtx.beginPath()
        drawCtx.arc(eyeX, eyeY, 10, 0, Math.PI * 2)
        drawCtx.stroke()
        drawCtx.beginPath()
        drawCtx.moveTo(eyeX - 12, eyeY)
        drawCtx.lineTo(eyeX + 12, eyeY)
        drawCtx.moveTo(eyeX, eyeY - 12)
        drawCtx.lineTo(eyeX, eyeY + 12)
        drawCtx.stroke()
        drawCtx.restore()
      }

      drawCtx.strokeStyle = 'rgba(255,255,255,0.18)'
      drawCtx.lineWidth = 1
      drawCtx.strokeRect(
        0.5,
        0.5,
        CHARACTER_BODY_DRAW_SIZE - 1,
        CHARACTER_BODY_DRAW_SIZE - 1
      )
      drawCtx.beginPath()
      drawCtx.moveTo(CHARACTER_BODY_DRAW_HALF + 0.5, 0)
      drawCtx.lineTo(CHARACTER_BODY_DRAW_HALF + 0.5, CHARACTER_BODY_DRAW_SIZE)
      drawCtx.moveTo(0, CHARACTER_BODY_DRAW_HALF + 0.5)
      drawCtx.lineTo(CHARACTER_BODY_DRAW_SIZE, CHARACTER_BODY_DRAW_HALF + 0.5)
      drawCtx.stroke()
    }

    const syncBrushValue = (value: string) => {
      const parsed = Number.parseInt(value, 10)
      const safeValue = Number.isFinite(parsed)
        ? Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, parsed))
        : DEFAULT_BRUSH_SIZE
      const text = String(safeValue)
      brushSlider.value = text
      brushValueText.textContent = text
      updateCursorVisual()
    }

    const getCanvasPoint = (event: PointerEvent): { x: number; y: number } => {
      const rect = drawCanvas.getBoundingClientRect()
      const relX = (event.clientX - rect.left) / rect.width
      const relY = (event.clientY - rect.top) / rect.height
      const x = Math.max(
        0,
        Math.min(
          CHARACTER_BODY_DRAW_SIZE - 1,
          Math.round(relX * CHARACTER_BODY_DRAW_SIZE)
        )
      )
      const y = Math.max(
        0,
        Math.min(
          CHARACTER_BODY_DRAW_SIZE - 1,
          Math.round(relY * CHARACTER_BODY_DRAW_SIZE)
        )
      )
      return { x, y }
    }

    const updateCursorPosition = (point: { x: number; y: number }) => {
      const drawRect = drawCanvas.getBoundingClientRect()
      const wrapRect = canvasWrap.getBoundingClientRect()
      cursorEl.style.left = `${((point.x + 0.5) * drawRect.width) / CHARACTER_BODY_DRAW_SIZE + drawRect.left - wrapRect.left}px`
      cursorEl.style.top = `${((point.y + 0.5) * drawRect.height) / CHARACTER_BODY_DRAW_SIZE + drawRect.top - wrapRect.top}px`
      cursorEl.style.display = 'block'
    }

    const updateEyePosition = (point: { x: number; y: number }) => {
      const nextEyeX = clampCharacterEyeCoord(
        point.x - CHARACTER_BODY_DRAW_HALF
      )
      const nextEyeY = clampCharacterEyeCoord(
        point.y - CHARACTER_BODY_DRAW_HALF
      )
      if (nextEyeX === eyeX && nextEyeY === eyeY) {
        return
      }
      eyeX = nextEyeX
      eyeY = nextEyeY
      pointerChanged = true
      renderComposite()
    }

    const strokePath = (
      ctx: CanvasRenderingContext2D,
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      brushSize: number,
      color: string,
      composite: GlobalCompositeOperation
    ) => {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.lineWidth = brushSize
      ctx.globalCompositeOperation = composite
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.moveTo(fromX, fromY)
      ctx.lineTo(toX, toY)
      ctx.stroke()
      ctx.restore()
    }

    const drawStroke = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number
    ) => {
      const brushSize = getBrushSize()
      if (mode === 'erase') {
        strokePath(
          maskCtx,
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          '#000000',
          'destination-out'
        )
        strokePath(
          shapeCtx,
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          '#000000',
          'destination-out'
        )
      } else if (mode === 'shape') {
        strokePath(
          maskCtx,
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          '#ffffff',
          'source-over'
        )
        strokePath(
          shapeCtx,
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          colorInput.value,
          'source-over'
        )
      } else if (mode === 'texture') {
        strokePath(
          textureCtx,
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          colorInput.value,
          'source-over'
        )
      }
      pointerChanged = true
      renderComposite()
    }

    const loadInitialProfile = async () => {
      maskCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )
      shapeCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )
      textureCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )

      const profile = options.initialProfile
      eyeX = getCharacterEyeDrawX(profile)
      eyeY = getCharacterEyeDrawY(profile)
      if (profile && profile.points.length >= 6) {
        maskCtx.save()
        maskCtx.translate(CHARACTER_BODY_DRAW_HALF, CHARACTER_BODY_DRAW_HALF)
        maskCtx.fillStyle = '#ffffff'
        maskCtx.beginPath()
        maskCtx.moveTo(profile.points[0], profile.points[1])
        shapeCtx.save()
        shapeCtx.translate(CHARACTER_BODY_DRAW_HALF, CHARACTER_BODY_DRAW_HALF)
        shapeCtx.fillStyle = colorInput.value
        shapeCtx.beginPath()
        shapeCtx.moveTo(profile.points[0], profile.points[1])
        for (let i = 2; i < profile.points.length; i += 2) {
          maskCtx.lineTo(profile.points[i], profile.points[i + 1])
          shapeCtx.lineTo(profile.points[i], profile.points[i + 1])
        }
        maskCtx.closePath()
        shapeCtx.closePath()
        maskCtx.fill()
        shapeCtx.fill()
        maskCtx.restore()
        shapeCtx.restore()

        const surfaceDataUrl = profile.surfaceDataUrl
        if (surfaceDataUrl) {
          const image = await this.loadImage(surfaceDataUrl)
          if (image) {
            shapeCtx.drawImage(
              image,
              0,
              0,
              CHARACTER_BODY_DRAW_SIZE,
              CHARACTER_BODY_DRAW_SIZE
            )
          }
        } else if (profile.textureDataUrl) {
          const image = await this.loadImage(profile.textureDataUrl)
          if (image) {
            textureCtx.drawImage(
              image,
              0,
              0,
              CHARACTER_BODY_DRAW_SIZE,
              CHARACTER_BODY_DRAW_SIZE
            )
          }
        }
      } else {
        this.paintDefaultShape(
          maskCtx,
          shapeCtx,
          options.defaultBodyWidth ?? 1,
          options.defaultBodyHeight ?? 1,
          colorInput.value
        )
      }
      renderComposite()
    }

    shapeBtn.addEventListener('click', () => {
      mode = 'shape'
      updateModeButtons()
      updateCursorVisual()
    })
    eraseBtn.addEventListener('click', () => {
      mode = 'erase'
      updateModeButtons()
      updateCursorVisual()
    })
    textureBtn.addEventListener('click', () => {
      mode = 'texture'
      updateModeButtons()
      updateCursorVisual()
    })
    eyeBtn.addEventListener('click', () => {
      mode = 'eye'
      updateModeButtons()
      updateCursorVisual()
    })
    resetShapeBtn.addEventListener('click', () => {
      flushSettingHistory()
      maskCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )
      shapeCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )
      eyeX = DEFAULT_CHARACTER_EYE_X
      eyeY = DEFAULT_CHARACTER_EYE_Y
      this.paintDefaultShape(
        maskCtx,
        shapeCtx,
        options.defaultBodyWidth ?? 1,
        options.defaultBodyHeight ?? 1,
        colorInput.value
      )
      renderComposite()
      historyManager.capture()
    })
    clearTextureBtn.addEventListener('click', () => {
      flushSettingHistory()
      textureCtx.clearRect(
        0,
        0,
        CHARACTER_BODY_DRAW_SIZE,
        CHARACTER_BODY_DRAW_SIZE
      )
      renderComposite()
      historyManager.capture()
    })
    colorInput.addEventListener('input', () => {
      settingsChanged = true
      updateCursorVisual()
    })
    colorInput.addEventListener('change', () => {
      flushSettingHistory()
    })
    brushSlider.addEventListener('input', () => {
      syncBrushValue(brushSlider.value)
      settingsChanged = true
    })
    brushSlider.addEventListener('change', () => {
      flushSettingHistory()
    })

    drawCanvas.addEventListener('pointerenter', (event) => {
      const point = getCanvasPoint(event)
      updateCursorPosition(point)
      updateCursorVisual()
    })
    drawCanvas.addEventListener('pointerleave', () => {
      if (!pointerActive) {
        cursorEl.style.display = 'none'
      }
    })

    drawCanvas.addEventListener(
      'pointerdown',
      (event) => {
        flushSettingHistory()
        const point = getCanvasPoint(event)
        updateCursorPosition(point)
        pointerActive = true
        pointerChanged = false
        lastX = point.x
        lastY = point.y
        drawCanvas.setPointerCapture(event.pointerId)
        if (mode === 'eye') {
          updateEyePosition(point)
        } else {
          drawStroke(point.x, point.y, point.x, point.y)
        }
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )

    drawCanvas.addEventListener(
      'pointermove',
      (event) => {
        const point = getCanvasPoint(event)
        updateCursorPosition(point)
        if (!pointerActive) {
          return
        }
        if (mode === 'eye') {
          updateEyePosition(point)
        } else {
          drawStroke(lastX, lastY, point.x, point.y)
        }
        lastX = point.x
        lastY = point.y
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )

    const stopPointer = (event: PointerEvent) => {
      if (!pointerActive) {
        return
      }
      pointerActive = false
      if (pointerChanged) {
        pointerChanged = false
        historyManager.capture()
      }
      if (drawCanvas.hasPointerCapture(event.pointerId)) {
        drawCanvas.releasePointerCapture(event.pointerId)
      }
      cursorEl.style.display = 'none'
      event.preventDefault()
      event.stopPropagation()
    }
    drawCanvas.addEventListener('pointerup', stopPointer, true)
    drawCanvas.addEventListener('pointercancel', stopPointer, true)

    modal.addEventListener(
      'keydown',
      (event) => {
        if (settingsChanged) {
          settingsChanged = false
        }
        if (!(event.ctrlKey || event.metaKey)) {
          return
        }
        if (event.key.toLowerCase() !== 'z') {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) {
          historyManager.redo()
        } else {
          historyManager.undo()
        }
      },
      true
    )

    const finish = (
      value: MapCharacterBodyProfile | null | undefined
    ): MapCharacterBodyProfile | null | undefined => {
      if (resolved) {
        return undefined
      }
      resolved = true
      close()
      return value
    }

    const promise = new Promise<MapCharacterBodyProfile | null | undefined>(
      (resolve) => {
        confirmBtn.addEventListener('click', () => {
          resolve(
            finish(
              this.buildProfile(
                maskCtx,
                shapeCtx,
                textureCtx,
                outputCtx,
                eyeX,
                eyeY
              )
            )
          )
        })
        cancelBtn.addEventListener('click', () => {
          resolve(finish(undefined))
        })
        modal.addEventListener('click', (event) => {
          if (event.target === modal) {
            resolve(finish(undefined))
          }
        })
      }
    )

    updateModeButtons()
    syncBrushValue(String(DEFAULT_BRUSH_SIZE))
    await loadInitialProfile()
    historyManager.reset()
    return promise
  }

  private paintDefaultShape(
    maskCtx: CanvasRenderingContext2D,
    shapeCtx: CanvasRenderingContext2D,
    widthMeters: number,
    heightMeters: number,
    color: string
  ): void {
    const safeWidth = widthMeters > 0 ? widthMeters : 1
    const safeHeight = heightMeters > 0 ? heightMeters : safeWidth
    const maxRadius = 52
    let radiusX = maxRadius
    let radiusY = Math.round((maxRadius * safeHeight) / safeWidth)
    if (radiusY > maxRadius) {
      radiusY = maxRadius
      radiusX = Math.round((maxRadius * safeWidth) / safeHeight)
    }
    radiusX = Math.max(8, radiusX)
    radiusY = Math.max(8, radiusY)

    maskCtx.save()
    shapeCtx.save()
    maskCtx.fillStyle = '#ffffff'
    shapeCtx.fillStyle = color
    maskCtx.beginPath()
    shapeCtx.beginPath()
    maskCtx.ellipse(
      CHARACTER_BODY_DRAW_HALF,
      CHARACTER_BODY_DRAW_HALF,
      radiusX,
      radiusY,
      0,
      0,
      Math.PI * 2
    )
    shapeCtx.ellipse(
      CHARACTER_BODY_DRAW_HALF,
      CHARACTER_BODY_DRAW_HALF,
      radiusX,
      radiusY,
      0,
      0,
      Math.PI * 2
    )
    maskCtx.fill()
    shapeCtx.fill()
    maskCtx.restore()
    shapeCtx.restore()
  }

  private async loadImage(url: string): Promise<HTMLImageElement | null> {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = url
    })
  }

  private buildProfile(
    maskCtx: CanvasRenderingContext2D,
    shapeCtx: CanvasRenderingContext2D,
    textureCtx: CanvasRenderingContext2D,
    outputCtx: CanvasRenderingContext2D,
    eyeX: number,
    eyeY: number
  ): MapCharacterBodyProfile | null {
    const size = CHARACTER_BODY_DRAW_SIZE
    const imageData = maskCtx.getImageData(0, 0, size, size).data
    const filled = new Uint8Array(size * size)
    let minX = size
    let minY = size
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < size; y++) {
      const rowOffset = y * size
      for (let x = 0; x < size; x++) {
        const index = rowOffset + x
        if (imageData[index * 4 + 3] < MASK_ALPHA_THRESHOLD) {
          continue
        }
        filled[index] = 1
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }

    if (maxX < minX || maxY < minY) {
      return null
    }

    const loops = this.extractMaskLoops(filled, size, size)
    const loop = this.pickLargestLoop(loops)
    if (!loop || loop.length < 6) {
      return null
    }

    const normalized = this.normalizeLoop(loop, minX, minY, maxX + 1, maxY + 1)
    const simplified = this.limitLoopPoints(normalized, MAX_PROFILE_POINTS)
    if (simplified.length < 6) {
      return null
    }

    const surfaceDataUrl = this.buildSurfaceDataUrl(
      shapeCtx,
      textureCtx,
      outputCtx,
      minX,
      minY,
      maxX + 1,
      maxY + 1
    )

    return {
      points: simplified,
      eyeX,
      eyeY,
      surfaceDataUrl: surfaceDataUrl ?? undefined,
    }
  }

  private extractMaskLoops(
    filled: Uint8Array,
    width: number,
    height: number
  ): number[][] {
    const edges = new Map<string, string[]>()
    const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
      const key = `${x1},${y1}`
      const nextKey = `${x2},${y2}`
      const list = edges.get(key)
      if (list) {
        list.push(nextKey)
      } else {
        edges.set(key, [nextKey])
      }
    }
    const isFilled = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return false
      }
      return filled[y * width + x] === 1
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isFilled(x, y)) {
          continue
        }
        if (!isFilled(x, y - 1)) {
          addEdge(x, y, x + 1, y)
        }
        if (!isFilled(x + 1, y)) {
          addEdge(x + 1, y, x + 1, y + 1)
        }
        if (!isFilled(x, y + 1)) {
          addEdge(x + 1, y + 1, x, y + 1)
        }
        if (!isFilled(x - 1, y)) {
          addEdge(x, y + 1, x, y)
        }
      }
    }

    const loops: number[][] = []
    for (const [startKey, list] of edges.entries()) {
      while (list.length > 0) {
        const loop: number[] = []
        let currentKey = startKey
        while (true) {
          const splitIndex = currentKey.indexOf(',')
          const x = Number.parseInt(currentKey.slice(0, splitIndex), 10)
          const y = Number.parseInt(currentKey.slice(splitIndex + 1), 10)
          loop.push(x, y)
          const nextList = edges.get(currentKey)
          if (!nextList || nextList.length === 0) {
            break
          }
          currentKey = nextList.pop() as string
          if (currentKey === startKey) {
            break
          }
        }
        if (loop.length >= 6) {
          loops.push(loop)
        }
      }
    }
    return loops
  }

  private pickLargestLoop(loops: number[][]): number[] | null {
    let best: number[] | null = null
    let bestArea = 0
    for (let i = 0; i < loops.length; i++) {
      const area = Math.abs(this.computeLoopArea(loops[i]))
      if (area > bestArea) {
        bestArea = area
        best = loops[i]
      }
    }
    return best
  }

  private computeLoopArea(points: number[]): number {
    let area = 0
    const count = points.length / 2
    for (let i = 0; i < count; i++) {
      const currentIndex = i * 2
      const nextIndex = ((i + 1) % count) * 2
      area +=
        points[currentIndex] * points[nextIndex + 1] -
        points[nextIndex] * points[currentIndex + 1]
    }
    return area * 0.5
  }

  private normalizeLoop(
    points: number[],
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): number[] {
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const centerX = (minX + maxX) * 0.5
    const centerY = (minY + maxY) * 0.5
    const normalized = new Array<number>(points.length)
    for (let i = 0; i < points.length; i += 2) {
      normalized[i] = Math.round(
        ((points[i] - centerX) * CHARACTER_BODY_DRAW_SIZE) / width
      )
      normalized[i + 1] = Math.round(
        ((points[i + 1] - centerY) * CHARACTER_BODY_DRAW_SIZE) / height
      )
    }
    return normalized
  }

  private limitLoopPoints(points: number[], maxPoints: number): number[] {
    const normalized = this.removeCollinearLoopPoints(points)
    if (normalized.length / 2 <= maxPoints) {
      return normalized
    }
    const source = normalized.slice()
    let epsilon = 0.5
    let simplified = source
    while (simplified.length / 2 > maxPoints && epsilon <= 16) {
      simplified = this.simplifyClosedLoop(source, epsilon)
      epsilon *= 2
    }
    if (simplified.length / 2 <= maxPoints) {
      return simplified
    }
    const step = Math.ceil(simplified.length / 2 / maxPoints)
    const sampled: number[] = []
    for (let i = 0; i < simplified.length; i += step * 2) {
      sampled.push(simplified[i], simplified[i + 1])
    }
    return this.removeCollinearLoopPoints(sampled)
  }

  private removeCollinearLoopPoints(points: number[]): number[] {
    const result: number[] = []
    const count = points.length / 2
    for (let i = 0; i < count; i++) {
      const prevIndex = ((i - 1 + count) % count) * 2
      const currentIndex = i * 2
      const nextIndex = ((i + 1) % count) * 2
      const ax = points[currentIndex] - points[prevIndex]
      const ay = points[currentIndex + 1] - points[prevIndex + 1]
      const bx = points[nextIndex] - points[currentIndex]
      const by = points[nextIndex + 1] - points[currentIndex + 1]
      if (ax * by - ay * bx === 0) {
        continue
      }
      result.push(points[currentIndex], points[currentIndex + 1])
    }
    return result
  }

  private simplifyClosedLoop(points: number[], epsilon: number): number[] {
    const openPoints = points.slice()
    openPoints.push(points[0], points[1])
    const simplified = this.simplifyOpenPolyline(openPoints, epsilon)
    simplified.splice(simplified.length - 2, 2)
    return this.removeCollinearLoopPoints(simplified)
  }

  private simplifyOpenPolyline(points: number[], epsilon: number): number[] {
    const pointCount = points.length / 2
    if (pointCount <= 2) {
      return points.slice()
    }
    const keep = new Uint8Array(pointCount)
    keep[0] = 1
    keep[pointCount - 1] = 1
    this.markDouglasPeucker(points, 0, pointCount - 1, epsilon, keep)
    const result: number[] = []
    for (let i = 0; i < pointCount; i++) {
      if (keep[i] !== 1) {
        continue
      }
      result.push(points[i * 2], points[i * 2 + 1])
    }
    return result
  }

  private markDouglasPeucker(
    points: number[],
    startIndex: number,
    endIndex: number,
    epsilon: number,
    keep: Uint8Array
  ): void {
    if (endIndex - startIndex <= 1) {
      return
    }
    const startX = points[startIndex * 2]
    const startY = points[startIndex * 2 + 1]
    const endX = points[endIndex * 2]
    const endY = points[endIndex * 2 + 1]
    let maxDistance = 0
    let splitIndex = -1
    for (let i = startIndex + 1; i < endIndex; i++) {
      const x = points[i * 2]
      const y = points[i * 2 + 1]
      const distance = this.distanceToSegmentSquared(
        x,
        y,
        startX,
        startY,
        endX,
        endY
      )
      if (distance > maxDistance) {
        maxDistance = distance
        splitIndex = i
      }
    }
    if (splitIndex === -1 || maxDistance <= epsilon * epsilon) {
      return
    }
    keep[splitIndex] = 1
    this.markDouglasPeucker(points, startIndex, splitIndex, epsilon, keep)
    this.markDouglasPeucker(points, splitIndex, endIndex, epsilon, keep)
  }

  private distanceToSegmentSquared(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1
    const dy = y2 - y1
    if (dx === 0 && dy === 0) {
      const rx = px - x1
      const ry = py - y1
      return rx * rx + ry * ry
    }
    const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t
    const cx = x1 + dx * clamped
    const cy = y1 + dy * clamped
    const rx = px - cx
    const ry = py - cy
    return rx * rx + ry * ry
  }

  private buildSurfaceDataUrl(
    shapeCtx: CanvasRenderingContext2D,
    textureCtx: CanvasRenderingContext2D,
    outputCtx: CanvasRenderingContext2D,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): string | null {
    outputCtx.clearRect(
      0,
      0,
      CHARACTER_BODY_DRAW_SIZE,
      CHARACTER_BODY_DRAW_SIZE
    )
    outputCtx.drawImage(
      shapeCtx.canvas,
      minX,
      minY,
      maxX - minX,
      maxY - minY,
      0,
      0,
      CHARACTER_BODY_DRAW_SIZE,
      CHARACTER_BODY_DRAW_SIZE
    )
    outputCtx.globalCompositeOperation = 'source-atop'
    outputCtx.drawImage(
      textureCtx.canvas,
      minX,
      minY,
      maxX - minX,
      maxY - minY,
      0,
      0,
      CHARACTER_BODY_DRAW_SIZE,
      CHARACTER_BODY_DRAW_SIZE
    )
    outputCtx.globalCompositeOperation = 'source-over'
    const alpha = outputCtx.getImageData(
      0,
      0,
      CHARACTER_BODY_DRAW_SIZE,
      CHARACTER_BODY_DRAW_SIZE
    ).data
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i] >= MASK_ALPHA_THRESHOLD) {
        return this.outputCanvas.toDataURL('image/png')
      }
    }
    return null
  }
}
