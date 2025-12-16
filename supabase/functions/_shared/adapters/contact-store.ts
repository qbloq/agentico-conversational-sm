/**
 * Supabase Contact Store Adapter
 * 
 * Implements ContactStore interface for Supabase.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Contact, ContactStore, ChannelType } from '@parallelo/sales-engine';

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
  has_registered: boolean;
  deposit_confirmed: boolean;
  lifetime_value: number;
  utm_source: string | null;
  utm_campaign: string | null;
  referral_code: string | null;
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
    hasRegistered: row.has_registered,
    depositConfirmed: row.deposit_confirmed,
    lifetimeValue: row.lifetime_value,
    utmSource: row.utm_source ?? undefined,
    utmCampaign: row.utm_campaign ?? undefined,
    referralCode: row.referral_code ?? undefined,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createSupabaseContactStore(
  supabase: SupabaseClient,
  schemaName: string
): ContactStore {
  const contactsTable = `contacts`;
  const identitiesTable = `contact_identities`;
  
  return {
    async findOrCreateByChannelUser(
      channelType: ChannelType,
      channelUserId: string
    ): Promise<Contact> {
      // 1. Check if identity exists
      const { data: identity } = await supabase
        .schema(schemaName)
        .from(identitiesTable)
        .select('contact_id')
        .eq('channel_type', channelType)
        .eq('channel_user_id', channelUserId)
        .single();
      
      if (identity) {
        // 2a. Identity exists - get the contact
        const { data: contact, error } = await supabase
          .schema(schemaName)
          .from(contactsTable)
          .select('*')
          .eq('id', identity.contact_id)
          .single();
        
        if (error || !contact) {
          throw new Error(`Contact not found for identity: ${identity.contact_id}`);
        }
        
        // Update last_seen_at
        await supabase
          .schema(schemaName)
          .from(identitiesTable)
          .update({ last_seen_at: new Date().toISOString() })
          .eq('channel_type', channelType)
          .eq('channel_user_id', channelUserId);
        
        return rowToContact(contact as ContactRow);
      }
      
      // 2b. Identity doesn't exist - create new contact + identity
      const { data: newContact, error: contactError } = await supabase
        .schema(schemaName)
        .from(contactsTable)
        .insert({})
        .select()
        .single();
      
      if (contactError || !newContact) {
        throw new Error(`Failed to create contact: ${contactError?.message}`);
      }
      
      // Create identity mapping
      const { error: identityError } = await supabase
        .schema(schemaName)
        .from(identitiesTable)
        .insert({
          contact_id: newContact.id,
          channel_type: channelType,
          channel_user_id: channelUserId,
        });
      
      if (identityError) {
        throw new Error(`Failed to create identity: ${identityError.message}`);
      }
      
      return rowToContact(newContact as ContactRow);
    },
    
    async findById(id: string): Promise<Contact | null> {
      const { data, error } = await supabase
        .schema(schemaName)
        .from(contactsTable)
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      return rowToContact(data as ContactRow);
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
      if (updates.hasRegistered !== undefined) dbUpdates.has_registered = updates.hasRegistered;
      if (updates.depositConfirmed !== undefined) dbUpdates.deposit_confirmed = updates.depositConfirmed;
      if (updates.lifetimeValue !== undefined) dbUpdates.lifetime_value = updates.lifetimeValue;
      if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;
      
      const { data, error } = await supabase
        .schema(schemaName)
        .from(contactsTable)
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();
      
      if (error || !data) {
        throw new Error(`Failed to update contact: ${error?.message}`);
      }
      
      return rowToContact(data as ContactRow);
    },

    async delete(id: string): Promise<void> {
      // Get all sessions for this contact (needed for cascade)
      const { data: sessions } = await supabase
        .schema(schemaName)
        .from('sessions')
        .select('id')
        .eq('contact_id', id);
      
      const sessionIds = sessions?.map(s => s.id) || [];
      
      if (sessionIds.length > 0) {
        // 1. Delete escalations (FK to sessions)
        await supabase
          .schema(schemaName)
          .from('escalations')
          .delete()
          .in('session_id', sessionIds);
        
        // 2. Delete messages (FK to sessions)
        await supabase
          .schema(schemaName)
          .from('messages')
          .delete()
          .in('session_id', sessionIds);
        
        // 3. Delete pending_messages (FK to sessions via hash)
        // This is based on session_key_hash, skip if doesn't exist
        
        // 4. Delete sessions
        await supabase
          .schema(schemaName)
          .from('sessions')
          .delete()
          .eq('contact_id', id);
      }
      
      // 5. Delete contact identities
      await supabase
        .schema(schemaName)
        .from('contact_identities')
        .delete()
        .eq('contact_id', id);
      
      // 6. Finally delete the contact
      const { error } = await supabase
        .schema(schemaName)
        .from(contactsTable)
        .delete()
        .eq('id', id);
      
      if (error) {
        throw new Error(`Failed to delete contact: ${error.message}`);
      }
    },
  };
}
