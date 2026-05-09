/**
 * Integration tile metadata — links target the live UIs for each service.
 * Build-time env vars (NEXT_PUBLIC_*) supply the absolute URL in production.
 * Defaults fall back to same-origin subpaths so production deployments without
 * the env vars still route through the host nginx (never localhost).
 */

const NOCO_URL = process.env.NEXT_PUBLIC_NOCO_URL || '/nocodb/';
const GITEA_URL = process.env.NEXT_PUBLIC_GITEA_URL || '/gitea/';
const MATTERMOST_URL = process.env.NEXT_PUBLIC_MATTERMOST_URL || '/mattermost/';

export interface Integration {
  name: string;
  icon: string;
  /** Short role label shown beneath the name in the chip (e.g. "HRIS"). */
  role: string;
  category: string;
  description: string;
  url: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    name: 'NocoDB',
    icon: '🗄️',
    role: 'HRIS',
    category: 'HR Data Platform',
    description: 'No-code database powering employee records & leave tracking.',
    url: NOCO_URL,
  },
  {
    name: 'Gitea',
    icon: '🔀',
    role: 'Source control',
    category: 'Version Control',
    description: 'Git service hosting policy docs & HR workflow configs.',
    url: GITEA_URL,
  },
  {
    name: 'Mattermost',
    icon: '💬',
    role: 'Team chat',
    category: 'Team Collaboration',
    description: 'Messaging hub for approvals, notifications & team comms.',
    url: MATTERMOST_URL,
  },
];
