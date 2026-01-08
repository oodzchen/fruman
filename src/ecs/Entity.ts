import type { Component } from './Component'
import {
  FactionComponent,
  InputComponent,
  MovementComponent,
  PhysicsComponent,
  RenderComponent,
  TransformComponent,
  WeaponComponent,
} from './Component'

let nextEntityId = 1

export class Entity {
  id: number
  private components = new Map<string, Component>()
  private signature = 0

  transform?: TransformComponent
  physics?: PhysicsComponent
  movement?: MovementComponent
  input?: InputComponent
  render?: RenderComponent
  weapon?: WeaponComponent
  faction?: FactionComponent

  constructor() {
    this.id = nextEntityId++
  }

  addComponent(component: Component): void {
    const name = component.getName()
    this.components.set(name, component)
    this.signature |= component.getType()

    this.updateCachedComponents(name, component)
  }

  getComponent<T extends Component>(name: string): T | undefined {
    return this.components.get(name) as T | undefined
  }

  hasComponent(name: string): boolean {
    return this.components.has(name)
  }

  removeComponent(name: string): void {
    const component = this.components.get(name)
    if (component) {
      this.signature &= ~component.getType()
      this.components.delete(name)
      this.clearCachedComponent(name)
    }
  }

  getSignature(): number {
    return this.signature
  }

  matchesSignature(requiredSignature: number): boolean {
    return (this.signature & requiredSignature) === requiredSignature
  }

  private updateCachedComponents(name: string, component: Component): void {
    switch (name) {
      case 'Transform':
        this.transform = component as TransformComponent
        break
      case 'Physics':
        this.physics = component as PhysicsComponent
        break
      case 'Movement':
        this.movement = component as MovementComponent
        break
      case 'Input':
        this.input = component as InputComponent
        break
      case 'Render':
        this.render = component as RenderComponent
        break
      case 'Weapon':
        this.weapon = component as WeaponComponent
        break
      case 'Faction':
        this.faction = component as FactionComponent
        break
    }
  }

  private clearCachedComponent(name: string): void {
    switch (name) {
      case 'Transform':
        this.transform = undefined
        break
      case 'Physics':
        this.physics = undefined
        break
      case 'Movement':
        this.movement = undefined
        break
      case 'Input':
        this.input = undefined
        break
      case 'Render':
        this.render = undefined
        break
      case 'Weapon':
        this.weapon = undefined
        break
      case 'Faction':
        this.faction = undefined
        break
    }
  }
}
