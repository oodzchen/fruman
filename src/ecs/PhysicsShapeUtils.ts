import type { b2ShapeId } from '../types'
import type { PhysicsComponent } from './Component'

export function forEachPhysicsShapeId(
  physics: PhysicsComponent,
  callback: (shapeId: b2ShapeId) => void
): void {
  if (physics.shapeIds.length > 0) {
    for (let i = 0; i < physics.shapeIds.length; i++) {
      callback(physics.shapeIds[i])
    }
    return
  }
  callback(physics.shapeId)
}
