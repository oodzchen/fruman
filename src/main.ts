import { DialogManager } from './DialogManager'
import { DisplayManager } from './DisplayManager'
import { EditorManager } from './EditorManager'
import { GameClient } from './GameClient'
import { InitializationManager } from './InitializationManager'
import { Language, localizer } from './Localizer'
import { MapImportExportPanel } from './MapImportExportPanel'
import { MenuMode } from './MenuManager'
import { isMobileGameDevice } from './MobileControls'
import {
  DEFAULT_BODY_FRICTION,
  DEFAULT_BODY_LINEAR_DAMPING,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GRAPPLE_ROPE_BEND_STIFFNESS,
  DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ,
  DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE,
  DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO,
  DEFAULT_GRAPPLE_ROPE_DENSITY,
  DEFAULT_GRAPPLE_ROPE_ELASTIC_LIMIT_SCALE,
  DEFAULT_GRAPPLE_ROPE_HERTZ,
  DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING,
  DEFAULT_GRAPPLE_SWING_FORCE,
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
import { initializeTerrainPolygonUtils } from './terrain/TerrainPolygonUtils'

interface ParamConfig {
  id: string
  numberId: string
  label: string
  defaultValue: number
}

const DEFAULT_BREAKABLE_CRATE_DENSITY = 3.6
const DEFAULT_BREAKABLE_CRATE_FRICTION = 1
const DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING = 0.6
const DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING = 1.8
const DEFAULT_BREAKABLE_CRATE_RESTITUTION = 0.02

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
    id: 'breakableCrateDensity',
    numberId: 'breakableCrateDensityNum',
    label: 'param_breakable_crate_density',
    defaultValue: DEFAULT_BREAKABLE_CRATE_DENSITY,
  },
  {
    id: 'breakableCrateFriction',
    numberId: 'breakableCrateFrictionNum',
    label: 'param_breakable_crate_friction',
    defaultValue: DEFAULT_BREAKABLE_CRATE_FRICTION,
  },
  {
    id: 'breakableCrateLinearDamping',
    numberId: 'breakableCrateLinearDampingNum',
    label: 'param_breakable_crate_linear_damping',
    defaultValue: DEFAULT_BREAKABLE_CRATE_LINEAR_DAMPING,
  },
  {
    id: 'breakableCrateAngularDamping',
    numberId: 'breakableCrateAngularDampingNum',
    label: 'param_breakable_crate_angular_damping',
    defaultValue: DEFAULT_BREAKABLE_CRATE_ANGULAR_DAMPING,
  },
  {
    id: 'breakableCrateRestitution',
    numberId: 'breakableCrateRestitutionNum',
    label: 'param_breakable_crate_restitution',
    defaultValue: DEFAULT_BREAKABLE_CRATE_RESTITUTION,
  },
  {
    id: 'cameraZoom',
    numberId: 'cameraZoomNum',
    label: 'param_camera_zoom',
    defaultValue: DEFAULT_CAMERA_ZOOM,
  },
  {
    id: 'ropeDensity',
    numberId: 'ropeDensityNum',
    label: 'param_rope_density',
    defaultValue: DEFAULT_GRAPPLE_ROPE_DENSITY,
  },
  {
    id: 'ropeLinearDamping',
    numberId: 'ropeLinearDampingNum',
    label: 'param_rope_linear_damping',
    defaultValue: DEFAULT_GRAPPLE_ROPE_LINEAR_DAMPING,
  },
  {
    id: 'ropeHertz',
    numberId: 'ropeHertzNum',
    label: 'param_rope_hertz',
    defaultValue: DEFAULT_GRAPPLE_ROPE_HERTZ,
  },
  {
    id: 'ropeDampingRatio',
    numberId: 'ropeDampingRatioNum',
    label: 'param_rope_damping_ratio',
    defaultValue: DEFAULT_GRAPPLE_ROPE_DAMPING_RATIO,
  },
  {
    id: 'ropeBendStiffness',
    numberId: 'ropeBendStiffnessNum',
    label: 'param_rope_bend_stiffness',
    defaultValue: DEFAULT_GRAPPLE_ROPE_BEND_STIFFNESS,
  },
  {
    id: 'ropeElasticLimitScale',
    numberId: 'ropeElasticLimitScaleNum',
    label: 'param_rope_elastic_limit_scale',
    defaultValue: DEFAULT_GRAPPLE_ROPE_ELASTIC_LIMIT_SCALE,
  },
  {
    id: 'ropeClimbLinearDamping',
    numberId: 'ropeClimbLinearDampingNum',
    label: 'param_rope_climb_linear_damping',
    defaultValue: DEFAULT_GRAPPLE_ROPE_CLIMB_LINEAR_DAMPING,
  },
  {
    id: 'ropeClimbHertz',
    numberId: 'ropeClimbHertzNum',
    label: 'param_rope_climb_hertz',
    defaultValue: DEFAULT_GRAPPLE_ROPE_CLIMB_HERTZ,
  },
  {
    id: 'ropeClimbDampingRatio',
    numberId: 'ropeClimbDampingRatioNum',
    label: 'param_rope_climb_damping_ratio',
    defaultValue: DEFAULT_GRAPPLE_ROPE_CLIMB_DAMPING_RATIO,
  },
  {
    id: 'ropeClimbWeightForceScale',
    numberId: 'ropeClimbWeightForceScaleNum',
    label: 'param_rope_climb_weight_force_scale',
    defaultValue: DEFAULT_GRAPPLE_ROPE_CLIMB_WEIGHT_FORCE_SCALE,
  },
  {
    id: 'swingForce',
    numberId: 'swingForceNum',
    label: 'param_swing_force',
    defaultValue: DEFAULT_GRAPPLE_SWING_FORCE,
  },
]

function setupParamResetButton(config: ParamConfig, onReset: () => void): void {
  const label = document.querySelector<HTMLLabelElement>(
    `label[for="${config.id}"]`
  )
  if (!label) {
    return
  }

  const controlGroup = label.closest('.control-group')
  if (!(controlGroup instanceof HTMLDivElement)) {
    return
  }

  const existingButton = controlGroup.querySelector<HTMLButtonElement>(
    `.param-reset-button[data-param-id="${config.id}"]`
  )
  if (existingButton) {
    return
  }

  let labelRow = label.parentElement
  if (
    !(labelRow instanceof HTMLDivElement) ||
    !labelRow.classList.contains('control-label-row')
  ) {
    labelRow = document.createElement('div')
    labelRow.className = 'control-label-row'
    controlGroup.insertBefore(labelRow, label)
    labelRow.appendChild(label)
  }

  const resetButton = document.createElement('button')
  resetButton.type = 'button'
  resetButton.className = 'param-reset-button'
  resetButton.dataset.paramId = config.id
  resetButton.textContent = localizer.t('ui_reset')
  resetButton.title = `${localizer.t('ui_reset')} ${localizer.t(config.label)}`
  resetButton.addEventListener('click', onReset)
  labelRow.appendChild(resetButton)
}

const gameContainer = document.getElementById('gameContainer') as HTMLDivElement
gameContainer.classList.toggle('is-development', import.meta.env.DEV)

const menuOverlay = document.getElementById('menuOverlay') as HTMLDivElement
const gameViewport = document.getElementById('gameViewport') as HTMLDivElement
const mobileGame = isMobileGameDevice()
document.body.classList.toggle('is-mobile-game', mobileGame)
gameViewport.classList.toggle('is-mobile-game', mobileGame)
const dialogManager = new DialogManager(gameViewport, gameViewport)
const displayManager = new DisplayManager(gameViewport)
const focusOptions: FocusOptions = { preventScroll: true }
const MOBILE_ATTACK_DEFENSE_BUTTONS_SETTING =
  'mobileAttackDefenseButtonsVisible'

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

  if (!(range instanceof HTMLInputElement)) {
    return { apply: () => {} }
  }

  if (!(number instanceof HTMLInputElement)) {
    return { apply: () => {} }
  }

  const clampValue = (value: number): number => {
    let clampedValue = value
    const min = Number.parseFloat(number.min)
    if (Number.isFinite(min) && clampedValue < min) {
      clampedValue = min
    }
    const max = Number.parseFloat(number.max)
    if (Number.isFinite(max) && clampedValue > max) {
      clampedValue = max
    }
    return clampedValue
  }

  const setPairValue = (rawValue: string, shouldStore: boolean) => {
    const parsedValue = Number.parseFloat(rawValue)
    if (!Number.isFinite(parsedValue)) {
      return
    }
    const value = clampValue(parsedValue)
    const nextRawValue = String(value)
    range.value = nextRawValue
    number.value = nextRawValue
    callback(value)
    if (shouldStore) {
      updateStoredValue(rangeId, nextRawValue)
    }
  }

  setupParamResetButton(config, () => {
    setPairValue(String(defaultValue), true)
  })

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
  }
}

function setParamControlValue(id: string, value: number): void {
  let targetConfig: ParamConfig | null = null
  for (let i = 0; i < PARAM_CONFIGS.length; i++) {
    const config = PARAM_CONFIGS[i]
    if (config.id === id) {
      targetConfig = config
      break
    }
  }
  if (!targetConfig) return

  const rawValue = String(value)
  const range = document.getElementById(targetConfig.id)
  const number = document.getElementById(targetConfig.numberId)
  if (range instanceof HTMLInputElement) {
    range.value = rawValue
  }
  if (number instanceof HTMLInputElement) {
    number.value = rawValue
  }
}

async function initialize() {
  await localizer.init(Language.ZhHans)

  const initManager = new InitializationManager(gameViewport)
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
  await initializeTerrainPolygonUtils()
  const updateStoredValue = (id: string, value: string) => {
    storedValues[id] = value
    saveStoredValues(storedValues)
  }
  const applyControls: Array<() => void> = []
  setupDetailsState(storedValues, updateStoredValue)

  const game = await GameClient.create(
    menuOverlay,
    gameViewport,
    mobileGame,
    (step: string) => {
      initManager.nextStep(step)
    }
  )
  game.setMobileAttackDefenseButtonsVisible(
    storedValues[MOBILE_ATTACK_DEFENSE_BUTTONS_SETTING] === '1'
  )
  game.onMobileAttackDefenseButtonsVisibilityChange((visible) => {
    updateStoredValue(
      MOBILE_ATTACK_DEFENSE_BUTTONS_SETTING,
      visible ? '1' : '0'
    )
  })
  window.addEventListener(
    'pagehide',
    () => {
      game.destroy()
    },
    { once: true }
  )
  game.setDisplayManager(displayManager)
  if (gameViewport.tabIndex < 0) {
    gameViewport.tabIndex = 0
  }
  gameViewport.focus(focusOptions)
  // Initially disable input until game starts
  game.setInputEnabled(false)

  initManager.complete()
  initManager.remove()
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Setup control panel
  const btnStop = document.getElementById('btnStop') as HTMLButtonElement
  const btnRestart = document.getElementById('btnRestart') as HTMLButtonElement
  const _btnKill = document.getElementById('btnKill') as HTMLButtonElement
  const _btnRevive = document.getElementById('btnRevive') as HTMLButtonElement

  btnStop.addEventListener('click', () => {
    game.stop()
    game.setInputEnabled(false)
    btnStop.textContent = localizer.t('ui_resume')
    btnStop.onclick = () => {
      game.start()
      game.setInputEnabled(true)
      btnStop.textContent = localizer.t('ui_pause')
      btnStop.onclick = null
      btnStop.addEventListener('click', () => {
        game.stop()
        game.setInputEnabled(false)
        btnStop.textContent = localizer.t('ui_resume')
      })
    }
  })

  btnRestart.addEventListener('click', () => {
    game.restart()
    game.setInputEnabled(true)
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
    breakableCrateDensity: (v) => game.setBreakableCrateDensity(v),
    breakableCrateFriction: (v) => game.setBreakableCrateFriction(v),
    breakableCrateLinearDamping: (v) => game.setBreakableCrateLinearDamping(v),
    breakableCrateAngularDamping: (v) =>
      game.setBreakableCrateAngularDamping(v),
    breakableCrateRestitution: (v) => game.setBreakableCrateRestitution(v),
    cameraZoom: (v) => game.setZoom(v),
    ropeDensity: (v) => game.setRopeDensity(v),
    ropeLinearDamping: (v) => game.setRopeLinearDamping(v),
    ropeHertz: (v) => game.setRopeHertz(v),
    ropeDampingRatio: (v) => game.setRopeDampingRatio(v),
    ropeBendStiffness: (v) => game.setRopeBendStiffness(v),
    ropeElasticLimitScale: (v) => game.setRopeElasticLimitScale(v),
    ropeClimbLinearDamping: (v) => game.setRopeClimbLinearDamping(v),
    ropeClimbHertz: (v) => game.setRopeClimbHertz(v),
    ropeClimbDampingRatio: (v) => game.setRopeClimbDampingRatio(v),
    ropeClimbWeightForceScale: (v) => game.setRopeClimbWeightForceScale(v),
    swingForce: (v) => game.setSwingForce(v),
  }

  // 设置所有参数控件
  for (const config of PARAM_CONFIGS) {
    const callback = paramCallbacks[config.id]
    if (callback) {
      const result = syncInputs(
        config,
        callback,
        storedValues,
        updateStoredValue
      )
      applyControls.push(result.apply)
    }
  }

  applyControls.forEach((apply) => apply())

  const editorManager = new EditorManager()
  let previewRunToken = 0
  editorManager.setGameClient(game)
  editorManager.onBackToMenu(() => {
    previewRunToken++
    game.setEditorPreview(false)
    game.clearMapPreview()
    game.showStartMenu()
  })
  editorManager.onPreview((_meta, data) => {
    const runToken = ++previewRunToken
    game.applyMapPreview(data)

    if (data.camera && data.camera.zoom) {
      setParamControlValue('cameraZoom', data.camera.zoom)
    }

    const previewMoveSpeed = data.player?.moveSpeed
    if (
      typeof previewMoveSpeed === 'number' &&
      Number.isFinite(previewMoveSpeed) &&
      previewMoveSpeed >= 0
    ) {
      setParamControlValue('moveSpeed', previewMoveSpeed)
    }

    applyControls.forEach((apply) => apply())
    game.setInputEnabled(false)
    editorManager.hide()
    game.start()
    void game.waitForPreviewPresentationReady().then(() => {
      if (runToken !== previewRunToken || !game.isPreviewActive()) {
        return
      }
      game.setInputEnabled(true)
      game.requestGameFocus()
    })
  })
  editorManager.onDefaultMapChanged(() => {
    game.reloadDefaultMap()
  })
  game.setPreviewExitHandler(() => {
    previewRunToken++
    game.stop()
    game.setInputEnabled(false)
    game.setEditorPreview(true)
    editorManager.showEditorForCurrentMap()
  })

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

  game.setOnEditorAction(() => {
    previewRunToken++
    menuManager.hide()
    game.stop()
    game.setInputEnabled(false)
    game.setEditorPreview(true)
    editorManager.show()
  })

  game.setOnExitAction(async () => {
    return dialogManager.confirm(localizer.t('confirm_exit_game'))
  })

  game.setOnFirstFrameRendered(() => {
    if (!menuManager.isVisible()) {
      game.scheduleStartMenu(0)
    }
  })
  game.scheduleStartMenu(800)

  const mapPanelEl = document.getElementById('mapPanel')
  if (mapPanelEl) {
    new MapImportExportPanel(mapPanelEl)
  }
}

initialize().catch((error) => {
  console.error('initialize failed', error)
})
