import type { EmitterConfigV3 } from '@pixi/particle-emitter'
import * as PIXI from 'pixi.js'
import type { Container } from 'pixi.js'

export type ParticleEmitterConfig = EmitterConfigV3

export interface ParticleEmitterInstance {
  emit: boolean
  particleCount: number
  fillPool(count: number): void
  init(config: ParticleEmitterConfig): void
  update(deltaSec: number): void
  rotate(newRot: number): void
  updateOwnerPos(x: number, y: number): void
  resetPositionTracking(): void
  emitNow(): void
  cleanup(): void
  destroy(): void
}

export type ParticleEmitterConstructor = new (
  particleParent: Container,
  config: ParticleEmitterConfig
) => ParticleEmitterInstance

type PixiParticleNamespace = typeof PIXI & {
  particles?: {
    Emitter?: ParticleEmitterConstructor
  }
}

type GlobalWithPixi = typeof globalThis & {
  PIXI?: PixiParticleNamespace
}

let emitterLoadPromise: Promise<ParticleEmitterConstructor | null> | null = null
let emitterBundleExecuted = false

function applyLegacyPixiCompat(namespace: PixiParticleNamespace): void {
  const legacyNamespace = namespace as PixiParticleNamespace & {
    BLEND_MODES?: Record<string, string>
    DisplayObject?: typeof PIXI.ViewContainer
  }

  if (!legacyNamespace.BLEND_MODES) {
    legacyNamespace.BLEND_MODES = {
      NORMAL: 'normal',
      ADD: 'add',
      MULTIPLY: 'multiply',
      SCREEN: 'screen',
      OVERLAY: 'overlay',
      DARKEN: 'darken',
      LIGHTEN: 'lighten',
      COLOR_DODGE: 'color-dodge',
      COLOR_BURN: 'color-burn',
      HARD_LIGHT: 'hard-light',
      SOFT_LIGHT: 'soft-light',
      DIFFERENCE: 'difference',
      EXCLUSION: 'exclusion',
      HUE: 'hue',
      SATURATION: 'saturation',
      COLOR: 'color',
      LUMINOSITY: 'luminosity',
      NORMAL_NPM: 'normal-npm',
      ADD_NPM: 'add-npm',
      SCREEN_NPM: 'screen-npm',
    }
  }

  if (!legacyNamespace.DisplayObject) {
    legacyNamespace.DisplayObject = PIXI.ViewContainer
  }
}

function exposePixiNamespace(): PixiParticleNamespace {
  const scope = globalThis as GlobalWithPixi
  if (scope.PIXI) {
    Object.assign(scope.PIXI, PIXI)
    applyLegacyPixiCompat(scope.PIXI)
    return scope.PIXI
  }

  const namespace = {} as PixiParticleNamespace
  Object.assign(namespace, PIXI)
  applyLegacyPixiCompat(namespace)
  scope.PIXI = namespace
  return namespace
}

export function loadPixiParticleEmitter(): Promise<ParticleEmitterConstructor | null> {
  if (emitterLoadPromise) {
    return emitterLoadPromise
  }

  const namespace = exposePixiNamespace()
  emitterLoadPromise = Promise.resolve()
    .then(() => {
      if (namespace.particles?.Emitter) {
        return namespace.particles.Emitter
      }
      return import('@pixi/particle-emitter/dist/particle-emitter.js?raw').then(
        (module) => {
          if (!emitterBundleExecuted) {
            emitterBundleExecuted = true
            new Function(module.default).call(globalThis)
          }
          return namespace.particles?.Emitter ?? null
        }
      )
    })
    .catch(() => null)

  return emitterLoadPromise
}
