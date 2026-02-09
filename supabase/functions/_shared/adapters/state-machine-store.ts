
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { StateMachineStore, ConversationState, StateConfig, StateEntryMessageConfig, BotResponse, FollowupRegistryConfig, FollowupVariableConfig } from '@parallelo/sales-engine';

interface StateMachineRow {
  id: string;
  name: string;
  version: string;
  initial_state: string;
  states: Record<string, StateConfig>;
  is_active: boolean;
}

export function createSupabaseStateMachineStore(
  supabase: SupabaseClient,
  schemaName: string
): StateMachineStore {
  const table = 'state_machines';

  return {
    async findByName(name: string, version?: string): Promise<{ states: Record<string, StateConfig>, initialState: string } | null> {
      let query = supabase
        .schema(schemaName)
        .from(table)
        .select('*')
        .eq('name', name);
      
      if (version) {
        query = query.eq('version', version);
      } else {
        query = query.eq('is_active', true);
      }
      
      const { data, error } = await query.maybeSingle();
      
      if (error) {
        console.error('Error fetching state machine:', error);
        return null;
      }
      
      if (!data) {
        return null;
      }
      
      const row = data as StateMachineRow;
      return {
        states: row.states,
        initialState: row.initial_state
      };
    },

    async findActive(name: string): Promise<{ states: Record<string, StateConfig>, initialState: string } | null> {
      console.log('Fetching active state machine:', name);
      console.log('Schema name:', schemaName);
      console.log('Table name:', table);
       const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .select('*')
        .eq('name', name)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching active state machine:', error);
        return null;
      }
      
      if (!data) {
        return null;
      }

      const row = data as StateMachineRow;
      return {
        states: row.states,
        initialState: row.initial_state
      };
    },

    async getStateMachineId(name: string): Promise<string | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(table)
        .select('id')
        .eq('name', name)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Error fetching state machine ID:', error);
        return null;
      }
      
      if (!data) {
        return null;
      }

      return data.id;
    },

    async getStateEntryMessages(
      stateMachineId: string,
      state: ConversationState
    ): Promise<StateEntryMessageConfig | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('state_entry_messages')
        .select('*')
        .eq('state_machine_id', stateMachineId)
        .eq('state', state)
        .eq('is_active', true)
        .maybeSingle();
        
      if (error) {
        console.error('Error fetching state entry messages:', error);
        return null;
      }
      
      if (!data) {
        return null;
      }
      
      const config: StateEntryMessageConfig = {
        id: data.id,
        state: data.state as ConversationState,
        responses: data.responses as BotResponse[],
        description: data.description
      };
      
      if (data.session_updates) {
        config.sessionUpdates = data.session_updates;
      }
      
      return config;
    },

    async getFollowupConfig(name: string): Promise<FollowupRegistryConfig | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from('followup_configs')
        .select('*')
        .eq('name', name)
        .maybeSingle();

      if (error) {
        console.error('Error fetching follow-up config:', error);
        return null;
      }

      if (!data) {
        return null;
      }

      return {
        name: data.name,
        type: data.type as 'text' | 'template',
        content: data.content,
        variablesConfig: (data.variables_config as any[])?.map(v => ({
          key: v.key,
          type: v.type as 'literal' | 'llm' | 'context',
          value: v.value,
          prompt: v.prompt,
          field: v.field
        })) || []
      };
    }
  };
}
