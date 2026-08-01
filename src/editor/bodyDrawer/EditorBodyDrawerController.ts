import { localizer } from '../../Localizer'
import {
  buildCharacterBodyCollisionOutlineLoopsFromLocalPoints,
  buildCollisionOutlineLoopsFromShapes,
} from '../../characterBodyCollision'
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
  clampCharacterEyeCenterToBodyPoints,
  clampCharacterEyeOffsetToCircle,
  clampCharacterEyeScale,
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
} from '../../characterBodyProfile'
import type {
  BonePart,
  BoneSegment,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyCollisionShape,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyPresetId,
  MapCharacterBodyProfile,
} from '../../editorMapTypes'
import {
  SKELETAL_ANIMATION_NAMES,
  type SkeletalAnimationName,
} from '../../skeletalAnimation'
import {
  buildDefaultSkeletalBoneBoundary,
  buildSkeletalSurfaceSnapshot,
} from '../../skeletalBodyProfile'
import { showBodyDrawerAnimationPreview } from './EditorBodyDrawerAnimationPreview'
import { renderEditorBodyDrawerBoneList } from './EditorBodyDrawerBoneList'
import {
  BONE_DEFAULT_POSITIONS,
  BONE_PARTS_ORDERED,
  createBoneLayer,
  findBoneLayer,
  getBoneLayerId,
} from './EditorBodyDrawerBones'
import {
  applyCanvasSnapshot,
  captureCanvasSnapshot,
  cloneBounds,
  createBoundsFromRect,
  createEditorCanvasState,
  drawRotatedCanvasSnapshot,
  drawScaledCanvasSnapshot,
  expandBoundsForStroke,
  translateBounds,
} from './EditorBodyDrawerCanvas'
import {
  applyCollisionShapeRotate as applyCollisionShapeRotation,
  applyCollisionShapeScale as applyCollisionShapeScaleToShape,
  assignCollisionShape,
  beginCollisionShapeRotate,
  beginCollisionShapeScale,
  createCollisionShapeFromDrag as buildCollisionShapeFromDrag,
  buildMapCollisionShapeFromEditor,
  cloneCollisionShape,
  copyCollisionShapesSnapshot as copyCollisionShapeList,
  createEditorCollisionShapeFromMap,
  getCollisionShapeAtPoint as findCollisionShapeAtPoint,
  getCollisionShapeBounds,
  getCollisionShapeRotationHandleAtPoint as getCollisionShapeRotationHandleHit,
  getCollisionShapeSelectionHandleAtPoint as getCollisionShapeSelectionHandleHit,
  getNextCollisionShapeId,
  serializeCollisionShapes as serializeCollisionShapeList,
  traceEditorCollisionShape,
} from './EditorBodyDrawerCollision'
import {
  buildDefaultContourPoints as buildDefaultContourPointList,
  getContourPointCount as getContourArrayPointCount,
  getContourBounds as getContourPointBounds,
  getNearestContourEdge as getNearestContourEdgeHit,
  getNearestContourPointIndex as getNearestContourPointIndexInList,
  getContourHitDistanceSq as getScaledContourHitDistanceSq,
  rotateContourPoints as rotateContourPointList,
  scaleContourPointsFromBounds as scaleContourPointListFromBounds,
  traceContourPath as traceContourPointPath,
} from './EditorBodyDrawerContour'
import {
  chooseBodyDrawerLayerStyle,
  confirmDeleteBodyDrawerLayer,
} from './EditorBodyDrawerDialogs'
import {
  hidePopupMenu,
  placePopupMenuWithin,
  setPopupButtonEnabled,
  setSidebarTabState,
} from './EditorBodyDrawerDom'
import {
  buildEditorContourFromMask,
  readAlphaBounds,
} from './EditorBodyDrawerGeometry'
import { EditorCharacterBodyDrawerHistoryManager } from './EditorBodyDrawerHistory'
import {
  clearEditorBodyDrawerLayerDropPreviewStyle,
  focusEditorBodyDrawerLayerRename,
  getEditorBodyDrawerLayerDropPreview,
  renderEditorBodyDrawerLayerList,
  setEditorBodyDrawerLayerDropPreviewStyle,
} from './EditorBodyDrawerLayerList'
import {
  EditorBodyLayerStore,
  canDeleteLayer,
  canDuplicateLayer,
  canStyleLayer,
  isLayerMovable,
  isLayerRotatable,
  isLayerScalable,
  sanitizeLayerName,
} from './EditorBodyDrawerLayers'
import { createEditorBodyDrawerLayout } from './EditorBodyDrawerLayout'
import {
  buildPresetContourPoints,
  drawBodyPresetTexture,
  drawImageToRect,
  getBodyPresetConfig,
  getBodyPresetImageSrc,
  getPresetPreferredEyeX,
  getProfilePointWidth,
  isBodyPresetId,
  loadImage,
  shouldMirrorPresetImage,
} from './EditorBodyDrawerPresets'
import { EditorBodyDrawerRenderer } from './EditorBodyDrawerRenderer'
import {
  buildProfile,
  buildSkeletalProfile,
  cropCanvasDataUrl,
} from './EditorBodyDrawerSurface'
import {
  getPointerAngleDeg,
  getRotationDeltaDeg,
  getScaledBoundsFromHandle,
  getSelectionHandleAtPoint,
  getSelectionHandleCenter,
  getSelectionRotationHandleAtPoint,
  normalizeRotationDeg,
} from './EditorBodyDrawerTransforms'
import type {
  BodyDrawMode,
  BodyPresetBounds,
  EditorBodyLayer,
  EditorBodyLayerSnapshot,
  EditorCanvasBounds,
  EditorCanvasSnapshot,
  EditorCharacterBodyDrawerHistorySnapshot,
  EditorCharacterBodyDrawerOptions,
  EditorCharacterBodyPresetId,
  EditorCollisionRotateSession,
  EditorCollisionScaleSession,
  EditorCollisionShape,
  EditorCollisionShapeKind,
  EditorRotationHandle,
  EditorSelectionHandle,
  EditorSelectionRotateSession,
  EditorSelectionScaleSession,
} from './EditorBodyDrawerTypes'
import {
  BROW_LAYER_ID,
  CANVAS_ZOOM_DEFAULT_PERCENT,
  CANVAS_ZOOM_MAX_PERCENT,
  CANVAS_ZOOM_MIN_PERCENT,
  CONTOUR_CURSOR_SIZE,
  CONTOUR_EDGE_SELECT_DISTANCE_SQ,
  CONTOUR_MIN_POINT_COUNT,
  CONTOUR_SELECT_DISTANCE_SQ,
  CORE_LAYER_ID,
  CUSTOM_BODY_PRESET_ID,
  DEFAULT_BODY_BLOOD_COLOR,
  DEFAULT_BRUSH_SIZE,
  DEFAULT_EDITOR_EYE_RADIUS,
  DISPLAY_SIZE,
  DRAWER_HISTORY_MAX_ENTRIES,
  DRAW_WORLD_HALF,
  DRAW_WORLD_SIZE,
  LEGACY_PROFILE_REFERENCE_SIZE,
  MASK_ALPHA_THRESHOLD,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  MIN_COLLISION_HALF_EXTENT,
  MIN_COLLISION_RADIUS,
  TRANSPARENT_BODY_COLOR,
} from './EditorBodyDrawerTypes'
import {
  clampBodyPoint,
  getCanvasVisibleWorldSize,
} from './EditorBodyDrawerViewport'

export class EditorBodyDrawerController {
  private _maskCanvas: HTMLCanvasElement
  private _shapeCanvas: HTMLCanvasElement
  private _textureCanvas: HTMLCanvasElement
  private _browCanvas: HTMLCanvasElement
  private _workCanvas: HTMLCanvasElement
  private _outputCanvas: HTMLCanvasElement | null = null

  constructor(
    maskCanvas: HTMLCanvasElement,
    shapeCanvas: HTMLCanvasElement,
    textureCanvas: HTMLCanvasElement,
    browCanvas: HTMLCanvasElement,
    workCanvas: HTMLCanvasElement
  ) {
    this._maskCanvas = maskCanvas
    this._shapeCanvas = shapeCanvas
    this._textureCanvas = textureCanvas
    this._browCanvas = browCanvas
    this._workCanvas = workCanvas
  }

  private _getOutputCanvas(): HTMLCanvasElement {
    if (!this._outputCanvas) {
      this._outputCanvas = document.createElement('canvas')
    }
    return this._outputCanvas
  }

  async run(
    options: EditorCharacterBodyDrawerOptions
  ): Promise<MapCharacterBodyProfile | null | undefined> {
    const viewport = document.getElementById('gameViewport')
    if (!(viewport instanceof HTMLElement)) {
      return undefined
    }

    const {
      modal,
      close,
      form,
      canvasWrap,
      drawCanvas,
      cursorEl,
      alertEl,
      zoomSlider,
      zoomValueText,
      tabBtnLayers,
      tabBtnBones,
      layerHeader,
      addLayerBtn,
      layerList,
      bonesPanel,
      boneList,
      bonePropPanel,
      animationPanel,
      animationList,
      boneLengthRow,
      boneWidthRow,
      contourMenu,
      addContourPointBtn,
      removeContourPointBtn,
      layerMenu,
      renameLayerBtn,
      styleLayerBtn,
      duplicateLayerBtn,
      deleteLayerBtn,
      presetSelect,
      contourBtn,
      selectBtn,
      collisionBtn,
      shapeBtn,
      fillBtn,
      eraseBtn,
      textureBtn,
      resetStaticBtn,
      resetSkeletalBtn,
      brushSlider,
      brushValueText,
      colorInput,
      bloodColorInput,
      confirmBtn,
      cancelBtn,
      collisionToolMenu,
      collisionCircleBtn,
      collisionEllipseBtn,
      collisionCapsuleBtn,
      collisionShapeMenu,
      deleteCollisionShapeBtn,
    } = createEditorBodyDrawerLayout(options)
    viewport.appendChild(modal)
    modal.focus({ preventScroll: true })

    const drawCtx = drawCanvas.getContext('2d')
    const maskCtx = this._maskCanvas.getContext('2d')
    const shapeCtx = this._shapeCanvas.getContext('2d')
    const textureCtx = this._textureCanvas.getContext('2d')
    const browCtx = this._browCanvas.getContext('2d')
    const workCtx = this._workCanvas.getContext('2d')
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

    const maskState = createEditorCanvasState(this._maskCanvas, maskCtx)
    const shapeState = createEditorCanvasState(this._shapeCanvas, shapeCtx)
    const textureState = createEditorCanvasState(
      this._textureCanvas,
      textureCtx
    )

    const defaultEyeStyle =
      options.defaultEyeStyle ?? DEFAULT_CHARACTER_EYE_STYLE

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
    let eyeStyle: MapCharacterBodyEyeStyle = defaultEyeStyle
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
    let selectedLayerId = CORE_LAYER_ID
    let activeSidebarTab: 'layers' | 'bones' = 'layers'
    let selectedBonePart: BonePart | null = null
    let selectedShapePart: BonePart | null = null
    let selectedBoundaryPart: BonePart | null = null
    let boneBoundaryBackup: EditorCollisionShape[] | null = null
    let skeletalModeEnabled = false
    let loadedBoneSegments = false
    const collapsedBonePartsSet = new Set<BonePart>()
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
    const layerStore = new EditorBodyLayerStore(
      this._browCanvas,
      browCtx,
      () => {
        if (browStyle === 'custom') {
          return undefined
        }
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
    )
    const layers = layerStore.layers
    const collisionShapes: EditorCollisionShape[] = []
    const resetBodyColor =
      typeof options.resetBodyColor === 'string' &&
      options.resetBodyColor.length > 0
        ? options.resetBodyColor
        : (options.initialColor ?? '#d6a86c')
    const resetBodyWidth =
      options.resetBodyWidth && options.resetBodyWidth > 0
        ? options.resetBodyWidth
        : options.defaultBodyWidth && options.defaultBodyWidth > 0
          ? options.defaultBodyWidth
          : 1
    const resetBodyHeight =
      options.resetBodyHeight && options.resetBodyHeight > 0
        ? options.resetBodyHeight
        : options.defaultBodyHeight && options.defaultBodyHeight > 0
          ? options.defaultBodyHeight
          : resetBodyWidth
    const sidebarTabElements = {
      tabBtnLayers,
      tabBtnBones,
      layerHeader,
      layerList,
      bonesPanel,
    }

    const switchSidebarTab = (tab: 'layers' | 'bones') => {
      if (tab === 'layers') {
        leaveBoneBoundaryMode()
        selectedBonePart = null
        selectedShapePart = null
        bonePropPanel.style.display = 'none'
        if (getSelectedLayer()?.kind === 'bone') {
          selectedLayerId = CORE_LAYER_ID
        }
        if (
          (mode === 'shape' || mode === 'erase') &&
          getSelectedLayer()?.kind === 'bone'
        ) {
          mode = contourClosed ? 'shape' : 'contour'
          selectedLayerId = CORE_LAYER_ID
        }
      } else {
        if (mode === 'collision' && selectedBoundaryPart === null) {
          mode = 'select'
        }
        ensureAllBoneLayers()
        for (let i = 0; i < layers.length; i++) {
          syncAutoBoneLayerShape(layers[i])
        }
      }
      activeSidebarTab = tab
      setSidebarTabState(sidebarTabElements, tab)
      renderAnimationList()
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

    const copyCollisionShapesSnapshot = (): EditorCollisionShape[] => {
      return copyCollisionShapeList(collisionShapes)
    }

    const invalidateCollisionPreview = () => {
      collisionPreviewDirty = true
    }

    const getDefaultBoneFillColor = (): string =>
      loadedBoneSegments ? colorInput.value : resetBodyColor

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
      nextCollisionShapeId = getNextCollisionShapeId(collisionShapes)
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

    const getLayerById = (layerId: number): EditorBodyLayer | null => {
      return layerStore.getLayerById(layerId)
    }

    const ensureLayerSurface = (layer: EditorBodyLayer): boolean => {
      return layerStore.ensureLayerSurface(layer)
    }

    const getSelectedLayer = (): EditorBodyLayer | null =>
      getLayerById(selectedLayerId)

    const ensureSelectedLayer = () => {
      selectedLayerId = layerStore.ensureSelectedLayer(selectedLayerId)
    }

    const getLayerOrderSnapshot = (): number[] => {
      return layerStore.getLayerOrderSnapshot()
    }

    const hideLayerMenu = () => {
      hidePopupMenu(layerMenu)
      layerMenuTargetId = -1
    }

    const hideCollisionToolMenu = () => {
      hidePopupMenu(collisionToolMenu)
    }

    const showPopupMenuAt = (
      menu: HTMLDivElement,
      clientX: number,
      clientY: number
    ) => {
      placePopupMenuWithin(menu, form, clientX, clientY)
    }

    const hideCollisionShapeMenu = () => {
      hidePopupMenu(collisionShapeMenu)
    }

    const beginLayerRename = (layerId: number) => {
      renamingLayerId = layerId
      renderLayerList()
      focusEditorBodyDrawerLayerRename(layerList, layerId)
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
      return layerStore.resolveLayerBounds(layer)
    }

    const captureLayerSnapshot = (
      layer: EditorBodyLayer
    ): EditorBodyLayerSnapshot | null => {
      return layerStore.captureLayerSnapshot(layer)
    }

    const buildDefaultLayers = () => {
      layerStore.buildDefaultLayers()
      ensureSelectedLayer()
    }

    const rebuildStaticLayersPreservingBones = () => {
      const boneLayers: EditorBodyLayer[] = []
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].kind === 'bone') {
          boneLayers.push(layers[i])
        }
      }
      layerStore.buildDefaultLayers()
      for (let i = 0; i < boneLayers.length; i++) {
        layers.push(boneLayers[i])
      }
      ensureSelectedLayer()
    }

    const appendPaintLayer = (name?: string): EditorBodyLayer => {
      return layerStore.appendPaintLayer(name)
    }

    const applyLayerOrder = (order: number[]) => {
      layerStore.applyLayerOrder(order)
    }

    const moveDisplayLayer = (
      dragLayerId: number,
      targetLayerId: number,
      insertAfter: boolean
    ): boolean => {
      return layerStore.moveDisplayLayer(
        dragLayerId,
        targetLayerId,
        insertAfter
      )
    }

    const applyLayerPreviewStyles = (layerId: number, insertAfter: boolean) => {
      setEditorBodyDrawerLayerDropPreviewStyle(layerList, layerId, insertAfter)
    }

    const clearLayerDragPreview = () => {
      if (dragPreviewLayerId === -1) {
        return
      }
      clearEditorBodyDrawerLayerDropPreviewStyle(layerList, dragPreviewLayerId)
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
      return layerStore.cloneLayer(source)
    }

    const deletePaintLayer = (layerId: number): boolean => {
      if (!layerStore.deletePaintLayer(layerId)) {
        return false
      }
      if (selectedLayerId === layerId) {
        selectedLayerId = CORE_LAYER_ID
      }
      return true
    }

    const restoreLayerSnapshots = (
      snapshots: EditorBodyLayerSnapshot[],
      order?: number[]
    ) => {
      layerStore.restoreLayerSnapshots(snapshots, order)
      ensureSelectedLayer()
    }

    const updateLayerMenuButtons = () => {
      const targetLayer = getLayerById(layerMenuTargetId)
      const renameEnabled = !!targetLayer
      const styleEnabled = canStyleLayer(targetLayer)
      const duplicateEnabled = canDuplicateLayer(targetLayer)
      const deleteEnabled = canDeleteLayer(targetLayer)
      setPopupButtonEnabled(renameLayerBtn, renameEnabled)
      setPopupButtonEnabled(styleLayerBtn, styleEnabled)
      setPopupButtonEnabled(duplicateLayerBtn, duplicateEnabled)
      setPopupButtonEnabled(deleteLayerBtn, deleteEnabled)
    }

    const showLayerMenu = (
      clientX: number,
      clientY: number,
      layerId: number
    ) => {
      layerMenuTargetId = layerId
      updateLayerMenuButtons()
      placePopupMenuWithin(layerMenu, form, clientX, clientY)
    }

    const getOrCreateBoneLayer = (part: BonePart): EditorBodyLayer => {
      const id = getBoneLayerId(part)
      const existing = getLayerById(id)
      if (existing) return existing
      const layer = createBoneLayer(part)
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
    ): EditorCollisionShape | null => {
      const layer = findBoneLayer(layers, part)
      const def = BONE_DEFAULT_POSITIONS[part]
      const shape = buildDefaultSkeletalBoneBoundary({
        part,
        length: 0,
        width: 0.06,
        pivotX: layer?.bonePivotX ?? def.pivotX,
        pivotY: layer?.bonePivotY ?? def.pivotY,
        tipX: layer?.boneTipX ?? def.tipX,
        tipY: layer?.boneTipY ?? def.tipY,
      })
      if (!shape) {
        return null
      }
      if (shape.kind === 'circle') {
        return {
          id: nextCollisionShapeId++,
          kind: 'circle',
          centerX: Math.round(shape.center.x),
          centerY: Math.round(shape.center.y),
          radius: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radius)),
        }
      }
      if (shape.kind === 'ellipse') {
        return {
          id: nextCollisionShapeId++,
          kind: 'ellipse',
          centerX: Math.round(shape.center.x),
          centerY: Math.round(shape.center.y),
          radiusX: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusX)),
          radiusY: Math.max(MIN_COLLISION_RADIUS, Math.round(shape.radiusY)),
          rotationDeg: Math.round(shape.rotationDeg ?? 0),
        }
      }
      return {
        id: nextCollisionShapeId++,
        kind: 'capsule',
        centerX: Math.round(shape.center.x),
        centerY: Math.round(shape.center.y),
        halfWidth: Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round(shape.halfWidth)
        ),
        halfHeight: Math.max(
          MIN_COLLISION_HALF_EXTENT,
          Math.round(shape.halfHeight)
        ),
        rotationDeg: Math.round(shape.rotationDeg ?? 0),
      }
    }

    const ensureBoneBoundaryShapes = (
      layer: EditorBodyLayer
    ): EditorCollisionShape[] => {
      if (layer.boneBoundaryShapes && layer.boneBoundaryShapes.length > 0) {
        return layer.boneBoundaryShapes
      }
      const part = layer.bonePart
      if (!part) {
        layer.boneBoundaryShapes = []
        return layer.boneBoundaryShapes
      }
      const shape = createDefaultBoneBoundary(part)
      layer.boneBoundaryShapes = shape ? [shape] : []
      return layer.boneBoundaryShapes
    }

    const fillBoneLayerFromBoundaryShapes = (
      layer: EditorBodyLayer,
      shapes: readonly EditorCollisionShape[],
      fillColor = getDefaultBoneFillColor()
    ) => {
      if (!ensureLayerSurface(layer) || !layer.ctx) {
        return
      }
      layer.ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      if (shapes.length > 0) {
        layer.ctx.save()
        layer.ctx.fillStyle = fillColor
        for (let i = 0; i < shapes.length; i++) {
          traceEditorCollisionShape(layer.ctx, shapes[i])
          layer.ctx.fill()
        }
        layer.ctx.restore()
      }
      layer.bounds = readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
      layer.boundsDirty = false
    }

    const syncAutoBoneLayerShape = (layer: EditorBodyLayer) => {
      if (layer.kind !== 'bone' || layer.boneShapeCustomized) {
        return
      }
      const bounds = resolveLayerBounds(layer)
      if (bounds) {
        return
      }
      fillBoneLayerFromBoundaryShapes(layer, ensureBoneBoundaryShapes(layer))
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
      restoreCollisionShapesSnapshot(ensureBoneBoundaryShapes(layer))
      selectedBoundaryPart = part
    }

    const leaveBoneBoundaryMode = () => {
      if (selectedBoundaryPart === null) return
      const layer = findBoneLayer(layers, selectedBoundaryPart)
      if (layer) {
        layer.boneBoundaryShapes = copyCollisionShapesSnapshot()
        if (!layer.boneShapeCustomized) {
          fillBoneLayerFromBoundaryShapes(layer, layer.boneBoundaryShapes)
        }
      }
      restoreCollisionShapesSnapshot(boneBoundaryBackup ?? [])
      boneBoundaryBackup = null
      selectedBoundaryPart = null
    }

    const getBoneSegments = (): BoneSegment[] => {
      const result: BoneSegment[] = []
      for (const part of BONE_PARTS_ORDERED) {
        const layer = findBoneLayer(layers, part)
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
            ? readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
            : layer.bounds
          if (bounds) {
            const dataUrl = cropCanvasDataUrl(
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

    const renderAnimationList = () => {
      animationPanel.style.display =
        activeSidebarTab === 'bones' ? 'flex' : 'none'
      animationList.innerHTML = ''
      for (let i = 0; i < SKELETAL_ANIMATION_NAMES.length; i++) {
        const animationName = SKELETAL_ANIMATION_NAMES[i]
        const row = document.createElement('div')
        row.style.cssText = [
          'display:flex',
          'align-items:center',
          'justify-content:space-between',
          'gap:8px',
          'padding:6px 8px',
          'background:rgba(255,255,255,0.04)',
          'border:1px solid rgba(255,255,255,0.08)',
        ].join(';')

        const nameLabel = document.createElement('span')
        nameLabel.textContent = localizer.t(
          `editor_body_drawer_animation_${animationName}`
        )
        nameLabel.style.cssText =
          'font-size:11px;line-height:1.2;color:#f4efe0;'
        row.appendChild(nameLabel)

        const previewBtn = document.createElement('button')
        previewBtn.type = 'button'
        previewBtn.textContent = localizer.t(
          'editor_body_drawer_animation_preview'
        )
        previewBtn.style.cssText = [
          'padding:3px 7px',
          'font-size:10px',
          'font-family:monospace',
          'color:#fff',
          'background:rgba(255,255,255,0.08)',
          'border:1px solid rgba(255,255,255,0.2)',
          'cursor:pointer',
        ].join(';')
        previewBtn.addEventListener('click', () => {
          showBodyDrawerAnimationPreview({
            viewport,
            animationName: animationName as SkeletalAnimationName,
            segments: getBoneSegments(),
          })
        })
        row.appendChild(previewBtn)
        animationList.appendChild(row)
      }
    }

    const loadBoneSegments = (segments: BoneSegment[]) => {
      loadedBoneSegments = segments.length > 0
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
          layer.boneShapeCustomized = true
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
        } else {
          layer.boneShapeCustomized = false
          syncAutoBoneLayerShape(layer)
        }
      }
    }

    const resetBoneLayerToDefault = (layer: EditorBodyLayer) => {
      const part = layer.bonePart
      if (!part || !layer.ctx) {
        return
      }
      const def = BONE_DEFAULT_POSITIONS[part]
      layer.bonePivotX = def.pivotX
      layer.bonePivotY = def.pivotY
      layer.boneTipX = def.tipX
      layer.boneTipY = def.tipY
      layer.boneShapeCustomized = false
      layer.ctx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      layer.bounds = null
      layer.boundsDirty = false
      layer.boneBoundaryShapes = []
      fillBoneLayerFromBoundaryShapes(
        layer,
        ensureBoneBoundaryShapes(layer),
        resetBodyColor
      )
    }

    const renderBoneList = () => {
      renderEditorBodyDrawerBoneList(
        {
          container: boneList,
          collapsedBonePartsSet,
          selectedBonePart,
          selectedShapePart,
          selectedBoundaryPart,
        },
        {
          onToggleBonePart: (part, open) => {
            if (open) {
              collapsedBonePartsSet.delete(part)
            } else {
              collapsedBonePartsSet.add(part)
            }
          },
          onSelectBone: (part) => {
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
          },
          onSelectShape: (part) => {
            leaveBoneBoundaryMode()
            selectedShapePart = part
            selectedBonePart = null
            selectedLayerId = getBoneLayerId(part)
            const layer = getOrCreateBoneLayer(part)
            syncAutoBoneLayerShape(layer)
            mode = 'shape'
            bonePropPanel.style.display = 'none'
            updateModeButtons()
            renderBoneList()
            renderComposite()
          },
          onSelectBoundary: (part) => {
            selectedBonePart = null
            selectedShapePart = null
            bonePropPanel.style.display = 'none'
            enterBoneBoundaryMode(part)
            mode = 'collision'
            updateModeButtons()
            renderBoneList()
            renderComposite()
          },
        }
      )
      renderAnimationList()
    }

    const renderLayerList = () => {
      renderEditorBodyDrawerLayerList(
        {
          container: layerList,
          layers,
          mode,
          selectedLayerId,
          renamingLayerId,
        },
        {
          onSelectCollision: () => {
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
          },
          onSelectLayer: (layer) => {
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
          },
          onOpenLayerMenu: (event, layer) => {
            hideContourMenu()
            hideCollisionToolMenu()
            hideCollisionShapeMenu()
            selectedLayerId = layer.id
            renderLayerList()
            showLayerMenu(event.clientX, event.clientY, layer.id)
            event.preventDefault()
            event.stopPropagation()
          },
          onCommitRename: commitLayerRename,
          onCancelRename: cancelLayerRename,
          onDragStart: (layerId, row, event) => {
            draggingLayerId = layerId
            clearLayerDragPreview()
            row.style.opacity = '0.45'
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(layerId))
            }
          },
          onDragOver: (layerId, row, event) => {
            if (draggingLayerId < 0 || draggingLayerId === layerId) {
              return
            }
            event.preventDefault()
            const rect = row.getBoundingClientRect()
            const insertAfter = event.clientY >= rect.top + rect.height * 0.5
            updateLayerDragPreview(layerId, insertAfter)
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = 'move'
            }
          },
          onDragEnd: (row) => {
            row.style.opacity = ''
            resetLayerDragState()
          },
        }
      )
      renderAnimationList()
    }

    layerList.addEventListener('dragover', (event) => {
      if (draggingLayerId === -1) {
        return
      }
      event.preventDefault()
      const preview = getEditorBodyDrawerLayerDropPreview(layerList, event)
      if (preview) {
        updateLayerDragPreview(preview.layerId, preview.insertAfter)
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
          nextLayerId: layerStore.nextLayerId,
          presetId: currentPresetId,
          collisionShapes: copyCollisionShapesSnapshot(),
          nextCollisionShapeId,
          selectedCollisionShapeId,
          collisionToolKind,
          collisionShapesCustomized,
          skeletalModeEnabled,
          activeSidebarTab,
          selectedBonePart,
          selectedShapePart,
          selectedBoundaryPart,
          boneBoundaryBackup: boneBoundaryBackup
            ? copyCollisionShapeList(boneBoundaryBackup)
            : null,
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
      layerStore.nextLayerId = snapshot.nextLayerId
      setPresetSelection(snapshot.presetId)
      selectedCollisionShapeId = snapshot.selectedCollisionShapeId
      collisionToolKind = snapshot.collisionToolKind
      collisionShapesCustomized = snapshot.collisionShapesCustomized
      skeletalModeEnabled = snapshot.skeletalModeEnabled
      activeSidebarTab = snapshot.activeSidebarTab
      selectedBonePart = snapshot.selectedBonePart
      selectedShapePart = snapshot.selectedShapePart
      selectedBoundaryPart = snapshot.selectedBoundaryPart
      boneBoundaryBackup = snapshot.boneBoundaryBackup
        ? copyCollisionShapeList(snapshot.boneBoundaryBackup)
        : null
      restoreCollisionShapesSnapshot(snapshot.collisionShapes)
      bonePropPanel.style.display = selectedBonePart ? 'flex' : 'none'
      if (selectedBonePart) {
        const seg = getBoneSegments().find(
          (item) => item.part === selectedBonePart
        )
        boneLengthRow.inp.value = String(seg?.length ?? 0.15)
        boneWidthRow.inp.value = String(seg?.width ?? 0.06)
      }
      nextCollisionShapeId = snapshot.nextCollisionShapeId
      ensureSelectedLayer()
      setSidebarTabState(sidebarTabElements, activeSidebarTab)
      renderBoneList()
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

    const getBrushSize = (): number => {
      const parsed = Number.parseInt(brushSlider.value, 10)
      if (!Number.isFinite(parsed)) {
        return DEFAULT_BRUSH_SIZE
      }
      return Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, parsed))
    }

    const getContourPointCount = (): number =>
      getContourArrayPointCount(contourPoints)

    const getContourBounds = () => getContourPointBounds(contourPoints)

    const setExportReferenceFromBounds = (
      bounds: ReturnType<typeof getContourBounds> | null
    ) => {
      if (!bounds) {
        return
      }
      exportReferenceWidth = Math.max(1, bounds.width)
      exportReferenceHeight = Math.max(1, bounds.height)
    }

    const getSelectedCollisionShape = (): EditorCollisionShape | null =>
      getCollisionShapeById(selectedCollisionShapeId)

    const buildContourLocalPoints = (
      contourBounds: ReturnType<typeof getContourBounds>
    ): number[] | null => {
      if (!contourBounds || contourPoints.length < 6) {
        return null
      }
      const localPoints = new Array<number>(contourPoints.length)
      for (let i = 0; i < contourPoints.length; i += 2) {
        localPoints[i] = contourPoints[i] - contourBounds.centerX
        localPoints[i + 1] = contourPoints[i + 1] - contourBounds.centerY
      }
      return localPoints
    }

    const buildContourCollisionPreviewLoops = (): number[][] | null => {
      if (!contourClosed) {
        return null
      }
      const contourBounds = getContourBounds()
      const localPoints = buildContourLocalPoints(contourBounds)
      if (!contourBounds || !localPoints) {
        return null
      }
      const localLoops =
        buildCharacterBodyCollisionOutlineLoopsFromLocalPoints(localPoints)
      if (!localLoops || localLoops.length === 0) {
        return null
      }
      const previewLoops = new Array<number[]>(localLoops.length)
      for (let i = 0; i < localLoops.length; i++) {
        const localLoop = localLoops[i]
        const previewLoop = new Array<number>(localLoop.length)
        for (let j = 0; j < localLoop.length; j += 2) {
          previewLoop[j] = localLoop[j] + contourBounds.centerX
          previewLoop[j + 1] = localLoop[j + 1] + contourBounds.centerY
        }
        previewLoops[i] = previewLoop
      }
      return previewLoops
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
      if (!collisionShapesCustomized) {
        collisionPreviewLoops = buildContourCollisionPreviewLoops()
        return collisionPreviewLoops
      }
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

    const getCollisionShapeAtPoint = (
      pointX: number,
      pointY: number
    ): EditorCollisionShape | null => {
      return findCollisionShapeAtPoint(collisionShapes, pointX, pointY)
    }

    const getCollisionShapeSelectionHandleAtPoint = (
      pointX: number,
      pointY: number,
      shape: EditorCollisionShape | null
    ): EditorSelectionHandle | null => {
      return getCollisionShapeSelectionHandleHit(
        pointX,
        pointY,
        shape,
        viewportScale
      )
    }

    const getCollisionShapeRotationHandleAtPoint = (
      pointX: number,
      pointY: number,
      shape: EditorCollisionShape | null
    ): EditorRotationHandle | null => {
      return getCollisionShapeRotationHandleHit(
        pointX,
        pointY,
        shape,
        viewportScale
      )
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
      applyCollisionShapeScaleToShape(shape, session, pointX, pointY)
    }

    const applyCollisionShapeRotate = (
      session: EditorCollisionRotateSession,
      pointX: number,
      pointY: number
    ) => {
      const shape = getCollisionShapeById(session.shapeId)
      if (!shape) {
        return
      }
      applyCollisionShapeRotation(shape, session, pointX, pointY)
    }

    const setCollisionShapesFromMap = (
      shapes: readonly MapCharacterBodyCollisionShape[],
      centerX: number,
      centerY: number,
      facing: number
    ) => {
      clearCollisionShapes()
      for (let i = 0; i < shapes.length; i++) {
        collisionShapes.push(
          createEditorCollisionShapeFromMap(
            shapes[i],
            nextCollisionShapeId++,
            centerX,
            centerY,
            facing
          )
        )
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
      clearCollisionShapes()
      collisionShapesCustomized = false
      return true
    }

    const syncAutoCollisionShapesIfNeeded = () => {
      if (collisionShapesCustomized) {
        return
      }
      regenerateAutoCollisionShapesFromContour()
    }

    const markCollisionShapesCustomized = () => {
      collisionShapesCustomized = true
      invalidatePresetSelection()
    }

    const appendCollisionShape = (shape: EditorCollisionShape) => {
      collisionShapes.push(shape)
      selectedCollisionShapeId = shape.id
      markCollisionShapesCustomized()
      invalidateCollisionPreview()
    }

    const createCollisionShapeFromDrag = (
      shapeId: number,
      startX: number,
      startY: number,
      endX: number,
      endY: number
    ): EditorCollisionShape => {
      return buildCollisionShapeFromDrag(
        collisionToolKind,
        shapeId,
        startX,
        startY,
        endX,
        endY
      )
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
        markCollisionShapesCustomized()
        invalidateCollisionPreview()
        return true
      }
      return false
    }

    const serializeCollisionShapes = (
      centerX: number,
      centerY: number
    ): MapCharacterBodyCollisionShape[] => {
      return serializeCollisionShapeList(
        collisionShapes,
        centerX,
        centerY,
        editorFacing
      )
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
      getCanvasVisibleWorldSize(scale)

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
      return getScaledContourHitDistanceSq(baseDistanceSq, viewportScale)
    }

    const getNearestContourPointIndex = (
      pointX: number,
      pointY: number,
      maxDistanceSq: number
    ): number => {
      return getNearestContourPointIndexInList(
        contourPoints,
        pointX,
        pointY,
        maxDistanceSq
      )
    }

    const getNearestContourEdge = (
      pointX: number,
      pointY: number,
      maxDistanceSq: number
    ): { insertAfterIndex: number; x: number; y: number } | null => {
      return getNearestContourEdgeHit(
        contourPoints,
        contourClosed,
        pointX,
        pointY,
        maxDistanceSq
      )
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
      setButtonDisabled(resetStaticBtn, false)
      setButtonDisabled(resetSkeletalBtn, false)
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
      const contourBounds = getContourBounds()
      const circleClampedEye = clampCharacterEyeOffsetToCircle(
        targetEyeX,
        targetEyeY,
        getEyeMoveRangeRadius()
      )
      if (!contourBounds || contourPoints.length < 6) {
        return circleClampedEye
      }
      const bodyPoint = clampCharacterEyeCenterToBodyPoints(
        contourBounds.centerX + circleClampedEye.x,
        contourBounds.centerY + circleClampedEye.y,
        contourPoints,
        eyeScaleX,
        eyeScaleY,
        eyeStyle,
        eyeRotationDeg
      )
      return {
        x: bodyPoint.x - contourBounds.centerX,
        y: bodyPoint.y - contourBounds.centerY,
      }
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
      contourPoints = scaleContourPointListFromBounds(
        sourcePoints,
        sourceBounds,
        targetBounds
      )
    }

    const drawScaledSnapshot = (
      ctx: CanvasRenderingContext2D,
      snapshot: EditorCanvasSnapshot | null,
      targetBounds: EditorCanvasBounds | null
    ): EditorCanvasBounds | null => {
      return drawScaledCanvasSnapshot(
        ctx,
        this._getOutputCanvas(),
        snapshot,
        targetBounds
      )
    }

    const drawRotatedSnapshot = (
      ctx: CanvasRenderingContext2D,
      snapshot: EditorCanvasSnapshot | null,
      centerX: number,
      centerY: number,
      rotationDeg: number
    ): EditorCanvasBounds | null => {
      return drawRotatedCanvasSnapshot(
        ctx,
        this._getOutputCanvas(),
        snapshot,
        centerX,
        centerY,
        rotationDeg
      )
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
      contourPoints = rotateContourPointList(
        sourcePoints,
        centerX,
        centerY,
        rotationDeg
      )
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
        ensureEyeInsideBody()
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
      layer.ctx.drawImage(this._workCanvas, offsetX, offsetY)
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
      shapeCtx.drawImage(this._maskCanvas, 0, 0)
      shapeCtx.restore()
      shapeState.bounds = cloneBounds(maskState.bounds)
      shapeState.boundsDirty = maskState.boundsDirty
      renderComposite()
    }

    const traceContourPath = (ctx: CanvasRenderingContext2D) => {
      traceContourPointPath(ctx, contourPoints)
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
        drawImageToRect(
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
      return buildDefaultContourPointList(
        options.defaultBodyWidth,
        options.defaultBodyHeight
      )
    }

    const buildResetContourPoints = (): number[] => {
      return buildDefaultContourPointList(resetBodyWidth, resetBodyHeight)
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
      if (presetId === 'prototype' || presetId === 'banana') {
        textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        textureState.bounds = null
        textureState.boundsDirty = false
        return
      }
      textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
      drawBodyPresetTexture(textureCtx, presetId, bounds)
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
      const preset = getBodyPresetConfig(presetId)
      const presetImageMirrorX = shouldMirrorPresetImage(preset, editorFacing)
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
      eyeStyle = defaultEyeStyle
      browStyle = DEFAULT_CHARACTER_BROW_STYLE
      browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
      browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
      browScaleX = DEFAULT_CHARACTER_BROW_SCALE
      browScaleY = DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG
      colorInput.value = preset.color ?? resetBodyColor
      bloodColorInput.value = preset.bloodColor
      bloodColorAssigned = true
      if (preset.imageSrc) {
        const presetImage = await loadImage(preset.imageSrc)
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
        drawImageToRect(
          workCtx,
          presetImage,
          drawX,
          drawY,
          targetWidth,
          targetHeight,
          presetImageMirrorX
        )
        const imageContourPoints = buildEditorContourFromMask(workCtx, 160)
        workCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        if (!imageContourPoints || imageContourPoints.length < 6) {
          return
        }
        coreImageShape = presetImage
        coreImageShapeMirrorX = presetImageMirrorX
        contourPoints = imageContourPoints
        const contourBounds = getContourBounds()
        eyeX = contourBounds
          ? getPresetPreferredEyeX(preset, contourBounds.width, editorFacing)
          : DEFAULT_CHARACTER_EYE_X * editorFacing
        drawContourFill()
        textureCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
        textureState.bounds = null
        textureState.boundsDirty = false
      } else {
        contourPoints = buildPresetContourPoints(preset.points, editorFacing)
        const contourBounds = getContourBounds()
        eyeX = contourBounds
          ? getPresetPreferredEyeX(preset, contourBounds.width, editorFacing)
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

    const compositeRenderer = new EditorBodyDrawerRenderer({
      drawCtx,
      shapeCanvas: this._shapeCanvas,
      textureCanvas: this._textureCanvas,
      shapeState,
      layers,
      collisionShapes,
      resolveLayerBounds,
      getContourBounds,
      getEyeBounds,
      getBrowGeometry,
      getSelectedLayer,
      getSelectedLayerBounds,
      getSelectedCollisionShape,
      getCollisionPreviewLoops,
      getViewportScale: () => viewportScale,
      getViewOriginX: () => viewOriginX,
      getViewOriginY: () => viewOriginY,
      getActiveSidebarTab: () => activeSidebarTab,
      getMode: () => mode,
      getSelectedBonePart: () => selectedBonePart,
      getSelectedShapePart: () => selectedShapePart,
      getSelectedBoundaryPart: () => selectedBoundaryPart,
      getSelectedCollisionShapeId: () => selectedCollisionShapeId,
      getContourPoints: () => contourPoints,
      getContourClosed: () => contourClosed,
      getSelectedContourIndex: () => selectedContourIndex,
      getHoverVisible: () => hoverVisible,
      getHoverX: () => hoverX,
      getHoverY: () => hoverY,
      getEditorFacing: () => editorFacing,
      getEyeX: () => eyeX,
      getEyeY: () => eyeY,
      getEyeScaleX: () => eyeScaleX,
      getEyeScaleY: () => eyeScaleY,
      getEyeRotationDeg: () => eyeRotationDeg,
      getEyeStyle: () => eyeStyle,
      getBrowStyle: () => browStyle,
    })

    const renderComposite = () => {
      compositeRenderer.render()
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
      const nextContourPoints = buildEditorContourFromMask(maskCtx)
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
      workCtx.drawImage(this._maskCanvas, 0, 0)
      workCtx.globalCompositeOperation = 'source-over'
      textureCtx.drawImage(this._workCanvas, 0, 0)
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
          if (selectedPaintLayer.kind === 'bone') {
            selectedPaintLayer.boneShapeCustomized = true
          }
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
          if (selectedPaintLayer.kind === 'bone') {
            selectedPaintLayer.boneShapeCustomized = true
          }
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
      loadedBoneSegments = false
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
      eyeStyle = defaultEyeStyle
      browStyle = DEFAULT_CHARACTER_BROW_STYLE
      browOffsetX = DEFAULT_CHARACTER_BROW_OFFSET_X
      browOffsetY = DEFAULT_CHARACTER_BROW_OFFSET_Y
      browScaleX = DEFAULT_CHARACTER_BROW_SCALE
      browScaleY = DEFAULT_CHARACTER_BROW_SCALE
      browRotationDeg = DEFAULT_CHARACTER_BROW_ROTATION_DEG

      const profile = options.initialProfile
      const initialPresetId = isBodyPresetId(profile?.presetId)
        ? profile.presetId
        : CUSTOM_BODY_PRESET_ID
      const initialPresetConfig = isBodyPresetId(initialPresetId)
        ? getBodyPresetConfig(initialPresetId)
        : null
      const initialPresetImageSrc = getBodyPresetImageSrc(initialPresetId)
      const initialContourWidth = profile?.points.length
        ? getProfilePointWidth(profile.points)
        : 0
      const initialEyeDrawX =
        !!initialPresetConfig &&
        typeof profile?.eyeX === 'number' &&
        Number.isFinite(profile.eyeX) &&
        profile.eyeX === 0
          ? getPresetPreferredEyeX(initialPresetConfig, initialContourWidth, 1)
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
      eyeStyle = getCharacterEyeStyle(profile, defaultEyeStyle)
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
          const image = await loadImage(coreDataUrl)
          if (image && contourBounds) {
            if (restorePresetBaseImage) {
              coreImageShape = image
              coreImageShapeMirrorX =
                initialPresetConfig !== null
                  ? shouldMirrorPresetImage(initialPresetConfig, editorFacing)
                  : false
              colorInput.value = TRANSPARENT_BODY_COLOR
              drawContourFill()
            } else {
              drawImageToRect(
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
            const image = await loadImage(visualLayer.dataUrl)
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
            drawImageToRect(
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
        if (
          initialPresetId === CUSTOM_BODY_PRESET_ID &&
          profile.collisionShapes &&
          profile.collisionShapes.length > 0
        ) {
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
        } else if (skeletalModeEnabled) {
          ensureAllBoneLayers()
          for (let i = 0; i < layers.length; i++) {
            syncAutoBoneLayerShape(layers[i])
          }
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

    const restoreDefaultStaticProfile = () => {
      if (selectedBoundaryPart !== null) {
        leaveBoneBoundaryMode()
      }
      setPresetSelection(CUSTOM_BODY_PRESET_ID)
      clearBodyShape()
      coreImageShape = null
      coreImageShapeMirrorX = false
      contourPoints = buildResetContourPoints()
      contourClosed = true
      selectedContourIndex = 0
      contourDragPointIndex = -1
      pendingContourClose = false
      hoverVisible = false
      colorInput.value = resetBodyColor
      bloodColorInput.value = DEFAULT_BODY_BLOOD_COLOR
      bloodColorAssigned = false
      eyeX = DEFAULT_CHARACTER_EYE_X * editorFacing
      eyeY = DEFAULT_CHARACTER_EYE_Y
      eyeScaleX = DEFAULT_CHARACTER_EYE_SCALE
      eyeScaleY = DEFAULT_CHARACTER_EYE_SCALE
      eyeRotationDeg = DEFAULT_CHARACTER_EYE_ROTATION_DEG
      eyeStyle = defaultEyeStyle
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
      rebuildStaticLayersPreservingBones()
      if (getSelectedLayer()?.kind !== 'bone') {
        selectedLayerId = CORE_LAYER_ID
      }
      exportBaseWidth = resetBodyWidth
      exportBaseHeight = resetBodyHeight
      exportReferenceWidth = LEGACY_PROFILE_REFERENCE_SIZE
      exportReferenceHeight = LEGACY_PROFILE_REFERENCE_SIZE
      drawContourFill()
      setExportReferenceFromBounds(getContourBounds())
      if (activeSidebarTab === 'bones') {
        if (selectedShapePart !== null && getSelectedLayer()?.kind === 'bone') {
          mode = 'shape'
        } else if (selectedBonePart !== null) {
          mode = 'select'
        } else {
          mode = 'shape'
        }
      } else {
        selectedLayerId = CORE_LAYER_ID
        mode = 'shape'
      }
      renderBoneList()
      renderLayerList()
      renderComposite()
      updateAlert()
      updateConfirmState()
      updateModeButtons()
      updateCursorVisual()
    }

    const restoreDefaultSkeletalProfile = () => {
      if (selectedBoundaryPart !== null) {
        leaveBoneBoundaryMode()
      }
      loadedBoneSegments = false
      ensureAllBoneLayers()
      for (let i = 0; i < layers.length; i++) {
        if (layers[i].kind === 'bone') {
          resetBoneLayerToDefault(layers[i])
        }
      }
      selectedBonePart = null
      selectedShapePart = null
      bonePropPanel.style.display = 'none'
      if (getSelectedLayer()?.kind === 'bone') {
        selectedLayerId = CORE_LAYER_ID
      }
      if (activeSidebarTab === 'bones') {
        mode = contourClosed ? 'select' : 'contour'
      }
      renderBoneList()
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
      const layer = findBoneLayer(layers, selectedBonePart)
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
      if (
        !layer.boneShapeCustomized &&
        (!layer.boneBoundaryShapes || layer.boneBoundaryShapes.length === 0)
      ) {
        fillBoneLayerFromBoundaryShapes(layer, ensureBoneBoundaryShapes(layer))
      }
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
    resetStaticBtn.addEventListener('click', () => {
      flushSettingHistory()
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      restoreDefaultStaticProfile()
      historyManager.capture()
    })
    resetSkeletalBtn.addEventListener('click', () => {
      flushSettingHistory()
      hideContourMenu()
      hideLayerMenu()
      hideCollisionToolMenu()
      hideCollisionShapeMenu()
      restoreDefaultSkeletalProfile()
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
      if (isBodyPresetId(nextPresetId)) {
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
      const nextStyle = await chooseBodyDrawerLayerStyle(
        viewport,
        targetLayer,
        eyeStyle,
        browStyle
      )
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
        ensureEyeInsideBody()
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
      const confirmed = await confirmDeleteBodyDrawerLayer(
        viewport,
        targetLayer.name
      )
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
                  selectedBounds,
                  viewportScale
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
              ? getSelectionHandleAtPoint(
                  point.x,
                  point.y,
                  selectedBounds,
                  viewportScale
                )
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
              markCollisionShapesCustomized()
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
              markCollisionShapesCustomized()
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
              markCollisionShapesCustomized()
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
            assignCollisionShape(activeShape, nextShape)
            pointerChanged = true
            markCollisionShapesCustomized()
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
        confirmBtn.addEventListener('click', async () => {
          const canBuildFromSkeleton = skeletalModeEnabled && hasAnyBoneData()
          if (!contourClosed && !canBuildFromSkeleton) {
            updateAlert()
            return
          }
          const segs = getBoneSegments()
          const staticProfile = contourClosed
            ? (() => {
                const contourBounds = getContourBounds()
                const serializedCollisionShapes = contourBounds
                  ? collisionShapesCustomized
                    ? serializeCollisionShapes(
                        contourBounds.centerX,
                        contourBounds.centerY
                      )
                    : []
                  : []
                return buildProfile(
                  this._workCanvas,
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
                  defaultEyeStyle,
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
              })()
            : null
          let builtProfile: MapCharacterBodyProfile | null = null
          if (canBuildFromSkeleton) {
            builtProfile = buildSkeletalProfile(
              segs,
              colorInput.value,
              bloodColorInput.value,
              exportBaseWidth,
              exportBaseHeight,
              currentPresetId,
              staticProfile
            )
          } else {
            builtProfile = staticProfile
            if (builtProfile && hasAnyBoneData()) {
              builtProfile.boneSegments = segs
            }
          }
          if (builtProfile && canBuildFromSkeleton) {
            builtProfile.skeletalMode = true
            builtProfile.boneSegments = segs
            const skeletalSurface = await buildSkeletalSurfaceSnapshot(
              segs,
              colorInput.value
            )
            if (skeletalSurface) {
              builtProfile.skeletalSurfaceDataUrl = skeletalSurface.dataUrl
              builtProfile.skeletalSurfaceOffsetX = skeletalSurface.offsetX
              builtProfile.skeletalSurfaceOffsetY = skeletalSurface.offsetY
              builtProfile.skeletalSurfaceWidth = skeletalSurface.width
              builtProfile.skeletalSurfaceHeight = skeletalSurface.height
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
    renderAnimationList()
    await loadInitialProfile()
    historyManager.reset()
    return promise
  }
}
