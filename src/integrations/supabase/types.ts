export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      email_search_cache: {
        Row: {
          account_email: string
          account_key: string
          attachment_names: string[]
          body_text: string
          cc_addresses: Json
          flags: string[]
          folder_id: string
          from_email: string
          from_name: string
          has_attachments: boolean
          id: number
          imap_host: string
          in_reply_to: string
          message_id: string
          search_document: unknown
          sent_at: string
          snippet: string
          subject: string
          to_addresses: Json
          uid: number
          updated_at: string
        }
        Insert: {
          account_email: string
          account_key: string
          attachment_names?: string[]
          body_text?: string
          cc_addresses?: Json
          flags?: string[]
          folder_id: string
          from_email?: string
          from_name?: string
          has_attachments?: boolean
          id?: number
          imap_host: string
          in_reply_to?: string
          message_id?: string
          search_document?: unknown
          sent_at?: string
          snippet?: string
          subject?: string
          to_addresses?: Json
          uid: number
          updated_at?: string
        }
        Update: {
          account_email?: string
          account_key?: string
          attachment_names?: string[]
          body_text?: string
          cc_addresses?: Json
          flags?: string[]
          folder_id?: string
          from_email?: string
          from_name?: string
          has_attachments?: boolean
          id?: number
          imap_host?: string
          in_reply_to?: string
          message_id?: string
          search_document?: unknown
          sent_at?: string
          snippet?: string
          subject?: string
          to_addresses?: Json
          uid?: number
          updated_at?: string
        }
        Relationships: []
      }
      mail_sync_state: {
        Row: {
          account_key: string
          created_at: string
          folder_id: string
          full_sync_done: boolean
          id: number
          last_sync_at: string
          last_synced_uid: number
          total_messages: number
        }
        Insert: {
          account_key: string
          created_at?: string
          folder_id: string
          full_sync_done?: boolean
          id?: never
          last_sync_at?: string
          last_synced_uid?: number
          total_messages?: number
        }
        Update: {
          account_key?: string
          created_at?: string
          folder_id?: string
          full_sync_done?: boolean
          id?: never
          last_sync_at?: string
          last_synced_uid?: number
          total_messages?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      count_cached_emails: {
        Args: { p_account_key: string; p_folder_id: string }
        Returns: number
      }
      email_search_cache_document: {
        Args: {
          p_attachment_names: string[]
          p_cc_addresses: Json
          p_from_email: string
          p_from_name: string
          p_snippet: string
          p_subject: string
          p_to_addresses: Json
        }
        Returns: unknown
      }
      email_search_cache_document_v2: {
        Args: {
          p_attachment_names: string[]
          p_body_text: string
          p_cc_addresses: Json
          p_from_email: string
          p_from_name: string
          p_snippet: string
          p_subject: string
          p_to_addresses: Json
        }
        Returns: unknown
      }
      get_sync_state: {
        Args: { p_account_key: string; p_folder_id: string }
        Returns: {
          full_sync_done: boolean
          last_sync_at: string
          last_synced_uid: number
          total_messages: number
        }[]
      }
      list_cached_emails: {
        Args: {
          p_account_key: string
          p_folder_id: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          attachment_names: string[]
          cc_addresses: Json
          flags: string[]
          from_email: string
          from_name: string
          has_attachments: boolean
          in_reply_to: string
          message_id: string
          sent_at: string
          snippet: string
          subject: string
          to_addresses: Json
          uid: number
        }[]
      }
      search_email_search_cache: {
        Args: {
          p_account_key: string
          p_folder_id: string
          p_limit?: number
          p_offset?: number
          p_query: string
        }
        Returns: {
          uid: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
