import { z } from 'zod';

export const RosterImportRow = z.object({
  externalId: z.string().trim().min(1).max(100),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  gradeLevel: z.string().trim().max(20),
}).strict();
export type RosterImportRow = z.infer<typeof RosterImportRow>;
export const RosterImportRows = z.array(RosterImportRow).min(1).max(500).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.externalId)) ctx.addIssue({ code: 'custom', path: [index, 'externalId'], message: 'Duplicate externalId in file' });
    seen.add(row.externalId);
  });
});

/** Small bounded CSV reader: quoted commas/newlines, doubled quotes, CRLF and UTF-8 BOM. */
export function parseRosterCsv(input: string): RosterImportRow[] {
  if (input.length > 200_000) throw new Error('CSV must be at most 200 KB');
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [], field = '', quoted = false, closed = false;
  const endField = () => { record.push(field); field = ''; closed = false; };
  const endRecord = () => { endField(); if (record.some((s) => s.trim())) records.push(record); record = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',') endField();
    else if (c === '\n' || c === '\r') { endRecord(); if (c === '\r' && text[i + 1] === '\n') i++; }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('Malformed quoted CSV field');
    else field += c;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  if (field || record.length || closed) endRecord();
  const header = records.shift()?.map((s) => s.trim()) ?? [];
  const required = ['externalId', 'firstName', 'lastName'];
  if (new Set(header).size !== header.length || required.some((s) => !header.includes(s)) || header.some((s) => ![...required, 'gradeLevel'].includes(s))) {
    throw new Error('Headers must be externalId,firstName,lastName and optional gradeLevel');
  }
  return RosterImportRows.parse(records.map((cells, i) => {
    if (cells.length !== header.length) throw new Error(`Row ${i + 2} has the wrong number of fields`);
    return { gradeLevel: '', ...Object.fromEntries(header.map((key, n) => [key, cells[n]])) };
  }));
}
export interface RosterImportPreview {
  rows: Array<RosterImportRow & { action: 'create' | 'enroll' | 'unchanged' | 'blocked'; reason: string | null }>;
  canImport: boolean;
}
