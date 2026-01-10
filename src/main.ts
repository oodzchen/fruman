// import Box2DFactory from 'box2d3-wasm' // Not needed in main thread anymore
import { GameClient } from './GameClient'

// import type { MainModule } from './types'

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
  // const box2d: MainModule = await Box2DFactory() // Moved to worker

  const game = new GameClient(canvas, ctx)

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
  const _btnKill = document.getElementById('btnKill') as HTMLButtonElement
  const _btnRevive = document.getElementById('btnRevive') as HTMLButtonElement

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
      'jumpBufferWindow',
      'jumpBufferWindowNum',
      (value) => {
        game.setJumpBufferWindow(value)
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

  // 缩放控件
  applyControls.push(
    syncInputs(
      'cameraZoom',
      'cameraZoomNum',
      (value) => {
        game.setZoom(value)
      },
      storedValues,
      updateStoredValue
    )
  )

  applyControls.forEach((apply) => apply())

  // Log initial parameters
  console.log('=== 游戏初始化完成 (Worker Mode) ===')
  game.logParameters()

  // 获取缩放控件引用，用于实时同步
  const cameraZoomRange = document.getElementById(
    'cameraZoom'
  ) as HTMLInputElement
  const cameraZoomNum = document.getElementById(
    'cameraZoomNum'
  ) as HTMLInputElement

  // Game Loop is handled inside GameClient for rendering
  // But we need to update UI for zoom
  function uiLoop() {
    const currentZoom = game.getZoom().toFixed(1)
    if (
      cameraZoomRange.value !== currentZoom &&
      document.activeElement !== cameraZoomRange &&
      document.activeElement !== cameraZoomNum
    ) {
      cameraZoomRange.value = currentZoom
      cameraZoomNum.value = currentZoom
    }
    requestAnimationFrame(uiLoop)
  }
  requestAnimationFrame(uiLoop)
}

initialize()
