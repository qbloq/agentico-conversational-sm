/**
 * Node.js Adapters for Supabase
 * 
 * Mirror of the Deno adapters in supabase/functions/_shared/adapters/
 * but using Node.js imports for the CLI tool.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { 
  SessionStore, 
  ContactStore, 
  MessageStore, 
  KnowledgeStore, 
  SessionKey, 
  Session, 
  ConversationState,
  Contact,
  Message,
  KnowledgeEntry,
} from '@parallelo/sales-engine';

// Types for ExampleStore (matches engine/types.ts interface)
interface ExampleStoreMessage {
  role: 'customer' | 'agent';
  content: string;
  state: ConversationState;
}

interface ConversationExample {
  id: string;
  exampleId: string;
  scenario: string;
  category: string;
  outcome: string;
  primaryState: ConversationState | null;
  stateFlow: ConversationState[];
  messages: ExampleStoreMessage[];
  notes?: string;
  similarity?: number;
}

interface ExampleStore {
  findByState(
    state: ConversationState,
    options?: { limit?: number; category?: string }
  ): Promise<ConversationExample[]>;
  findSimilar(
    embedding: number[],
    options?: { state?: ConversationState; limit?: number }
  ): Promise<ConversationExample[]>;
}

// ============================================================================
// SESSION STORE
// ============================================================================

interface SessionRow {
  id: string;
  contact_id: string;
  channel_type: string;
  channel_id: string;
  channel_user_id: string;
  current_state: string;
  previous_state: string | null;
  context: Record<string, unknown>;
  status: string;
  is_escalated: boolean;
  escalated_to: string | null;
  escalation_reason: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    contactId: row.contact_id,
    channelType: row.channel_type as Session['channelType'],
    channelId: row.channel_id,
    channelUserId: row.channel_user_id,
    currentState: row.current_state as ConversationState,
    previousState: row.previous_state as ConversationState | undefined,
    context: row.context,
    status: row.status as Session['status'],
    isEscalated: row.is_escalated,
    escalatedTo: row.escalated_to ?? undefined,
    escalationReason: row.escalation_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
  };
}

export function createSupabaseSessionStore(
  supabase: SupabaseClient,
  schemaName: string
): SessionStore {
  // Note: We use .schema() method instead of string interpolation for table name
  // because supabase-js in Node handles schemas differently than Deno/PostgREST direct
  
  return {
    async findByKey(key: SessionKey): Promise<Session | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('sessions')
        .select('*')
        .eq('channel_type', key.channelType)
        .eq('channel_id', key.channelId)
        .eq('channel_user_id', key.channelUserId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async findById(id: string): Promise<Session | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async create(key: SessionKey, contactId: string): Promise<Session> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('sessions')
        .insert({
          contact_id: contactId,
          channel_type: key.channelType,
          channel_id: key.channelId,
          channel_user_id: key.channelUserId,
          current_state: 'initial',
          context: {},
          status: 'active',
          is_escalated: false,
        })
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to create session: ${error?.message}`);
      }
      
      return rowToSession(data as SessionRow);
    },
    
    async update(id: string, updates: Partial<Session>): Promise<Session> {
      const dbUpdates: Record<string, unknown> = {};
      
      if (updates.currentState !== undefined) dbUpdates.current_state = updates.currentState;
      if (updates.previousState !== undefined) dbUpdates.previous_state = updates.previousState;
      if (updates.context !== undefined) dbUpdates.context = updates.context;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.isEscalated !== undefined) dbUpdates.is_escalated = updates.isEscalated;
      if (updates.escalatedTo !== undefined) dbUpdates.escalated_to = updates.escalatedTo;
      if (updates.escalationReason !== undefined) dbUpdates.escalation_reason = updates.escalationReason;
      if (updates.lastMessageAt !== undefined) dbUpdates.last_message_at = updates.lastMessageAt.toISOString();
      
      const { data, error } = await supabase
        .schema(schemaName)
        .from('sessions')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to update session: ${error?.message}`);
      }
      
      return rowToSession(data as SessionRow);
    },
  };
}

// ============================================================================
// CONTACT STORE
// ============================================================================

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  language: string;
  country: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function rowToContact(row: ContactRow): Contact {
  return {
    id: row.id,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    fullName: row.full_name ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    language: row.language,
    country: row.country ?? undefined,
    timezone: row.timezone ?? undefined,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createSupabaseContactStore(
  supabase: SupabaseClient,
  schemaName: string
): ContactStore {
  return {
    async findOrCreateByChannelUser(
      channelType: string,
      channelUserId: string,
      defaults?: Partial<Contact>
    ): Promise<Contact> {
      // 1. Check identity mapping
      const { data: identity } = await supabase
        .schema(schemaName)
        .from('contact_identities')
        .select('contact_id')
        .eq('channel_type', channelType)
        .eq('channel_user_id', channelUserId)
        .single();
      
      if (identity) {
        // Found existing contact
        const { data: contact } = await supabase
          .schema(schemaName)
          .from('contacts')
          .select('*')
          .eq('id', identity.contact_id)
          .single();
        
        if (contact) {
          return rowToContact(contact as ContactRow);
        }
      }
      
      // 2. Create new contact
      const { data: newContact, error: createError } = await supabase
        .schema(schemaName)
        .from('contacts')
        .insert({
          first_name: defaults?.firstName,
          last_name: defaults?.lastName,
          full_name: defaults?.fullName,
          phone: defaults?.phone,
          email: defaults?.email,
          metadata: defaults?.metadata || {},
        })
        .select()
        .single();
      
      if (createError || !newContact) {
        throw new Error(`Failed to create contact: ${createError?.message}`);
      }
      
      // 3. Create identity mapping
      const { error: linkError } = await supabase
        .schema(schemaName)
        .from('contact_identities')
        .insert({
          contact_id: newContact.id,
          channel_type: channelType,
          channel_user_id: channelUserId,
        });
      
      if (linkError) {
        // Rollback contact creation ideally, but for MVP we'll just throw
        throw new Error(`Failed to link contact identity: ${linkError.message}`);
      }
      
      return rowToContact(newContact as ContactRow);
    },
    
    async update(id: string, updates: Partial<Contact>): Promise<Contact> {
      const dbUpdates: Record<string, unknown> = {};
      if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
      if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
      if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.language !== undefined) dbUpdates.language = updates.language;
      if (updates.country !== undefined) dbUpdates.country = updates.country;
      if (updates.timezone !== undefined) dbUpdates.timezone = updates.timezone;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
      
      const { data, error } = await supabase
        .schema(schemaName)
        .from('contacts')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to update contact: ${error?.message}`);
      }
      
      return rowToContact(data as ContactRow);
    },
  };
}

// ============================================================================
// MESSAGE STORE
// ============================================================================

export function createSupabaseMessageStore(
  supabase: SupabaseClient,
  schemaName: string
): MessageStore {
  return {
    async getRecent(sessionId: string, limit: number): Promise<Message[]> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error('Error fetching recent messages:', error);
        return [];
      }
      
      return (data || []).reverse().map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        direction: row.direction as 'inbound' | 'outbound',
        type: row.type as 'text' | 'image' | 'audio' | 'interactive',
        content: row.content,
        createdAt: new Date(row.created_at),
        // Map other fields if needed
      }));
    },
    
    async save(sessionId: string, message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>): Promise<Message> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('messages')
        .insert({
          session_id: sessionId,
          direction: message.direction,
          type: message.type,
          content: message.content,
          created_at: new Date().toISOString(),
          // Map other fields
        })
        .select()
        .single();
        
      if (error || !data) {
        console.error('Error saving message:', error);
        throw error || new Error('Failed to save message');
      }
      
      return {
        id: data.id,
        sessionId: data.session_id,
        direction: data.direction as 'inbound' | 'outbound',
        type: data.type as 'text' | 'image' | 'audio' | 'interactive',
        content: data.content,
        createdAt: new Date(data.created_at),
        // Map other fields if needed
      };
    },
  };
}

// ============================================================================
// KNOWLEDGE STORE
// ============================================================================

export function createSupabaseKnowledgeStore(
  supabase: SupabaseClient,
  schemaName: string
): KnowledgeStore {
  return {
    async findSimilar(embedding: number[], limit: number): Promise<KnowledgeEntry[]> {
      // Use the RPC function we created
      
      // Debug embedding
      // console.log('Vector search :: dev', { 
      //   schema: schemaName, 
      //   embeddingType: typeof embedding,
      //   isArray: Array.isArray(embedding),
      //   limit 
      // });

      // Explicitly cast embedding to string if needed by PostgREST
      // But usually array works. Let's verify args order.
      const { data, error } = await supabase.rpc('match_knowledge', {
        schema_name: schemaName,
        query_embedding: embedding,
        match_count: limit,
      });
      
      if (error) {
        console.error('Error searching knowledge base:', error);
        return [];
      }
      
      // console.log('Vector search results:', data.length);
      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        answer: row.answer,
        url: row.url,
        category: row.category,
        semanticTags: row.semantic_tags || [],
        summary: row.summary,
        similarity: row.similarity,
      }));
    },

    async findByCategory(category: string, limit: number): Promise<KnowledgeEntry[]> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('knowledge_base')
        .select('*')
        .eq('category', category)
        .eq('is_active', true)
        .limit(limit);
      
      if (error) {
        console.error('Error fetching by category:', error);
        return [];
      }
      
      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        answer: row.answer,
        url: row.url,
        category: row.category,
        semanticTags: row.semantic_tags || [],
        summary: row.summary,
      }));
    },

    async findByTags(tags: string[], limit: number): Promise<KnowledgeEntry[]> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('knowledge_base')
        .select('*')
        .contains('semantic_tags', tags)
        .eq('is_active', true)
        .limit(limit);
      
      if (error) {
        console.error('Error fetching by tags:', error);
        return [];
      }
      
      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        answer: row.answer,
        url: row.url,
        category: row.category,
        semanticTags: row.semantic_tags || [],
        summary: row.summary,
      }));
    },
  };
}

// ============================================================================
// EXAMPLE STORE (for few-shot prompting)
// ============================================================================

interface ExampleRow {
  id: string;
  example_id: string;
  scenario: string;
  category: string;
  outcome: string;
  primary_state: string | null;
  state_flow: string[] | null;
  messages: Array<{ role: string; content: string; state?: string }>;
  notes: string | null;
  similarity?: number;
}

function rowToExample(row: ExampleRow): ConversationExample {
  return {
    id: row.id,
    exampleId: row.example_id,
    scenario: row.scenario,
    category: row.category,
    outcome: row.outcome,
    primaryState: row.primary_state as ConversationState | null,
    stateFlow: (row.state_flow || []) as ConversationState[],
    messages: row.messages.map(m => ({
      role: m.role as 'customer' | 'agent',
      content: m.content,
      state: (m.state || 'initial') as ConversationState,
    })),
    notes: row.notes || undefined,
    similarity: row.similarity,
  };
}

export function createSupabaseExampleStore(
  supabase: SupabaseClient
): ExampleStore {
  // Note: Examples are in the public schema (shared across clients)
  return {
    async findByState(
      state: ConversationState,
      options: { limit?: number; category?: string } = {}
    ): Promise<ConversationExample[]> {
      const { limit = 5, category } = options;

      let query = supabase
        .from('conversation_examples')
        .select('id, example_id, scenario, category, outcome, primary_state, state_flow, messages, notes')
        .eq('primary_state', state)
        .eq('is_active', true);

      if (category) {
        query = query.eq('category', category);
      }

      const { data, error } = await query.limit(limit);

      if (error) {
        console.error('Error fetching examples by state:', error);
        return [];
      }

      return (data || []).map(rowToExample);
    },

    async findSimilar(
      embedding: number[],
      options: { state?: ConversationState; limit?: number } = {}
    ): Promise<ConversationExample[]> {
      const { state, limit = 5 } = options;

      // Use the RPC function from the migration
      const { data, error } = await supabase.rpc('search_conversation_examples', {
        p_state: state || null,
        p_category: null,
        p_embedding: embedding,
        p_limit: limit,
      });

      if (error) {
        console.error('Error fetching similar examples:', error);
        return [];
      }

      return (data || []).map(rowToExample);
    },
  };
}
