import { fabric } from 'fabric'

import type { EditorObjectData } from './types'

const SNAP_THRESHOLD_PX = 10
const SNAP_GUIDE_COLOR = 'rgba(240, 220, 180, 0.75)'
const SNAP_EVERY_N_FRAMES = 2

interface SnapBounds {
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
}

interface EditorSnapManagerContext {
  fabricCanvas: () => fabric.Canvas | null
  editorObjects: () => EditorObjectData[]
  editorObjectMap: WeakMap<fabric.Object, EditorObjectData>

  updateGroundPatternTransform?: (object: fabric.Object) => void
  updateObstaclePatternTransform?: (object: fabric.Object) => void
  syncCameraIcon?: (object: fabric.Object) => void
  isCameraFrame?: (object: fabric.Object) => boolean
  cameraViewMap?: WeakMap<fabric.Object, unknown>
}

export class EditorSnapManager {
  private readonly context: EditorSnapManagerContext

  private snapGuideVertical: fabric.Line | null = null
  private snapGuideHorizontal: fabric.Line | null = null
  private snapCandidateBounds: SnapBounds[] = []
  private snapBoundsPool: SnapBounds[] = []

  private snapBoundsScratchA: SnapBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    centerX: 0,
    centerY: 0,
  }

  private snapBoundsScratchB: SnapBounds = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    centerX: 0,
    centerY: 0,
  }

  private snapActiveTarget: fabric.Object | null = null
  private snapFrameCounter = 0

  constructor(context: EditorSnapManagerContext) {
    this.context = context
  }

  ensureSnapGuides(): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas || (this.snapGuideVertical && this.snapGuideHorizontal)) {
      return
    }

    const width = canvas.getWidth()
    const height = canvas.getHeight()
    const baseOptions: fabric.ILineOptions = {
      stroke: SNAP_GUIDE_COLOR,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      objectCaching: false,
      visible: false,
    }

    if (!this.snapGuideVertical) {
      this.snapGuideVertical = new fabric.Line([0, 0, 0, height], baseOptions)
      canvas.add(this.snapGuideVertical)
    }
    if (!this.snapGuideHorizontal) {
      this.snapGuideHorizontal = new fabric.Line([0, 0, width, 0], baseOptions)
      canvas.add(this.snapGuideHorizontal)
    }

    this.snapGuideVertical.bringToFront()
    this.snapGuideHorizontal.bringToFront()
  }

  hideSnapGuides(): void {
    if (this.snapGuideVertical && this.snapGuideVertical.visible) {
      this.snapGuideVertical.visible = false
    }
    if (this.snapGuideHorizontal && this.snapGuideHorizontal.visible) {
      this.snapGuideHorizontal.visible = false
    }
    this.context.fabricCanvas()?.requestRenderAll()
  }

  handleObjectMoving(target: fabric.Object): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas || !this.context.editorObjectMap.has(target)) {
      return
    }

    this.ensureSnapGuides()

    if (this.snapActiveTarget !== target) {
      this.prepareSnapCandidates(target)
    }

    this.snapFrameCounter += 1

    if (this.snapFrameCounter % SNAP_EVERY_N_FRAMES !== 0) {
      if (this.context.updateGroundPatternTransform) {
        this.context.updateGroundPatternTransform(target)
      }
      if (this.context.updateObstaclePatternTransform) {
        this.context.updateObstaclePatternTransform(target)
      }
      if (this.context.isCameraFrame?.(target)) {
        const cameraViewMap = this.context.cameraViewMap
        const syncCameraIcon = this.context.syncCameraIcon
        if (cameraViewMap && syncCameraIcon) {
          const data = cameraViewMap.get(target)
          if (data) {
            syncCameraIcon(target)
          }
        }
      }
      return
    }

    target.setCoords()
    const targetBounds = this.snapBoundsScratchA
    this.updateSnapBoundsFromObject(target, targetBounds)

    let bestDx = 0
    let bestDy = 0
    let bestAbsDx = SNAP_THRESHOLD_PX + 1
    let bestAbsDy = SNAP_THRESHOLD_PX + 1
    let guideX: number | null = null
    let guideY: number | null = null

    const candidates = this.snapCandidateBounds

    for (let i = 0; i < candidates.length; i++) {
      const otherBounds = candidates[i]

      const dxLL = otherBounds.left - targetBounds.left
      const dxLR = otherBounds.left - targetBounds.right
      const dxRL = otherBounds.right - targetBounds.left
      const dxRR = otherBounds.right - targetBounds.right
      const dxCC = otherBounds.centerX - targetBounds.centerX

      const dyTT = otherBounds.top - targetBounds.top
      const dyTB = otherBounds.top - targetBounds.bottom
      const dyBT = otherBounds.bottom - targetBounds.top
      const dyBB = otherBounds.bottom - targetBounds.bottom
      const dyCC = otherBounds.centerY - targetBounds.centerY

      const absDxLL = Math.abs(dxLL)
      if (absDxLL < bestAbsDx && absDxLL <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxLL
        bestDx = dxLL
        guideX = null
      }
      const absDxLR = Math.abs(dxLR)
      if (absDxLR < bestAbsDx && absDxLR <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxLR
        bestDx = dxLR
        guideX = null
      }
      const absDxRL = Math.abs(dxRL)
      if (absDxRL < bestAbsDx && absDxRL <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxRL
        bestDx = dxRL
        guideX = null
      }
      const absDxRR = Math.abs(dxRR)
      if (absDxRR < bestAbsDx && absDxRR <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxRR
        bestDx = dxRR
        guideX = null
      }
      const absDxCC = Math.abs(dxCC)
      if (absDxCC < bestAbsDx && absDxCC <= SNAP_THRESHOLD_PX) {
        bestAbsDx = absDxCC
        bestDx = dxCC
        guideX = otherBounds.centerX
      }

      const absDyTT = Math.abs(dyTT)
      if (absDyTT < bestAbsDy && absDyTT <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyTT
        bestDy = dyTT
        guideY = null
      }
      const absDyTB = Math.abs(dyTB)
      if (absDyTB < bestAbsDy && absDyTB <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyTB
        bestDy = dyTB
        guideY = null
      }
      const absDyBT = Math.abs(dyBT)
      if (absDyBT < bestAbsDy && absDyBT <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyBT
        bestDy = dyBT
        guideY = null
      }
      const absDyBB = Math.abs(dyBB)
      if (absDyBB < bestAbsDy && absDyBB <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyBB
        bestDy = dyBB
        guideY = null
      }
      const absDyCC = Math.abs(dyCC)
      if (absDyCC < bestAbsDy && absDyCC <= SNAP_THRESHOLD_PX) {
        bestAbsDy = absDyCC
        bestDy = dyCC
        guideY = otherBounds.centerY
      }
    }

    if (bestAbsDx <= SNAP_THRESHOLD_PX || bestAbsDy <= SNAP_THRESHOLD_PX) {
      target.set({
        left: (target.left ?? 0) + bestDx,
        top: (target.top ?? 0) + bestDy,
      })
      target.setCoords()
    }

    if (guideX !== null) {
      this.updateSnapGuideVertical(guideX)
    } else if (this.snapGuideVertical) {
      this.snapGuideVertical.visible = false
    }
    if (guideY !== null) {
      this.updateSnapGuideHorizontal(guideY)
    } else if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.visible = false
    }

    if (this.context.updateGroundPatternTransform) {
      this.context.updateGroundPatternTransform(target)
    }
    if (this.context.updateObstaclePatternTransform) {
      this.context.updateObstaclePatternTransform(target)
    }
    if (this.context.isCameraFrame?.(target)) {
      const cameraViewMap = this.context.cameraViewMap
      const syncCameraIcon = this.context.syncCameraIcon
      if (cameraViewMap && syncCameraIcon) {
        const data = cameraViewMap.get(target)
        if (data) {
          syncCameraIcon(target)
        }
      }
    }

    canvas.requestRenderAll()
  }

  prepareSnapCandidates(target: fabric.Object): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
      return
    }

    this.clearSnapCandidates()
    this.snapActiveTarget = target

    const editorObjects = this.context.editorObjects()
    for (let i = 0; i < editorObjects.length; i++) {
      const other = editorObjects[i].object
      if (other === target || other.canvas !== canvas) {
        continue
      }

      other.setCoords()
      const bounds = this.acquireSnapBounds()
      this.updateSnapBoundsFromObject(other, bounds)
      this.snapCandidateBounds.push(bounds)
    }
  }

  clearSnapCandidates(): void {
    for (let i = 0; i < this.snapCandidateBounds.length; i++) {
      this.releaseSnapBounds(this.snapCandidateBounds[i])
    }
    this.snapCandidateBounds.length = 0
    this.snapActiveTarget = null
    this.snapFrameCounter = 0
  }

  resizeSnapGuides(): void {
    const canvas = this.context.fabricCanvas()
    if (!canvas) {
      return
    }

    const width = canvas.getWidth()
    const height = canvas.getHeight()

    if (this.snapGuideVertical) {
      this.snapGuideVertical.set({
        x1: this.snapGuideVertical.x1,
        x2: this.snapGuideVertical.x2,
        y1: 0,
        y2: height,
      })
      this.snapGuideVertical.setCoords()
    }
    if (this.snapGuideHorizontal) {
      this.snapGuideHorizontal.set({
        x1: 0,
        x2: width,
        y1: this.snapGuideHorizontal.y1,
        y2: this.snapGuideHorizontal.y2,
      })
      this.snapGuideHorizontal.setCoords()
    }
  }

  private updateSnapGuideVertical(x: number): void {
    const canvas = this.context.fabricCanvas()
    if (!this.snapGuideVertical || !canvas) {
      return
    }

    const height = canvas.getHeight()
    this.snapGuideVertical.set({
      x1: x,
      y1: 0,
      x2: x,
      y2: height,
      visible: true,
    })
    this.snapGuideVertical.setCoords()
    this.snapGuideVertical.bringToFront()
  }

  private updateSnapGuideHorizontal(y: number): void {
    const canvas = this.context.fabricCanvas()
    if (!this.snapGuideHorizontal || !canvas) {
      return
    }

    const width = canvas.getWidth()
    this.snapGuideHorizontal.set({
      x1: 0,
      y1: y,
      x2: width,
      y2: y,
      visible: true,
    })
    this.snapGuideHorizontal.setCoords()
    this.snapGuideHorizontal.bringToFront()
  }

  private updateSnapBoundsFromObject(
    object: fabric.Object,
    out: SnapBounds
  ): void {
    const coords = object.aCoords
    if (!coords) {
      return
    }

    let minX = coords.tl.x
    let maxX = coords.tl.x
    let minY = coords.tl.y
    let maxY = coords.tl.y

    const tr = coords.tr
    const br = coords.br
    const bl = coords.bl

    if (tr.x < minX) minX = tr.x
    if (tr.x > maxX) maxX = tr.x
    if (br.x < minX) minX = br.x
    if (br.x > maxX) maxX = br.x
    if (bl.x < minX) minX = bl.x
    if (bl.x > maxX) maxX = bl.x

    if (tr.y < minY) minY = tr.y
    if (tr.y > maxY) maxY = tr.y
    if (br.y < minY) minY = br.y
    if (br.y > maxY) maxY = br.y
    if (bl.y < minY) minY = bl.y
    if (bl.y > maxY) maxY = bl.y

    out.left = minX
    out.right = maxX
    out.top = minY
    out.bottom = maxY
    out.centerX = (minX + maxX) * 0.5
    out.centerY = (minY + maxY) * 0.5
  }

  private acquireSnapBounds(): SnapBounds {
    return (
      this.snapBoundsPool.pop() ?? {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        centerX: 0,
        centerY: 0,
      }
    )
  }

  private releaseSnapBounds(bounds: SnapBounds): void {
    this.snapBoundsPool.push(bounds)
  }
}
