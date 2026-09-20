import { formatDetectionReport, runDetectionEvals } from './runner';

const report = runDetectionEvals();
console.log(formatDetectionReport(report));
process.exit(report.passed ? 0 : 1);
