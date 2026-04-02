import {
  isSimple,
  makeCCW,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import { localizer } from '../Localizer'
import {
  DEFAULT_CHARACTER_EYE_X,
  DEFAULT_CHARACTER_EYE_Y,
  getCharacterEyeDrawX,
  getCharacterEyeDrawY,
} from '../characterBodyProfile'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import { EditorUIHelper } from './EditorUIHelper'

type BodyDrawMode = 'contour' | 'shape' | 'fill' | 'erase' | 'texture' | 'eye'
type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]

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
const DRAWER_HISTORY_MAX_ENTRIES = 8
const PROFILE_POINT_PRECISION = 0.0001
const CONTOUR_CURSOR_SIZE = 10
const CONTOUR_MIN_POINT_COUNT = 3
const CONTOUR_GUIDE_POINT_RADIUS = 3
const CONTOUR_SELECT_DISTANCE_SQ = 100
const CONTOUR_EDGE_SELECT_DISTANCE_SQ = 100
const DRAW_WORLD_SIZE = DISPLAY_SIZE * 3
const DRAW_WORLD_HALF = DRAW_WORLD_SIZE / 2
const CANVAS_ZOOM_MIN_PERCENT = 25
const CANVAS_ZOOM_MAX_PERCENT = 300
const CANVAS_ZOOM_STEP_PERCENT = 25
const CANVAS_ZOOM_DEFAULT_PERCENT = 100
const DEFAULT_CONTOUR_SEGMENTS = 16
const MAX_EDITOR_CONTOUR_POINTS = 96
const LEGACY_PROFILE_REFERENCE_SIZE = 128

interface EditorCharacterBodyDrawerHistorySnapshot {
  mask: ImageData
  shape: ImageData
  texture: ImageData
  brushSize: string
  color: string
  bloodColor: string
  bloodColorAssigned: boolean
  eyeX: number
  eyeY: number
  contourPoints: number[]
  contourClosed: boolean
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
    this.maskCanvas.width = DRAW_WORLD_SIZE
    this.maskCanvas.height = DRAW_WORLD_SIZE
    this.shapeCanvas.width = DRAW_WORLD_SIZE
    this.shapeCanvas.height = DRAW_WORLD_SIZE
    this.textureCanvas.width = DRAW_WORLD_SIZE
    this.textureCanvas.height = DRAW_WORLD_SIZE
    this.outputCanvas.width = LEGACY_PROFILE_REFERENCE_SIZE
    this.outputCanvas.height = LEGACY_PROFILE_REFERENCE_SIZE
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

    const canvasColumn = document.createElement('div')
    canvasColumn.style.cssText =
      'flex:1 1 320px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-width:0;min-height:0;overflow:hidden;'
    content.appendChild(canvasColumn)

    const canvasWrap = document.createElement('div')
    canvasWrap.style.cssText =
      'flex:1 1 auto;width:100%;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;position:relative;'
    canvasColumn.appendChild(canvasWrap)

    const drawCanvas = document.createElement('canvas')
    drawCanvas.width = DISPLAY_SIZE
    drawCanvas.height = DISPLAY_SIZE
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

    const canvasFooter = document.createElement('div')
    canvasFooter.style.cssText =
      'flex:0 0 auto;width:100%;min-height:52px;padding-top:10px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:8px;box-sizing:border-box;'
    canvasColumn.appendChild(canvasFooter)

    const alertEl = document.createElement('div')
    alertEl.style.cssText = [
      'min-height:16px',
      'font-size:11px',
      'line-height:1.4',
      'text-align:center',
      'color:#e2b73c',
      'display:none',
      'width:100%',
    ].join(';')
    canvasFooter.appendChild(alertEl)

    const zoomRow = document.createElement('div')
    zoomRow.style.cssText =
      'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;width:100%;'
    const zoomLabel = document.createElement('span')
    zoomLabel.textContent = localizer.t('editor_body_drawer_zoom')
    zoomLabel.style.cssText =
      'font-size:11px;color:rgba(255,255,255,0.78);line-height:1;'
    const zoomSlider = document.createElement('input')
    zoomSlider.type = 'range'
    zoomSlider.min = String(CANVAS_ZOOM_MIN_PERCENT)
    zoomSlider.max = String(CANVAS_ZOOM_MAX_PERCENT)
    zoomSlider.step = String(CANVAS_ZOOM_STEP_PERCENT)
    zoomSlider.value = String(CANVAS_ZOOM_DEFAULT_PERCENT)
    zoomSlider.style.cssText = 'width:160px;max-width:160px;cursor:pointer;'
    const zoomValueText = document.createElement('span')
    zoomValueText.textContent = `${CANVAS_ZOOM_DEFAULT_PERCENT}%`
    zoomValueText.style.cssText =
      'min-width:40px;font-size:11px;line-height:1;text-align:right;color:rgba(255,255,255,0.92);'
    zoomRow.appendChild(zoomLabel)
    zoomRow.appendChild(zoomSlider)
    zoomRow.appendChild(zoomValueText)
    canvasFooter.appendChild(zoomRow)

    const contourMenu = document.createElement('div')
    contourMenu.style.cssText = [
      'position:absolute',
      'display:none',
      'flex-direction:column',
      'gap:4px',
      'padding:6px',
      'background:rgba(10,9,7,0.96)',
      'border:1px solid rgba(255,255,255,0.16)',
      'z-index:2',
      'min-width:112px',
      'box-sizing:border-box',
    ].join(';')
    const addContourPointBtn = EditorUIHelper.createButton(
      localizer.t('editor_polygon_menu_add_point')
    )
    const removeContourPointBtn = EditorUIHelper.createButton(
      localizer.t('editor_polygon_menu_remove_point')
    )
    contourMenu.style.padding = '0'
    contourMenu.style.border = 'none'
    addContourPointBtn.style.padding = '6px 10px'
    addContourPointBtn.style.fontSize = '11px'
    addContourPointBtn.style.border = 'none'
    addContourPointBtn.style.background = 'rgba(255,255,255,0.08)'
    removeContourPointBtn.style.padding = '6px 10px'
    removeContourPointBtn.style.fontSize = '11px'
    removeContourPointBtn.style.border = 'none'
    removeContourPointBtn.style.background = 'rgba(255,255,255,0.08)'
    contourMenu.appendChild(addContourPointBtn)
    contourMenu.appendChild(removeContourPointBtn)
    canvasWrap.appendChild(contourMenu)

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
    modeRow.style.flexWrap = 'wrap'
    modeRow.style.alignItems = 'stretch'
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

    const bloodColorRow = EditorUIHelper.createFormRow(
      localizer.t('editor_body_drawer_blood_color'),
      { labelWidth: '68px', marginBottom: '0' }
    )
    const bloodColorInput = EditorUIHelper.createColorInput('#7a1010')
    bloodColorInput.value =
      options.initialProfile?.bloodColor ?? colorInput.value
    bloodColorRow.row.appendChild(bloodColorInput)
    sidebar.appendChild(bloodColorRow.row)

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

    let mode: BodyDrawMode = 'contour'
    let pointerActive = false
    let pointerChanged = false
    let settingsChanged = false
    let lastX = 0
    let lastY = 0
    let eyeX = DEFAULT_CHARACTER_EYE_X
    let eyeY = DEFAULT_CHARACTER_EYE_Y
    let resolved = false
    let contourClosed = false
    let contourPoints: number[] = []
    let selectedContourIndex = -1
    let contourDragPointIndex = -1
    let pendingContourClose = false
    let contourMenuPointIndex = -1
    let contourMenuInsertAfterIndex = -1
    let contourMenuInsertX = 0
    let contourMenuInsertY = 0
    let hoverX = 0
    let hoverY = 0
    let hoverVisible = false
    let canvasZoomPercent = CANVAS_ZOOM_DEFAULT_PERCENT
    let canvasPanActive = false
    let lastPanClientX = 0
    let lastPanClientY = 0
    let viewportScale = 1
    let viewOriginX = DRAW_WORLD_HALF - DISPLAY_SIZE * 0.5
    let viewOriginY = DRAW_WORLD_HALF - DISPLAY_SIZE * 0.5
    let shapeStrokeAnchored = false
    let bloodColorAssigned =
      typeof options.initialProfile?.bloodColor === 'string'
    const exportBaseWidth =
      options.defaultBodyWidth && options.defaultBodyWidth > 0
        ? options.defaultBodyWidth
        : 1
    const exportBaseHeight =
      options.defaultBodyHeight && options.defaultBodyHeight > 0
        ? options.defaultBodyHeight
        : exportBaseWidth
    let exportReferenceWidth = LEGACY_PROFILE_REFERENCE_SIZE
    let exportReferenceHeight = LEGACY_PROFILE_REFERENCE_SIZE

    const captureHistorySnapshot =
      (): EditorCharacterBodyDrawerHistorySnapshot => {
        return {
          mask: maskCtx.getImageData(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE),
          shape: shapeCtx.getImageData(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE),
          texture: textureCtx.getImageData(
            0,
            0,
            DRAW_WORLD_SIZE,
            DRAW_WORLD_SIZE
          ),
          brushSize: brushSlider.value,
          color: colorInput.value,
          bloodColor: bloodColorInput.value,
          bloodColorAssigned,
          eyeX,
          eyeY,
          contourPoints: contourPoints.slice(),
          contourClosed,
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
      bloodColorInput.value = snapshot.bloodColor
      bloodColorAssigned = snapshot.bloodColorAssigned
      if (!bloodColorAssigned) {
        bloodColorInput.value = colorInput.value
      }
      eyeX = snapshot.eyeX
      eyeY = snapshot.eyeY
      contourPoints = snapshot.contourPoints.slice()
      contourClosed = snapshot.contourClosed
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateCursorVisual()
      updateModeButtons()
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

    const contourBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_contour'),
      { primary: true }
    )
    const shapeBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_shape'),
      { primary: true }
    )
    const fillBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_fill')
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
    const modeButtons = [
      contourBtn,
      shapeBtn,
      fillBtn,
      eraseBtn,
      textureBtn,
      eyeBtn,
    ]
    for (let i = 0; i < modeButtons.length; i++) {
      const button = modeButtons[i]
      button.style.flex = '1 1 calc(50% - 8px)'
      button.style.minWidth = '84px'
      button.style.padding = '6px 10px'
      button.style.fontSize = '11px'
      button.style.lineHeight = '1.2'
      button.style.whiteSpace = 'nowrap'
      button.style.writingMode = 'horizontal-tb'
      button.style.textOrientation = 'mixed'
      button.style.textAlign = 'center'
      button.style.boxSizing = 'border-box'
    }
    resetShapeBtn.style.padding = '6px 10px'
    resetShapeBtn.style.fontSize = '11px'
    clearTextureBtn.style.padding = '6px 10px'
    clearTextureBtn.style.fontSize = '11px'
    modeRow.appendChild(contourBtn)
    modeRow.appendChild(shapeBtn)
    modeRow.appendChild(fillBtn)
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

    const getContourPointCount = (): number => contourPoints.length / 2

    const getContourBounds = (): {
      minX: number
      minY: number
      maxX: number
      maxY: number
      width: number
      height: number
      centerX: number
      centerY: number
    } | null => {
      if (contourPoints.length < 2) {
        return null
      }
      let minX = contourPoints[0]
      let maxX = contourPoints[0]
      let minY = contourPoints[1]
      let maxY = contourPoints[1]
      for (let i = 2; i < contourPoints.length; i += 2) {
        const pointX = contourPoints[i]
        const pointY = contourPoints[i + 1]
        if (pointX < minX) minX = pointX
        if (pointX > maxX) maxX = pointX
        if (pointY < minY) minY = pointY
        if (pointY > maxY) maxY = pointY
      }
      const width = Math.max(1, maxX - minX)
      const height = Math.max(1, maxY - minY)
      return {
        minX,
        minY,
        maxX,
        maxY,
        width,
        height,
        centerX: Math.round((minX + maxX) * 0.5),
        centerY: Math.round((minY + maxY) * 0.5),
      }
    }

    const setExportReferenceFromBounds = (
      bounds: ReturnType<typeof getContourBounds> | null
    ) => {
      if (!bounds) {
        return
      }
      exportReferenceWidth = Math.max(1, bounds.width)
      exportReferenceHeight = Math.max(1, bounds.height)
    }

    const getCanvasLocalPoint = (
      event: Pick<MouseEvent, 'clientX' | 'clientY'>
    ): { x: number; y: number } => {
      const rect = drawCanvas.getBoundingClientRect()
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
    }

    const getVisibleWorldSize = (scale: number): number =>
      scale > 0 ? DISPLAY_SIZE / scale : DISPLAY_SIZE

    const clampViewOrigin = (
      originX: number,
      originY: number
    ): { x: number; y: number } => {
      const visibleWorldSize = getVisibleWorldSize(viewportScale)
      const limit = DRAW_WORLD_SIZE - visibleWorldSize
      if (limit <= 0) {
        const centeredOrigin = Math.round(limit * 0.5)
        return { x: centeredOrigin, y: centeredOrigin }
      }
      return {
        x: Math.max(0, Math.min(limit, Math.round(originX))),
        y: Math.max(0, Math.min(limit, Math.round(originY))),
      }
    }

    const clampBodyPoint = (
      pointX: number,
      pointY: number
    ): { x: number; y: number } => {
      return {
        x: Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(pointX))),
        y: Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(pointY))),
      }
    }

    const bodyToCanvasPoint = (
      pointX: number,
      pointY: number
    ): { x: number; y: number } => {
      return {
        x: (pointX - viewOriginX) * viewportScale,
        y: (pointY - viewOriginY) * viewportScale,
      }
    }

    const hideContourMenu = () => {
      contourMenu.style.display = 'none'
      contourMenuPointIndex = -1
      contourMenuInsertAfterIndex = -1
    }

    const showContourMenu = (
      clientX: number,
      clientY: number,
      pointIndex: number,
      insertAfterIndex: number,
      insertX: number,
      insertY: number
    ) => {
      contourMenuPointIndex = pointIndex
      contourMenuInsertAfterIndex = pointIndex >= 0 ? -1 : insertAfterIndex
      contourMenuInsertX = insertX
      contourMenuInsertY = insertY
      addContourPointBtn.style.display =
        pointIndex < 0 && insertAfterIndex >= 0 ? 'block' : 'none'
      removeContourPointBtn.style.display = pointIndex >= 0 ? 'block' : 'none'
      contourMenu.style.display =
        pointIndex >= 0 || (pointIndex < 0 && insertAfterIndex >= 0)
          ? 'flex'
          : 'none'
      if (contourMenu.style.display === 'none') {
        return
      }
      contourMenu.style.left = '0px'
      contourMenu.style.top = '0px'
      const wrapRect = canvasWrap.getBoundingClientRect()
      const menuRect = contourMenu.getBoundingClientRect()
      let left = clientX - wrapRect.left
      let top = clientY - wrapRect.top
      if (left + menuRect.width > wrapRect.width - 4) {
        left = wrapRect.width - menuRect.width - 4
      }
      if (top + menuRect.height > wrapRect.height - 4) {
        top = wrapRect.height - menuRect.height - 4
      }
      if (left < 4) {
        left = 4
      }
      if (top < 4) {
        top = 4
      }
      contourMenu.style.left = `${left}px`
      contourMenu.style.top = `${top}px`
    }

    const applyCanvasZoom = (
      zoomPercent: number,
      focusClientX?: number,
      focusClientY?: number
    ) => {
      const previousScale = viewportScale
      const focusPoint =
        typeof focusClientX === 'number' && typeof focusClientY === 'number'
          ? getCanvasLocalPoint({
              clientX: focusClientX,
              clientY: focusClientY,
            })
          : { x: DISPLAY_SIZE / 2, y: DISPLAY_SIZE / 2 }
      const focusWorldX =
        previousScale > 0 ? focusPoint.x / previousScale + viewOriginX : 0
      const focusWorldY =
        previousScale > 0 ? focusPoint.y / previousScale + viewOriginY : 0
      canvasZoomPercent = Math.max(
        CANVAS_ZOOM_MIN_PERCENT,
        Math.min(CANVAS_ZOOM_MAX_PERCENT, zoomPercent)
      )
      viewportScale = Math.round((canvasZoomPercent * 1000) / 100) / 1000
      zoomSlider.value = String(canvasZoomPercent)
      zoomValueText.textContent = `${canvasZoomPercent}%`
      const clampedOrigin = clampViewOrigin(
        focusWorldX - focusPoint.x / viewportScale,
        focusWorldY - focusPoint.y / viewportScale
      )
      viewOriginX = clampedOrigin.x
      viewOriginY = clampedOrigin.y
      if (
        typeof focusClientX !== 'number' ||
        typeof focusClientY !== 'number'
      ) {
        const centeredOrigin = clampViewOrigin(
          DRAW_WORLD_HALF - getVisibleWorldSize(viewportScale) * 0.5,
          DRAW_WORLD_HALF - getVisibleWorldSize(viewportScale) * 0.5
        )
        viewOriginX = centeredOrigin.x
        viewOriginY = centeredOrigin.y
      }
      updateCursorVisual()
      if (hoverVisible) {
        updateCursorPosition({ x: hoverX, y: hoverY })
      }
      renderComposite()
    }

    const canUsePaintModes = (): boolean => contourClosed

    const setButtonDisabled = (
      button: HTMLButtonElement,
      disabled: boolean
    ) => {
      button.disabled = disabled
      button.style.opacity = disabled ? '0.4' : '1'
      button.style.cursor = disabled ? 'default' : 'pointer'
    }

    const updateConfirmState = () => {
      confirmBtn.disabled = !contourClosed
      confirmBtn.style.opacity = contourClosed ? '1' : '0.45'
      confirmBtn.style.cursor = contourClosed ? 'pointer' : 'default'
    }

    const updateAlert = () => {
      if (contourClosed) {
        alertEl.style.display = 'none'
        return
      }
      alertEl.textContent = localizer.t('editor_body_drawer_contour_alert')
      alertEl.style.display = 'block'
    }

    const getContourHitDistanceSq = (baseDistanceSq: number): number => {
      const baseDistance = Math.max(1, Math.round(Math.sqrt(baseDistanceSq)))
      const scaledDistance = Math.max(
        2,
        Math.round(baseDistance / viewportScale)
      )
      return scaledDistance * scaledDistance
    }

    const getNearestContourPointIndex = (
      pointX: number,
      pointY: number,
      maxDistanceSq: number
    ): number => {
      let bestIndex = -1
      let bestDistanceSq = maxDistanceSq
      for (let i = 0; i < contourPoints.length; i += 2) {
        const dx = pointX - contourPoints[i]
        const dy = pointY - contourPoints[i + 1]
        const distanceSq = dx * dx + dy * dy
        if (distanceSq > bestDistanceSq) {
          continue
        }
        bestDistanceSq = distanceSq
        bestIndex = i / 2
      }
      return bestIndex
    }

    const getEdgeProjection = (
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number
    ): { x: number; y: number; distanceSq: number; factorScaled: number } => {
      const dx = bx - ax
      const dy = by - ay
      if (dx === 0 && dy === 0) {
        const rx = px - ax
        const ry = py - ay
        return {
          x: ax,
          y: ay,
          distanceSq: rx * rx + ry * ry,
          factorScaled: 0,
        }
      }
      const lengthSq = dx * dx + dy * dy
      let factorScaled = Math.round(
        (((px - ax) * dx + (py - ay) * dy) * 1024) / lengthSq
      )
      if (factorScaled < 0) {
        factorScaled = 0
      } else if (factorScaled > 1024) {
        factorScaled = 1024
      }
      const projectedX = ax + Math.round((dx * factorScaled) / 1024)
      const projectedY = ay + Math.round((dy * factorScaled) / 1024)
      const rx = px - projectedX
      const ry = py - projectedY
      return {
        x: projectedX,
        y: projectedY,
        distanceSq: rx * rx + ry * ry,
        factorScaled,
      }
    }

    const getNearestContourEdge = (
      pointX: number,
      pointY: number,
      maxDistanceSq: number
    ): { insertAfterIndex: number; x: number; y: number } | null => {
      const pointCount = getContourPointCount()
      if (pointCount < 2) {
        return null
      }
      const edgeCount = contourClosed ? pointCount : pointCount - 1
      let bestInsertAfterIndex = -1
      let bestDistanceSq = maxDistanceSq
      let bestX = 0
      let bestY = 0
      for (let i = 0; i < edgeCount; i++) {
        const nextIndex = (i + 1) % pointCount
        const currentOffset = i * 2
        const nextOffset = nextIndex * 2
        const projection = getEdgeProjection(
          pointX,
          pointY,
          contourPoints[currentOffset],
          contourPoints[currentOffset + 1],
          contourPoints[nextOffset],
          contourPoints[nextOffset + 1]
        )
        if (
          projection.distanceSq > bestDistanceSq ||
          projection.factorScaled <= 0 ||
          projection.factorScaled >= 1024
        ) {
          continue
        }
        bestDistanceSq = projection.distanceSq
        bestInsertAfterIndex = i
        bestX = projection.x
        bestY = projection.y
      }
      if (bestInsertAfterIndex < 0) {
        return null
      }
      return {
        insertAfterIndex: bestInsertAfterIndex,
        x: bestX,
        y: bestY,
      }
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
      applyActive(contourBtn, mode === 'contour')
      applyActive(shapeBtn, mode === 'shape')
      applyActive(fillBtn, mode === 'fill')
      applyActive(eraseBtn, mode === 'erase')
      applyActive(textureBtn, mode === 'texture')
      applyActive(eyeBtn, mode === 'eye')
      setButtonDisabled(shapeBtn, !canUsePaintModes())
      setButtonDisabled(fillBtn, !canUsePaintModes())
      setButtonDisabled(eraseBtn, !canUsePaintModes())
      setButtonDisabled(textureBtn, !canUsePaintModes())
      setButtonDisabled(eyeBtn, !canUsePaintModes())
      setButtonDisabled(clearTextureBtn, !canUsePaintModes())
    }

    const updateCursorVisual = () => {
      const sizePx =
        mode === 'eye'
          ? EYE_CURSOR_SIZE
          : mode === 'contour' || mode === 'fill'
            ? CONTOUR_CURSOR_SIZE
            : Math.max(2, Math.round(getBrushSize() * viewportScale))
      cursorEl.style.width = `${sizePx}px`
      cursorEl.style.height = `${sizePx}px`
      if (mode === 'contour' || mode === 'fill') {
        cursorEl.style.borderRadius = '2px'
        cursorEl.style.borderColor = 'rgba(70,42,0,0.95)'
        cursorEl.style.boxShadow = '0 0 0 1px rgba(255,231,163,0.92)'
        cursorEl.style.background =
          mode === 'fill' ? colorInput.value : 'rgba(245,208,96,0.88)'
        return
      }
      cursorEl.style.borderRadius = '50%'
      cursorEl.style.borderColor = 'rgba(0,0,0,0.95)'
      cursorEl.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.95)'
      cursorEl.style.background =
        mode === 'erase' ? 'rgba(245,245,240,0.92)' : colorInput.value
    }

    const clearBodyShape = () => {
      maskCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
    }

    const fillBodyShape = () => {
      shapeCtx.save()
      shapeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.fillStyle = colorInput.value
      shapeCtx.fillRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.globalCompositeOperation = 'destination-in'
      shapeCtx.drawImage(this.maskCanvas, 0, 0)
      shapeCtx.restore()
      renderComposite()
    }

    const drawContourFill = () => {
      if (!contourClosed || contourPoints.length < 6) {
        return
      }
      clearBodyShape()
      maskCtx.save()
      maskCtx.fillStyle = '#ffffff'
      maskCtx.beginPath()
      maskCtx.moveTo(contourPoints[0], contourPoints[1])
      for (let i = 2; i < contourPoints.length; i += 2) {
        maskCtx.lineTo(contourPoints[i], contourPoints[i + 1])
      }
      maskCtx.closePath()
      maskCtx.fill()
      maskCtx.restore()

      shapeCtx.save()
      shapeCtx.fillStyle = colorInput.value
      shapeCtx.beginPath()
      shapeCtx.moveTo(contourPoints[0], contourPoints[1])
      for (let i = 2; i < contourPoints.length; i += 2) {
        shapeCtx.lineTo(contourPoints[i], contourPoints[i + 1])
      }
      shapeCtx.closePath()
      shapeCtx.fill()
      shapeCtx.restore()
    }

    const beginContour = (pointX: number, pointY: number) => {
      contourClosed = false
      contourPoints = [pointX, pointY]
      selectedContourIndex = 0
      contourDragPointIndex = -1
      pendingContourClose = false
      clearBodyShape()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      renderComposite()
    }

    const closeContour = () => {
      contourClosed = true
      drawContourFill()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      renderComposite()
    }

    const appendContourPoint = (pointX: number, pointY: number) => {
      contourPoints.push(pointX, pointY)
      selectedContourIndex = getContourPointCount() - 1
      renderComposite()
      updateAlert()
    }

    const insertContourPointAfter = (
      pointIndex: number,
      pointX: number,
      pointY: number
    ): boolean => {
      const pointCount = getContourPointCount()
      if (pointIndex < 0 || pointIndex >= pointCount) {
        return false
      }
      const insertOffset = (pointIndex + 1) * 2
      contourPoints.splice(insertOffset, 0, pointX, pointY)
      selectedContourIndex = pointIndex + 1
      updateContourGeometry()
      return true
    }

    const updateContourGeometry = () => {
      if (contourClosed && getContourPointCount() >= CONTOUR_MIN_POINT_COUNT) {
        drawContourFill()
      } else {
        contourClosed = false
        clearBodyShape()
      }
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      renderComposite()
    }

    const moveContourPoint = (
      pointIndex: number,
      pointX: number,
      pointY: number
    ) => {
      if (pointIndex < 0 || pointIndex >= getContourPointCount()) {
        return
      }
      const offset = pointIndex * 2
      contourPoints[offset] = pointX
      contourPoints[offset + 1] = pointY
      updateContourGeometry()
    }

    const deleteSelectedContourPoint = (): boolean => {
      if (
        selectedContourIndex < 0 ||
        selectedContourIndex >= getContourPointCount()
      ) {
        return false
      }
      const removeOffset = selectedContourIndex * 2
      contourPoints.splice(removeOffset, 2)
      const remainingCount = getContourPointCount()
      if (remainingCount === 0) {
        contourClosed = false
        selectedContourIndex = -1
      } else if (remainingCount < CONTOUR_MIN_POINT_COUNT) {
        contourClosed = false
        selectedContourIndex = Math.min(
          selectedContourIndex,
          remainingCount - 1
        )
      } else {
        selectedContourIndex = Math.min(
          selectedContourIndex,
          remainingCount - 1
        )
      }
      updateContourGeometry()
      return true
    }

    const buildDefaultContourPoints = (): number[] => {
      const safeWidth =
        options.defaultBodyWidth && options.defaultBodyWidth > 0
          ? options.defaultBodyWidth
          : 1
      const safeHeight =
        options.defaultBodyHeight && options.defaultBodyHeight > 0
          ? options.defaultBodyHeight
          : safeWidth
      const baseRadius = 52
      let radiusX = baseRadius
      let radiusY = Math.round((baseRadius * safeHeight) / safeWidth)
      if (radiusY > baseRadius) {
        radiusY = baseRadius
        radiusX = Math.round((baseRadius * safeWidth) / safeHeight)
      }
      radiusX = Math.max(8, radiusX)
      radiusY = Math.max(8, radiusY)
      const points = new Array<number>(DEFAULT_CONTOUR_SEGMENTS * 2)
      for (let i = 0; i < DEFAULT_CONTOUR_SEGMENTS; i++) {
        const angle =
          (Math.PI * 2 * i) / DEFAULT_CONTOUR_SEGMENTS - Math.PI * 0.5
        const offset = i * 2
        points[offset] = DRAW_WORLD_HALF + Math.round(Math.cos(angle) * radiusX)
        points[offset + 1] =
          DRAW_WORLD_HALF + Math.round(Math.sin(angle) * radiusY)
      }
      return points
    }

    const renderComposite = () => {
      drawCtx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE)
      drawCtx.fillStyle = '#090705'
      drawCtx.fillRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE)
      drawCtx.imageSmoothingEnabled = false

      drawCtx.save()
      drawCtx.setTransform(
        viewportScale,
        0,
        0,
        viewportScale,
        -viewOriginX * viewportScale,
        -viewOriginY * viewportScale
      )
      drawCtx.drawImage(this.shapeCanvas, 0, 0)
      drawCtx.globalCompositeOperation = 'source-atop'
      drawCtx.drawImage(this.textureCanvas, 0, 0)
      drawCtx.globalCompositeOperation = 'source-over'

      const contourBounds = getContourBounds()
      if (contourClosed && contourBounds) {
        drawCtx.save()
        drawCtx.translate(contourBounds.centerX, contourBounds.centerY)
        const eyeRadius = Math.max(
          5 / viewportScale,
          Math.round(Math.min(contourBounds.width, contourBounds.height) * 0.09)
        )
        const eyeWhiteRadius = Math.max(3 / viewportScale, eyeRadius - 1)
        const pupilRadius = Math.max(2 / viewportScale, eyeWhiteRadius - 1)
        const highlightRadius = Math.max(1 / viewportScale, pupilRadius * 0.4)
        drawCtx.fillStyle = '#201710'
        drawCtx.beginPath()
        drawCtx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2)
        drawCtx.fill()
        drawCtx.fillStyle = '#f4ecdc'
        drawCtx.beginPath()
        drawCtx.arc(eyeX, eyeY, eyeWhiteRadius, 0, Math.PI * 2)
        drawCtx.fill()
        drawCtx.fillStyle = '#17120e'
        drawCtx.beginPath()
        drawCtx.arc(eyeX, eyeY, pupilRadius, 0, Math.PI * 2)
        drawCtx.fill()
        drawCtx.fillStyle = 'rgba(255,255,255,0.95)'
        drawCtx.beginPath()
        drawCtx.arc(
          eyeX - Math.max(1 / viewportScale, pupilRadius * 0.3),
          eyeY - Math.max(1 / viewportScale, pupilRadius * 0.3),
          highlightRadius,
          0,
          Math.PI * 2
        )
        drawCtx.fill()
        drawCtx.restore()
      }

      if (contourClosed && mode === 'eye' && contourBounds) {
        drawCtx.save()
        drawCtx.translate(contourBounds.centerX, contourBounds.centerY)
        drawCtx.strokeStyle = 'rgba(255,245,220,0.95)'
        drawCtx.lineWidth = Math.max(1 / viewportScale, 0.5)
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

      if (contourPoints.length >= 2) {
        drawCtx.save()
        drawCtx.strokeStyle = contourClosed
          ? 'rgba(255,236,166,0.92)'
          : 'rgba(245,208,96,0.95)'
        drawCtx.fillStyle = 'rgba(245,208,96,0.95)'
        drawCtx.lineWidth = Math.max(1 / viewportScale, 0.5)
        drawCtx.beginPath()
        drawCtx.moveTo(contourPoints[0], contourPoints[1])
        for (let i = 2; i < contourPoints.length; i += 2) {
          drawCtx.lineTo(contourPoints[i], contourPoints[i + 1])
        }
        if (contourClosed) {
          drawCtx.closePath()
        } else if (mode === 'contour' && hoverVisible) {
          drawCtx.lineTo(hoverX, hoverY)
        }
        drawCtx.stroke()

        for (let i = 0; i < contourPoints.length; i += 2) {
          const pointIndex = i / 2
          const baseRadius =
            pointIndex === selectedContourIndex
              ? CONTOUR_GUIDE_POINT_RADIUS + 3
              : i === 0 && !contourClosed
                ? CONTOUR_GUIDE_POINT_RADIUS + 1
                : CONTOUR_GUIDE_POINT_RADIUS
          const radius = Math.max(1, Math.round(baseRadius / viewportScale))
          drawCtx.fillStyle =
            pointIndex === selectedContourIndex
              ? 'rgba(255,248,212,0.98)'
              : 'rgba(245,208,96,0.95)'
          drawCtx.beginPath()
          drawCtx.arc(
            contourPoints[i],
            contourPoints[i + 1],
            radius,
            0,
            Math.PI * 2
          )
          drawCtx.fill()
        }
        drawCtx.restore()
      }
      drawCtx.restore()
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

    const getCanvasPoint = (
      event: Pick<MouseEvent, 'clientX' | 'clientY'>
    ): { x: number; y: number } => {
      const canvasPoint = getCanvasLocalPoint(event)
      return clampBodyPoint(
        canvasPoint.x / viewportScale + viewOriginX,
        canvasPoint.y / viewportScale + viewOriginY
      )
    }

    const updateCursorPosition = (point: { x: number; y: number }) => {
      const wrapRect = canvasWrap.getBoundingClientRect()
      const drawRect = drawCanvas.getBoundingClientRect()
      const screenPoint = bodyToCanvasPoint(point.x + 0.5, point.y + 0.5)
      cursorEl.style.left = `${screenPoint.x + drawRect.left - wrapRect.left}px`
      cursorEl.style.top = `${screenPoint.y + drawRect.top - wrapRect.top}px`
      cursorEl.style.display = 'block'
    }

    const updateEyePosition = (point: { x: number; y: number }) => {
      const contourBounds = getContourBounds()
      if (!contourBounds) {
        return
      }
      const nextEyeX = point.x - contourBounds.centerX
      const nextEyeY = point.y - contourBounds.centerY
      if (nextEyeX === eyeX && nextEyeY === eyeY) {
        return
      }
      eyeX = nextEyeX
      eyeY = nextEyeY
      pointerChanged = true
      renderComposite()
    }

    const isPointInsideBodyMask = (pointX: number, pointY: number): boolean => {
      return (
        maskCtx.getImageData(pointX, pointY, 1, 1).data[3] >=
        MASK_ALPHA_THRESHOLD
      )
    }

    const syncContourFromMask = (): boolean => {
      const nextContourPoints = this.buildEditorContourFromMask(maskCtx)
      if (!nextContourPoints || nextContourPoints.length < 6) {
        return false
      }
      contourPoints = nextContourPoints
      contourClosed = true
      selectedContourIndex = Math.min(
        selectedContourIndex < 0 ? 0 : selectedContourIndex,
        getContourPointCount() - 1
      )
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      renderComposite()
      return true
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
      clearBodyShape()
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      contourPoints = []
      contourClosed = false
      selectedContourIndex = -1
      contourDragPointIndex = -1
      pendingContourClose = false

      const profile = options.initialProfile
      eyeX = getCharacterEyeDrawX(profile)
      eyeY = getCharacterEyeDrawY(profile)
      if (profile && profile.points.length >= 6) {
        contourPoints = new Array<number>(profile.points.length)
        for (let i = 0; i < profile.points.length; i += 2) {
          contourPoints[i] = profile.points[i] + DRAW_WORLD_HALF
          contourPoints[i + 1] = profile.points[i + 1] + DRAW_WORLD_HALF
        }
        contourClosed = true
        drawContourFill()

        const surfaceDataUrl = profile.surfaceDataUrl
        const contourBounds = getContourBounds()
        if (surfaceDataUrl) {
          const image = await this.loadImage(surfaceDataUrl)
          if (image && contourBounds) {
            shapeCtx.drawImage(
              image,
              contourBounds.minX,
              contourBounds.minY,
              contourBounds.width,
              contourBounds.height
            )
          }
        } else if (profile.textureDataUrl) {
          const image = await this.loadImage(profile.textureDataUrl)
          if (image && contourBounds) {
            textureCtx.drawImage(
              image,
              contourBounds.minX,
              contourBounds.minY,
              contourBounds.width,
              contourBounds.height
            )
          }
        }
        selectedContourIndex = 0
      } else {
        contourPoints = buildDefaultContourPoints()
        contourClosed = true
        selectedContourIndex = 0
        drawContourFill()
      }
      setExportReferenceFromBounds(getContourBounds())
      mode = contourClosed ? 'shape' : 'contour'
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
    }

    contourBtn.addEventListener('click', () => {
      hideContourMenu()
      mode = 'contour'
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
    })
    shapeBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      mode = 'shape'
      updateModeButtons()
      updateCursorVisual()
    })
    fillBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      mode = 'fill'
      updateModeButtons()
      updateCursorVisual()
    })
    eraseBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      mode = 'erase'
      updateModeButtons()
      updateCursorVisual()
    })
    textureBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      mode = 'texture'
      updateModeButtons()
      updateCursorVisual()
    })
    eyeBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      mode = 'eye'
      updateModeButtons()
      updateCursorVisual()
    })
    resetShapeBtn.addEventListener('click', () => {
      flushSettingHistory()
      hideContourMenu()
      clearBodyShape()
      contourPoints = []
      contourClosed = false
      selectedContourIndex = -1
      contourDragPointIndex = -1
      pendingContourClose = false
      hoverVisible = false
      mode = 'contour'
      eyeX = DEFAULT_CHARACTER_EYE_X
      eyeY = DEFAULT_CHARACTER_EYE_Y
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
      historyManager.capture()
    })
    clearTextureBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      flushSettingHistory()
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      renderComposite()
      historyManager.capture()
    })
    colorInput.addEventListener('input', () => {
      settingsChanged = true
      if (!bloodColorAssigned) {
        bloodColorInput.value = colorInput.value
      }
      updateCursorVisual()
    })
    colorInput.addEventListener('change', () => {
      if (!bloodColorAssigned) {
        bloodColorInput.value = colorInput.value
      }
      flushSettingHistory()
    })
    bloodColorInput.addEventListener('input', () => {
      settingsChanged = true
      bloodColorAssigned = true
    })
    bloodColorInput.addEventListener('change', () => {
      bloodColorAssigned = true
      flushSettingHistory()
    })
    brushSlider.addEventListener('input', () => {
      syncBrushValue(brushSlider.value)
      settingsChanged = true
    })
    brushSlider.addEventListener('change', () => {
      flushSettingHistory()
    })
    zoomSlider.addEventListener('input', () => {
      const parsed = Number.parseInt(zoomSlider.value, 10)
      if (!Number.isFinite(parsed)) {
        return
      }
      applyCanvasZoom(parsed)
    })
    addContourPointBtn.addEventListener('click', () => {
      const insertAfterIndex = contourMenuInsertAfterIndex
      const insertX = contourMenuInsertX
      const insertY = contourMenuInsertY
      hideContourMenu()
      if (insertContourPointAfter(insertAfterIndex, insertX, insertY)) {
        historyManager.capture()
      }
    })
    removeContourPointBtn.addEventListener('click', () => {
      const pointIndex = contourMenuPointIndex
      hideContourMenu()
      if (pointIndex >= 0) {
        selectedContourIndex = pointIndex
      }
      if (deleteSelectedContourPoint()) {
        historyManager.capture()
      }
    })

    drawCanvas.addEventListener(
      'contextmenu',
      (event) => {
        if (mode !== 'contour') {
          hideContourMenu()
          return
        }
        const point = getCanvasPoint(event as PointerEvent)
        const pointIndex = getNearestContourPointIndex(
          point.x,
          point.y,
          getContourHitDistanceSq(CONTOUR_SELECT_DISTANCE_SQ)
        )
        const edge = getNearestContourEdge(
          point.x,
          point.y,
          getContourHitDistanceSq(CONTOUR_EDGE_SELECT_DISTANCE_SQ)
        )
        if (pointIndex >= 0) {
          selectedContourIndex = pointIndex
        }
        showContourMenu(
          event.clientX,
          event.clientY,
          pointIndex,
          edge?.insertAfterIndex ?? -1,
          edge?.x ?? 0,
          edge?.y ?? 0
        )
        renderComposite()
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )

    drawCanvas.addEventListener(
      'wheel',
      (event) => {
        hideContourMenu()
        const nextZoom = Math.round(
          canvasZoomPercent * Math.pow(0.999, event.deltaY)
        )
        applyCanvasZoom(nextZoom, event.clientX, event.clientY)
        event.preventDefault()
        event.stopPropagation()
      },
      { passive: false }
    )

    drawCanvas.addEventListener('pointerenter', (event) => {
      const point = getCanvasPoint(event)
      hoverX = point.x
      hoverY = point.y
      hoverVisible = true
      updateCursorPosition(point)
      updateCursorVisual()
      if (mode === 'contour') {
        renderComposite()
      }
    })
    drawCanvas.addEventListener('pointerleave', () => {
      hoverVisible = false
      if (!pointerActive) {
        cursorEl.style.display = 'none'
      }
      if (mode === 'contour') {
        renderComposite()
      }
    })

    drawCanvas.addEventListener(
      'pointerdown',
      (event) => {
        hideContourMenu()
        if (event.button === 1) {
          canvasPanActive = true
          lastPanClientX = event.clientX
          lastPanClientY = event.clientY
          drawCanvas.setPointerCapture(event.pointerId)
          event.preventDefault()
          event.stopPropagation()
          return
        }
        flushSettingHistory()
        const point = getCanvasPoint(event)
        hoverX = point.x
        hoverY = point.y
        hoverVisible = true
        updateCursorPosition(point)
        if (mode === 'contour') {
          const pointCount = getContourPointCount()
          const nearestIndex = getNearestContourPointIndex(
            point.x,
            point.y,
            getContourHitDistanceSq(CONTOUR_SELECT_DISTANCE_SQ)
          )
          if (nearestIndex >= 0) {
            const wasSelectedStart =
              !contourClosed &&
              nearestIndex === 0 &&
              selectedContourIndex === 0 &&
              pointCount >= CONTOUR_MIN_POINT_COUNT
            selectedContourIndex = nearestIndex
            contourDragPointIndex = nearestIndex
            pendingContourClose = wasSelectedStart
            pointerActive = true
            pointerChanged = false
            lastX = point.x
            lastY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          selectedContourIndex = -1
          contourDragPointIndex = -1
          pendingContourClose = false
          if (contourClosed) {
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (pointCount === 0) {
            beginContour(point.x, point.y)
            historyManager.capture()
          } else {
            appendContourPoint(point.x, point.y)
            historyManager.capture()
          }
          updateCursorVisual()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (mode === 'shape') {
          shapeStrokeAnchored = isPointInsideBodyMask(point.x, point.y)
          if (!shapeStrokeAnchored) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
        } else if (mode === 'fill') {
          if (!isPointInsideBodyMask(point.x, point.y)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          fillBodyShape()
          historyManager.capture()
          event.preventDefault()
          event.stopPropagation()
          return
        } else {
          shapeStrokeAnchored = false
        }
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
        hoverX = point.x
        hoverY = point.y
        hoverVisible = true
        if (canvasPanActive) {
          const clampedOrigin = clampViewOrigin(
            viewOriginX - (event.clientX - lastPanClientX) / viewportScale,
            viewOriginY - (event.clientY - lastPanClientY) / viewportScale
          )
          viewOriginX = clampedOrigin.x
          viewOriginY = clampedOrigin.y
          lastPanClientX = event.clientX
          lastPanClientY = event.clientY
          renderComposite()
          updateCursorPosition({ x: hoverX, y: hoverY })
          event.preventDefault()
          event.stopPropagation()
          return
        }
        updateCursorPosition(point)
        if (mode === 'contour') {
          if (pointerActive && contourDragPointIndex >= 0) {
            if (point.x !== lastX || point.y !== lastY) {
              pointerChanged = true
              pendingContourClose = false
              moveContourPoint(contourDragPointIndex, point.x, point.y)
              lastX = point.x
              lastY = point.y
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          renderComposite()
          return
        }
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
      if (canvasPanActive) {
        canvasPanActive = false
        if (drawCanvas.hasPointerCapture(event.pointerId)) {
          drawCanvas.releasePointerCapture(event.pointerId)
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!pointerActive) {
        return
      }
      const wasContourDrag = mode === 'contour'
      pointerActive = false
      if (wasContourDrag) {
        if (drawCanvas.hasPointerCapture(event.pointerId)) {
          drawCanvas.releasePointerCapture(event.pointerId)
        }
        if (pendingContourClose && !pointerChanged) {
          closeContour()
          historyManager.capture()
        } else if (pointerChanged) {
          historyManager.capture()
        }
        contourDragPointIndex = -1
        pendingContourClose = false
        pointerChanged = false
        cursorEl.style.display = 'none'
        hoverVisible = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const shouldSyncContourFromMask = mode === 'shape' && pointerChanged
      if (pointerChanged) {
        if (shouldSyncContourFromMask) {
          syncContourFromMask()
        }
        pointerChanged = false
        historyManager.capture()
      }
      shapeStrokeAnchored = false
      if (drawCanvas.hasPointerCapture(event.pointerId)) {
        drawCanvas.releasePointerCapture(event.pointerId)
      }
      cursorEl.style.display = 'none'
      hoverVisible = false
      event.preventDefault()
      event.stopPropagation()
    }
    drawCanvas.addEventListener('pointerup', stopPointer, true)
    drawCanvas.addEventListener('pointercancel', stopPointer, true)
    modal.addEventListener(
      'pointerdown',
      (event) => {
        if (!contourMenu.contains(event.target as Node)) {
          hideContourMenu()
        }
      },
      true
    )

    modal.addEventListener(
      'keydown',
      (event) => {
        if (settingsChanged) {
          settingsChanged = false
        }
        if (
          mode === 'contour' &&
          (event.key === 'Delete' || event.key === 'Backspace')
        ) {
          if (deleteSelectedContourPoint()) {
            historyManager.capture()
          }
          event.preventDefault()
          event.stopPropagation()
          return
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
          if (!contourClosed) {
            updateAlert()
            return
          }
          resolve(
            finish(
              this.buildProfile(
                maskCtx,
                shapeCtx,
                textureCtx,
                outputCtx,
                eyeX,
                eyeY,
                bloodColorAssigned ? bloodColorInput.value : undefined,
                exportBaseWidth,
                exportBaseHeight,
                exportReferenceWidth,
                exportReferenceHeight
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
    applyCanvasZoom(CANVAS_ZOOM_DEFAULT_PERCENT)
    await loadInitialProfile()
    historyManager.reset()
    return promise
  }

  private async loadImage(url: string): Promise<HTMLImageElement | null> {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => resolve(null)
      image.src = url
    })
  }

  private readMaskFill(
    maskCtx: CanvasRenderingContext2D,
    size: number
  ): {
    filled: Uint8Array
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null {
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

    return {
      filled,
      minX,
      minY,
      maxX,
      maxY,
    }
  }

  private buildEditorContourFromMask(
    maskCtx: CanvasRenderingContext2D
  ): number[] | null {
    const maskFill = this.readMaskFill(maskCtx, DRAW_WORLD_SIZE)
    if (!maskFill) {
      return null
    }
    const loop = this.pickLargestLoop(
      this.extractMaskLoops(maskFill.filled, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
    )
    if (!loop || loop.length < 6) {
      return null
    }
    const limited = this.limitEditorLoopPoints(loop, MAX_EDITOR_CONTOUR_POINTS)
    return limited.length >= 6 ? limited : null
  }

  private buildProfile(
    maskCtx: CanvasRenderingContext2D,
    shapeCtx: CanvasRenderingContext2D,
    textureCtx: CanvasRenderingContext2D,
    outputCtx: CanvasRenderingContext2D,
    eyeX: number,
    eyeY: number,
    bloodColor: string | undefined,
    exportBaseWidth: number,
    exportBaseHeight: number,
    exportReferenceWidth: number,
    exportReferenceHeight: number
  ): MapCharacterBodyProfile | null {
    const size = DRAW_WORLD_SIZE
    const maskFill = this.readMaskFill(maskCtx, size)
    if (!maskFill) {
      return null
    }

    const loops = this.extractMaskLoops(maskFill.filled, size, size)
    const loop = this.pickLargestLoop(loops)
    if (!loop || loop.length < 6) {
      return null
    }

    const centered = this.centerLoop(
      loop,
      Math.round((maskFill.minX + maskFill.maxX + 1) * 0.5),
      Math.round((maskFill.minY + maskFill.maxY + 1) * 0.5)
    )
    const simplified = this.limitEditorLoopPoints(centered, MAX_PROFILE_POINTS)
    if (simplified.length < 6) {
      return null
    }
    const width = Math.max(
      0.01,
      Math.round(
        (exportBaseWidth * (maskFill.maxX + 1 - maskFill.minX) * 1000) /
          Math.max(1, exportReferenceWidth)
      ) / 1000
    )
    const height = Math.max(
      0.01,
      Math.round(
        (exportBaseHeight * (maskFill.maxY + 1 - maskFill.minY) * 1000) /
          Math.max(1, exportReferenceHeight)
      ) / 1000
    )

    const surfaceDataUrl = this.buildSurfaceDataUrl(
      shapeCtx,
      textureCtx,
      outputCtx,
      maskFill.minX,
      maskFill.minY,
      maskFill.maxX + 1,
      maskFill.maxY + 1
    )

    return {
      points: simplified,
      width,
      height,
      bloodColor,
      eyeX: Math.round(eyeX * 1000) / 1000,
      eyeY: Math.round(eyeY * 1000) / 1000,
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

  private centerLoop(
    points: number[],
    centerX: number,
    centerY: number
  ): number[] {
    const normalized = new Array<number>(points.length)
    for (let i = 0; i < points.length; i += 2) {
      normalized[i] = points[i] - centerX
      normalized[i + 1] = points[i + 1] - centerY
    }
    return normalized
  }

  private limitLoopPoints(points: number[], maxPoints: number): number[] {
    const normalized = this.normalizeProfileLoop(points)
    if (!normalized) {
      return []
    }
    if (normalized.length / 2 <= maxPoints) {
      return normalized
    }

    const source = normalized.slice()
    let bestValid = source
    let epsilon = 0.5
    while (epsilon <= 16) {
      const simplified = this.normalizeProfileLoop(
        this.simplifyClosedLoop(source, epsilon)
      )
      if (simplified && simplified.length >= 6) {
        if (simplified.length < bestValid.length) {
          bestValid = simplified
        }
        if (simplified.length / 2 <= maxPoints) {
          return simplified
        }
      }
      epsilon *= 2
    }

    const step = Math.ceil(bestValid.length / 2 / maxPoints)
    const sampled: number[] = []
    for (let i = 0; i < bestValid.length; i += step * 2) {
      sampled.push(bestValid[i], bestValid[i + 1])
    }
    const normalizedSampled = this.normalizeProfileLoop(sampled)
    if (normalizedSampled && normalizedSampled.length / 2 <= maxPoints) {
      return normalizedSampled
    }

    return bestValid
  }

  private limitEditorLoopPoints(points: number[], maxPoints: number): number[] {
    const normalized = this.normalizeProfileLoop(points)
    if (!normalized) {
      return []
    }
    if (normalized.length / 2 <= maxPoints) {
      return normalized
    }

    const source = normalized.slice()
    let bestValid = source
    let epsilon = 1
    while (epsilon <= 32) {
      const simplified = this.normalizeProfileLoop(
        this.simplifyClosedLoop(source, epsilon)
      )
      if (simplified && simplified.length >= 6) {
        if (simplified.length < bestValid.length) {
          bestValid = simplified
        }
        if (simplified.length / 2 <= maxPoints) {
          return simplified
        }
      }
      epsilon *= 2
    }

    const step = Math.ceil(bestValid.length / 2 / maxPoints)
    const sampled: number[] = []
    for (let i = 0; i < bestValid.length; i += step * 2) {
      sampled.push(bestValid[i], bestValid[i + 1])
    }
    const normalizedSampled = this.normalizeProfileLoop(sampled)
    if (normalizedSampled && normalizedSampled.length / 2 <= maxPoints) {
      return normalizedSampled
    }

    return bestValid
  }

  private normalizeProfileLoop(points: number[]): number[] | null {
    const polygon = this.buildDecompPolygon(points)
    if (!polygon || !isSimple(polygon)) {
      return null
    }
    makeCCW(polygon)
    return this.flattenDecompPolygon(polygon)
  }

  private buildDecompPolygon(points: number[]): DecompPolygon | null {
    if (points.length < 6) {
      return null
    }

    const polygon: DecompPolygon = []
    for (let i = 0; i < points.length; i += 2) {
      polygon.push([points[i], points[i + 1]])
    }
    removeDuplicatePoints(polygon, PROFILE_POINT_PRECISION)
    removeCollinearPoints(polygon, PROFILE_POINT_PRECISION)
    return polygon.length >= 3 ? polygon : null
  }

  private flattenDecompPolygon(polygon: DecompPolygon): number[] {
    const result = new Array<number>(polygon.length * 2)
    for (let i = 0; i < polygon.length; i++) {
      const offset = i * 2
      result[offset] = polygon[i][0]
      result[offset + 1] = polygon[i][1]
    }
    return result
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
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    this.outputCanvas.width = width
    this.outputCanvas.height = height
    outputCtx.clearRect(0, 0, width, height)
    outputCtx.drawImage(
      shapeCtx.canvas,
      minX,
      minY,
      width,
      height,
      0,
      0,
      width,
      height
    )
    outputCtx.globalCompositeOperation = 'source-atop'
    outputCtx.drawImage(
      textureCtx.canvas,
      minX,
      minY,
      width,
      height,
      0,
      0,
      width,
      height
    )
    outputCtx.globalCompositeOperation = 'source-over'
    const alpha = outputCtx.getImageData(0, 0, width, height).data
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i] >= MASK_ALPHA_THRESHOLD) {
        return this.outputCanvas.toDataURL('image/png')
      }
    }
    return null
  }
}
