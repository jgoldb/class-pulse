import { describe, expect, it } from 'vitest';
import { detectPii, redactPii } from './detector';

const kinds = (t: string, opts = {}) => detectPii(t, opts).map((s) => `${s.kind}:${s.confidence}`);

describe('PII detector — adversarial fixtures (docs/05 testing posture)', () => {
  it('finds roster names in any case, as whole words', () => {
    const spans = detectPii('Today marcus johnson left his seat; Marcus was reminded twice.', { denyNames: ['Marcus Johnson'] });
    expect(spans.map((s) => s.text)).toEqual(['marcus johnson', 'Marcus']);
    expect(spans.every((s) => s.confidence === 'high')).toBe(true);
  });
  it('does not flag roster first names that are common words in lowercase', () => {
    expect(detectPii('the student will grace the stage', { denyNames: ['Grace Lee', 'Will Smith'] })).toEqual([]);
  });
  it('ignores denylist entries made only of role words or one-letter parts', () => {
    // A demo account named "Student A" must not turn "gives the student a reason" into a PII hit.
    expect(detectPii('This gives the student a reason to reach the checkpoint.', { denyNames: ['Student A', 'Guardian of Student A', 'Test'] })).toEqual([]);
    expect(detectPii('Spoke with Avery about it.', { denyNames: ['Avery Synthetic'] }).map((s) => s.text)).toEqual(['Avery']);
  });
  it('matches single-word roster entries only when capitalised', () => {
    // The API adds first and last names as separate entries; a surname like "Example" or "Lane" must not match ordinary prose.
    expect(detectPii('Graded work in one setting (for example independent work) in the fast lane.', { denyNames: ['Example', 'Lane', 'Finley Example'] })).toEqual([]);
    expect(detectPii('Sat next to Lane today.', { denyNames: ['Lane'] }).map((s) => s.text)).toEqual(['Lane']);
  });
  it('finds honorifics, "named X" and Two Capitalised Words', () => {
    expect(kinds('Spoke with Mrs. Alvarez about it.')).toEqual(['name:high']);
    expect(kinds('The student named Priya Raman leaves her seat.')).toEqual(['name:high']);
    expect(kinds('Talked to Devon Carter after class.')).toEqual(['name:medium']);
  });
  it('finds ids, dates of birth, emails, phones, addresses and SSNs', () => {
    expect(kinds('Student ID: 4821993')).toEqual(['student_id:high']);
    expect(kinds('DOB 04/12/2013')).toEqual(['dob:high']);
    expect(kinds('born on March 3, 2014')).toEqual(['dob:high']);
    expect(kinds('parent@example.com')).toEqual(['email:high']);
    expect(kinds('call 555-123-4567')).toEqual(['phone:high']);
    expect(kinds('lives at 42 Maple Street')).toEqual(['address:high']);
    expect(kinds('123-45-6789')).toEqual(['ssn:high']);
    expect(kinds('seen on 9/1/2026')).toEqual(['dob:medium']);
    expect(kinds('id 00123456')).toEqual(['student_id:high']);
  });
  it('lets school vocabulary, product names, day names and period numbers through', () => {
    expect(detectPii('On Monday during Period 3 Science the student went to the Google Classroom station and played Minecraft.')).toEqual([]);
    expect(detectPii('The student enjoys Lego and Positive Feedback. Independent Work is hard.')).toEqual([]);
    expect(detectPii('Grade 6. Counted 4, 3, 5 times over 45 minutes.')).toEqual([]);
  });
  it('redacts to neutral placeholders', () => {
    const t = 'Marcus Johnson (ID 4821993) left his seat.';
    const spans = detectPii(t, { denyNames: ['Marcus Johnson'] });
    expect(redactPii(t, spans)).toBe('the student ([student_id]) left his seat.');
  });
});
