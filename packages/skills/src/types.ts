export interface SkillInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

export type SkillPermission = 'filesystem' | 'network' | 'shell' | 'env';
export type SkillSource = 'bundled' | 'generated' | 'user';

export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  filePath: string;
  inputSchema: SkillInputSchema;
  permissions: SkillPermission[];
  enabled: boolean;
  requiresApproval?: boolean;
}

export interface SkillMetadata {
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsed?: string;
}

export interface RegisteredSkill {
  definition: SkillDefinition;
  metadata: SkillMetadata;
}

export interface SkillInput {
  [key: string]: unknown;
}

export interface SkillOutput {
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface RegistryFile {
  skills: Array<RegisteredSkill>;
}
