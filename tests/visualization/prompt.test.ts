import { describe, expect, it } from 'vitest'
import {
  buildSystemPrompt,
  buildUserPrompt,
} from '@/infrastructure/ai/prompts/visualization-generator/v4'
import * as VisualizationGeneratorV1 from '@/infrastructure/ai/prompts/visualization-generator/v1'
import * as VisualizationGeneratorV2 from '@/infrastructure/ai/prompts/visualization-generator/v2'
import * as VisualizationGeneratorV3 from '@/infrastructure/ai/prompts/visualization-generator/v3'
import * as VisualizationGeneratorV4 from '@/infrastructure/ai/prompts/visualization-generator/v4'
import { prompts, PROMPT_VERSIONS } from '@/infrastructure/ai/prompts'
import { hasGraphableMath } from '@/entities/tutorVisualization/graphable'

describe('visualization prompt contract', () => {
  it('is registered at v5 and keeps v1/v2/v3/v4 available', () => {
    expect(PROMPT_VERSIONS.visualizationGenerator).toBe('v5')
    expect(prompts.visualizationGenerator.VERSION).toBe('v5')
    expect(VisualizationGeneratorV1.VERSION).toBe('v1')
    expect(VisualizationGeneratorV2.VERSION).toBe('v2')
    expect(VisualizationGeneratorV3.VERSION).toBe('v3')
    expect(VisualizationGeneratorV4.VERSION).toBe('v4')
  })

  it('is isolated from the course-analysis prompt family', () => {
    expect(prompts.visualizationGenerator.PROMPT_KIND).toBe('visualization-generator')
    expect(prompts.documentAnalyzer).not.toBe(prompts.visualizationGenerator)
    expect(prompts.documentAnalyzer.PROMPT_KIND).toBe('document-analyzer')
  })

  it('demands structured JSON and forbids executable output', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/valid JSON/)
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript/)
    expect(prompt).toMatch(/structured/i)
  })

  it('states the supported subset and the unsupported examples', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('y = 2x + 1')
    expect(prompt).toMatch(/NOT supported/)
    expect(prompt).toContain('x^2 + y^2 = 4')
    expect(prompt).toContain('xy = 1')
  })

  it('forbids fabricating points for a function', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/do not fabricate/i)
    expect(prompt).toMatch(/NEVER supply sample points/)
  })

  it('keeps the security footer', () => {
    expect(buildSystemPrompt()).toMatch(/UNTRUSTED CONTENT/)
  })

  it('wraps the lesson as untrusted content in the user prompt', () => {
    const user = buildUserPrompt({
      topicName: 'Linear Functions',
      topicDescription: 'Straight lines.',
      language: 'en',
      lessonContent: 'A line is \\(y = 2x + 1\\).',
    })
    expect(user).toContain('Linear Functions')
    expect(user).toContain('BEGIN LESSON')
    expect(user).toContain('END LESSON')
    expect(user).toContain('y = 2x + 1')
  })
})

describe('hasGraphableMath gate', () => {
  it('detects a relation with x and y inside maths delimiters', () => {
    expect(hasGraphableMath('A line is \\(y = 2x + 1\\).')).toBe(true)
    expect(hasGraphableMath('\\[x + y = 6\\]')).toBe(true)
    expect(hasGraphableMath('So \\(y \\ge 2x - 1\\).')).toBe(true)
  })

  it('detects explicit coordinate pairs', () => {
    expect(hasGraphableMath('The points (-2, 3), (0, 1) and (2, 5) lie on it.')).toBe(true)
  })

  it('ignores set theory and prose', () => {
    expect(hasGraphableMath('The intersection is \\(X \\cap Y = \\{c\\}\\).')).toBe(false)
    expect(hasGraphableMath('A definition with no graph at all.')).toBe(false)
    expect(hasGraphableMath('')).toBe(false)
  })
})

describe('visualization prompt contract — Phase 2 nonlinear', () => {
  it('documents the supported nonlinear families and the expression/domain fields', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/quadratic/i)
    expect(prompt).toMatch(/sine\/cosine/i)
    expect(prompt).toMatch(/exponential/i)
    expect(prompt).toMatch(/logarithm/i)
    expect(prompt).toMatch(/reciprocal/i)
    expect(prompt).toMatch(/square root/i)
    expect(prompt).toContain('expression')
    expect(prompt).toContain('domain')
  })

  it('still forbids implicit curves and executable output', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/implicit curves/)
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript/)
  })
})

describe('hasGraphableMath gate — nonlinear forms', () => {
  it('detects nonlinear function forms of x', () => {
    expect(hasGraphableMath('Graph \\(y = x^2\\).')).toBe(true)
    expect(hasGraphableMath('The curve \\(y = \\sin(x)\\) oscillates.')).toBe(true)
    expect(hasGraphableMath('Consider \\(\\ln(x)\\).')).toBe(true)
    expect(hasGraphableMath('So \\(\\sqrt{2x + 4}\\).')).toBe(true)
  })

  it('does not fire on unrelated maths or prose', () => {
    expect(hasGraphableMath('The matrix \\(A\\) is invertible.')).toBe(false)
    expect(hasGraphableMath('A proof with no variable at all.')).toBe(false)
  })
})

describe('visualization prompt contract — Phase 3.0 vectors & graphs', () => {
  it('documents vectors_2d and graph_2d with their rules', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('vectors_2d')
    expect(prompt).toContain('graph_2d')
    expect(prompt).toMatch(/components/i)
    expect(prompt).toMatch(/at most 12/)
    expect(prompt).toContain('rootId')
    expect(prompt).toContain('partition')
  })

  it('forbids coordinates, SVG, HTML, JavaScript, CSS and colours', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript, CSS, colours, coordinates/)
    expect(prompt).toMatch(/NEVER provide node coordinates/)
    expect(prompt).toMatch(/NEVER provide endpoints/)
  })

  it('keeps the untrusted wrapper and the security footer', () => {
    const user = buildUserPrompt({
      topicName: 'Graphs',
      topicDescription: '',
      language: 'en',
      lessonContent: 'A graph has vertices and edges.',
    })
    expect(user).toContain('BEGIN LESSON')
    expect(user).toContain('END LESSON')
    expect(buildSystemPrompt()).toMatch(/UNTRUSTED CONTENT/)
  })

  it('tells the model to return an empty list rather than guess', () => {
    expect(buildSystemPrompt()).toMatch(/\{ "visualizations": \[\] \}/)
    expect(buildSystemPrompt()).toMatch(/do not return that diagram/i)
  })
})

describe('hasGraphableMath gate — vectors & graphs', () => {
  it('detects vector lessons (English and Chinese)', () => {
    expect(hasGraphableMath('Vector addition: the sum of two vectors.')).toBe(true)
    expect(hasGraphableMath('标量与向量相乘，得到一个新的向量。')).toBe(true)
    expect(hasGraphableMath('The basis vectors and their components.')).toBe(true)
  })

  it('detects graph lessons (English and Chinese)', () => {
    expect(hasGraphableMath('An undirected graph with vertices and edges.')).toBe(true)
    expect(hasGraphableMath('A rooted tree with a root node.')).toBe(true)
    expect(hasGraphableMath('二分图的顶点可以分成左右两部分。')).toBe(true)
  })

  it('does not over-trigger on a single ambiguous word', () => {
    expect(hasGraphableMath('The edge of the region is smooth.')).toBe(false)
    expect(hasGraphableMath('A vector space is a set.')).toBe(false)
    expect(hasGraphableMath('A definition with no graph at all.')).toBe(false)
  })
})

describe('visualization prompt contract — Phase 3.1 transforms & sets', () => {
  it('documents transform_2d and venn_2d', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('transform_2d')
    expect(prompt).toContain('venn_2d')
    expect(prompt).toContain('matrix')
    expect(prompt).toContain('operands')
    expect(prompt).toContain('universe')
  })

  it('requires diagrams to reuse the lesson examples only', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/EXACT matrix, vectors, sets, elements and operation/)
    expect(prompt).toMatch(/NEVER change a number/)
    expect(prompt).toMatch(/Return \{ "visualizations": \[\] \} rather than guessing/)
  })

  it('forbids coordinates, results and determinants', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/NEVER provide the transformed vectors, the determinant/)
    expect(prompt).toMatch(/NEVER provide circle positions/)
    expect(prompt).toMatch(/NEVER output SVG, HTML, JavaScript, CSS, colours, coordinates/)
  })

  it('documents the placement anchor', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('placement')
    expect(prompt).toContain('workedExample')
    expect(prompt).toMatch(/0-based/)
  })

  it('keeps the untrusted wrapper and security footer', () => {
    const user = buildUserPrompt({
      topicName: 'Linear transformations',
      topicDescription: '',
      language: 'en',
      lessonContent: 'Let A = [[2,0],[0,1]] and v = (1,1).',
    })
    expect(user).toContain('BEGIN LESSON')
    expect(buildSystemPrompt()).toMatch(/UNTRUSTED CONTENT/)
  })
})

describe('hasGraphableMath gate — transforms & sets', () => {
  it('detects transformation lessons (English and Chinese)', () => {
    expect(hasGraphableMath('A linear transformation is represented by a matrix.')).toBe(true)
    expect(hasGraphableMath('The determinant measures area scaling.')).toBe(true)
    expect(hasGraphableMath('这是一个旋转矩阵。')).toBe(true)
  })

  it('detects set-operation lessons only with a set context', () => {
    expect(hasGraphableMath('The union and intersection of two sets.')).toBe(true)
    expect(hasGraphableMath('A Venn diagram of A and B.')).toBe(true)
    expect(hasGraphableMath('并集、交集与补集。')).toBe(true)
    // "intersection" alone (geometry) is not a set signal.
    expect(hasGraphableMath('The intersection of the two lines is a point.')).toBe(false)
  })
})

describe('visualization prompt contract — Phase 3.2 eigenvectors', () => {
  it('documents eigen_2d and its rules', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toContain('eigen_2d')
    expect(prompt).toContain('eigenpairs')
    expect(prompt).toMatch(/real eigenvalues/)
    expect(prompt).toMatch(/complex \(non-real\) eigenvalues/)
    expect(prompt).toContain('showUnitCircle')
    expect(prompt).toContain('showTransform')
  })

  it('treats eigenpairs as candidates and forbids computed results', () => {
    const prompt = buildSystemPrompt()
    expect(prompt).toMatch(/CANDIDATE items/)
    expect(prompt).toMatch(/recomputes and verifies every eigenvalue and eigenvector/)
    expect(prompt).toMatch(/NEVER provide coordinates, SVG, the transformed vector Av/)
  })

  it('keeps the untrusted wrapper and security footer', () => {
    const user = buildUserPrompt({
      topicName: 'Eigenvalues',
      topicDescription: '',
      language: 'en',
      lessonContent: 'Let A = [[2,1],[1,2]] with λ = 3 and v = (1,1).',
    })
    expect(user).toContain('BEGIN LESSON')
    expect(user).toContain('END LESSON')
    expect(buildSystemPrompt()).toMatch(/UNTRUSTED CONTENT/)
  })
})

describe('hasGraphableMath gate — eigenvectors', () => {
  it('detects eigenvalue / eigenvector lessons (English and Chinese)', () => {
    expect(hasGraphableMath('Find the eigenvalues and eigenvectors of A.')).toBe(true)
    expect(hasGraphableMath('The eigenspace of λ = 3.')).toBe(true)
    expect(hasGraphableMath('求矩阵的特征值与特征向量。')).toBe(true)
    expect(hasGraphableMath('特征方程用于求解特征值。')).toBe(true)
  })

  it('does not fire on unrelated prose', () => {
    expect(hasGraphableMath('A proof with no variable at all.')).toBe(false)
  })
})
