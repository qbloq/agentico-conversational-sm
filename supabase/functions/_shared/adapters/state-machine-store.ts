
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { StateMachineStore, ConversationState, StateConfig } from '@parallelo/sales-engine';

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
    async findByName(name: string, version?: string): Promise<Record<ConversationState, StateConfig> | null> {
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

      return (data as StateMachineRow).states;
    },

    async findActive(name: string): Promise<Record<ConversationState, StateConfig> | null> {
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

      return (data as StateMachineRow).states;
    }
  };
}
