import { apiFetch } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_AGENTIC_HR_API ?? '/agentic-hr';

export interface ChatRequest {
  session_id: string;
  message: string;
  employee_email?: string;
}

export interface Citation {
  document: string;
  section?: string;
}

export type ChatStatus = 'complete' | 'pending_approval' | 'needs_clarification' | string;

export interface ChatResponse {
  session_id: string;
  reply: string;
  status?: ChatStatus;
  request_id?: string | null;
  citations: Citation[];
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

interface BackendChatResponse {
  response: string;
  status?: ChatStatus;
  request_id?: string | null;
  citations?: Citation[];
}

interface BackendPendingApproval {
  request_id: string;
  requester_email: string;
  requester_name?: string;
  packages: string[];
  status: string;
  created_ts: string;
}

function mapStatus(status: string): ApprovalItem['status'] {
  if (status === 'approved') return 'approved';
  if (status === 'denied' || status === 'rejected') return 'rejected';
  return 'pending';
}

function mapPendingApproval(item: BackendPendingApproval): ApprovalItem {
  return {
    id: item.request_id,
    session_id: '',
    tool: item.packages.join(', ') || 'access_request',
    arguments: {
      requester_email: item.requester_email,
      requester_name: item.requester_name ?? '',
      packages: item.packages,
    },
    status: mapStatus(item.status),
    created_at: item.created_ts,
  };
}

export function chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return apiFetch<BackendChatResponse>(`${BASE}/chat`, {
    method: 'POST',
    body: JSON.stringify({
      session_id: req.session_id,
      message: req.message,
      employee_email: req.employee_email ?? 'demo@example.com',
    }),
    signal,
    timeoutMs: 90_000,
  }).then((res) => ({
    session_id: req.session_id,
    reply: res.response,
    status: res.status,
    request_id: res.request_id ?? null,
    citations: res.citations ?? [],
    pending_approvals: [],
    tool_calls: [],
  }));
}

/**
 * Best-effort cancel for an in-flight chat. Frees the LangGraph worker slot
 * in real time. Errors are swallowed by the caller — the version guard on
 * the response side already protects the UI from late replies.
 */
export async function cancelChat(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await apiFetch<unknown>(`${BASE}/chat/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      timeoutMs: 10_000,
    });
  } catch {
    /* best-effort */
  }
}

export function listApprovals(session_id?: string) {
  void session_id;
  return apiFetch<BackendPendingApproval[]>(`${BASE}/approvals`).then((items) =>
    items.map(mapPendingApproval),
  );
}

export function decideApproval(
  decision: ApprovalDecision,
  approverEmail: string,
) {
  return apiFetch<{ request_id: string; status: string }>(
    `${BASE}/approvals/${encodeURIComponent(decision.id)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: decision.decision === 'approve' ? 'approved' : 'denied',
        approver_email: approverEmail,
        reason: decision.reason,
      }),
    },
  ).then((res) => ({
    id: res.request_id,
    session_id: '',
    tool: 'access_request',
    arguments: {},
    status: mapStatus(res.status),
    created_at: new Date().toISOString(),
  }));
}
