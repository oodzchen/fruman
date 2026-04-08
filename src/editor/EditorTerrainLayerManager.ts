import * as fabric from 'fabric'

import { localizer } from '../Localizer'
import { getDefaultTerrainRenderLayer } from '../renderLayers'
import { TerrainChunkGrid } from '../terrain/TerrainChunkGrid'
import { TerrainCollisionBuilder } from '../terrain/TerrainCollisionBuilder'
import { inferTerrainMaterialId } from '../terrain/TerrainDataUtils'
import {
  getTerrainBrushById,
  getTerrainMaterialById,
  getTerrainMaterialCodeById,
} from '../terrain/TerrainMaterialRegistry'
import { TerrainRenderer } from '../terrain/TerrainRenderer'
import {
  DEFAULT_TERRAIN_RANDOM_SEED,
  type MapTerrainData,
  type MapTerrainLayer,
  TERRAIN_CELL_SIZE_METERS,
  TERRAIN_CHUNK_SIZE,
  TERRAIN_DATA_VERSION,
  type TerrainBrushId,
  type TerrainContourLike,
  type TerrainContourShapeKind,
  type TerrainLayerLike,
  type TerrainMaterialId,
} from '../terrain/TerrainTypes'
import { getVoronoiLayerBuild } from '../terrain/VoronoiBuilder'
import {
  CIRCLE_CONTOUR_POINT_DATA,
  GROUND_RECT_OPTIONS,
  POLYGON_POINT_DATA,
  TRIANGLE_POINT_DATA,
} from './EditorConstants'
import {
  extractFilledCellLoops,
  getContourBounds,
  getContourHitDistanceSq,
  getNearestContourEdge,
  getNearestContourPointIndex,
  pickLargestContourLoop,
  pointInClosedContourScaled2,
  simplifyContourLoop,
} from './EditorTerrainContourUtils'
import {
  type EditorLayeredObject,
  type EditorObjectData,
  type GroundShapeType,
  ObjectType,
  type TerrainContourProxy,
  type TerrainRegionProxy,
} from './types'

interface EditorTerrainLayer {
  id: number
  materialId: TerrainMaterialId
  offsetCellX: number
  offsetCellY: number
  grid: TerrainChunkGrid
  serializedLayer: TerrainLayerLike
  contourId: number
  internalOnly: boolean
  proxy: TerrainRegionProxy | null
}

interface EditorTerrainContour {
  id: number
  points: number[]
  fillMaterialId: TerrainMaterialId | null
  renderLayer: number
  shapeKind: TerrainContourShapeKind | null
  fillLayer: EditorTerrainLayer | null
  proxy: TerrainContourProxy
}

export interface TerrainClipboardLayerSnapshot {
  materialId: TerrainMaterialId
  offsetCellX: number
  offsetCellY: number
  chunks: MapTerrainLayer['chunks']
}

export interface TerrainSerializeOptions {
  shareData?: boolean
}

interface EditorTerrainLayerManagerContext {
  getFabricCanvas: () => fabric.Canvas | null
  requestRender: () => void
  pixelsPerMeter: number
  registerEditorObject: (
    type: ObjectType,
    object: fabric.Object,
    preferredName?: string
  ) => EditorObjectData
  unregisterEditorObject: (object: fabric.Object) => void
}

type FabricBackgroundRenderer = (ctx: CanvasRenderingContext2D) => void

type FabricCanvasWithTerrainBackground = fabric.Canvas & {
  _renderBackground: FabricBackgroundRenderer
  __terrainOriginalRenderBackground?: FabricBackgroundRenderer
}

const EMPTY_TERRAIN_CHUNKS: [] = []
const TERRAIN_CONTOUR_POINT_RADIUS = 4
const TERRAIN_CONTOUR_SELECT_DISTANCE_SQ = 144
const TERRAIN_CONTOUR_EDGE_SELECT_DISTANCE_SQ = 196
const TERRAIN_CONTOUR_SAMPLE_DISTANCE = 12
const TERRAIN_CONTOUR_MIN_POINT_COUNT = 3
const TERRAIN_CONTOUR_CELL_SAMPLE_COUNT = 5
const TERRAIN_CONTOUR_RATIO_SCALE = 1024
const TERRAIN_CONTOUR_STROKE_COLOR = 'rgba(245,208,96,0.92)'
const TERRAIN_CONTOUR_IDLE_STROKE_COLOR = 'rgba(214,174,92,0.62)'
const TERRAIN_CONTOUR_STROKE_WIDTH = 2

function buildContourTemplateRatios(
  offsets: ReadonlyArray<readonly [number, number]>
): ReadonlyArray<readonly [number, number]> {
  let minX = offsets[0][0]
  let maxX = offsets[0][0]
  let minY = offsets[0][1]
  let maxY = offsets[0][1]
  for (let i = 1; i < offsets.length; i++) {
    const point = offsets[i]
    if (point[0] < minX) {
      minX = point[0]
    }
    if (point[0] > maxX) {
      maxX = point[0]
    }
    if (point[1] < minY) {
      minY = point[1]
    }
    if (point[1] > maxY) {
      maxY = point[1]
    }
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const points = new Array<readonly [number, number]>(offsets.length)
  for (let i = 0; i < offsets.length; i++) {
    const point = offsets[i]
    points[i] = [
      Math.round(((point[0] - minX) * TERRAIN_CONTOUR_RATIO_SCALE) / width),
      Math.round(((point[1] - minY) * TERRAIN_CONTOUR_RATIO_SCALE) / height),
    ]
  }
  return points
}

const RECT_CONTOUR_TEMPLATE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [TERRAIN_CONTOUR_RATIO_SCALE, 0],
  [TERRAIN_CONTOUR_RATIO_SCALE, TERRAIN_CONTOUR_RATIO_SCALE],
  [0, TERRAIN_CONTOUR_RATIO_SCALE],
]

const TRIANGLE_CONTOUR_TEMPLATE_POINTS =
  buildContourTemplateRatios(TRIANGLE_POINT_DATA)
const CIRCLE_CONTOUR_TEMPLATE_POINTS = buildContourTemplateRatios(
  CIRCLE_CONTOUR_POINT_DATA
)
const POLYGON_CONTOUR_TEMPLATE_POINTS =
  buildContourTemplateRatios(POLYGON_POINT_DATA)

export class EditorTerrainLayerManager {
  private readonly ctx: EditorTerrainLayerManagerContext
  private readonly layers: EditorTerrainLayer[] = []
  private readonly proxyToLayer = new WeakMap<
    fabric.Object,
    EditorTerrainLayer
  >()
  private readonly contours: EditorTerrainContour[] = []
  private readonly proxyToContour = new WeakMap<
    fabric.Object,
    EditorTerrainContour
  >()
  private readonly renderData = {
    version: TERRAIN_DATA_VERSION,
    cellSize: TERRAIN_CELL_SIZE_METERS,
    chunkSize: TERRAIN_CHUNK_SIZE,
    randomSeed: DEFAULT_TERRAIN_RANDOM_SEED,
    chunks: EMPTY_TERRAIN_CHUNKS,
    layers: [] as TerrainLayerLike[],
    contours: [] as TerrainContourLike[],
  }
  private attachedCanvas: FabricCanvasWithTerrainBackground | null = null
  private chunkSize = TERRAIN_CHUNK_SIZE
  private cellSize = TERRAIN_CELL_SIZE_METERS
  private randomSeed = DEFAULT_TERRAIN_RANDOM_SEED
  private interactionEnabled = true
  private nextLayerId = 1
  private nextContourId = 1
  private contourEditMode = false
  private activeContourId = -1
  private selectedContourId = -1
  private activeContourPointIndex = -1
  private contourPointerActive = false
  private contourPointerChanged = false
  private contourDrawingContour: EditorTerrainContour | null = null
  private contourDragTarget: EditorTerrainContour | null = null
  private contourDragPointIndex = -1
  private contourDragOriginalPoints: number[] | null = null
  private contourLastPointX = 0
  private contourLastPointY = 0
  private contourDragLockedProxy: TerrainContourProxy | null = null
  private contourDragRestoreLockX = false
  private contourDragRestoreLockY = false
  private movingContourTarget: TerrainContourProxy | null = null
  private movingContourStartLeft = 0
  private movingContourStartTop = 0
  private movingContourAppliedDeltaX = 0
  private movingContourAppliedDeltaY = 0

  private strokeBrushId: TerrainBrushId | null = null
  private strokeTargetLayer: EditorTerrainLayer | null = null
  private strokeChanged = false
  private readonly strokeDirtyLayers = new Set<EditorTerrainLayer>()
  private readonly strokeDirtyContours = new Set<EditorTerrainContour>()
  private readonly strokeCellKeys = new Set<number>()
  private movingProxyTarget: TerrainRegionProxy | null = null
  private movingProxyStartLeft = 0
  private movingProxyStartTop = 0
  private movingProxyAppliedCellDeltaX = 0
  private movingProxyAppliedCellDeltaY = 0
  private activeSelectionMoveTarget: fabric.ActiveSelection | null = null
  private activeSelectionMoveStartLeft = 0
  private activeSelectionMoveStartTop = 0
  private activeSelectionMoveAppliedCellDeltaX = 0
  private activeSelectionMoveAppliedCellDeltaY = 0
  private groupedProxyMoveTarget: fabric.Group | null = null
  private groupedProxyMoveStartLeft = 0
  private groupedProxyMoveStartTop = 0
  private groupedProxyMoveAppliedCellDeltaX = 0
  private groupedProxyMoveAppliedCellDeltaY = 0

  constructor(ctx: EditorTerrainLayerManagerContext) {
    this.ctx = ctx
  }

  attachToCanvas(): void {
    const canvas =
      this.ctx.getFabricCanvas() as FabricCanvasWithTerrainBackground | null
    if (canvas === this.attachedCanvas) {
      return
    }
    if (this.attachedCanvas) {
      this.detachBackgroundHook(this.attachedCanvas)
    }
    this.attachedCanvas = canvas
    if (canvas) {
      this.attachBackgroundHook(canvas)
    }
  }

  resizeCanvas(
    _backstoreWidth: number,
    _backstoreHeight: number,
    _cssWidth: number,
    _cssHeight: number
  ): void {
    this.ctx.requestRender()
  }

  clear(): void {
    this.cancelStroke()
    this.resetContourInteraction()
    this.resetMovingContourState()
    this.resetMovingProxyState()
    this.resetActiveSelectionMoveState()
    this.resetGroupedProxyMoveState()
    this.removeAllLayerObjects()
    this.removeAllContourObjects()
    this.layers.length = 0
    this.contours.length = 0
    this.renderData.layers.length = 0
    this.renderData.contours.length = 0
    this.chunkSize = TERRAIN_CHUNK_SIZE
    this.cellSize = TERRAIN_CELL_SIZE_METERS
    this.randomSeed = DEFAULT_TERRAIN_RANDOM_SEED
    this.renderData.version = TERRAIN_DATA_VERSION
    this.renderData.cellSize = this.cellSize
    this.renderData.chunkSize = this.chunkSize
    this.renderData.randomSeed = this.randomSeed
    this.interactionEnabled = true
    this.nextLayerId = 1
    this.nextContourId = 1
    this.activeContourId = -1
    this.selectedContourId = -1
    this.activeContourPointIndex = -1
    this.contourEditMode = false
    this.ctx.requestRender()
  }

  getCellSizePx(): number {
    return Math.max(1, Math.round(this.cellSize * this.ctx.pixelsPerMeter))
  }

  pickStrokeCell(
    sceneX: number,
    sceneY: number
  ): { cellX: number; cellY: number } {
    const cellSizePx = this.getCellSizePx()
    const fallbackCellX = Math.floor(sceneX / cellSizePx)
    const fallbackCellY = Math.floor(sceneY / cellSizePx)
    if (this.renderData.version < 4) {
      return { cellX: fallbackCellX, cellY: fallbackCellY }
    }

    if (this.strokeTargetLayer) {
      const pickedTargetCell = this.pickVoronoiCellFromLayer(
        this.strokeTargetLayer,
        sceneX,
        sceneY,
        cellSizePx
      )
      if (pickedTargetCell) {
        return pickedTargetCell
      }
    }

    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]
      if (layer.internalOnly && layer.contourId <= 0) {
        continue
      }
      const pickedCell = this.pickVoronoiCellFromLayer(
        layer,
        sceneX,
        sceneY,
        cellSizePx
      )
      if (pickedCell) {
        return pickedCell
      }
    }

    return { cellX: fallbackCellX, cellY: fallbackCellY }
  }

  requestRender(): void {
    this.ctx.requestRender()
  }

  isTerrainProxy(object: fabric.Object | null): object is TerrainRegionProxy {
    if (!object) {
      return false
    }
    const terrainProxy = object as fabric.Object & Partial<TerrainRegionProxy>
    return terrainProxy.editorShape === 'terrain-region-proxy'
  }

  isTerrainContourProxy(
    object: fabric.Object | null
  ): object is TerrainContourProxy {
    if (!object) {
      return false
    }
    const contourProxy = object as fabric.Object & Partial<TerrainContourProxy>
    return contourProxy.editorShape === 'terrain-contour-proxy'
  }

  setInteractionEnabled(enabled: boolean): void {
    if (this.interactionEnabled === enabled) {
      return
    }
    this.interactionEnabled = enabled
    const canvas = this.ctx.getFabricCanvas()
    if (!enabled && canvas) {
      canvas.discardActiveObject()
    }
    for (let i = 0; i < this.layers.length; i++) {
      const proxy = this.layers[i].proxy
      if (!proxy) {
        continue
      }
      this.applyProxyInteraction(proxy, enabled)
    }
    for (let i = 0; i < this.contours.length; i++) {
      this.applyContourProxyInteraction(this.contours[i].proxy, enabled)
    }
    this.ctx.requestRender()
  }

  setContourEditMode(active: boolean): void {
    if (this.contourEditMode === active) {
      return
    }
    this.contourEditMode = active
    this.resetMovingContourState()
    const canvas = this.ctx.getFabricCanvas()
    if (canvas) {
      canvas.discardActiveObject()
    }
    if (!active) {
      this.activeContourPointIndex = -1
      this.activeContourId = -1
      this.resetContourInteraction()
    } else {
      const activeObject = canvas?.getActiveObject() ?? null
      if (this.isTerrainContourProxy(activeObject)) {
        this.setActiveContour(this.proxyToContour.get(activeObject) ?? null)
      }
    }
    this.refreshAllContourVisuals()
    this.ctx.requestRender()
  }

  handleSelectionChanged(object: fabric.Object | null): void {
    const previousSelectedContourId = this.selectedContourId
    this.selectedContourId = this.isTerrainContourProxy(object)
      ? (this.proxyToContour.get(object)?.id ?? -1)
      : -1
    if (
      !this.contourEditMode &&
      previousSelectedContourId !== this.selectedContourId
    ) {
      this.activeContourPointIndex = -1
      if (this.selectedContourId < 0) {
        this.resetContourInteraction()
      }
    }
    if (previousSelectedContourId === this.selectedContourId) {
      return
    }
    this.refreshAllContourVisuals()
    this.ctx.requestRender()
  }

  createClipboardSnapshot(
    object: fabric.Object | null
  ): TerrainClipboardLayerSnapshot | null {
    if (!this.isTerrainProxy(object)) {
      return null
    }
    const layer = this.proxyToLayer.get(object)
    if (!layer) {
      return null
    }
    return {
      materialId: layer.materialId,
      offsetCellX: layer.offsetCellX,
      offsetCellY: layer.offsetCellY,
      chunks: layer.grid.serializeChunks(),
    }
  }

  getProxyRenderLayer(object: fabric.Object | null): number | null {
    if (this.isTerrainProxy(object)) {
      const layer = this.proxyToLayer.get(object)
      if (!layer) {
        return null
      }
      return (
        layer.serializedLayer.renderLayer ??
        getDefaultTerrainRenderLayer(layer.materialId)
      )
    }
    if (this.isTerrainContourProxy(object)) {
      const contour = this.proxyToContour.get(object)
      return contour ? contour.renderLayer : null
    }
    return null
  }

  setProxyRenderLayer(
    object: fabric.Object | null,
    renderLayer: number | undefined
  ): boolean {
    if (this.isTerrainProxy(object)) {
      const layer = this.proxyToLayer.get(object)
      if (!layer) {
        return false
      }
      const nextRenderLayer =
        typeof renderLayer === 'number'
          ? renderLayer | 0
          : getDefaultTerrainRenderLayer(layer.materialId)
      if (layer.serializedLayer.renderLayer === nextRenderLayer) {
        ;(object as EditorLayeredObject).renderLayer = nextRenderLayer
        return false
      }
      layer.serializedLayer.renderLayer = nextRenderLayer
      ;(object as EditorLayeredObject).renderLayer = nextRenderLayer
      this.ctx.requestRender()
      return true
    }
    if (!this.isTerrainContourProxy(object)) {
      return false
    }
    const contour = this.proxyToContour.get(object)
    if (!contour) {
      return false
    }
    const nextRenderLayer =
      typeof renderLayer === 'number'
        ? renderLayer | 0
        : contour.fillMaterialId
          ? getDefaultTerrainRenderLayer(contour.fillMaterialId)
          : getDefaultTerrainRenderLayer('dirt')
    if (contour.renderLayer === nextRenderLayer) {
      ;(object as EditorLayeredObject).renderLayer = nextRenderLayer
      return false
    }
    contour.renderLayer = nextRenderLayer
    if (contour.fillLayer) {
      contour.fillLayer.serializedLayer.renderLayer = nextRenderLayer
    }
    const serializedContour = this.getSerializedContour(contour)
    serializedContour.renderLayer = nextRenderLayer
    ;(object as EditorLayeredObject).renderLayer = nextRenderLayer
    this.ctx.requestRender()
    return true
  }

  pasteClipboardSnapshot(
    snapshot: TerrainClipboardLayerSnapshot,
    sourceLeft: number,
    sourceTop: number,
    targetLeft: number,
    targetTop: number
  ): TerrainRegionProxy | null {
    if (snapshot.chunks.length === 0) {
      return null
    }
    const cellSizePx = this.getCellSizePx()
    const cellDeltaX = this.computeRoundedCellDelta(
      Math.round(targetLeft) - Math.round(sourceLeft),
      cellSizePx
    )
    const cellDeltaY = this.computeRoundedCellDelta(
      Math.round(targetTop) - Math.round(sourceTop),
      cellSizePx
    )
    const layer = this.createEmptyLayer(
      snapshot.materialId,
      snapshot.offsetCellX + cellDeltaX,
      snapshot.offsetCellY + cellDeltaY
    )
    layer.grid.loadSerializedChunks(snapshot.chunks)
    if (!layer.grid.hasCells()) {
      this.removeLayer(layer)
      return null
    }
    this.refreshLayerProxy(layer)
    return layer.proxy
  }

  createShapeContour(
    shape: GroundShapeType,
    centerX: number,
    centerY: number
  ): TerrainContourProxy | null {
    const points = this.buildShapeContourPoints(
      shape,
      Math.round(centerX),
      Math.round(centerY)
    )
    if (points.length < 6) {
      return null
    }
    const contour = this.createContour(points[0], points[1])
    contour.points.length = points.length
    for (let i = 0; i < points.length; i++) {
      contour.points[i] = points[i]
    }
    contour.shapeKind = shape
    this.getSerializedContour(contour).shapeKind = shape
    this.setActiveContour(contour)
    this.refreshContourProxy(contour)
    this.ctx.requestRender()
    return contour.proxy
  }

  private buildShapeContourPoints(
    shape: GroundShapeType,
    centerX: number,
    centerY: number
  ): number[] {
    if (shape === 'rect') {
      const halfWidth = Math.round((GROUND_RECT_OPTIONS.width ?? 0) * 0.5)
      const halfHeight = Math.round((GROUND_RECT_OPTIONS.height ?? 0) * 0.5)
      return [
        centerX - halfWidth,
        centerY - halfHeight,
        centerX + halfWidth,
        centerY - halfHeight,
        centerX + halfWidth,
        centerY + halfHeight,
        centerX - halfWidth,
        centerY + halfHeight,
      ]
    }
    if (shape === 'circle') {
      return this.buildOffsetContourPoints(
        CIRCLE_CONTOUR_POINT_DATA,
        centerX,
        centerY
      )
    }
    if (shape === 'triangle') {
      return this.buildOffsetContourPoints(
        TRIANGLE_POINT_DATA,
        centerX,
        centerY
      )
    }
    if (shape === 'polygon') {
      return this.buildOffsetContourPoints(POLYGON_POINT_DATA, centerX, centerY)
    }
    return []
  }

  private buildOffsetContourPoints(
    offsets: ReadonlyArray<readonly [number, number]>,
    centerX: number,
    centerY: number
  ): number[] {
    const points = new Array<number>(offsets.length * 2)
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i]
      const baseIndex = i * 2
      points[baseIndex] = centerX + offset[0]
      points[baseIndex + 1] = centerY + offset[1]
    }
    return points
  }

  private getShapeTemplatePoints(
    shapeKind: TerrainContourShapeKind
  ): ReadonlyArray<readonly [number, number]> {
    if (shapeKind === 'rect') {
      return RECT_CONTOUR_TEMPLATE_POINTS
    }
    if (shapeKind === 'circle') {
      return CIRCLE_CONTOUR_TEMPLATE_POINTS
    }
    if (shapeKind === 'triangle') {
      return TRIANGLE_CONTOUR_TEMPLATE_POINTS
    }
    return POLYGON_CONTOUR_TEMPLATE_POINTS
  }

  serialize(
    indexMap?: Map<fabric.Object, number>,
    orderedObjects?: ReadonlyArray<{ object: fabric.Object; type: ObjectType }>,
    options?: TerrainSerializeOptions
  ): MapTerrainData | undefined {
    if (this.layers.length === 0 && this.contours.length === 0) {
      return undefined
    }
    const shareData = options?.shareData === true
    const orderedLayers = this.getOrderedLayers(orderedObjects)
    const layers: MapTerrainLayer[] = []
    for (let i = 0; i < orderedLayers.length; i++) {
      const layer = orderedLayers[i]
      const serializedLayer = layer.serializedLayer
      layers.push({
        materialId: serializedLayer.materialId ?? layer.materialId,
        offsetCellX: serializedLayer.offsetCellX,
        offsetCellY: serializedLayer.offsetCellY,
        renderLayer: serializedLayer.renderLayer,
        contourId: layer.contourId > 0 ? layer.contourId : undefined,
        chunks: shareData
          ? (serializedLayer.chunks as MapTerrainLayer['chunks'])
          : layer.grid.serializeChunks(),
      })
    }
    const orderedContours = this.getOrderedContours(orderedObjects)
    const contours =
      this.contours.length > 0
        ? orderedContours.map<TerrainContourLike>((contour) => {
            const serializedContour = this.getSerializedContour(contour)
            if (shareData) {
              return serializedContour
            }
            return {
              id: serializedContour.id,
              points: contour.points.slice(),
              fillMaterialId: serializedContour.fillMaterialId,
              renderLayer: serializedContour.renderLayer,
              shapeKind: serializedContour.shapeKind,
            }
          })
        : undefined
    if (indexMap) {
      let terrainObjectIndex = 0
      for (let i = 0; i < orderedLayers.length; i++) {
        const proxy = orderedLayers[i].proxy
        if (!proxy) {
          continue
        }
        indexMap.set(proxy, terrainObjectIndex)
        terrainObjectIndex += 1
      }
      for (let i = 0; i < orderedContours.length; i++) {
        indexMap.set(orderedContours[i].proxy, terrainObjectIndex)
        terrainObjectIndex += 1
      }
    }
    return {
      version: TERRAIN_DATA_VERSION,
      cellSize: this.cellSize,
      chunkSize: this.chunkSize,
      randomSeed: this.randomSeed,
      chunks: [],
      layers,
      contours,
    }
  }

  applySerializedData(data: MapTerrainData | undefined): void {
    this.clear()
    this.chunkSize =
      data && data.chunkSize > 0
        ? Math.floor(data.chunkSize)
        : TERRAIN_CHUNK_SIZE
    this.cellSize =
      data && data.cellSize > 0 ? data.cellSize : TERRAIN_CELL_SIZE_METERS
    this.randomSeed = data?.randomSeed ?? DEFAULT_TERRAIN_RANDOM_SEED
    this.renderData.version = data?.version ?? TERRAIN_DATA_VERSION
    this.renderData.cellSize = this.cellSize
    this.renderData.chunkSize = this.chunkSize
    this.renderData.randomSeed = this.randomSeed
    const contourLayerMap = new Map<number, EditorTerrainLayer>()

    if (data?.layers && data.layers.length > 0) {
      for (let i = 0; i < data.layers.length; i++) {
        const source = data.layers[i]
        const layer = this.createLayerFromSerialized(
          source.materialId,
          source.offsetCellX | 0,
          source.offsetCellY | 0,
          source.renderLayer,
          source.chunks,
          source.contourId ?? 0,
          (source.contourId ?? 0) > 0
        )
        if (layer && layer.contourId > 0) {
          contourLayerMap.set(layer.contourId, layer)
        }
      }
    } else if (data && data.chunks.length > 0) {
      this.createLayerFromSerialized(
        inferTerrainMaterialId(data.chunks),
        0,
        0,
        undefined,
        data.chunks
      )
    }

    if (data?.contours && data.contours.length > 0) {
      for (let i = 0; i < data.contours.length; i++) {
        this.createContourFromSerialized(data.contours[i], contourLayerMap)
      }
    }

    this.ctx.requestRender()
  }

  beginStroke(brushId: TerrainBrushId, cellX: number, cellY: number): boolean {
    this.strokeBrushId = brushId
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeDirtyContours.clear()
    this.strokeCellKeys.clear()

    const brush = getTerrainBrushById(brushId)
    if (brush.mode === 'fill') {
      const layerMaterialId =
        brush.exposedTopMaterialId ?? brush.fillMaterialId ?? 'dirt'
      const targetContour = this.findContourTargetForStroke(
        layerMaterialId,
        cellX,
        cellY
      )
      if (targetContour) {
        this.strokeTargetLayer = this.ensureContourFillLayer(
          targetContour,
          layerMaterialId
        )
      } else {
        this.strokeTargetLayer =
          this.findTargetLayer(layerMaterialId, cellX, cellY) ??
          this.createEmptyLayer(layerMaterialId, cellX, cellY)
      }
    }

    return this.applyStrokeCell(cellX, cellY)
  }

  applyStrokeCell(cellX: number, cellY: number): boolean {
    const brushId = this.strokeBrushId
    if (!brushId) {
      return false
    }
    const brush = getTerrainBrushById(brushId)
    let changed = false
    if (brush.mode === 'erase') {
      for (let i = 0; i < this.layers.length; i++) {
        const layer = this.layers[i]
        if (layer.internalOnly && layer.contourId <= 0) {
          continue
        }
        if (this.setWorldCellMaterialCode(layer, cellX, cellY, 0)) {
          this.strokeDirtyLayers.add(layer)
          if (layer.contourId > 0) {
            const contour = this.getContourById(layer.contourId)
            if (contour) {
              this.strokeDirtyContours.add(contour)
            }
          }
          changed = true
        }
      }
    } else if (brush.fillMaterialId && this.strokeTargetLayer) {
      const fillCode = getTerrainMaterialCodeById(brush.fillMaterialId)
      if (
        this.setWorldCellMaterialCode(
          this.strokeTargetLayer,
          cellX,
          cellY,
          fillCode
        )
      ) {
        this.strokeDirtyLayers.add(this.strokeTargetLayer)
        if (this.strokeTargetLayer.contourId > 0) {
          const contour = this.getContourById(this.strokeTargetLayer.contourId)
          if (contour) {
            this.strokeDirtyContours.add(contour)
          }
        }
        changed = true
      }
      this.strokeCellKeys.add(this.packCellCoord(cellX, cellY))
    }
    if (changed) {
      this.strokeChanged = true
    }
    return changed
  }

  finishStroke(): boolean {
    if (!this.strokeBrushId) {
      return false
    }
    const brush = getTerrainBrushById(this.strokeBrushId)
    if (
      brush.mode === 'fill' &&
      brush.fillMaterialId &&
      brush.exposedTopMaterialId &&
      this.strokeTargetLayer
    ) {
      this.recalculateExposedTopCells(
        this.strokeTargetLayer,
        getTerrainMaterialCodeById(brush.fillMaterialId),
        getTerrainMaterialCodeById(brush.exposedTopMaterialId)
      )
    }

    if (brush.mode === 'erase') {
      const dirtyLayers = Array.from(this.strokeDirtyLayers)
      for (let i = 0; i < dirtyLayers.length; i++) {
        const layer = dirtyLayers[i]
        if (layer.materialId === 'grass') {
          this.recalculateContourTopCells(
            layer,
            getTerrainMaterialCodeById('dirt'),
            getTerrainMaterialCodeById('grass')
          )
        }
      }
      if (this.strokeDirtyContours.size > 0) {
        const dirtyContours = Array.from(this.strokeDirtyContours)
        for (let i = 0; i < dirtyContours.length; i++) {
          this.syncContourFromFillLayer(dirtyContours[i])
        }
      }
    } else if (brush.mode === 'fill' && this.strokeDirtyContours.size > 0) {
      const dirtyContours = Array.from(this.strokeDirtyContours)
      for (let i = 0; i < dirtyContours.length; i++) {
        this.syncContourFromFillLayer(dirtyContours[i])
      }
    }

    if (this.strokeDirtyLayers.size > 0) {
      const dirtyLayers = Array.from(this.strokeDirtyLayers)
      for (let i = 0; i < dirtyLayers.length; i++) {
        if (!dirtyLayers[i].internalOnly) {
          this.refreshLayerProxy(dirtyLayers[i])
        }
      }
      this.removeEmptyLayers()
      this.ctx.requestRender()
    }

    const changed = this.strokeChanged
    this.strokeBrushId = null
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeDirtyContours.clear()
    this.strokeCellKeys.clear()
    return changed
  }

  cancelStroke(): void {
    this.strokeBrushId = null
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeDirtyContours.clear()
    this.strokeCellKeys.clear()
  }

  handleSelectionContourPointerDown(opt: fabric.TPointerEventInfo): boolean {
    if (this.contourEditMode || this.contourPointerActive) {
      return false
    }
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    if (mouseEvent.button !== 0) {
      return false
    }
    const target = this.isTerrainContourProxy(opt.target ?? null)
      ? (opt.target as TerrainContourProxy)
      : null
    const contour = target ? (this.proxyToContour.get(target) ?? null) : null
    if (!contour || contour.id !== this.selectedContourId) {
      return false
    }
    if (contour.shapeKind) {
      return false
    }
    const point = canvas.getScenePoint(mouseEvent)
    const pointX = Math.round(point.x)
    const pointY = Math.round(point.y)
    const pointIndex = getNearestContourPointIndex(
      contour.points,
      pointX,
      pointY,
      this.getContourPointHitDistanceSq()
    )
    if (pointIndex < 0) {
      return false
    }
    this.contourPointerActive = true
    this.contourPointerChanged = false
    this.contourDrawingContour = null
    this.contourDragTarget = contour
    this.contourDragPointIndex = pointIndex
    this.contourDragOriginalPoints = contour.points.slice()
    this.activeContourPointIndex = pointIndex
    this.contourLastPointX = pointX
    this.contourLastPointY = pointY
    this.lockContourProxyMovement(contour.proxy)
    this.refreshContourProxy(contour)
    this.ctx.requestRender()
    return true
  }

  handleSelectionContourPointerMove(opt: fabric.TPointerEventInfo): boolean {
    if (this.contourEditMode || !this.contourPointerActive) {
      return false
    }
    return this.handleContourPointerMove(opt)
  }

  handleSelectionContourPointerUp(): boolean {
    if (this.contourEditMode || !this.contourPointerActive) {
      return false
    }
    return this.handleContourPointerUp()
  }

  handleContourPointerDown(opt: fabric.TPointerEventInfo): boolean {
    if (!this.contourEditMode) {
      return false
    }
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    if (mouseEvent.button !== 0) {
      return false
    }
    const point = canvas.getScenePoint(mouseEvent)
    const pointX = Math.round(point.x)
    const pointY = Math.round(point.y)
    const target = this.isTerrainContourProxy(opt.target ?? null)
      ? (opt.target as TerrainContourProxy)
      : null
    const contour = target ? (this.proxyToContour.get(target) ?? null) : null
    if (contour) {
      this.setActiveContour(contour)
      const pointIndex = getNearestContourPointIndex(
        contour.points,
        pointX,
        pointY,
        this.getContourPointHitDistanceSq()
      )
      if (pointIndex >= 0) {
        this.contourPointerActive = true
        this.contourPointerChanged = false
        this.contourDragTarget = contour
        this.contourDragPointIndex = pointIndex
        this.contourDragOriginalPoints = contour.points.slice()
        this.activeContourPointIndex = pointIndex
        this.contourLastPointX = pointX
        this.contourLastPointY = pointY
        this.lockContourProxyMovement(contour.proxy)
        this.refreshContourProxy(contour)
      }
      this.activeContourPointIndex = pointIndex
      this.refreshContourProxy(contour)
      this.ctx.requestRender()
      return true
    }

    const newContour = this.createContour(pointX, pointY)
    this.setActiveContour(newContour)
    this.contourPointerActive = true
    this.contourPointerChanged = false
    this.contourDrawingContour = newContour
    this.contourDragTarget = null
    this.contourDragPointIndex = -1
    this.contourLastPointX = pointX
    this.contourLastPointY = pointY
    canvas.discardActiveObject()
    this.ctx.requestRender()
    return true
  }

  handleContourPointerMove(opt: fabric.TPointerEventInfo): boolean {
    if (!this.contourPointerActive) {
      return false
    }
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return false
    }
    const mouseEvent = opt.e as MouseEvent
    const point = canvas.getScenePoint(mouseEvent)
    const pointX = Math.round(point.x)
    const pointY = Math.round(point.y)
    if (this.contourDragTarget && this.contourDragPointIndex >= 0) {
      if (
        pointX !== this.contourLastPointX ||
        pointY !== this.contourLastPointY
      ) {
        this.contourPointerChanged = true
        this.moveContourPoint(
          this.contourDragTarget,
          this.contourDragPointIndex,
          pointX,
          pointY
        )
        this.contourLastPointX = pointX
        this.contourLastPointY = pointY
      }
      return true
    }
    if (!this.contourDrawingContour) {
      return true
    }
    const dx = pointX - this.contourLastPointX
    const dy = pointY - this.contourLastPointY
    if (
      dx * dx + dy * dy <
      TERRAIN_CONTOUR_SAMPLE_DISTANCE * TERRAIN_CONTOUR_SAMPLE_DISTANCE
    ) {
      return true
    }
    this.contourPointerChanged = true
    this.contourDrawingContour.points.push(pointX, pointY)
    this.contourLastPointX = pointX
    this.contourLastPointY = pointY
    this.refreshContourProxy(this.contourDrawingContour)
    this.ctx.requestRender()
    return true
  }

  handleContourPointerUp(): boolean {
    if (!this.contourPointerActive) {
      return false
    }
    let changed = false
    if (this.contourDragTarget) {
      changed = this.contourPointerChanged
      if (changed && this.contourDragOriginalPoints) {
        this.applyContourFillDelta(
          this.contourDragTarget,
          this.contourDragOriginalPoints
        )
      }
    } else if (this.contourDrawingContour) {
      const pointCount = this.contourDrawingContour.points.length / 2
      if (pointCount < TERRAIN_CONTOUR_MIN_POINT_COUNT) {
        this.removeContour(this.contourDrawingContour)
      } else {
        this.refreshContourProxy(this.contourDrawingContour)
        changed = true
      }
    }
    this.resetContourInteraction()
    this.refreshAllContourVisuals()
    this.ctx.requestRender()
    return changed
  }

  getContourContextMenuRequest(
    target: fabric.Object | null,
    event: MouseEvent
  ): {
    target: TerrainContourProxy
    actions: (
      | 'fill'
      | 'add'
      | 'remove'
      | 'commonProperties'
      | 'rename'
      | 'lock'
      | 'delete'
    )[]
    pointIndex: number
    insertX: number
    insertY: number
  } | null {
    if (!this.isTerrainContourProxy(target)) {
      return null
    }
    const contour = this.proxyToContour.get(target)
    if (!contour) {
      return null
    }
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return null
    }
    const point = canvas.getScenePoint(event)
    const pointIndex = getNearestContourPointIndex(
      contour.points,
      Math.round(point.x),
      Math.round(point.y),
      this.getContourPointHitDistanceSq()
    )
    const edge = getNearestContourEdge(
      contour.points,
      Math.round(point.x),
      Math.round(point.y),
      this.getContourEdgeHitDistanceSq()
    )
    this.setActiveContour(contour)
    if (pointIndex >= 0) {
      this.activeContourPointIndex = pointIndex
      this.refreshContourProxy(contour)
      return {
        target,
        actions: contour.shapeKind
          ? ['fill', 'commonProperties', 'rename', 'lock', 'delete']
          : ['remove', 'fill', 'commonProperties', 'rename', 'lock', 'delete'],
        pointIndex,
        insertX: 0,
        insertY: 0,
      }
    }
    if (edge && !contour.shapeKind) {
      this.activeContourPointIndex = -1
      this.refreshContourProxy(contour)
      return {
        target,
        actions: [
          'add',
          'fill',
          'commonProperties',
          'rename',
          'lock',
          'delete',
        ],
        pointIndex: edge.insertAfterIndex,
        insertX: edge.x,
        insertY: edge.y,
      }
    }
    this.activeContourPointIndex = -1
    this.refreshContourProxy(contour)
    return {
      target,
      actions: ['fill', 'commonProperties', 'rename', 'lock', 'delete'],
      pointIndex: -1,
      insertX: 0,
      insertY: 0,
    }
  }

  insertContourPoint(
    object: fabric.Object | null,
    pointIndex: number,
    pointX: number,
    pointY: number
  ): boolean {
    if (!this.isTerrainContourProxy(object)) {
      return false
    }
    const contour = this.proxyToContour.get(object)
    if (!contour) {
      return false
    }
    if (contour.shapeKind) {
      return false
    }
    const pointCount = contour.points.length / 2
    if (pointIndex < 0 || pointIndex >= pointCount) {
      return false
    }
    const previousPoints = contour.points.slice()
    const insertOffset = (pointIndex + 1) * 2
    contour.points.splice(
      insertOffset,
      0,
      Math.round(pointX),
      Math.round(pointY)
    )
    this.activeContourPointIndex = pointIndex + 1
    this.refreshContourProxy(contour)
    this.applyContourFillDelta(contour, previousPoints)
    this.ctx.requestRender()
    return true
  }

  removeContourPoint(
    object: fabric.Object | null,
    pointIndex: number
  ): boolean {
    if (!this.isTerrainContourProxy(object)) {
      return false
    }
    const contour = this.proxyToContour.get(object)
    if (!contour) {
      return false
    }
    if (contour.shapeKind) {
      return false
    }
    const pointCount = contour.points.length / 2
    if (
      pointIndex < 0 ||
      pointIndex >= pointCount ||
      pointCount <= TERRAIN_CONTOUR_MIN_POINT_COUNT
    ) {
      return false
    }
    const previousPoints = contour.points.slice()
    contour.points.splice(pointIndex * 2, 2)
    this.activeContourPointIndex = Math.min(
      this.activeContourPointIndex,
      contour.points.length / 2 - 1
    )
    this.refreshContourProxy(contour)
    this.applyContourFillDelta(contour, previousPoints)
    this.ctx.requestRender()
    return true
  }

  fillContour(
    object: fabric.Object | null,
    materialId: TerrainMaterialId
  ): boolean {
    if (!this.isTerrainContourProxy(object)) {
      return false
    }
    const contour = this.proxyToContour.get(object)
    if (!contour) {
      return false
    }
    if (
      !contour.fillMaterialId &&
      contour.renderLayer === getDefaultTerrainRenderLayer('dirt')
    ) {
      contour.renderLayer = getDefaultTerrainRenderLayer(materialId)
    }
    contour.fillMaterialId = materialId
    ;(contour.proxy as EditorLayeredObject).renderLayer = contour.renderLayer
    const serializedContour = this.getSerializedContour(contour)
    serializedContour.fillMaterialId = materialId
    serializedContour.renderLayer = contour.renderLayer
    const changed = this.rasterizeContourFill(contour)
    this.ctx.requestRender()
    return changed
  }

  handleProxyModified(object: fabric.Object | null): boolean {
    if (this.isTerrainContourProxy(object)) {
      return this.handleContourModified(object)
    }
    if (!this.isTerrainProxy(object)) {
      return false
    }
    const cellSizePx = this.getCellSizePx()
    const currentLeft = Math.round(object.left ?? object.terrainAnchorLeft)
    const currentTop = Math.round(object.top ?? object.terrainAnchorTop)
    const deltaX = currentLeft - object.terrainAnchorLeft
    const deltaY = currentTop - object.terrainAnchorTop
    const cellDeltaX = this.computeRoundedCellDelta(deltaX, cellSizePx)
    const cellDeltaY = this.computeRoundedCellDelta(deltaY, cellSizePx)
    if (cellDeltaX === 0 && cellDeltaY === 0) {
      object.left = object.terrainAnchorLeft
      object.top = object.terrainAnchorTop
      object.setCoords()
      this.ctx.requestRender()
      return false
    }
    return this.moveProxyByCellDelta(object, cellDeltaX, cellDeltaY)
  }

  moveProxyByCellDelta(
    object: fabric.Object | null,
    cellDeltaX: number,
    cellDeltaY: number
  ): boolean {
    if (
      !this.isTerrainProxy(object) ||
      (cellDeltaX === 0 && cellDeltaY === 0)
    ) {
      return false
    }
    const layer = this.proxyToLayer.get(object)
    if (!layer) {
      return false
    }
    this.applyLayerCellDelta(layer, cellDeltaX, cellDeltaY)
    const cellSizePx = this.getCellSizePx()
    object.terrainAnchorLeft += cellDeltaX * cellSizePx
    object.terrainAnchorTop += cellDeltaY * cellSizePx
    object.left = object.terrainAnchorLeft
    object.top = object.terrainAnchorTop
    object.setCoords()
    this.ctx.requestRender()
    return true
  }

  handleMovingTarget(target: fabric.Object | null): boolean {
    if (this.isTerrainContourProxy(target)) {
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.handleContourMoving(target)
    }
    if (this.isTerrainProxy(target)) {
      this.resetMovingContourState()
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.handleProxyMoving(target)
    }
    this.resetMovingContourState()
    this.resetMovingProxyState()
    if (target instanceof fabric.ActiveSelection) {
      this.resetGroupedProxyMoveState()
      return this.handleActiveSelectionMoving(target)
    }
    const groupedProxies = this.collectTerrainGroupedProxies(target)
    if (groupedProxies.length > 0 && target instanceof fabric.Group) {
      this.resetActiveSelectionMoveState()
      return this.handleGroupedProxyMoving(target, groupedProxies)
    }
    this.resetGroupedProxyMoveState()
    this.resetActiveSelectionMoveState()
    return false
  }

  handleModifiedTarget(target: fabric.Object | null): boolean {
    if (this.isTerrainContourProxy(target)) {
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.finalizeContourMove(target)
    }
    if (this.isTerrainProxy(target)) {
      this.resetMovingContourState()
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.finalizeProxyMove(target)
    }
    this.resetMovingContourState()
    this.resetMovingProxyState()
    if (target instanceof fabric.ActiveSelection) {
      this.resetGroupedProxyMoveState()
      return this.finalizeActiveSelectionMove(target)
    }
    const groupedProxies = this.collectTerrainGroupedProxies(target)
    if (groupedProxies.length > 0 && target instanceof fabric.Group) {
      this.resetActiveSelectionMoveState()
      return this.finalizeGroupedProxyMove(target, groupedProxies)
    }
    this.resetGroupedProxyMoveState()
    this.resetActiveSelectionMoveState()
    return false
  }

  deleteProxyObjects(objects: readonly fabric.Object[]): boolean {
    let changed = false
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i]
      if (this.isTerrainContourProxy(object)) {
        const contour = this.proxyToContour.get(object)
        if (!contour) {
          continue
        }
        this.removeContour(contour)
        changed = true
        continue
      }
      if (!this.isTerrainProxy(object)) {
        continue
      }
      const layer = this.proxyToLayer.get(object)
      if (!layer) {
        continue
      }
      this.removeLayer(layer)
      changed = true
    }
    if (changed) {
      this.ctx.requestRender()
    }
    return changed
  }

  private attachBackgroundHook(
    canvas: FabricCanvasWithTerrainBackground
  ): void {
    if (canvas.__terrainOriginalRenderBackground) {
      this.ctx.requestRender()
      return
    }
    const original = canvas._renderBackground.bind(canvas)
    canvas.__terrainOriginalRenderBackground = original
    canvas._renderBackground = (ctx: CanvasRenderingContext2D) => {
      original(ctx)
      this.renderTerrain(ctx)
    }
    this.ctx.requestRender()
  }

  private detachBackgroundHook(
    canvas: FabricCanvasWithTerrainBackground
  ): void {
    const original = canvas.__terrainOriginalRenderBackground
    if (!original) {
      return
    }
    canvas._renderBackground = original
    delete canvas.__terrainOriginalRenderBackground
  }

  private renderTerrain(terrainCtx: CanvasRenderingContext2D): void {
    if (this.layers.length === 0) {
      return
    }
    const fabricCanvas = this.attachedCanvas
    const viewportTransform = fabricCanvas?.viewportTransform
    const transform = viewportTransform ?? [1, 0, 0, 1, 0, 0]
    terrainCtx.save()
    terrainCtx.transform(
      transform[0],
      transform[1],
      transform[2],
      transform[3],
      transform[4],
      transform[5]
    )
    terrainCtx.imageSmoothingEnabled = false
    const movingContour = this.getMovingContourPreview()
    const movingLayer = movingContour?.fillLayer?.serializedLayer
    if (!movingContour || !movingLayer) {
      TerrainRenderer.drawTerrain(
        terrainCtx,
        this.renderData,
        this.getCellSizePx(),
        {
          drawStroke: true,
        }
      )
      terrainCtx.restore()
      return
    }
    TerrainRenderer.drawTerrain(
      terrainCtx,
      this.renderData,
      this.getCellSizePx(),
      {
        drawStroke: true,
        shouldDrawLayer: (layer) => layer.sourceLayer !== movingLayer,
      }
    )
    TerrainRenderer.drawTerrain(
      terrainCtx,
      this.renderData,
      this.getCellSizePx(),
      {
        drawStroke: true,
        shouldDrawLayer: (layer) => layer.sourceLayer === movingLayer,
        getLayerPixelOffset: () => ({
          x: this.movingContourAppliedDeltaX,
          y: this.movingContourAppliedDeltaY,
        }),
      }
    )
    terrainCtx.restore()
  }

  private handleContourModified(proxy: TerrainContourProxy): boolean {
    const contour = this.proxyToContour.get(proxy)
    if (!contour) {
      return false
    }
    const scaleX = proxy.scaleX ?? 1
    const scaleY = proxy.scaleY ?? 1
    if (contour.shapeKind && (scaleX !== 1 || scaleY !== 1)) {
      const previousPoints = contour.points.slice()
      const currentLeft = Math.round(
        proxy.left ?? proxy.terrainContourAnchorLeft
      )
      const currentTop = Math.round(proxy.top ?? proxy.terrainContourAnchorTop)
      const nextWidth = Math.max(
        1,
        Math.round(proxy.terrainContourWidth * scaleX)
      )
      const nextHeight = Math.max(
        1,
        Math.round(proxy.terrainContourHeight * scaleY)
      )
      this.applyShapeTemplateToContour(
        contour,
        this.getShapeTemplatePoints(contour.shapeKind),
        {
          minX: currentLeft,
          maxX: currentLeft + nextWidth,
          minY: currentTop,
          maxY: currentTop + nextHeight,
        }
      )
      proxy.scaleX = 1
      proxy.scaleY = 1
      this.refreshContourProxy(contour)
      this.applyContourFillDelta(contour, previousPoints)
      this.ctx.requestRender()
      return true
    }
    const currentLeft = Math.round(proxy.left ?? proxy.terrainContourAnchorLeft)
    const currentTop = Math.round(proxy.top ?? proxy.terrainContourAnchorTop)
    const deltaX = currentLeft - proxy.terrainContourAnchorLeft
    const deltaY = currentTop - proxy.terrainContourAnchorTop
    if (deltaX === 0 && deltaY === 0) {
      proxy.left = proxy.terrainContourAnchorLeft
      proxy.top = proxy.terrainContourAnchorTop
      proxy.setCoords()
      this.ctx.requestRender()
      return false
    }
    const cellSizePx = this.getCellSizePx()
    const cellDeltaX = this.computeRoundedCellDelta(deltaX, cellSizePx)
    const cellDeltaY = this.computeRoundedCellDelta(deltaY, cellSizePx)
    if (cellDeltaX === 0 && cellDeltaY === 0) {
      proxy.left = proxy.terrainContourAnchorLeft
      proxy.top = proxy.terrainContourAnchorTop
      proxy.setCoords()
      this.ctx.requestRender()
      return false
    }
    const snappedDeltaX = cellDeltaX * cellSizePx
    const snappedDeltaY = cellDeltaY * cellSizePx
    for (let i = 0; i < contour.points.length; i += 2) {
      contour.points[i] += snappedDeltaX
      contour.points[i + 1] += snappedDeltaY
    }
    if (contour.fillLayer) {
      this.applyLayerCellDelta(contour.fillLayer, cellDeltaX, cellDeltaY)
    }
    this.refreshContourProxy(contour)
    this.ctx.requestRender()
    return true
  }

  private handleContourMoving(proxy: TerrainContourProxy): boolean {
    const contour = this.proxyToContour.get(proxy)
    if (!contour) {
      this.resetMovingContourState(proxy)
      return false
    }
    if (this.contourDragTarget === contour && this.contourDragPointIndex >= 0) {
      proxy.left = proxy.terrainContourAnchorLeft
      proxy.top = proxy.terrainContourAnchorTop
      proxy.setCoords()
      return false
    }
    this.ensureMovingContourState(proxy)
    const currentLeft = Math.round(proxy.left ?? this.movingContourStartLeft)
    const currentTop = Math.round(proxy.top ?? this.movingContourStartTop)
    const totalDeltaX = currentLeft - this.movingContourStartLeft
    const totalDeltaY = currentTop - this.movingContourStartTop
    if (
      totalDeltaX === this.movingContourAppliedDeltaX &&
      totalDeltaY === this.movingContourAppliedDeltaY
    ) {
      return false
    }
    this.movingContourAppliedDeltaX = totalDeltaX
    this.movingContourAppliedDeltaY = totalDeltaY
    this.ctx.requestRender()
    return true
  }

  private finalizeContourMove(proxy: TerrainContourProxy): boolean {
    if (this.movingContourTarget !== proxy) {
      return this.handleContourModified(proxy)
    }
    const contour = this.proxyToContour.get(proxy)
    if (!contour) {
      this.resetMovingContourState(proxy)
      return false
    }
    const changed =
      this.movingContourAppliedDeltaX !== 0 ||
      this.movingContourAppliedDeltaY !== 0
    if (changed) {
      const cellSizePx = this.getCellSizePx()
      const cellDeltaX = this.computeRoundedCellDelta(
        this.movingContourAppliedDeltaX,
        cellSizePx
      )
      const cellDeltaY = this.computeRoundedCellDelta(
        this.movingContourAppliedDeltaY,
        cellSizePx
      )
      if (cellDeltaX === 0 && cellDeltaY === 0) {
        proxy.left = proxy.terrainContourAnchorLeft
        proxy.top = proxy.terrainContourAnchorTop
        proxy.setCoords()
        this.resetMovingContourState(proxy)
        this.ctx.requestRender()
        return false
      }
      const snappedDeltaX = cellDeltaX * cellSizePx
      const snappedDeltaY = cellDeltaY * cellSizePx
      for (let i = 0; i < contour.points.length; i += 2) {
        contour.points[i] += snappedDeltaX
        contour.points[i + 1] += snappedDeltaY
      }
      if (contour.fillLayer) {
        this.applyLayerCellDelta(contour.fillLayer, cellDeltaX, cellDeltaY)
      }
      this.refreshContourProxy(contour)
    }
    proxy.left = proxy.terrainContourAnchorLeft
    proxy.top = proxy.terrainContourAnchorTop
    proxy.setCoords()
    this.resetMovingContourState(proxy)
    this.ctx.requestRender()
    return changed
  }

  private createLayerFromSerialized(
    materialId: TerrainMaterialId,
    offsetCellX: number,
    offsetCellY: number,
    renderLayer: number | undefined,
    chunks: ReadonlyArray<{
      chunkX: number
      chunkY: number
      cells: ArrayLike<number>
    }>,
    contourId = 0,
    internalOnly = false
  ): EditorTerrainLayer | null {
    const layer = this.createEmptyLayer(
      materialId,
      offsetCellX,
      offsetCellY,
      renderLayer,
      contourId,
      internalOnly
    )
    layer.grid.loadSerializedChunks(chunks)
    if (!layer.grid.hasCells()) {
      this.removeLayer(layer)
      return null
    }
    if (!layer.internalOnly) {
      this.refreshLayerProxy(layer)
    }
    return layer
  }

  private createEmptyLayer(
    materialId: TerrainMaterialId,
    offsetCellX: number,
    offsetCellY: number,
    renderLayer?: number,
    contourId = 0,
    internalOnly = false
  ): EditorTerrainLayer {
    const grid = new TerrainChunkGrid(this.chunkSize, this.randomSeed)
    const layer: EditorTerrainLayer = {
      id: this.nextLayerId,
      materialId,
      offsetCellX,
      offsetCellY,
      grid,
      serializedLayer: {
        offsetCellX,
        offsetCellY,
        materialId,
        renderLayer:
          typeof renderLayer === 'number'
            ? renderLayer | 0
            : getDefaultTerrainRenderLayer(materialId),
        contourId: contourId > 0 ? contourId : undefined,
        chunks: grid.getChunks(),
      },
      contourId,
      internalOnly,
      proxy: null,
    }
    this.nextLayerId += 1
    this.layers.push(layer)
    this.renderData.layers.push(layer.serializedLayer)
    return layer
  }

  private findTargetLayer(
    materialId: TerrainMaterialId,
    worldCellX: number,
    worldCellY: number
  ): EditorTerrainLayer | null {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]
      if (layer.internalOnly) {
        continue
      }
      if (layer.materialId !== materialId) {
        continue
      }
      const localCellX = worldCellX - layer.offsetCellX
      const localCellY = worldCellY - layer.offsetCellY
      if (
        layer.grid.isCellSolid(localCellX, localCellY) ||
        layer.grid.isCellSolid(localCellX - 1, localCellY) ||
        layer.grid.isCellSolid(localCellX + 1, localCellY) ||
        layer.grid.isCellSolid(localCellX, localCellY - 1) ||
        layer.grid.isCellSolid(localCellX, localCellY + 1)
      ) {
        return layer
      }
    }
    return null
  }

  private findContourTargetForStroke(
    materialId: TerrainMaterialId,
    worldCellX: number,
    worldCellY: number
  ): EditorTerrainContour | null {
    const cellSizePx = this.getCellSizePx()
    const centerX = worldCellX * cellSizePx + Math.floor(cellSizePx / 2)
    const centerY = worldCellY * cellSizePx + Math.floor(cellSizePx / 2)
    const edgeDistanceSq = Math.max(4, cellSizePx * cellSizePx)
    for (let i = this.contours.length - 1; i >= 0; i--) {
      const contour = this.contours[i]
      if (contour.fillMaterialId !== materialId || !contour.fillLayer) {
        continue
      }
      if (
        pointInClosedContourScaled2(contour.points, centerX * 2, centerY * 2)
      ) {
        return contour
      }
      if (
        getNearestContourEdge(contour.points, centerX, centerY, edgeDistanceSq)
      ) {
        return contour
      }
      const layer = contour.fillLayer
      const localCellX = worldCellX - layer.offsetCellX
      const localCellY = worldCellY - layer.offsetCellY
      if (
        layer.grid.isCellSolid(localCellX, localCellY) ||
        layer.grid.isCellSolid(localCellX - 1, localCellY) ||
        layer.grid.isCellSolid(localCellX + 1, localCellY) ||
        layer.grid.isCellSolid(localCellX, localCellY - 1) ||
        layer.grid.isCellSolid(localCellX, localCellY + 1)
      ) {
        return contour
      }
    }
    return null
  }

  private pickVoronoiCellFromLayer(
    layer: EditorTerrainLayer,
    sceneX: number,
    sceneY: number,
    cellSizePx: number
  ): { cellX: number; cellY: number } | null {
    const proxy = layer.proxy
    if (proxy) {
      const bounds = proxy.getBoundingRect()
      const minX = Math.floor(bounds.left) - cellSizePx
      const minY = Math.floor(bounds.top) - cellSizePx
      const maxX = Math.ceil(bounds.left + bounds.width) + cellSizePx
      const maxY = Math.ceil(bounds.top + bounds.height) + cellSizePx
      if (sceneX < minX || sceneY < minY || sceneX > maxX || sceneY > maxY) {
        return null
      }
    }

    const build = getVoronoiLayerBuild(
      {
        version: this.renderData.version,
        cellSize: this.renderData.cellSize,
        chunkSize: this.renderData.chunkSize,
        randomSeed: this.renderData.randomSeed,
        chunks: layer.grid.getChunks(),
        offsetCellX: layer.offsetCellX,
        offsetCellY: layer.offsetCellY,
        materialId: layer.materialId,
        renderLayer: layer.serializedLayer.renderLayer,
        sourceLayer: layer.serializedLayer,
      },
      cellSizePx
    )
    return build.pickCellAt(sceneX, sceneY)
  }

  private setWorldCellMaterialCode(
    layer: EditorTerrainLayer,
    worldCellX: number,
    worldCellY: number,
    code: number
  ): boolean {
    return layer.grid.setCellMaterialCode(
      worldCellX - layer.offsetCellX,
      worldCellY - layer.offsetCellY,
      code
    )
  }

  private recalculateExposedTopCells(
    layer: EditorTerrainLayer,
    fillCode: number,
    topCode: number
  ): void {
    for (const packedCoord of this.strokeCellKeys) {
      const cellX = this.unpackCellX(packedCoord)
      const cellY = this.unpackCellY(packedCoord)
      this.recalculateSingleTopCell(layer, cellX, cellY, fillCode, topCode)
      this.recalculateSingleTopCell(layer, cellX, cellY + 1, fillCode, topCode)
    }
    this.strokeDirtyLayers.add(layer)
  }

  private recalculateSingleTopCell(
    layer: EditorTerrainLayer,
    worldCellX: number,
    worldCellY: number,
    fillCode: number,
    topCode: number
  ): void {
    const localCellX = worldCellX - layer.offsetCellX
    const localCellY = worldCellY - layer.offsetCellY
    const currentCode = layer.grid.getCellMaterialCode(localCellX, localCellY)
    if (currentCode !== fillCode && currentCode !== topCode) {
      return
    }
    const aboveSolid = layer.grid.isCellSolid(localCellX, localCellY - 1)
    layer.grid.setCellMaterialCode(
      localCellX,
      localCellY,
      aboveSolid ? fillCode : topCode
    )
  }

  private refreshLayerProxy(layer: EditorTerrainLayer): void {
    if (!layer.grid.hasCells()) {
      return
    }
    const rects = TerrainCollisionBuilder.buildRectangles({
      version: TERRAIN_DATA_VERSION,
      cellSize: this.cellSize,
      chunkSize: this.chunkSize,
      randomSeed: this.randomSeed,
      chunks: layer.grid.getChunks(),
    })
    if (rects.length === 0) {
      return
    }
    const cellSizePx = this.getCellSizePx()
    let minCellX = rects[0].cellX
    let minCellY = rects[0].cellY
    for (let i = 1; i < rects.length; i++) {
      const rect = rects[i]
      if (rect.cellX < minCellX) {
        minCellX = rect.cellX
      }
      if (rect.cellY < minCellY) {
        minCellY = rect.cellY
      }
    }
    const children = new Array<fabric.Rect>(rects.length)
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]
      children[i] = new fabric.Rect({
        left: (rect.cellX - minCellX) * cellSizePx,
        top: (rect.cellY - minCellY) * cellSizePx,
        width: rect.widthCells * cellSizePx,
        height: rect.heightCells * cellSizePx,
        originX: 'left',
        originY: 'top',
        fill: 'rgba(255,255,255,0.002)',
        strokeWidth: 0,
        selectable: false,
        evented: false,
        objectCaching: false,
      })
    }
    const anchorLeft = (layer.offsetCellX + minCellX) * cellSizePx
    const anchorTop = (layer.offsetCellY + minCellY) * cellSizePx
    if (!layer.proxy) {
      const generatedName = this.buildGeneratedLayerName(layer.materialId)
      const proxy = new fabric.Group(children, {
        left: anchorLeft,
        top: anchorTop,
        originX: 'left',
        originY: 'top',
        selectable: true,
        hasControls: false,
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        objectCaching: false,
        hoverCursor: 'move',
        moveCursor: 'move',
      }) as TerrainRegionProxy
      proxy.editorShape = 'terrain-region-proxy'
      proxy.terrainLayerId = layer.id
      proxy.terrainMaterialId = layer.materialId
      proxy.terrainCellKeys = []
      proxy.terrainAnchorLeft = anchorLeft
      proxy.terrainAnchorTop = anchorTop
      ;(proxy as EditorLayeredObject).renderLayer =
        layer.serializedLayer.renderLayer
      this.applyProxyInteraction(proxy, this.interactionEnabled)
      layer.proxy = proxy
      this.proxyToLayer.set(proxy, layer)
      const canvas = this.ctx.getFabricCanvas()
      canvas?.add(proxy)
      this.ctx.registerEditorObject(ObjectType.Terrain, proxy, generatedName)
      proxy.setCoords()
      return
    }

    const proxy = layer.proxy
    const existingObjects = proxy.getObjects().slice()
    for (let i = 0; i < existingObjects.length; i++) {
      proxy.remove(existingObjects[i])
    }
    for (let i = 0; i < children.length; i++) {
      proxy.add(children[i])
    }
    proxy.terrainLayerId = layer.id
    proxy.terrainMaterialId = layer.materialId
    proxy.terrainAnchorLeft = anchorLeft
    proxy.terrainAnchorTop = anchorTop
    proxy.left = anchorLeft
    proxy.top = anchorTop
    ;(proxy as EditorLayeredObject).renderLayer =
      layer.serializedLayer.renderLayer
    this.applyProxyInteraction(proxy, this.interactionEnabled)
    proxy.setCoords()
  }

  private removeEmptyLayers(): void {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      if (!this.layers[i].grid.hasCells()) {
        this.removeLayer(this.layers[i])
      }
    }
  }

  private removeLayer(layer: EditorTerrainLayer): void {
    if (layer.proxy) {
      this.proxyToLayer.delete(layer.proxy)
      this.ctx.unregisterEditorObject(layer.proxy)
      if (layer.proxy.canvas) {
        layer.proxy.canvas.remove(layer.proxy)
      }
      layer.proxy = null
    }
    const layerIndex = this.layers.indexOf(layer)
    if (layerIndex !== -1) {
      this.layers.splice(layerIndex, 1)
      this.renderData.layers.splice(layerIndex, 1)
    }
  }

  private removeAllLayerObjects(): void {
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (!layer.proxy) {
        continue
      }
      this.proxyToLayer.delete(layer.proxy)
      this.ctx.unregisterEditorObject(layer.proxy)
      if (layer.proxy.canvas) {
        layer.proxy.canvas.remove(layer.proxy)
      }
      layer.proxy = null
    }
  }

  private removeAllContourObjects(): void {
    for (let i = 0; i < this.contours.length; i++) {
      const contour = this.contours[i]
      this.proxyToContour.delete(contour.proxy)
      this.ctx.unregisterEditorObject(contour.proxy)
      if (contour.proxy.canvas) {
        contour.proxy.canvas.remove(contour.proxy)
      }
    }
  }

  private createContour(startX: number, startY: number): EditorTerrainContour {
    const contourId = this.nextContourId
    this.nextContourId += 1
    const proxy = new fabric.Group([], {
      left: startX,
      top: startY,
      originX: 'left',
      originY: 'top',
      selectable: true,
      hasControls: false,
      hasBorders: false,
      lockRotation: true,
      lockScalingX: true,
      lockScalingY: true,
      objectCaching: false,
      hoverCursor: 'default',
      moveCursor: 'move',
    }) as TerrainContourProxy
    proxy.editorShape = 'terrain-contour-proxy'
    proxy.terrainContourId = contourId
    proxy.terrainContourAnchorLeft = startX
    proxy.terrainContourAnchorTop = startY
    proxy.terrainContourWidth = 1
    proxy.terrainContourHeight = 1
    ;(proxy as EditorLayeredObject).renderLayer =
      getDefaultTerrainRenderLayer('dirt')
    const contour: EditorTerrainContour = {
      id: contourId,
      points: [startX, startY],
      fillMaterialId: null,
      renderLayer: getDefaultTerrainRenderLayer('dirt'),
      shapeKind: null,
      fillLayer: null,
      proxy,
    }
    this.contours.push(contour)
    this.renderData.contours.push({
      id: contour.id,
      points: contour.points,
      renderLayer: contour.renderLayer,
    })
    this.proxyToContour.set(proxy, contour)
    this.applyContourProxyInteraction(proxy, this.interactionEnabled)
    this.refreshContourProxy(contour)
    const canvas = this.ctx.getFabricCanvas()
    canvas?.add(proxy)
    this.ctx.registerEditorObject(
      ObjectType.Terrain,
      proxy,
      this.buildGeneratedContourName()
    )
    return contour
  }

  private createContourFromSerialized(
    source: TerrainContourLike,
    contourLayerMap: ReadonlyMap<number, EditorTerrainLayer>
  ): void {
    if (!Array.isArray(source.points) || source.points.length < 6) {
      return
    }
    const contour = this.createContour(
      source.points[0] | 0,
      source.points[1] | 0
    )
    contour.id = source.id | 0
    contour.points.length = source.points.length
    for (let i = 0; i < source.points.length; i++) {
      contour.points[i] = source.points[i] | 0
    }
    contour.fillMaterialId = source.fillMaterialId ?? null
    contour.shapeKind = this.isSupportedShapeKind(source.shapeKind)
      ? source.shapeKind
      : null
    contour.renderLayer =
      typeof source.renderLayer === 'number'
        ? source.renderLayer | 0
        : contour.fillMaterialId
          ? getDefaultTerrainRenderLayer(contour.fillMaterialId)
          : getDefaultTerrainRenderLayer('dirt')
    contour.fillLayer = contourLayerMap.get(contour.id) ?? null
    this.nextContourId = Math.max(this.nextContourId, contour.id + 1)
    const serializedContour = this.getSerializedContour(contour)
    serializedContour.id = contour.id
    serializedContour.fillMaterialId = contour.fillMaterialId ?? undefined
    serializedContour.renderLayer = contour.renderLayer
    serializedContour.shapeKind = contour.shapeKind ?? undefined
    ;(contour.proxy as EditorLayeredObject).renderLayer = contour.renderLayer
    contour.proxy.terrainContourId = contour.id
    this.refreshContourProxy(contour)
    if (contour.fillMaterialId && !contour.fillLayer) {
      this.rasterizeContourFill(contour)
    }
  }

  private getSerializedContour(
    contour: EditorTerrainContour
  ): TerrainContourLike {
    for (let i = 0; i < this.renderData.contours.length; i++) {
      const candidate = this.renderData.contours[i]
      if (candidate.id === contour.id) {
        return candidate
      }
    }
    const serializedContour: TerrainContourLike = {
      id: contour.id,
      points: contour.points,
      fillMaterialId: contour.fillMaterialId ?? undefined,
      renderLayer: contour.renderLayer,
      shapeKind: contour.shapeKind ?? undefined,
    }
    this.renderData.contours.push(serializedContour)
    return serializedContour
  }

  private isSupportedShapeKind(
    shapeKind: string | undefined
  ): shapeKind is TerrainContourShapeKind {
    return (
      shapeKind === 'rect' ||
      shapeKind === 'triangle' ||
      shapeKind === 'circle' ||
      shapeKind === 'polygon'
    )
  }

  private buildGeneratedContourName(): string {
    return `${localizer.t('editor_terrain_brush_contour')}${this.contours.length}`
  }

  private setActiveContour(contour: EditorTerrainContour | null): void {
    const nextId = contour ? contour.id : -1
    if (this.activeContourId === nextId) {
      return
    }
    const previous = this.getContourById(this.activeContourId)
    this.activeContourId = nextId
    this.activeContourPointIndex = -1
    if (previous) {
      this.refreshContourProxy(previous)
    }
    if (contour) {
      this.refreshContourProxy(contour)
    }
  }

  private getContourById(id: number): EditorTerrainContour | null {
    for (let i = 0; i < this.contours.length; i++) {
      if (this.contours[i].id === id) {
        return this.contours[i]
      }
    }
    return null
  }

  private refreshAllContourVisuals(): void {
    for (let i = 0; i < this.contours.length; i++) {
      this.refreshContourProxy(this.contours[i])
    }
  }

  private refreshContourProxy(contour: EditorTerrainContour): void {
    const bounds = getContourBounds(contour.points)
    if (!bounds) {
      return
    }
    const children: fabric.Object[] = []
    const showContourGuides =
      (this.contourEditMode && contour.id === this.activeContourId) ||
      (!this.contourEditMode &&
        contour.id === this.selectedContourId &&
        !contour.shapeKind)
    const contourStroke = showContourGuides
      ? TERRAIN_CONTOUR_STROKE_COLOR
      : TERRAIN_CONTOUR_IDLE_STROKE_COLOR
    const relativePoints = new Array<fabric.Point>(contour.points.length / 2)
    for (let i = 0; i < contour.points.length; i += 2) {
      relativePoints[i / 2] = new fabric.Point(
        contour.points[i] - bounds.minX,
        contour.points[i + 1] - bounds.minY
      )
    }
    if (relativePoints.length >= 3) {
      children.push(
        new fabric.Polygon(relativePoints, {
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          fill: 'rgba(255,255,255,0.001)',
          stroke: contourStroke,
          strokeWidth: TERRAIN_CONTOUR_STROKE_WIDTH,
          selectable: false,
          evented: false,
          objectCaching: false,
        })
      )
    } else {
      children.push(
        new fabric.Polyline(relativePoints, {
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          fill: 'transparent',
          stroke: contourStroke,
          strokeWidth: TERRAIN_CONTOUR_STROKE_WIDTH,
          selectable: false,
          evented: false,
          objectCaching: false,
        })
      )
    }
    if (showContourGuides) {
      for (let i = 0; i < relativePoints.length; i++) {
        const radius =
          i === this.activeContourPointIndex
            ? TERRAIN_CONTOUR_POINT_RADIUS + 2
            : TERRAIN_CONTOUR_POINT_RADIUS
        children.push(
          new fabric.Circle({
            left: relativePoints[i].x - radius,
            top: relativePoints[i].y - radius,
            radius,
            originX: 'left',
            originY: 'top',
            fill:
              i === this.activeContourPointIndex
                ? 'rgba(255,248,212,0.98)'
                : 'rgba(245,208,96,0.95)',
            stroke: 'rgba(32,24,16,0.92)',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            objectCaching: false,
          })
        )
      }
    }
    const proxy = contour.proxy
    const existingObjects = proxy.getObjects().slice()
    for (let i = 0; i < existingObjects.length; i++) {
      proxy.remove(existingObjects[i])
    }
    for (let i = 0; i < children.length; i++) {
      proxy.add(children[i])
    }
    proxy.terrainContourId = contour.id
    proxy.terrainContourAnchorLeft = bounds.minX
    proxy.terrainContourAnchorTop = bounds.minY
    proxy.terrainContourWidth = bounds.width
    proxy.terrainContourHeight = bounds.height
    proxy.left = bounds.minX
    proxy.top = bounds.minY
    ;(proxy as EditorLayeredObject).renderLayer = contour.renderLayer
    this.applyContourProxyInteraction(proxy, this.interactionEnabled)
    proxy.setCoords()
  }

  private applyContourProxyInteraction(
    proxy: TerrainContourProxy,
    enabled: boolean
  ): void {
    const contour = this.proxyToContour.get(proxy) ?? null
    const isShapeContour = contour?.shapeKind !== null
    if (this.contourEditMode) {
      proxy.selectable = false
      proxy.evented = true
      proxy.hasBorders = false
      proxy.hasControls = false
      proxy.lockScalingX = true
      proxy.lockScalingY = true
      proxy.hoverCursor = 'default'
      proxy.moveCursor = 'default'
      return
    }
    proxy.selectable = enabled
    proxy.evented = enabled
    proxy.hasBorders = enabled
    proxy.hasControls = enabled && isShapeContour
    proxy.lockScalingFlip = true
    proxy.lockRotation = true
    proxy.lockScalingX = !(enabled && isShapeContour)
    proxy.lockScalingY = !(enabled && isShapeContour)
    proxy.hoverCursor = 'default'
    proxy.moveCursor = enabled ? 'move' : 'default'
  }

  private moveContourPoint(
    contour: EditorTerrainContour,
    pointIndex: number,
    pointX: number,
    pointY: number
  ): void {
    if (pointIndex < 0 || pointIndex * 2 + 1 >= contour.points.length) {
      return
    }
    if (contour.shapeKind) {
      this.moveConstrainedContourPoint(contour, pointIndex, pointX, pointY)
      return
    }
    contour.points[pointIndex * 2] = pointX
    contour.points[pointIndex * 2 + 1] = pointY
    this.refreshContourProxy(contour)
    this.ctx.requestRender()
  }

  private moveConstrainedContourPoint(
    contour: EditorTerrainContour,
    pointIndex: number,
    pointX: number,
    pointY: number
  ): void {
    if (!contour.shapeKind) {
      return
    }
    const bounds = getContourBounds(contour.points)
    if (!bounds) {
      return
    }
    const templatePoints = this.getShapeTemplatePoints(contour.shapeKind)
    if (pointIndex >= templatePoints.length) {
      return
    }
    const templatePoint = templatePoints[pointIndex]
    const nextBounds = this.computeConstrainedBoundsFromPoint(
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
      templatePoint[0],
      templatePoint[1],
      pointX,
      pointY
    )
    this.applyShapeTemplateToContour(contour, templatePoints, nextBounds)
    this.refreshContourProxy(contour)
    this.ctx.requestRender()
  }

  private computeConstrainedBoundsFromPoint(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    xRatio: number,
    yRatio: number,
    pointX: number,
    pointY: number
  ): {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } {
    const nextX = this.resolveConstrainedAxis(minX, maxX, xRatio, pointX)
    const nextY = this.resolveConstrainedAxis(minY, maxY, yRatio, pointY)
    return {
      minX: nextX.min,
      maxX: nextX.max,
      minY: nextY.min,
      maxY: nextY.max,
    }
  }

  private resolveConstrainedAxis(
    min: number,
    max: number,
    ratio: number,
    target: number
  ): { min: number; max: number } {
    if (ratio <= 0) {
      const nextMin = Math.min(target, max - 1)
      return { min: nextMin, max }
    }
    if (ratio >= TERRAIN_CONTOUR_RATIO_SCALE) {
      const nextMax = Math.max(target, min + 1)
      return { min, max: nextMax }
    }
    if (ratio === TERRAIN_CONTOUR_RATIO_SCALE / 2) {
      const size = Math.max(1, max - min)
      const currentCenter = Math.round((min + max) * 0.5)
      const delta = target - currentCenter
      return {
        min: min + delta,
        max: min + delta + size,
      }
    }
    if (ratio < TERRAIN_CONTOUR_RATIO_SCALE / 2) {
      const denominator = TERRAIN_CONTOUR_RATIO_SCALE - ratio
      const nextMin = Math.round(
        (target * TERRAIN_CONTOUR_RATIO_SCALE - max * ratio) / denominator
      )
      return {
        min: Math.min(nextMin, max - 1),
        max,
      }
    }
    const nextMax = Math.round(
      min + ((target - min) * TERRAIN_CONTOUR_RATIO_SCALE) / ratio
    )
    return {
      min,
      max: Math.max(nextMax, min + 1),
    }
  }

  private applyShapeTemplateToContour(
    contour: EditorTerrainContour,
    templatePoints: ReadonlyArray<readonly [number, number]>,
    bounds: {
      minX: number
      maxX: number
      minY: number
      maxY: number
    }
  ): void {
    const width = Math.max(1, bounds.maxX - bounds.minX)
    const height = Math.max(1, bounds.maxY - bounds.minY)
    contour.points.length = templatePoints.length * 2
    for (let i = 0; i < templatePoints.length; i++) {
      const templatePoint = templatePoints[i]
      const baseIndex = i * 2
      contour.points[baseIndex] =
        bounds.minX +
        Math.round((width * templatePoint[0]) / TERRAIN_CONTOUR_RATIO_SCALE)
      contour.points[baseIndex + 1] =
        bounds.minY +
        Math.round((height * templatePoint[1]) / TERRAIN_CONTOUR_RATIO_SCALE)
    }
  }

  private ensureContourFillLayer(
    contour: EditorTerrainContour,
    materialId: TerrainMaterialId
  ): EditorTerrainLayer {
    if (contour.fillLayer) {
      contour.fillLayer.materialId = materialId
      contour.fillLayer.serializedLayer.materialId = materialId
      contour.fillLayer.serializedLayer.renderLayer = contour.renderLayer
      return contour.fillLayer
    }
    contour.fillLayer = this.createEmptyLayer(
      materialId,
      0,
      0,
      contour.renderLayer,
      contour.id,
      true
    )
    return contour.fillLayer
  }

  private rasterizeContourFill(contour: EditorTerrainContour): boolean {
    if (!contour.fillMaterialId) {
      return false
    }
    const bounds = getContourBounds(contour.points)
    if (!bounds) {
      return false
    }
    const layer = this.ensureContourFillLayer(contour, contour.fillMaterialId)
    layer.grid = new TerrainChunkGrid(this.chunkSize, this.randomSeed)
    layer.serializedLayer.chunks = layer.grid.getChunks()
    layer.offsetCellX = 0
    layer.offsetCellY = 0
    layer.serializedLayer.offsetCellX = 0
    layer.serializedLayer.offsetCellY = 0
    layer.serializedLayer.materialId = contour.fillMaterialId
    layer.serializedLayer.renderLayer = contour.renderLayer
    layer.serializedLayer.contourId = contour.id
    const cellSizePx = this.getCellSizePx()
    const startCellX = Math.floor(bounds.minX / cellSizePx)
    const endCellX = Math.floor(bounds.maxX / cellSizePx)
    const startCellY = Math.floor(bounds.minY / cellSizePx)
    const endCellY = Math.floor(bounds.maxY / cellSizePx)
    const baseFillMaterialId =
      contour.fillMaterialId === 'grass' ? 'dirt' : contour.fillMaterialId
    const fillCode = getTerrainMaterialCodeById(baseFillMaterialId)
    for (let cellY = startCellY; cellY <= endCellY; cellY++) {
      for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        if (
          !this.isContourCellFilled(contour.points, cellX, cellY, cellSizePx)
        ) {
          continue
        }
        layer.grid.setCellMaterialCode(cellX, cellY, fillCode)
      }
    }
    if (contour.fillMaterialId === 'grass') {
      this.recalculateContourTopCells(
        layer,
        getTerrainMaterialCodeById('dirt'),
        getTerrainMaterialCodeById('grass')
      )
    }
    if (!layer.grid.hasCells()) {
      this.removeLayer(layer)
      contour.fillLayer = null
      return false
    }
    return true
  }

  private applyContourFillDelta(
    contour: EditorTerrainContour,
    previousPoints: readonly number[]
  ): boolean {
    if (!contour.fillMaterialId) {
      return false
    }
    const oldBounds = getContourBounds(previousPoints)
    const newBounds = getContourBounds(contour.points)
    if (!oldBounds || !newBounds) {
      return false
    }
    const cellSizePx = this.getCellSizePx()
    const startCellX = Math.floor(
      Math.min(oldBounds.minX, newBounds.minX) / cellSizePx
    )
    const endCellX = Math.floor(
      Math.max(oldBounds.maxX, newBounds.maxX) / cellSizePx
    )
    const startCellY = Math.floor(
      Math.min(oldBounds.minY, newBounds.minY) / cellSizePx
    )
    const endCellY = Math.floor(
      Math.max(oldBounds.maxY, newBounds.maxY) / cellSizePx
    )
    const width = endCellX - startCellX + 1
    const height = endCellY - startCellY + 1
    if (width <= 0 || height <= 0) {
      return false
    }
    const layer = this.ensureContourFillLayer(contour, contour.fillMaterialId)
    const baseFillMaterialId =
      contour.fillMaterialId === 'grass' ? 'dirt' : contour.fillMaterialId
    const fillCode = getTerrainMaterialCodeById(baseFillMaterialId)
    const previousMask = new Uint8Array(width * height)
    const nextMask = new Uint8Array(width * height)
    this.rasterizeContourMask(
      previousPoints,
      startCellX,
      startCellY,
      endCellX,
      endCellY,
      cellSizePx,
      previousMask
    )
    this.rasterizeContourMask(
      contour.points,
      startCellX,
      startCellY,
      endCellX,
      endCellY,
      cellSizePx,
      nextMask
    )
    let changed = false
    for (let cellY = startCellY; cellY <= endCellY; cellY++) {
      const rowOffset = (cellY - startCellY) * width
      for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        const cellIndex = rowOffset + (cellX - startCellX)
        const oldValue = previousMask[cellIndex] | 0
        const nextValue = nextMask[cellIndex] | 0
        if (oldValue === nextValue) {
          continue
        }
        if (nextValue > 0) {
          changed =
            this.setWorldCellMaterialCode(layer, cellX, cellY, fillCode) ||
            changed
        } else {
          changed =
            this.setWorldCellMaterialCode(layer, cellX, cellY, 0) || changed
        }
      }
    }
    if (contour.fillMaterialId === 'grass') {
      this.recalculateContourTopCells(
        layer,
        getTerrainMaterialCodeById('dirt'),
        getTerrainMaterialCodeById('grass')
      )
    }
    if (!layer.grid.hasCells()) {
      this.removeLayer(layer)
      contour.fillLayer = null
    }
    return changed
  }

  private rasterizeContourMask(
    points: readonly number[],
    startCellX: number,
    startCellY: number,
    endCellX: number,
    endCellY: number,
    cellSizePx: number,
    mask: Uint8Array
  ): void {
    const width = endCellX - startCellX + 1
    for (let cellY = startCellY; cellY <= endCellY; cellY++) {
      const rowOffset = (cellY - startCellY) * width
      for (let cellX = startCellX; cellX <= endCellX; cellX++) {
        if (!this.isContourCellFilled(points, cellX, cellY, cellSizePx)) {
          continue
        }
        mask[rowOffset + (cellX - startCellX)] = 1
      }
    }
  }

  private isContourCellFilled(
    points: readonly number[],
    cellX: number,
    cellY: number,
    cellSizePx: number
  ): boolean {
    if (cellSizePx <= 0) {
      return false
    }
    const baseX = cellX * cellSizePx
    const baseY = cellY * cellSizePx
    const centerX2 = baseX * 2 + cellSizePx
    const centerY2 = baseY * 2 + cellSizePx
    if (!pointInClosedContourScaled2(points, centerX2, centerY2)) {
      return false
    }
    const sampleCount = TERRAIN_CONTOUR_CELL_SAMPLE_COUNT
    const totalSamples = sampleCount * sampleCount
    let insideSamples = 0
    const requiredSamples = Math.floor(totalSamples / 2) + 1
    const remainingFailLimit = totalSamples - requiredSamples
    for (let sampleY = 0; sampleY < sampleCount; sampleY++) {
      const samplePointY =
        baseY + Math.floor(((sampleY * 2 + 1) * cellSizePx) / (sampleCount * 2))
      for (let sampleX = 0; sampleX < sampleCount; sampleX++) {
        const samplePointX =
          baseX +
          Math.floor(((sampleX * 2 + 1) * cellSizePx) / (sampleCount * 2))
        if (
          pointInClosedContourScaled2(
            points,
            samplePointX * 2,
            samplePointY * 2
          )
        ) {
          insideSamples += 1
          if (insideSamples >= requiredSamples) {
            return true
          }
          continue
        }
        const outsideSamples =
          sampleY * sampleCount + sampleX + 1 - insideSamples
        if (outsideSamples > remainingFailLimit) {
          return false
        }
      }
    }
    return insideSamples >= requiredSamples
  }

  private recalculateContourTopCells(
    layer: EditorTerrainLayer,
    fillCode: number,
    topCode: number
  ): void {
    const chunks = layer.grid.getChunks()
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      const chunkBaseX = chunk.chunkX * this.chunkSize
      const chunkBaseY = chunk.chunkY * this.chunkSize
      for (let localY = 0; localY < this.chunkSize; localY++) {
        for (let localX = 0; localX < this.chunkSize; localX++) {
          const code = chunk.cells[localY * this.chunkSize + localX] | 0
          if (code !== fillCode && code !== topCode) {
            continue
          }
          const worldCellX = layer.offsetCellX + chunkBaseX + localX
          const worldCellY = layer.offsetCellY + chunkBaseY + localY
          this.recalculateSingleTopCell(
            layer,
            worldCellX,
            worldCellY,
            fillCode,
            topCode
          )
        }
      }
    }
  }

  private syncContourFromFillLayer(contour: EditorTerrainContour): boolean {
    const layer = contour.fillLayer
    if (!layer || !layer.grid.hasCells()) {
      this.removeContour(contour)
      return true
    }
    const nextPoints = this.buildContourPointsFromFillLayer(layer)
    if (!nextPoints || nextPoints.length < 6) {
      this.removeContour(contour)
      return true
    }
    if (this.areContourPointsEqual(contour.points, nextPoints)) {
      return false
    }
    contour.points.length = nextPoints.length
    for (let i = 0; i < nextPoints.length; i++) {
      contour.points[i] = nextPoints[i]
    }
    contour.shapeKind = null
    this.getSerializedContour(contour).shapeKind = undefined
    this.refreshContourProxy(contour)
    return true
  }

  private buildContourPointsFromFillLayer(
    layer: EditorTerrainLayer
  ): number[] | null {
    const maskBounds = this.getFilledLayerBounds(layer)
    if (!maskBounds) {
      return null
    }
    const width = maskBounds.maxCellX - maskBounds.minCellX + 1
    const height = maskBounds.maxCellY - maskBounds.minCellY + 1
    const filled = new Uint8Array(width * height)
    const chunks = layer.grid.getChunks()
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      const chunkBaseX = chunk.chunkX * this.chunkSize
      const chunkBaseY = chunk.chunkY * this.chunkSize
      for (let localY = 0; localY < this.chunkSize; localY++) {
        for (let localX = 0; localX < this.chunkSize; localX++) {
          const code = chunk.cells[localY * this.chunkSize + localX] | 0
          if (code <= 0) {
            continue
          }
          const worldCellX = layer.offsetCellX + chunkBaseX + localX
          const worldCellY = layer.offsetCellY + chunkBaseY + localY
          const fillIndex =
            (worldCellY - maskBounds.minCellY) * width +
            (worldCellX - maskBounds.minCellX)
          filled[fillIndex] = 1
        }
      }
    }
    const loop = pickLargestContourLoop(
      extractFilledCellLoops(filled, width, height)
    )
    if (!loop || loop.length < 6) {
      return null
    }
    const simplifiedLoop = simplifyContourLoop(loop)
    const cellSizePx = this.getCellSizePx()
    const points = new Array<number>(simplifiedLoop.length)
    for (let i = 0; i < simplifiedLoop.length; i += 2) {
      points[i] = (maskBounds.minCellX + simplifiedLoop[i]) * cellSizePx
      points[i + 1] = (maskBounds.minCellY + simplifiedLoop[i + 1]) * cellSizePx
    }
    return points
  }

  private getFilledLayerBounds(layer: EditorTerrainLayer): {
    minCellX: number
    minCellY: number
    maxCellX: number
    maxCellY: number
  } | null {
    const chunks = layer.grid.getChunks()
    let hasFilledCell = false
    let minCellX = 0
    let minCellY = 0
    let maxCellX = 0
    let maxCellY = 0
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      const chunkBaseX = chunk.chunkX * this.chunkSize
      const chunkBaseY = chunk.chunkY * this.chunkSize
      for (let localY = 0; localY < this.chunkSize; localY++) {
        for (let localX = 0; localX < this.chunkSize; localX++) {
          const code = chunk.cells[localY * this.chunkSize + localX] | 0
          if (code <= 0) {
            continue
          }
          const worldCellX = layer.offsetCellX + chunkBaseX + localX
          const worldCellY = layer.offsetCellY + chunkBaseY + localY
          if (!hasFilledCell) {
            minCellX = worldCellX
            minCellY = worldCellY
            maxCellX = worldCellX
            maxCellY = worldCellY
            hasFilledCell = true
            continue
          }
          if (worldCellX < minCellX) {
            minCellX = worldCellX
          } else if (worldCellX > maxCellX) {
            maxCellX = worldCellX
          }
          if (worldCellY < minCellY) {
            minCellY = worldCellY
          } else if (worldCellY > maxCellY) {
            maxCellY = worldCellY
          }
        }
      }
    }
    if (!hasFilledCell) {
      return null
    }
    return {
      minCellX,
      minCellY,
      maxCellX,
      maxCellY,
    }
  }

  private areContourPointsEqual(
    left: readonly number[],
    right: readonly number[]
  ): boolean {
    if (left.length !== right.length) {
      return false
    }
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        return false
      }
    }
    return true
  }

  private removeContour(contour: EditorTerrainContour): void {
    if (contour.fillLayer) {
      this.removeLayer(contour.fillLayer)
      contour.fillLayer = null
    }
    const contourIndex = this.contours.indexOf(contour)
    if (contourIndex >= 0) {
      this.contours.splice(contourIndex, 1)
      for (let i = 0; i < this.renderData.contours.length; i++) {
        if (this.renderData.contours[i].id === contour.id) {
          this.renderData.contours.splice(i, 1)
          break
        }
      }
    }
    this.proxyToContour.delete(contour.proxy)
    this.ctx.unregisterEditorObject(contour.proxy)
    if (contour.proxy.canvas) {
      contour.proxy.canvas.remove(contour.proxy)
    }
    if (this.activeContourId === contour.id) {
      this.activeContourId = -1
      this.activeContourPointIndex = -1
    }
    if (this.selectedContourId === contour.id) {
      this.selectedContourId = -1
    }
  }

  private resetContourInteraction(): void {
    this.unlockContourProxyMovement()
    this.contourPointerActive = false
    this.contourPointerChanged = false
    this.contourDrawingContour = null
    this.contourDragTarget = null
    this.contourDragPointIndex = -1
    this.contourDragOriginalPoints = null
    this.contourLastPointX = 0
    this.contourLastPointY = 0
  }

  private lockContourProxyMovement(proxy: TerrainContourProxy): void {
    if (this.contourDragLockedProxy === proxy) {
      return
    }
    this.unlockContourProxyMovement()
    this.contourDragLockedProxy = proxy
    this.contourDragRestoreLockX = proxy.lockMovementX === true
    this.contourDragRestoreLockY = proxy.lockMovementY === true
    proxy.lockMovementX = true
    proxy.lockMovementY = true
    proxy.left = proxy.terrainContourAnchorLeft
    proxy.top = proxy.terrainContourAnchorTop
    proxy.setCoords()
  }

  private unlockContourProxyMovement(): void {
    const proxy = this.contourDragLockedProxy
    if (!proxy) {
      return
    }
    proxy.lockMovementX = this.contourDragRestoreLockX
    proxy.lockMovementY = this.contourDragRestoreLockY
    proxy.left = proxy.terrainContourAnchorLeft
    proxy.top = proxy.terrainContourAnchorTop
    proxy.setCoords()
    this.contourDragLockedProxy = null
    this.contourDragRestoreLockX = false
    this.contourDragRestoreLockY = false
  }

  private getMovingContourPreview(): EditorTerrainContour | null {
    const proxy = this.movingContourTarget
    if (!proxy) {
      return null
    }
    return this.proxyToContour.get(proxy) ?? null
  }

  private getContourPointHitDistanceSq(): number {
    const canvas = this.ctx.getFabricCanvas()
    const viewportScale = canvas?.getZoom() ?? 1
    return getContourHitDistanceSq(
      viewportScale,
      TERRAIN_CONTOUR_SELECT_DISTANCE_SQ
    )
  }

  private getContourEdgeHitDistanceSq(): number {
    const canvas = this.ctx.getFabricCanvas()
    const viewportScale = canvas?.getZoom() ?? 1
    return getContourHitDistanceSq(
      viewportScale,
      TERRAIN_CONTOUR_EDGE_SELECT_DISTANCE_SQ
    )
  }

  private getOrderedLayers(
    orderedObjects?: ReadonlyArray<{ object: fabric.Object; type: ObjectType }>
  ): EditorTerrainLayer[] {
    if (!orderedObjects || orderedObjects.length === 0) {
      return this.layers.slice()
    }
    const orderedLayers: EditorTerrainLayer[] = []
    const included = new Set<number>()
    for (let i = 0; i < orderedObjects.length; i++) {
      const objectData = orderedObjects[i]
      if (objectData.type !== ObjectType.Terrain) {
        continue
      }
      const layer = this.proxyToLayer.get(objectData.object)
      if (!layer || included.has(layer.id)) {
        continue
      }
      included.add(layer.id)
      orderedLayers.push(layer)
    }
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (!included.has(layer.id)) {
        orderedLayers.push(layer)
      }
    }
    return orderedLayers
  }

  private getOrderedContours(
    orderedObjects?: ReadonlyArray<{ object: fabric.Object; type: ObjectType }>
  ): EditorTerrainContour[] {
    if (!orderedObjects || orderedObjects.length === 0) {
      return this.contours.slice()
    }
    const orderedContours: EditorTerrainContour[] = []
    const included = new Set<number>()
    for (let i = 0; i < orderedObjects.length; i++) {
      const objectData = orderedObjects[i]
      if (objectData.type !== ObjectType.Terrain) {
        continue
      }
      const contour = this.proxyToContour.get(objectData.object)
      if (!contour || included.has(contour.id)) {
        continue
      }
      included.add(contour.id)
      orderedContours.push(contour)
    }
    for (let i = 0; i < this.contours.length; i++) {
      const contour = this.contours[i]
      if (!included.has(contour.id)) {
        orderedContours.push(contour)
      }
    }
    return orderedContours
  }

  private buildGeneratedLayerName(materialId: TerrainMaterialId): string {
    const material = getTerrainMaterialById(materialId)
    let count = 0
    for (let i = 0; i < this.layers.length; i++) {
      if (this.layers[i].materialId === materialId) {
        count += 1
      }
    }
    return `${localizer.t(material.labelKey)}${count}`
  }

  private applyProxyInteraction(
    proxy: TerrainRegionProxy,
    enabled: boolean
  ): void {
    proxy.selectable = enabled
    proxy.evented = enabled
    proxy.hoverCursor = enabled ? 'move' : 'default'
    proxy.moveCursor = enabled ? 'move' : 'default'
  }

  private handleProxyMoving(proxy: TerrainRegionProxy): boolean {
    const layer = this.proxyToLayer.get(proxy)
    if (!layer) {
      this.resetMovingProxyState(proxy)
      return false
    }
    this.ensureMovingProxyState(proxy)
    const cellSizePx = this.getCellSizePx()
    const currentLeft = Math.round(proxy.left ?? this.movingProxyStartLeft)
    const currentTop = Math.round(proxy.top ?? this.movingProxyStartTop)
    const totalCellDeltaX = this.computeRoundedCellDelta(
      currentLeft - this.movingProxyStartLeft,
      cellSizePx
    )
    const totalCellDeltaY = this.computeRoundedCellDelta(
      currentTop - this.movingProxyStartTop,
      cellSizePx
    )
    const deltaCellX = totalCellDeltaX - this.movingProxyAppliedCellDeltaX
    const deltaCellY = totalCellDeltaY - this.movingProxyAppliedCellDeltaY
    if (deltaCellX === 0 && deltaCellY === 0) {
      return false
    }
    this.applyLayerCellDelta(layer, deltaCellX, deltaCellY)
    proxy.terrainAnchorLeft += deltaCellX * cellSizePx
    proxy.terrainAnchorTop += deltaCellY * cellSizePx
    this.movingProxyAppliedCellDeltaX = totalCellDeltaX
    this.movingProxyAppliedCellDeltaY = totalCellDeltaY
    this.ctx.requestRender()
    return true
  }

  private finalizeProxyMove(proxy: TerrainRegionProxy): boolean {
    if (this.movingProxyTarget !== proxy) {
      return this.handleProxyModified(proxy)
    }
    const changed =
      this.movingProxyAppliedCellDeltaX !== 0 ||
      this.movingProxyAppliedCellDeltaY !== 0
    proxy.left = proxy.terrainAnchorLeft
    proxy.top = proxy.terrainAnchorTop
    proxy.setCoords()
    this.resetMovingProxyState(proxy)
    this.ctx.requestRender()
    return changed
  }

  private handleActiveSelectionMoving(
    selection: fabric.ActiveSelection
  ): boolean {
    const proxies = this.collectTerrainSelectionProxies(selection)
    if (proxies.length === 0) {
      this.resetActiveSelectionMoveState(selection)
      return false
    }
    this.ensureActiveSelectionMoveState(selection)
    const cellSizePx = this.getCellSizePx()
    const currentLeft = Math.round(
      selection.left ?? this.activeSelectionMoveStartLeft
    )
    const currentTop = Math.round(
      selection.top ?? this.activeSelectionMoveStartTop
    )
    const totalCellDeltaX = this.computeRoundedCellDelta(
      currentLeft - this.activeSelectionMoveStartLeft,
      cellSizePx
    )
    const totalCellDeltaY = this.computeRoundedCellDelta(
      currentTop - this.activeSelectionMoveStartTop,
      cellSizePx
    )
    const deltaCellX =
      totalCellDeltaX - this.activeSelectionMoveAppliedCellDeltaX
    const deltaCellY =
      totalCellDeltaY - this.activeSelectionMoveAppliedCellDeltaY
    if (deltaCellX === 0 && deltaCellY === 0) {
      return false
    }
    this.moveTerrainSelectionByCellDelta(proxies, deltaCellX, deltaCellY)
    this.activeSelectionMoveAppliedCellDeltaX = totalCellDeltaX
    this.activeSelectionMoveAppliedCellDeltaY = totalCellDeltaY
    this.ctx.requestRender()
    return true
  }

  private finalizeActiveSelectionMove(
    selection: fabric.ActiveSelection
  ): boolean {
    const proxies = this.collectTerrainSelectionProxies(selection)
    if (proxies.length === 0) {
      this.resetActiveSelectionMoveState(selection)
      return false
    }
    const tracked = this.activeSelectionMoveTarget === selection
    const changed =
      tracked &&
      (this.activeSelectionMoveAppliedCellDeltaX !== 0 ||
        this.activeSelectionMoveAppliedCellDeltaY !== 0)
    const canvas = this.ctx.getFabricCanvas()
    const selectedObjects = selection.getObjects().slice()
    if (canvas && tracked) {
      canvas.discardActiveObject()
    }
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i]
      proxy.left = proxy.terrainAnchorLeft
      proxy.top = proxy.terrainAnchorTop
      proxy.setCoords()
    }
    if (canvas && tracked) {
      if (selectedObjects.length > 1) {
        canvas.setActiveObject(
          new fabric.ActiveSelection(selectedObjects, { canvas })
        )
      } else if (selectedObjects.length === 1) {
        canvas.setActiveObject(selectedObjects[0])
      }
    }
    this.resetActiveSelectionMoveState(selection)
    this.ctx.requestRender()
    return changed
  }

  private handleGroupedProxyMoving(
    group: fabric.Group,
    proxies: readonly TerrainRegionProxy[]
  ): boolean {
    this.ensureGroupedProxyMoveState(group)
    const cellSizePx = this.getCellSizePx()
    const currentLeft = Math.round(group.left ?? this.groupedProxyMoveStartLeft)
    const currentTop = Math.round(group.top ?? this.groupedProxyMoveStartTop)
    const totalCellDeltaX = this.computeRoundedCellDelta(
      currentLeft - this.groupedProxyMoveStartLeft,
      cellSizePx
    )
    const totalCellDeltaY = this.computeRoundedCellDelta(
      currentTop - this.groupedProxyMoveStartTop,
      cellSizePx
    )
    const deltaCellX = totalCellDeltaX - this.groupedProxyMoveAppliedCellDeltaX
    const deltaCellY = totalCellDeltaY - this.groupedProxyMoveAppliedCellDeltaY
    const snappedLeft =
      this.groupedProxyMoveStartLeft + totalCellDeltaX * cellSizePx
    const snappedTop =
      this.groupedProxyMoveStartTop + totalCellDeltaY * cellSizePx
    if (Math.round(group.left ?? 0) !== snappedLeft) {
      group.left = snappedLeft
    }
    if (Math.round(group.top ?? 0) !== snappedTop) {
      group.top = snappedTop
    }
    group.setCoords()
    if (deltaCellX === 0 && deltaCellY === 0) {
      this.ctx.requestRender()
      return false
    }
    this.moveTerrainSelectionByCellDelta(proxies, deltaCellX, deltaCellY)
    this.groupedProxyMoveAppliedCellDeltaX = totalCellDeltaX
    this.groupedProxyMoveAppliedCellDeltaY = totalCellDeltaY
    this.ctx.requestRender()
    return true
  }

  private finalizeGroupedProxyMove(
    group: fabric.Group,
    proxies: readonly TerrainRegionProxy[]
  ): boolean {
    const changed =
      this.groupedProxyMoveTarget === group &&
      (this.groupedProxyMoveAppliedCellDeltaX !== 0 ||
        this.groupedProxyMoveAppliedCellDeltaY !== 0)
    this.refreshGroupedTerrainProxyPositions(group, proxies)
    this.resetGroupedProxyMoveState(group)
    this.ctx.requestRender()
    return changed
  }

  private ensureActiveSelectionMoveState(
    selection: fabric.ActiveSelection
  ): void {
    if (this.activeSelectionMoveTarget === selection) {
      return
    }
    this.activeSelectionMoveTarget = selection
    this.activeSelectionMoveStartLeft = Math.round(selection.left ?? 0)
    this.activeSelectionMoveStartTop = Math.round(selection.top ?? 0)
    this.activeSelectionMoveAppliedCellDeltaX = 0
    this.activeSelectionMoveAppliedCellDeltaY = 0
  }

  private ensureMovingContourState(proxy: TerrainContourProxy): void {
    if (this.movingContourTarget === proxy) {
      return
    }
    this.movingContourTarget = proxy
    this.movingContourStartLeft = Math.round(
      proxy.left ?? proxy.terrainContourAnchorLeft
    )
    this.movingContourStartTop = Math.round(
      proxy.top ?? proxy.terrainContourAnchorTop
    )
    this.movingContourAppliedDeltaX = 0
    this.movingContourAppliedDeltaY = 0
  }

  private ensureMovingProxyState(proxy: TerrainRegionProxy): void {
    if (this.movingProxyTarget === proxy) {
      return
    }
    this.movingProxyTarget = proxy
    this.movingProxyStartLeft = Math.round(
      proxy.left ?? proxy.terrainAnchorLeft
    )
    this.movingProxyStartTop = Math.round(proxy.top ?? proxy.terrainAnchorTop)
    this.movingProxyAppliedCellDeltaX = 0
    this.movingProxyAppliedCellDeltaY = 0
  }

  private resetMovingProxyState(proxy?: TerrainRegionProxy | null): void {
    if (proxy && this.movingProxyTarget && this.movingProxyTarget !== proxy) {
      return
    }
    this.movingProxyTarget = null
    this.movingProxyStartLeft = 0
    this.movingProxyStartTop = 0
    this.movingProxyAppliedCellDeltaX = 0
    this.movingProxyAppliedCellDeltaY = 0
  }

  private resetMovingContourState(proxy?: TerrainContourProxy | null): void {
    if (
      proxy &&
      this.movingContourTarget &&
      this.movingContourTarget !== proxy
    ) {
      return
    }
    this.movingContourTarget = null
    this.movingContourStartLeft = 0
    this.movingContourStartTop = 0
    this.movingContourAppliedDeltaX = 0
    this.movingContourAppliedDeltaY = 0
  }

  private ensureGroupedProxyMoveState(group: fabric.Group): void {
    if (this.groupedProxyMoveTarget === group) {
      return
    }
    this.groupedProxyMoveTarget = group
    this.groupedProxyMoveStartLeft = Math.round(group.left ?? 0)
    this.groupedProxyMoveStartTop = Math.round(group.top ?? 0)
    this.groupedProxyMoveAppliedCellDeltaX = 0
    this.groupedProxyMoveAppliedCellDeltaY = 0
  }

  private resetGroupedProxyMoveState(group?: fabric.Group | null): void {
    if (
      group &&
      this.groupedProxyMoveTarget &&
      this.groupedProxyMoveTarget !== group
    ) {
      return
    }
    this.groupedProxyMoveTarget = null
    this.groupedProxyMoveStartLeft = 0
    this.groupedProxyMoveStartTop = 0
    this.groupedProxyMoveAppliedCellDeltaX = 0
    this.groupedProxyMoveAppliedCellDeltaY = 0
  }

  private resetActiveSelectionMoveState(
    selection?: fabric.ActiveSelection | null
  ): void {
    if (
      selection &&
      this.activeSelectionMoveTarget &&
      this.activeSelectionMoveTarget !== selection
    ) {
      return
    }
    this.activeSelectionMoveTarget = null
    this.activeSelectionMoveStartLeft = 0
    this.activeSelectionMoveStartTop = 0
    this.activeSelectionMoveAppliedCellDeltaX = 0
    this.activeSelectionMoveAppliedCellDeltaY = 0
  }

  private collectTerrainSelectionProxies(
    selection: fabric.ActiveSelection
  ): TerrainRegionProxy[] {
    const objects = selection.getObjects()
    const proxies: TerrainRegionProxy[] = []
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i]
      if (this.isTerrainProxy(object)) {
        proxies.push(object)
      }
    }
    return proxies
  }

  private collectTerrainGroupedProxies(
    object: fabric.Object | null
  ): TerrainRegionProxy[] {
    if (
      !object ||
      this.isTerrainProxy(object) ||
      object instanceof fabric.ActiveSelection ||
      !(object instanceof fabric.Group)
    ) {
      return []
    }
    const objects = object.getObjects()
    if (objects.length === 0) {
      return []
    }
    const proxies: TerrainRegionProxy[] = []
    for (let i = 0; i < objects.length; i++) {
      const child = objects[i]
      if (this.isTerrainProxy(child)) {
        proxies.push(child)
      }
    }
    return proxies
  }

  private moveTerrainSelectionByCellDelta(
    proxies: readonly TerrainRegionProxy[],
    cellDeltaX: number,
    cellDeltaY: number
  ): void {
    if (cellDeltaX === 0 && cellDeltaY === 0) {
      return
    }
    const movedLayerIds = new Set<number>()
    const cellSizePx = this.getCellSizePx()
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i]
      const layer = this.proxyToLayer.get(proxy)
      if (!layer || movedLayerIds.has(layer.id)) {
        continue
      }
      movedLayerIds.add(layer.id)
      this.applyLayerCellDelta(layer, cellDeltaX, cellDeltaY)
      proxy.terrainAnchorLeft += cellDeltaX * cellSizePx
      proxy.terrainAnchorTop += cellDeltaY * cellSizePx
    }
  }

  private refreshGroupedTerrainProxyPositions(
    group: fabric.Group,
    proxies: readonly TerrainRegionProxy[]
  ): void {
    const canvas = this.ctx.getFabricCanvas()
    if (!canvas) {
      return
    }
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i]
      group.remove(proxy)
      canvas.add(proxy)
      proxy.left = proxy.terrainAnchorLeft
      proxy.top = proxy.terrainAnchorTop
      proxy.setCoords()
    }
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i]
      if (proxy.canvas === canvas) {
        canvas.remove(proxy)
      }
      group.add(proxy)
    }
    group.setCoords()
  }

  private applyLayerCellDelta(
    layer: EditorTerrainLayer,
    cellDeltaX: number,
    cellDeltaY: number
  ): void {
    layer.offsetCellX += cellDeltaX
    layer.offsetCellY += cellDeltaY
    layer.serializedLayer.offsetCellX = layer.offsetCellX
    layer.serializedLayer.offsetCellY = layer.offsetCellY
  }

  private computeRoundedCellDelta(deltaPx: number, cellSizePx: number): number {
    if (cellSizePx <= 0 || deltaPx === 0) {
      return 0
    }
    const halfCellSizePx = Math.floor(cellSizePx / 2)
    if (deltaPx > 0) {
      return Math.floor((deltaPx + halfCellSizePx) / cellSizePx)
    }
    return -Math.floor((-deltaPx + halfCellSizePx) / cellSizePx)
  }

  private packCellCoord(cellX: number, cellY: number): number {
    const packedX = (cellX + 32768) & 0xffff
    const packedY = (cellY + 32768) & 0xffff
    return (packedX << 16) | packedY
  }

  private unpackCellX(packedCoord: number): number {
    return ((packedCoord >>> 16) & 0xffff) - 32768
  }

  private unpackCellY(packedCoord: number): number {
    return (packedCoord & 0xffff) - 32768
  }
}
