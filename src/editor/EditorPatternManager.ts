import * as fabric from 'fabric'

interface EditorPatternManagerContext {
  fabricCanvas: () => fabric.Canvas | null
}

export class EditorPatternManager {
  private readonly context: EditorPatternManagerContext

  constructor(context: EditorPatternManagerContext) {
    this.context = context
  }

  clearAll(): void {}

  deletePattern(_object: fabric.Object): void {}

  applyGroundPatternToObject(_object: fabric.Object): void {
    this.context.fabricCanvas()?.requestRenderAll()
  }

  applyObstaclePatternToObject(_object: fabric.Object): void {
    this.context.fabricCanvas()?.requestRenderAll()
  }

  updateGroundPatternTransform(_object: fabric.Object): void {}

  updateObstaclePatternTransform(_object: fabric.Object): void {}
}
