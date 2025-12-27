import Box2DFactory from 'box2d3-wasm'

import { Game } from './game'
import type { MainModule } from './types'

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

const controlStorageKey = 'sl2d:control-panel'

const loadStoredValues = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(controlStorageKey)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, string>
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    return {}
  }
  return {}
}

const saveStoredValues = (values: Record<string, string>) => {
  try {
    localStorage.setItem(controlStorageKey, JSON.stringify(values))
  } catch {
    return
  }
}

const setupDetailsState = (
  storedValues: Record<string, string>,
  updateStoredValue: (id: string, value: string) => void
) => {
  const detailsElements = document.querySelectorAll<HTMLDetailsElement>(
    '#controlPanel details[id]'
  )
  detailsElements.forEach((details) => {
    const storageKey = `details:${details.id}`
    const storedValue = storedValues[storageKey]
    if (storedValue === '1') {
      details.open = true
    } else if (storedValue === '0') {
      details.open = false
    }

    details.addEventListener('toggle', () => {
      updateStoredValue(storageKey, details.open ? '1' : '0')
    })
  })
}

// Helper function to sync range and number inputs
function syncInputs(
  rangeId: string,
  numberId: string,
  callback: (value: number) => void,
  storedValues: Record<string, string>,
  updateStoredValue: (id: string, value: string) => void
) {
  const range = document.getElementById(rangeId)
  const number = document.getElementById(numberId)

  if (!(range instanceof HTMLInputElement)) {
    return () => {}
  }

  if (!(number instanceof HTMLInputElement)) {
    return () => {}
  }

  const applyValue = (rawValue: string, shouldStore: boolean) => {
    const value = Number.parseFloat(rawValue)
    if (!Number.isFinite(value)) {
      return
    }
    callback(value)
    if (shouldStore) {
      updateStoredValue(rangeId, rawValue)
    }
  }

  const setPairValue = (rawValue: string, shouldStore: boolean) => {
    range.value = rawValue
    number.value = rawValue
    applyValue(rawValue, shouldStore)
  }

  const applyRange = () => {
    setPairValue(range.value, true)
  }

  const applyNumber = () => {
    setPairValue(number.value, true)
  }

  range.addEventListener('input', applyRange)
  range.addEventListener('change', applyRange)
  number.addEventListener('input', applyNumber)
  number.addEventListener('change', applyNumber)

  const storedValue = storedValues[rangeId]
  if (typeof storedValue === 'string') {
    setPairValue(storedValue, false)
  }

  return () => setPairValue(range.value, false)
}

async function initialize() {
  const box2d: MainModule = await Box2DFactory()

  const game = new Game(box2d, canvas, ctx)
  const storedValues = loadStoredValues()
  const updateStoredValue = (id: string, value: string) => {
    storedValues[id] = value
    saveStoredValues(storedValues)
  }
  const applyControls: Array<() => void> = []
  setupDetailsState(storedValues, updateStoredValue)

  // Setup control panel
  const btnStop = document.getElementById('btnStop') as HTMLButtonElement
  const btnRestart = document.getElementById('btnRestart') as HTMLButtonElement
  const btnKill = document.getElementById('btnKill') as HTMLButtonElement
  const btnRevive = document.getElementById('btnRevive') as HTMLButtonElement

  btnStop.addEventListener('click', () => {
    game.stop()
    btnStop.textContent = '继续'
    btnStop.onclick = () => {
      game.start()
      btnStop.textContent = '暂停'
      btnStop.onclick = null
      btnStop.addEventListener('click', () => {
        game.stop()
        btnStop.textContent = '继续'
      })
    }
  })

  btnRestart.addEventListener('click', () => {
    game.restart()
    applyControls.forEach((apply) => apply())
    btnStop.textContent = '暂停'
  })

  btnKill.addEventListener('click', () => {
    game.getPlayer().setAlive(false)
  })

  btnRevive.addEventListener('click', () => {
    game.getPlayer().setAlive(true)
  })

  // Setup parameter controls
  applyControls.push(
    syncInputs(
      'jumpForce',
      'jumpForceNum',
      (value) => {
        game.getPlayer().setJumpForce(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'maxJumpDuration',
      'maxJumpDurationNum',
      (value) => {
        game.getPlayer().setMaxJumpDuration(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'hertz',
      'hertzNum',
      (value) => {
        game.getPlayer().setHertz(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'dampingRatio',
      'dampingRatioNum',
      (value) => {
        game.getPlayer().setDampingRatio(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'frictionTorque',
      'frictionTorqueNum',
      (value) => {
        game.getPlayer().setFrictionTorque(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'moveSpeed',
      'moveSpeedNum',
      (value) => {
        game.getPlayer().setMoveSpeed(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'jumpForceMultiplier',
      'jumpForceMultiplierNum',
      (value) => {
        game.getPlayer().setJumpForceMultiplier(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'wallJumpPushAway',
      'wallJumpPushAwayNum',
      (value) => {
        game.getPlayer().setWallJumpPushAwayMultiplier(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'wallJumpUpward',
      'wallJumpUpwardNum',
      (value) => {
        game.getPlayer().setWallJumpUpwardMultiplier(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'maxWallJumps',
      'maxWallJumpsNum',
      (value) => {
        game.getPlayer().setMaxWallJumps(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'bodyFriction',
      'bodyFrictionNum',
      (value) => {
        game.getPlayer().setBodyFriction(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'footFriction',
      'footFrictionNum',
      (value) => {
        game.getPlayer().setFootFriction(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'hipLinearDamping',
      'hipLinearDampingNum',
      (value) => {
        game.getPlayer().setHipLinearDamping(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'bodyLinearDamping',
      'bodyLinearDampingNum',
      (value) => {
        game.getPlayer().setBodyLinearDamping(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'groundFriction',
      'groundFrictionNum',
      (value) => {
        game.setGroundFriction(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.push(
    syncInputs(
      'obstacleFriction',
      'obstacleFrictionNum',
      (value) => {
        game.setObstacleFriction(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.forEach((apply) => apply())

  // Log initial parameters
  console.log('=== 游戏初始化完成 ===')
  game.logParameters()

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
