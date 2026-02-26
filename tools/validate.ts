// workflowskill_validate — parse and validate SKILL.md or raw YAML.

import { validateWorkflowSkill } from 'workflowskill';
import type { ToolAdapter } from 'workflowskill';

export interface ValidateParams {
  content: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  name?: string;
  stepCount?: number;
  stepTypes?: string[];
}

export async function validateHandler(params: ValidateParams, toolAdapter: ToolAdapter): Promise<ValidateResult> {
  return validateWorkflowSkill({ content: params.content, toolAdapter });
}
