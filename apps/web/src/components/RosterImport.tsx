import { useState } from 'react';
import { parseRosterCsv, type RosterImportPreview, type RosterImportRow } from '@class-pulse/domain';
import { api } from '../lib/api';
import { Button, Input } from './ui';

export function RosterImport({ sectionId, onImported }: { sectionId: string; onImported(): void }) {
  const [rows, setRows] = useState<RosterImportRow[]>([]);
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  return <div className="space-y-4">
    <p className="text-sm text-muted">Use headers externalId,firstName,lastName,gradeLevel (gradeLevel is optional). Up to 500 students. Existing names, support records, and family access are preserved.</p>
    <label className="block text-sm font-medium" htmlFor="roster-csv">Roster CSV</label>
    <Input id="roster-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={async (e) => {
      const file = e.target.files?.[0];
      setPreview(null); setRows([]); setError(''); setStatus('');
      if (!file) return;
      setBusy(true);
      try {
        if (file.size > 200_000) throw new Error('CSV must be at most 200 KB');
        const parsed = parseRosterCsv(await file.text());
        const result = await api.post<RosterImportPreview>('/api/classroom/import/preview', { sectionId, rows: parsed });
        setRows(parsed); setPreview(result);
      } catch (err) { setError(err instanceof Error ? err.message : 'Could not read CSV'); }
      finally { setBusy(false); }
    }} />
    {preview && <>
      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-sm"><caption className="p-2 text-left">Review {preview.rows.length} students before importing</caption><thead><tr><th className="p-2">Student</th><th className="p-2">Action</th></tr></thead>
          <tbody>{preview.rows.map((r) => <tr key={r.externalId} className="border-t border-border"><td className="p-2">{r.firstName} {r.lastName}<div className="text-xs text-muted">{r.externalId}</div></td><td className="p-2">{r.action}{r.reason && <div className="text-xs text-danger-fg">{r.reason}</div>}</td></tr>)}</tbody>
        </table>
      </div>
      <Button loading={busy} disabled={!preview.canImport || busy} onClick={async () => {
        setBusy(true); setError('');
        try {
          const result = await api.post<{ created: number; added: number; unchanged: number }>('/api/classroom/import/confirm', { sectionId, rows, confirmed: true });
          setStatus(`Imported: ${result.created} new students, ${result.added} enrollments added, ${result.unchanged} unchanged.`);
          setPreview(null); setRows([]); onImported();
        } catch (err) { setError(err instanceof Error ? err.message : 'Import failed. You can retry safely.'); }
        finally { setBusy(false); }
      }}>Confirm roster import</Button>
    </>}
    {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    <p role="status" className="text-sm">{busy ? 'Checking and saving roster…' : status}</p>
  </div>;
}
