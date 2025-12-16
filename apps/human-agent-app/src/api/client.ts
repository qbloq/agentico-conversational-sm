/**
 * API Client for Human Agent App
 * 
 * Handles all communication with Edge Functions
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://your-project.supabase.co/functions/v1';

/**
 * Get stored auth token
 */
function getToken(): string | null {
  return localStorage.getItem('agent_token');
}

/**
 * Make authenticated request
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// =============================================================================
// Auth API
// =============================================================================

export interface RequestOtpResponse {
  success: boolean;
  message: string;
  isFirstLogin: boolean;
}

export interface VerifyOtpResponse {
  success: boolean;
  token: string;
  agent: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  isFirstLogin: boolean;
}

export async function requestOtp(phone: string, clientSchema: string): Promise<RequestOtpResponse> {
  return request('/agent-auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, clientSchema }),
  });
}

export async function verifyOtp(
  phone: string,
  otp: string,
  clientSchema: string
): Promise<VerifyOtpResponse> {
  return request('/agent-auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, otp, clientSchema }),
  });
}

export async function completeProfile(
  firstName: string,
  lastName?: string,
  email?: string
): Promise<{ success: boolean }> {
  return request('/agent-auth/complete-profile', {
    method: 'POST',
    body: JSON.stringify({ firstName, lastName, email }),
  });
}

// =============================================================================
// Escalations API
// =============================================================================

export interface Escalation {
  id: string;
  reason: string;
  ai_summary: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
  created_at: string;
  assigned_to: string | null;
  assigned_at: string | null;
  session: {
    id: string;
    channel_user_id: string;
    current_state: string;
    context?: Record<string, unknown>;
    contact: {
      full_name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
  };
}

export interface Message {
  id: string;
  session_id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  created_at: string;
  sent_by_agent_id?: string | null; // FK to human_agents - indicates message sent by human agent
}

export interface EscalationDetail extends Escalation {
  session: Escalation['session'] & {
    channel_type: string;
    channel_id: string;
    contact: {
      id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      country: string | null;
      language: string | null;
    } | null;
  };
  assigned_agent?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
}

export async function listEscalations(): Promise<{ escalations: Escalation[] }> {
  return request('/manage-escalations/escalations');
}

export async function getEscalation(id: string): Promise<{
  escalation: EscalationDetail;
  messages: Message[];
}> {
  return request(`/manage-escalations/escalations/${id}`);
}

export async function assignEscalation(id: string): Promise<{ success: boolean }> {
  return request(`/manage-escalations/escalations/${id}/assign`, {
    method: 'PATCH',
  });
}

export async function resolveEscalation(
  id: string,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/manage-escalations/escalations/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

// =============================================================================
// Messaging API
// =============================================================================

export async function sendMessage(
  escalationId: string,
  message: string
): Promise<{ success: boolean; messageId: string }> {
  return request('/send-human-message', {
    method: 'POST',
    body: JSON.stringify({ escalationId, message }),
  });
}
