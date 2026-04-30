/**
 * Persona list — mirrors agentic_hr/ui/config.py verbatim.
 * Demo-only; no real auth. The selected persona's email becomes
 * `employee_email` on each /chat request.
 */

export interface Persona {
  full_name: string;
  email: string;
  role: string;
  /** True for personas that can resolve approvals on the manager dashboard. */
  is_manager?: boolean;
  manager_email?: string;
}

export const PERSONAS: Persona[] = [
  { full_name: 'Shekhar Dudi', email: 'shekhar.dudi@demo.local', role: 'Lead AI Engineer', manager_email: 'vanshika.puri@demo.local' },
  { full_name: 'Alexis Johnson', email: 'alexis.johnson@demo.local', role: 'Software Engineer', manager_email: 'vanshika.puri@demo.local' },
  { full_name: 'Erica White', email: 'erica.white@demo.local', role: 'Senior Financial Analyst', manager_email: 'jermy.carpenter@demo.local' },
  { full_name: 'Diana Lopez', email: 'diana.lopez@demo.local', role: 'AI Engineer', manager_email: 'vanshika.puri@demo.local' },
  { full_name: 'Alyssa Flores', email: 'alyssa.flores@demo.local', role: 'UI Engineer', manager_email: 'vanshika.puri@demo.local' },
  { full_name: 'Crystal Campbell', email: 'crystal.campbell@demo.local', role: 'UX Designer', manager_email: 'vanshika.puri@demo.local' },
];

export const MANAGERS: Persona[] = [
  { full_name: 'Vanshika Puri', email: 'vanshika.puri@demo.local', role: 'Engineering Manager', is_manager: true },
  { full_name: 'Jermy Carpenter', email: 'jermy.carpenter@demo.local', role: 'Finance Manager', is_manager: true },
];

export const ALL_PERSONAS: Persona[] = [...PERSONAS, ...MANAGERS];

export const DEFAULT_EMPLOYEE = PERSONAS[0];
export const DEFAULT_MANAGER = MANAGERS[0];
