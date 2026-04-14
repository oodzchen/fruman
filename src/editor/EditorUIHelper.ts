import { composeHexColor, splitHexColor } from '../colorUtils'

export type EditorColorInputElement = HTMLDivElement & {
  value: string
}

export class EditorUIHelper {
  static createPropertiesDialog(title: string): {
    modal: HTMLDivElement
    form: HTMLDivElement
    leftPanel: HTMLDivElement
    rightPanel: HTMLDivElement
    footerPanel: HTMLDivElement
    previewCanvas: HTMLCanvasElement
    previewCtx: CanvasRenderingContext2D | null
    close: () => void
    show: (parent: HTMLElement) => void
  } {
    const { modal, close } = this.createModal()
    const form = this.createFormContainer()
    const titleEl = this.createFormTitle(title)
    form.appendChild(titleEl)

    const content = document.createElement('div')
    content.style.cssText = `
      display: flex;
      align-items: stretch;
      gap: 16px;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    `
    form.appendChild(content)

    const leftPanel = document.createElement('div')
    leftPanel.style.cssText = `
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 8px;
      box-sizing: border-box;
    `
    content.appendChild(leftPanel)

    const rightPanel = this.createPreviewPanel()
    content.appendChild(rightPanel)

    const previewCanvas = this.createPreviewCanvas()
    rightPanel.appendChild(previewCanvas)
    const previewCtx = previewCanvas.getContext('2d')

    const footerPanel = document.createElement('div')
    footerPanel.style.cssText = `
      flex: 0 0 auto;
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
      padding-top: 4px;
      padding-bottom: 2px;
    `
    form.appendChild(footerPanel)

    modal.style.alignItems = 'stretch'
    modal.style.justifyContent = 'stretch'
    form.style.minWidth = 'unset'
    form.style.width = '100%'
    form.style.height = '100%'

    modal.appendChild(form)

    const show = (parent: HTMLElement) => {
      parent.appendChild(modal)
    }

    return {
      modal,
      form,
      leftPanel,
      rightPanel,
      footerPanel,
      previewCanvas,
      previewCtx,
      close,
      show,
    }
  }

  static createModal(options?: { zIndex?: number }): {
    modal: HTMLDivElement
    close: () => void
  } {
    const modal = document.createElement('div')
    modal.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: ${options?.zIndex ?? 10000};
    `

    const close = () => {
      if (modal.parentElement) {
        modal.parentElement.removeChild(modal)
      }
    }

    return { modal, close }
  }

  static createFormContainer(options?: { minWidth?: string }): HTMLDivElement {
    const form = document.createElement('div')
    form.style.cssText = `
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 24px;
      min-width: ${options?.minWidth ?? '520px'};
      font-family: monospace;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
    `
    return form
  }

  static createFormTitle(text: string): HTMLHeadingElement {
    const title = document.createElement('h3')
    title.textContent = text
    title.style.cssText = 'margin: 0 0 16px 0; font-size: 12px;'
    return title
  }

  static createFormRow(
    labelText: string,
    options?: {
      labelWidth?: string
      gap?: string
      marginBottom?: string
    }
  ): {
    row: HTMLDivElement
    label: HTMLLabelElement
  } {
    const row = document.createElement('div')
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${options?.gap ?? '12px'};
      margin-bottom: ${options?.marginBottom ?? '12px'};
    `

    const label = document.createElement('label')
    label.textContent = labelText
    label.style.cssText = `
      width: ${options?.labelWidth ?? '110px'};
      font-size: 12px;
      flex-shrink: 0;
    `
    row.appendChild(label)

    return { row, label }
  }

  static createNumberInput(options: {
    value: number | string
    min?: string
    max?: string
    step?: string
    width?: string
  }): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'number'
    input.value = String(options.value)
    if (options.min !== undefined) input.min = options.min
    if (options.max !== undefined) input.max = options.max
    if (options.step !== undefined) input.step = options.step

    input.style.cssText = `
      flex: 0 0 ${options.width ?? '200px'};
      width: ${options.width ?? '200px'};
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      font-family: monospace;
      font-size: 12px;
      box-sizing: border-box;
    `
    return input
  }

  static createTextInput(options: {
    value: string
    width?: string
  }): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = options.value

    input.style.cssText = `
      flex: 0 0 ${options.width ?? '200px'};
      width: ${options.width ?? '200px'};
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      font-family: monospace;
      font-size: 12px;
      box-sizing: border-box;
    `
    return input
  }

  static createSelect(options: {
    options: Array<{ value: string; label: string }>
    selected?: string
    width?: string
  }): HTMLSelectElement {
    const select = document.createElement('select')
    select.style.cssText = `
      flex: 0 0 ${options.width ?? '200px'};
      width: ${options.width ?? '200px'};
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      font-family: monospace;
      font-size: 12px;
      box-sizing: border-box;
    `

    for (const opt of options.options) {
      const option = document.createElement('option')
      option.value = opt.value
      option.textContent = opt.label
      if (opt.value === options.selected) {
        option.selected = true
      }
      select.appendChild(option)
    }

    return select
  }

  static createButton(
    text: string,
    options?: {
      primary?: boolean
    }
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.textContent = text

    const bgColor = options?.primary
      ? 'rgba(255, 255, 255, 0.15)'
      : 'rgba(255, 255, 255, 0.08)'

    button.style.cssText = `
      padding: 8px 16px;
      background: ${bgColor};
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      font-family: monospace;
      font-size: 12px;
      cursor: pointer;
    `

    button.addEventListener('mouseenter', () => {
      button.style.background = 'rgba(255, 255, 255, 0.2)'
    })

    button.addEventListener('mouseleave', () => {
      button.style.background = bgColor
    })

    return button
  }

  static createButtonRow(options?: {
    gap?: string
    marginTop?: string
    justifyContent?: string
  }): HTMLDivElement {
    const row = document.createElement('div')
    row.style.cssText = `
      display: flex;
      gap: ${options?.gap ?? '12px'};
      margin-top: ${options?.marginTop ?? '16px'};
      justify-content: ${options?.justifyContent ?? 'flex-end'};
    `
    return row
  }

  static createPreviewPanel(options?: { width?: string }): HTMLDivElement {
    const panel = document.createElement('div')
    panel.style.cssText = `
      width: ${options?.width ?? '180px'};
      padding: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
    `
    return panel
  }

  static createPreviewCanvas(options?: {
    width?: number
    height?: number
  }): HTMLCanvasElement {
    const width = options?.width ?? 160
    const height = options?.height ?? 160
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.style.cssText = `
      width: ${width}px;
      height: ${height}px;
      display: block;
      image-rendering: pixelated;
    `
    return canvas
  }

  static createColorInput(value: string): EditorColorInputElement {
    const root = document.createElement('div') as EditorColorInputElement
    const picker = document.createElement('input')
    const alphaSlider = document.createElement('input')
    const alphaText = document.createElement('span')
    let currentValue = composeHexColor('#000000', 255)

    root.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
    `

    picker.type = 'color'
    picker.style.cssText = `
      width: 40px;
      height: 32px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.25);
      cursor: pointer;
      box-sizing: border-box;
      flex: 0 0 auto;
    `

    alphaSlider.type = 'range'
    alphaSlider.min = '0'
    alphaSlider.max = '255'
    alphaSlider.step = '1'
    alphaSlider.style.cssText = `
      flex: 1 1 auto;
      min-width: 56px;
      margin: 0;
      cursor: pointer;
    `

    alphaText.style.cssText = `
      width: 24px;
      font-size: 11px;
      text-align: right;
      color: rgba(255,255,255,0.8);
      flex: 0 0 auto;
    `

    const syncControlState = (nextValue: string) => {
      const split = splitHexColor(nextValue, '#000000')
      currentValue = composeHexColor(split.rgbHex, split.alpha)
      picker.value = split.rgbHex
      alphaSlider.value = String(split.alpha)
      alphaText.textContent = split.alpha.toString(16).padStart(2, '0')
    }

    Object.defineProperty(root, 'value', {
      configurable: true,
      enumerable: true,
      get: () => currentValue,
      set: (nextValue: string) => {
        syncControlState(nextValue)
      },
    })

    const emitColorEvent = (type: 'input' | 'change') => {
      currentValue = composeHexColor(
        picker.value,
        Number.parseInt(alphaSlider.value, 10)
      )
      alphaText.textContent = Number.parseInt(alphaSlider.value, 10)
        .toString(16)
        .padStart(2, '0')
      root.dispatchEvent(new Event(type))
    }

    picker.addEventListener('input', () => {
      emitColorEvent('input')
    })
    picker.addEventListener('change', () => {
      emitColorEvent('change')
    })
    alphaSlider.addEventListener('input', () => {
      emitColorEvent('input')
    })
    alphaSlider.addEventListener('change', () => {
      emitColorEvent('change')
    })

    syncControlState(value)
    root.appendChild(picker)
    root.appendChild(alphaSlider)
    root.appendChild(alphaText)
    return root
  }

  static createMapListItem(): HTMLButtonElement {
    const item = document.createElement('button')
    item.className = 'editor-map-item'
    return item
  }

  static createMapThumbnailImage(src: string): HTMLImageElement {
    const img = document.createElement('img')
    img.src = src
    img.style.width = '100px'
    img.style.height = '80px'
    img.style.objectFit = 'cover'
    img.style.borderRadius = '4px'
    img.style.border = '1px solid rgba(255,255,255,0.2)'
    img.style.flexShrink = '0'
    return img
  }

  static createMapThumbnailPlaceholder(): HTMLDivElement {
    const placeholder = document.createElement('div')
    placeholder.style.width = '100px'
    placeholder.style.height = '80px'
    placeholder.style.backgroundColor = 'rgba(0,0,0,0.2)'
    placeholder.style.borderRadius = '4px'
    placeholder.style.border = '1px dashed rgba(255,255,255,0.1)'
    placeholder.style.flexShrink = '0'
    return placeholder
  }

  static createMapListTextContainer(): HTMLDivElement {
    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.alignItems = 'center'
    container.style.gap = '8px'
    return container
  }

  static createMapListTitle(text: string): HTMLSpanElement {
    const nameSpan = document.createElement('span')
    nameSpan.textContent = text
    return nameSpan
  }

  static createMapListDefaultTag(text: string): HTMLSpanElement {
    const tagSpan = document.createElement('span')
    tagSpan.textContent = text
    tagSpan.style.fontSize = '14px'
    tagSpan.style.color = 'rgba(255, 255, 255, 0.4)'
    return tagSpan
  }
}
