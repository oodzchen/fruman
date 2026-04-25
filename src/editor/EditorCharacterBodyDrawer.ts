import {
  isSimple,
  makeCCW,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import { localizer } from '../Localizer'
import {
  buildAutoCharacterBodyCollisionShapesFromLocalPoints,
  buildCollisionOutlineLoopsFromShapes,
} from '../characterBodyCollision'
import {
  DEFAULT_CHARACTER_BROW_OFFSET_X,
  DEFAULT_CHARACTER_BROW_OFFSET_Y,
  DEFAULT_CHARACTER_BROW_ROTATION_DEG,
  DEFAULT_CHARACTER_BROW_SCALE,
  DEFAULT_CHARACTER_BROW_STYLE,
  DEFAULT_CHARACTER_EYE_ROTATION_DEG,
  DEFAULT_CHARACTER_EYE_SCALE,
  DEFAULT_CHARACTER_EYE_STYLE,
  DEFAULT_CHARACTER_EYE_X,
  DEFAULT_CHARACTER_EYE_Y,
  clampCharacterEyeOffsetToCircle,
  clampCharacterEyeScale,
  drawCharacterBrowGeometry,
  drawCharacterEyeGeometry,
  getCharacterBrowBounds,
  getCharacterBrowGeometry,
  getCharacterBrowOffsetX,
  getCharacterBrowOffsetY,
  getCharacterBrowRotationDeg,
  getCharacterBrowStyle,
  getCharacterEyeBounds,
  getCharacterEyeDrawX,
  getCharacterEyeDrawY,
  getCharacterEyeGeometry,
  getCharacterEyeMoveCircleRadius,
  getCharacterEyeRotationDeg,
  getCharacterEyeStyle,
} from '../characterBodyProfile'
import type {
  BonePart,
  BoneSegment,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyCollisionShape,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyPresetId,
  MapCharacterBodyProfile,
  MapCharacterBodyVisualLayer,
} from '../editorMapTypes'
import { deriveSkeletalBodyGeometry } from '../skeletalBodyProfile'
import { type EditorColorInputElement, EditorUIHelper } from './EditorUIHelper'

type BodyDrawMode =
  | 'contour'
  | 'select'
  | 'collision'
  | 'shape'
  | 'fill'
  | 'erase'
  | 'texture'
type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]
type EditorBodyLayerKind = 'core' | 'eye' | 'brow' | 'paint' | 'bone'
type EditorSelectionHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
type EditorRotationHandle = 'rotate'
type EditorCollisionShapeKind = 'circle' | 'ellipse' | 'capsule'

interface EditorBodyLayer {
  id: number
  name: string
  kind: EditorBodyLayerKind
  canvas: HTMLCanvasElement | null
  ctx: CanvasRenderingContext2D | null
  bounds: EditorCanvasBounds | null
  boundsDirty: boolean
  bonePart?: BonePart
  bonePivotX?: number
  bonePivotY?: number
  boneTipX?: number
  boneTipY?: number
  boneBoundaryShapes?: EditorCollisionShape[]
}

interface EditorCanvasBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface EditorCanvasSnapshot {
  bounds: EditorCanvasBounds | null
  image: ImageData | null
}

interface EditorCanvasState {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  bounds: EditorCanvasBounds | null
  boundsDirty: boolean
}

interface EditorBodyLayerSnapshot {
  id: number
  name: string
  kind: 'brow' | 'paint' | 'bone'
  image: EditorCanvasSnapshot
}

interface EditorSelectionScaleSession {
  layerId: number
  handle: EditorSelectionHandle
  initialBounds: EditorCanvasBounds
  centerX: number
  centerY: number
  handleOffsetX: number
  handleOffsetY: number
  coreMask: EditorCanvasSnapshot | null
  coreShape: EditorCanvasSnapshot | null
  coreTexture: EditorCanvasSnapshot | null
  contourPoints: number[] | null
  layerSnapshot: EditorCanvasSnapshot | null
}

interface EditorSelectionRotateSession {
  layerId: number
  centerX: number
  centerY: number
  startAngleDeg: number
  coreMask: EditorCanvasSnapshot | null
  coreShape: EditorCanvasSnapshot | null
  coreTexture: EditorCanvasSnapshot | null
  contourPoints: number[] | null
  layerSnapshot: EditorCanvasSnapshot | null
  eyeRotationDeg: number
  browRotationDeg: number
}

interface EditorCollisionShapeBase {
  id: number
  kind: EditorCollisionShapeKind
  centerX: number
  centerY: number
}

interface EditorCollisionCircleShape extends EditorCollisionShapeBase {
  kind: 'circle'
  radius: number
}

interface EditorCollisionEllipseShape extends EditorCollisionShapeBase {
  kind: 'ellipse'
  radiusX: number
  radiusY: number
  rotationDeg: number
}

interface EditorCollisionCapsuleShape extends EditorCollisionShapeBase {
  kind: 'capsule'
  halfWidth: number
  halfHeight: number
  rotationDeg: number
}

type EditorCollisionShape =
  | EditorCollisionCircleShape
  | EditorCollisionEllipseShape
  | EditorCollisionCapsuleShape

interface EditorCollisionScaleSession {
  shapeId: number
  handle: EditorSelectionHandle
  centerX: number
  centerY: number
  rotationDeg: number
  handleOffsetLocalX: number
  handleOffsetLocalY: number
  initialShape: EditorCollisionShape
}

interface EditorCollisionRotateSession {
  shapeId: number
  centerX: number
  centerY: number
  startAngleDeg: number
  initialRotationDeg: number
}

interface EditorCharacterBodyDrawerOptions {
  title: string
  initialProfile?: MapCharacterBodyProfile
  initialColor?: string
  defaultBodyWidth?: number
  defaultBodyHeight?: number
  initialFacing?: number
}

type EditorCharacterBodyPresetId = MapCharacterBodyPresetId | 'custom'

const DISPLAY_SIZE = 320
const DISPLAY_PANEL_SIZE = 480
const MIN_BRUSH_SIZE = 2
const MAX_BRUSH_SIZE = 24
const DEFAULT_BRUSH_SIZE = 8
const MASK_ALPHA_THRESHOLD = 16
const MAX_PROFILE_POINTS = 96
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
const DEFAULT_BODY_BLOOD_COLOR = '#7a1010'
const TRANSPARENT_BODY_COLOR = '#00000000'
const DEFAULT_EDITOR_EYE_RADIUS = 8
const SELECTION_HANDLE_SIZE = 10
const SELECTION_HANDLE_HIT_SIZE = 14
const SELECTION_ROTATE_HANDLE_SIZE = 12
const SELECTION_ROTATE_HANDLE_HIT_SIZE = 16
const SELECTION_ROTATE_HANDLE_OFFSET = 20
const SELECTION_MIN_SIZE = 4
const CORE_LAYER_ID = 1
const EYE_LAYER_ID = 2
const BROW_LAYER_ID = 3
const MIN_COLLISION_RADIUS = 4
const MIN_COLLISION_HALF_EXTENT = 4
const CUSTOM_BODY_PRESET_ID = 'custom'
const BODY_PRESET_IDS: MapCharacterBodyPresetId[] = [
  'banana',
  'kiwano',
  'pandaAnt',
  'pineapple',
  'tomato',
  'watermelon',
]
const PINEAPPLE_PRESET_IMAGE_SRC = '/images/presets/pineapple.png'
const TOMATO_PRESET_IMAGE_SRC = '/images/presets/tomato.png'
const WATERMELON_PRESET_IMAGE_SRC = '/images/presets/watermelon.png'
const BANANA_PRESET_IMAGE_SRC = '/images/presets/banana.png'
const KIWANO_PRESET_IMAGE_SRC = '/images/presets/kiwano.png'
const PANDA_ANT_PRESET_IMAGE_SRC = '/images/presets/panda_ant.png'
const BANANA_PRESET_POINTS = [
  3, -47, -5, -39, -17, -32, -23, -21, -27, -6, -25, 10, -19, 23, -11, 32, -2,
  41, 10, 47, 26, 47, 21, 36, 11, 27, 3, 17, -3, 7, -5, -9, -3, -25, 3, -38,
] as const
const KIWANO_PRESET_POINTS = [
  -58, -6, -54, -20, -42, -30, -24, -37, 0, -40, 24, -37, 42, -30, 54, -18, 58,
  -3, 56, 12, 46, 24, 28, 33, 2, 36, -24, 34, -44, 24, -56, 10,
] as const
const PANDA_ANT_PRESET_POINTS = [
  -64, 2, -52, -8, -42, -12, -28, -16, -14, -12, -4, -3, 10, -8, 24, -18, 42,
  -16, 56, -8, 68, 2, 56, 14, 44, 18, 30, 22, 12, 26, -6, 20, -18, 14, -30, 16,
  -42, 12, -54, 10,
] as const
const PINEAPPLE_PRESET_POINTS = [
  -18, -64, -8, -90, 0, -72, 10, -96, 20, -66, 34, -78, 30, -52, 48, -36, 56,
  -8, 52, 22, 38, 50, 12, 64, -12, 64, -38, 50, -52, 24, -56, -8, -48, -36, -28,
  -52, -34, -76,
] as const
const TOMATO_PRESET_POINTS = [
  -13, -32, -5, -41, 0, -32, 7, -41, 15, -32, 27, -24, 35, -7, 32, 15, 20, 31,
  0, 37, -20, 31, -32, 15, -35, -7, -27, -24,
] as const
const WATERMELON_PRESET_POINTS = [
  -36, -12, -31, -24, -19, -32, 0, -35, 19, -32, 31, -24, 36, -12, 37, 7, 33,
  20, 23, 29, 7, 35, -7, 35, -23, 29, -33, 20, -37, 7,
] as const

interface BodyPresetConfig {
  color: string
  bloodColor: string
  eyeX: number
  eyeY: number
  points: readonly number[]
  imageSrc?: string
  mirrorImageX?: boolean
  imageTargetHeight?: number
}

interface BodyPresetBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

interface EditorCharacterBodyDrawerHistorySnapshot {
  mask: EditorCanvasSnapshot
  shape: EditorCanvasSnapshot
  texture: EditorCanvasSnapshot
  layers: EditorBodyLayerSnapshot[]
  layerOrder: number[]
  brushSize: string
  color: string
  bloodColor: string
  bloodColorAssigned: boolean
  mode: BodyDrawMode
  eyeX: number
  eyeY: number
  eyeScaleX: number
  eyeScaleY: number
  eyeRotationDeg: number
  eyeStyle: MapCharacterBodyEyeStyle
  browStyle: MapCharacterBodyBrowStyle
  browOffsetX: number
  browOffsetY: number
  browScaleX: number
  browScaleY: number
  browRotationDeg: number
  contourPoints: number[]
  contourClosed: boolean
  selectedContourIndex: number
  selectedLayerId: number
  nextLayerId: number
  presetId: EditorCharacterBodyPresetId
  collisionShapes: EditorCollisionShape[]
  nextCollisionShapeId: number
  selectedCollisionShapeId: number
  collisionToolKind: EditorCollisionShapeKind
  collisionShapesCustomized: boolean
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
  private browCanvas = document.createElement('canvas')
  private workCanvas = document.createElement('canvas')
  private outputCanvas: HTMLCanvasElement | null = null

  constructor() {
    this.maskCanvas.width = DRAW_WORLD_SIZE
    this.maskCanvas.height = DRAW_WORLD_SIZE
    this.shapeCanvas.width = DRAW_WORLD_SIZE
    this.shapeCanvas.height = DRAW_WORLD_SIZE
    this.textureCanvas.width = DRAW_WORLD_SIZE
    this.textureCanvas.height = DRAW_WORLD_SIZE
    this.browCanvas.width = DRAW_WORLD_SIZE
    this.browCanvas.height = DRAW_WORLD_SIZE
    this.workCanvas.width = DRAW_WORLD_SIZE
    this.workCanvas.height = DRAW_WORLD_SIZE
  }

  private getOutputContext(
    width: number,
    height: number
  ): CanvasRenderingContext2D | null {
    if (!this.outputCanvas) {
      this.outputCanvas = document.createElement('canvas')
    }
    this.outputCanvas.width = width
    this.outputCanvas.height = height
    return this.outputCanvas.getContext('2d')
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

    const form = EditorUIHelper.createFormContainer({ minWidth: '1100px' })
    form.style.minWidth = 'min(1100px, calc(100% - 24px))'
    form.style.width = 'min(1100px, calc(100% - 24px))'
    form.style.maxWidth = 'calc(100% - 48px)'
    form.style.maxHeight = 'calc(100% - 48px)'
    form.style.padding = '20px'
    form.style.overflow = 'hidden'
    form.style.position = 'relative'

    const title = EditorUIHelper.createFormTitle(options.title)
    form.appendChild(title)

    const content = document.createElement('div')
    content.style.cssText =
      'display:flex;gap:16px;align-items:stretch;justify-content:space-between;min-height:0;flex:1 1 auto;overflow:auto;flex-wrap:nowrap;'
    form.appendChild(content)

    const sidebar = document.createElement('div')
    sidebar.style.cssText =
      'width:112px;max-width:112px;display:flex;flex-direction:column;gap:10px;flex:0 0 112px;overflow-y:auto;overflow-x:hidden;'
    content.appendChild(sidebar)

    const canvasColumn = document.createElement('div')
    canvasColumn.style.cssText =
      'flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;min-width:0;min-height:0;overflow:hidden;'
    content.appendChild(canvasColumn)

    const layerSidebar = document.createElement('div')
    layerSidebar.style.cssText =
      'width:96px;max-width:96px;display:flex;flex-direction:column;gap:8px;flex:0 0 96px;min-height:0;overflow-x:hidden;overflow-y:auto;'
    content.appendChild(layerSidebar)

    const canvasWrap = document.createElement('div')
    canvasWrap.style.cssText =
      'flex:1 1 auto;width:100%;display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden;position:relative;'
    canvasColumn.appendChild(canvasWrap)

    const drawCanvas = document.createElement('canvas')
    drawCanvas.width = DISPLAY_SIZE
    drawCanvas.height = DISPLAY_SIZE
    drawCanvas.style.cssText = [
      `width:${DISPLAY_PANEL_SIZE}px`,
      `height:${DISPLAY_PANEL_SIZE}px`,
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

    // --- Tab bar: Layers / Bones ---
    const sidebarTabBar = document.createElement('div')
    sidebarTabBar.style.cssText =
      'display:flex;gap:4px;margin-bottom:2px;flex:0 0 auto;'
    const tabBtnStyle = (active: boolean) =>
      [
        'flex:1',
        'padding:3px 0',
        'font-size:10px',
        'font-family:monospace',
        'cursor:pointer',
        'border:1px solid rgba(255,255,255,0.2)',
        'border-radius:2px',
        active
          ? 'color:#fff;background:rgba(255,255,255,0.18)'
          : 'color:rgba(255,255,255,0.45);background:transparent',
      ].join(';')
    const tabBtnLayers = document.createElement('button')
    tabBtnLayers.textContent = localizer.t('editor_body_drawer_tab_static')
    tabBtnLayers.style.cssText = tabBtnStyle(true)
    const tabBtnBones = document.createElement('button')
    tabBtnBones.textContent = localizer.t('editor_body_drawer_tab_skeletal')
    tabBtnBones.style.cssText = tabBtnStyle(false)
    sidebarTabBar.appendChild(tabBtnLayers)
    sidebarTabBar.appendChild(tabBtnBones)
    layerSidebar.appendChild(sidebarTabBar)

    const layerHeader = document.createElement('div')
    layerHeader.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;'
    const layerTitle = document.createElement('div')
    layerTitle.textContent = localizer.t('editor_body_drawer_layers')
    layerTitle.style.cssText =
      'font-size:11px;line-height:1;color:rgba(255,255,255,0.82);'
    const addLayerBtn = EditorUIHelper.createButton('+')
    addLayerBtn.style.cssText = [
      'width:18px',
      'height:18px',
      'padding:0',
      'font-size:11px',
      'font-weight:700',
      'line-height:1',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:rgba(255,255,255,0.92)',
      'background:rgba(255,255,255,0.08)',
      'border:1px solid rgba(255,255,255,0.2)',
    ].join(';')
    layerHeader.appendChild(layerTitle)
    layerHeader.appendChild(addLayerBtn)
    layerSidebar.appendChild(layerHeader)

    const layerList = document.createElement('div')
    layerList.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'min-height:0',
      'overflow-y:auto',
      'padding-right:2px',
    ].join(';')
    layerSidebar.appendChild(layerList)

    // --- Bones panel ---
    const bonesPanel = document.createElement('div')
    bonesPanel.style.cssText =
      'display:none;flex-direction:column;gap:4px;min-height:0;flex:1 1 auto;'
    layerSidebar.appendChild(bonesPanel)

    const boneList = document.createElement('div')
    boneList.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'gap:0',
      'overflow-y:auto',
      'flex:1 1 auto',
      'min-height:0',
    ].join(';')
    bonesPanel.appendChild(boneList)

    const bonePropPanel = document.createElement('div')
    bonePropPanel.style.cssText = [
      'display:none',
      'flex-direction:column',
      'gap:6px',
      'flex:0 0 auto',
      'padding-top:6px',
      'border-top:1px solid rgba(255,255,255,0.12)',
    ].join(';')
    bonesPanel.appendChild(bonePropPanel)

    const makeBonePropRow = (label: string, value: number, step: number) => {
      const row = document.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;gap:4px;'
      const lbl = document.createElement('span')
      lbl.style.cssText =
        'font-size:10px;color:rgba(255,255,255,0.62);min-width:36px;font-family:monospace;'
      lbl.textContent = label
      const inp = document.createElement('input')
      inp.type = 'number'
      inp.min = String(step)
      inp.max = '2'
      inp.step = String(step)
      inp.value = String(value)
      inp.style.cssText = [
        'width:48px',
        'font-size:10px',
        'font-family:monospace',
        'color:#fff',
        'background:rgba(255,255,255,0.08)',
        'border:1px solid rgba(255,255,255,0.2)',
        'padding:2px 4px',
        'border-radius:2px',
      ].join(';')
      row.appendChild(lbl)
      row.appendChild(inp)
      return { row, inp }
    }

    const boneLengthRow = makeBonePropRow('len', 0.15, 0.01)
    const boneWidthRow = makeBonePropRow('wid', 0.06, 0.01)
    bonePropPanel.appendChild(boneLengthRow.row)
    bonePropPanel.appendChild(boneWidthRow.row)

    const switchSidebarTab = (tab: 'layers' | 'bones') => {
      if (tab === 'layers') {
        // Exit bone boundary editing, restoring body collision shapes
        leaveBoneBoundaryMode()
        // Clear all bone selection state
        selectedBonePart = null
        selectedShapePart = null
        bonePropPanel.style.display = 'none'
        // If the active layer is a bone layer, reset to core
        if (getSelectedLayer()?.kind === 'bone') {
          selectedLayerId = CORE_LAYER_ID
        }
        // Exit drawing modes that only make sense in bones context
        if (
          (mode === 'shape' || mode === 'erase') &&
          getSelectedLayer()?.kind === 'bone'
        ) {
          mode = contourClosed ? 'shape' : 'contour'
          selectedLayerId = CORE_LAYER_ID
        }
      } else {
        // Switching to bones tab: don't carry body collision mode over
        if (mode === 'collision' && selectedBoundaryPart === null) {
          mode = 'select'
        }
        ensureAllBoneLayers()
      }
      activeSidebarTab = tab
      const layersActive = tab === 'layers'
      tabBtnLayers.style.cssText = tabBtnStyle(layersActive)
      tabBtnBones.style.cssText = tabBtnStyle(!layersActive)
      layerHeader.style.display = layersActive ? 'flex' : 'none'
      layerList.style.display = layersActive ? 'flex' : 'none'
      bonesPanel.style.display = layersActive ? 'none' : 'flex'
      updateModeButtons()
    }

    tabBtnLayers.addEventListener('click', () => {
      switchSidebarTab('layers')
      renderLayerList()
      renderComposite()
    })
    tabBtnBones.addEventListener('click', () => {
      ensureAllBoneLayers()
      switchSidebarTab('bones')
      renderBoneList()
      renderComposite()
    })

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

    const layerMenu = document.createElement('div')
    layerMenu.style.cssText = [
      'position:absolute',
      'display:none',
      'flex-direction:column',
      'gap:4px',
      'background:rgba(10,9,7,0.96)',
      'z-index:3',
      'min-width:96px',
      'box-sizing:border-box',
    ].join(';')
    const renameLayerBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_layer_rename')
    )
    const styleLayerBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_layer_style')
    )
    const duplicateLayerBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_layer_duplicate')
    )
    const deleteLayerBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_layer_delete')
    )
    layerMenu.style.padding = '0'
    layerMenu.style.border = 'none'
    renameLayerBtn.style.padding = '6px 8px'
    renameLayerBtn.style.fontSize = '10px'
    renameLayerBtn.style.border = 'none'
    renameLayerBtn.style.background = 'rgba(255,255,255,0.08)'
    styleLayerBtn.style.padding = '6px 8px'
    styleLayerBtn.style.fontSize = '10px'
    styleLayerBtn.style.border = 'none'
    styleLayerBtn.style.background = 'rgba(255,255,255,0.08)'
    duplicateLayerBtn.style.padding = '6px 8px'
    duplicateLayerBtn.style.fontSize = '10px'
    duplicateLayerBtn.style.border = 'none'
    duplicateLayerBtn.style.background = 'rgba(255,255,255,0.08)'
    deleteLayerBtn.style.padding = '6px 8px'
    deleteLayerBtn.style.fontSize = '10px'
    deleteLayerBtn.style.border = 'none'
    deleteLayerBtn.style.background = 'rgba(255,255,255,0.08)'
    layerMenu.appendChild(renameLayerBtn)
    layerMenu.appendChild(styleLayerBtn)
    layerMenu.appendChild(duplicateLayerBtn)
    layerMenu.appendChild(deleteLayerBtn)
    form.appendChild(layerMenu)

    const info = document.createElement('div')
    info.textContent = localizer.t('editor_body_drawer_hint')
    info.style.cssText =
      'font-size:11px;line-height:1.6;color:rgba(255,255,255,0.72);'
    sidebar.appendChild(info)

    const presetWrap = document.createElement('div')
    presetWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;'
    const presetLabel = document.createElement('div')
    presetLabel.textContent = localizer.t('editor_body_drawer_preset')
    presetLabel.style.cssText =
      'font-size:11px;line-height:1;color:rgba(255,255,255,0.78);'
    const presetSelect = EditorUIHelper.createSelect({
      options: [
        {
          value: CUSTOM_BODY_PRESET_ID,
          label: localizer.t('editor_body_drawer_preset_custom'),
        },
        {
          value: 'banana',
          label: localizer.t('editor_body_drawer_preset_banana'),
        },
        {
          value: 'kiwano',
          label: localizer.t('editor_body_drawer_preset_kiwano'),
        },
        {
          value: 'pandaAnt',
          label: localizer.t('editor_body_drawer_preset_panda_ant'),
        },
        {
          value: 'pineapple',
          label: localizer.t('editor_body_drawer_preset_pineapple'),
        },
        {
          value: 'tomato',
          label: localizer.t('editor_body_drawer_preset_tomato'),
        },
        {
          value: 'watermelon',
          label: localizer.t('editor_body_drawer_preset_watermelon'),
        },
      ],
      selected: CUSTOM_BODY_PRESET_ID,
      width: '100%',
    })
    presetSelect.style.flex = '1 1 auto'
    presetSelect.style.width = '100%'
    presetSelect.style.background = 'rgba(255,255,255,0.08)'
    presetSelect.style.borderColor = 'rgba(255,255,255,0.18)'
    presetSelect.style.color = 'rgba(255,255,255,0.92)'
    presetSelect.style.padding = '6px 8px'
    presetSelect.style.fontSize = '11px'
    presetWrap.appendChild(presetLabel)
    presetWrap.appendChild(presetSelect)
    sidebar.appendChild(presetWrap)

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
      { labelWidth: '36px', gap: '8px', marginBottom: '0' }
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
    brushSlider.style.cssText = 'width:60px;max-width:60px;cursor:pointer;'
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
      { labelWidth: '36px', gap: '8px', marginBottom: '0' }
    )
    const colorInput: EditorColorInputElement =
      EditorUIHelper.createColorInput('#d6a86c')
    colorInput.value =
      options.initialProfile?.color ?? options.initialColor ?? colorInput.value
    colorRow.row.appendChild(colorInput)
    sidebar.appendChild(colorRow.row)

    const bloodColorRow = EditorUIHelper.createFormRow(
      localizer.t('editor_body_drawer_blood_color'),
      { labelWidth: '36px', gap: '8px', marginBottom: '0' }
    )
    const bloodColorInput: EditorColorInputElement =
      EditorUIHelper.createColorInput('#7a1010')
    bloodColorInput.value =
      options.initialProfile?.bloodColor ?? DEFAULT_BODY_BLOOD_COLOR
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
    const browCtx = this.browCanvas.getContext('2d')
    const workCtx = this.workCanvas.getContext('2d')
    if (
      !drawCtx ||
      !maskCtx ||
      !shapeCtx ||
      !textureCtx ||
      !browCtx ||
      !workCtx
    ) {
      close()
      return undefined
    }

    const maskState: EditorCanvasState = {
      canvas: this.maskCanvas,
      ctx: maskCtx,
      bounds: null,
      boundsDirty: false,
    }
    const shapeState: EditorCanvasState = {
      canvas: this.shapeCanvas,
      ctx: shapeCtx,
      bounds: null,
      boundsDirty: false,
    }
    const textureState: EditorCanvasState = {
      canvas: this.textureCanvas,
      ctx: textureCtx,
      bounds: null,
      boundsDirty: false,
    }

    let mode: BodyDrawMode = 'contour'
    let pointerActive = false
    let pointerChanged = false
    let settingsChanged = false
    let lastX = 0
    let lastY = 0
    let eyeX = DEFAULT_CHARACTER_EYE_X
    let eyeY = DEFAULT_CHARACTER_EYE_Y
    let eyeScaleX = DEFAULT_CHARACTER_EYE_SCALE
    let eyeScaleY = DEFAULT_CHARACTER_EYE_SCALE
    let eyeRotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG
    let eyeStyle: MapCharacterBodyEyeStyle = DEFAULT_CHARACTER_EYE_STYLE
    let browStyle: MapCharacterBodyBrowStyle = DEFAULT_CHARACTER_BROW_STYLE
    let browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
    let browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
    let browScaleX = DEFAULT_CHARACTER_BROW_SCALE
    let browScaleY = DEFAULT_CHARACTER_BROW_SCALE
    let browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG
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
    let selectionDragLayerId = -1
    let selectionScaleSession: EditorSelectionScaleSession | null = null
    let selectionRotateSession: EditorSelectionRotateSession | null = null
    let lastDragWorldX = 0
    let lastDragWorldY = 0
    let layerMenuTargetId = -1
    let renamingLayerId = -1
    let bloodColorAssigned =
      typeof options.initialProfile?.bloodColor === 'string'
    let exportBaseWidth =
      options.defaultBodyWidth && options.defaultBodyWidth > 0
        ? options.defaultBodyWidth
        : 1
    let exportBaseHeight =
      options.defaultBodyHeight && options.defaultBodyHeight > 0
        ? options.defaultBodyHeight
        : exportBaseWidth
    let exportReferenceWidth = LEGACY_PROFILE_REFERENCE_SIZE
    let exportReferenceHeight = LEGACY_PROFILE_REFERENCE_SIZE
    let nextLayerId = BROW_LAYER_ID + 1
    let selectedLayerId = CORE_LAYER_ID
    let activeSidebarTab: 'layers' | 'bones' = 'layers'
    let selectedBonePart: BonePart | null = null
    let selectedShapePart: BonePart | null = null
    let selectedBoundaryPart: BonePart | null = null
    let boneBoundaryBackup: EditorCollisionShape[] | null = null
    let skeletalModeEnabled = false
    const BONE_PARTS_ORDERED: BonePart[] = [
      'body',
      'head',
      'upperArmR',
      'forearmR',
      'handR',
      'upperArmL',
      'forearmL',
      'handL',
      'thighR',
      'lowerLegR',
      'footR',
      'thighL',
      'lowerLegL',
      'footL',
    ]
    interface BoneHierarchyNode {
      part: BonePart
      label: string
      children?: BoneHierarchyNode[]
    }
    const BONE_HIERARCHY: BoneHierarchyNode[] = [
      {
        part: 'body',
        label: '身体',
        children: [
          { part: 'head', label: '头部' },
          {
            part: 'upperArmR',
            label: '右上臂',
            children: [
              {
                part: 'forearmR',
                label: '右小臂',
                children: [{ part: 'handR', label: '右手掌' }],
              },
            ],
          },
          {
            part: 'upperArmL',
            label: '左上臂',
            children: [
              {
                part: 'forearmL',
                label: '左小臂',
                children: [{ part: 'handL', label: '左手掌' }],
              },
            ],
          },
          {
            part: 'thighR',
            label: '右大腿',
            children: [
              {
                part: 'lowerLegR',
                label: '右小腿',
                children: [{ part: 'footR', label: '右脚掌' }],
              },
            ],
          },
          {
            part: 'thighL',
            label: '左大腿',
            children: [
              {
                part: 'lowerLegL',
                label: '左小腿',
                children: [{ part: 'footL', label: '左脚掌' }],
              },
            ],
          },
        ],
      },
    ]
    const collapsedBonePartsSet = new Set<BonePart>()
    // Default bone positions forming a humanoid skeleton (pixels in 960×960 canvas).
    // Designed to fit within the default 320×320 viewport (world coords 320–640).
    const BONE_DEFAULT_POSITIONS: Record<
      BonePart,
      { pivotX: number; pivotY: number; tipX: number; tipY: number }
    > = {
      body: { pivotX: 480, pivotY: 474, tipX: 480, tipY: 376 },
      head: { pivotX: 480, pivotY: 376, tipX: 480, tipY: 340 },
      upperArmR: { pivotX: 508, pivotY: 384, tipX: 548, tipY: 422 },
      forearmR: { pivotX: 548, pivotY: 422, tipX: 578, tipY: 456 },
      handR: { pivotX: 578, pivotY: 456, tipX: 592, tipY: 472 },
      upperArmL: { pivotX: 452, pivotY: 384, tipX: 412, tipY: 422 },
      forearmL: { pivotX: 412, pivotY: 422, tipX: 382, tipY: 456 },
      handL: { pivotX: 382, pivotY: 456, tipX: 368, tipY: 472 },
      thighR: { pivotX: 495, pivotY: 468, tipX: 495, tipY: 542 },
      lowerLegR: { pivotX: 495, pivotY: 542, tipX: 495, tipY: 600 },
      footR: { pivotX: 495, pivotY: 600, tipX: 518, tipY: 614 },
      thighL: { pivotX: 465, pivotY: 468, tipX: 465, tipY: 542 },
      lowerLegL: { pivotX: 465, pivotY: 542, tipX: 465, tipY: 600 },
      footL: { pivotX: 465, pivotY: 600, tipX: 442, tipY: 614 },
    }
    const BONE_BASE_LAYER_ID = 100
    const getBoneLayerId = (part: BonePart): number =>
      BONE_BASE_LAYER_ID + BONE_PARTS_ORDERED.indexOf(part)
    let draggingLayerId = -1
    let dragPreviewLayerId = -1
    let dragPreviewAfter = false
    let currentPresetId: EditorCharacterBodyPresetId = CUSTOM_BODY_PRESET_ID
    let coreImageShape: HTMLImageElement | null = null
    let coreImageShapeMirrorX = false
    let collisionToolKind: EditorCollisionShapeKind = 'circle'
    let nextCollisionShapeId = 1
    let selectedCollisionShapeId = -1
    let collisionPointerShapeId = -1
    let collisionCreating = false
    let collisionScaleSession: EditorCollisionScaleSession | null = null
    let collisionRotateSession: EditorCollisionRotateSession | null = null
    let collisionShapesCustomized = false
    let collisionPreviewDirty = true
    let collisionPreviewLoops: number[][] | null = null
    const editorFacing =
      options.initialFacing && options.initialFacing < 0 ? -1 : 1
    eyeX *= editorFacing
    const layers: EditorBodyLayer[] = []
    const collisionShapes: EditorCollisionShape[] = []

    const createLayerCanvas = (): {
      canvas: HTMLCanvasElement
      ctx: CanvasRenderingContext2D | null
    } => {
      const canvas = document.createElement('canvas')
      canvas.width = DRAW_WORLD_SIZE
      canvas.height = DRAW_WORLD_SIZE
      return {
        canvas,
        ctx: canvas.getContext('2d'),
      }
    }

    const cloneBounds = (
      bounds: EditorCanvasBounds | null
    ): EditorCanvasBounds | null => {
      if (!bounds) {
        return null
      }
      return {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    }

    const createBoundsFromRect = (
      x: number,
      y: number,
      width: number,
      height: number
    ): EditorCanvasBounds | null => {
      if (width <= 0 || height <= 0) {
        return null
      }
      const minX = Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(x)))
      const minY = Math.max(0, Math.min(DRAW_WORLD_SIZE - 1, Math.round(y)))
      const maxX = Math.max(
        minX,
        Math.min(DRAW_WORLD_SIZE - 1, minX + Math.max(1, Math.round(width)) - 1)
      )
      const maxY = Math.max(
        minY,
        Math.min(
          DRAW_WORLD_SIZE - 1,
          minY + Math.max(1, Math.round(height)) - 1
        )
      )
      return { minX, minY, maxX, maxY }
    }

    const cloneCollisionShape = (
      shape: EditorCollisionShape
    ): EditorCollisionShape => {
      if (shape.kind === 'circle') {
        return {
          id: shape.id,
          kind: 'circle',
          centerX: shape.centerX,
          centerY: shape.centerY,
          radius: shape.radius,
        }
      }
      if (shape.kind === 'ellipse') {
        return {
          id: shape.id,
          kind: 'ellipse',
          centerX: shape.centerX,
          centerY: shape.centerY,
          radiusX: shape.radiusX,
          radiusY: shape.radiusY,
          rotationDeg: shape.rotationDeg,
        }
      }
      return {
        id: shape.id,
        kind: 'capsule',
        centerX: shape.centerX,
        centerY: shape.centerY,
        halfWidth: shape.halfWidth,
        halfHeight: shape.halfHeight,
        rotationDeg: shape.rotationDeg,
      }
    }

    const copyCollisionShapesSnapshot = (): EditorCollisionShape[] => {
      const snapshot = new Array<EditorCollisionShape>(collisionShapes.length)
      for (let i = 0; i < collisionShapes.length; i++) {
        snapshot[i] = cloneCollisionShape(collisionShapes[i])
      }
      return snapshot
    }

    const invalidateCollisionPreview = () => {
      collisionPreviewDirty = true
    }

    const clearCollisionShapes = () => {
      collisionShapes.length = 0
      selectedCollisionShapeId = -1
      collisionPointerShapeId = -1
      collisionCreating = false
      collisionScaleSession = null
      collisionRotateSession = null
      nextCollisionShapeId = 1
      invalidateCollisionPreview()
    }

    const restoreCollisionShapesSnapshot = (
      snapshot: readonly EditorCollisionShape[]
    ) => {
      collisionShapes.length = 0
      for (let i = 0; i < snapshot.length; i++) {
        collisionShapes.push(cloneCollisionShape(snapshot[i]))
      }
      let maxShapeId = 0
      for (let i = 0; i < collisionShapes.length; i++) {
        if (collisionShapes[i].id > maxShapeId) {
          maxShapeId = collisionShapes[i].id
        }
      }
      nextCollisionShapeId = maxShapeId + 1
      if (selectedCollisionShapeId >= 0) {
        let selectedFound = false
        for (let i = 0; i < collisionShapes.length; i++) {
          if (collisionShapes[i].id === selectedCollisionShapeId) {
            selectedFound = true
            break
          }
        }
        if (!selectedFound) {
          selectedCollisionShapeId = -1
        }
      }
      collisionPointerShapeId = -1
      collisionCreating = false
      collisionScaleSession = null
      collisionRotateSession = null
      invalidateCollisionPreview()
    }

    const mergeBounds = (
      target: EditorCanvasBounds | null,
      source: EditorCanvasBounds | null
    ): EditorCanvasBounds | null => {
      if (!source) {
        return target
      }
      if (!target) {
        return cloneBounds(source)
      }
      if (source.minX < target.minX) {
        target.minX = source.minX
      }
      if (source.minY < target.minY) {
        target.minY = source.minY
      }
      if (source.maxX > target.maxX) {
        target.maxX = source.maxX
      }
      if (source.maxY > target.maxY) {
        target.maxY = source.maxY
      }
      return target
    }

    const expandBoundsForStroke = (
      bounds: EditorCanvasBounds | null,
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      brushSize: number
    ): EditorCanvasBounds => {
      const radius = Math.max(1, Math.ceil(brushSize * 0.5))
      const minX = Math.max(0, Math.min(fromX, toX) - radius)
      const minY = Math.max(0, Math.min(fromY, toY) - radius)
      const maxX = Math.min(DRAW_WORLD_SIZE - 1, Math.max(fromX, toX) + radius)
      const maxY = Math.min(DRAW_WORLD_SIZE - 1, Math.max(fromY, toY) + radius)
      if (!bounds) {
        return { minX, minY, maxX, maxY }
      }
      if (minX < bounds.minX) {
        bounds.minX = minX
      }
      if (minY < bounds.minY) {
        bounds.minY = minY
      }
      if (maxX > bounds.maxX) {
        bounds.maxX = maxX
      }
      if (maxY > bounds.maxY) {
        bounds.maxY = maxY
      }
      return bounds
    }

    const translateBounds = (
      bounds: EditorCanvasBounds | null,
      offsetX: number,
      offsetY: number
    ): EditorCanvasBounds | null => {
      if (!bounds) {
        return null
      }
      return createBoundsFromRect(
        bounds.minX + offsetX,
        bounds.minY + offsetY,
        bounds.maxX + 1 - bounds.minX,
        bounds.maxY + 1 - bounds.minY
      )
    }

    const resolveCanvasBounds = (
      ctx: CanvasRenderingContext2D,
      bounds: EditorCanvasBounds | null,
      boundsDirty: boolean
    ): { bounds: EditorCanvasBounds | null; dirty: boolean } => {
      if (!boundsDirty) {
        return { bounds, dirty: false }
      }
      const nextBounds = this.readAlphaBounds(ctx, DRAW_WORLD_SIZE)
      return { bounds: nextBounds, dirty: false }
    }

    const captureCanvasSnapshot = (
      ctx: CanvasRenderingContext2D,
      bounds: EditorCanvasBounds | null,
      boundsDirty: boolean
    ): {
      snapshot: EditorCanvasSnapshot
      bounds: EditorCanvasBounds | null
    } => {
      const resolved = resolveCanvasBounds(ctx, bounds, boundsDirty)
      if (!resolved.bounds) {
        return {
          snapshot: { bounds: null, image: null },
          bounds: null,
        }
      }
      const width = resolved.bounds.maxX + 1 - resolved.bounds.minX
      const height = resolved.bounds.maxY + 1 - resolved.bounds.minY
      return {
        snapshot: {
          bounds: cloneBounds(resolved.bounds),
          image: ctx.getImageData(
            resolved.bounds.minX,
            resolved.bounds.minY,
            width,
            height
          ),
        },
        bounds: resolved.bounds,
      }
    }

    const applyCanvasSnapshot = (
      ctx: CanvasRenderingContext2D,
      snapshot: EditorCanvasSnapshot
    ): EditorCanvasBounds | null => {
      ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      if (snapshot.bounds && snapshot.image) {
        ctx.putImageData(
          snapshot.image,
          snapshot.bounds.minX,
          snapshot.bounds.minY
        )
      }
      return cloneBounds(snapshot.bounds)
    }

    const getLayerIndexById = (layerId: number): number => {
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].id === layerId) {
          return i
        }
      }
      return -1
    }

    const getLayerById = (layerId: number): EditorBodyLayer | null => {
      const index = getLayerIndexById(layerId)
      return index >= 0 ? layers[index] : null
    }

    const ensureLayerSurface = (layer: EditorBodyLayer): boolean => {
      if (layer.canvas && layer.ctx) {
        return true
      }
      const created = createLayerCanvas()
      if (!created.ctx) {
        return false
      }
      layer.canvas = created.canvas
      layer.ctx = created.ctx
      return true
    }

    const getSelectedLayer = (): EditorBodyLayer | null =>
      getLayerById(selectedLayerId)

    const isLayerMovable = (layer: EditorBodyLayer | null): boolean =>
      !!layer &&
      (layer.kind === 'eye' || layer.kind === 'brow' || layer.kind === 'paint')

    const isLayerScalable = (layer: EditorBodyLayer | null): boolean =>
      !!layer &&
      (layer.kind === 'core' ||
        layer.kind === 'eye' ||
        layer.kind === 'brow' ||
        layer.kind === 'paint')

    const ensureSelectedLayer = () => {
      if (getLayerById(selectedLayerId)) {
        return
      }
      selectedLayerId = CORE_LAYER_ID
    }

    const canDuplicateLayer = (layer: EditorBodyLayer | null): boolean =>
      !!layer && (layer.kind === 'brow' || layer.kind === 'paint')

    const canDeleteLayer = (layer: EditorBodyLayer | null): boolean =>
      !!layer && layer.kind === 'paint'

    const canStyleLayer = (layer: EditorBodyLayer | null): boolean =>
      !!layer && (layer.kind === 'eye' || layer.kind === 'brow')

    const isLayerRotatable = (layer: EditorBodyLayer | null): boolean =>
      !!layer &&
      (layer.kind === 'core' ||
        layer.kind === 'eye' ||
        layer.kind === 'brow' ||
        layer.kind === 'paint')

    const normalizeRotationDeg = (rotationDeg: number): number => {
      let normalized = Math.round(rotationDeg) % 360
      if (normalized > 180) {
        normalized -= 360
      } else if (normalized <= -180) {
        normalized += 360
      }
      return normalized
    }

    const getPointerAngleDeg = (
      pointX: number,
      pointY: number,
      centerX: number,
      centerY: number
    ): number =>
      Math.round(
        (Math.atan2(pointY - centerY, pointX - centerX) * 180) / Math.PI
      )

    const getRotationDeltaDeg = (
      startDeg: number,
      currentDeg: number
    ): number => normalizeRotationDeg(currentDeg - startDeg)

    const getLayerOrderSnapshot = (): number[] => {
      const order = new Array<number>(layers.length)
      for (let i = 0; i < layers.length; i++) {
        order[i] = layers[i].id
      }
      return order
    }

    const clearLayerList = () => {
      while (layerList.firstChild) {
        layerList.removeChild(layerList.firstChild)
      }
    }

    const sanitizeLayerName = (value: string, fallback: string): string => {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : fallback
    }

    const hideLayerMenu = () => {
      layerMenu.style.display = 'none'
      layerMenuTargetId = -1
    }

    const hideCollisionToolMenu = () => {
      collisionToolMenu.style.display = 'none'
    }

    const showPopupMenuAt = (
      menu: HTMLDivElement,
      clientX: number,
      clientY: number
    ) => {
      menu.style.display = 'flex'
      menu.style.left = '0px'
      menu.style.top = '0px'
      const formRect = form.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      let left = clientX - formRect.left
      let top = clientY - formRect.top
      if (left + menuRect.width > formRect.width - 4) {
        left = formRect.width - menuRect.width - 4
      }
      if (top + menuRect.height > formRect.height - 4) {
        top = formRect.height - menuRect.height - 4
      }
      if (left < 4) left = 4
      if (top < 4) top = 4
      menu.style.left = `${left}px`
      menu.style.top = `${top}px`
    }

    const hideCollisionShapeMenu = () => {
      collisionShapeMenu.style.display = 'none'
    }

    const beginLayerRename = (layerId: number) => {
      renamingLayerId = layerId
      renderLayerList()
      const input = layerList.querySelector(
        `input[data-layer-rename-id="${layerId}"]`
      )
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.select()
      }
    }

    const commitLayerRename = (layerId: number, value: string) => {
      const layer = getLayerById(layerId)
      renamingLayerId = -1
      if (!layer) {
        renderLayerList()
        return
      }
      const nextName = sanitizeLayerName(value, layer.name)
      if (nextName !== layer.name) {
        layer.name = nextName
        historyManager.capture()
      }
      renderLayerList()
    }

    const cancelLayerRename = () => {
      renamingLayerId = -1
      renderLayerList()
    }

    const resolveLayerBounds = (
      layer: EditorBodyLayer
    ): EditorCanvasBounds | null => {
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        const browBounds = getBrowBounds()
        return browBounds
          ? {
              minX: browBounds.centerX - browBounds.halfWidth,
              minY: browBounds.centerY - browBounds.halfHeight,
              maxX: browBounds.centerX + browBounds.halfWidth,
              maxY: browBounds.centerY + browBounds.halfHeight,
            }
          : null
      }
      if (
        !layer.ctx ||
        (layer.kind !== 'brow' &&
          layer.kind !== 'paint' &&
          layer.kind !== 'bone')
      ) {
        return null
      }
      if (!layer.boundsDirty) {
        return layer.bounds
      }
      layer.bounds = this.readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
      layer.boundsDirty = false
      return layer.bounds
    }

    const captureLayerSnapshot = (
      layer: EditorBodyLayer
    ): EditorBodyLayerSnapshot | null => {
      if (
        !layer.ctx ||
        (layer.kind !== 'brow' &&
          layer.kind !== 'paint' &&
          layer.kind !== 'bone')
      ) {
        return null
      }
      const captured = captureCanvasSnapshot(
        layer.ctx,
        layer.bounds,
        layer.boundsDirty
      )
      layer.bounds = captured.bounds
      layer.boundsDirty = false
      return {
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        image: captured.snapshot,
      }
    }

    const buildDefaultLayers = () => {
      layers.length = 0
      layers.push(
        {
          id: CORE_LAYER_ID,
          name: localizer.t('editor_body_drawer_layer_core'),
          kind: 'core',
          canvas: null,
          ctx: null,
          bounds: null,
          boundsDirty: false,
        },
        {
          id: EYE_LAYER_ID,
          name: localizer.t('editor_body_drawer_layer_eye'),
          kind: 'eye',
          canvas: null,
          ctx: null,
          bounds: null,
          boundsDirty: false,
        },
        {
          id: BROW_LAYER_ID,
          name: localizer.t('editor_body_drawer_layer_brow'),
          kind: 'brow',
          canvas: this.browCanvas,
          ctx: browCtx,
          bounds: null,
          boundsDirty: false,
        }
      )
      nextLayerId = BROW_LAYER_ID + 1
      ensureSelectedLayer()
    }

    const appendPaintLayer = (name?: string): EditorBodyLayer | null => {
      const layer: EditorBodyLayer = {
        id: nextLayerId++,
        name:
          name && name.length > 0
            ? name
            : `${localizer.t('editor_body_drawer_layer_custom')} ${nextLayerId - 4}`,
        kind: 'paint',
        canvas: null,
        ctx: null,
        bounds: null,
        boundsDirty: false,
      }
      layers.push(layer)
      return layer
    }

    const applyLayerOrder = (order: number[]) => {
      if (layers.length === 0) {
        return
      }
      const nextLayers: EditorBodyLayer[] = []
      const used = new Set<number>()
      for (let i = 0; i < order.length; i++) {
        const layerId = order[i]
        if (used.has(layerId)) {
          continue
        }
        const layer = getLayerById(layerId)
        if (!layer) {
          continue
        }
        nextLayers.push(layer)
        used.add(layerId)
      }
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        if (used.has(layer.id)) {
          continue
        }
        nextLayers.push(layer)
        used.add(layer.id)
      }
      layers.splice(0, layers.length, ...nextLayers)
    }

    const getDisplayLayerIds = (): number[] => {
      const ids = new Array<number>(layers.length)
      let writeIndex = 0
      for (let i = layers.length - 1; i >= 0; i--) {
        ids[writeIndex++] = layers[i].id
      }
      return ids
    }

    const moveDisplayLayer = (
      dragLayerId: number,
      targetLayerId: number,
      insertAfter: boolean
    ): boolean => {
      if (dragLayerId === targetLayerId) {
        return false
      }
      const displayIds = getDisplayLayerIds()
      const dragIndex = displayIds.indexOf(dragLayerId)
      const targetIndex = displayIds.indexOf(targetLayerId)
      if (dragIndex < 0 || targetIndex < 0) {
        return false
      }
      displayIds.splice(dragIndex, 1)
      const nextTargetIndex = displayIds.indexOf(targetLayerId)
      if (nextTargetIndex < 0) {
        return false
      }
      let insertIndex = nextTargetIndex
      if (insertAfter) {
        insertIndex = nextTargetIndex + 1
      }
      displayIds.splice(insertIndex, 0, dragLayerId)
      const nextOrder = new Array<number>(displayIds.length)
      let writeIndex = 0
      for (let i = displayIds.length - 1; i >= 0; i--) {
        nextOrder[writeIndex++] = displayIds[i]
      }
      applyLayerOrder(nextOrder)
      return true
    }

    const applyLayerPreviewStyles = (layerId: number, insertAfter: boolean) => {
      const row = layerList.querySelector<HTMLDivElement>(
        `.editor-body-layer-row[data-layer-id="${layerId}"]`
      )
      if (!row) {
        return
      }
      row.style.boxShadow = insertAfter
        ? 'inset 0 -2px 0 rgba(255,255,255,0.82)'
        : 'inset 0 2px 0 rgba(255,255,255,0.82)'
    }

    const clearLayerDragPreview = () => {
      if (dragPreviewLayerId === -1) {
        return
      }
      const row = layerList.querySelector<HTMLDivElement>(
        `.editor-body-layer-row[data-layer-id="${dragPreviewLayerId}"]`
      )
      if (row) {
        row.style.boxShadow = ''
      }
      dragPreviewLayerId = -1
      dragPreviewAfter = false
    }

    const updateLayerDragPreview = (layerId: number, insertAfter: boolean) => {
      if (dragPreviewLayerId === layerId && dragPreviewAfter === insertAfter) {
        return
      }
      clearLayerDragPreview()
      if (draggingLayerId === -1 || draggingLayerId === layerId) {
        return
      }
      dragPreviewLayerId = layerId
      dragPreviewAfter = insertAfter
      applyLayerPreviewStyles(layerId, insertAfter)
    }

    const resetLayerDragState = () => {
      clearLayerDragPreview()
      draggingLayerId = -1
    }

    const cloneLayer = (source: EditorBodyLayer): EditorBodyLayer | null => {
      if (!canDuplicateLayer(source)) {
        return null
      }
      const duplicate = appendPaintLayer(
        `${source.name} ${localizer.t('editor_body_drawer_layer_copy_suffix')}`
      )
      if (!duplicate) {
        return null
      }
      if (source.kind === 'eye') {
        return null
      }
      if (source.canvas && ensureLayerSurface(duplicate) && duplicate.ctx) {
        duplicate.ctx.drawImage(source.canvas, 0, 0)
      }
      duplicate.bounds = cloneBounds(source.bounds)
      duplicate.boundsDirty = source.boundsDirty
      return duplicate
    }

    const deletePaintLayer = (layerId: number): boolean => {
      const index = getLayerIndexById(layerId)
      if (index < 0 || layers[index].kind !== 'paint') {
        return false
      }
      layers.splice(index, 1)
      if (selectedLayerId === layerId) {
        selectedLayerId = CORE_LAYER_ID
      }
      return true
    }

    const restoreLayerSnapshots = (
      snapshots: EditorBodyLayerSnapshot[],
      order?: number[]
    ) => {
      buildDefaultLayers()
      browCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      const browLayer = getLayerById(BROW_LAYER_ID)
      if (browLayer) {
        browLayer.bounds = null
        browLayer.boundsDirty = false
      }
      for (let i = 0; i < snapshots.length; i++) {
        const snapshot = snapshots[i]
        let layer: EditorBodyLayer | null = null
        if (snapshot.kind === 'brow' && snapshot.id === BROW_LAYER_ID) {
          layer = getLayerById(BROW_LAYER_ID)
        } else {
          layer = appendPaintLayer(snapshot.name)
          if (layer) {
            layer.id = snapshot.id
            if (snapshot.id >= nextLayerId) {
              nextLayerId = snapshot.id + 1
            }
          }
        }
        if (!layer || !ensureLayerSurface(layer) || !layer.ctx) {
          continue
        }
        layer.name = snapshot.name
        layer.bounds = applyCanvasSnapshot(layer.ctx, snapshot.image)
        layer.boundsDirty = false
      }
      if (order && order.length > 0) {
        applyLayerOrder(order)
      }
      ensureSelectedLayer()
    }

    const updateLayerMenuButtons = () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      const renameEnabled = !!targetLayer
      const styleEnabled = canStyleLayer(targetLayer)
      const duplicateEnabled = canDuplicateLayer(targetLayer)
      const deleteEnabled = canDeleteLayer(targetLayer)
      renameLayerBtn.disabled = !renameEnabled
      renameLayerBtn.style.opacity = renameEnabled ? '1' : '0.4'
      renameLayerBtn.style.cursor = renameEnabled ? 'pointer' : 'default'
      styleLayerBtn.disabled = !styleEnabled
      styleLayerBtn.style.opacity = styleEnabled ? '1' : '0.4'
      styleLayerBtn.style.cursor = styleEnabled ? 'pointer' : 'default'
      duplicateLayerBtn.disabled = !duplicateEnabled
      duplicateLayerBtn.style.opacity = duplicateEnabled ? '1' : '0.4'
      duplicateLayerBtn.style.cursor = duplicateEnabled ? 'pointer' : 'default'
      deleteLayerBtn.disabled = !deleteEnabled
      deleteLayerBtn.style.opacity = deleteEnabled ? '1' : '0.4'
      deleteLayerBtn.style.cursor = deleteEnabled ? 'pointer' : 'default'
    }

    const showLayerMenu = (
      clientX: number,
      clientY: number,
      layerId: number
    ) => {
      layerMenuTargetId = layerId
      updateLayerMenuButtons()
      layerMenu.style.display = 'flex'
      layerMenu.style.left = '0px'
      layerMenu.style.top = '0px'
      const formRect = form.getBoundingClientRect()
      const menuRect = layerMenu.getBoundingClientRect()
      let left = clientX - formRect.left
      let top = clientY - formRect.top
      if (left + menuRect.width > formRect.width - 4) {
        left = formRect.width - menuRect.width - 4
      }
      if (top + menuRect.height > formRect.height - 4) {
        top = formRect.height - menuRect.height - 4
      }
      if (left < 4) left = 4
      if (top < 4) top = 4
      layerMenu.style.left = `${left}px`
      layerMenu.style.top = `${top}px`
    }

    const confirmDeleteLayer = async (layerName: string): Promise<boolean> => {
      return await new Promise((resolve) => {
        const { modal: confirmModal, close: closeConfirm } =
          EditorUIHelper.createModal({ zIndex: 10003 })
        const confirmForm = EditorUIHelper.createFormContainer({
          minWidth: '280px',
        })
        confirmForm.style.minWidth = '280px'
        confirmForm.style.padding = '16px'
        confirmForm.style.gap = '12px'
        const confirmTitle = EditorUIHelper.createFormTitle(
          localizer.t('editor_body_drawer_layer_delete')
        )
        confirmTitle.style.marginBottom = '8px'
        const confirmText = document.createElement('div')
        confirmText.textContent = localizer
          .t('editor_body_drawer_layer_delete_confirm')
          .replace('{name}', layerName)
        confirmText.style.cssText =
          'font-size:11px;line-height:1.5;color:rgba(255,255,255,0.84);'
        const confirmFooter = EditorUIHelper.createButtonRow({
          gap: '8px',
          marginTop: '0',
        })
        const confirmDeleteBtn = EditorUIHelper.createButton(
          localizer.t('editor_btn_confirm'),
          { primary: true }
        )
        const confirmCancelBtn = EditorUIHelper.createButton(
          localizer.t('editor_btn_cancel')
        )
        confirmFooter.appendChild(confirmDeleteBtn)
        confirmFooter.appendChild(confirmCancelBtn)
        confirmForm.appendChild(confirmTitle)
        confirmForm.appendChild(confirmText)
        confirmForm.appendChild(confirmFooter)
        confirmModal.appendChild(confirmForm)
        viewport.appendChild(confirmModal)
        confirmDeleteBtn.addEventListener('click', () => {
          closeConfirm()
          resolve(true)
        })
        confirmCancelBtn.addEventListener('click', () => {
          closeConfirm()
          resolve(false)
        })
        confirmModal.addEventListener('click', (event) => {
          if (event.target === confirmModal) {
            closeConfirm()
            resolve(false)
          }
        })
      })
    }

    const chooseLayerStyle = async (
      layer: EditorBodyLayer
    ): Promise<MapCharacterBodyEyeStyle | MapCharacterBodyBrowStyle | null> => {
      return await new Promise((resolve) => {
        const { modal: styleModal, close: closeStyle } =
          EditorUIHelper.createModal({ zIndex: 10003 })
        const styleForm = EditorUIHelper.createFormContainer({
          minWidth: '280px',
        })
        styleForm.style.minWidth = '280px'
        styleForm.style.padding = '16px'
        styleForm.style.gap = '10px'
        const styleTitle = EditorUIHelper.createFormTitle(
          localizer.t('editor_body_drawer_layer_style')
        )
        styleTitle.style.marginBottom = '4px'
        const options =
          layer.kind === 'eye'
            ? [
                {
                  value: 'standard',
                  label: localizer.t('editor_body_drawer_style_eye_standard'),
                },
                {
                  value: 'noOutline',
                  label: localizer.t('editor_body_drawer_style_eye_no_outline'),
                },
                {
                  value: 'pupilOnly',
                  label: localizer.t('editor_body_drawer_style_eye_pupil_only'),
                },
                {
                  value: 'cute',
                  label: localizer.t('editor_body_drawer_style_eye_cute'),
                },
                {
                  value: 'transparent',
                  label: localizer.t(
                    'editor_body_drawer_style_eye_transparent'
                  ),
                },
              ]
            : [
                {
                  value: 'none',
                  label: localizer.t('editor_body_drawer_style_brow_none'),
                },
                {
                  value: 'thick',
                  label: localizer.t('editor_body_drawer_style_brow_thick'),
                },
                {
                  value: 'thin',
                  label: localizer.t('editor_body_drawer_style_brow_thin'),
                },
                {
                  value: 'straight',
                  label: localizer.t('editor_body_drawer_style_brow_straight'),
                },
              ]
        const selectedValue = layer.kind === 'eye' ? eyeStyle : browStyle
        const select = EditorUIHelper.createSelect({
          options,
          selected: selectedValue,
          width: '100%',
        })
        const footerRow = EditorUIHelper.createButtonRow({
          gap: '8px',
          marginTop: '4px',
        })
        const confirmStyleBtn = EditorUIHelper.createButton(
          localizer.t('editor_btn_confirm'),
          { primary: true }
        )
        const cancelStyleBtn = EditorUIHelper.createButton(
          localizer.t('editor_btn_cancel')
        )
        footerRow.appendChild(confirmStyleBtn)
        footerRow.appendChild(cancelStyleBtn)
        styleForm.appendChild(styleTitle)
        styleForm.appendChild(select)
        styleForm.appendChild(footerRow)
        styleModal.appendChild(styleForm)
        viewport.appendChild(styleModal)
        confirmStyleBtn.addEventListener('click', () => {
          const nextValue = select.value as
            | MapCharacterBodyEyeStyle
            | MapCharacterBodyBrowStyle
          closeStyle()
          resolve(nextValue)
        })
        cancelStyleBtn.addEventListener('click', () => {
          closeStyle()
          resolve(null)
        })
        styleModal.addEventListener('click', (event) => {
          if (event.target === styleModal) {
            closeStyle()
            resolve(null)
          }
        })
      })
    }

    const getOrCreateBoneLayer = (part: BonePart): EditorBodyLayer => {
      const id = getBoneLayerId(part)
      const existing = layers.find((l) => l.id === id)
      if (existing) return existing
      const { canvas, ctx } = createLayerCanvas()
      const layer: EditorBodyLayer = {
        id,
        name: part,
        kind: 'bone',
        canvas,
        ctx,
        bounds: null,
        boundsDirty: false,
        bonePart: part,
        bonePivotX: BONE_DEFAULT_POSITIONS[part].pivotX,
        bonePivotY: BONE_DEFAULT_POSITIONS[part].pivotY,
        boneTipX: BONE_DEFAULT_POSITIONS[part].tipX,
        boneTipY: BONE_DEFAULT_POSITIONS[part].tipY,
      }
      layers.push(layer)
      return layer
    }

    const ensureAllBoneLayers = () => {
      for (const part of BONE_PARTS_ORDERED) {
        getOrCreateBoneLayer(part)
      }
    }

    const createDefaultBoneBoundary = (
      part: BonePart
    ): EditorCollisionShape => {
      const layer = layers.find((l) => l.bonePart === part)
      const def = BONE_DEFAULT_POSITIONS[part]
      const px = layer?.bonePivotX ?? def.pivotX
      const py = layer?.bonePivotY ?? def.pivotY
      const tx = layer?.boneTipX ?? def.tipX
      const ty = layer?.boneTipY ?? def.tipY
      const cx = (px + tx) >> 1
      const cy = (py + ty) >> 1
      const dx = tx - px
      const dy = ty - py
      const halfHeight = Math.max(
        MIN_COLLISION_HALF_EXTENT,
        Math.round(Math.sqrt(dx * dx + dy * dy) / 2)
      )
      const halfWidth = Math.max(
        MIN_COLLISION_HALF_EXTENT,
        Math.round((0.06 * LEGACY_PROFILE_REFERENCE_SIZE) / 2)
      )
      // After ctx.rotate(θ), local Y = (-sinθ, cosθ). To align with (dx,dy):
      // -sinθ = dx/len, cosθ = dy/len  →  θ = atan2(-dx, dy)
      const rotationDeg = normalizeRotationDeg(
        dx === 0 && dy === 0
          ? 0
          : Math.round(Math.atan2(-dx, dy) * (180 / Math.PI))
      )
      return {
        id: nextCollisionShapeId++,
        kind: 'capsule',
        centerX: cx,
        centerY: cy,
        halfWidth,
        halfHeight,
        rotationDeg,
      }
    }

    const enterBoneBoundaryMode = (part: BonePart) => {
      if (selectedBoundaryPart !== null) {
        const prevLayer = layers.find(
          (l) => l.bonePart === selectedBoundaryPart
        )
        if (prevLayer)
          prevLayer.boneBoundaryShapes = copyCollisionShapesSnapshot()
      } else {
        boneBoundaryBackup = copyCollisionShapesSnapshot()
      }
      const layer = getOrCreateBoneLayer(part)
      if (!layer.boneBoundaryShapes || layer.boneBoundaryShapes.length === 0) {
        layer.boneBoundaryShapes = [createDefaultBoneBoundary(part)]
      }
      restoreCollisionShapesSnapshot(layer.boneBoundaryShapes)
      selectedBoundaryPart = part
    }

    const leaveBoneBoundaryMode = () => {
      if (selectedBoundaryPart === null) return
      const layer = layers.find((l) => l.bonePart === selectedBoundaryPart)
      if (layer) layer.boneBoundaryShapes = copyCollisionShapesSnapshot()
      restoreCollisionShapesSnapshot(boneBoundaryBackup ?? [])
      boneBoundaryBackup = null
      selectedBoundaryPart = null
    }

    const getBoneSegments = (): BoneSegment[] => {
      const result: BoneSegment[] = []
      for (const part of BONE_PARTS_ORDERED) {
        const layer = layers.find((l) => l.bonePart === part)
        const def = BONE_DEFAULT_POSITIONS[part]
        const pivotX = layer?.bonePivotX ?? def.pivotX
        const pivotY = layer?.bonePivotY ?? def.pivotY
        const tipX = layer?.boneTipX ?? def.tipX
        const tipY = layer?.boneTipY ?? def.tipY
        const dx = tipX - pivotX
        const dy = tipY - pivotY
        // length in meters: pixel distance / LEGACY_PROFILE_REFERENCE_SIZE
        const length =
          Math.round(Math.sqrt(dx * dx + dy * dy)) /
          LEGACY_PROFILE_REFERENCE_SIZE
        let shapeDataUrl: string | undefined
        let shapeOffsetX: number | undefined
        let shapeOffsetY: number | undefined
        let shapeWidth: number | undefined
        let shapeHeight: number | undefined
        if (layer?.canvas && layer.ctx) {
          const bounds = layer.boundsDirty
            ? this.readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
            : layer.bounds
          if (bounds) {
            const dataUrl = this.cropCanvasDataUrl(
              layer.canvas,
              bounds.minX,
              bounds.minY,
              bounds.maxX + 1,
              bounds.maxY + 1
            )
            if (dataUrl) {
              shapeDataUrl = dataUrl
              shapeOffsetX = bounds.minX
              shapeOffsetY = bounds.minY
              shapeWidth = bounds.maxX + 1 - bounds.minX
              shapeHeight = bounds.maxY + 1 - bounds.minY
            }
          }
        }
        // If this bone is currently in boundary edit mode, get its live shapes
        const boundarySource =
          selectedBoundaryPart === part
            ? copyCollisionShapesSnapshot()
            : layer?.boneBoundaryShapes
        const boundaryShapes = boundarySource?.map(
          buildMapCollisionShapeFromEditor
        )
        result.push({
          part,
          length: Math.max(0.01, Math.round(length * 100) / 100),
          width: 0.06,
          shapeDataUrl,
          shapeOffsetX,
          shapeOffsetY,
          shapeWidth,
          shapeHeight,
          pivotX,
          pivotY,
          tipX,
          tipY,
          boundaryShapes,
        })
      }
      return result
    }

    const hasAnyBoneData = (): boolean =>
      layers.some(
        (layer) =>
          layer.kind === 'bone' &&
          (layer.bounds !== null || !!layer.boneBoundaryShapes?.length)
      )

    const loadBoneSegments = (segments: BoneSegment[]) => {
      for (const seg of segments) {
        const layer = getOrCreateBoneLayer(seg.part)
        if (seg.pivotX !== undefined) layer.bonePivotX = seg.pivotX
        if (seg.pivotY !== undefined) layer.bonePivotY = seg.pivotY
        if (seg.tipX !== undefined) layer.boneTipX = seg.tipX
        if (seg.tipY !== undefined) layer.boneTipY = seg.tipY
        if (seg.boundaryShapes && seg.boundaryShapes.length > 0) {
          layer.boneBoundaryShapes = seg.boundaryShapes.map((s) => {
            if (s.kind === 'circle') {
              return {
                id: nextCollisionShapeId++,
                kind: 'circle' as const,
                centerX: Math.round(s.center.x),
                centerY: Math.round(s.center.y),
                radius: Math.max(MIN_COLLISION_RADIUS, Math.round(s.radius)),
              }
            }
            if (s.kind === 'ellipse') {
              return {
                id: nextCollisionShapeId++,
                kind: 'ellipse' as const,
                centerX: Math.round(s.center.x),
                centerY: Math.round(s.center.y),
                radiusX: Math.max(MIN_COLLISION_RADIUS, Math.round(s.radiusX)),
                radiusY: Math.max(MIN_COLLISION_RADIUS, Math.round(s.radiusY)),
                rotationDeg: Math.round(s.rotationDeg ?? 0),
              }
            }
            return {
              id: nextCollisionShapeId++,
              kind: 'capsule' as const,
              centerX: Math.round(s.center.x),
              centerY: Math.round(s.center.y),
              halfWidth: Math.max(
                MIN_COLLISION_HALF_EXTENT,
                Math.round(s.halfWidth)
              ),
              halfHeight: Math.max(
                MIN_COLLISION_HALF_EXTENT,
                Math.round(s.halfHeight)
              ),
              rotationDeg: Math.round(s.rotationDeg ?? 0),
            }
          })
        }
        if (seg.shapeDataUrl && layer.canvas && layer.ctx) {
          const img = new Image()
          img.onload = () => {
            if (!layer.canvas || !layer.ctx) return
            layer.ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
            layer.ctx.drawImage(
              img,
              seg.shapeOffsetX ?? 0,
              seg.shapeOffsetY ?? 0
            )
            layer.bounds = null
            layer.boundsDirty = true
          }
          img.src = seg.shapeDataUrl
        }
      }
    }

    const renderBoneList = () => {
      while (boneList.firstChild) boneList.removeChild(boneList.firstChild)

      const subRowStyle = (isActive: boolean, isBoundary: boolean) =>
        [
          'width:100%',
          'padding:2px 4px',
          'text-align:left',
          'font-size:9px',
          'font-family:monospace',
          'cursor:pointer',
          'border-radius:2px',
          'box-sizing:border-box',
          'white-space:nowrap',
          'overflow:hidden',
          'text-overflow:ellipsis',
          isBoundary
            ? 'color:rgba(255,180,100,0.72)'
            : 'color:rgba(255,255,255,0.5)',
          isActive
            ? 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3)'
            : 'background:rgba(255,255,255,0.03);border:1px solid transparent',
        ].join(';')

      const makeSubRow = (part: BonePart, kind: 'shape' | 'boundary') => {
        const isActive =
          kind === 'shape'
            ? selectedShapePart === part
            : selectedBoundaryPart === part
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.style.cssText = subRowStyle(isActive, kind === 'boundary')
        btn.textContent = `◦ ${kind === 'shape' ? '形状' : '边界'}`
        btn.addEventListener('click', () => {
          if (kind === 'shape') {
            leaveBoneBoundaryMode()
            selectedShapePart = part
            selectedBonePart = null
            selectedLayerId = getBoneLayerId(part)
            getOrCreateBoneLayer(part)
            mode = 'shape'
            bonePropPanel.style.display = 'none'
          } else {
            selectedBonePart = null
            selectedShapePart = null
            bonePropPanel.style.display = 'none'
            enterBoneBoundaryMode(part)
            mode = 'collision'
          }
          updateModeButtons()
          renderBoneList()
          renderComposite()
        })
        return btn
      }

      const renderNode = (node: BoneHierarchyNode, container: HTMLElement) => {
        const { part, label, children = [] } = node
        const isBoneActive = selectedBonePart === part
        const isParentOfSelected =
          selectedShapePart === part || selectedBoundaryPart === part

        const details = document.createElement('details')
        details.className = 'editor-object-group'
        details.open = !collapsedBonePartsSet.has(part)
        details.addEventListener('toggle', () => {
          if (details.open) {
            collapsedBonePartsSet.delete(part)
          } else {
            collapsedBonePartsSet.add(part)
          }
        })

        const summary = document.createElement('summary')
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'editor-object-toggle'
        toggle.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          details.open = !details.open
        })
        summary.appendChild(toggle)

        const boneBtn = document.createElement('button')
        boneBtn.type = 'button'
        boneBtn.style.cssText = [
          'flex:1',
          'min-width:0',
          'padding:2px 4px',
          'text-align:left',
          'font-size:10px',
          'font-family:monospace',
          'cursor:pointer',
          'border-radius:2px',
          'box-sizing:border-box',
          'color:rgba(255,255,255,0.88)',
          'white-space:nowrap',
          'overflow:hidden',
          'text-overflow:ellipsis',
          isBoneActive
            ? 'background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3)'
            : isParentOfSelected
              ? 'background:rgba(255,255,255,0.06);border:1px dashed rgba(255,255,255,0.35)'
              : 'background:transparent;border:1px solid transparent',
        ].join(';')
        boneBtn.textContent = label
        boneBtn.addEventListener('click', (e) => {
          e.preventDefault()
          leaveBoneBoundaryMode()
          selectedBonePart = part
          selectedShapePart = null
          const seg = getBoneSegments().find((s) => s.part === part)
          boneLengthRow.inp.value = String(seg?.length ?? 0.15)
          boneWidthRow.inp.value = String(seg?.width ?? 0.06)
          bonePropPanel.style.display = 'flex'
          updateModeButtons()
          renderBoneList()
          renderComposite()
        })
        summary.appendChild(boneBtn)
        details.appendChild(summary)

        const childrenEl = document.createElement('div')
        childrenEl.className = 'editor-object-children'
        childrenEl.appendChild(makeSubRow(part, 'shape'))
        childrenEl.appendChild(makeSubRow(part, 'boundary'))
        for (const child of children) {
          renderNode(child, childrenEl)
        }
        details.appendChild(childrenEl)
        container.appendChild(details)
      }

      for (const node of BONE_HIERARCHY) {
        renderNode(node, boneList)
      }
    }

    const renderLayerList = () => {
      clearLayerList()
      const collisionRow = document.createElement('div')
      collisionRow.className = 'editor-body-layer-row'
      collisionRow.style.cssText = [
        'width:100%',
        'padding:6px 6px',
        mode === 'collision'
          ? 'background:rgba(255,255,255,0.18)'
          : 'background:rgba(255,255,255,0.08)',
        mode === 'collision'
          ? 'border:1px solid rgba(255,255,255,0.4)'
          : 'border:1px solid rgba(255,255,255,0.18)',
        'color:rgba(255,255,255,0.9)',
        'font-family:monospace',
        'font-size:10px',
        'line-height:1.2',
        'text-align:left',
        'word-break:break-all',
        'cursor:pointer',
        'box-sizing:border-box',
      ].join(';')
      collisionRow.textContent = localizer.t(
        'editor_body_drawer_layer_collision'
      )
      collisionRow.addEventListener('click', () => {
        if (!contourClosed) {
          return
        }
        hideContourMenu()
        hideLayerMenu()
        hideCollisionToolMenu()
        hideCollisionShapeMenu()
        mode = 'collision'
        renderLayerList()
        updateModeButtons()
        updateCursorVisual()
        renderComposite()
      })
      layerList.appendChild(collisionRow)
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]
        if (layer.kind === 'bone') continue
        const active = mode !== 'collision' && layer.id === selectedLayerId
        const row = document.createElement('div')
        row.className = 'editor-body-layer-row'
        row.draggable = true
        row.dataset.layerId = String(layer.id)
        row.style.cssText = [
          'width:100%',
          'padding:6px 6px',
          active
            ? 'background:rgba(255,255,255,0.18)'
            : 'background:rgba(255,255,255,0.08)',
          active
            ? 'border:1px solid rgba(255,255,255,0.4)'
            : 'border:1px solid rgba(255,255,255,0.18)',
          'color:rgba(255,255,255,0.9)',
          'font-family:monospace',
          'font-size:10px',
          'line-height:1.2',
          'text-align:left',
          'word-break:break-all',
          'cursor:pointer',
          'box-sizing:border-box',
        ].join(';')
        if (renamingLayerId === layer.id) {
          const input = document.createElement('input')
          input.type = 'text'
          input.value = layer.name
          input.dataset.layerRename = '1'
          input.dataset.layerRenameId = String(layer.id)
          input.style.cssText = [
            'width:100%',
            'padding:0',
            'margin:0',
            'background:transparent',
            'border:none',
            'outline:none',
            'color:rgba(255,255,255,0.95)',
            'font-family:monospace',
            'font-size:10px',
            'line-height:1.2',
            'box-sizing:border-box',
          ].join(';')
          let renameCommitted = false
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              renameCommitted = true
              commitLayerRename(layer.id, input.value)
              event.preventDefault()
              event.stopPropagation()
              return
            }
            if (event.key === 'Escape') {
              renameCommitted = true
              cancelLayerRename()
              event.preventDefault()
              event.stopPropagation()
            }
          })
          input.addEventListener('blur', () => {
            if (renameCommitted) {
              return
            }
            commitLayerRename(layer.id, input.value)
          })
          row.appendChild(input)
          layerList.appendChild(row)
          continue
        }
        row.textContent = layer.name
        row.addEventListener('click', () => {
          hideContourMenu()
          hideLayerMenu()
          hideCollisionToolMenu()
          hideCollisionShapeMenu()
          selectedLayerId = layer.id
          if (layer.kind === 'eye' || layer.kind === 'brow') {
            mode = 'select'
          } else if (mode === 'select') {
            renderLayerList()
            updateModeButtons()
            updateCursorVisual()
            renderComposite()
            return
          } else if (mode === 'contour' && layer.kind !== 'core') {
            mode = 'shape'
          }
          renderLayerList()
          updateModeButtons()
          updateCursorVisual()
          renderComposite()
        })
        row.addEventListener('contextmenu', (event) => {
          hideContourMenu()
          hideCollisionToolMenu()
          hideCollisionShapeMenu()
          selectedLayerId = layer.id
          renderLayerList()
          showLayerMenu(event.clientX, event.clientY, layer.id)
          event.preventDefault()
          event.stopPropagation()
        })
        row.addEventListener('dragstart', (event) => {
          draggingLayerId = layer.id
          clearLayerDragPreview()
          row.style.opacity = '0.45'
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', String(layer.id))
          }
        })
        row.addEventListener('dragover', (event) => {
          if (draggingLayerId < 0 || draggingLayerId === layer.id) {
            return
          }
          event.preventDefault()
          const rect = row.getBoundingClientRect()
          const insertAfter = event.clientY >= rect.top + rect.height * 0.5
          updateLayerDragPreview(layer.id, insertAfter)
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move'
          }
        })
        row.addEventListener('dragend', () => {
          row.style.opacity = ''
          resetLayerDragState()
        })
        layerList.appendChild(row)
      }
    }

    layerList.addEventListener('dragover', (event) => {
      if (draggingLayerId === -1) {
        return
      }
      event.preventDefault()
      const target = event.target as HTMLElement | null
      const row = target?.closest<HTMLDivElement>('.editor-body-layer-row')
      if (row && row.dataset.layerId) {
        const layerId = Number.parseInt(row.dataset.layerId, 10)
        const rect = row.getBoundingClientRect()
        const insertAfter = event.clientY >= rect.top + rect.height * 0.5
        updateLayerDragPreview(layerId, insertAfter)
      } else {
        const rows = Array.from(
          layerList.querySelectorAll<HTMLDivElement>('.editor-body-layer-row')
        )
        if (rows.length === 0) {
          return
        }
        const firstRect = rows[0].getBoundingClientRect()
        const lastRect = rows[rows.length - 1].getBoundingClientRect()
        const firstId = Number.parseInt(rows[0].dataset.layerId || '-1', 10)
        const lastId = Number.parseInt(
          rows[rows.length - 1].dataset.layerId || '-1',
          10
        )
        if (event.clientY < firstRect.top + firstRect.height) {
          if (firstId >= 0) {
            updateLayerDragPreview(firstId, false)
          }
        } else if (event.clientY > lastRect.top) {
          if (lastId >= 0) {
            updateLayerDragPreview(lastId, true)
          }
        }
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    })

    layerList.addEventListener('drop', (event) => {
      if (draggingLayerId === -1) {
        return
      }
      event.preventDefault()
      const dragLayerId = draggingLayerId
      const previewLayerId = dragPreviewLayerId
      const previewAfter = dragPreviewAfter
      resetLayerDragState()
      if (previewLayerId === -1) {
        renderLayerList()
        return
      }
      const didMove = moveDisplayLayer(
        dragLayerId,
        previewLayerId,
        previewAfter
      )
      renderLayerList()
      if (!didMove) {
        return
      }
      invalidatePresetSelection()
      renderComposite()
      historyManager.capture()
    })

    buildDefaultLayers()

    const captureHistorySnapshot =
      (): EditorCharacterBodyDrawerHistorySnapshot => {
        const layerSnapshots: EditorBodyLayerSnapshot[] = []
        for (let i = 0; i < layers.length; i++) {
          const snapshot = captureLayerSnapshot(layers[i])
          if (snapshot) {
            layerSnapshots.push(snapshot)
          }
        }
        const maskSnapshot = captureCanvasSnapshot(
          maskState.ctx,
          maskState.bounds,
          maskState.boundsDirty
        )
        maskState.bounds = maskSnapshot.bounds
        maskState.boundsDirty = false
        const shapeSnapshot = captureCanvasSnapshot(
          shapeState.ctx,
          shapeState.bounds,
          shapeState.boundsDirty
        )
        shapeState.bounds = shapeSnapshot.bounds
        shapeState.boundsDirty = false
        const textureSnapshot = captureCanvasSnapshot(
          textureState.ctx,
          textureState.bounds,
          textureState.boundsDirty
        )
        textureState.bounds = textureSnapshot.bounds
        textureState.boundsDirty = false
        return {
          mask: maskSnapshot.snapshot,
          shape: shapeSnapshot.snapshot,
          texture: textureSnapshot.snapshot,
          layers: layerSnapshots,
          layerOrder: getLayerOrderSnapshot(),
          brushSize: brushSlider.value,
          color: colorInput.value,
          bloodColor: bloodColorInput.value,
          bloodColorAssigned,
          mode,
          eyeX,
          eyeY,
          eyeScaleX,
          eyeScaleY,
          eyeRotationDeg,
          eyeStyle,
          browStyle,
          browOffsetX,
          browOffsetY,
          browScaleX,
          browScaleY,
          browRotationDeg,
          contourPoints: contourPoints.slice(),
          contourClosed,
          selectedContourIndex,
          selectedLayerId,
          nextLayerId,
          presetId: currentPresetId,
          collisionShapes: copyCollisionShapesSnapshot(),
          nextCollisionShapeId,
          selectedCollisionShapeId,
          collisionToolKind,
          collisionShapesCustomized,
        }
      }

    const applyHistorySnapshot = (
      snapshot: EditorCharacterBodyDrawerHistorySnapshot
    ) => {
      maskState.bounds = applyCanvasSnapshot(maskState.ctx, snapshot.mask)
      maskState.boundsDirty = false
      shapeState.bounds = applyCanvasSnapshot(shapeState.ctx, snapshot.shape)
      shapeState.boundsDirty = false
      textureState.bounds = applyCanvasSnapshot(
        textureState.ctx,
        snapshot.texture
      )
      textureState.boundsDirty = false
      restoreLayerSnapshots(snapshot.layers, snapshot.layerOrder)
      syncBrushValue(snapshot.brushSize)
      colorInput.value = snapshot.color
      bloodColorInput.value = snapshot.bloodColor
      bloodColorAssigned = snapshot.bloodColorAssigned
      mode = snapshot.mode
      eyeX = snapshot.eyeX
      eyeY = snapshot.eyeY
      eyeScaleX = snapshot.eyeScaleX
      eyeScaleY = snapshot.eyeScaleY
      eyeRotationDeg = snapshot.eyeRotationDeg
      eyeStyle = snapshot.eyeStyle
      browStyle = snapshot.browStyle
      browOffsetX = snapshot.browOffsetX
      browOffsetY = snapshot.browOffsetY
      browScaleX = snapshot.browScaleX
      browScaleY = snapshot.browScaleY
      browRotationDeg = snapshot.browRotationDeg
      contourPoints = snapshot.contourPoints.slice()
      contourClosed = snapshot.contourClosed
      selectedContourIndex = snapshot.selectedContourIndex
      selectedLayerId = snapshot.selectedLayerId
      nextLayerId = snapshot.nextLayerId
      setPresetSelection(snapshot.presetId)
      selectedCollisionShapeId = snapshot.selectedCollisionShapeId
      collisionToolKind = snapshot.collisionToolKind
      collisionShapesCustomized = snapshot.collisionShapesCustomized
      restoreCollisionShapesSnapshot(snapshot.collisionShapes)
      nextCollisionShapeId = snapshot.nextCollisionShapeId
      ensureSelectedLayer()
      renderLayerList()
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
    const selectBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_select'),
      { primary: true }
    )
    const collisionBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_mode_collision'),
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
    const modeButtons = [
      contourBtn,
      selectBtn,
      collisionBtn,
      shapeBtn,
      fillBtn,
      eraseBtn,
      textureBtn,
    ]
    for (let i = 0; i < modeButtons.length; i++) {
      const button = modeButtons[i]
      button.style.flex = '1 1 100%'
      button.style.minWidth = '0'
      button.style.padding = '6px 8px'
      button.style.fontSize = '10px'
      button.style.lineHeight = '1.2'
      button.style.whiteSpace = 'normal'
      button.style.writingMode = 'horizontal-tb'
      button.style.textOrientation = 'mixed'
      button.style.textAlign = 'center'
      button.style.boxSizing = 'border-box'
    }
    resetShapeBtn.style.padding = '6px 8px'
    resetShapeBtn.style.fontSize = '10px'
    clearTextureBtn.style.padding = '6px 8px'
    clearTextureBtn.style.fontSize = '10px'
    modeRow.appendChild(contourBtn)
    modeRow.appendChild(selectBtn)
    modeRow.appendChild(collisionBtn)
    modeRow.appendChild(shapeBtn)
    modeRow.appendChild(fillBtn)
    modeRow.appendChild(eraseBtn)
    modeRow.appendChild(textureBtn)

    const collisionToolMenu = document.createElement('div')
    collisionToolMenu.style.cssText = [
      'position:absolute',
      'display:none',
      'flex-direction:column',
      'gap:4px',
      'padding:0',
      'background:rgba(10,9,7,0.96)',
      'z-index:3',
      'min-width:96px',
      'box-sizing:border-box',
    ].join(';')
    const collisionCircleBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_collision_shape_circle')
    )
    const collisionEllipseBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_collision_shape_ellipse')
    )
    const collisionCapsuleBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_collision_shape_capsule')
    )
    collisionCircleBtn.style.padding = '6px 8px'
    collisionCircleBtn.style.fontSize = '10px'
    collisionCircleBtn.style.border = 'none'
    collisionCircleBtn.style.background = 'rgba(255,255,255,0.08)'
    collisionEllipseBtn.style.padding = '6px 8px'
    collisionEllipseBtn.style.fontSize = '10px'
    collisionEllipseBtn.style.border = 'none'
    collisionEllipseBtn.style.background = 'rgba(255,255,255,0.08)'
    collisionCapsuleBtn.style.padding = '6px 8px'
    collisionCapsuleBtn.style.fontSize = '10px'
    collisionCapsuleBtn.style.border = 'none'
    collisionCapsuleBtn.style.background = 'rgba(255,255,255,0.08)'
    collisionToolMenu.appendChild(collisionCircleBtn)
    collisionToolMenu.appendChild(collisionEllipseBtn)
    collisionToolMenu.appendChild(collisionCapsuleBtn)
    form.appendChild(collisionToolMenu)

    const collisionShapeMenu = document.createElement('div')
    collisionShapeMenu.style.cssText = [
      'position:absolute',
      'display:none',
      'flex-direction:column',
      'gap:4px',
      'padding:0',
      'background:rgba(10,9,7,0.96)',
      'z-index:3',
      'min-width:96px',
      'box-sizing:border-box',
    ].join(';')
    const deleteCollisionShapeBtn = EditorUIHelper.createButton(
      localizer.t('editor_body_drawer_collision_delete')
    )
    deleteCollisionShapeBtn.style.padding = '6px 8px'
    deleteCollisionShapeBtn.style.fontSize = '10px'
    deleteCollisionShapeBtn.style.border = 'none'
    deleteCollisionShapeBtn.style.background = 'rgba(255,255,255,0.08)'
    collisionShapeMenu.appendChild(deleteCollisionShapeBtn)
    form.appendChild(collisionShapeMenu)

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

    const getEditorCollisionShapeRotationDeg = (
      shape: EditorCollisionShape
    ): number => {
      if (shape.kind === 'circle') {
        return 0
      }
      return normalizeRotationDeg(shape.rotationDeg)
    }

    const getEditorCollisionShapeHalfWidth = (
      shape: EditorCollisionShape
    ): number => {
      if (shape.kind === 'circle') {
        return shape.radius
      }
      return shape.kind === 'ellipse' ? shape.radiusX : shape.halfWidth
    }

    const getEditorCollisionShapeHalfHeight = (
      shape: EditorCollisionShape
    ): number => {
      if (shape.kind === 'circle') {
        return shape.radius
      }
      return shape.kind === 'ellipse' ? shape.radiusY : shape.halfHeight
    }

    const rotateEditorLocalPoint = (
      localX: number,
      localY: number,
      rotationDeg: number
    ): { x: number; y: number } => {
      if (rotationDeg === 0) {
        return { x: localX, y: localY }
      }
      const rotationRad = (rotationDeg * Math.PI) / 180
      const cos = Math.cos(rotationRad)
      const sin = Math.sin(rotationRad)
      return {
        x: localX * cos - localY * sin,
        y: localX * sin + localY * cos,
      }
    }

    const getCollisionShapeLocalPoint = (
      shape: EditorCollisionShape,
      worldX: number,
      worldY: number
    ): { x: number; y: number } => {
      const rotationDeg = getEditorCollisionShapeRotationDeg(shape)
      return rotateEditorLocalPoint(
        worldX - shape.centerX,
        worldY - shape.centerY,
        -rotationDeg
      )
    }

    const getCollisionShapeSelectionHandleLocalPoint = (
      shape: EditorCollisionShape,
      handle: EditorSelectionHandle
    ): { x: number; y: number } => {
      const halfWidth = getEditorCollisionShapeHalfWidth(shape)
      const halfHeight = getEditorCollisionShapeHalfHeight(shape)
      const centerX = 0
      const centerY = 0
      if (handle === 'n') return { x: centerX, y: -halfHeight }
      if (handle === 'ne') return { x: halfWidth, y: -halfHeight }
      if (handle === 'e') return { x: halfWidth, y: centerY }
      if (handle === 'se') return { x: halfWidth, y: halfHeight }
      if (handle === 's') return { x: centerX, y: halfHeight }
      if (handle === 'sw') return { x: -halfWidth, y: halfHeight }
      if (handle === 'w') return { x: -halfWidth, y: centerY }
      return { x: -halfWidth, y: -halfHeight }
    }

    const getCollisionShapeSelectionHandleCenter = (
      shape: EditorCollisionShape,
      handle: EditorSelectionHandle
    ): { x: number; y: number } => {
      const localPoint = getCollisionShapeSelectionHandleLocalPoint(
        shape,
        handle
      )
      const rotated = rotateEditorLocalPoint(
        localPoint.x,
        localPoint.y,
        getEditorCollisionShapeRotationDeg(shape)
      )
      return {
        x: shape.centerX + rotated.x,
        y: shape.centerY + rotated.y,
      }
    }

    const getCollisionShapeRotationHandleCenter = (
      shape: EditorCollisionShape
    ): { x: number; y: number } => {
      const localPoint = rotateEditorLocalPoint(
        0,
        -getEditorCollisionShapeHalfHeight(shape) -
          SELECTION_ROTATE_HANDLE_OFFSET,
        getEditorCollisionShapeRotationDeg(shape)
      )
      return {
        x: shape.centerX + localPoint.x,
        y: shape.centerY + localPoint.y,
      }
    }

    const traceCollisionShapeSelectionFrame = (
      ctx: CanvasRenderingContext2D,
      shape: EditorCollisionShape
    ) => {
      const corners = [
        rotateEditorLocalPoint(
          -getEditorCollisionShapeHalfWidth(shape),
          -getEditorCollisionShapeHalfHeight(shape),
          getEditorCollisionShapeRotationDeg(shape)
        ),
        rotateEditorLocalPoint(
          getEditorCollisionShapeHalfWidth(shape),
          -getEditorCollisionShapeHalfHeight(shape),
          getEditorCollisionShapeRotationDeg(shape)
        ),
        rotateEditorLocalPoint(
          getEditorCollisionShapeHalfWidth(shape),
          getEditorCollisionShapeHalfHeight(shape),
          getEditorCollisionShapeRotationDeg(shape)
        ),
        rotateEditorLocalPoint(
          -getEditorCollisionShapeHalfWidth(shape),
          getEditorCollisionShapeHalfHeight(shape),
          getEditorCollisionShapeRotationDeg(shape)
        ),
      ]
      ctx.beginPath()
      ctx.moveTo(shape.centerX + corners[0].x, shape.centerY + corners[0].y)
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(shape.centerX + corners[i].x, shape.centerY + corners[i].y)
      }
      ctx.closePath()
    }

    const getSelectedCollisionShape = (): EditorCollisionShape | null =>
      getCollisionShapeById(selectedCollisionShapeId)

    const buildMapCollisionShapeFromEditor = (
      shape: EditorCollisionShape
    ): MapCharacterBodyCollisionShape => {
      if (shape.kind === 'circle') {
        return {
          kind: 'circle',
          center: {
            x: shape.centerX,
            y: shape.centerY,
          },
          radius: shape.radius,
        }
      }
      if (shape.kind === 'ellipse') {
        return {
          kind: 'ellipse',
          center: {
            x: shape.centerX,
            y: shape.centerY,
          },
          radiusX: shape.radiusX,
          radiusY: shape.radiusY,
          rotationDeg: shape.rotationDeg,
        }
      }
      return {
        kind: 'capsule',
        center: {
          x: shape.centerX,
          y: shape.centerY,
        },
        halfWidth: shape.halfWidth,
        halfHeight: shape.halfHeight,
        rotationDeg: shape.rotationDeg,
      }
    }

    const getCollisionPreviewLoops = (): number[][] | null => {
      if (
        pointerActive &&
        mode === 'collision' &&
        collisionPointerShapeId >= 0
      ) {
        return null
      }
      if (!collisionPreviewDirty) {
        return collisionPreviewLoops
      }
      collisionPreviewDirty = false
      if (collisionShapes.length === 0) {
        collisionPreviewLoops = null
        return collisionPreviewLoops
      }
      const shapes = new Array<MapCharacterBodyCollisionShape>(
        collisionShapes.length
      )
      for (let i = 0; i < collisionShapes.length; i++) {
        shapes[i] = buildMapCollisionShapeFromEditor(collisionShapes[i])
      }
      collisionPreviewLoops = buildCollisionOutlineLoopsFromShapes(shapes)
      return collisionPreviewLoops
    }

    const getCollisionShapeBounds = (
      shape: EditorCollisionShape
    ): EditorCanvasBounds => {
      if (shape.kind === 'circle') {
        return {
          minX: shape.centerX - shape.radius,
          minY: shape.centerY - shape.radius,
          maxX: shape.centerX + shape.radius,
          maxY: shape.centerY + shape.radius,
        }
      }
      if (shape.kind === 'ellipse') {
        const rotationRad = (shape.rotationDeg * Math.PI) / 180
        const cos = Math.cos(rotationRad)
        const sin = Math.sin(rotationRad)
        const extentX = Math.sqrt(
          shape.radiusX * shape.radiusX * cos * cos +
            shape.radiusY * shape.radiusY * sin * sin
        )
        const extentY = Math.sqrt(
          shape.radiusX * shape.radiusX * sin * sin +
            shape.radiusY * shape.radiusY * cos * cos
        )
        return {
          minX: shape.centerX - extentX,
          minY: shape.centerY - extentY,
          maxX: shape.centerX + extentX,
          maxY: shape.centerY + extentY,
        }
      }
      const rotationRad = (shape.rotationDeg * Math.PI) / 180
      const cos = Math.cos(rotationRad)
      const sin = Math.sin(rotationRad)
      const halfWidth = shape.halfWidth
      const halfHeight = shape.halfHeight
      const extentX = Math.abs(halfWidth * cos) + Math.abs(halfHeight * sin)
      const extentY = Math.abs(halfWidth * sin) + Math.abs(halfHeight * cos)
      return {
        minX: shape.centerX - extentX,
        minY: shape.centerY - extentY,
        maxX: shape.centerX + extentX,
        maxY: shape.centerY + extentY,
      }
    }

    const traceEditorCollisionShape = (
      ctx: CanvasRenderingContext2D,
      shape: EditorCollisionShape
    ) => {
      if (shape.kind === 'circle') {
        ctx.beginPath()
        ctx.arc(shape.centerX, shape.centerY, shape.radius, 0, Math.PI * 2)
        return
      }
      if (shape.kind === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(
          shape.centerX,
          shape.centerY,
          shape.radiusX,
          shape.radiusY,
          (shape.rotationDeg * Math.PI) / 180,
          0,
          Math.PI * 2
        )
        return
      }
      const radius = Math.min(shape.halfWidth, shape.halfHeight)
      const left = -shape.halfWidth
      const top = -shape.halfHeight
      const width = shape.halfWidth * 2
      const height = shape.halfHeight * 2
      ctx.save()
      ctx.translate(shape.centerX, shape.centerY)
      ctx.rotate((shape.rotationDeg * Math.PI) / 180)
      ctx.beginPath()
      ctx.moveTo(left + radius, top)
      ctx.lineTo(left + width - radius, top)
      ctx.arc(left + width - radius, top + radius, radius, -Math.PI / 2, 0)
      ctx.lineTo(left + width, top + height - radius)
      ctx.arc(
        left + width - radius,
        top + height - radius,
        radius,
        0,
        Math.PI / 2
      )
      ctx.lineTo(left + radius, top + height)
      ctx.arc(
        left + radius,
        top + height - radius,
        radius,
        Math.PI / 2,
        Math.PI
      )
      ctx.lineTo(left, top + radius)
      ctx.arc(left + radius, top + radius, radius, Math.PI, 1.5 * Math.PI)
      ctx.closePath()
      ctx.restore()
    }

    const isPointInsideCollisionShape = (
      shape: EditorCollisionShape,
      pointX: number,
      pointY: number
    ): boolean => {
      if (shape.kind === 'circle') {
        const dx = pointX - shape.centerX
        const dy = pointY - shape.centerY
        return dx * dx + dy * dy <= shape.radius * shape.radius
      }
      if (shape.kind === 'ellipse') {
        const localPoint = getCollisionShapeLocalPoint(shape, pointX, pointY)
        const radiusX = Math.max(1, shape.radiusX)
        const radiusY = Math.max(1, shape.radiusY)
        return (
          localPoint.x * localPoint.x * radiusY * radiusY +
            localPoint.y * localPoint.y * radiusX * radiusX <=
          radiusX * radiusX * radiusY * radiusY
        )
      }
      const localPoint = getCollisionShapeLocalPoint(shape, pointX, pointY)
      const dx = Math.abs(localPoint.x)
      const dy = Math.abs(localPoint.y)
      if (dx > shape.halfWidth || dy > shape.halfHeight) {
        return false
      }
      const radius = Math.min(shape.halfWidth, shape.halfHeight)
      const innerWidth = shape.halfWidth - radius
      const innerHeight = shape.halfHeight - radius
      if (dx <= innerWidth || dy <= innerHeight) {
        return true
      }
      const rx = dx - innerWidth
      const ry = dy - innerHeight
      return rx * rx + ry * ry <= radius * radius
    }

    const getCollisionShapeAtPoint = (
      pointX: number,
      pointY: number
    ): EditorCollisionShape | null => {
      for (let i = collisionShapes.length - 1; i >= 0; i--) {
        const shape = collisionShapes[i]
        if (isPointInsideCollisionShape(shape, pointX, pointY)) {
          return shape
        }
      }
      return null
    }

    const isCollisionShapeRotatable = (
      shape: EditorCollisionShape | null
    ): boolean => !!shape && shape.kind !== 'circle'

    const getCollisionShapeSelectionHandleAtPoint = (
      pointX: number,
      pointY: number,
      shape: EditorCollisionShape | null
    ): EditorSelectionHandle | null => {
      if (!shape) {
        return null
      }
      const hitRadius = Math.max(
        2,
        Math.round(SELECTION_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2))
      )
      const handles: EditorSelectionHandle[] = [
        'nw',
        'n',
        'ne',
        'e',
        'se',
        's',
        'sw',
        'w',
      ]
      for (let i = 0; i < handles.length; i++) {
        const center = getCollisionShapeSelectionHandleCenter(shape, handles[i])
        if (
          Math.abs(pointX - center.x) <= hitRadius &&
          Math.abs(pointY - center.y) <= hitRadius
        ) {
          return handles[i]
        }
      }
      return null
    }

    const getCollisionShapeRotationHandleAtPoint = (
      pointX: number,
      pointY: number,
      shape: EditorCollisionShape | null
    ): EditorRotationHandle | null => {
      if (!shape || !isCollisionShapeRotatable(shape)) {
        return null
      }
      const center = getCollisionShapeRotationHandleCenter(shape)
      const hitRadius = Math.max(
        2,
        Math.round(
          SELECTION_ROTATE_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2)
        )
      )
      return Math.abs(pointX - center.x) <= hitRadius &&
        Math.abs(pointY - center.y) <= hitRadius
        ? 'rotate'
        : null
    }

    const beginCollisionShapeScale = (
      shape: EditorCollisionShape,
      handle: EditorSelectionHandle,
      pointerX: number,
      pointerY: number
    ): EditorCollisionScaleSession => {
      const localHandle = getCollisionShapeSelectionHandleLocalPoint(
        shape,
        handle
      )
      const localPointer = getCollisionShapeLocalPoint(
        shape,
        pointerX,
        pointerY
      )
      return {
        shapeId: shape.id,
        handle,
        centerX: shape.centerX,
        centerY: shape.centerY,
        rotationDeg: getEditorCollisionShapeRotationDeg(shape),
        handleOffsetLocalX: localPointer.x - localHandle.x,
        handleOffsetLocalY: localPointer.y - localHandle.y,
        initialShape: cloneCollisionShape(shape),
      }
    }

    const applyCollisionShapeScale = (
      session: EditorCollisionScaleSession,
      pointX: number,
      pointY: number
    ) => {
      const shape = getCollisionShapeById(session.shapeId)
      if (!shape) {
        return
      }
      const localPointer = rotateEditorLocalPoint(
        pointX - session.centerX,
        pointY - session.centerY,
        -session.rotationDeg
      )
      const resolvedLocalX = localPointer.x - session.handleOffsetLocalX
      const resolvedLocalY = localPointer.y - session.handleOffsetLocalY
      const useHorizontal =
        session.handle === 'e' ||
        session.handle === 'w' ||
        session.handle === 'ne' ||
        session.handle === 'nw' ||
        session.handle === 'se' ||
        session.handle === 'sw'
      const useVertical =
        session.handle === 'n' ||
        session.handle === 's' ||
        session.handle === 'ne' ||
        session.handle === 'nw' ||
        session.handle === 'se' ||
        session.handle === 'sw'
      if (shape.kind === 'circle') {
        const nextRadiusX = useHorizontal
          ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalX)))
          : session.initialShape.kind === 'circle'
            ? session.initialShape.radius
            : MIN_COLLISION_RADIUS
        const nextRadiusY = useVertical
          ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalY)))
          : session.initialShape.kind === 'circle'
            ? session.initialShape.radius
            : MIN_COLLISION_RADIUS
        shape.radius =
          useHorizontal && useVertical
            ? Math.max(nextRadiusX, nextRadiusY)
            : useHorizontal
              ? nextRadiusX
              : nextRadiusY
        return
      }
      if (shape.kind === 'ellipse' && session.initialShape.kind === 'ellipse') {
        shape.radiusX = useHorizontal
          ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalX)))
          : session.initialShape.radiusX
        shape.radiusY = useVertical
          ? Math.max(MIN_COLLISION_RADIUS, Math.round(Math.abs(resolvedLocalY)))
          : session.initialShape.radiusY
        shape.rotationDeg = session.initialShape.rotationDeg
        return
      }
      if (shape.kind === 'capsule' && session.initialShape.kind === 'capsule') {
        shape.halfWidth = useHorizontal
          ? Math.max(
              MIN_COLLISION_HALF_EXTENT,
              Math.round(Math.abs(resolvedLocalX))
            )
          : session.initialShape.halfWidth
        shape.halfHeight = useVertical
          ? Math.max(
              MIN_COLLISION_HALF_EXTENT,
              Math.round(Math.abs(resolvedLocalY))
            )
          : session.initialShape.halfHeight
        shape.rotationDeg = session.initialShape.rotationDeg
      }
    }

    const beginCollisionShapeRotate = (
      shape: EditorCollisionShape,
      pointerX: number,
      pointerY: number
    ): EditorCollisionRotateSession => ({
      shapeId: shape.id,
      centerX: shape.centerX,
      centerY: shape.centerY,
      startAngleDeg: getPointerAngleDeg(
        pointerX,
        pointerY,
        shape.centerX,
        shape.centerY
      ),
      initialRotationDeg: getEditorCollisionShapeRotationDeg(shape),
    })

    const applyCollisionShapeRotate = (
      session: EditorCollisionRotateSession,
      pointX: number,
      pointY: number
    ) => {
      const shape = getCollisionShapeById(session.shapeId)
      if (!shape || shape.kind === 'circle') {
        return
      }
      const currentAngleDeg = getPointerAngleDeg(
        pointX,
        pointY,
        session.centerX,
        session.centerY
      )
      const deltaDeg = getRotationDeltaDeg(
        session.startAngleDeg,
        currentAngleDeg
      )
      shape.rotationDeg = Math.round(
        normalizeRotationDeg(session.initialRotationDeg + deltaDeg)
      )
    }

    const setCollisionShapesFromMap = (
      shapes: readonly MapCharacterBodyCollisionShape[],
      centerX: number,
      centerY: number,
      facing: number
    ) => {
      clearCollisionShapes()
      for (let i = 0; i < shapes.length; i++) {
        const shape = shapes[i]
        if (shape.kind === 'circle') {
          collisionShapes.push({
            id: nextCollisionShapeId++,
            kind: 'circle',
            centerX: centerX + Math.round(shape.center.x * facing),
            centerY: centerY + Math.round(shape.center.y),
            radius: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radius)),
          })
          continue
        }
        if (shape.kind === 'ellipse') {
          const rotationDeg = Math.round(
            normalizeRotationDeg((shape.rotationDeg ?? 0) * facing)
          )
          collisionShapes.push({
            id: nextCollisionShapeId++,
            kind: 'ellipse',
            centerX: centerX + Math.round(shape.center.x * facing),
            centerY: centerY + Math.round(shape.center.y),
            radiusX: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusX)),
            radiusY: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusY)),
            rotationDeg,
          })
          continue
        }
        const rotationDeg = Math.round(
          normalizeRotationDeg((shape.rotationDeg ?? 0) * facing)
        )
        collisionShapes.push({
          id: nextCollisionShapeId++,
          kind: 'capsule',
          centerX: centerX + Math.round(shape.center.x * facing),
          centerY: centerY + Math.round(shape.center.y),
          halfWidth: Math.max(
            MIN_COLLISION_HALF_EXTENT,
            Math.round(shape.halfWidth)
          ),
          halfHeight: Math.max(
            MIN_COLLISION_HALF_EXTENT,
            Math.round(shape.halfHeight)
          ),
          rotationDeg,
        })
      }
      selectedCollisionShapeId =
        collisionShapes.length > 0
          ? collisionShapes[collisionShapes.length - 1].id
          : -1
      invalidateCollisionPreview()
    }

    const regenerateAutoCollisionShapesFromContour = (): boolean => {
      const contourBounds = getContourBounds()
      if (!contourClosed || !contourBounds || contourPoints.length < 6) {
        clearCollisionShapes()
        return false
      }
      const localPoints = new Array<number>(contourPoints.length)
      for (let i = 0; i < contourPoints.length; i += 2) {
        localPoints[i] = contourPoints[i] - contourBounds.centerX
        localPoints[i + 1] = contourPoints[i + 1] - contourBounds.centerY
      }
      const shapes =
        buildAutoCharacterBodyCollisionShapesFromLocalPoints(localPoints)
      if (!shapes || shapes.length === 0) {
        clearCollisionShapes()
        return false
      }
      setCollisionShapesFromMap(
        shapes,
        contourBounds.centerX,
        contourBounds.centerY,
        1
      )
      collisionShapesCustomized = false
      return true
    }

    const syncAutoCollisionShapesIfNeeded = () => {
      if (collisionShapesCustomized) {
        return
      }
      regenerateAutoCollisionShapesFromContour()
    }

    const appendCollisionShape = (shape: EditorCollisionShape) => {
      collisionShapes.push(shape)
      selectedCollisionShapeId = shape.id
      collisionShapesCustomized = true
      invalidateCollisionPreview()
    }

    const createCollisionShapeFromDrag = (
      shapeId: number,
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ): EditorCollisionShape => {
      const minX = Math.min(startX, endX)
      const maxX = Math.max(startX, endX)
      const minY = Math.min(startY, endY)
      const maxY = Math.max(startY, endY)
      const centerX = Math.round((minX + maxX) * 0.5)
      const centerY = Math.round((minY + maxY) * 0.5)
      if (collisionToolKind === 'circle') {
        const halfWidth = Math.max(
          MIN_COLLISION_RADIUS,
          Math.round((maxX - minX) * 0.5)
        )
        const halfHeight = Math.max(
          MIN_COLLISION_RADIUS,
          Math.round((maxY - minY) * 0.5)
        )
        return {
          id: shapeId,
          kind: 'circle',
          centerX,
          centerY,
          radius: Math.max(halfWidth, halfHeight),
        }
      }
      if (collisionToolKind === 'ellipse') {
        return {
          id: shapeId,
          kind: 'ellipse',
          centerX,
          centerY,
          radiusX: Math.max(
            MIN_COLLISION_RADIUS,
            Math.round((maxX - minX) * 0.5)
          ),
          radiusY: Math.max(
            MIN_COLLISION_RADIUS,
            Math.round((maxY - minY) * 0.5)
          ),
          rotationDeg: 0,
        }
      }
      return {
        id: shapeId,
        kind: 'capsule',
        centerX,
        centerY,
        halfWidth: Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round((maxX - minX) * 0.5)
        ),
        halfHeight: Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round((maxY - minY) * 0.5)
        ),
        rotationDeg: 0,
      }
    }

    const getCollisionShapeById = (
      shapeId: number
    ): EditorCollisionShape | null => {
      for (let i = 0; i < collisionShapes.length; i++) {
        if (collisionShapes[i].id === shapeId) {
          return collisionShapes[i]
        }
      }
      return null
    }

    const deleteSelectedCollisionShape = (): boolean => {
      if (selectedCollisionShapeId < 0) {
        return false
      }
      for (let i = 0; i < collisionShapes.length; i++) {
        if (collisionShapes[i].id !== selectedCollisionShapeId) {
          continue
        }
        collisionShapes.splice(i, 1)
        selectedCollisionShapeId =
          collisionShapes.length > 0
            ? collisionShapes[collisionShapes.length - 1].id
            : -1
        collisionPointerShapeId = -1
        collisionShapesCustomized = true
        invalidateCollisionPreview()
        return true
      }
      return false
    }

    const serializeCollisionShapes = (
      centerX: number,
      centerY: number
    ): MapCharacterBodyCollisionShape[] => {
      const result = new Array<MapCharacterBodyCollisionShape>(
        collisionShapes.length
      )
      for (let i = 0; i < collisionShapes.length; i++) {
        const shape = collisionShapes[i]
        if (shape.kind === 'circle') {
          result[i] = {
            kind: 'circle',
            center: {
              x: Math.round((shape.centerX - centerX) * editorFacing),
              y: Math.round(shape.centerY - centerY),
            },
            radius: shape.radius,
          }
          continue
        }
        if (shape.kind === 'ellipse') {
          const rotationDeg = Math.round(
            normalizeRotationDeg(shape.rotationDeg * editorFacing)
          )
          result[i] = {
            kind: 'ellipse',
            center: {
              x: Math.round((shape.centerX - centerX) * editorFacing),
              y: Math.round(shape.centerY - centerY),
            },
            radiusX: shape.radiusX,
            radiusY: shape.radiusY,
            rotationDeg,
          }
          continue
        }
        const rotationDeg = Math.round(
          normalizeRotationDeg(shape.rotationDeg * editorFacing)
        )
        result[i] = {
          kind: 'capsule',
          center: {
            x: Math.round((shape.centerX - centerX) * editorFacing),
            y: Math.round(shape.centerY - centerY),
          },
          halfWidth: shape.halfWidth,
          halfHeight: shape.halfHeight,
          rotationDeg,
        }
      }
      return result
    }

    const getCanvasLocalPoint = (
      event: Pick<MouseEvent, 'clientX' | 'clientY'>
    ): { x: number; y: number } => {
      const rect = drawCanvas.getBoundingClientRect()
      const scaleX = DISPLAY_SIZE / Math.max(1, rect.width)
      const scaleY = DISPLAY_SIZE / Math.max(1, rect.height)
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
      }
    }

    const getCanvasDisplayScale = (): number => {
      const rect = drawCanvas.getBoundingClientRect()
      return rect.width > 0 ? rect.width / DISPLAY_SIZE : 1
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

    const isCoreLayerSelected = (): boolean =>
      getSelectedLayer()?.kind === 'core'

    const canUsePaintModes = (): boolean => {
      if (activeSidebarTab === 'bones') {
        return getSelectedLayer()?.kind === 'bone'
      }
      return (
        contourClosed &&
        !!getSelectedLayer() &&
        getSelectedLayer()?.kind !== 'eye' &&
        getSelectedLayer()?.kind !== 'brow'
      )
    }

    const setButtonDisabled = (
      button: HTMLButtonElement,
      disabled: boolean
    ) => {
      button.disabled = disabled
      button.style.opacity = disabled ? '0.4' : '1'
      button.style.cursor = disabled ? 'default' : 'pointer'
    }

    const updateConfirmState = () => {
      const canConfirm =
        contourClosed || (skeletalModeEnabled && hasAnyBoneData())
      confirmBtn.disabled = !canConfirm
      confirmBtn.style.opacity = canConfirm ? '1' : '0.45'
      confirmBtn.style.cursor = canConfirm ? 'pointer' : 'default'
    }

    const updateAlert = () => {
      if (contourClosed || (skeletalModeEnabled && hasAnyBoneData())) {
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
      const selectedLayer = getSelectedLayer()
      const selectedKind = selectedLayer?.kind ?? 'core'
      const canPaint = canUsePaintModes()
      const canFillCore = canPaint && selectedKind === 'core'
      const canTextureCore = canPaint && selectedKind === 'core'
      const canFreePaint = canPaint && selectedKind !== 'eye'
      const applyActive = (button: HTMLButtonElement, active: boolean) => {
        button.style.background = active
          ? 'rgba(255,255,255,0.18)'
          : 'rgba(255,255,255,0.08)'
        button.style.borderColor = active
          ? 'rgba(255,255,255,0.4)'
          : 'rgba(255,255,255,0.25)'
      }
      applyActive(contourBtn, mode === 'contour')
      applyActive(selectBtn, mode === 'select')
      applyActive(collisionBtn, mode === 'collision')
      applyActive(shapeBtn, mode === 'shape')
      applyActive(fillBtn, mode === 'fill')
      applyActive(eraseBtn, mode === 'erase')
      applyActive(textureBtn, mode === 'texture')
      setButtonDisabled(contourBtn, selectedKind !== 'core')
      setButtonDisabled(selectBtn, !contourClosed)
      setButtonDisabled(
        collisionBtn,
        !contourClosed && selectedBoundaryPart === null
      )
      setButtonDisabled(shapeBtn, !canFreePaint)
      setButtonDisabled(fillBtn, !canFillCore)
      setButtonDisabled(eraseBtn, !canFreePaint)
      setButtonDisabled(textureBtn, !canTextureCore)
      setButtonDisabled(
        clearTextureBtn,
        !contourClosed ||
          (selectedKind !== 'core' &&
            selectedKind !== 'brow' &&
            selectedKind !== 'paint')
      )
      setButtonDisabled(resetShapeBtn, false)
      setButtonDisabled(addLayerBtn, false)
    }

    const updateCursorVisual = () => {
      const selectedLayer = getSelectedLayer()
      const canvasDisplayScale = getCanvasDisplayScale()
      drawCanvas.style.cursor = mode === 'select' ? 'default' : 'none'
      if (mode === 'select') {
        cursorEl.style.display = 'none'
        return
      }
      const sizePx =
        (mode === 'collision'
          ? CONTOUR_CURSOR_SIZE
          : mode === 'texture'
            ? Math.max(2, Math.round(getBrushSize() * viewportScale))
            : mode === 'contour' || mode === 'fill'
              ? CONTOUR_CURSOR_SIZE
              : Math.max(2, Math.round(getBrushSize() * viewportScale))) *
        canvasDisplayScale
      cursorEl.style.width = `${sizePx}px`
      cursorEl.style.height = `${sizePx}px`
      if (mode === 'contour' || mode === 'fill' || mode === 'collision') {
        cursorEl.style.borderRadius = '2px'
        cursorEl.style.borderColor =
          mode === 'collision' ? 'rgba(63,18,14,0.95)' : 'rgba(70,42,0,0.95)'
        cursorEl.style.boxShadow =
          mode === 'collision'
            ? '0 0 0 1px rgba(244,132,92,0.92)'
            : '0 0 0 1px rgba(255,231,163,0.92)'
        cursorEl.style.background =
          mode === 'fill'
            ? colorInput.value
            : mode === 'collision'
              ? 'rgba(208,112,84,0.82)'
              : 'rgba(245,208,96,0.88)'
        return
      }
      cursorEl.style.borderRadius = '50%'
      cursorEl.style.borderColor = 'rgba(0,0,0,0.95)'
      cursorEl.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.95)'
      cursorEl.style.background =
        mode === 'erase'
          ? 'rgba(245,245,240,0.92)'
          : selectedLayer?.kind === 'eye'
            ? 'rgba(245,208,96,0.9)'
            : colorInput.value
    }

    const clearBodyShape = () => {
      maskCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      maskState.bounds = null
      maskState.boundsDirty = false
      shapeState.bounds = null
      shapeState.boundsDirty = false
    }

    const clearVisualLayer = (layer: EditorBodyLayer | null) => {
      if (!layer) {
        return
      }
      if (layer.kind === 'core') {
        textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        textureState.bounds = null
        textureState.boundsDirty = false
        return
      }
      if (layer.kind === 'brow') {
        browStyle = 'none'
        browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
        browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
        browScaleX = DEFAULT_CHARACTER_BROW_SCALE
        browScaleY = DEFAULT_CHARACTER_BROW_SCALE
        browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG
      }
      if (layer.ctx) {
        layer.ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        layer.bounds = null
        layer.boundsDirty = false
      }
    }

    const readLayerAlphaAt = (
      layer: EditorBodyLayer,
      x: number,
      y: number
    ): boolean => {
      if (layer.kind === 'brow' && browStyle === 'none') {
        return false
      }
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        const browGeometry = getBrowGeometry()
        if (!browGeometry) {
          return false
        }
        const cos = Math.cos(-browGeometry.rotationRad)
        const sin = Math.sin(-browGeometry.rotationRad)
        const localX =
          (x - browGeometry.centerX) * cos - (y - browGeometry.centerY) * sin
        const localY =
          (x - browGeometry.centerX) * sin + (y - browGeometry.centerY) * cos
        return (
          localX >= -browGeometry.halfWidth &&
          localX <= browGeometry.halfWidth &&
          localY >= -browGeometry.halfHeight &&
          localY <= browGeometry.halfHeight
        )
      }
      if (!layer.ctx) {
        return false
      }
      return layer.ctx.getImageData(x, y, 1, 1).data[3] >= MASK_ALPHA_THRESHOLD
    }

    const getEyeGeometry = () => {
      const contourBounds = getContourBounds()
      if (!contourBounds || !contourClosed) {
        return null
      }
      return getCharacterEyeGeometry(
        contourBounds.centerX + eyeX,
        contourBounds.centerY + eyeY,
        editorFacing,
        eyeScaleX,
        eyeScaleY,
        eyeStyle,
        eyeRotationDeg
      )
    }

    const getEyeBounds = (): EditorCanvasBounds | null => {
      const eyeGeometry = getEyeGeometry()
      if (!eyeGeometry) {
        return null
      }
      const eyeBounds = getCharacterEyeBounds(eyeGeometry)
      return {
        minX: Math.floor(eyeBounds.minX),
        minY: Math.floor(eyeBounds.minY),
        maxX: Math.ceil(eyeBounds.maxX),
        maxY: Math.ceil(eyeBounds.maxY),
      }
    }

    const getBrowGeometry = () => {
      const eyeGeometry = getEyeGeometry()
      if (!eyeGeometry || !contourClosed) {
        return null
      }
      return getCharacterBrowGeometry(
        eyeGeometry,
        browStyle,
        browOffsetX,
        browOffsetY,
        browScaleX,
        browScaleY,
        browRotationDeg
      )
    }

    const getBrowBounds = (): {
      centerX: number
      centerY: number
      halfWidth: number
      halfHeight: number
      thickness: number
      archHeight: number
      baselineOffsetY: number
    } | null => {
      const browGeometry = getBrowGeometry()
      if (!browGeometry) {
        return null
      }
      const browBounds = getCharacterBrowBounds(browGeometry)
      return {
        centerX: Math.round(browGeometry.centerX),
        centerY: Math.round(browGeometry.centerY),
        halfWidth: Math.max(
          1,
          Math.round((browBounds.maxX - browBounds.minX) * 0.5)
        ),
        halfHeight: Math.max(
          1,
          Math.round((browBounds.maxY - browBounds.minY) * 0.5)
        ),
        thickness: Math.max(1, Math.round(browGeometry.thickness)),
        archHeight: Math.max(1, Math.round(browGeometry.archHeight)),
        baselineOffsetY: Math.round(browGeometry.baselineOffsetY),
      }
    }

    const getEyeMoveRangeRadius = (): number => {
      const contourBounds = getContourBounds()
      if (!contourBounds || !contourClosed) {
        return 0
      }
      return getCharacterEyeMoveCircleRadius(
        contourBounds.width,
        contourBounds.height
      )
    }

    const resolveEyeOffsetInsideBody = (
      targetEyeX: number,
      targetEyeY: number
    ): { x: number; y: number } => {
      if (!contourClosed) {
        return { x: targetEyeX, y: targetEyeY }
      }
      return clampCharacterEyeOffsetToCircle(
        targetEyeX,
        targetEyeY,
        getEyeMoveRangeRadius()
      )
    }

    const ensureEyeInsideBody = () => {
      if (!contourClosed) {
        return
      }
      const resolvedEye = resolveEyeOffsetInsideBody(eyeX, eyeY)
      eyeX = resolvedEye.x
      eyeY = resolvedEye.y
    }

    const getSelectableLayerAtPoint = (
      pointX: number,
      pointY: number
    ): EditorBodyLayer | null => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]
        if (
          (layer.kind === 'paint' || layer.kind === 'brow') &&
          readLayerAlphaAt(layer, pointX, pointY)
        ) {
          return layer
        }
        if (layer.kind === 'eye') {
          const eyeGeometry = getEyeGeometry()
          if (!eyeGeometry) {
            continue
          }
          const cos = Math.cos(-eyeGeometry.rotationRad)
          const sin = Math.sin(-eyeGeometry.rotationRad)
          const localX =
            (pointX - eyeGeometry.centerX) * cos -
            (pointY - eyeGeometry.centerY) * sin
          const localY =
            (pointX - eyeGeometry.centerX) * sin +
            (pointY - eyeGeometry.centerY) * cos
          const radiusX = Math.max(1, Math.round(eyeGeometry.outerRadiusX))
          const radiusY = Math.max(1, Math.round(eyeGeometry.outerRadiusY))
          if (
            localX * localX * radiusY * radiusY +
              localY * localY * radiusX * radiusX <=
            radiusX * radiusX * radiusY * radiusY
          ) {
            return layer
          }
        }
        if (layer.kind === 'core' && isPointInsideBodyMask(pointX, pointY)) {
          return layer
        }
      }
      return null
    }

    const getSelectedLayerBounds = (): {
      minX: number
      minY: number
      maxX: number
      maxY: number
    } | null => {
      const selectedLayer = getSelectedLayer()
      if (!selectedLayer) {
        return null
      }
      if (selectedLayer.kind === 'core') {
        const contourBounds = getContourBounds()
        return contourBounds
          ? {
              minX: contourBounds.minX,
              minY: contourBounds.minY,
              maxX: contourBounds.maxX,
              maxY: contourBounds.maxY,
            }
          : null
      }
      if (selectedLayer.kind === 'eye') {
        return getEyeBounds()
      }
      if (!selectedLayer.ctx) {
        return null
      }
      return resolveLayerBounds(selectedLayer)
    }

    const scaleContourPointsFromBounds = (
      sourcePoints: number[],
      sourceBounds: EditorCanvasBounds,
      targetBounds: EditorCanvasBounds
    ) => {
      const sourceSpanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX)
      const sourceSpanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY)
      const targetSpanX = Math.max(1, targetBounds.maxX - targetBounds.minX)
      const targetSpanY = Math.max(1, targetBounds.maxY - targetBounds.minY)
      const nextPoints = new Array<number>(sourcePoints.length)
      for (let i = 0; i < sourcePoints.length; i += 2) {
        nextPoints[i] =
          targetBounds.minX +
          Math.round(
            ((sourcePoints[i] - sourceBounds.minX) * targetSpanX) / sourceSpanX
          )
        nextPoints[i + 1] =
          targetBounds.minY +
          Math.round(
            ((sourcePoints[i + 1] - sourceBounds.minY) * targetSpanY) /
              sourceSpanY
          )
      }
      contourPoints = nextPoints
    }

    const drawScaledSnapshot = (
      ctx: CanvasRenderingContext2D,
      snapshot: EditorCanvasSnapshot | null,
      targetBounds: EditorCanvasBounds | null
    ): EditorCanvasBounds | null => {
      ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      if (!snapshot?.bounds || !snapshot.image || !targetBounds) {
        return null
      }
      const sourceWidth = snapshot.bounds.maxX + 1 - snapshot.bounds.minX
      const sourceHeight = snapshot.bounds.maxY + 1 - snapshot.bounds.minY
      const targetWidth = targetBounds.maxX + 1 - targetBounds.minX
      const targetHeight = targetBounds.maxY + 1 - targetBounds.minY
      const outputCtx = this.getOutputContext(sourceWidth, sourceHeight)
      if (!outputCtx || !this.outputCanvas) {
        return null
      }
      outputCtx.clearRect(0, 0, sourceWidth, sourceHeight)
      outputCtx.putImageData(snapshot.image, 0, 0)
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        this.outputCanvas,
        0,
        0,
        sourceWidth,
        sourceHeight,
        targetBounds.minX,
        targetBounds.minY,
        targetWidth,
        targetHeight
      )
      ctx.restore()
      return cloneBounds(targetBounds)
    }

    const drawRotatedSnapshot = (
      ctx: CanvasRenderingContext2D,
      snapshot: EditorCanvasSnapshot | null,
      centerX: number,
      centerY: number,
      rotationDeg: number
    ): EditorCanvasBounds | null => {
      ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      if (!snapshot?.bounds || !snapshot.image) {
        return null
      }
      const sourceWidth = snapshot.bounds.maxX + 1 - snapshot.bounds.minX
      const sourceHeight = snapshot.bounds.maxY + 1 - snapshot.bounds.minY
      const outputCtx = this.getOutputContext(sourceWidth, sourceHeight)
      if (!outputCtx || !this.outputCanvas) {
        return null
      }
      outputCtx.clearRect(0, 0, sourceWidth, sourceHeight)
      outputCtx.putImageData(snapshot.image, 0, 0)
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.translate(centerX, centerY)
      ctx.rotate((rotationDeg * Math.PI) / 180)
      ctx.drawImage(
        this.outputCanvas,
        snapshot.bounds.minX - centerX,
        snapshot.bounds.minY - centerY,
        sourceWidth,
        sourceHeight
      )
      ctx.restore()
      return this.readAlphaBounds(ctx, DRAW_WORLD_SIZE)
    }

    const getSelectionHandleCenter = (
      bounds: EditorCanvasBounds,
      handle: EditorSelectionHandle
    ): { x: number; y: number } => {
      const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
      const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
      if (handle === 'n') return { x: centerX, y: bounds.minY }
      if (handle === 'ne') return { x: bounds.maxX, y: bounds.minY }
      if (handle === 'e') return { x: bounds.maxX, y: centerY }
      if (handle === 'se') return { x: bounds.maxX, y: bounds.maxY }
      if (handle === 's') return { x: centerX, y: bounds.maxY }
      if (handle === 'sw') return { x: bounds.minX, y: bounds.maxY }
      if (handle === 'w') return { x: bounds.minX, y: centerY }
      return { x: bounds.minX, y: bounds.minY }
    }

    const getSelectionRotationHandleCenter = (
      bounds: EditorCanvasBounds
    ): { x: number; y: number } => {
      const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
      return {
        x: centerX,
        y: bounds.minY - SELECTION_ROTATE_HANDLE_OFFSET,
      }
    }

    const getSelectionHandleAtPoint = (
      pointX: number,
      pointY: number,
      bounds: EditorCanvasBounds | null
    ): EditorSelectionHandle | null => {
      if (!bounds) {
        return null
      }
      const hitRadius = Math.max(
        2,
        Math.round(SELECTION_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2))
      )
      const handles: EditorSelectionHandle[] = [
        'nw',
        'n',
        'ne',
        'e',
        'se',
        's',
        'sw',
        'w',
      ]
      for (let i = 0; i < handles.length; i++) {
        const handle = handles[i]
        const center = getSelectionHandleCenter(bounds, handle)
        if (
          Math.abs(pointX - center.x) <= hitRadius &&
          Math.abs(pointY - center.y) <= hitRadius
        ) {
          return handle
        }
      }
      return null
    }

    const getSelectionRotationHandleAtPoint = (
      pointX: number,
      pointY: number,
      bounds: EditorCanvasBounds | null
    ): EditorRotationHandle | null => {
      if (!bounds) {
        return null
      }
      const center = getSelectionRotationHandleCenter(bounds)
      const hitRadius = Math.max(
        2,
        Math.round(
          SELECTION_ROTATE_HANDLE_HIT_SIZE / Math.max(1, viewportScale * 2)
        )
      )
      return Math.abs(pointX - center.x) <= hitRadius &&
        Math.abs(pointY - center.y) <= hitRadius
        ? 'rotate'
        : null
    }

    const getScaledBoundsFromHandle = (
      initialBounds: EditorCanvasBounds,
      handle: EditorSelectionHandle,
      centerX: number,
      centerY: number,
      pointX: number,
      pointY: number
    ): EditorCanvasBounds => {
      const initialHalfWidth = Math.max(
        1,
        Math.round((initialBounds.maxX - initialBounds.minX) * 0.5)
      )
      const initialHalfHeight = Math.max(
        1,
        Math.round((initialBounds.maxY - initialBounds.minY) * 0.5)
      )
      const useHorizontal =
        handle === 'e' ||
        handle === 'w' ||
        handle === 'ne' ||
        handle === 'nw' ||
        handle === 'se' ||
        handle === 'sw'
      const useVertical =
        handle === 'n' ||
        handle === 's' ||
        handle === 'ne' ||
        handle === 'nw' ||
        handle === 'se' ||
        handle === 'sw'
      const halfWidth = useHorizontal
        ? Math.max(SELECTION_MIN_SIZE, Math.abs(pointX - centerX))
        : initialHalfWidth
      const halfHeight = useVertical
        ? Math.max(SELECTION_MIN_SIZE, Math.abs(pointY - centerY))
        : initialHalfHeight
      const normalizedMinX = Math.max(0, centerX - halfWidth)
      const normalizedMinY = Math.max(0, centerY - halfHeight)
      const normalizedMaxX = Math.min(DRAW_WORLD_SIZE - 1, centerX + halfWidth)
      const normalizedMaxY = Math.min(DRAW_WORLD_SIZE - 1, centerY + halfHeight)
      return {
        minX: normalizedMinX,
        minY: normalizedMinY,
        maxX: Math.max(normalizedMinX + 1, normalizedMaxX),
        maxY: Math.max(normalizedMinY + 1, normalizedMaxY),
      }
    }

    const beginSelectionScale = (
      layer: EditorBodyLayer,
      handle: EditorSelectionHandle,
      bounds: EditorCanvasBounds,
      pointerX: number,
      pointerY: number
    ): EditorSelectionScaleSession | null => {
      const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
      const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
      const handleCenter = getSelectionHandleCenter(bounds, handle)
      const handleOffsetX = pointerX - handleCenter.x
      const handleOffsetY = pointerY - handleCenter.y
      if (layer.kind === 'core') {
        const maskCaptured = captureCanvasSnapshot(
          maskState.ctx,
          maskState.bounds,
          maskState.boundsDirty
        )
        const shapeCaptured = captureCanvasSnapshot(
          shapeState.ctx,
          shapeState.bounds,
          shapeState.boundsDirty
        )
        const textureCaptured = captureCanvasSnapshot(
          textureState.ctx,
          textureState.bounds,
          textureState.boundsDirty
        )
        maskState.bounds = maskCaptured.bounds
        maskState.boundsDirty = false
        shapeState.bounds = shapeCaptured.bounds
        shapeState.boundsDirty = false
        textureState.bounds = textureCaptured.bounds
        textureState.boundsDirty = false
        return {
          layerId: layer.id,
          handle,
          initialBounds: cloneBounds(bounds) as EditorCanvasBounds,
          centerX,
          centerY,
          handleOffsetX,
          handleOffsetY,
          coreMask: maskCaptured.snapshot,
          coreShape: shapeCaptured.snapshot,
          coreTexture: textureCaptured.snapshot,
          contourPoints: contourPoints.slice(),
          layerSnapshot: null,
        }
      }
      if (layer.kind === 'eye') {
        const eyeBounds = getEyeBounds()
        if (!eyeBounds) {
          return null
        }
        return {
          layerId: layer.id,
          handle,
          initialBounds: cloneBounds(bounds) as EditorCanvasBounds,
          centerX,
          centerY,
          handleOffsetX,
          handleOffsetY,
          coreMask: null,
          coreShape: null,
          coreTexture: null,
          contourPoints: null,
          layerSnapshot: null,
        }
      }
      if (!layer.ctx) {
        return null
      }
      const captured = captureCanvasSnapshot(
        layer.ctx,
        layer.bounds,
        layer.boundsDirty
      )
      layer.bounds = captured.bounds
      layer.boundsDirty = false
      return {
        layerId: layer.id,
        handle,
        initialBounds: cloneBounds(bounds) as EditorCanvasBounds,
        centerX,
        centerY,
        handleOffsetX,
        handleOffsetY,
        coreMask: null,
        coreShape: null,
        coreTexture: null,
        contourPoints: null,
        layerSnapshot: captured.snapshot,
      }
    }

    const rotateContourPoints = (
      sourcePoints: number[],
      centerX: number,
      centerY: number,
      rotationDeg: number
    ) => {
      const nextPoints = new Array<number>(sourcePoints.length)
      const rotationRad = (rotationDeg * Math.PI) / 180
      const cos = Math.cos(rotationRad)
      const sin = Math.sin(rotationRad)
      for (let i = 0; i < sourcePoints.length; i += 2) {
        const dx = sourcePoints[i] - centerX
        const dy = sourcePoints[i + 1] - centerY
        nextPoints[i] = Math.round(centerX + dx * cos - dy * sin)
        nextPoints[i + 1] = Math.round(centerY + dx * sin + dy * cos)
      }
      contourPoints = nextPoints
    }

    const beginSelectionRotate = (
      layer: EditorBodyLayer,
      bounds: EditorCanvasBounds,
      pointerX: number,
      pointerY: number
    ): EditorSelectionRotateSession | null => {
      const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
      const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
      const startAngleDeg = getPointerAngleDeg(
        pointerX,
        pointerY,
        centerX,
        centerY
      )
      if (layer.kind === 'core') {
        const maskCaptured = captureCanvasSnapshot(
          maskState.ctx,
          maskState.bounds,
          maskState.boundsDirty
        )
        const shapeCaptured = captureCanvasSnapshot(
          shapeState.ctx,
          shapeState.bounds,
          shapeState.boundsDirty
        )
        const textureCaptured = captureCanvasSnapshot(
          textureState.ctx,
          textureState.bounds,
          textureState.boundsDirty
        )
        maskState.bounds = maskCaptured.bounds
        maskState.boundsDirty = false
        shapeState.bounds = shapeCaptured.bounds
        shapeState.boundsDirty = false
        textureState.bounds = textureCaptured.bounds
        textureState.boundsDirty = false
        return {
          layerId: layer.id,
          centerX,
          centerY,
          startAngleDeg,
          coreMask: maskCaptured.snapshot,
          coreShape: shapeCaptured.snapshot,
          coreTexture: textureCaptured.snapshot,
          contourPoints: contourPoints.slice(),
          layerSnapshot: null,
          eyeRotationDeg,
          browRotationDeg,
        }
      }
      if (layer.kind === 'eye') {
        return {
          layerId: layer.id,
          centerX,
          centerY,
          startAngleDeg,
          coreMask: null,
          coreShape: null,
          coreTexture: null,
          contourPoints: null,
          layerSnapshot: null,
          eyeRotationDeg,
          browRotationDeg,
        }
      }
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        return {
          layerId: layer.id,
          centerX,
          centerY,
          startAngleDeg,
          coreMask: null,
          coreShape: null,
          coreTexture: null,
          contourPoints: null,
          layerSnapshot: null,
          eyeRotationDeg,
          browRotationDeg,
        }
      }
      if (!layer.ctx) {
        return null
      }
      const captured = captureCanvasSnapshot(
        layer.ctx,
        layer.bounds,
        layer.boundsDirty
      )
      layer.bounds = captured.bounds
      layer.boundsDirty = false
      return {
        layerId: layer.id,
        centerX,
        centerY,
        startAngleDeg,
        coreMask: null,
        coreShape: null,
        coreTexture: null,
        contourPoints: null,
        layerSnapshot: captured.snapshot,
        eyeRotationDeg,
        browRotationDeg,
      }
    }

    const applySelectionScale = (
      session: EditorSelectionScaleSession,
      pointX: number,
      pointY: number
    ) => {
      const layer = getLayerById(session.layerId)
      if (!layer) {
        return
      }
      const scaledBounds = getScaledBoundsFromHandle(
        session.initialBounds,
        session.handle,
        session.centerX,
        session.centerY,
        pointX - session.handleOffsetX,
        pointY - session.handleOffsetY
      )
      if (layer.kind === 'core') {
        maskState.bounds = drawScaledSnapshot(
          maskState.ctx,
          session.coreMask,
          scaledBounds
        )
        maskState.boundsDirty = false
        shapeState.bounds = drawScaledSnapshot(
          shapeState.ctx,
          session.coreShape,
          scaledBounds
        )
        shapeState.boundsDirty = false
        textureState.bounds = drawScaledSnapshot(
          textureState.ctx,
          session.coreTexture,
          scaledBounds
        )
        textureState.boundsDirty = false
        if (session.contourPoints) {
          scaleContourPointsFromBounds(
            session.contourPoints,
            session.initialBounds,
            scaledBounds
          )
        }
        ensureEyeInsideBody()
        return
      }
      if (layer.kind === 'eye') {
        const contourBounds = getContourBounds()
        if (!contourBounds) {
          return
        }
        const centerX = Math.round(
          (scaledBounds.minX + scaledBounds.maxX) * 0.5
        )
        const centerY = Math.round(
          (scaledBounds.minY + scaledBounds.maxY) * 0.5
        )
        eyeX = centerX - contourBounds.centerX
        eyeY = centerY - contourBounds.centerY
        eyeScaleX = clampCharacterEyeScale(
          (scaledBounds.maxX - scaledBounds.minX) /
            Math.max(1, DEFAULT_EDITOR_EYE_RADIUS * 2)
        )
        eyeScaleY = clampCharacterEyeScale(
          (scaledBounds.maxY - scaledBounds.minY) /
            Math.max(1, DEFAULT_EDITOR_EYE_RADIUS * 2)
        )
        ensureEyeInsideBody()
        return
      }
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        const eyeGeometry = getEyeGeometry()
        if (!eyeGeometry) {
          return
        }
        const baseGeometry = getCharacterBrowGeometry(
          eyeGeometry,
          browStyle,
          0,
          0,
          DEFAULT_CHARACTER_BROW_SCALE,
          DEFAULT_CHARACTER_BROW_SCALE
        )
        if (!baseGeometry) {
          return
        }
        const centerX = Math.round(
          (scaledBounds.minX + scaledBounds.maxX) * 0.5
        )
        const centerY = Math.round(
          (scaledBounds.minY + scaledBounds.maxY) * 0.5
        )
        browOffsetX = centerX - eyeGeometry.centerX
        browOffsetY =
          centerY -
          (eyeGeometry.centerY -
            eyeGeometry.outerRadiusY -
            5 -
            baseGeometry.archHeight * 0.5)
        browScaleX = clampCharacterEyeScale(
          (scaledBounds.maxX - scaledBounds.minX) /
            Math.max(1, baseGeometry.halfWidth * 2)
        )
        browScaleY = clampCharacterEyeScale(
          (scaledBounds.maxY - scaledBounds.minY) /
            Math.max(1, baseGeometry.halfHeight * 2)
        )
        return
      }
      if (!layer.ctx) {
        return
      }
      layer.bounds = drawScaledSnapshot(
        layer.ctx,
        session.layerSnapshot,
        scaledBounds
      )
      layer.boundsDirty = false
    }

    const applySelectionRotation = (
      session: EditorSelectionRotateSession,
      pointX: number,
      pointY: number
    ) => {
      const layer = getLayerById(session.layerId)
      if (!layer) {
        return
      }
      const currentAngleDeg = getPointerAngleDeg(
        pointX,
        pointY,
        session.centerX,
        session.centerY
      )
      const rotationDeg = getRotationDeltaDeg(
        session.startAngleDeg,
        currentAngleDeg
      )
      if (layer.kind === 'core') {
        maskState.bounds = drawRotatedSnapshot(
          maskState.ctx,
          session.coreMask,
          session.centerX,
          session.centerY,
          rotationDeg
        )
        maskState.boundsDirty = false
        shapeState.bounds = drawRotatedSnapshot(
          shapeState.ctx,
          session.coreShape,
          session.centerX,
          session.centerY,
          rotationDeg
        )
        shapeState.boundsDirty = false
        textureState.bounds = drawRotatedSnapshot(
          textureState.ctx,
          session.coreTexture,
          session.centerX,
          session.centerY,
          rotationDeg
        )
        textureState.boundsDirty = false
        if (session.contourPoints) {
          rotateContourPoints(
            session.contourPoints,
            session.centerX,
            session.centerY,
            rotationDeg
          )
        }
        ensureEyeInsideBody()
        return
      }
      if (layer.kind === 'eye') {
        eyeRotationDeg = normalizeRotationDeg(
          session.eyeRotationDeg + rotationDeg
        )
        return
      }
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        browRotationDeg = normalizeRotationDeg(
          session.browRotationDeg + rotationDeg
        )
        return
      }
      if (!layer.ctx) {
        return
      }
      layer.bounds = drawRotatedSnapshot(
        layer.ctx,
        session.layerSnapshot,
        session.centerX,
        session.centerY,
        rotationDeg
      )
      layer.boundsDirty = false
    }

    const translateLayerPixels = (
      layer: EditorBodyLayer,
      offsetX: number,
      offsetY: number
    ): { x: number; y: number } => {
      if (offsetX === 0 && offsetY === 0) {
        return { x: 0, y: 0 }
      }
      if (layer.kind === 'eye') {
        const previousX = eyeX
        const previousY = eyeY
        const resolvedEye = resolveEyeOffsetInsideBody(
          eyeX + offsetX,
          eyeY + offsetY
        )
        eyeX = resolvedEye.x
        eyeY = resolvedEye.y
        return {
          x: eyeX - previousX,
          y: eyeY - previousY,
        }
      }
      if (layer.kind === 'brow' && browStyle !== 'custom') {
        browOffsetX += offsetX
        browOffsetY += offsetY
        return { x: offsetX, y: offsetY }
      }
      if (!layer.ctx || !layer.canvas) {
        return { x: 0, y: 0 }
      }
      workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      workCtx.drawImage(layer.canvas, 0, 0)
      layer.ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      layer.ctx.drawImage(this.workCanvas, offsetX, offsetY)
      workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      if (!layer.boundsDirty) {
        layer.bounds = translateBounds(layer.bounds, offsetX, offsetY)
      }
      return { x: offsetX, y: offsetY }
    }

    const fillBodyShape = () => {
      coreImageShape = null
      coreImageShapeMirrorX = false
      shapeCtx.save()
      shapeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.fillStyle = colorInput.value
      shapeCtx.fillRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      shapeCtx.globalCompositeOperation = 'destination-in'
      shapeCtx.drawImage(this.maskCanvas, 0, 0)
      shapeCtx.restore()
      shapeState.bounds = cloneBounds(maskState.bounds)
      shapeState.boundsDirty = maskState.boundsDirty
      renderComposite()
    }

    const traceContourPath = (ctx: CanvasRenderingContext2D) => {
      ctx.beginPath()
      ctx.moveTo(contourPoints[0], contourPoints[1])
      for (let i = 2; i < contourPoints.length; i += 2) {
        ctx.lineTo(contourPoints[i], contourPoints[i + 1])
      }
      ctx.closePath()
    }

    const drawContourFill = () => {
      if (!contourClosed || contourPoints.length < 6) {
        return
      }
      const contourBounds = getContourBounds()
      clearBodyShape()
      maskCtx.save()
      maskCtx.fillStyle = '#ffffff'
      traceContourPath(maskCtx)
      maskCtx.fill()
      maskCtx.restore()
      maskState.bounds = contourBounds
        ? createBoundsFromRect(
            contourBounds.minX,
            contourBounds.minY,
            contourBounds.width,
            contourBounds.height
          )
        : null
      maskState.boundsDirty = false

      shapeCtx.save()
      if (coreImageShape && contourBounds) {
        traceContourPath(shapeCtx)
        shapeCtx.clip()
        this.drawImageToRect(
          shapeCtx,
          coreImageShape,
          contourBounds.minX,
          contourBounds.minY,
          contourBounds.width,
          contourBounds.height,
          coreImageShapeMirrorX
        )
      } else {
        shapeCtx.fillStyle = colorInput.value
        traceContourPath(shapeCtx)
        shapeCtx.fill()
      }
      shapeCtx.restore()
      shapeState.bounds = cloneBounds(maskState.bounds)
      shapeState.boundsDirty = false
      ensureEyeInsideBody()
      syncAutoCollisionShapesIfNeeded()
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
      renderLayerList()
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

    const setPresetSelection = (presetId: EditorCharacterBodyPresetId) => {
      currentPresetId = presetId
      presetSelect.value = presetId
    }

    const invalidatePresetSelection = () => {
      if (currentPresetId === CUSTOM_BODY_PRESET_ID) {
        return
      }
      setPresetSelection(CUSTOM_BODY_PRESET_ID)
    }

    const applyPresetTexture = (
      presetId: MapCharacterBodyPresetId,
      bounds: BodyPresetBounds
    ) => {
      if (presetId === 'banana') {
        textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        textureState.bounds = null
        textureState.boundsDirty = false
        return
      }
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      this.drawBodyPresetTexture(textureCtx, presetId, bounds)
      textureState.bounds = createBoundsFromRect(
        bounds.minX,
        bounds.minY,
        bounds.width,
        bounds.height
      )
      textureState.boundsDirty = false
    }

    const applyPreset = async (presetId: MapCharacterBodyPresetId) => {
      flushSettingHistory()
      hideContourMenu()
      hideLayerMenu()
      const preset = this.getBodyPresetConfig(presetId)
      const presetImageMirrorX = this.shouldMirrorPresetImage(
        preset,
        editorFacing
      )
      clearBodyShape()
      coreImageShape = null
      coreImageShapeMirrorX = false
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      textureState.bounds = null
      textureState.boundsDirty = false
      browCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      clearCollisionShapes()
      collisionShapesCustomized = false
      buildDefaultLayers()
      contourPoints = []
      contourClosed = true
      selectedContourIndex = 0
      contourDragPointIndex = -1
      pendingContourClose = false
      selectedLayerId = CORE_LAYER_ID
      eyeY = preset.eyeY
      eyeScaleX = DEFAULT_CHARACTER_EYE_SCALE
      eyeScaleY = DEFAULT_CHARACTER_EYE_SCALE
      eyeRotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG
      eyeStyle = DEFAULT_CHARACTER_EYE_STYLE
      browStyle = DEFAULT_CHARACTER_BROW_STYLE
      browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
      browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
      browScaleX = DEFAULT_CHARACTER_BROW_SCALE
      browScaleY = DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG
      colorInput.value = preset.color
      bloodColorInput.value = preset.bloodColor
      bloodColorAssigned = true
      if (preset.imageSrc) {
        const presetImage = await this.loadImage(preset.imageSrc)
        if (!presetImage) {
          return
        }
        const targetHeight = preset.imageTargetHeight ?? 147
        const targetWidth = Math.max(
          1,
          Math.round((presetImage.width * targetHeight) / presetImage.height)
        )
        const drawX = DRAW_WORLD_HALF - Math.round(targetWidth * 0.5)
        const drawY = DRAW_WORLD_HALF - Math.round(targetHeight * 0.5)
        workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        this.drawImageToRect(
          workCtx,
          presetImage,
          drawX,
          drawY,
          targetWidth,
          targetHeight,
          presetImageMirrorX
        )
        const imageContourPoints = this.buildEditorContourFromMask(workCtx, 160)
        workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        if (!imageContourPoints || imageContourPoints.length < 6) {
          return
        }
        coreImageShape = presetImage
        coreImageShapeMirrorX = presetImageMirrorX
        contourPoints = imageContourPoints
        const contourBounds = getContourBounds()
        eyeX = contourBounds
          ? this.getPresetPreferredEyeX(
              preset,
              contourBounds.width,
              editorFacing
            )
          : DEFAULT_CHARACTER_EYE_X * editorFacing
        drawContourFill()
        textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        textureState.bounds = null
        textureState.boundsDirty = false
      } else {
        contourPoints = this.buildPresetContourPoints(
          preset.points,
          editorFacing
        )
        const contourBounds = getContourBounds()
        eyeX = contourBounds
          ? this.getPresetPreferredEyeX(
              preset,
              contourBounds.width,
              editorFacing
            )
          : DEFAULT_CHARACTER_EYE_X * editorFacing
        drawContourFill()
        if (contourBounds) {
          applyPresetTexture(presetId, contourBounds)
        }
      }
      ensureEyeInsideBody()
      const contourBounds = getContourBounds()
      if (contourBounds) {
        setExportReferenceFromBounds(contourBounds)
        exportBaseWidth =
          Math.round(
            (contourBounds.width / LEGACY_PROFILE_REFERENCE_SIZE) * 1000
          ) / 1000
        exportBaseHeight =
          Math.round(
            (contourBounds.height / LEGACY_PROFILE_REFERENCE_SIZE) * 1000
          ) / 1000
      }
      setPresetSelection(presetId)
      mode = 'shape'
      renderLayerList()
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
      historyManager.capture()
    }

    const drawEyeLayer = (
      ctx: CanvasRenderingContext2D,
      contourBounds: ReturnType<typeof getContourBounds> | null
    ) => {
      if (!contourClosed || !contourBounds) {
        return
      }
      drawCharacterEyeGeometry(
        ctx,
        getCharacterEyeGeometry(
          contourBounds.centerX + eyeX,
          contourBounds.centerY + eyeY,
          editorFacing,
          eyeScaleX,
          eyeScaleY,
          eyeStyle,
          eyeRotationDeg
        ),
        '#17120e'
      )
    }

    const drawBrowStyle = (
      ctx: CanvasRenderingContext2D,
      contourBounds: ReturnType<typeof getContourBounds> | null
    ) => {
      if (
        !contourClosed ||
        !contourBounds ||
        browStyle === 'custom' ||
        browStyle === 'none'
      ) {
        return
      }
      const browGeometry = getBrowGeometry()
      if (!browGeometry) {
        return
      }
      drawCharacterBrowGeometry(ctx, browGeometry, '#231711')
    }

    const drawMergedVisualWorld = (
      ctx: CanvasRenderingContext2D,
      clearFirst: boolean
    ): EditorCanvasBounds | null => {
      const contourBounds = getContourBounds()
      let mergedBounds: EditorCanvasBounds | null = null
      if (clearFirst) {
        ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      }
      ctx.drawImage(this.shapeCanvas, 0, 0)
      mergedBounds = mergeBounds(mergedBounds, shapeState.bounds)
      ctx.save()
      ctx.globalCompositeOperation = 'source-atop'
      ctx.drawImage(this.textureCanvas, 0, 0)
      ctx.restore()
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        if (layer.kind === 'core') {
          continue
        }
        if (layer.kind === 'eye') {
          drawEyeLayer(ctx, contourBounds)
          if (contourBounds) {
            const eyeBounds = getEyeBounds()
            mergedBounds = mergeBounds(mergedBounds, eyeBounds)
          }
          continue
        }
        if (layer.kind === 'bone') {
          continue
        }
        if (layer.kind === 'brow') {
          drawBrowStyle(ctx, contourBounds)
        }
        if (layer.canvas) {
          ctx.drawImage(layer.canvas, 0, 0)
          mergedBounds = mergeBounds(mergedBounds, resolveLayerBounds(layer))
        }
      }
      return mergedBounds
    }

    const drawCollisionOverlay = (ctx: CanvasRenderingContext2D) => {
      if (collisionShapes.length === 0) {
        return
      }
      ctx.save()
      ctx.setLineDash([8 / viewportScale, 5 / viewportScale])
      for (let i = 0; i < collisionShapes.length; i++) {
        const shape = collisionShapes[i]
        traceEditorCollisionShape(ctx, shape)
        ctx.lineWidth =
          shape.id === selectedCollisionShapeId
            ? Math.max(2 / viewportScale, 1)
            : Math.max(1 / viewportScale, 1)
        ctx.strokeStyle =
          shape.id === selectedCollisionShapeId
            ? 'rgba(255,214,188,0.96)'
            : 'rgba(214,116,78,0.88)'
        ctx.stroke()
      }
      ctx.setLineDash([])
      const loops = getCollisionPreviewLoops()
      if (loops && loops.length > 0) {
        ctx.strokeStyle = 'rgba(255,132,86,0.98)'
        ctx.lineWidth = Math.max(2 / viewportScale, 1)
        for (let i = 0; i < loops.length; i++) {
          const loop = loops[i]
          if (loop.length < 6) {
            continue
          }
          ctx.beginPath()
          ctx.moveTo(loop[0], loop[1])
          for (let j = 2; j < loop.length; j += 2) {
            ctx.lineTo(loop[j], loop[j + 1])
          }
          ctx.closePath()
          ctx.stroke()
        }
      }
      const selectedShape =
        mode === 'collision' ? getSelectedCollisionShape() : null
      if (selectedShape) {
        ctx.strokeStyle = 'rgba(255,245,220,0.95)'
        ctx.lineWidth = Math.max(1 / viewportScale, 1)
        ctx.setLineDash([6 / viewportScale, 4 / viewportScale])
        traceCollisionShapeSelectionFrame(ctx, selectedShape)
        ctx.stroke()
        const handleSize = Math.max(2, SELECTION_HANDLE_SIZE / viewportScale)
        const halfHandle = handleSize * 0.5
        const handles: EditorSelectionHandle[] = [
          'nw',
          'n',
          'ne',
          'e',
          'se',
          's',
          'sw',
          'w',
        ]
        ctx.setLineDash([])
        ctx.fillStyle = '#f7ecd2'
        ctx.strokeStyle = 'rgba(36,24,16,0.96)'
        for (let i = 0; i < handles.length; i++) {
          const center = getCollisionShapeSelectionHandleCenter(
            selectedShape,
            handles[i]
          )
          ctx.beginPath()
          ctx.rect(
            center.x - halfHandle,
            center.y - halfHandle,
            handleSize,
            handleSize
          )
          ctx.fill()
          ctx.stroke()
        }
        if (isCollisionShapeRotatable(selectedShape)) {
          const rotateCenter =
            getCollisionShapeRotationHandleCenter(selectedShape)
          const anchorCenter = getCollisionShapeSelectionHandleCenter(
            selectedShape,
            'n'
          )
          const rotateHandleSize = Math.max(
            2,
            SELECTION_ROTATE_HANDLE_SIZE / viewportScale
          )
          const rotateHalfHandle = rotateHandleSize * 0.5
          ctx.beginPath()
          ctx.moveTo(anchorCenter.x, anchorCenter.y)
          ctx.lineTo(rotateCenter.x, rotateCenter.y + rotateHalfHandle)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(
            rotateCenter.x,
            rotateCenter.y,
            rotateHalfHandle,
            0,
            Math.PI * 2
          )
          ctx.fill()
          ctx.stroke()
        }
      }
      ctx.restore()
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
      if (activeSidebarTab === 'bones') {
        // Draw bone layer canvases
        for (const part of BONE_PARTS_ORDERED) {
          const layer = layers.find((l) => l.bonePart === part)
          if (layer?.canvas) {
            drawCtx.drawImage(layer.canvas, 0, 0)
          }
        }
        // Draw humanoid skeleton preview: one segment per unique bone part
        const lineW = Math.max(1, Math.round(1 / viewportScale))
        const dotR = Math.max(2, Math.round(4 / viewportScale))
        const dotRSm = Math.max(1, Math.round(3 / viewportScale))
        const dash = Math.max(3, Math.round(6 / viewportScale))
        const gap = Math.max(2, Math.round(4 / viewportScale))
        for (const part of BONE_PARTS_ORDERED) {
          const layer = layers.find((l) => l.bonePart === part)
          const def = BONE_DEFAULT_POSITIONS[part]
          const px = layer?.bonePivotX ?? def.pivotX
          const py = layer?.bonePivotY ?? def.pivotY
          const tx = layer?.boneTipX ?? def.tipX
          const ty = layer?.boneTipY ?? def.tipY
          const isSelected = selectedBonePart === part
          const isShapeParent = selectedShapePart === part
          drawCtx.save()
          if (isSelected) {
            drawCtx.strokeStyle = 'rgba(255,220,60,0.9)'
            drawCtx.lineWidth = lineW * 2
            drawCtx.setLineDash([])
          } else if (isShapeParent) {
            drawCtx.strokeStyle = 'rgba(255,255,255,0.75)'
            drawCtx.lineWidth = lineW * 2
            drawCtx.setLineDash([dash, gap])
          } else {
            drawCtx.strokeStyle = 'rgba(160,200,255,0.45)'
            drawCtx.lineWidth = lineW
            drawCtx.setLineDash([])
          }
          drawCtx.beginPath()
          drawCtx.moveTo(px, py)
          drawCtx.lineTo(tx, ty)
          drawCtx.stroke()
          drawCtx.setLineDash([])
          if (isSelected) {
            drawCtx.fillStyle = 'rgba(255,80,200,0.95)'
            drawCtx.beginPath()
            drawCtx.arc(px, py, dotR, 0, Math.PI * 2)
            drawCtx.fill()
            drawCtx.fillStyle = 'rgba(60,220,220,0.95)'
            drawCtx.beginPath()
            drawCtx.arc(tx, ty, dotR, 0, Math.PI * 2)
            drawCtx.fill()
          } else if (isShapeParent) {
            drawCtx.fillStyle = 'rgba(255,255,255,0.6)'
            drawCtx.beginPath()
            drawCtx.arc(px, py, dotRSm, 0, Math.PI * 2)
            drawCtx.fill()
            drawCtx.beginPath()
            drawCtx.arc(tx, ty, dotRSm, 0, Math.PI * 2)
            drawCtx.fill()
          } else {
            drawCtx.fillStyle = 'rgba(160,200,255,0.35)'
            drawCtx.beginPath()
            drawCtx.arc(px, py, dotRSm, 0, Math.PI * 2)
            drawCtx.fill()
          }
          drawCtx.restore()
        }
        if (selectedBoundaryPart !== null) {
          drawCollisionOverlay(drawCtx)
        }
        drawCtx.restore()
        return
      }

      drawMergedVisualWorld(drawCtx, false)
      drawCollisionOverlay(drawCtx)

      if (mode === 'select') {
        const selectedBounds = getSelectedLayerBounds()
        const selectedLayer = getSelectedLayer()
        if (selectedBounds) {
          drawCtx.save()
          drawCtx.strokeStyle = 'rgba(255,245,220,0.95)'
          drawCtx.lineWidth = Math.max(1 / viewportScale, 1)
          drawCtx.setLineDash([6 / viewportScale, 4 / viewportScale])
          drawCtx.strokeRect(
            selectedBounds.minX,
            selectedBounds.minY,
            Math.max(1, selectedBounds.maxX - selectedBounds.minX),
            Math.max(1, selectedBounds.maxY - selectedBounds.minY)
          )
          if (isLayerScalable(selectedLayer)) {
            const handleSize = Math.max(
              2,
              SELECTION_HANDLE_SIZE / viewportScale
            )
            const halfHandle = handleSize * 0.5
            const handles: EditorSelectionHandle[] = [
              'nw',
              'n',
              'ne',
              'e',
              'se',
              's',
              'sw',
              'w',
            ]
            drawCtx.setLineDash([])
            drawCtx.fillStyle = '#f7ecd2'
            drawCtx.strokeStyle = 'rgba(36,24,16,0.96)'
            for (let i = 0; i < handles.length; i++) {
              const center = getSelectionHandleCenter(
                selectedBounds,
                handles[i]
              )
              drawCtx.beginPath()
              drawCtx.rect(
                center.x - halfHandle,
                center.y - halfHandle,
                handleSize,
                handleSize
              )
              drawCtx.fill()
              drawCtx.stroke()
            }
          }
          if (isLayerRotatable(selectedLayer)) {
            const rotateCenter =
              getSelectionRotationHandleCenter(selectedBounds)
            const handleSize = Math.max(
              2,
              SELECTION_ROTATE_HANDLE_SIZE / viewportScale
            )
            const halfHandle = handleSize * 0.5
            const anchorY = selectedBounds.minY
            drawCtx.setLineDash([])
            drawCtx.strokeStyle = 'rgba(36,24,16,0.96)'
            drawCtx.beginPath()
            drawCtx.moveTo(rotateCenter.x, anchorY)
            drawCtx.lineTo(rotateCenter.x, rotateCenter.y + halfHandle)
            drawCtx.stroke()
            drawCtx.fillStyle = '#f7ecd2'
            drawCtx.beginPath()
            drawCtx.arc(
              rotateCenter.x,
              rotateCenter.y,
              halfHandle,
              0,
              Math.PI * 2
            )
            drawCtx.fill()
            drawCtx.stroke()
          }
          drawCtx.restore()
        }
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
      if (mode === 'select') {
        cursorEl.style.display = 'none'
        return
      }
      const wrapRect = canvasWrap.getBoundingClientRect()
      const drawRect = drawCanvas.getBoundingClientRect()
      const screenPoint = bodyToCanvasPoint(point.x + 0.5, point.y + 0.5)
      const canvasDisplayScale = drawRect.width / DISPLAY_SIZE
      cursorEl.style.left = `${screenPoint.x * canvasDisplayScale + drawRect.left - wrapRect.left}px`
      cursorEl.style.top = `${screenPoint.y * canvasDisplayScale + drawRect.top - wrapRect.top}px`
      cursorEl.style.display = 'block'
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
      const contourBounds = getContourBounds()
      maskState.bounds = contourBounds
        ? createBoundsFromRect(
            contourBounds.minX,
            contourBounds.minY,
            contourBounds.width,
            contourBounds.height
          )
        : null
      maskState.boundsDirty = false
      shapeState.bounds = cloneBounds(maskState.bounds)
      shapeState.boundsDirty = false
      selectedContourIndex = Math.min(
        selectedContourIndex < 0 ? 0 : selectedContourIndex,
        getContourPointCount() - 1
      )
      ensureEyeInsideBody()
      syncAutoCollisionShapesIfNeeded()
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

    const strokeMaskedTexturePath = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number,
      brushSize: number,
      color: string
    ) => {
      workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      strokePath(
        workCtx,
        fromX,
        fromY,
        toX,
        toY,
        brushSize,
        color,
        'source-over'
      )
      workCtx.globalCompositeOperation = 'destination-in'
      workCtx.drawImage(this.maskCanvas, 0, 0)
      workCtx.globalCompositeOperation = 'source-over'
      textureCtx.drawImage(this.workCanvas, 0, 0)
      workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
    }

    const drawStroke = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number
    ) => {
      const brushSize = getBrushSize()
      const selectedLayer = getSelectedLayer()
      const selectedPaintLayer =
        selectedLayer &&
        (selectedLayer.kind === 'brow' ||
          selectedLayer.kind === 'paint' ||
          selectedLayer.kind === 'bone') &&
        ensureLayerSurface(selectedLayer) &&
        selectedLayer.ctx
          ? selectedLayer
          : null
      if (mode === 'erase') {
        if (isCoreLayerSelected()) {
          coreImageShape = null
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
          maskState.boundsDirty = true
          shapeState.boundsDirty = true
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
        } else if (selectedPaintLayer?.ctx) {
          strokePath(
            selectedPaintLayer.ctx,
            fromX,
            fromY,
            toX,
            toY,
            brushSize,
            '#000000',
            'destination-out'
          )
          selectedPaintLayer.boundsDirty = true
        }
      } else if (mode === 'shape') {
        if (isCoreLayerSelected()) {
          coreImageShape = null
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
          maskState.bounds = expandBoundsForStroke(
            maskState.bounds,
            fromX,
            fromY,
            toX,
            toY,
            brushSize
          )
          maskState.boundsDirty = false
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
          shapeState.bounds = expandBoundsForStroke(
            shapeState.bounds,
            fromX,
            fromY,
            toX,
            toY,
            brushSize
          )
          shapeState.boundsDirty = false
        } else if (selectedPaintLayer?.ctx) {
          strokePath(
            selectedPaintLayer.ctx,
            fromX,
            fromY,
            toX,
            toY,
            brushSize,
            colorInput.value,
            'source-over'
          )
          selectedPaintLayer.bounds = expandBoundsForStroke(
            selectedPaintLayer.bounds,
            fromX,
            fromY,
            toX,
            toY,
            brushSize
          )
          selectedPaintLayer.boundsDirty = false
        }
      } else if (mode === 'texture' && isCoreLayerSelected()) {
        strokeMaskedTexturePath(
          fromX,
          fromY,
          toX,
          toY,
          brushSize,
          colorInput.value
        )
        textureState.boundsDirty = true
      }
      pointerChanged = true
      renderComposite()
    }

    const loadInitialProfile = async () => {
      clearBodyShape()
      coreImageShape = null
      coreImageShapeMirrorX = false
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      browCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      textureState.bounds = null
      textureState.boundsDirty = false
      buildDefaultLayers()
      contourPoints = []
      contourClosed = false
      selectedContourIndex = -1
      contourDragPointIndex = -1
      pendingContourClose = false
      selectedLayerId = CORE_LAYER_ID
      eyeScaleX = DEFAULT_CHARACTER_EYE_SCALE
      eyeScaleY = DEFAULT_CHARACTER_EYE_SCALE
      eyeRotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG
      eyeStyle = DEFAULT_CHARACTER_EYE_STYLE
      browStyle = DEFAULT_CHARACTER_BROW_STYLE
      browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
      browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
      browScaleX = DEFAULT_CHARACTER_BROW_SCALE
      browScaleY = DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG

      const profile = options.initialProfile
      const initialPresetId = this.isBodyPresetId(profile?.presetId)
        ? profile.presetId
        : CUSTOM_BODY_PRESET_ID
      const initialPresetConfig = this.isBodyPresetId(initialPresetId)
        ? this.getBodyPresetConfig(initialPresetId)
        : null
      const initialPresetImageSrc = this.getBodyPresetImageSrc(initialPresetId)
      const initialContourWidth = profile?.points.length
        ? this.getProfilePointWidth(profile.points)
        : 0
      const initialEyeDrawX =
        !!initialPresetConfig &&
        typeof profile?.eyeX === 'number' &&
        Number.isFinite(profile.eyeX) &&
        profile.eyeX === 0
          ? this.getPresetPreferredEyeX(
              initialPresetConfig,
              initialContourWidth,
              1
            )
          : getCharacterEyeDrawX(profile)
      eyeX = initialEyeDrawX * editorFacing
      eyeY = getCharacterEyeDrawY(profile)
      eyeScaleX =
        typeof profile?.eyeScaleX === 'number'
          ? clampCharacterEyeScale(profile.eyeScaleX)
          : DEFAULT_CHARACTER_EYE_SCALE
      eyeScaleY =
        typeof profile?.eyeScaleY === 'number'
          ? clampCharacterEyeScale(profile.eyeScaleY)
          : DEFAULT_CHARACTER_EYE_SCALE
      eyeRotationDeg = getCharacterEyeRotationDeg(profile) * editorFacing
      eyeStyle = getCharacterEyeStyle(profile)
      browStyle = getCharacterBrowStyle(profile)
      browOffsetX = getCharacterBrowOffsetX(profile) * editorFacing
      browOffsetY = getCharacterBrowOffsetY(profile)
      browScaleX =
        typeof profile?.browScaleX === 'number'
          ? clampCharacterEyeScale(profile.browScaleX)
          : DEFAULT_CHARACTER_BROW_SCALE
      browScaleY =
        typeof profile?.browScaleY === 'number'
          ? clampCharacterEyeScale(profile.browScaleY)
          : DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = getCharacterBrowRotationDeg(profile) * editorFacing
      if (profile && profile.points.length >= 6) {
        contourPoints = new Array<number>(profile.points.length)
        for (let i = 0; i < profile.points.length; i += 2) {
          contourPoints[i] = profile.points[i] * editorFacing + DRAW_WORLD_HALF
          contourPoints[i + 1] = profile.points[i + 1] + DRAW_WORLD_HALF
        }
        contourClosed = true
        clearCollisionShapes()
        collisionShapesCustomized = false
        drawContourFill()

        const restorePresetBaseImage =
          !profile.textureDataUrl &&
          !!initialPresetImageSrc &&
          !!profile.embeddedEye
        const coreDataUrl = restorePresetBaseImage
          ? initialPresetImageSrc
          : (profile.textureDataUrl ?? profile.surfaceDataUrl)
        const contourBounds = getContourBounds()
        if (coreDataUrl) {
          const image = await this.loadImage(coreDataUrl)
          if (image && contourBounds) {
            if (restorePresetBaseImage) {
              coreImageShape = image
              coreImageShapeMirrorX =
                initialPresetConfig !== null
                  ? this.shouldMirrorPresetImage(
                      initialPresetConfig,
                      editorFacing
                    )
                  : false
              colorInput.value = TRANSPARENT_BODY_COLOR
              drawContourFill()
            } else {
              this.drawImageToRect(
                shapeCtx,
                image,
                contourBounds.minX,
                contourBounds.minY,
                contourBounds.width,
                contourBounds.height,
                editorFacing < 0
              )
              shapeState.bounds = createBoundsFromRect(
                contourBounds.minX,
                contourBounds.minY,
                contourBounds.width,
                contourBounds.height
              )
              shapeState.boundsDirty = false
            }
          }
        }
        if (profile.layers && profile.layers.length > 0 && contourBounds) {
          for (let i = 0; i < profile.layers.length; i++) {
            const visualLayer = profile.layers[i]
            const image = await this.loadImage(visualLayer.dataUrl)
            if (!image) {
              continue
            }
            const targetLayer =
              visualLayer.kind === 'brow'
                ? getLayerById(BROW_LAYER_ID)
                : appendPaintLayer(visualLayer.name)
            if (
              !targetLayer ||
              !ensureLayerSurface(targetLayer) ||
              !targetLayer.ctx
            ) {
              continue
            }
            const drawWidth = Math.max(1, Math.round(visualLayer.width))
            const drawHeight = Math.max(1, Math.round(visualLayer.height))
            const drawX =
              contourBounds.centerX +
              Math.round(visualLayer.offsetX * editorFacing) -
              Math.round(drawWidth * 0.5)
            const drawY =
              contourBounds.centerY +
              Math.round(visualLayer.offsetY) -
              Math.round(drawHeight * 0.5)
            this.drawImageToRect(
              targetLayer.ctx,
              image,
              drawX,
              drawY,
              drawWidth,
              drawHeight,
              editorFacing < 0
            )
            targetLayer.bounds = createBoundsFromRect(
              drawX,
              drawY,
              drawWidth,
              drawHeight
            )
            targetLayer.boundsDirty = false
          }
        }
        if (profile.layerOrder && profile.layerOrder.length > 0) {
          applyLayerOrder(profile.layerOrder)
        }
        if (profile.collisionShapes && profile.collisionShapes.length > 0) {
          const contourBounds = getContourBounds()
          if (contourBounds) {
            setCollisionShapesFromMap(
              profile.collisionShapes,
              contourBounds.centerX,
              contourBounds.centerY,
              editorFacing
            )
            collisionShapesCustomized = true
          }
        }
        if (profile.skeletalMode) {
          skeletalModeEnabled = true
        }
        if (profile.boneSegments && profile.boneSegments.length > 0) {
          ensureAllBoneLayers()
          loadBoneSegments(profile.boneSegments)
        }
        selectedContourIndex = 0
      } else {
        contourPoints = buildDefaultContourPoints()
        contourClosed = true
        selectedContourIndex = 0
        clearCollisionShapes()
        collisionShapesCustomized = false
        drawContourFill()
      }
      setPresetSelection(initialPresetId)
      setExportReferenceFromBounds(getContourBounds())
      mode = contourClosed ? 'shape' : 'contour'
      renderLayerList()
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
    }

    contourBtn.addEventListener('click', () => {
      hideContourMenu()
      hideLayerMenu()
      selectedLayerId = CORE_LAYER_ID
      mode = 'contour'
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
    })
    selectBtn.addEventListener('click', () => {
      if (!contourClosed) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      mode = 'select'
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
    })
    collisionBtn.addEventListener('click', () => {
      if (!contourClosed) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionShapeMenu()
      mode = 'collision'
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
    })
    collisionBtn.addEventListener('contextmenu', (event) => {
      if (!contourClosed) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionShapeMenu()
      showPopupMenuAt(collisionToolMenu, event.clientX, event.clientY)
      event.preventDefault()
      event.stopPropagation()
    })
    shapeBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      mode = 'shape'
      updateModeButtons()
      updateCursorVisual()
    })
    fillBtn.addEventListener('click', () => {
      if (!canUsePaintModes() || !isCoreLayerSelected()) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      mode = 'fill'
      updateModeButtons()
      updateCursorVisual()
    })
    eraseBtn.addEventListener('click', () => {
      if (!canUsePaintModes()) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      mode = 'erase'
      updateModeButtons()
      updateCursorVisual()
    })
    textureBtn.addEventListener('click', () => {
      if (!canUsePaintModes() || !isCoreLayerSelected()) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      mode = 'texture'
      updateModeButtons()
      updateCursorVisual()
    })
    boneLengthRow.inp.addEventListener('change', () => {
      if (!selectedBonePart) return
      const layer = layers.find((l) => l.bonePart === selectedBonePart)
      if (!layer) return
      const newLen = parseFloat(boneLengthRow.inp.value) || 0.15
      const def = BONE_DEFAULT_POSITIONS[selectedBonePart]
      const pivotX = layer.bonePivotX ?? def.pivotX
      const pivotY = layer.bonePivotY ?? def.pivotY
      const tipX = layer.boneTipX ?? def.tipX
      const tipY = layer.boneTipY ?? def.tipY
      const dx = tipX - pivotX
      const dy = tipY - pivotY
      const currentLen = Math.sqrt(dx * dx + dy * dy) || 1
      const newLenPx = newLen * LEGACY_PROFILE_REFERENCE_SIZE
      const scale = newLenPx / currentLen
      layer.boneTipX = Math.round(pivotX + dx * scale)
      layer.boneTipY = Math.round(pivotY + dy * scale)
      renderComposite()
    })

    boneWidthRow.inp.addEventListener('change', () => {
      // width is stored per-segment at save time; no visual update needed here
    })

    addLayerBtn.addEventListener('click', () => {
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      flushSettingHistory()
      invalidatePresetSelection()
      const layer = appendPaintLayer()
      if (!layer) {
        return
      }
      selectedLayerId = layer.id
      if (mode === 'contour') {
        mode = 'shape'
      }
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
      historyManager.capture()
    })
    resetShapeBtn.addEventListener('click', () => {
      flushSettingHistory()
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      setPresetSelection(CUSTOM_BODY_PRESET_ID)
      clearBodyShape()
      coreImageShape = null
      coreImageShapeMirrorX = false
      contourPoints = []
      contourClosed = false
      selectedContourIndex = -1
      contourDragPointIndex = -1
      pendingContourClose = false
      hoverVisible = false
      mode = 'contour'
      eyeX = DEFAULT_CHARACTER_EYE_X * editorFacing
      eyeY = DEFAULT_CHARACTER_EYE_Y
      eyeScaleX = DEFAULT_CHARACTER_EYE_SCALE
      eyeScaleY = DEFAULT_CHARACTER_EYE_SCALE
      eyeRotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG
      eyeStyle = DEFAULT_CHARACTER_EYE_STYLE
      browStyle = DEFAULT_CHARACTER_BROW_STYLE
      browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
      browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
      browScaleX = DEFAULT_CHARACTER_BROW_SCALE
      browScaleY = DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      textureState.bounds = null
      textureState.boundsDirty = false
      browCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      clearCollisionShapes()
      collisionShapesCustomized = false
      buildDefaultLayers()
      selectedLayerId = CORE_LAYER_ID
      renderLayerList()
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
      historyManager.capture()
    })
    clearTextureBtn.addEventListener('click', () => {
      if (!contourClosed) {
        return
      }
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      flushSettingHistory()
      invalidatePresetSelection()
      clearVisualLayer(getSelectedLayer())
      renderComposite()
      historyManager.capture()
    })
    presetSelect.addEventListener('change', async () => {
      const nextPresetId = presetSelect.value
      if (nextPresetId === currentPresetId) {
        return
      }
      if (nextPresetId === CUSTOM_BODY_PRESET_ID) {
        setPresetSelection(CUSTOM_BODY_PRESET_ID)
        historyManager.capture()
        return
      }
      if (this.isBodyPresetId(nextPresetId)) {
        await applyPreset(nextPresetId)
      }
    })
    colorInput.addEventListener('input', () => {
      invalidatePresetSelection()
      settingsChanged = true
      updateCursorVisual()
    })
    colorInput.addEventListener('change', () => {
      flushSettingHistory()
    })
    bloodColorInput.addEventListener('input', () => {
      invalidatePresetSelection()
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
      invalidatePresetSelection()
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
      invalidatePresetSelection()
      if (deleteSelectedContourPoint()) {
        historyManager.capture()
      }
    })
    duplicateLayerBtn.addEventListener('click', () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      hideLayerMenu()
      if (!targetLayer || !canDuplicateLayer(targetLayer)) {
        return
      }
      flushSettingHistory()
      invalidatePresetSelection()
      const duplicate = cloneLayer(targetLayer)
      if (!duplicate) {
        return
      }
      selectedLayerId = duplicate.id
      mode = 'select'
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
      historyManager.capture()
    })
    renameLayerBtn.addEventListener('click', () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      hideLayerMenu()
      if (!targetLayer) {
        return
      }
      beginLayerRename(targetLayer.id)
    })
    styleLayerBtn.addEventListener('click', async () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      hideLayerMenu()
      if (!targetLayer || !canStyleLayer(targetLayer)) {
        return
      }
      const nextStyle = await chooseLayerStyle(targetLayer)
      if (!nextStyle) {
        return
      }
      flushSettingHistory()
      invalidatePresetSelection()
      if (targetLayer.kind === 'eye') {
        if (eyeStyle === nextStyle) {
          return
        }
        eyeStyle = nextStyle as MapCharacterBodyEyeStyle
      } else if (targetLayer.kind === 'brow') {
        if (browStyle === nextStyle) {
          return
        }
        browStyle = nextStyle as MapCharacterBodyBrowStyle
      }
      renderComposite()
      historyManager.capture()
    })
    deleteLayerBtn.addEventListener('click', async () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      hideLayerMenu()
      if (!targetLayer || !canDeleteLayer(targetLayer)) {
        return
      }
      const confirmed = await confirmDeleteLayer(targetLayer.name)
      if (!confirmed) {
        return
      }
      flushSettingHistory()
      invalidatePresetSelection()
      if (!deletePaintLayer(targetLayer.id)) {
        return
      }
      mode = 'select'
      renderLayerList()
      updateModeButtons()
      updateCursorVisual()
      renderComposite()
      historyManager.capture()
    })
    collisionCircleBtn.addEventListener('click', () => {
      collisionToolKind = 'circle'
      hideCollisionToolMenu()
    })
    collisionEllipseBtn.addEventListener('click', () => {
      collisionToolKind = 'ellipse'
      hideCollisionToolMenu()
    })
    collisionCapsuleBtn.addEventListener('click', () => {
      collisionToolKind = 'capsule'
      hideCollisionToolMenu()
    })
    deleteCollisionShapeBtn.addEventListener('click', () => {
      hideCollisionShapeMenu()
      if (!deleteSelectedCollisionShape()) {
        return
      }
      renderComposite()
      historyManager.capture()
    })

    drawCanvas.addEventListener(
      'contextmenu',
      (event) => {
        const point = getCanvasPoint(event as PointerEvent)
        hideLayerMenu()
        hideCollisionToolMenu()
        if (mode === 'contour') {
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
          return
        }
        hideContourMenu()
        if (mode === 'collision') {
          const hitShape = getCollisionShapeAtPoint(point.x, point.y)
          if (hitShape) {
            selectedCollisionShapeId = hitShape.id
            showPopupMenuAt(collisionShapeMenu, event.clientX, event.clientY)
            renderLayerList()
            renderComposite()
          } else {
            hideCollisionShapeMenu()
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        hideCollisionShapeMenu()
        const hitLayer = getSelectableLayerAtPoint(point.x, point.y)
        if (hitLayer) {
          selectedLayerId = hitLayer.id
          renderLayerList()
          updateModeButtons()
          updateCursorVisual()
          showLayerMenu(event.clientX, event.clientY, hitLayer.id)
          renderComposite()
        }
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )

    drawCanvas.addEventListener(
      'wheel',
      (event) => {
        hideContourMenu()
        hideLayerMenu()
        hideCollisionToolMenu()
        hideCollisionShapeMenu()
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
        hideLayerMenu()
        hideCollisionToolMenu()
        hideCollisionShapeMenu()
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
        if (mode === 'select') {
          const selectedLayer = getSelectedLayer()
          const selectedBounds = getSelectedLayerBounds()
          const rotationHandle =
            isLayerRotatable(selectedLayer) && selectedBounds
              ? getSelectionRotationHandleAtPoint(
                  point.x,
                  point.y,
                  selectedBounds
                )
              : null
          if (selectedLayer && selectedBounds && rotationHandle) {
            pointerActive = true
            pointerChanged = false
            selectionDragLayerId = -1
            selectionScaleSession = null
            selectionRotateSession = beginSelectionRotate(
              selectedLayer,
              selectedBounds,
              point.x,
              point.y
            )
            if (!selectionRotateSession) {
              pointerActive = false
              event.preventDefault()
              event.stopPropagation()
              return
            }
            invalidatePresetSelection()
            lastX = point.x
            lastY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const selectionHandle =
            isLayerScalable(selectedLayer) && selectedBounds
              ? getSelectionHandleAtPoint(point.x, point.y, selectedBounds)
              : null
          if (selectedLayer && selectedBounds && selectionHandle) {
            pointerActive = true
            pointerChanged = false
            selectionDragLayerId = -1
            selectionRotateSession = null
            selectionScaleSession = beginSelectionScale(
              selectedLayer,
              selectionHandle,
              selectedBounds,
              point.x,
              point.y
            )
            if (!selectionScaleSession) {
              pointerActive = false
              event.preventDefault()
              event.stopPropagation()
              return
            }
            invalidatePresetSelection()
            lastX = point.x
            lastY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const hitLayer = getSelectableLayerAtPoint(point.x, point.y)
          if (!hitLayer) {
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          selectedLayerId = hitLayer.id
          renderLayerList()
          updateModeButtons()
          if (!isLayerMovable(hitLayer)) {
            updateCursorVisual()
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          pointerActive = true
          pointerChanged = false
          selectionDragLayerId = hitLayer.id
          selectionScaleSession = null
          selectionRotateSession = null
          lastDragWorldX = point.x
          lastDragWorldY = point.y
          lastX = point.x
          lastY = point.y
          drawCanvas.setPointerCapture(event.pointerId)
          renderComposite()
          event.preventDefault()
          event.stopPropagation()
          return
        }
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
            invalidatePresetSelection()
            beginContour(point.x, point.y)
            historyManager.capture()
          } else {
            invalidatePresetSelection()
            appendContourPoint(point.x, point.y)
            historyManager.capture()
          }
          updateCursorVisual()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (mode === 'collision') {
          const selectedShape = getSelectedCollisionShape()
          const collisionRotationHandle =
            getCollisionShapeRotationHandleAtPoint(
              point.x,
              point.y,
              selectedShape
            )
          if (selectedShape && collisionRotationHandle) {
            pointerActive = true
            pointerChanged = false
            collisionCreating = false
            collisionPointerShapeId = selectedShape.id
            collisionScaleSession = null
            collisionRotateSession = beginCollisionShapeRotate(
              selectedShape,
              point.x,
              point.y
            )
            lastX = point.x
            lastY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const collisionSelectionHandle =
            getCollisionShapeSelectionHandleAtPoint(
              point.x,
              point.y,
              selectedShape
            )
          if (selectedShape && collisionSelectionHandle) {
            pointerActive = true
            pointerChanged = false
            collisionCreating = false
            collisionPointerShapeId = selectedShape.id
            collisionRotateSession = null
            collisionScaleSession = beginCollisionShapeScale(
              selectedShape,
              collisionSelectionHandle,
              point.x,
              point.y
            )
            lastX = point.x
            lastY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const hitShape = getCollisionShapeAtPoint(point.x, point.y)
          if (hitShape) {
            selectedCollisionShapeId = hitShape.id
            collisionPointerShapeId = hitShape.id
            collisionCreating = false
            collisionScaleSession = null
            collisionRotateSession = null
            pointerActive = true
            pointerChanged = false
            lastDragWorldX = point.x
            lastDragWorldY = point.y
            drawCanvas.setPointerCapture(event.pointerId)
            renderLayerList()
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          // In bone boundary mode: only adjust existing shape, never create new ones
          if (selectedBoundaryPart !== null) {
            selectedCollisionShapeId = -1
            renderComposite()
            event.preventDefault()
            event.stopPropagation()
            return
          }
          const createdShape = createCollisionShapeFromDrag(
            nextCollisionShapeId++,
            point.x,
            point.y,
            point.x,
            point.y
          )
          appendCollisionShape(createdShape)
          collisionPointerShapeId = createdShape.id
          collisionCreating = true
          collisionScaleSession = null
          collisionRotateSession = null
          pointerActive = true
          pointerChanged = false
          lastX = point.x
          lastY = point.y
          drawCanvas.setPointerCapture(event.pointerId)
          renderLayerList()
          renderComposite()
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (mode === 'shape') {
          if (isCoreLayerSelected()) {
            shapeStrokeAnchored = isPointInsideBodyMask(point.x, point.y)
            if (!shapeStrokeAnchored) {
              event.preventDefault()
              event.stopPropagation()
              return
            }
          } else {
            shapeStrokeAnchored = true
          }
        } else if (mode === 'fill') {
          if (!isPointInsideBodyMask(point.x, point.y)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          invalidatePresetSelection()
          fillBodyShape()
          historyManager.capture()
          event.preventDefault()
          event.stopPropagation()
          return
        } else {
          shapeStrokeAnchored = false
        }
        invalidatePresetSelection()
        pointerActive = true
        pointerChanged = false
        lastX = point.x
        lastY = point.y
        drawCanvas.setPointerCapture(event.pointerId)
        drawStroke(point.x, point.y, point.x, point.y)
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
        if (mode === 'select') {
          if (!pointerActive) {
            renderComposite()
            return
          }
          if (selectionScaleSession) {
            if (point.x !== lastX || point.y !== lastY) {
              applySelectionScale(selectionScaleSession, point.x, point.y)
              pointerChanged = true
              lastX = point.x
              lastY = point.y
              renderComposite()
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (selectionRotateSession) {
            if (point.x !== lastX || point.y !== lastY) {
              applySelectionRotation(selectionRotateSession, point.x, point.y)
              pointerChanged = true
              lastX = point.x
              lastY = point.y
              renderComposite()
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (selectionDragLayerId >= 0) {
            const offsetX = point.x - lastDragWorldX
            const offsetY = point.y - lastDragWorldY
            if (offsetX !== 0 || offsetY !== 0) {
              const dragLayer = getLayerById(selectionDragLayerId)
              if (dragLayer) {
                invalidatePresetSelection()
                const appliedOffset = translateLayerPixels(
                  dragLayer,
                  offsetX,
                  offsetY
                )
                if (appliedOffset.x !== 0 || appliedOffset.y !== 0) {
                  pointerChanged = true
                  lastDragWorldX += appliedOffset.x
                  lastDragWorldY += appliedOffset.y
                  renderComposite()
                }
              }
            }
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (mode === 'contour') {
          if (pointerActive && contourDragPointIndex >= 0) {
            if (point.x !== lastX || point.y !== lastY) {
              invalidatePresetSelection()
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
        if (mode === 'collision') {
          if (!pointerActive || collisionPointerShapeId < 0) {
            renderComposite()
            return
          }
          const activeShape = getCollisionShapeById(collisionPointerShapeId)
          if (!activeShape) {
            return
          }
          if (collisionRotateSession) {
            if (point.x !== lastX || point.y !== lastY) {
              applyCollisionShapeRotate(
                collisionRotateSession,
                point.x,
                point.y
              )
              pointerChanged = true
              collisionShapesCustomized = true
              lastX = point.x
              lastY = point.y
              invalidateCollisionPreview()
              renderComposite()
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (collisionScaleSession) {
            if (point.x !== lastX || point.y !== lastY) {
              applyCollisionShapeScale(collisionScaleSession, point.x, point.y)
              pointerChanged = true
              collisionShapesCustomized = true
              lastX = point.x
              lastY = point.y
              invalidateCollisionPreview()
              renderComposite()
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (!collisionCreating) {
            const moveX = point.x - lastDragWorldX
            const moveY = point.y - lastDragWorldY
            if (moveX !== 0 || moveY !== 0) {
              activeShape.centerX += moveX
              activeShape.centerY += moveY
              lastDragWorldX = point.x
              lastDragWorldY = point.y
              pointerChanged = true
              collisionShapesCustomized = true
              invalidateCollisionPreview()
              renderComposite()
            }
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (point.x !== lastX || point.y !== lastY) {
            const nextShape = createCollisionShapeFromDrag(
              activeShape.id,
              lastX,
              lastY,
              point.x,
              point.y
            )
            if (activeShape.kind === 'circle' && nextShape.kind === 'circle') {
              activeShape.centerX = nextShape.centerX
              activeShape.centerY = nextShape.centerY
              activeShape.radius = nextShape.radius
            } else if (
              activeShape.kind === 'ellipse' &&
              nextShape.kind === 'ellipse'
            ) {
              activeShape.centerX = nextShape.centerX
              activeShape.centerY = nextShape.centerY
              activeShape.radiusX = nextShape.radiusX
              activeShape.radiusY = nextShape.radiusY
              activeShape.rotationDeg = nextShape.rotationDeg
            } else if (
              activeShape.kind === 'capsule' &&
              nextShape.kind === 'capsule'
            ) {
              activeShape.centerX = nextShape.centerX
              activeShape.centerY = nextShape.centerY
              activeShape.halfWidth = nextShape.halfWidth
              activeShape.halfHeight = nextShape.halfHeight
              activeShape.rotationDeg = nextShape.rotationDeg
            }
            pointerChanged = true
            collisionShapesCustomized = true
            invalidateCollisionPreview()
            renderComposite()
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (!pointerActive) {
          return
        }
        drawStroke(lastX, lastY, point.x, point.y)
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
      const wasSelectDrag = mode === 'select'
      const wasCollisionDrag = mode === 'collision'
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
      if (wasSelectDrag) {
        if (drawCanvas.hasPointerCapture(event.pointerId)) {
          drawCanvas.releasePointerCapture(event.pointerId)
        }
        selectionDragLayerId = -1
        selectionScaleSession = null
        selectionRotateSession = null
        lastDragWorldX = 0
        lastDragWorldY = 0
        if (pointerChanged) {
          pointerChanged = false
          historyManager.capture()
        }
        cursorEl.style.display = 'none'
        hoverVisible = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (wasCollisionDrag) {
        if (drawCanvas.hasPointerCapture(event.pointerId)) {
          drawCanvas.releasePointerCapture(event.pointerId)
        }
        if (collisionCreating && !pointerChanged) {
          const createdShape = getCollisionShapeById(collisionPointerShapeId)
          if (createdShape) {
            const bounds = getCollisionShapeBounds(createdShape)
            const width = bounds.maxX - bounds.minX
            const height = bounds.maxY - bounds.minY
            if (
              width <= MIN_COLLISION_HALF_EXTENT &&
              height <= MIN_COLLISION_HALF_EXTENT
            ) {
              deleteSelectedCollisionShape()
            }
          }
        }
        collisionPointerShapeId = -1
        collisionCreating = false
        collisionScaleSession = null
        collisionRotateSession = null
        if (pointerChanged) {
          historyManager.capture()
        }
        pointerChanged = false
        cursorEl.style.display = 'none'
        hoverVisible = false
        renderLayerList()
        renderComposite()
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const shouldSyncContourFromMask = mode === 'shape' && pointerChanged
      if (pointerChanged) {
        if (shouldSyncContourFromMask && isCoreLayerSelected()) {
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
        if (!layerMenu.contains(event.target as Node)) {
          hideLayerMenu()
        }
        if (!collisionToolMenu.contains(event.target as Node)) {
          hideCollisionToolMenu()
        }
        if (!collisionShapeMenu.contains(event.target as Node)) {
          hideCollisionShapeMenu()
        }
      },
      true
    )

    const handleViewportKeydown = (event: KeyboardEvent) => {
      if (!modal.isConnected) {
        return
      }
      if (event.target instanceof Node && !modal.contains(event.target)) {
        return
      }
      if (
        event.target instanceof HTMLInputElement &&
        event.target.dataset.layerRename === '1'
      ) {
        return
      }
      if (
        mode === 'contour' &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        invalidatePresetSelection()
        if (deleteSelectedContourPoint()) {
          historyManager.capture()
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (
        mode === 'collision' &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        if (deleteSelectedCollisionShape()) {
          renderComposite()
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
    }
    viewport.addEventListener('keydown', handleViewportKeydown, true)

    const finish = (
      value: MapCharacterBodyProfile | null | undefined
    ): MapCharacterBodyProfile | null | undefined => {
      if (resolved) {
        return undefined
      }
      resolved = true
      viewport.removeEventListener('keydown', handleViewportKeydown, true)
      close()
      return value
    }

    const promise = new Promise<MapCharacterBodyProfile | null | undefined>(
      (resolve) => {
        confirmBtn.addEventListener('click', () => {
          const canBuildFromSkeleton = skeletalModeEnabled && hasAnyBoneData()
          if (!contourClosed && !canBuildFromSkeleton) {
            updateAlert()
            return
          }
          const segs = getBoneSegments()
          let builtProfile: MapCharacterBodyProfile | null = null
          if (canBuildFromSkeleton) {
            builtProfile = this.buildSkeletalProfile(
              segs,
              colorInput.value,
              bloodColorInput.value,
              exportBaseWidth,
              exportBaseHeight,
              currentPresetId
            )
          } else {
            const contourBounds = getContourBounds()
            const serializedCollisionShapes = contourBounds
              ? serializeCollisionShapes(
                  contourBounds.centerX,
                  contourBounds.centerY
                )
              : []
            builtProfile = this.buildProfile(
              maskCtx,
              shapeCtx,
              textureCtx,
              browCtx,
              layers,
              getLayerOrderSnapshot(),
              colorInput.value,
              eyeX,
              eyeY,
              eyeScaleX,
              eyeScaleY,
              eyeRotationDeg,
              eyeStyle,
              browStyle,
              editorFacing,
              browOffsetX,
              browOffsetY,
              browScaleX,
              browScaleY,
              browRotationDeg,
              bloodColorInput.value,
              currentPresetId,
              coreImageShape !== null,
              serializedCollisionShapes,
              exportBaseWidth,
              exportBaseHeight,
              exportReferenceWidth,
              exportReferenceHeight
            )
            if (builtProfile && hasAnyBoneData()) {
              builtProfile.boneSegments = segs
            }
          }
          if (builtProfile && canBuildFromSkeleton) {
            builtProfile.skeletalMode = true
            builtProfile.boneSegments = segs
            // Generate a static composite of bone shapes for preview/thumbnail
            const skelComp = (() => {
              const tc = document.createElement('canvas')
              tc.width = DRAW_WORLD_SIZE
              tc.height = DRAW_WORLD_SIZE
              const tctx = tc.getContext('2d')
              if (!tctx) return null
              for (const p of BONE_PARTS_ORDERED) {
                const bl = layers.find((l) => l.bonePart === p)
                if (bl?.canvas) tctx.drawImage(bl.canvas, 0, 0)
              }
              const b = this.readAlphaBounds(tctx, DRAW_WORLD_SIZE)
              if (!b) return null
              const du = this.cropCanvasDataUrl(
                tc,
                b.minX,
                b.minY,
                b.maxX + 1,
                b.maxY + 1
              )
              if (!du) return null
              return {
                dataUrl: du,
                cx: b.minX + (b.maxX + 1 - b.minX) * 0.5,
                cy: b.minY + (b.maxY + 1 - b.minY) * 0.5,
                w: b.maxX + 1 - b.minX,
                h: b.maxY + 1 - b.minY,
              }
            })()
            if (skelComp) {
              const geometry = deriveSkeletalBodyGeometry(segs)
              const referenceWidth = Math.max(
                1,
                geometry?.bounds.width ?? skelComp.w
              )
              const referenceHeight = Math.max(
                1,
                geometry?.bounds.height ?? skelComp.h
              )
              const referenceCenterX = geometry?.centerX ?? skelComp.cx
              const referenceCenterY = geometry?.centerY ?? skelComp.cy
              builtProfile.skeletalSurfaceDataUrl = skelComp.dataUrl
              builtProfile.skeletalSurfaceOffsetX =
                Math.round(
                  ((skelComp.cx - referenceCenterX) / referenceWidth) * 1000
                ) / 1000
              builtProfile.skeletalSurfaceOffsetY =
                Math.round(
                  ((skelComp.cy - referenceCenterY) / referenceHeight) * 1000
                ) / 1000
              builtProfile.skeletalSurfaceWidth =
                Math.round((skelComp.w / referenceWidth) * 1000) / 1000
              builtProfile.skeletalSurfaceHeight =
                Math.round((skelComp.h / referenceHeight) * 1000) / 1000
            }
          }
          resolve(finish(builtProfile))
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
    size: number,
    alphaThreshold = MASK_ALPHA_THRESHOLD
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
        if (imageData[index * 4 + 3] < alphaThreshold) {
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
    maskCtx: CanvasRenderingContext2D,
    alphaThreshold = MASK_ALPHA_THRESHOLD
  ): number[] | null {
    const maskFill = this.readMaskFill(maskCtx, DRAW_WORLD_SIZE, alphaThreshold)
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

  private buildSkeletalProfile(
    boneSegments: readonly BoneSegment[],
    color: string,
    bloodColor: string,
    exportBaseWidth: number,
    exportBaseHeight: number,
    presetId: EditorCharacterBodyPresetId
  ): MapCharacterBodyProfile | null {
    const geometry = deriveSkeletalBodyGeometry(boneSegments)
    if (!geometry) {
      return null
    }
    return {
      points: geometry.points,
      collisionShapes:
        geometry.collisionShapes && geometry.collisionShapes.length > 0
          ? geometry.collisionShapes
          : undefined,
      presetId: presetId !== CUSTOM_BODY_PRESET_ID ? presetId : undefined,
      width: Math.max(0.01, Math.round(exportBaseWidth * 1000) / 1000),
      height: Math.max(0.01, Math.round(exportBaseHeight * 1000) / 1000),
      color,
      bloodColor,
      skeletalMode: true,
      boneSegments: boneSegments.slice(),
      surfaceDataUrl: undefined,
      textureDataUrl: undefined,
      layers: undefined,
      layerOrder: undefined,
      surfaceOffsetX: undefined,
      surfaceOffsetY: undefined,
      surfaceWidth: undefined,
      surfaceHeight: undefined,
      embeddedEye: undefined,
    }
  }

  private buildProfile(
    maskCtx: CanvasRenderingContext2D,
    shapeCtx: CanvasRenderingContext2D,
    textureCtx: CanvasRenderingContext2D,
    browCtx: CanvasRenderingContext2D,
    layers: EditorBodyLayer[],
    layerOrder: number[],
    color: string,
    eyeX: number,
    eyeY: number,
    eyeScaleX: number,
    eyeScaleY: number,
    eyeRotationDeg: number,
    eyeStyle: MapCharacterBodyEyeStyle,
    browStyle: MapCharacterBodyBrowStyle,
    editorFacing: number,
    browOffsetX: number,
    browOffsetY: number,
    browScaleX: number,
    browScaleY: number,
    browRotationDeg: number,
    bloodColor: string,
    presetId: EditorCharacterBodyPresetId,
    usePureImageSurface: boolean,
    collisionShapes: MapCharacterBodyCollisionShape[],
    exportBaseWidth: number,
    exportBaseHeight: number,
    exportReferenceWidth: number,
    exportReferenceHeight: number
  ): MapCharacterBodyProfile | null {
    const workCtx = this.workCanvas.getContext('2d')
    if (!workCtx) {
      return null
    }
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

    const coreCenterX = Math.round((maskFill.minX + maskFill.maxX) * 0.5)
    const coreCenterY = Math.round((maskFill.minY + maskFill.maxY) * 0.5)
    const centered = this.centerLoop(loop, coreCenterX, coreCenterY)
    const canonicalCentered =
      editorFacing < 0 ? this.mirrorLocalPoints(centered) : centered
    const simplified = this.limitEditorLoopPoints(
      canonicalCentered,
      MAX_PROFILE_POINTS
    )
    if (simplified.length < 6) {
      return null
    }
    const surfaceBounds = usePureImageSurface
      ? {
          minX: maskFill.minX,
          minY: maskFill.minY,
          maxX: maskFill.maxX,
          maxY: maskFill.maxY,
        }
      : this.drawMergedSurface(
          workCtx,
          shapeCtx,
          textureCtx,
          browCtx,
          layers,
          coreCenterX,
          coreCenterY,
          eyeX,
          eyeY,
          eyeScaleX,
          eyeScaleY,
          eyeRotationDeg,
          eyeStyle,
          browStyle,
          editorFacing,
          browOffsetX,
          browOffsetY,
          browScaleX,
          browScaleY,
          browRotationDeg
        )
    const maskWidthPx = maskFill.maxX + 1 - maskFill.minX
    const maskHeightPx = maskFill.maxY + 1 - maskFill.minY
    const scaleX = exportBaseWidth / Math.max(1, exportReferenceWidth)
    const scaleY = exportBaseHeight / Math.max(1, exportReferenceHeight)
    const uniformScale =
      scaleX > 0 && scaleY > 0
        ? (scaleX + scaleY) * 0.5
        : scaleX > 0
          ? scaleX
          : scaleY
    const width = Math.max(
      0.01,
      Math.round(maskWidthPx * uniformScale * 1000) / 1000
    )
    const height = Math.max(
      0.01,
      Math.round(maskHeightPx * uniformScale * 1000) / 1000
    )

    const textureDataUrl = usePureImageSurface
      ? null
      : this.buildSurfaceDataUrl(
          shapeCtx,
          textureCtx,
          maskFill.minX,
          maskFill.minY,
          maskFill.maxX + 1,
          maskFill.maxY + 1,
          editorFacing < 0
        )
    const surfaceDataUrl = usePureImageSurface
      ? this.buildSurfaceDataUrl(
          shapeCtx,
          textureCtx,
          maskFill.minX,
          maskFill.minY,
          maskFill.maxX + 1,
          maskFill.maxY + 1,
          editorFacing < 0
        )
      : surfaceBounds
        ? this.cropCanvasDataUrl(
            this.workCanvas,
            surfaceBounds.minX,
            surfaceBounds.minY,
            surfaceBounds.maxX + 1,
            surfaceBounds.maxY + 1,
            editorFacing < 0
          )
        : textureDataUrl
    const serializedLayers = this.serializeVisualLayers(
      layers,
      coreCenterX,
      coreCenterY,
      editorFacing
    )

    return {
      points: simplified,
      collisionShapes: collisionShapes.length > 0 ? collisionShapes : undefined,
      presetId: presetId !== CUSTOM_BODY_PRESET_ID ? presetId : undefined,
      width,
      height,
      color: usePureImageSurface ? TRANSPARENT_BODY_COLOR : color,
      bloodColor,
      eyeX: Math.round(eyeX * editorFacing * 1000) / 1000,
      eyeY: Math.round(eyeY * 1000) / 1000,
      eyeScaleX:
        Math.abs(eyeScaleX - DEFAULT_CHARACTER_EYE_SCALE) > 0.001
          ? Math.round(eyeScaleX * 1000) / 1000
          : undefined,
      eyeScaleY:
        Math.abs(eyeScaleY - DEFAULT_CHARACTER_EYE_SCALE) > 0.001
          ? Math.round(eyeScaleY * 1000) / 1000
          : undefined,
      eyeRotationDeg:
        eyeRotationDeg !== DEFAULT_CHARACTER_EYE_ROTATION_DEG
          ? eyeRotationDeg * editorFacing
          : undefined,
      eyeStyle: eyeStyle !== DEFAULT_CHARACTER_EYE_STYLE ? eyeStyle : undefined,
      browStyle:
        browStyle !== DEFAULT_CHARACTER_BROW_STYLE ? browStyle : undefined,
      browOffsetX:
        browOffsetX !== DEFAULT_CHARACTER_BROW_OFFSET_X
          ? Math.round(browOffsetX * editorFacing * 1000) / 1000
          : undefined,
      browOffsetY:
        browOffsetY !== DEFAULT_CHARACTER_BROW_OFFSET_Y
          ? browOffsetY
          : undefined,
      browScaleX:
        Math.abs(browScaleX - DEFAULT_CHARACTER_BROW_SCALE) > 0.001
          ? Math.round(browScaleX * 1000) / 1000
          : undefined,
      browScaleY:
        Math.abs(browScaleY - DEFAULT_CHARACTER_BROW_SCALE) > 0.001
          ? Math.round(browScaleY * 1000) / 1000
          : undefined,
      browRotationDeg:
        browRotationDeg !== DEFAULT_CHARACTER_BROW_ROTATION_DEG
          ? browRotationDeg * editorFacing
          : undefined,
      embeddedEye: !textureDataUrl && !usePureImageSurface && !!surfaceDataUrl,
      surfaceOffsetX: surfaceBounds
        ? Math.round(
            ((surfaceBounds.minX + surfaceBounds.maxX) * 0.5 - coreCenterX) *
              editorFacing *
              1000
          ) / 1000
        : undefined,
      surfaceOffsetY: surfaceBounds
        ? Math.round(
            ((surfaceBounds.minY + surfaceBounds.maxY) * 0.5 - coreCenterY) *
              1000
          ) / 1000
        : undefined,
      surfaceWidth: surfaceBounds
        ? surfaceBounds.maxX + 1 - surfaceBounds.minX
        : undefined,
      surfaceHeight: surfaceBounds
        ? surfaceBounds.maxY + 1 - surfaceBounds.minY
        : undefined,
      layerOrder: serializedLayers.length > 0 ? layerOrder : undefined,
      layers: serializedLayers.length > 0 ? serializedLayers : undefined,
      surfaceDataUrl: surfaceDataUrl ?? undefined,
      textureDataUrl: textureDataUrl ?? undefined,
    }
  }

  private isBodyPresetId(
    value: string | undefined
  ): value is MapCharacterBodyPresetId {
    if (!value) {
      return false
    }
    for (let i = 0; i < BODY_PRESET_IDS.length; i++) {
      if (BODY_PRESET_IDS[i] === value) {
        return true
      }
    }
    return false
  }

  private getBodyPresetConfig(
    presetId: MapCharacterBodyPresetId
  ): BodyPresetConfig {
    if (presetId === 'banana') {
      return {
        color: TRANSPARENT_BODY_COLOR,
        bloodColor: '#8a5424',
        eyeX: 0,
        eyeY: -5,
        points: BANANA_PRESET_POINTS,
        imageSrc: BANANA_PRESET_IMAGE_SRC,
        mirrorImageX: true,
      }
    }
    if (presetId === 'kiwano') {
      return {
        color: TRANSPARENT_BODY_COLOR,
        bloodColor: '#8e5a17',
        eyeX: 20,
        eyeY: -2,
        points: KIWANO_PRESET_POINTS,
        imageSrc: KIWANO_PRESET_IMAGE_SRC,
        mirrorImageX: true,
        imageTargetHeight: 156,
      }
    }
    if (presetId === 'pandaAnt') {
      return {
        color: TRANSPARENT_BODY_COLOR,
        bloodColor: '#2e241f',
        eyeX: 34,
        eyeY: -8,
        points: PANDA_ANT_PRESET_POINTS,
        imageSrc: PANDA_ANT_PRESET_IMAGE_SRC,
        mirrorImageX: true,
        imageTargetHeight: 120,
      }
    }
    if (presetId === 'pineapple') {
      return {
        color: TRANSPARENT_BODY_COLOR,
        bloodColor: '#7d4a18',
        eyeX: 0,
        eyeY: 52,
        points: PINEAPPLE_PRESET_POINTS,
        imageSrc: PINEAPPLE_PRESET_IMAGE_SRC,
        imageTargetHeight: 220,
      }
    }
    if (presetId === 'tomato') {
      return {
        color: TRANSPARENT_BODY_COLOR,
        bloodColor: '#8f1414',
        eyeX: 0,
        eyeY: 3,
        points: TOMATO_PRESET_POINTS,
        imageSrc: TOMATO_PRESET_IMAGE_SRC,
        mirrorImageX: true,
      }
    }
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#9b2e22',
      eyeX: 0,
      eyeY: 1,
      points: WATERMELON_PRESET_POINTS,
      imageSrc: WATERMELON_PRESET_IMAGE_SRC,
      mirrorImageX: true,
    }
  }

  private getProfilePointWidth(points: readonly number[]): number {
    if (points.length < 2) {
      return 0
    }
    let minX = points[0]
    let maxX = points[0]
    for (let i = 2; i < points.length; i += 2) {
      const pointX = points[i]
      if (pointX < minX) {
        minX = pointX
      }
      if (pointX > maxX) {
        maxX = pointX
      }
    }
    return Math.max(1, maxX - minX)
  }

  private getFacingPreferredEyeX(width: number, facing: number): number {
    const offset = Math.max(1, Math.floor((Math.max(1, width) * 3 + 5) / 10))
    return facing < 0 ? -offset : offset
  }

  private getPresetPreferredEyeX(
    preset: BodyPresetConfig,
    contourWidth: number,
    facing: number
  ): number {
    if (preset.eyeX !== 0) {
      return preset.eyeX * facing
    }
    return this.getFacingPreferredEyeX(contourWidth, facing)
  }

  private shouldMirrorPresetImage(
    preset: BodyPresetConfig,
    editorFacing: number
  ): boolean {
    return editorFacing < 0 !== (preset.mirrorImageX === true)
  }

  private getBodyPresetImageSrc(
    presetId: EditorCharacterBodyPresetId | undefined
  ): string | null {
    if (!this.isBodyPresetId(presetId)) {
      return null
    }
    const imageSrc = this.getBodyPresetConfig(presetId).imageSrc
    return typeof imageSrc === 'string' && imageSrc.length > 0 ? imageSrc : null
  }

  private mirrorLocalPoints(points: number[]): number[] {
    const mirrored = new Array<number>(points.length)
    for (let i = 0; i < points.length; i += 2) {
      mirrored[i] = -points[i]
      mirrored[i + 1] = points[i + 1]
    }
    return mirrored
  }

  private buildPresetContourPoints(
    points: readonly number[],
    facing: number
  ): number[] {
    const contourPoints = new Array<number>(points.length)
    for (let i = 0; i < points.length; i += 2) {
      contourPoints[i] = DRAW_WORLD_HALF + points[i] * facing
      contourPoints[i + 1] = DRAW_WORLD_HALF + points[i + 1]
    }
    return contourPoints
  }

  private drawImageToRect(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    mirrorHorizontally: boolean
  ) {
    if (!mirrorHorizontally) {
      ctx.drawImage(image, x, y, width, height)
      return
    }
    ctx.save()
    ctx.translate(x + width, y)
    ctx.scale(-1, 1)
    ctx.drawImage(image, 0, 0, width, height)
    ctx.restore()
  }

  private fillPresetPolygon(
    ctx: CanvasRenderingContext2D,
    points: readonly number[]
  ) {
    if (points.length < 6) {
      return
    }
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 2) {
      ctx.lineTo(points[i], points[i + 1])
    }
    ctx.closePath()
    ctx.fill()
  }

  private drawBodyPresetTexture(
    ctx: CanvasRenderingContext2D,
    presetId: MapCharacterBodyPresetId,
    bounds: BodyPresetBounds
  ) {
    const bandWidth = Math.max(6, Math.round(bounds.width / 10))
    const stripeWidth = Math.max(8, Math.round(bounds.width / 9))
    const stripeThinWidth = Math.max(4, Math.round(bounds.width / 16))
    const topBandY = bounds.minY + Math.round(bounds.height / 3)
    if (presetId === 'banana') {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(196,160,38,0.55)'
      ctx.lineWidth = bandWidth
      for (let i = -1; i <= 1; i++) {
        const offsetY = i * Math.max(10, Math.round(bounds.height / 7))
        ctx.beginPath()
        ctx.moveTo(bounds.minX + 14, bounds.centerY + offsetY + 10)
        ctx.quadraticCurveTo(
          bounds.centerX,
          bounds.centerY + offsetY - 14,
          bounds.maxX - 10,
          bounds.centerY + offsetY - 4
        )
        ctx.stroke()
      }
      ctx.fillStyle = '#7b4a1f'
      ctx.beginPath()
      ctx.arc(bounds.minX + 12, bounds.centerY + 16, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(bounds.maxX - 8, bounds.centerY - 6, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }
    if (presetId === 'pineapple') {
      ctx.save()
      ctx.strokeStyle = 'rgba(110,72,18,0.55)'
      ctx.lineWidth = Math.max(4, Math.round(bounds.width / 18))
      for (let x = bounds.minX - bounds.height; x <= bounds.maxX; x += 20) {
        ctx.beginPath()
        ctx.moveTo(x, topBandY)
        ctx.lineTo(x + bounds.height, bounds.maxY)
        ctx.stroke()
      }
      for (let x = bounds.minX; x <= bounds.maxX + bounds.height; x += 20) {
        ctx.beginPath()
        ctx.moveTo(x, topBandY)
        ctx.lineTo(x - bounds.height, bounds.maxY)
        ctx.stroke()
      }
      ctx.fillStyle = '#4e8d2c'
      this.fillPresetPolygon(ctx, [
        bounds.centerX - 22,
        bounds.minY + 18,
        bounds.centerX - 6,
        bounds.minY - 30,
        bounds.centerX + 2,
        bounds.minY + 10,
      ])
      this.fillPresetPolygon(ctx, [
        bounds.centerX - 6,
        bounds.minY + 12,
        bounds.centerX + 10,
        bounds.minY - 40,
        bounds.centerX + 18,
        bounds.minY + 10,
      ])
      this.fillPresetPolygon(ctx, [
        bounds.centerX + 8,
        bounds.minY + 18,
        bounds.centerX + 30,
        bounds.minY - 18,
        bounds.centerX + 20,
        bounds.minY + 20,
      ])
      ctx.restore()
      return
    }
    if (presetId === 'tomato') {
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = 'rgba(133,22,18,0.3)'
      ctx.lineWidth = stripeWidth
      for (let i = -1; i <= 1; i++) {
        const offsetX = i * Math.max(12, Math.round(bounds.width / 5))
        ctx.beginPath()
        ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 6)
        ctx.quadraticCurveTo(
          bounds.centerX + offsetX,
          bounds.centerY,
          bounds.centerX + offsetX,
          bounds.maxY - 10
        )
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,216,216,0.2)'
      ctx.beginPath()
      ctx.arc(
        bounds.centerX - Math.round(bounds.width / 5),
        bounds.centerY - Math.round(bounds.height / 6),
        Math.max(8, Math.round(bounds.width / 8)),
        0,
        Math.PI * 2
      )
      ctx.fill()
      ctx.fillStyle = '#4f972e'
      this.fillPresetPolygon(ctx, [
        bounds.centerX - 6,
        bounds.minY + 8,
        bounds.centerX - 26,
        bounds.minY - 2,
        bounds.centerX - 10,
        bounds.minY + 20,
      ])
      this.fillPresetPolygon(ctx, [
        bounds.centerX + 2,
        bounds.minY + 4,
        bounds.centerX,
        bounds.minY - 18,
        bounds.centerX + 8,
        bounds.minY + 16,
      ])
      this.fillPresetPolygon(ctx, [
        bounds.centerX + 8,
        bounds.minY + 8,
        bounds.centerX + 28,
        bounds.minY - 2,
        bounds.centerX + 12,
        bounds.minY + 20,
      ])
      ctx.restore()
      return
    }
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(35,104,35,0.46)'
    ctx.lineWidth = stripeWidth
    for (let i = -2; i <= 2; i++) {
      const offsetX = i * Math.max(12, Math.round(bounds.width / 5))
      ctx.beginPath()
      ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 4)
      ctx.quadraticCurveTo(
        bounds.centerX + offsetX + (i % 2 === 0 ? 8 : -8),
        bounds.centerY,
        bounds.centerX + offsetX,
        bounds.maxY - 6
      )
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(158,212,118,0.4)'
    ctx.lineWidth = stripeThinWidth
    for (let i = -1; i <= 1; i++) {
      const offsetX = i * Math.max(16, Math.round(bounds.width / 4))
      ctx.beginPath()
      ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 8)
      ctx.quadraticCurveTo(
        bounds.centerX + offsetX - 6,
        bounds.centerY,
        bounds.centerX + offsetX,
        bounds.maxY - 8
      )
      ctx.stroke()
    }
    ctx.restore()
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
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    mirrorHorizontally: boolean
  ): string | null {
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const outputCtx = this.getOutputContext(width, height)
    if (!outputCtx) {
      return null
    }
    outputCtx.clearRect(0, 0, width, height)
    if (mirrorHorizontally) {
      outputCtx.save()
      outputCtx.translate(width, 0)
      outputCtx.scale(-1, 1)
    }
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
    if (mirrorHorizontally) {
      outputCtx.restore()
    }
    outputCtx.globalCompositeOperation = 'source-over'
    return this.readCroppedCanvasDataUrl(outputCtx, width, height)
  }

  private drawMergedSurface(
    compositeCtx: CanvasRenderingContext2D,
    shapeCtx: CanvasRenderingContext2D,
    textureCtx: CanvasRenderingContext2D,
    browCtx: CanvasRenderingContext2D,
    layers: EditorBodyLayer[],
    coreCenterX: number,
    coreCenterY: number,
    eyeX: number,
    eyeY: number,
    eyeScaleX: number,
    eyeScaleY: number,
    eyeRotationDeg: number,
    eyeStyle: MapCharacterBodyEyeStyle,
    browStyle: MapCharacterBodyBrowStyle,
    editorFacing: number,
    browOffsetX: number,
    browOffsetY: number,
    browScaleX: number,
    browScaleY: number,
    browRotationDeg: number
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let mergedBounds = this.readAlphaBounds(shapeCtx, DRAW_WORLD_SIZE)
    compositeCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
    compositeCtx.drawImage(shapeCtx.canvas, 0, 0)
    compositeCtx.save()
    compositeCtx.globalCompositeOperation = 'source-atop'
    compositeCtx.drawImage(textureCtx.canvas, 0, 0)
    compositeCtx.restore()
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (layer.kind === 'core') {
        continue
      }
      if (layer.kind === 'eye') {
        const eyeGeometry = getCharacterEyeGeometry(
          coreCenterX + eyeX,
          coreCenterY + eyeY,
          editorFacing,
          eyeScaleX,
          eyeScaleY,
          eyeStyle,
          eyeRotationDeg
        )
        drawCharacterEyeGeometry(compositeCtx, eyeGeometry, '#17120e')
        const eyeBounds = getCharacterEyeBounds(eyeGeometry)
        const eyeMinX = eyeBounds.minX
        const eyeMinY = eyeBounds.minY
        const eyeMaxX = eyeBounds.maxX
        const eyeMaxY = eyeBounds.maxY
        if (!mergedBounds) {
          mergedBounds = {
            minX: eyeMinX,
            minY: eyeMinY,
            maxX: eyeMaxX,
            maxY: eyeMaxY,
          }
        } else {
          if (eyeMinX < mergedBounds.minX) {
            mergedBounds.minX = eyeMinX
          }
          if (eyeMinY < mergedBounds.minY) {
            mergedBounds.minY = eyeMinY
          }
          if (eyeMaxX > mergedBounds.maxX) {
            mergedBounds.maxX = eyeMaxX
          }
          if (eyeMaxY > mergedBounds.maxY) {
            mergedBounds.maxY = eyeMaxY
          }
        }
        continue
      }
      if (layer.kind === 'brow') {
        if (browStyle !== 'custom' && browStyle !== 'none') {
          const eyeGeometry = getCharacterEyeGeometry(
            coreCenterX + eyeX,
            coreCenterY + eyeY,
            editorFacing,
            eyeScaleX,
            eyeScaleY,
            eyeStyle,
            eyeRotationDeg
          )
          const browGeometry = getCharacterBrowGeometry(
            eyeGeometry,
            browStyle,
            browOffsetX,
            browOffsetY,
            browScaleX,
            browScaleY,
            browRotationDeg
          )
          if (browGeometry) {
            drawCharacterBrowGeometry(compositeCtx, browGeometry, '#231711')
            const browBounds = getCharacterBrowBounds(browGeometry)
            const browMinX = browBounds.minX
            const browMaxX = browBounds.maxX
            const browMinY = browBounds.minY
            const browMaxY = browBounds.maxY
            if (!mergedBounds) {
              mergedBounds = {
                minX: browMinX,
                minY: browMinY,
                maxX: browMaxX,
                maxY: browMaxY,
              }
            } else {
              if (browMinX < mergedBounds.minX) mergedBounds.minX = browMinX
              if (browMinY < mergedBounds.minY) mergedBounds.minY = browMinY
              if (browMaxX > mergedBounds.maxX) mergedBounds.maxX = browMaxX
              if (browMaxY > mergedBounds.maxY) mergedBounds.maxY = browMaxY
            }
          }
        }
        compositeCtx.drawImage(browCtx.canvas, 0, 0)
        const browBounds = layer.boundsDirty
          ? this.readAlphaBounds(browCtx, DRAW_WORLD_SIZE)
          : layer.bounds
        if (browBounds) {
          if (!mergedBounds) {
            mergedBounds = {
              minX: browBounds.minX,
              minY: browBounds.minY,
              maxX: browBounds.maxX,
              maxY: browBounds.maxY,
            }
          } else {
            if (browBounds.minX < mergedBounds.minX) {
              mergedBounds.minX = browBounds.minX
            }
            if (browBounds.minY < mergedBounds.minY) {
              mergedBounds.minY = browBounds.minY
            }
            if (browBounds.maxX > mergedBounds.maxX) {
              mergedBounds.maxX = browBounds.maxX
            }
            if (browBounds.maxY > mergedBounds.maxY) {
              mergedBounds.maxY = browBounds.maxY
            }
          }
        }
        continue
      }
      if (layer.canvas) {
        compositeCtx.drawImage(layer.canvas, 0, 0)
        const layerBounds = layer.boundsDirty
          ? this.readAlphaBounds(
              layer.ctx as CanvasRenderingContext2D,
              DRAW_WORLD_SIZE
            )
          : layer.bounds
        if (layerBounds) {
          if (!mergedBounds) {
            mergedBounds = {
              minX: layerBounds.minX,
              minY: layerBounds.minY,
              maxX: layerBounds.maxX,
              maxY: layerBounds.maxY,
            }
          } else {
            if (layerBounds.minX < mergedBounds.minX) {
              mergedBounds.minX = layerBounds.minX
            }
            if (layerBounds.minY < mergedBounds.minY) {
              mergedBounds.minY = layerBounds.minY
            }
            if (layerBounds.maxX > mergedBounds.maxX) {
              mergedBounds.maxX = layerBounds.maxX
            }
            if (layerBounds.maxY > mergedBounds.maxY) {
              mergedBounds.maxY = layerBounds.maxY
            }
          }
        }
      }
    }
    return mergedBounds
  }

  private readAlphaBounds(
    ctx: CanvasRenderingContext2D,
    size: number
  ): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const imageData = ctx.getImageData(0, 0, size, size).data
    let minX = size
    let minY = size
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < size; y++) {
      const rowOffset = y * size
      for (let x = 0; x < size; x++) {
        if (imageData[(rowOffset + x) * 4 + 3] < MASK_ALPHA_THRESHOLD) {
          continue
        }
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null
  }

  private readCroppedCanvasDataUrl(
    outputCtx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): string | null {
    const alpha = outputCtx.getImageData(0, 0, width, height).data
    for (let i = 3; i < alpha.length; i += 4) {
      if (alpha[i] >= MASK_ALPHA_THRESHOLD && this.outputCanvas) {
        return this.outputCanvas.toDataURL('image/png')
      }
    }
    return null
  }

  private cropCanvasDataUrl(
    source: CanvasImageSource,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    mirrorHorizontally = false
  ): string | null {
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const outputCtx = this.getOutputContext(width, height)
    if (!outputCtx) {
      return null
    }
    outputCtx.clearRect(0, 0, width, height)
    if (mirrorHorizontally) {
      outputCtx.save()
      outputCtx.translate(width, 0)
      outputCtx.scale(-1, 1)
    }
    outputCtx.drawImage(source, minX, minY, width, height, 0, 0, width, height)
    if (mirrorHorizontally) {
      outputCtx.restore()
    }
    return this.readCroppedCanvasDataUrl(outputCtx, width, height)
  }

  private serializeVisualLayers(
    layers: EditorBodyLayer[],
    coreCenterX: number,
    coreCenterY: number,
    editorFacing: number
  ): MapCharacterBodyVisualLayer[] {
    const serialized: MapCharacterBodyVisualLayer[] = []
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (
        (layer.kind !== 'brow' && layer.kind !== 'paint') ||
        !layer.ctx ||
        !layer.canvas
      ) {
        continue
      }
      const bounds = layer.boundsDirty
        ? this.readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
        : layer.bounds
      if (!bounds) {
        continue
      }
      const dataUrl = this.cropCanvasDataUrl(
        layer.canvas,
        bounds.minX,
        bounds.minY,
        bounds.maxX + 1,
        bounds.maxY + 1,
        editorFacing < 0
      )
      if (!dataUrl) {
        continue
      }
      serialized.push({
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        offsetX:
          Math.round(
            ((bounds.minX + bounds.maxX) * 0.5 - coreCenterX) *
              editorFacing *
              1000
          ) / 1000,
        offsetY:
          Math.round(((bounds.minY + bounds.maxY) * 0.5 - coreCenterY) * 1000) /
          1000,
        width: bounds.maxX + 1 - bounds.minX,
        height: bounds.maxY + 1 - bounds.minY,
        dataUrl,
      })
    }
    return serialized
  }
}
