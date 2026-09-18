import { useEffect, useMemo, useState } from 'react'
import { Sigma, Tag, Search } from 'lucide-react'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { Formula, CourseSymbol } from '@/entities/courseAnalysis/types'

export interface FormulaPanelProps {
  projectId: string
  topicId?: string
}

export function FormulaPanel({ projectId, topicId }: FormulaPanelProps): JSX.Element {
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [symbols, setSymbols] = useState<CourseSymbol[]>([])
  const [query, setQuery] = useState('')
  const repo = useMemo(() => new CourseAnalysisRepository(), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (topicId) {
          const [fs, ss] = await Promise.all([repo.listFormulasByTopic(topicId), repo.listSymbolsByTopic(topicId)])
          if (cancelled) return
          setFormulas(fs)
          setSymbols(ss)
        } else {
          const [fs, ss] = await Promise.all([repo.listFormulas(projectId), repo.listSymbols(projectId)])
          if (cancelled) return
          setFormulas(fs)
          setSymbols(ss)
        }
      } catch {
        if (!cancelled) {
          setFormulas([])
          setSymbols([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, topicId, repo])

  const q = query.trim().toLowerCase()
  const filteredFormulas = q ? formulas.filter((f) => f.name.toLowerCase().includes(q) || f.latex.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)) : formulas
  const filteredSymbols = q ? symbols.filter((s) => s.symbol.toLowerCase().includes(q) || s.meaning.toLowerCase().includes(q) || s.context.toLowerCase().includes(q)) : symbols

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search formulas or symbols"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sigma className="h-4 w-4" /> Formulas ({filteredFormulas.length})
          </CardTitle>
          <CardDescription>Click a dot to copy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredFormulas.length === 0 ? (
            <p className="text-xs text-muted-foreground">No formulas yet.</p>
          ) : (
            filteredFormulas.slice(0, 30).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => navigator.clipboard?.writeText(f.latex).catch(() => undefined)}
                className="block w-full rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{f.name}</span>
                  <code className="rounded bg-muted px-1 font-mono text-xs">{f.latex}</code>
                </div>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-4 w-4" /> Symbols ({filteredSymbols.length})
          </CardTitle>
          <CardDescription>Different meanings are kept as separate entries.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {filteredSymbols.length === 0 ? (
            <p className="text-xs text-muted-foreground">No symbols yet.</p>
          ) : (
            filteredSymbols.slice(0, 40).map((s) => (
              <div key={s.id} className="rounded-md border bg-card p-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <code className="rounded bg-muted px-1 font-mono">{s.symbol}</code>
                  {s.unit && <Badge variant="outline">{s.unit}</Badge>}
                </div>
                <p className="text-xs">{s.meaning}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.context}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}