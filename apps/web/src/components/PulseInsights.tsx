import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Card, CardBody } from './ui';
type Cells = { cells: Array<{ key: string; count: number | null; suppressed: boolean; reason: string | null }>; total: number | null };
type Insights = { windowDays: number; minCellSize: number; participation: Cells; instruction: Cells; followUps: Cells; documentation: Cells };
export function PulseInsights() {
  const q = useQuery({ queryKey: ['pulse-insights'], queryFn: () => api.get<Insights>('/api/pulse/insights') });
  if (q.error) return <p role="alert">{q.error.message}</p>;
  if (!q.data) return <p role="status">Loading classroom insights…</p>;
  const data = q.data;
  return <section className="my-5 space-y-3"><h2 className="text-lg font-semibold">Pulsera Insights · last {data.windowDays} days</h2><p className="text-sm text-muted">Each table counts current learners once across enabled schools you administer. These are observation coverage and workflow measures, not ratings of learners or teacher quality. Checks cover different concepts and do not establish overall mastery. Corrected, expired, inaccessible, and superseded evidence is excluded.</p><div className="grid gap-4 lg:grid-cols-2">{([['Participation coverage', data.participation], ['Instructional observations', data.instruction], ['Follow-up coverage', data.followUps], ['Documentation coverage', data.documentation]] as const).map(([title, group]) => <Card key={title}><CardBody className="pt-5"><h3 className="mb-3 font-semibold">{title}</h3>{!group.cells.length ? <p className="text-sm text-muted">No enabled classroom data.</p> : <table className="w-full text-left text-sm"><thead><tr><th className="pb-2">Recorded category</th><th className="pb-2 text-right">Learners</th></tr></thead><tbody>{group.cells.map((c) => <tr key={c.key} className="border-t border-border"><td className="py-2 pr-3">{c.key}</td><td className="py-2 text-right">{c.suppressed ? 'Suppressed' : c.count}</td></tr>)}</tbody></table>}<p className="mt-2 text-xs text-muted">Cells below {data.minCellSize} learners and complementary cells are withheld. No individual drill-down.</p></CardBody></Card>)}</div></section>;
}
