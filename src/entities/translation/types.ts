export interface TranslationEntry {
  id: string
  projectId: string
  sourceText: string
  sourceLanguage: 'zh' | 'en' | 'auto'
  targetLanguage: 'zh' | 'en'
  translation: string
  contextNote: string
  alternatives: string[]
  context: {
    topic?: string
    surrounding: string
  }
  createdAt: number
}