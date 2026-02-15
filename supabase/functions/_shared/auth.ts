import { verify } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

export type AgentLevel = 'agent' | 'manager' | 'admin';

export interface AgentPayload {
  sub: string;
  phone: string;
  clientSchema: string;
  level: AgentLevel;
  exp: number;
}

function levelRank(level: AgentLevel): number {
  if (level === 'admin') return 3;
  if (level === 'manager') return 2;
  return 1;
}

export function hasRequiredLevel(
  agent: Pick<AgentPayload, 'level'>,
  required: AgentLevel,
): boolean {
  return levelRank(agent.level) >= levelRank(required);
}

/**
 * Verify agent JWT and return payload
 */
export async function verifyAgent(req: Request): Promise<AgentPayload | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const jwtSecret = Deno.env.get('AGENT_JWT_SECRET') || 'your-secret-key';

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const payload = await verify(token, key) as unknown as AgentPayload;
    return payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
};
