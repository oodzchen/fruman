import { localizer } from '../Localizer'
import {
  applyCanvasSnapshot,
  captureCanvasSnapshot,
  cloneBounds,
  createLayerCanvas,
} from './EditorBodyDrawerCanvas'
import { readAlphaBounds } from './EditorBodyDrawerGeometry'
import type {
  EditorBodyLayer,
  EditorBodyLayerSnapshot,
  EditorCanvasBounds,
} from './EditorBodyDrawerTypes'
import {
  BROW_LAYER_ID,
  CORE_LAYER_ID,
  DRAW_WORLD_SIZE,
  EYE_LAYER_ID,
} from './EditorBodyDrawerTypes'

export type GeneratedBrowLayerBoundsResolver = () =>
  | EditorCanvasBounds
  | null
  | undefined

export class EditorBodyLayerStore {
  readonly layers: EditorBodyLayer[] = []
  nextLayerId = BROW_LAYER_ID + 1

  private browCanvas: HTMLCanvasElement
  private browCtx: CanvasRenderingContext2D
  private getGeneratedBrowLayerBounds: GeneratedBrowLayerBoundsResolver

  constructor(
    browCanvas: HTMLCanvasElement,
    browCtx: CanvasRenderingContext2D,
    getGeneratedBrowLayerBounds: GeneratedBrowLayerBoundsResolver
  ) {
    this.browCanvas = browCanvas
    this.browCtx = browCtx
    this.getGeneratedBrowLayerBounds = getGeneratedBrowLayerBounds
  }

  getLayerIndexById(layerId: number): number {
    for (let i = 0; i < this.layers.length; i++) {
      if (this.layers[i].id === layerId) {
        return i
      }
    }
    return -1
  }

  getLayerById(layerId: number): EditorBodyLayer | null {
    const index = this.getLayerIndexById(layerId)
    return index >= 0 ? this.layers[index] : null
  }

  getLayerOrderSnapshot(): number[] {
    const order = new Array<number>(this.layers.length)
    for (let i = 0; i < this.layers.length; i++) {
      order[i] = this.layers[i].id
    }
    return order
  }

  ensureLayerSurface(layer: EditorBodyLayer): boolean {
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

  ensureSelectedLayer(selectedLayerId: number): number {
    return this.getLayerById(selectedLayerId) ? selectedLayerId : CORE_LAYER_ID
  }

  buildDefaultLayers() {
    this.layers.length = 0
    this.layers.push(
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
        ctx: this.browCtx,
        bounds: null,
        boundsDirty: false,
      }
    )
    this.nextLayerId = BROW_LAYER_ID + 1
  }

  appendPaintLayer(name?: string): EditorBodyLayer {
    const layerId = this.nextLayerId++
    const layer: EditorBodyLayer = {
      id: layerId,
      name:
        name && name.length > 0
          ? name
          : `${localizer.t('editor_body_drawer_layer_custom')} ${
              this.nextLayerId - 4
            }`,
      kind: 'paint',
      canvas: null,
      ctx: null,
      bounds: null,
      boundsDirty: false,
    }
    this.layers.push(layer)
    return layer
  }

  applyLayerOrder(order: number[]) {
    if (this.layers.length === 0) {
      return
    }
    const nextLayers: EditorBodyLayer[] = []
    const used = new Set<number>()
    for (let i = 0; i < order.length; i++) {
      const layerId = order[i]
      if (used.has(layerId)) {
        continue
      }
      const layer = this.getLayerById(layerId)
      if (!layer) {
        continue
      }
      nextLayers.push(layer)
      used.add(layerId)
    }
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i]
      if (used.has(layer.id)) {
        continue
      }
      nextLayers.push(layer)
      used.add(layer.id)
    }
    this.layers.splice(0, this.layers.length, ...nextLayers)
  }

  getDisplayLayerIds(): number[] {
    const ids = new Array<number>(this.layers.length)
    let writeIndex = 0
    for (let i = this.layers.length - 1; i >= 0; i--) {
      ids[writeIndex++] = this.layers[i].id
    }
    return ids
  }

  moveDisplayLayer(
    dragLayerId: number,
    targetLayerId: number,
    insertAfter: boolean
  ): boolean {
    if (dragLayerId === targetLayerId) {
      return false
    }
    const displayIds = this.getDisplayLayerIds()
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
    this.applyLayerOrder(nextOrder)
    return true
  }

  cloneLayer(source: EditorBodyLayer): EditorBodyLayer | null {
    if (!canDuplicateLayer(source)) {
      return null
    }
    const duplicate = this.appendPaintLayer(
      `${source.name} ${localizer.t('editor_body_drawer_layer_copy_suffix')}`
    )
    if (source.kind === 'eye') {
      return null
    }
    if (source.canvas && this.ensureLayerSurface(duplicate) && duplicate.ctx) {
      duplicate.ctx.drawImage(source.canvas, 0, 0)
    }
    duplicate.bounds = cloneBounds(source.bounds)
    duplicate.boundsDirty = source.boundsDirty
    return duplicate
  }

  deletePaintLayer(layerId: number): boolean {
    const index = this.getLayerIndexById(layerId)
    if (index < 0 || this.layers[index].kind !== 'paint') {
      return false
    }
    this.layers.splice(index, 1)
    return true
  }

  restoreLayerSnapshots(
    snapshots: EditorBodyLayerSnapshot[],
    order?: number[]
  ) {
    this.buildDefaultLayers()
    this.browCtx.clearRect(0, 0, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
    const browLayer = this.getLayerById(BROW_LAYER_ID)
    if (browLayer) {
      browLayer.bounds = null
      browLayer.boundsDirty = false
    }
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i]
      let layer: EditorBodyLayer | null = null
      if (snapshot.kind === 'brow' && snapshot.id === BROW_LAYER_ID) {
        layer = this.getLayerById(BROW_LAYER_ID)
      } else {
        layer = this.appendPaintLayer(snapshot.name)
        layer.id = snapshot.id
        if (snapshot.id >= this.nextLayerId) {
          this.nextLayerId = snapshot.id + 1
        }
      }
      if (!layer || !this.ensureLayerSurface(layer) || !layer.ctx) {
        continue
      }
      layer.name = snapshot.name
      layer.bounds = applyCanvasSnapshot(layer.ctx, snapshot.image)
      layer.boundsDirty = false
    }
    if (order && order.length > 0) {
      this.applyLayerOrder(order)
    }
  }

  resolveLayerBounds(layer: EditorBodyLayer): EditorCanvasBounds | null {
    if (layer.kind === 'brow') {
      const generatedBounds = this.getGeneratedBrowLayerBounds()
      if (generatedBounds !== undefined) {
        return generatedBounds
      }
    }
    if (
      !layer.ctx ||
      (layer.kind !== 'brow' && layer.kind !== 'paint' && layer.kind !== 'bone')
    ) {
      return null
    }
    if (!layer.boundsDirty) {
      return layer.bounds
    }
    layer.bounds = readAlphaBounds(layer.ctx, DRAW_WORLD_SIZE)
    layer.boundsDirty = false
    return layer.bounds
  }

  captureLayerSnapshot(layer: EditorBodyLayer): EditorBodyLayerSnapshot | null {
    if (
      !layer.ctx ||
      (layer.kind !== 'brow' && layer.kind !== 'paint' && layer.kind !== 'bone')
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
}

export function isLayerMovable(layer: EditorBodyLayer | null): boolean {
  return (
    !!layer &&
    (layer.kind === 'eye' || layer.kind === 'brow' || layer.kind === 'paint')
  )
}

export function isLayerScalable(layer: EditorBodyLayer | null): boolean {
  return (
    !!layer &&
    (layer.kind === 'core' ||
      layer.kind === 'eye' ||
      layer.kind === 'brow' ||
      layer.kind === 'paint')
  )
}

export function isLayerRotatable(layer: EditorBodyLayer | null): boolean {
  return (
    !!layer &&
    (layer.kind === 'core' ||
      layer.kind === 'eye' ||
      layer.kind === 'brow' ||
      layer.kind === 'paint')
  )
}

export function canDuplicateLayer(layer: EditorBodyLayer | null): boolean {
  return !!layer && (layer.kind === 'brow' || layer.kind === 'paint')
}

export function canDeleteLayer(layer: EditorBodyLayer | null): boolean {
  return !!layer && layer.kind === 'paint'
}

export function canStyleLayer(layer: EditorBodyLayer | null): boolean {
  return !!layer && (layer.kind === 'eye' || layer.kind === 'brow')
}

export function sanitizeLayerName(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}
