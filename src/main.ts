import Box2DFactory from 'box2d3-wasm'

import { Game } from './game'
import type { MainModule } from './types'

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

async function initialize() {
  const box2d: MainModule = await Box2DFactory()

  const game = new Game(box2d, canvas, ctx)

  let lastTime = 0
  function gameLoop(currentTime: number) {
    const deltaTime = (currentTime - lastTime) / 1000
    lastTime = currentTime

    game.update(Math.min(deltaTime, 0.1))
    game.render()

    requestAnimationFrame(gameLoop)
  }

  requestAnimationFrame(gameLoop)
}

initialize()
