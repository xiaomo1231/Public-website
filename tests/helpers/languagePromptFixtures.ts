import { prompts } from '@/infrastructure/ai/prompts'
import { languageRule } from '@/infrastructure/ai/prompts/homework-walkthrough/v1'

/**
 * Prompts that carry a language line, built with fixed inputs for every
 * language value they knew before 跟随考试语言. Their text must not change
 * (see `tests/examLanguage.test.ts`, which compares them with the prompts of
 * the commit before the exam-language mode).
 */
type Loose = never

export function languagePromptFixtures(): Record<string, string> {
  const out: Record<string, string> = {}
  const snippets = ['[chunk:c1 · p.1]\nThe brachial plexus is formed by C5–T1.']
  for (const language of ['zh', 'en', 'mixed'] as const) {
    out[`tutorLesson:${language}`] = prompts.tutorLesson.buildUserPrompt({
      topicName: 'Brachial plexus',
      topicDescription: 'Roots, trunks, cords',
      language,
      sourceSnippets: snippets,
    } as Loose)
    out[`tutorQuestion:${language}`] = prompts.tutorQuestion.buildUserPrompt({
      topicName: 'Brachial plexus',
      topicDescription: 'Roots',
      difficulty: 'basic',
      language,
      sourceSnippets: snippets,
    } as Loose)
    out[`tutorEvaluate:${language}`] = prompts.tutorEvaluate.buildUserPrompt({
      topicName: 'Brachial plexus',
      question: 'Which roots?',
      expectedAnswer: 'C5–T1',
      studentAnswer: 'C5-T1',
      language,
      sourceSnippets: snippets,
      sourceRefs: [],
    } as Loose)
    out[`tutorIntroduce:${language}`] = prompts.tutorIntroduce.buildUserPrompt({
      topicName: 'Brachial plexus',
      topicDescription: 'Roots',
      context: 'intro',
      sourceSnippets: snippets,
      language,
    } as Loose)
    out[`mistakeAnalyzer:${language}`] = prompts.mistakeAnalyzer.buildUserPrompt({
      question: 'Which roots form the brachial plexus?',
      studentAnswer: 'C4–T1',
      correctAnswer: 'C5–T1',
      language,
    } as Loose)
  }
  for (const language of ['zh', 'en', 'mixed', 'zh_terms'] as const) {
    out[`quizGenerator:${language}`] = prompts.quizGenerator.buildUserPrompt({
      topicName: 'Brachial plexus',
      topicDescription: 'Roots',
      knowledgePoints: ['roots'],
      plan: [{ difficulty: 'basic', type: 'multiple_choice' }],
      language,
      sourceSnippets: snippets,
    } as Loose)
    out[`oralExam:${language}`] = prompts.oralExam.buildUserPrompt({
      topic: 'Brachial plexus',
      courseTopics: [],
      knowledgePoints: [],
      sourceSnippets: snippets,
      language,
    } as Loose)
  }
  for (const language of ['zh_terms', 'zh', 'en'] as const) {
    out[`walkthroughRule:${language}`] = languageRule(language)
    out[`walkthroughQuestion:${language}`] = prompts.homeworkWalkthrough.buildQuestionUserPrompt({
      label: '1',
      question: 'Solve x + 1 = 2.',
      sourceText: '',
      language,
    } as Loose)
  }
  for (const language of ['zh', 'en'] as const) {
    out[`practiceGenerate:${language}`] = prompts.practiceGenerate.buildUserPrompt({
      language,
      keyPoints: 'linear systems',
      slots: [{ id: 's1', mode: 'compact', partLabels: [], knowledgePoints: ['rank'] }],
    } as Loose)
  }
  return out
}
