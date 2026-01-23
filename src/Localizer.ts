export enum Language {
  ZhHans = 'zh-Hans',
  En = 'en',
}

type Translations = Record<string, string>

export class Localizer {
  private static instance: Localizer
  private currentLang: Language
  private translations: Translations = {}
  private loadedLanguages: Map<Language, Translations> = new Map()

  private constructor() {
    this.currentLang = Language.ZhHans
  }

  static getInstance(): Localizer {
    if (!Localizer.instance) {
      Localizer.instance = new Localizer()
    }
    return Localizer.instance
  }

  async init(lang: Language = Language.ZhHans): Promise<void> {
    this.currentLang = lang
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
    if (this.currentLang === lang) {
      return
    }
    this.currentLang = lang
    await this.loadLanguage(lang)
  }

  getCurrentLanguage(): Language {
    return this.currentLang
  }

  t(key: string): string {
    return this.translations[key] || key
  }
}

export const localizer = Localizer.getInstance()
