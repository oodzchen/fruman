import {
  type CharacterBrowGeometry,
  drawCharacterBrowGeometry,
  drawCharacterEyeGeometry,
  getCharacterEyeGeometry,
} from '../../characterBodyProfile'
import type {
  BonePart,
  MapCharacterBodyBrowStyle,
  MapCharacterBodyEyeStyle,
} from '../../editorMapTypes'
import {
  BONE_DEFAULT_POSITIONS,
  BONE_PARTS_ORDERED,
  findBoneLayer,
} from './EditorBodyDrawerBones'
import { mergeBounds } from './EditorBodyDrawerCanvas'
import {
  getCollisionShapeRotationHandleCenter,
  getCollisionShapeSelectionHandleCenter,
  isCollisionShapeRotatable,
  traceCollisionShapeSelectionFrame,
  traceEditorCollisionShape,
} from './EditorBodyDrawerCollision'
import type { EditorContourBounds } from './EditorBodyDrawerContour'
import type { EditorBodyDrawerSidebarTab } from './EditorBodyDrawerDom'
import { isLayerRotatable, isLayerScalable } from './EditorBodyDrawerLayers'
import {
  EDITOR_SELECTION_HANDLES,
  getSelectionHandleCenter,
  getSelectionRotationHandleCenter,
} from './EditorBodyDrawerTransforms'
import type {
  BodyDrawMode,
  EditorBodyLayer,
  EditorCanvasBounds,
  EditorCanvasState,
  EditorCollisionShape,
} from './EditorBodyDrawerTypes'
import {
  CONTOUR_GUIDE_POINT_RADIUS,
  DISPLAY_SIZE,
  SELECTION_HANDLE_SIZE,
  SELECTION_ROTATE_HANDLE_SIZE,
} from './EditorBodyDrawerTypes'

export interface EditorBodyDrawerRendererOptions {
  drawCtx: CanvasRenderingContext2D
  shapeCanvas: HTMLCanvasElement
  textureCanvas: HTMLCanvasElement
  shapeState: EditorCanvasState
  layers: readonly EditorBodyLayer[]
  collisionShapes: readonly EditorCollisionShape[]
  resolveLayerBounds: (layer: EditorBodyLayer) => EditorCanvasBounds | null
  getContourBounds: () => EditorContourBounds | null
  getEyeBounds: () => EditorCanvasBounds | null
  getBrowGeometry: () => CharacterBrowGeometry | null
  getSelectedLayer: () => EditorBodyLayer | null
  getSelectedLayerBounds: () => EditorCanvasBounds | null
  getSelectedCollisionShape: () => EditorCollisionShape | null
  getCollisionPreviewLoops: () => number[][] | null
  getViewportScale: () => number
  getViewOriginX: () => number
  getViewOriginY: () => number
  getActiveSidebarTab: () => EditorBodyDrawerSidebarTab
  getMode: () => BodyDrawMode
  getSelectedBonePart: () => BonePart | null
  getSelectedShapePart: () => BonePart | null
  getSelectedBoundaryPart: () => BonePart | null
  getSelectedCollisionShapeId: () => number
  getContourPoints: () => readonly number[]
  getContourClosed: () => boolean
  getSelectedContourIndex: () => number
  getHoverVisible: () => boolean
  getHoverX: () => number
  getHoverY: () => number
  getEditorFacing: () => number
  getEyeX: () => number
  getEyeY: () => number
  getEyeScaleX: () => number
  getEyeScaleY: () => number
  getEyeRotationDeg: () => number
  getEyeStyle: () => MapCharacterBodyEyeStyle
  getBrowStyle: () => MapCharacterBodyBrowStyle
}

export class EditorBodyDrawerRenderer {
  private readonly _options: EditorBodyDrawerRendererOptions

  constructor(options: EditorBodyDrawerRendererOptions) {
    this._options = options
  }

  render() {
    const { drawCtx } = this._options
    const viewportScale = this._options.getViewportScale()
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
      -this._options.getViewOriginX() * viewportScale,
      -this._options.getViewOriginY() * viewportScale
    )
    if (this._options.getActiveSidebarTab() === 'bones') {
      this._drawBonesMode(viewportScale)
      drawCtx.restore()
      return
    }

    this._drawMergedVisualWorld(drawCtx, false)
    this._drawCollisionOverlay(drawCtx, viewportScale)
    this._drawSelectionOverlay(viewportScale)
    this._drawContourOverlay(viewportScale)
    drawCtx.restore()
  }

  private _drawEyeLayer(
    ctx: CanvasRenderingContext2D,
    contourBounds: EditorContourBounds | null
  ) {
    if (!this._options.getContourClosed() || !contourBounds) {
      return
    }
    drawCharacterEyeGeometry(
      ctx,
      getCharacterEyeGeometry(
        contourBounds.centerX + this._options.getEyeX(),
        contourBounds.centerY + this._options.getEyeY(),
        this._options.getEditorFacing(),
        this._options.getEyeScaleX(),
        this._options.getEyeScaleY(),
        this._options.getEyeStyle(),
        this._options.getEyeRotationDeg()
      ),
      '#17120e'
    )
  }

  private _drawBrowStyle(
    ctx: CanvasRenderingContext2D,
    contourBounds: EditorContourBounds | null
  ) {
    const browStyle = this._options.getBrowStyle()
    if (
      !this._options.getContourClosed() ||
      !contourBounds ||
      browStyle === 'custom' ||
      browStyle === 'none'
    ) {
      return
    }
    const browGeometry = this._options.getBrowGeometry()
    if (!browGeometry) {
      return
    }
    drawCharacterBrowGeometry(ctx, browGeometry, '#231711')
  }

  private _drawMergedVisualWorld(
    ctx: CanvasRenderingContext2D,
    clearFirst: boolean
  ): EditorCanvasBounds | null {
    const contourBounds = this._options.getContourBounds()
    let mergedBounds: EditorCanvasBounds | null = null
    if (clearFirst) {
      ctx.clearRect(
        0,
        0,
        this._options.shapeCanvas.width,
        this._options.shapeCanvas.height
      )
    }
    ctx.drawImage(this._options.shapeCanvas, 0, 0)
    mergedBounds = mergeBounds(mergedBounds, this._options.shapeState.bounds)
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.drawImage(this._options.textureCanvas, 0, 0)
    ctx.restore()
    for (let i = 0; i < this._options.layers.length; i++) {
      const layer = this._options.layers[i]
      if (layer.kind === 'core') {
        continue
      }
      if (layer.kind === 'eye') {
        this._drawEyeLayer(ctx, contourBounds)
        if (contourBounds) {
          mergedBounds = mergeBounds(mergedBounds, this._options.getEyeBounds())
        }
        continue
      }
      if (layer.kind === 'bone') {
        continue
      }
      if (layer.kind === 'brow') {
        this._drawBrowStyle(ctx, contourBounds)
      }
      if (layer.canvas) {
        ctx.drawImage(layer.canvas, 0, 0)
        mergedBounds = mergeBounds(
          mergedBounds,
          this._options.resolveLayerBounds(layer)
        )
      }
    }
    return mergedBounds
  }

  private _drawCollisionOverlay(
    ctx: CanvasRenderingContext2D,
    viewportScale: number
  ) {
    if (this._options.collisionShapes.length === 0) {
      return
    }
    const selectedCollisionShapeId = this._options.getSelectedCollisionShapeId()
    ctx.save()
    ctx.setLineDash([8 / viewportScale, 5 / viewportScale])
    for (let i = 0; i < this._options.collisionShapes.length; i++) {
      const shape = this._options.collisionShapes[i]
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
    this._drawCollisionPreviewLoops(ctx, viewportScale)
    this._drawSelectedCollisionShape(ctx, viewportScale)
    ctx.restore()
  }

  private _drawCollisionPreviewLoops(
    ctx: CanvasRenderingContext2D,
    viewportScale: number
  ) {
    const loops = this._options.getCollisionPreviewLoops()
    if (!loops || loops.length === 0) {
      return
    }
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

  private _drawSelectedCollisionShape(
    ctx: CanvasRenderingContext2D,
    viewportScale: number
  ) {
    const selectedShape =
      this._options.getMode() === 'collision'
        ? this._options.getSelectedCollisionShape()
        : null
    if (!selectedShape) {
      return
    }
    ctx.strokeStyle = 'rgba(255,245,220,0.95)'
    ctx.lineWidth = Math.max(1 / viewportScale, 1)
    ctx.setLineDash([6 / viewportScale, 4 / viewportScale])
    traceCollisionShapeSelectionFrame(ctx, selectedShape)
    ctx.stroke()
    const handleSize = Math.max(2, SELECTION_HANDLE_SIZE / viewportScale)
    const halfHandle = handleSize * 0.5
    ctx.setLineDash([])
    ctx.fillStyle = '#f7ecd2'
    ctx.strokeStyle = 'rgba(36,24,16,0.96)'
    for (let i = 0; i < EDITOR_SELECTION_HANDLES.length; i++) {
      const center = getCollisionShapeSelectionHandleCenter(
        selectedShape,
        EDITOR_SELECTION_HANDLES[i]
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
    if (!isCollisionShapeRotatable(selectedShape)) {
      return
    }
    const rotateCenter = getCollisionShapeRotationHandleCenter(selectedShape)
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
    ctx.arc(rotateCenter.x, rotateCenter.y, rotateHalfHandle, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  private _drawBonesMode(viewportScale: number) {
    const { drawCtx, layers } = this._options
    for (const part of BONE_PARTS_ORDERED) {
      const layer = findBoneLayer(layers, part)
      if (layer?.canvas) {
        drawCtx.drawImage(layer.canvas, 0, 0)
      }
    }

    const lineW = Math.max(1, Math.round(1 / viewportScale))
    const dotR = Math.max(2, Math.round(4 / viewportScale))
    const dotRSm = Math.max(1, Math.round(3 / viewportScale))
    const dash = Math.max(3, Math.round(6 / viewportScale))
    const gap = Math.max(2, Math.round(4 / viewportScale))
    for (const part of BONE_PARTS_ORDERED) {
      const layer = findBoneLayer(layers, part)
      const def = BONE_DEFAULT_POSITIONS[part]
      const px = layer?.bonePivotX ?? def.pivotX
      const py = layer?.bonePivotY ?? def.pivotY
      const tx = layer?.boneTipX ?? def.tipX
      const ty = layer?.boneTipY ?? def.tipY
      const isSelected = this._options.getSelectedBonePart() === part
      const isShapeParent = this._options.getSelectedShapePart() === part
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
      this._drawBonePoints(
        px,
        py,
        tx,
        ty,
        dotR,
        dotRSm,
        isSelected,
        isShapeParent
      )
      drawCtx.restore()
    }
    if (this._options.getSelectedBoundaryPart() !== null) {
      this._drawCollisionOverlay(drawCtx, viewportScale)
    }
  }

  private _drawBonePoints(
    pivotX: number,
    pivotY: number,
    tipX: number,
    tipY: number,
    dotRadius: number,
    smallDotRadius: number,
    selected: boolean,
    shapeParent: boolean
  ) {
    const { drawCtx } = this._options
    if (selected) {
      drawCtx.fillStyle = 'rgba(255,80,200,0.95)'
      drawCtx.beginPath()
      drawCtx.arc(pivotX, pivotY, dotRadius, 0, Math.PI * 2)
      drawCtx.fill()
      drawCtx.fillStyle = 'rgba(60,220,220,0.95)'
      drawCtx.beginPath()
      drawCtx.arc(tipX, tipY, dotRadius, 0, Math.PI * 2)
      drawCtx.fill()
      return
    }
    if (shapeParent) {
      drawCtx.fillStyle = 'rgba(255,255,255,0.6)'
      drawCtx.beginPath()
      drawCtx.arc(pivotX, pivotY, smallDotRadius, 0, Math.PI * 2)
      drawCtx.fill()
      drawCtx.beginPath()
      drawCtx.arc(tipX, tipY, smallDotRadius, 0, Math.PI * 2)
      drawCtx.fill()
      return
    }
    drawCtx.fillStyle = 'rgba(160,200,255,0.35)'
    drawCtx.beginPath()
    drawCtx.arc(pivotX, pivotY, smallDotRadius, 0, Math.PI * 2)
    drawCtx.fill()
  }

  private _drawSelectionOverlay(viewportScale: number) {
    if (this._options.getMode() !== 'select') {
      return
    }
    const { drawCtx } = this._options
    const selectedBounds = this._options.getSelectedLayerBounds()
    const selectedLayer = this._options.getSelectedLayer()
    if (!selectedBounds) {
      return
    }
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
      this._drawSelectionHandles(selectedBounds, viewportScale)
    }
    if (isLayerRotatable(selectedLayer)) {
      this._drawSelectionRotationHandle(selectedBounds, viewportScale)
    }
    drawCtx.restore()
  }

  private _drawSelectionHandles(
    selectedBounds: EditorCanvasBounds,
    viewportScale: number
  ) {
    const { drawCtx } = this._options
    const handleSize = Math.max(2, SELECTION_HANDLE_SIZE / viewportScale)
    const halfHandle = handleSize * 0.5
    drawCtx.setLineDash([])
    drawCtx.fillStyle = '#f7ecd2'
    drawCtx.strokeStyle = 'rgba(36,24,16,0.96)'
    for (let i = 0; i < EDITOR_SELECTION_HANDLES.length; i++) {
      const center = getSelectionHandleCenter(
        selectedBounds,
        EDITOR_SELECTION_HANDLES[i]
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

  private _drawSelectionRotationHandle(
    selectedBounds: EditorCanvasBounds,
    viewportScale: number
  ) {
    const { drawCtx } = this._options
    const rotateCenter = getSelectionRotationHandleCenter(selectedBounds)
    const handleSize = Math.max(2, SELECTION_ROTATE_HANDLE_SIZE / viewportScale)
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
    drawCtx.arc(rotateCenter.x, rotateCenter.y, halfHandle, 0, Math.PI * 2)
    drawCtx.fill()
    drawCtx.stroke()
  }

  private _drawContourOverlay(viewportScale: number) {
    const contourPoints = this._options.getContourPoints()
    if (contourPoints.length < 2) {
      return
    }
    const { drawCtx } = this._options
    const contourClosed = this._options.getContourClosed()
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
    } else if (
      this._options.getMode() === 'contour' &&
      this._options.getHoverVisible()
    ) {
      drawCtx.lineTo(this._options.getHoverX(), this._options.getHoverY())
    }
    drawCtx.stroke()

    const selectedContourIndex = this._options.getSelectedContourIndex()
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
}
