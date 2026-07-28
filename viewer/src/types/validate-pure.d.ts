declare module '../../../scripts/validate-pure.mjs' {
  export interface ValidationResult {
    valid: boolean;
    errors: string[];
  }
  export function createValidator(schema: object): (doc: unknown) => ValidationResult;
}
