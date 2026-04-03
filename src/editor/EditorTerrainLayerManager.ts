import * as fabric from 'fabric'

import { localizer } from '../Localizer'
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
  type TerrainLayerLike,
  type TerrainMaterialId,
} from '../terrain/TerrainTypes'
import {
  type EditorObjectData,
  ObjectType,
  type TerrainRegionProxy,
} from './types'

interface EditorTerrainLayer {
  id: number
  materialId: TerrainMaterialId
  offsetCellX: number
  offsetCellY: number
  grid: TerrainChunkGrid
  renderLayer: TerrainLayerLike
  proxy: TerrainRegionProxy | null
}

export interface TerrainClipboardLayerSnapshot {
  materialId: TerrainMaterialId
  offsetCellX: number
  offsetCellY: number
  chunks: MapTerrainLayer['chunks']
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

export class EditorTerrainLayerManager {
  private readonly ctx: EditorTerrainLayerManagerContext
  private readonly layers: EditorTerrainLayer[] = []
  private readonly proxyToLayer = new WeakMap<
    fabric.Object,
    EditorTerrainLayer
  >()
  private readonly renderData = {
    version: TERRAIN_DATA_VERSION,
    cellSize: TERRAIN_CELL_SIZE_METERS,
    chunkSize: TERRAIN_CHUNK_SIZE,
    randomSeed: DEFAULT_TERRAIN_RANDOM_SEED,
    chunks: EMPTY_TERRAIN_CHUNKS,
    layers: [] as TerrainLayerLike[],
  }
  private attachedCanvas: FabricCanvasWithTerrainBackground | null = null
  private chunkSize = TERRAIN_CHUNK_SIZE
  private cellSize = TERRAIN_CELL_SIZE_METERS
  private randomSeed = DEFAULT_TERRAIN_RANDOM_SEED
  private interactionEnabled = true
  private nextLayerId = 1

  private strokeBrushId: TerrainBrushId | null = null
  private strokeTargetLayer: EditorTerrainLayer | null = null
  private strokeChanged = false
  private readonly strokeDirtyLayers = new Set<EditorTerrainLayer>()
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
    this.resetMovingProxyState()
    this.resetActiveSelectionMoveState()
    this.resetGroupedProxyMoveState()
    this.removeAllLayerObjects()
    this.layers.length = 0
    this.renderData.layers.length = 0
    this.chunkSize = TERRAIN_CHUNK_SIZE
    this.cellSize = TERRAIN_CELL_SIZE_METERS
    this.randomSeed = DEFAULT_TERRAIN_RANDOM_SEED
    this.renderData.version = TERRAIN_DATA_VERSION
    this.renderData.cellSize = this.cellSize
    this.renderData.chunkSize = this.chunkSize
    this.renderData.randomSeed = this.randomSeed
    this.interactionEnabled = true
    this.nextLayerId = 1
    this.ctx.requestRender()
  }

  getCellSizePx(): number {
    return Math.max(1, Math.round(this.cellSize * this.ctx.pixelsPerMeter))
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

  serialize(
    indexMap?: Map<fabric.Object, number>,
    orderedObjects?: ReadonlyArray<{ object: fabric.Object; type: ObjectType }>
  ): MapTerrainData | undefined {
    if (this.layers.length === 0) {
      return undefined
    }
    const orderedLayers = this.getOrderedLayers(orderedObjects)
    const layers = new Array<MapTerrainLayer>(orderedLayers.length)
    for (let i = 0; i < orderedLayers.length; i++) {
      const layer = orderedLayers[i]
      if (indexMap && layer.proxy) {
        indexMap.set(layer.proxy, i)
      }
      layers[i] = {
        materialId: layer.materialId,
        offsetCellX: layer.offsetCellX,
        offsetCellY: layer.offsetCellY,
        chunks: layer.grid.serializeChunks(),
      }
    }
    return {
      version: TERRAIN_DATA_VERSION,
      cellSize: this.cellSize,
      chunkSize: this.chunkSize,
      randomSeed: this.randomSeed,
      chunks: [],
      layers,
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

    if (data?.layers && data.layers.length > 0) {
      for (let i = 0; i < data.layers.length; i++) {
        const source = data.layers[i]
        this.createLayerFromSerialized(
          source.materialId,
          source.offsetCellX | 0,
          source.offsetCellY | 0,
          source.chunks
        )
      }
    } else if (data && data.chunks.length > 0) {
      this.createLayerFromSerialized(
        inferTerrainMaterialId(data.chunks),
        0,
        0,
        data.chunks
      )
    }

    this.ctx.requestRender()
  }

  beginStroke(brushId: TerrainBrushId, cellX: number, cellY: number): boolean {
    this.strokeBrushId = brushId
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeCellKeys.clear()

    const brush = getTerrainBrushById(brushId)
    if (brush.mode === 'fill') {
      const layerMaterialId =
        brush.exposedTopMaterialId ?? brush.fillMaterialId ?? 'dirt'
      this.strokeTargetLayer =
        this.findTargetLayer(layerMaterialId, cellX, cellY) ??
        this.createEmptyLayer(layerMaterialId, cellX, cellY)
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
        if (this.setWorldCellMaterialCode(layer, cellX, cellY, 0)) {
          this.strokeDirtyLayers.add(layer)
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

    if (this.strokeDirtyLayers.size > 0) {
      const dirtyLayers = Array.from(this.strokeDirtyLayers)
      for (let i = 0; i < dirtyLayers.length; i++) {
        this.refreshLayerProxy(dirtyLayers[i])
      }
      this.removeEmptyLayers()
      this.ctx.requestRender()
    }

    const changed = this.strokeChanged
    this.strokeBrushId = null
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeCellKeys.clear()
    return changed
  }

  cancelStroke(): void {
    this.strokeBrushId = null
    this.strokeTargetLayer = null
    this.strokeChanged = false
    this.strokeDirtyLayers.clear()
    this.strokeCellKeys.clear()
  }

  handleProxyModified(object: fabric.Object | null): boolean {
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
    if (this.isTerrainProxy(target)) {
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.handleProxyMoving(target)
    }
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
    if (this.isTerrainProxy(target)) {
      this.resetGroupedProxyMoveState()
      this.resetActiveSelectionMoveState()
      return this.finalizeProxyMove(target)
    }
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
    TerrainRenderer.drawTerrain(
      terrainCtx,
      this.renderData,
      this.getCellSizePx(),
      {
        drawStroke: true,
      }
    )
    terrainCtx.restore()
  }

  private createLayerFromSerialized(
    materialId: TerrainMaterialId,
    offsetCellX: number,
    offsetCellY: number,
    chunks: ReadonlyArray<{
      chunkX: number
      chunkY: number
      cells: ArrayLike<number>
    }>
  ): void {
    const layer = this.createEmptyLayer(materialId, offsetCellX, offsetCellY)
    layer.grid.loadSerializedChunks(chunks)
    if (!layer.grid.hasCells()) {
      this.removeLayer(layer)
      return
    }
    this.refreshLayerProxy(layer)
  }

  private createEmptyLayer(
    materialId: TerrainMaterialId,
    offsetCellX: number,
    offsetCellY: number
  ): EditorTerrainLayer {
    const grid = new TerrainChunkGrid(this.chunkSize)
    const layer: EditorTerrainLayer = {
      id: this.nextLayerId,
      materialId,
      offsetCellX,
      offsetCellY,
      grid,
      renderLayer: {
        offsetCellX,
        offsetCellY,
        materialId,
        chunks: grid.getChunks(),
      },
      proxy: null,
    }
    this.nextLayerId += 1
    this.layers.push(layer)
    this.renderData.layers.push(layer.renderLayer)
    return layer
  }

  private findTargetLayer(
    materialId: TerrainMaterialId,
    worldCellX: number,
    worldCellY: number
  ): EditorTerrainLayer | null {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]
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
    layer.renderLayer.offsetCellX = layer.offsetCellX
    layer.renderLayer.offsetCellY = layer.offsetCellY
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
