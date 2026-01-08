export class ComponentRegistry {
  private componentTypes = new Map<string, number>()
  private nextComponentType = 1

  registerComponent(name: string): number {
    if (this.componentTypes.has(name)) {
      return this.componentTypes.get(name)!
    }

    const componentType = this.nextComponentType
    this.nextComponentType = this.nextComponentType << 1
    this.componentTypes.set(name, componentType)
    return componentType
  }

  getComponentType(name: string): number {
    return this.componentTypes.get(name) ?? 0
  }
}

export const componentRegistry = new ComponentRegistry()
