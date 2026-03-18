export type UserRole = 'admin' | 'chat' | 'system';

export interface User {
  name: string;
  role: UserRole;
  platformIds: Record<string, string>;
}
