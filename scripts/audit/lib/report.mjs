// Console reporting. Every check prints its own numbers as it finishes, and
// the summary at the end restates pass/fail per check — never "all green"
// on its own.
//
// A check result is normally { passed: boolean }. A check may also set
// `inconclusive: true` alongside `passed: true` — this means the check
// could not be measured honestly (e.g. frame-cost's control baseline
// itself can't hit the environment's own ceiling), so it does not fail the
// run, but must not be reported as an ordinary silent PASS either: someone
// reading output should be able to tell "fine", "fine but unmeasurable
// here", and "regressed" apart at a glance.

function statusLabel(result) {
  if (result.inconclusive) return 'INCONCLUSIVE';
  return result.passed ? 'PASS' : 'FAIL';
}

export function printCheckResult(result) {
  console.log(`\n[${statusLabel(result)}] ${result.name}`);
  for (const line of result.lines) {
    console.log(`  ${line}`);
  }
}

export function printSummary(results) {
  const bar = '='.repeat(64);
  console.log(`\n${bar}`);
  console.log('AUDIT SUMMARY');
  console.log(bar);
  for (const r of results) {
    console.log(`  [${statusLabel(r)}] ${r.name}`);
  }
  const failed = results.filter((r) => !r.passed);
  const inconclusive = results.filter((r) => r.passed && r.inconclusive);
  console.log(bar);
  if (failed.length === 0 && inconclusive.length === 0) {
    console.log(`All ${results.length} checks passed.`);
  } else {
    const parts = [];
    if (failed.length > 0) {
      parts.push(`${failed.length} FAILED: ${failed.map((r) => r.name).join(', ')}`);
    }
    if (inconclusive.length > 0) {
      parts.push(`${inconclusive.length} INCONCLUSIVE (not a failure): ${inconclusive.map((r) => r.name).join(', ')}`);
    }
    console.log(`${results.length} check(s) run — ${parts.join('; ')}`);
  }
  return failed.length === 0 ? 0 : 1;
}
