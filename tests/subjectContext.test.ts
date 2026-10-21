import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { inferExamStyle, resolveSubjectContext } from '@/entities/project/subjectContext'
import { inferCourse, inferSubject } from '@/entities/project/subjectInference'
import { ProjectService } from '@/services/projectService'
import { loadProjectSubjectContext, loadProjectTargetLanguage } from '@/services/projectSubject'

const { buildSubjectBlock, subjectPromptVersion, withSubject } = prompts.subjectProfile

describe('medicine exam style', () => {
  it('keeps the domestic medicine profile byte-identical', () => {
    expect(buildSubjectBlock('medicine')).toMatchInlineSnapshot(`
      "COURSE SUBJECT: Basic medical sciences for clinical medicine and dentistry (years 1–2: systematic and regional anatomy, histology and embryology, physiology, medical biochemistry and molecular biology, medical cell biology, immunology, medical microbiology, oral anatomy and physiology, introductory pharmacology).
      Use the conventions below for this subject. They never override explicit output rules elsewhere in these instructions (JSON shape, field formats, numeric-answer rules), and when the course material uses a different notation, follow the material.
      Notation:
        - Give each term in Chinese followed by English (and the Latin name for anatomical structures where the course uses it), e.g. 三角肌（deltoid）; define abbreviations on first use (ACh, GFR, CO).
        - Directions are relative to the anatomical position (superior / inferior, medial / lateral, proximal / distal, superficial / deep, anterior / posterior); left and right are the body's own, never the viewer's.
        - Dentistry: FDI two-digit tooth notation unless the course uses another system (11 = upper right permanent central incisor, 55 = upper right primary second molar); tooth surfaces mesial, distal, buccal / labial, lingual / palatal, occlusal / incisal.
        - Units: mmHg (and kPa), mmol/L, mL/min, L/min, bpm; reference ranges are approximate and laboratory-dependent.
      Reasoning:
        - Connect structure to function and name the level (molecule, cell, tissue, organ, system).
        - Describe regulation as a loop: stimulus, receptor, afferent pathway, integrating centre, efferent pathway, effector, and whether the feedback is negative or positive.
        - Write mechanisms as cause → effect chains, and quantify with the governing equation where one exists (Nernst / GHK, Fick, Starling forces, Henderson–Hasselbalch, clearance C = U·V/P, CO = HR × SV, one-compartment pharmacokinetics).
        - Anatomy: position and relations (毗邻), blood supply, innervation and lymphatic drainage; trace nerve pathways neuron by neuron and name where each decussates.
        - Biochemistry: the pathway, its rate-limiting enzyme, regulation, energy yield and a clinical link.
        - Use a clinical example only to illustrate a basic-science principle.
      Answers:
        - Follow Chinese medical exam styles: 名词解释 (a concise definition with its key qualifier), 简答 (numbered points), 论述 (a structured argument); compare easily confused concepts in a table.
      Typical mistakes in this subject (watch for them; name them neutrally, never as carelessness): left and right taken from the viewer instead of the body; confusing afferent / efferent, sympathetic / parasympathetic, or a muscle's origin / insertion; mixing up similar structures (layers of an organ wall, arteries and veins in histology); unit errors (mmHg vs kPa, mmol/L vs mg/dL); getting the direction of a shift wrong (e.g. oxyhaemoglobin curve to the right); reading a correlation in a clinical observation as a cause; confusing primary and permanent tooth notation, or mesial and distal.
      Boundaries (always apply):
        - This is education, not medical care: never diagnose the student or anyone they describe, and never give treatment or dosage advice for a real person; if the student describes their own symptoms, suggest seeing a doctor.
        - Reference ranges and drug doses in examples are illustrative and vary by laboratory, guideline and patient — say so when you use them."
    `)
    expect(buildSubjectBlock('medicine', { forLesson: true })).toMatchInlineSnapshot(`
      "COURSE SUBJECT: Basic medical sciences for clinical medicine and dentistry (years 1–2: systematic and regional anatomy, histology and embryology, physiology, medical biochemistry and molecular biology, medical cell biology, immunology, medical microbiology, oral anatomy and physiology, introductory pharmacology).
      Use the conventions below for this subject. They never override explicit output rules elsewhere in these instructions (JSON shape, field formats, numeric-answer rules), and when the course material uses a different notation, follow the material.
      Notation:
        - Give each term in Chinese followed by English (and the Latin name for anatomical structures where the course uses it), e.g. 三角肌（deltoid）; define abbreviations on first use (ACh, GFR, CO).
        - Directions are relative to the anatomical position (superior / inferior, medial / lateral, proximal / distal, superficial / deep, anterior / posterior); left and right are the body's own, never the viewer's.
        - Dentistry: FDI two-digit tooth notation unless the course uses another system (11 = upper right permanent central incisor, 55 = upper right primary second molar); tooth surfaces mesial, distal, buccal / labial, lingual / palatal, occlusal / incisal.
        - Units: mmHg (and kPa), mmol/L, mL/min, L/min, bpm; reference ranges are approximate and laboratory-dependent.
      Reasoning:
        - Connect structure to function and name the level (molecule, cell, tissue, organ, system).
        - Describe regulation as a loop: stimulus, receptor, afferent pathway, integrating centre, efferent pathway, effector, and whether the feedback is negative or positive.
        - Write mechanisms as cause → effect chains, and quantify with the governing equation where one exists (Nernst / GHK, Fick, Starling forces, Henderson–Hasselbalch, clearance C = U·V/P, CO = HR × SV, one-compartment pharmacokinetics).
        - Anatomy: position and relations (毗邻), blood supply, innervation and lymphatic drainage; trace nerve pathways neuron by neuron and name where each decussates.
        - Biochemistry: the pathway, its rate-limiting enzyme, regulation, energy yield and a clinical link.
        - Use a clinical example only to illustrate a basic-science principle.
      Answers:
        - Follow Chinese medical exam styles: 名词解释 (a concise definition with its key qualifier), 简答 (numbered points), 论述 (a structured argument); compare easily confused concepts in a table.
      Typical mistakes in this subject (watch for them; name them neutrally, never as carelessness): left and right taken from the viewer instead of the body; confusing afferent / efferent, sympathetic / parasympathetic, or a muscle's origin / insertion; mixing up similar structures (layers of an organ wall, arteries and veins in histology); unit errors (mmHg vs kPa, mmol/L vs mg/dL); getting the direction of a shift wrong (e.g. oxyhaemoglobin curve to the right); reading a correlation in a clinical observation as a cause; confusing primary and permanent tooth notation, or mesial and distal.
      Boundaries (always apply):
        - This is education, not medical care: never diagnose the student or anyone they describe, and never give treatment or dosage advice for a real person; if the student describes their own symptoms, suggest seeing a doctor.
        - Reference ranges and drug doses in examples are illustrative and vary by laboratory, guideline and patient — say so when you use them.
      In this lesson:
        - When a quantitative physiology or biochemistry topic is central, state the values a diagram needs: ion concentrations (and permeabilities) for membrane potentials; P50 for oxygen binding; EDV, ESV and pressures for the cardiac cycle; lung volumes; Starling forces or clearance data; pH, PaCO₂ and HCO₃⁻ for acid–base; pKa values for an amino acid; the steps of a pathway with their ATP / NADH / FADH₂ changes; dose, volume of distribution, half-life and dosing interval for pharmacokinetics.
        - For anatomy give relations as a table (a muscle's origin, insertion, action, innervation and blood supply); trace sensory and motor pathways neuron by neuron with the level of each decussation; for embryology and tooth eruption give a timeline with ages.
        - Anatomy and histology are learnt from images: refer the student to the course figures by page rather than describing them from memory."
    `)
    expect(subjectPromptVersion('tutor/v5-lesson', 'medicine')).toMatchInlineSnapshot(
      `"tutor/v5-lesson+subject-profile/v1:medicine"`,
    )
    // An explicit domestic context is the same as the bare subject.
    expect(buildSubjectBlock({ subject: 'medicine', examStyle: 'domestic' })).toBe(
      buildSubjectBlock('medicine'),
    )
    expect(subjectPromptVersion('x', { subject: 'medicine', examStyle: 'domestic' })).toBe(
      subjectPromptVersion('x', 'medicine'),
    )
  })

  it('teaches the international style in English + Latin with its exam formats', () => {
    const block = buildSubjectBlock(
      { subject: 'medicine', examStyle: 'international' },
      { forLesson: true },
    )
    expect(block).toContain('Latin')
    expect(block).toContain('Terminologia Anatomica')
    expect(block).toMatch(/identify \/ name the structure/)
    expect(block).toMatch(/lymphatic drainage, development/)
    expect(block).toContain('MCQ')
    expect(block).not.toContain('名词解释')
    expect(block).not.toContain('简答')
    expect(block).not.toContain('毗邻')
    // The safety boundaries apply to both styles.
    expect(block).toContain('Boundaries (always apply):')
    expect(block).toMatch(/never diagnose/)
    expect(subjectPromptVersion('x', { subject: 'medicine', examStyle: 'international' })).toBe(
      'x+subject-profile/v1:medicine-intl',
    )
  })

  it('defaults from the materials: English → international, Chinese or none → domestic', () => {
    const english = {
      weight: 1000,
      text: 'The deltoid muscle (musculus deltoideus) is innervated by the axillary nerve.',
    }
    const chinese = {
      weight: 1000,
      text: '三角肌（deltoid）起自锁骨外侧段、肩峰和肩胛冈，止于肱骨三角肌粗隆。',
    }
    const hungarian = { weight: 1000, text: 'Fáj a nyakam. Mióta fáj? Két napja.' }
    expect(inferExamStyle([english])).toBe('international')
    expect(inferExamStyle([hungarian])).toBe('international')
    expect(inferExamStyle([chinese])).toBe('domestic')
    expect(inferExamStyle([])).toBe('domestic')
    expect(inferExamStyle([english, { ...chinese, weight: 5000 }])).toBe('domestic')
  })

  it('lets an explicit choice win over the inferred default', () => {
    expect(resolveSubjectContext({ subject: 'medicine' }, 'international').examStyle).toBe(
      'international',
    )
    expect(
      resolveSubjectContext({ subject: 'medicine', examStyle: 'domestic' }, 'international')
        .examStyle,
    ).toBe('domestic')
    expect(resolveSubjectContext({ subject: 'medicine' }).examStyle).toBe('domestic')
    // Only medicine has an exam style; only language courses a target language.
    expect(resolveSubjectContext({ subject: 'physics', examStyle: 'international' })).toEqual({
      subject: 'physics',
    })
    expect(resolveSubjectContext({ subject: 'medicine', targetLanguage: 'de' })).toEqual({
      subject: 'medicine',
      examStyle: 'domestic',
    })
  })
})

describe('project subject context (database)', () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function addMaterial(projectId: string, text: string): Promise<void> {
    const id = crypto.randomUUID()
    await db.table('documents').add({
      id,
      projectId,
      type: 'pdf',
      name: `${id}.pdf`,
      sizeBytes: 0,
      hasBlob: false,
      status: 'ready',
      warnings: [],
      metadata: {},
      textLength: text.length,
      uploadedAt: Date.now(),
    })
    await db.table('chunks').add({
      id: crypto.randomUUID(),
      documentId: id,
      projectId,
      contentType: 'paragraph',
      text,
      sourceReference: 'x',
      order: 0,
      createdAt: Date.now(),
    })
  }

  it('infers the medicine exam style from processed materials unless one is chosen', async () => {
    const service = new ProjectService(db)
    const anatomy = await service.create({ name: 'Macroscopic Anatomy', subject: 'medicine' })
    expect((await loadProjectSubjectContext(anatomy.id, db))?.examStyle).toBe('domestic')

    await addMaterial(anatomy.id, 'The brachial plexus is formed by the ventral rami of C5–T1.')
    expect(await loadProjectSubjectContext(anatomy.id, db)).toEqual({
      subject: 'medicine',
      examStyle: 'international',
    })

    await service.update(anatomy.id, { examStyle: 'domestic' })
    expect((await loadProjectSubjectContext(anatomy.id, db))?.examStyle).toBe('domestic')
    await service.update(anatomy.id, { examStyle: null })
    expect((await loadProjectSubjectContext(anatomy.id, db))?.examStyle).toBe('international')

    const chinese = await service.create({ name: '系统解剖学', subject: 'medicine' })
    await addMaterial(chinese.id, '臂丛由第5～8颈神经前支和第1胸神经前支的大部分纤维组成。')
    expect((await loadProjectSubjectContext(chinese.id, db))?.examStyle).toBe('domestic')

    expect(await loadProjectSubjectContext('missing', db)).toBeUndefined()
  })

  it('stores the target language of a language course as a primary tag', async () => {
    const service = new ProjectService(db)
    const german = await service.create({
      name: 'Medical German',
      subject: 'language',
      targetLanguage: 'de-AT',
    })
    expect(german.targetLanguage).toBe('de')
    expect(await loadProjectSubjectContext(german.id, db)).toEqual({
      subject: 'language',
      targetLanguage: 'de',
    })
    expect(await loadProjectTargetLanguage(german.id, db)).toBe('de')
    await service.update(german.id, { targetLanguage: 'hu' })
    expect(await loadProjectTargetLanguage(german.id, db)).toBe('hu')
    await service.update(german.id, { targetLanguage: null })
    expect(await loadProjectTargetLanguage(german.id, db)).toBeUndefined()
    // A stale tag on a non-language course is ignored.
    await service.update(german.id, { targetLanguage: 'de', subject: 'medicine' })
    expect(await loadProjectTargetLanguage(german.id, db)).toBeUndefined()
  })
})

describe('language course profile', () => {
  it('names the target language and its conventions', () => {
    const german = buildSubjectBlock({ subject: 'language', targetLanguage: 'de' })
    expect(german).toContain('COURSE SUBJECT: Foreign-language course')
    expect(german).toContain('German (Deutsch)')
    expect(german).toContain('der Kopf, die Köpfe')
    expect(german).not.toContain('vowel-harmony')
    expect(german).toContain('Boundaries (always apply):')
    expect(german).toMatch(/never diagnose/)
    // The explanation language is the one the prompt asks for, never fixed.
    expect(german).toMatch(/Explain in the language these instructions ask you to respond in/)
    expect(german).not.toMatch(/Chinese/)

    const hungarian = buildSubjectBlock(
      { subject: 'language', targetLanguage: 'hu' },
      { forLesson: true },
    )
    expect(hungarian).toContain('Hungarian (magyar)')
    expect(hungarian).toContain('nyak+am+ban')
    expect(hungarian).toContain('vowel-harmony')
    expect(hungarian).toContain('In this lesson:')
    expect(hungarian).toMatch(/gap-fill, matching .*translation .*dialogue completion/)

    const generic = buildSubjectBlock('language')
    expect(generic).toContain('the target language')
    expect(buildSubjectBlock({ subject: 'language', targetLanguage: 'it' })).toContain('Italian')
  })

  it('keys cached output by the target language', () => {
    expect(subjectPromptVersion('x', { subject: 'language', targetLanguage: 'de' })).toBe(
      'x+subject-profile/v1:language-de',
    )
    expect(subjectPromptVersion('x', { subject: 'language', targetLanguage: 'hu' })).toBe(
      'x+subject-profile/v1:language-hu',
    )
    expect(subjectPromptVersion('x', 'language')).toBe('x+subject-profile/v1:language')
    expect(withSubject('BASE', { subject: 'language', targetLanguage: 'de' })).toMatch(
      /^BASE\n\nCOURSE SUBJECT: /,
    )
  })

  it('offers no science figures to a language course', () => {
    const figures = prompts.visualizationGenerator.scienceFiguresFor('language')
    expect(Object.values(figures).every((enabled) => !enabled)).toBe(true)
  })
})

describe('course inference', () => {
  it.each([
    ['Hungarian Medical Terminology I', 'hu'],
    ['Magyar orvosi szaknyelv', 'hu'],
    ['Introduction to German I', 'de'],
    ['Einführung in die medizinische Fachsprache Deutsch', 'de'],
    ['医学德语', 'de'],
    ['Medical German', 'de'],
    ['医学英语', 'en'],
    ['Medical English', 'en'],
    ['French for Medicine', 'fr'],
  ])('reads %s as a language course (%s)', (name, language) => {
    expect(inferCourse(name)).toEqual({ subject: 'language', targetLanguage: language })
    expect(inferSubject(name)).toBe('language')
  })

  it('keeps other courses as they were', () => {
    expect(inferCourse('Macroscopic Anatomy and Embryology')).toEqual({ subject: 'medicine' })
    expect(inferSubject('Medical Terminology')).toBe('medicine')
    expect(inferSubject('Anatomy in English')).toBe('medicine')
    expect(inferSubject('Programming Languages')).toBe('cs')
    expect(inferSubject('Natural Language Processing')).not.toBe('language')
    expect(inferSubject('线性代数')).toBe('linear_algebra')
    expect(inferCourse('外语')).toEqual({ subject: 'language' })
  })
})
