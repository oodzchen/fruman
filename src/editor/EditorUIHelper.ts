export class EditorUIHelper {
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

  static createColorInput(value: string): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = value
    input.style.cssText = `
      width: 200px;
      height: 32px;
      padding: 2px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.25);
      cursor: pointer;
    `
    return input
  }
}
