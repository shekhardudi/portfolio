import { apiFetch } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_AGENTIC_HR_API ?? '/agentic-hr';

export interface ChatRequest {
  session_id: string;
  message: string;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  pending_approvals?: ApprovalItem[];
  tool_calls?: { name: string; arguments: unknown }[];
}

export interface ApprovalItem {
  id: string;
  session_id: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ApprovalDecision {
  id: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

export function chat(req: ChatRequest, signal?: AbortSignal) {
  return apiFetch<ChatResponse>(`${BASE}/chat`, {
    method: 'POST',
    body: JSON.stringify(req),
    signal,
    timeoutMs: 90_000,
  });
}

export function listApprovals(session_id?: string) {
  const url = session_id
    ? `${BASE}/approvals?session_id=${encodeURIComponent(session_id)}`
    : `${BASE}/approvals`;
  return apiFetch<ApprovalItem[]>(url);
}

export function decideApproval(decision: ApprovalDecision) {
  return apiFetch<ApprovalItem>(`${BASE}/approvals`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}
