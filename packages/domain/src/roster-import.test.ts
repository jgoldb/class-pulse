import { describe, expect, it } from 'vitest';
import { parseRosterCsv } from './roster-import';

describe('roster CSV', () => {
  it('reads BOM, reordered headers, quoted commas, doubled quotes, CRLF, optional grades', () => {
    expect(parseRosterCsv('\uFEFFlastName,externalId,firstName\r\n"Li, Jr.",s1,"A""ri"\r\n')).toEqual([{ externalId: 's1', firstName: 'A"ri', lastName: 'Li, Jr.', gradeLevel: '' }]);
  });
  it.each([
    'externalId,firstName,lastName\n1,A,B\n1,C,D',
    'externalId,firstName,lastName\n,A,B',
    'externalId,firstName,lastName\n1,A',
    'externalId,firstName,lastName\n1,"A,B',
    'externalId,firstName,lastName\n1,"A"x,B',
    'firstName,lastName\nA,B',
    'externalId,firstName,lastName,password\n1,A,B,x',
  ])('rejects invalid or ambiguous input', (csv) => expect(() => parseRosterCsv(csv)).toThrow());
});
