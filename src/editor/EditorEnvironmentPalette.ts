import { localizer } from '../Localizer'
import type {
  MapEnvironmentAsset,
  MapEnvironmentFlowerOptions,
  MapEnvironmentKeyVariant,
  MapEnvironmentObjectType,
} from '../editorMapTypes'
import {
  ensureRuntimeEnvironmentAsset,
  getRuntimeEnvironmentAsset,
} from '../environmentAssetRegistry'
import {
  ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MAX,
  ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MIN,
  ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MAX,
  ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MIN,
  ENVIRONMENT_FLOWER_PETAL_COUNT_MAX,
  ENVIRONMENT_FLOWER_PETAL_COUNT_MIN,
  ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MAX,
  ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MIN,
  ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MAX,
  ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MIN,
  ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MAX,
  ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MIN,
  ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MAX,
  ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MIN,
  ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MAX,
  ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MIN,
  ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MAX,
  ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MIN,
  clearEnvironmentFlowerOptions,
} from '../environmentFlowerOptions'
import {
  DEFAULT_ENVIRONMENT_KEY_TEXT,
  ENVIRONMENT_MOUSE_ACTIONS,
  MAX_ENVIRONMENT_KEY_TEXT_LENGTH,
  cloneEnvironmentKeyVariants,
  getEnvironmentMouseVariant,
  normalizeEnvironmentKeyText,
  normalizeEnvironmentMouseAction,
} from '../environmentKeyUtils'
import {
  formatRenderLayerLabel,
  getDefaultShapeRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { isEnvironmentCellStrokeSupported } from '../renderer/ProceduralEnvironmentFactory'

const BUILTIN_ENVIRONMENT_TYPES: readonly MapEnvironmentObjectType[] = [
  'tree',
  'hill',
  'house',
  'crate',
  'grass',
  'flower',
  'cloud',
  'key',
]

const ICON_SIZE = 32
const ICON_PAD = 4
const CURSOR_HOTSPOT_X = 16
const CURSOR_HOTSPOT_Y = 28
const DEFAULT_FLOWER_PETAL_COLOR = '#df6688'
const DEFAULT_FLOWER_STAMEN_COLOR = '#ffe07a'

type FlowerNumberOptionKey =
  | 'rootGrassCount'
  | 'clumpWidthPercent'
  | 'stemHeightPercent'
  | 'stemLeanPercent'
  | 'petalCount'
  | 'petalLengthPercent'
  | 'petalWidthPercent'
  | 'petalAngleOffsetDeg'
  | 'stamenRadiusPercent'

type FlowerBooleanOptionKey = 'stamenEnabled'
type FlowerColorOptionKey = 'petalColor' | 'stamenColor'

interface FlowerNumberOptionConfig {
  key: FlowerNumberOptionKey
  labelKey: string
  min: number
  max: number
  defaultValue: number
}

interface FlowerBooleanOptionConfig {
  key: FlowerBooleanOptionKey
  labelKey: string
  defaultValue: boolean
}

interface FlowerColorOptionConfig {
  key: FlowerColorOptionKey
  labelKey: string
  defaultValue: string
}

const FLOWER_NUMBER_OPTION_CONFIGS: readonly FlowerNumberOptionConfig[] = [
  {
    key: 'rootGrassCount',
    labelKey: 'editor_environment_flower_root_grass_count',
    min: ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MIN,
    max: ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MAX,
    defaultValue: 2,
  },
  {
    key: 'clumpWidthPercent',
    labelKey: 'editor_environment_flower_clump_width',
    min: ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MAX,
    defaultValue: 44,
  },
  {
    key: 'stemHeightPercent',
    labelKey: 'editor_environment_flower_stem_height',
    min: ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MAX,
    defaultValue: 98,
  },
  {
    key: 'stemLeanPercent',
    labelKey: 'editor_environment_flower_stem_lean',
    min: ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MAX,
    defaultValue: 0,
  },
  {
    key: 'petalCount',
    labelKey: 'editor_environment_flower_petal_count',
    min: ENVIRONMENT_FLOWER_PETAL_COUNT_MIN,
    max: ENVIRONMENT_FLOWER_PETAL_COUNT_MAX,
    defaultValue: 7,
  },
  {
    key: 'petalLengthPercent',
    labelKey: 'editor_environment_flower_petal_length',
    min: ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MAX,
    defaultValue: 21,
  },
  {
    key: 'petalWidthPercent',
    labelKey: 'editor_environment_flower_petal_width',
    min: ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MAX,
    defaultValue: 12,
  },
  {
    key: 'petalAngleOffsetDeg',
    labelKey: 'editor_environment_flower_petal_angle_offset',
    min: ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MIN,
    max: ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MAX,
    defaultValue: 0,
  },
  {
    key: 'stamenRadiusPercent',
    labelKey: 'editor_environment_flower_stamen_radius',
    min: ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MIN,
    max: ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MAX,
    defaultValue: 6,
  },
]

const FLOWER_BOOLEAN_OPTION_CONFIGS: readonly FlowerBooleanOptionConfig[] = [
  {
    key: 'stamenEnabled',
    labelKey: 'editor_environment_flower_stamen_enabled',
    defaultValue: true,
  },
]

const FLOWER_COLOR_OPTION_CONFIGS: readonly FlowerColorOptionConfig[] = [
  {
    key: 'petalColor',
    labelKey: 'editor_environment_flower_petal_color',
    defaultValue: DEFAULT_FLOWER_PETAL_COLOR,
  },
  {
    key: 'stamenColor',
    labelKey: 'editor_environment_flower_stamen_color',
    defaultValue: DEFAULT_FLOWER_STAMEN_COLOR,
  },
]

export interface EditorEnvironmentPaletteSelection {
  envType: MapEnvironmentObjectType
  assetId: string
  label: string
  cursor: string
}

interface EditorRandomNumberOption {
  random: boolean
  value: number
}

interface EditorRandomBooleanOption {
  random: boolean
  value: boolean
}

interface EditorRandomColorOption {
  random: boolean
  value: string
}

interface EditorEnvironmentPaletteFlowerStampOptions {
  rootGrassCount: EditorRandomNumberOption
  clumpWidthPercent: EditorRandomNumberOption
  stemHeightPercent: EditorRandomNumberOption
  stemLeanPercent: EditorRandomNumberOption
  petalCount: EditorRandomNumberOption
  petalLengthPercent: EditorRandomNumberOption
  petalWidthPercent: EditorRandomNumberOption
  petalAngleOffsetDeg: EditorRandomNumberOption
  petalColor: EditorRandomColorOption
  stamenEnabled: EditorRandomBooleanOption
  stamenRadiusPercent: EditorRandomNumberOption
  stamenColor: EditorRandomColorOption
}

export interface EditorEnvironmentPaletteStampOptions {
  renderLayer: number
  cellStroke: boolean
  keyText: string
  keyVariants: MapEnvironmentKeyVariant[]
  flower: EditorEnvironmentPaletteFlowerStampOptions
}

function createRandomNumberOption(value: number): EditorRandomNumberOption {
  return {
    random: true,
    value,
  }
}

function createRandomBooleanOption(value: boolean): EditorRandomBooleanOption {
  return {
    random: true,
    value,
  }
}

function createRandomColorOption(value: string): EditorRandomColorOption {
  return {
    random: true,
    value,
  }
}

interface EditorEnvironmentPaletteContext {
  container: HTMLDivElement
  getCustomEnvironmentAssets: () => MapEnvironmentAsset[]
  getAvailableRenderLayers: () => number[]
  getDefaultRenderLayer: () => number
  onSelected: (selection: EditorEnvironmentPaletteSelection) => void
  onCreateCustomEnvironmentAsset: () => Promise<MapEnvironmentAsset | null>
}

export class EditorEnvironmentPalette {
  private readonly ctx: EditorEnvironmentPaletteContext
  private readonly propertyPanel: HTMLDivElement
  private readonly propertyTitle: HTMLDivElement
  private readonly propertyBody: HTMLDivElement
  private readonly stampOptionsByKey = new Map<
    string,
    EditorEnvironmentPaletteStampOptions
  >()
  private readonly stampOptionsFallback: EditorEnvironmentPaletteStampOptions
  private selectedKey = ''
  private selection: EditorEnvironmentPaletteSelection | null = null
  private loadingAssetIds = new Set<string>()

  constructor(ctx: EditorEnvironmentPaletteContext) {
    this.ctx = ctx
    this.stampOptionsFallback = this.createDefaultStampOptions()
    this.propertyPanel = document.createElement('div')
    this.propertyPanel.className = 'editor-environment-property-panel'
    this.propertyTitle = document.createElement('div')
    this.propertyTitle.className = 'editor-environment-property-title'
    this.propertyBody = document.createElement('div')
    this.propertyBody.className = 'editor-environment-property-body'
    this.propertyPanel.appendChild(this.propertyTitle)
    this.propertyPanel.appendChild(this.propertyBody)
    const panelParent = this.ctx.container.parentElement ?? this.ctx.container
    panelParent.appendChild(this.propertyPanel)

    this.ctx.container.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.propertyPanel.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
    })
    this.render()
  }

  show(): void {
    this.syncStampRenderLayersWithDefault()
    this.ctx.container.classList.add('is-visible')
    this.render()
  }

  hide(): void {
    this.ctx.container.classList.remove('is-visible')
    this.hidePropertyPanel()
  }

  refresh(): void {
    if (this.isVisible() || this.ctx.container.childElementCount === 0) {
      this.render()
    }
  }

  updateLocalization(): void {
    this.render()
  }

  clearSelection(): void {
    this.selectedKey = ''
    this.selection = null
    this.updateSelectedState()
    this.hidePropertyPanel()
  }

  getSelection(): EditorEnvironmentPaletteSelection | null {
    return this.selection
  }

  restoreSelection(selection: EditorEnvironmentPaletteSelection): void {
    this.selectedKey = this.buildKey(selection.envType, selection.assetId)
    this.selection = selection
    this.updateSelectedState()
    this.renderPropertyPanel()
  }

  getStampOptions(
    selection: EditorEnvironmentPaletteSelection
  ): EditorEnvironmentPaletteStampOptions {
    const key = this.buildKey(selection.envType, selection.assetId)
    return this.stampOptionsByKey.get(key) ?? this.stampOptionsFallback
  }

  getKeyTextForStamp(
    selection: EditorEnvironmentPaletteSelection
  ): string | undefined {
    if (selection.envType !== 'key') {
      return undefined
    }
    return normalizeEnvironmentKeyText(this.getStampOptions(selection).keyText)
  }

  getKeyVariantsForStamp(
    selection: EditorEnvironmentPaletteSelection
  ): MapEnvironmentKeyVariant[] | undefined {
    if (selection.envType !== 'key') {
      return undefined
    }
    const variants = cloneEnvironmentKeyVariants(
      this.getStampOptions(selection).keyVariants
    )
    return variants.length > 0 ? variants : undefined
  }

  writeFlowerOptionsForStamp(
    selection: EditorEnvironmentPaletteSelection,
    target: MapEnvironmentFlowerOptions
  ): boolean {
    clearEnvironmentFlowerOptions(target)
    if (selection.envType !== 'flower') {
      return false
    }

    const options = this.getStampOptions(selection).flower
    let hasOptions = false
    for (let i = 0; i < FLOWER_NUMBER_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_NUMBER_OPTION_CONFIGS[i]
      const option = options[config.key]
      if (option.random) {
        continue
      }
      target[config.key] = this.clampInteger(
        option.value,
        config.min,
        config.max
      )
      hasOptions = true
    }

    for (let i = 0; i < FLOWER_BOOLEAN_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_BOOLEAN_OPTION_CONFIGS[i]
      const option = options[config.key]
      if (option.random) {
        continue
      }
      target[config.key] = option.value
      hasOptions = true
    }

    for (let i = 0; i < FLOWER_COLOR_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_COLOR_OPTION_CONFIGS[i]
      const option = options[config.key]
      if (option.random) {
        continue
      }
      target[config.key] = this.normalizeColorInputValue(
        option.value,
        config.defaultValue
      )
      hasOptions = true
    }

    return hasOptions
  }

  isVisible(): boolean {
    return this.ctx.container.classList.contains('is-visible')
  }

  containsTarget(target: Node): boolean {
    return (
      this.ctx.container.contains(target) || this.propertyPanel.contains(target)
    )
  }

  private render(): void {
    const container = this.ctx.container
    container.textContent = ''
    this.refreshSelectionLabel()

    for (let i = 0; i < BUILTIN_ENVIRONMENT_TYPES.length; i++) {
      const envType = BUILTIN_ENVIRONMENT_TYPES[i]
      container.appendChild(this.createBuiltinButton(envType))
    }

    const assets = this.ctx.getCustomEnvironmentAssets()
    for (let i = 0; i < assets.length; i++) {
      container.appendChild(this.createCustomAssetButton(assets[i]))
    }

    container.appendChild(this.createCreateButton())
    this.updateSelectedState()
    this.renderPropertyPanel()
  }

  private createBuiltinButton(
    envType: MapEnvironmentObjectType
  ): HTMLButtonElement {
    const label = localizer.t(`editor_env_${envType}`)
    const button = this.createIconButton(label, this.buildKey(envType, ''))
    const icon = this.createIconCanvas()
    this.drawBuiltinIcon(icon, envType)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      this.select({
        envType,
        assetId: '',
        label,
        cursor: this.createCursor(envType, ''),
      })
    })
    return button
  }

  private createCustomAssetButton(
    asset: MapEnvironmentAsset
  ): HTMLButtonElement {
    const button = this.createIconButton(
      asset.name,
      this.buildKey('custom', asset.id)
    )
    const icon = this.createIconCanvas()
    this.drawCustomIcon(icon, asset.id)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      this.select({
        envType: 'custom',
        assetId: asset.id,
        label: asset.name,
        cursor: this.createCursor('custom', asset.id),
      })
    })
    return button
  }

  private createCreateButton(): HTMLButtonElement {
    const label = localizer.t('editor_environment_asset_create')
    const button = this.createIconButton(label, 'create')
    button.classList.add('editor-environment-palette-create')
    const icon = this.createIconCanvas()
    this.drawCreateIcon(icon)
    button.appendChild(icon)
    button.addEventListener('click', () => {
      void this.handleCreateAsset()
    })
    return button
  }

  private createIconButton(label: string, key: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'editor-environment-palette-item'
    button.dataset.environmentPaletteKey = key
    button.dataset.tooltip = label
    button.setAttribute('aria-label', label)
    return button
  }

  private createIconCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    canvas.className = 'editor-environment-palette-icon'
    return canvas
  }

  private select(selection: EditorEnvironmentPaletteSelection): void {
    this.selectedKey = this.buildKey(selection.envType, selection.assetId)
    this.selection = selection
    this.updateSelectedState()
    this.renderPropertyPanel()
    this.ctx.onSelected(selection)
  }

  private updateSelectedState(): void {
    const items = this.ctx.container.querySelectorAll<HTMLButtonElement>(
      '.editor-environment-palette-item'
    )
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (
        this.selectedKey.length > 0 &&
        item.dataset.environmentPaletteKey === this.selectedKey
      ) {
        item.classList.add('is-selected')
      } else {
        item.classList.remove('is-selected')
      }
    }
  }

  private async handleCreateAsset(): Promise<void> {
    const asset = await this.ctx.onCreateCustomEnvironmentAsset()
    if (!asset) {
      return
    }
    this.render()
    this.select({
      envType: 'custom',
      assetId: asset.id,
      label: asset.name,
      cursor: this.createCursor('custom', asset.id),
    })
  }

  private getOrCreateStampOptions(
    key: string
  ): EditorEnvironmentPaletteStampOptions {
    const existing = this.stampOptionsByKey.get(key)
    if (existing) {
      return existing
    }
    const options: EditorEnvironmentPaletteStampOptions = {
      renderLayer: this.getDefaultRenderLayer(),
      cellStroke: false,
      keyText: DEFAULT_ENVIRONMENT_KEY_TEXT,
      keyVariants: [],
      flower: this.createDefaultFlowerStampOptions(),
    }
    this.stampOptionsByKey.set(key, options)
    return options
  }

  private createDefaultStampOptions(): EditorEnvironmentPaletteStampOptions {
    return {
      renderLayer: this.getDefaultRenderLayer(),
      cellStroke: false,
      keyText: DEFAULT_ENVIRONMENT_KEY_TEXT,
      keyVariants: [],
      flower: this.createDefaultFlowerStampOptions(),
    }
  }

  private syncStampRenderLayersWithDefault(): void {
    const renderLayer = this.getDefaultRenderLayer()
    this.stampOptionsFallback.renderLayer = renderLayer
    this.stampOptionsByKey.forEach((options) => {
      options.renderLayer = renderLayer
    })
  }

  private getDefaultRenderLayer(): number {
    return normalizeRenderLayer(
      this.ctx.getDefaultRenderLayer(),
      getDefaultShapeRenderLayer()
    )
  }

  private createDefaultFlowerStampOptions(): EditorEnvironmentPaletteFlowerStampOptions {
    return {
      rootGrassCount: createRandomNumberOption(2),
      clumpWidthPercent: createRandomNumberOption(44),
      stemHeightPercent: createRandomNumberOption(98),
      stemLeanPercent: createRandomNumberOption(0),
      petalCount: createRandomNumberOption(7),
      petalLengthPercent: createRandomNumberOption(21),
      petalWidthPercent: createRandomNumberOption(12),
      petalAngleOffsetDeg: createRandomNumberOption(0),
      petalColor: createRandomColorOption(DEFAULT_FLOWER_PETAL_COLOR),
      stamenEnabled: createRandomBooleanOption(true),
      stamenRadiusPercent: createRandomNumberOption(6),
      stamenColor: createRandomColorOption(DEFAULT_FLOWER_STAMEN_COLOR),
    }
  }

  private refreshSelectionLabel(): void {
    const selection = this.selection
    if (!selection || selection.envType === 'custom') {
      return
    }
    selection.label = localizer.t(`editor_env_${selection.envType}`)
  }

  private renderPropertyPanel(): void {
    const selection = this.selection
    this.propertyBody.textContent = ''
    if (!selection || !this.isVisible()) {
      this.hidePropertyPanel()
      return
    }

    this.propertyTitle.textContent = selection.label
    const key = this.buildKey(selection.envType, selection.assetId)
    const options = this.getOrCreateStampOptions(key)
    if (isEnvironmentCellStrokeSupported(selection.envType)) {
      this.propertyBody.appendChild(
        this.createCheckboxRow(
          localizer.t('editor_terrain_properties_cell_stroke'),
          options.cellStroke,
          (checked) => {
            options.cellStroke = checked
          }
        )
      )
    }
    if (selection.envType === 'flower') {
      this.renderFlowerPropertyRows(options.flower)
    }
    if (selection.envType === 'key') {
      this.propertyBody.appendChild(this.createKeyTextRow(options))
      this.propertyBody.appendChild(this.createKeyVariantsSection(options))
    }
    this.renderCommonPropertyRows(options)

    this.propertyPanel.classList.add('is-visible')
  }

  private hidePropertyPanel(): void {
    this.propertyPanel.classList.remove('is-visible')
    this.propertyBody.textContent = ''
  }

  private renderCommonPropertyRows(
    options: EditorEnvironmentPaletteStampOptions
  ): void {
    const section = document.createElement('div')
    section.className =
      'editor-environment-property-section editor-environment-property-common-section'
    const sectionTitle = document.createElement('div')
    sectionTitle.className = 'editor-environment-property-section-title'
    sectionTitle.textContent = localizer.t('editor_common_properties_title')
    section.appendChild(sectionTitle)
    section.appendChild(this.createRenderLayerRow(options))
    section.appendChild(this.createExistingRenderLayerRow(options))
    this.propertyBody.appendChild(section)
  }

  private createKeyTextRow(
    options: EditorEnvironmentPaletteStampOptions
  ): HTMLLabelElement {
    const row = this.createFieldRow(localizer.t('editor_environment_key_text'))
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = MAX_ENVIRONMENT_KEY_TEXT_LENGTH
    input.value = options.keyText
    input.className = 'editor-environment-property-text'
    input.addEventListener('input', () => {
      options.keyText = input.value
    })
    input.addEventListener('change', () => {
      options.keyText = normalizeEnvironmentKeyText(input.value)
      input.value = options.keyText
    })
    row.appendChild(input)
    return row
  }

  private createKeyVariantsSection(
    options: EditorEnvironmentPaletteStampOptions
  ): HTMLDivElement {
    const section = document.createElement('div')
    section.className = 'editor-environment-property-section'
    const title = document.createElement('div')
    title.className = 'editor-environment-property-section-title'
    title.textContent = localizer.t('editor_environment_key_variants')
    section.appendChild(title)
    const list = document.createElement('div')
    section.appendChild(list)
    const actions = document.createElement('div')
    actions.className = 'editor-environment-key-variant-actions'
    section.appendChild(actions)
    const addButton = document.createElement('button')
    addButton.type = 'button'
    addButton.className = 'editor-environment-key-variant-button'
    addButton.textContent = localizer.t('editor_environment_key_variant_add')
    actions.appendChild(addButton)
    const mouseButton = document.createElement('button')
    mouseButton.type = 'button'
    mouseButton.className = 'editor-environment-key-variant-button'
    mouseButton.textContent = localizer.t(
      'editor_environment_key_variant_mouse'
    )
    mouseButton.hidden = true
    actions.appendChild(mouseButton)

    const renderVariants = () => {
      list.textContent = ''
      const mouseVariant = getEnvironmentMouseVariant(options.keyVariants)
      if (mouseVariant) {
        const row = this.createFieldRow(
          localizer.t('editor_environment_key_variant_mouse')
        )
        row.classList.add('editor-environment-key-variant-row')
        const select = document.createElement('select')
        select.className = 'editor-environment-property-select'
        for (let i = 0; i < ENVIRONMENT_MOUSE_ACTIONS.length; i++) {
          const action = ENVIRONMENT_MOUSE_ACTIONS[i]
          const option = document.createElement('option')
          option.value = action
          option.textContent = localizer.t(
            `editor_environment_key_mouse_action_${action}`
          )
          select.appendChild(option)
        }
        select.value = mouseVariant.action
        select.addEventListener('change', () => {
          mouseVariant.action = normalizeEnvironmentMouseAction(
            select.value as MapEnvironmentKeyVariant['action']
          )
        })
        row.appendChild(select)
        const removeButton = document.createElement('button')
        removeButton.type = 'button'
        removeButton.className = 'editor-environment-key-variant-button'
        removeButton.textContent = localizer.t(
          'editor_environment_key_variant_remove'
        )
        removeButton.addEventListener('click', () => {
          options.keyVariants.length = 0
          renderVariants()
        })
        row.appendChild(removeButton)
        list.appendChild(row)
      }
      addButton.disabled = mouseVariant !== null
      if (mouseVariant) {
        mouseButton.hidden = true
      }
    }

    addButton.addEventListener('click', () => {
      if (!getEnvironmentMouseVariant(options.keyVariants)) {
        mouseButton.hidden = !mouseButton.hidden
      }
    })
    mouseButton.addEventListener('click', () => {
      if (!getEnvironmentMouseVariant(options.keyVariants)) {
        options.keyVariants.push({ type: 'mouse', action: 'left' })
      }
      mouseButton.hidden = true
      renderVariants()
    })
    renderVariants()
    return section
  }

  private createRenderLayerRow(
    options: EditorEnvironmentPaletteStampOptions
  ): HTMLLabelElement {
    const row = this.createFieldRow(
      localizer.t('editor_common_properties_render_layer')
    )
    const input = document.createElement('input')
    input.type = 'number'
    input.step = '1'
    input.value = `${normalizeRenderLayer(
      options.renderLayer,
      getDefaultShapeRenderLayer()
    )}`
    input.className =
      'editor-environment-property-number editor-environment-property-layer-number'

    const commitValue = (force: boolean) => {
      const text = input.value.trim()
      if (text.length === 0 || text === '-') {
        if (force) {
          input.value = `${options.renderLayer}`
        }
        return
      }
      const value = Number.parseInt(text, 10)
      if (!Number.isFinite(value)) {
        if (force) {
          input.value = `${options.renderLayer}`
        }
        return
      }
      options.renderLayer = normalizeRenderLayer(
        value,
        getDefaultShapeRenderLayer()
      )
      input.value = `${options.renderLayer}`
    }
    input.addEventListener('input', () => commitValue(false))
    input.addEventListener('change', () => commitValue(true))

    row.appendChild(input)
    return row
  }

  private createExistingRenderLayerRow(
    options: EditorEnvironmentPaletteStampOptions
  ): HTMLLabelElement {
    const row = this.createFieldRow(
      localizer.t('editor_common_properties_render_layer_existing')
    )
    const select = document.createElement('select')
    select.className = 'editor-environment-property-select'
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = localizer.t(
      'editor_common_properties_render_layer_existing_placeholder'
    )
    select.appendChild(placeholder)

    const layers = this.ctx.getAvailableRenderLayers()
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const option = document.createElement('option')
      option.value = `${layer}`
      option.textContent = formatRenderLayerLabel(layer)
      select.appendChild(option)
    }

    const currentLayer = normalizeRenderLayer(
      options.renderLayer,
      getDefaultShapeRenderLayer()
    )
    select.value = layers.includes(currentLayer) ? `${currentLayer}` : ''
    select.addEventListener('change', () => {
      if (select.value.length === 0) {
        return
      }
      options.renderLayer = normalizeRenderLayer(
        Number.parseInt(select.value, 10),
        getDefaultShapeRenderLayer()
      )
      this.renderPropertyPanel()
    })

    row.appendChild(select)
    return row
  }

  private createFieldRow(label: string): HTMLLabelElement {
    const row = document.createElement('label')
    row.className =
      'editor-environment-property-row editor-environment-property-field-row'

    const text = document.createElement('span')
    text.className = 'editor-environment-property-label'
    text.textContent = label
    row.appendChild(text)
    return row
  }

  private createCheckboxRow(
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): HTMLLabelElement {
    const row = document.createElement('label')
    row.className = 'editor-environment-property-row'

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = checked
    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked)
    })

    const text = document.createElement('span')
    text.textContent = label

    row.appendChild(checkbox)
    row.appendChild(text)
    return row
  }

  private renderFlowerPropertyRows(
    options: EditorEnvironmentPaletteFlowerStampOptions
  ): void {
    for (let i = 0; i < FLOWER_NUMBER_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_NUMBER_OPTION_CONFIGS[i]
      this.propertyBody.appendChild(
        this.createRandomNumberRow(config, options[config.key])
      )
    }
    for (let i = 0; i < FLOWER_COLOR_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_COLOR_OPTION_CONFIGS[i]
      this.propertyBody.appendChild(
        this.createRandomColorRow(config, options[config.key])
      )
    }
    for (let i = 0; i < FLOWER_BOOLEAN_OPTION_CONFIGS.length; i++) {
      const config = FLOWER_BOOLEAN_OPTION_CONFIGS[i]
      this.propertyBody.appendChild(
        this.createRandomBooleanRow(config, options[config.key])
      )
    }
  }

  private createRandomNumberRow(
    config: FlowerNumberOptionConfig,
    option: EditorRandomNumberOption
  ): HTMLDivElement {
    const row = this.createRandomPropertyRow(config.labelKey)
    const input = document.createElement('input')
    input.type = 'number'
    input.min = `${config.min}`
    input.max = `${config.max}`
    input.step = '1'
    input.value = `${this.clampInteger(option.value, config.min, config.max)}`
    input.className = 'editor-environment-property-number'

    const commitValue = () => {
      if (!Number.isFinite(input.valueAsNumber)) {
        return
      }
      option.value = this.clampInteger(
        input.valueAsNumber,
        config.min,
        config.max
      )
      input.value = `${option.value}`
    }
    input.addEventListener('input', commitValue)
    input.addEventListener('change', commitValue)

    this.attachRandomToggle(row, input, option)
    row.insertBefore(input, row.lastElementChild)
    return row
  }

  private createRandomBooleanRow(
    config: FlowerBooleanOptionConfig,
    option: EditorRandomBooleanOption
  ): HTMLDivElement {
    const row = this.createRandomPropertyRow(config.labelKey)
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = option.value
    input.className = 'editor-environment-property-value-checkbox'
    input.setAttribute('aria-label', localizer.t('editor_environment_enabled'))
    input.addEventListener('change', () => {
      option.value = input.checked
    })

    this.attachRandomToggle(row, input, option)
    row.insertBefore(input, row.lastElementChild)
    return row
  }

  private createRandomColorRow(
    config: FlowerColorOptionConfig,
    option: EditorRandomColorOption
  ): HTMLDivElement {
    const row = this.createRandomPropertyRow(config.labelKey)
    const input = document.createElement('input')
    input.type = 'color'
    input.value = this.normalizeColorInputValue(
      option.value,
      config.defaultValue
    )
    input.className = 'editor-environment-property-color'
    const commitValue = () => {
      option.value = this.normalizeColorInputValue(
        input.value,
        config.defaultValue
      )
      input.value = option.value
    }
    input.addEventListener('input', commitValue)
    input.addEventListener('change', commitValue)

    this.attachRandomToggle(row, input, option)
    row.insertBefore(input, row.lastElementChild)
    return row
  }

  private createRandomPropertyRow(labelKey: string): HTMLDivElement {
    const row = document.createElement('div')
    row.className =
      'editor-environment-property-row editor-environment-property-random-row'

    const text = document.createElement('span')
    text.className = 'editor-environment-property-label'
    text.textContent = localizer.t(labelKey)
    row.appendChild(text)

    const randomLabel = document.createElement('label')
    randomLabel.className = 'editor-environment-property-random-toggle'
    const randomCheckbox = document.createElement('input')
    randomCheckbox.type = 'checkbox'
    randomLabel.appendChild(randomCheckbox)
    const randomText = document.createElement('span')
    randomText.textContent = localizer.t('editor_environment_random')
    randomLabel.appendChild(randomText)
    row.appendChild(randomLabel)
    return row
  }

  private attachRandomToggle(
    row: HTMLDivElement,
    input: HTMLInputElement,
    option:
      | EditorRandomNumberOption
      | EditorRandomBooleanOption
      | EditorRandomColorOption
  ): void {
    const randomCheckbox = row.querySelector<HTMLInputElement>(
      '.editor-environment-property-random-toggle input'
    )
    if (!randomCheckbox) {
      return
    }
    randomCheckbox.checked = option.random
    const syncEnabledState = () => {
      input.disabled = option.random
      row.classList.toggle('is-random', option.random)
    }
    randomCheckbox.addEventListener('change', () => {
      option.random = randomCheckbox.checked
      syncEnabledState()
    })
    syncEnabledState()
  }

  private clampInteger(value: number, min: number, max: number): number {
    const rounded = Math.round(value)
    if (rounded < min) {
      return min
    }
    if (rounded > max) {
      return max
    }
    return rounded
  }

  private normalizeColorInputValue(value: string, fallback: string): string {
    if (this.isColorInputValue(value)) {
      return value.toLowerCase()
    }
    return fallback
  }

  private isColorInputValue(value: string): boolean {
    if (value.length !== 7 || value.charCodeAt(0) !== 35) {
      return false
    }
    for (let i = 1; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (
        !(
          (code >= 48 && code <= 57) ||
          (code >= 65 && code <= 70) ||
          (code >= 97 && code <= 102)
        )
      ) {
        return false
      }
    }
    return true
  }

  private createCursor(
    envType: MapEnvironmentObjectType,
    assetId: string
  ): string {
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    if (envType === 'custom') {
      this.drawCustomIcon(canvas, assetId)
    } else {
      this.drawBuiltinIcon(canvas, envType)
    }
    const url = canvas.toDataURL('image/png')
    return `url("${url}") ${CURSOR_HOTSPOT_X} ${CURSOR_HOTSPOT_Y}, crosshair`
  }

  private drawBuiltinIcon(
    canvas: HTMLCanvasElement,
    envType: MapEnvironmentObjectType
  ): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2

    if (envType === 'tree') {
      ctx.fillStyle = '#8f6d43'
      ctx.fillRect(14, 18, 4, 8)
      ctx.fillStyle = '#6f8d58'
      ctx.beginPath()
      ctx.arc(16, 12, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#5d7849'
      ctx.beginPath()
      ctx.arc(11, 15, 6, 0, Math.PI * 2)
      ctx.arc(21, 15, 6, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    if (envType === 'hill') {
      ctx.fillStyle = '#6f7f57'
      ctx.beginPath()
      ctx.moveTo(4, 24)
      ctx.quadraticCurveTo(14, 8, 28, 24)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#b7aa7d'
      ctx.stroke()
      return
    }

    if (envType === 'house') {
      ctx.fillStyle = '#9b7b54'
      ctx.fillRect(9, 15, 14, 10)
      ctx.fillStyle = '#8f5f49'
      ctx.beginPath()
      ctx.moveTo(7, 16)
      ctx.lineTo(16, 7)
      ctx.lineTo(25, 16)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#c4b088'
      ctx.strokeRect(9, 15, 14, 10)
      return
    }

    if (envType === 'crate') {
      ctx.fillStyle = '#8d6a42'
      ctx.fillRect(8, 8, 16, 16)
      ctx.strokeStyle = '#d0b17a'
      ctx.strokeRect(8, 8, 16, 16)
      ctx.beginPath()
      ctx.moveTo(8, 8)
      ctx.lineTo(24, 24)
      ctx.moveTo(24, 8)
      ctx.lineTo(8, 24)
      ctx.stroke()
      return
    }

    if (envType === 'grass') {
      ctx.strokeStyle = '#7f9a61'
      ctx.beginPath()
      ctx.moveTo(9, 25)
      ctx.lineTo(13, 12)
      ctx.moveTo(16, 25)
      ctx.lineTo(16, 9)
      ctx.moveTo(23, 25)
      ctx.lineTo(19, 13)
      ctx.stroke()
      return
    }

    if (envType === 'flower') {
      ctx.strokeStyle = '#7f9a61'
      ctx.beginPath()
      ctx.moveTo(16, 25)
      ctx.lineTo(16, 15)
      ctx.stroke()
      ctx.fillStyle = '#c88473'
      ctx.beginPath()
      ctx.arc(16, 12, 3, 0, Math.PI * 2)
      ctx.arc(12, 15, 3, 0, Math.PI * 2)
      ctx.arc(20, 15, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d8c06f'
      ctx.beginPath()
      ctx.arc(16, 15, 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    if (envType === 'key') {
      ctx.fillStyle = '#514a3f'
      ctx.fillRect(4, 9, 24, 18)
      ctx.fillStyle = '#e4dcc6'
      ctx.fillRect(5, 5, 22, 18)
      ctx.strokeStyle = '#746a59'
      ctx.strokeRect(5, 5, 22, 18)
      ctx.strokeStyle = '#fff7df'
      ctx.beginPath()
      ctx.moveTo(9, 8)
      ctx.lineTo(23, 8)
      ctx.stroke()
      ctx.fillStyle = '#302d27'
      ctx.font = '800 13px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(DEFAULT_ENVIRONMENT_KEY_TEXT, 16, 15)
      return
    }

    ctx.fillStyle = '#d8d3bf'
    ctx.beginPath()
    ctx.arc(12, 17, 5, 0, Math.PI * 2)
    ctx.arc(17, 14, 7, 0, Math.PI * 2)
    ctx.arc(23, 18, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(10, 17, 15, 5)
  }

  private drawCustomIcon(canvas: HTMLCanvasElement, assetId: string): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    const runtimeAsset = getRuntimeEnvironmentAsset(assetId)
    if (!runtimeAsset) {
      this.drawMissingCustomIcon(ctx)
      this.queueAssetLoad(assetId)
      return
    }

    const source = runtimeAsset.canvas
    const maxSize = ICON_SIZE - ICON_PAD * 2
    let drawWidth = maxSize
    let drawHeight = Math.max(
      1,
      Math.floor((source.height * maxSize) / source.width)
    )
    if (drawHeight > maxSize) {
      drawHeight = maxSize
      drawWidth = Math.max(
        1,
        Math.floor((source.width * maxSize) / source.height)
      )
    }
    const x = (ICON_SIZE - drawWidth) >> 1
    const y = (ICON_SIZE - drawHeight) >> 1
    ctx.drawImage(source, x, y, drawWidth, drawHeight)
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'
    ctx.strokeRect(x, y, drawWidth, drawHeight)
  }

  private drawMissingCustomIcon(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(8, 8, 16, 16)
    ctx.beginPath()
    ctx.moveTo(11, 21)
    ctx.lineTo(15, 16)
    ctx.lineTo(18, 19)
    ctx.lineTo(21, 13)
    ctx.stroke()
  }

  private drawCreateIcon(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE)
    ctx.strokeStyle = '#d6c9a3'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(16, 9)
    ctx.lineTo(16, 23)
    ctx.moveTo(9, 16)
    ctx.lineTo(23, 16)
    ctx.stroke()
  }

  private queueAssetLoad(assetId: string): void {
    if (!assetId || this.loadingAssetIds.has(assetId)) {
      return
    }
    this.loadingAssetIds.add(assetId)
    void ensureRuntimeEnvironmentAsset(assetId).then(() => {
      this.loadingAssetIds.delete(assetId)
      if (!this.isVisible()) {
        return
      }
      const selectedKey = this.selectedKey
      this.render()
      if (selectedKey === this.selectedKey && this.selection) {
        this.select({
          ...this.selection,
          cursor: this.createCursor(
            this.selection.envType,
            this.selection.assetId
          ),
        })
      }
    })
  }

  private buildKey(envType: MapEnvironmentObjectType, assetId: string): string {
    return envType === 'custom' ? `custom:${assetId}` : envType
  }
}
