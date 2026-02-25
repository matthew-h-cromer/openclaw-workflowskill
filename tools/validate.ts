// workflowskill_validate — parse and validate SKILL.md or raw YAML.

import { ParseError, parseSkillMd, parseWorkflowFromMd, validateWorkflow } from 'workflowskill';
import type { ToolAdapter, WorkflowDefinition } from 'workflowskill';

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
  const { content } = params;

  // Parse: try full SKILL.md first, then bare workflow block
  let workflow: WorkflowDefinition;
  let name: string | undefined;

  try {
    const skill = parseSkillMd(content);
    workflow = skill.workflow;
    name = skill.frontmatter.name;
  } catch {
    try {
      workflow = parseWorkflowFromMd(content);
    } catch (err) {
      if (err instanceof ParseError) {
        return {
          valid: false,
          errors: err.details.length > 0
            ? err.details
            : [{ path: 'parse', message: err.message }],
        };
      }
      return {
        valid: false,
        errors: [{ path: 'parse', message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  // Validate with the injected tool adapter so tool availability is checked
  const result = validateWorkflow(workflow, toolAdapter);

  if (!result.valid) {
    return { valid: false, errors: result.errors };
  }

  const stepTypes = [...new Set(workflow.steps.map((s) => s.type))];
  return {
    valid: true,
    errors: [],
    name,
    stepCount: workflow.steps.length,
    stepTypes,
  };
}
