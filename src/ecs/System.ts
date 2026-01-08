import type { Entity } from './Entity'

export abstract class System {
  protected requiredSignature = 0

  abstract update(entities: Entity[], deltaTime: number): void

  protected setRequiredComponents(componentTypes: number[]): void {
    this.requiredSignature = 0
    for (const type of componentTypes) {
      this.requiredSignature |= type
    }
  }

  matches(entity: Entity): boolean {
    return entity.matchesSignature(this.requiredSignature)
  }

  getRequiredSignature(): number {
    return this.requiredSignature
  }
}
