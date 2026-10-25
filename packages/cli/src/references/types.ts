/**
 * Closed list of reasons a reference target cannot be evaluated against the
 * repository. Each one is recorded as evidence; none is treated as a defect.
 */
export type NotEvaluableReason =
  | 'external-resource'
  | 'variable-dependent'
  | 'execution-dependent'
  | 'root-escape-attempt'
  | 'incomplete-scan'
  | 'inaccessible-local-target';
