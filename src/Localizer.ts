export enum Language {
  ZhHans = 'zh-Hans',
  En = 'en',
}

type Translations = Record<string, string>
type LanguageChangeCallback = (lang: Language) => void

const STORAGE_KEY_LANGUAGE = 'fruman_language'

export function getSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANGUAGE)
    if (saved === Language.ZhHans || saved === Language.En) {
      return saved
    }
  } catch (error) {
    console.warn('[Localizer] Failed to read saved language:', error)
  }
  return null
}

export function saveLanguagePreference(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY_LANGUAGE, lang)
  } catch (error) {
    console.warn('[Localizer] Failed to save language:', error)
  }
}

export function getBrowserLanguage(): Language {
  const browserLanguage = navigator.languages?.[0] ?? navigator.language
  return browserLanguage.toLowerCase().startsWith('zh')
    ? Language.ZhHans
    : Language.En
}

export function getInitialLanguage(): Language {
  return getSavedLanguage() ?? getBrowserLanguage()
}

export class Localizer {
  private static instance: Localizer
  private currentLang: Language
  private translations: Translations = {}
  private loadedLanguages: Map<Language, Translations> = new Map()
  private listeners: Set<LanguageChangeCallback> = new Set()

  private constructor() {
    this.currentLang = getInitialLanguage()
  }

  static getInstance(): Localizer {
    if (!Localizer.instance) {
      Localizer.instance = new Localizer()
    }
    return Localizer.instance
  }

  async init(lang: Language = getInitialLanguage()): Promise<void> {
    this.currentLang = lang
    saveLanguagePreference(lang)
    await this.loadLanguage(lang)
  }

  private async loadLanguage(lang: Language): Promise<void> {
    if (this.loadedLanguages.has(lang)) {
      this.translations = this.loadedLanguages.get(lang)!
      return
    }

    try {
      const response = await fetch(`/lang/${lang}.json`)
      if (!response.ok) {
        console.error(`加载语言文件失败: ${lang}`)
        return
      }
      const translations = await response.json()
      this.loadedLanguages.set(lang, translations)
      this.translations = translations
    } catch (error) {
      console.error(`加载语言文件出错: ${lang}`, error)
    }
  }

  async setLanguage(lang: Language): Promise<void> {
    if (this.currentLang === lang && this.loadedLanguages.has(lang)) {
      return
    }
    this.currentLang = lang
    saveLanguagePreference(lang)
    await this.loadLanguage(lang)
    this.notifyLanguageChange(lang)
  }

  onLanguageChange(callback: LanguageChangeCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyLanguageChange(lang: Language): void {
    this.listeners.forEach((callback) => {
      try {
        callback(lang)
      } catch (error) {
        console.error('[Localizer] Error in language change listener:', error)
      }
    })
  }

  getCurrentLanguage(): Language {
    return this.currentLang
  }

  t(key: string): string {
    return this.translations[key] || key
  }
}

export const localizer = Localizer.getInstance()
