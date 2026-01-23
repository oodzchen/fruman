import { GameClient } from './GameClient'
import { InitializationManager } from './InitializationManager'
import { Language, localizer } from './Localizer'
import { MenuAction, MenuMode } from './MenuManager'
import {
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_JUMP_BUFFER_WINDOW,
  DEFAULT_JUMP_FORCE,
  DEFAULT_JUMP_FORCE_MULTIPLIER,
  DEFAULT_MAX_JUMP_DURATION,
  DEFAULT_MAX_WALL_JUMPS,
  DEFAULT_MOVE_SPEED,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
} from './constants'
import { loadStoredValues, saveStoredValues } from './storage'

interface ParamConfig {
  id: string
  numberId: string
  label: string
  defaultValue: number
}

const PARAM_CONFIGS: ParamConfig[] = [
  {
    id: 'jumpForce',
    numberId: 'jumpForceNum',
    label: 'param_jump_force',
    defaultValue: DEFAULT_JUMP_FORCE,
  },
  {
    id: 'jumpBufferWindow',
    numberId: 'jumpBufferWindowNum',
    label: 'param_jump_buffer',
    defaultValue: DEFAULT_JUMP_BUFFER_WINDOW,
  },
  {
    id: 'maxJumpDuration',
    numberId: 'maxJumpDurationNum',
    label: 'param_jump_duration',
    defaultValue: DEFAULT_MAX_JUMP_DURATION,
  },
  {
    id: 'jumpForceMultiplier',
    numberId: 'jumpForceMultiplierNum',
    label: 'param_sustained_jump',
    defaultValue: DEFAULT_JUMP_FORCE_MULTIPLIER,
  },
  {
    id: 'wallJumpPushAway',
    numberId: 'wallJumpPushAwayNum',
    label: 'param_wall_jump_horizontal',
    defaultValue: DEFAULT_WALL_JUMP_PUSH_AWAY_MULTIPLIER,
  },
  {
    id: 'wallJumpUpward',
    numberId: 'wallJumpUpwardNum',
    label: 'param_wall_jump_vertical',
    defaultValue: DEFAULT_WALL_JUMP_UPWARD_MULTIPLIER,
  },
  {
    id: 'maxWallJumps',
    numberId: 'maxWallJumpsNum',
    label: 'param_max_wall_jumps',
    defaultValue: DEFAULT_MAX_WALL_JUMPS,
  },
  {
    id: 'moveSpeed',
    numberId: 'moveSpeedNum',
    label: 'param_move_speed',
    defaultValue: DEFAULT_MOVE_SPEED,
  },
  {
    id: 'bodyFriction',
    numberId: 'bodyFrictionNum',
    label: 'param_body_friction',
    defaultValue: DEFAULT_BODY_FRICTION,
  },
  {
    id: 'bodyLinearDamping',
    numberId: 'bodyLinearDampingNum',
    label: 'param_linear_damping',
    defaultValue: DEFAULT_BODY_LINEAR_DAMPING,
  },
  {
    id: 'groundFriction',
    numberId: 'groundFrictionNum',
    label: 'param_ground_friction',
    defaultValue: DEFAULT_GROUND_FRICTION,
  },
  {
    id: 'obstacleFriction',
    numberId: 'obstacleFrictionNum',
    label: 'param_obstacle_friction',
    defaultValue: DEFAULT_OBSTACLE_FRICTION,
  },
  {
    id: 'cameraZoom',
    numberId: 'cameraZoomNum',
    label: 'param_camera_zoom',
    defaultValue: DEFAULT_CAMERA_ZOOM,
  },
]

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

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

interface SyncInputsResult {
  apply: () => void
  getValue: () => number
}

function syncInputs(
  config: ParamConfig,
  callback: (value: number) => void,
  storedValues: Record<string, string>,
  updateStoredValue: (id: string, value: string) => void
): SyncInputsResult {
  const { id: rangeId, numberId, defaultValue } = config
  const range = document.getElementById(rangeId)
  const number = document.getElementById(numberId)

  let currentValue = defaultValue

  if (!(range instanceof HTMLInputElement)) {
    return { apply: () => {}, getValue: () => currentValue }
  }

  if (!(number instanceof HTMLInputElement)) {
    return { apply: () => {}, getValue: () => currentValue }
  }

  const applyValue = (rawValue: string, shouldStore: boolean) => {
    const value = Number.parseFloat(rawValue)
    if (!Number.isFinite(value)) {
      return
    }
    currentValue = value
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
  } else {
    setPairValue(String(defaultValue), false)
  }

  return {
    apply: () => setPairValue(range.value, false),
    getValue: () => currentValue,
  }
}

async function initialize() {
  await localizer.init(Language.ZhHans)

  const initManager = new InitializationManager(canvas, ctx)
  const steps = [
    'init_loading_config',
    'init_renderer',
    'init_textures',
    'init_game_logic',
    'init_input',
    'init_audio',
    'init_complete',
  ]
  initManager.setSteps(steps)

  initManager.nextStep('init_loading_config')
  await new Promise((resolve) => setTimeout(resolve, 200))

  const storedValues = await loadStoredValues()
  const updateStoredValue = (id: string, value: string) => {
    storedValues[id] = value
    saveStoredValues(storedValues)
  }
  const applyControls: Array<() => void> = []
  setupDetailsState(storedValues, updateStoredValue)

  const game = new GameClient(canvas, ctx, (step: string) => {
    initManager.nextStep(step)
  })

  initManager.complete()
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Setup control panel
  const btnStop = document.getElementById('btnStop') as HTMLButtonElement
  const btnRestart = document.getElementById('btnRestart') as HTMLButtonElement
  const _btnKill = document.getElementById('btnKill') as HTMLButtonElement
  const _btnRevive = document.getElementById('btnRevive') as HTMLButtonElement

  btnStop.addEventListener('click', () => {
    game.stop()
    btnStop.textContent = localizer.t('ui_resume')
    btnStop.onclick = () => {
      game.start()
      btnStop.textContent = localizer.t('ui_pause')
      btnStop.onclick = null
      btnStop.addEventListener('click', () => {
        game.stop()
        btnStop.textContent = localizer.t('ui_resume')
      })
    }
  })

  btnRestart.addEventListener('click', () => {
    game.restart()
    applyControls.forEach((apply) => apply())
    btnStop.textContent = localizer.t('ui_pause')
  })

  // 参数回调映射
  const paramCallbacks: Record<string, (value: number) => void> = {
    jumpForce: (v) => game.getPlayer().setJumpForce(v),
    jumpBufferWindow: (v) => game.setJumpBufferWindow(v),
    maxJumpDuration: (v) => game.getPlayer().setMaxJumpDuration(v),
    jumpForceMultiplier: (v) => game.getPlayer().setJumpForceMultiplier(v),
    wallJumpPushAway: (v) => game.getPlayer().setWallJumpPushAwayMultiplier(v),
    wallJumpUpward: (v) => game.getPlayer().setWallJumpUpwardMultiplier(v),
    maxWallJumps: (v) => game.getPlayer().setMaxWallJumps(v),
    moveSpeed: (v) => game.getPlayer().setMoveSpeed(v),
    bodyFriction: (v) => game.getPlayer().setBodyFriction(v),
    bodyLinearDamping: (v) => game.getPlayer().setBodyLinearDamping(v),
    groundFriction: (v) => game.setGroundFriction(v),
    obstacleFriction: (v) => game.setObstacleFriction(v),
    cameraZoom: (v) => game.setZoom(v),
  }

  // 设置所有参数控件
  const paramResults: Record<string, SyncInputsResult> = {}
  for (const config of PARAM_CONFIGS) {
    const callback = paramCallbacks[config.id]
    if (callback) {
      const result = syncInputs(
        config,
        callback,
        storedValues,
        updateStoredValue
      )
      paramResults[config.id] = result
      applyControls.push(result.apply)
    }
  }

  applyControls.forEach((apply) => apply())

  // 打印最终实际使用的可配置参数
  console.log('=== 游戏初始化完成 ===')
  console.log('可配置参数:')
  const paramLog: Record<string, number> = {}
  for (const config of PARAM_CONFIGS) {
    const result = paramResults[config.id]
    if (result) {
      paramLog[localizer.t(config.label)] = result.getValue()
    }
  }
  console.table(paramLog)

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

  const menuManager = game.getMenuManager()
  menuManager.onAction((action: MenuAction) => {
    switch (action) {
      case MenuAction.NewGame:
        menuManager.hide()
        game.restart()
        break
      case MenuAction.Continue:
        menuManager.hide()
        game.start()
        break
      case MenuAction.Resume:
        menuManager.hide()
        game.start()
        break
      case MenuAction.MainMenu:
        game.restart()
        game.stop()
        menuManager.show(MenuMode.Start)
        break
      case MenuAction.Editor:
        alert(localizer.t('alert_editor_not_implemented'))
        break
      case MenuAction.Settings:
        alert(localizer.t('alert_settings_not_implemented'))
        break
      case MenuAction.Exit:
        if (confirm(localizer.t('confirm_exit_game'))) {
          window.close()
        }
        break
    }
  })

  game.stop()
  menuManager.show(MenuMode.Start)
}

initialize()
