export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alarms: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          repeat_days: number[]
          time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          repeat_days?: number[]
          time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          repeat_days?: number[]
          time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alarms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_events: {
        Row: {
          confidence: number | null
          device_id: string
          duration_ms: number
          event_type: string
          id: number
          session_id: string
          timestamp: string
        }
        Insert: {
          confidence?: number | null
          device_id: string
          duration_ms: number
          event_type: string
          id?: never
          session_id: string
          timestamp: string
        }
        Update: {
          confidence?: number | null
          device_id?: string
          duration_ms?: number
          event_type?: string
          id?: never
          session_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      breathing_readings: {
        Row: {
          breaths_per_min: number
          device_id: string
          id: number
          session_id: string
          signal_source: string
          timestamp: string
        }
        Insert: {
          breaths_per_min: number
          device_id: string
          id?: never
          session_id: string
          signal_source: string
          timestamp: string
        }
        Update: {
          breaths_per_min?: number
          device_id?: string
          id?: never
          session_id?: string
          signal_source?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "breathing_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breathing_readings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_events: {
        Row: {
          egg_device_id: string
          event_type: string
          id: number
          session_id: string | null
          timestamp: string
        }
        Insert: {
          egg_device_id: string
          event_type: string
          id?: never
          session_id?: string | null
          timestamp: string
        }
        Update: {
          egg_device_id?: string
          event_type?: string
          id?: never
          session_id?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_events_egg_device_id_fkey"
            columns: ["egg_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          audio_url: string | null
          chat_session_id: string
          content: string
          created_at: string
          id: number
          role: string
        }
        Insert: {
          audio_url?: string | null
          chat_session_id: string
          content: string
          created_at?: string
          id?: never
          role: string
        }
        Update: {
          audio_url?: string | null
          chat_session_id?: string
          content?: string
          created_at?: string
          id?: never
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_session_id_fkey"
            columns: ["chat_session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          ended_at: string | null
          id: string
          sleep_session_id: string | null
          started_at: string
          trigger: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          sleep_session_id?: string | null
          started_at?: string
          trigger: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          sleep_session_id?: string | null
          started_at?: string
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_sleep_session_id_fkey"
            columns: ["sleep_session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          device_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          device_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          device_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          battery_level: number | null
          firmware_version: string
          id: string
          last_seen: string | null
          mac_address: string
          paired_at: string
          status: Json | null
          type: string
          user_id: string
        }
        Insert: {
          battery_level?: number | null
          firmware_version?: string
          id?: string
          last_seen?: string | null
          mac_address: string
          paired_at?: string
          status?: Json | null
          type: string
          user_id: string
        }
        Update: {
          battery_level?: number | null
          firmware_version?: string
          id?: string
          last_seen?: string | null
          mac_address?: string
          paired_at?: string
          status?: Json | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_readings: {
        Row: {
          device_id: string
          humidity_pct: number | null
          id: number
          illuminance_lux: number | null
          session_id: string
          temperature_c: number | null
          timestamp: string
        }
        Insert: {
          device_id: string
          humidity_pct?: number | null
          id?: never
          illuminance_lux?: number | null
          session_id: string
          temperature_c?: number | null
          timestamp: string
        }
        Update: {
          device_id?: string
          humidity_pct?: number | null
          id?: never
          illuminance_lux?: number | null
          session_id?: string
          temperature_c?: number | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "environment_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environment_readings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      motion_events: {
        Row: {
          detection_source: string
          device_id: string
          id: number
          intensity: number | null
          session_id: string
          timestamp: string
        }
        Insert: {
          detection_source: string
          device_id: string
          id?: never
          intensity?: number | null
          session_id: string
          timestamp: string
        }
        Update: {
          detection_source?: string
          device_id?: string
          id?: never
          intensity?: number | null
          session_id?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "motion_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "motion_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          character_voice: string
          evening_suggestion: boolean
          id: string
          morning_score: boolean
          user_id: string
        }
        Insert: {
          character_voice?: string
          evening_suggestion?: boolean
          id?: string
          morning_score?: boolean
          user_id: string
        }
        Update: {
          character_voice?: string
          evening_suggestion?: boolean
          id?: string
          morning_score?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      presence_events: {
        Row: {
          device_id: string
          id: number
          session_id: string
          state: string
          timestamp: string
        }
        Insert: {
          device_id: string
          id?: never
          session_id: string
          state: string
          timestamp: string
        }
        Update: {
          device_id?: string
          id?: never
          session_id?: string
          state?: string
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "presence_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presence_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sleep_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_recommendations: {
        Row: {
          first_event_start: string | null
          first_event_title: string | null
          generated_at: string
          id: string
          reasoning: string | null
          recommended_bedtime: string
          recommended_wake_time: string | null
          required_sleep_minutes: number
          target_date: string
          user_id: string
        }
        Insert: {
          first_event_start?: string | null
          first_event_title?: string | null
          generated_at?: string
          id?: string
          reasoning?: string | null
          recommended_bedtime: string
          recommended_wake_time?: string | null
          required_sleep_minutes: number
          target_date: string
          user_id: string
        }
        Update: {
          first_event_start?: string | null
          first_event_title?: string | null
          generated_at?: string
          id?: string
          reasoning?: string | null
          recommended_bedtime?: string
          recommended_wake_time?: string | null
          required_sleep_minutes?: number
          target_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_recommendations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sleep_sessions: {
        Row: {
          actual_wake_time: string | null
          chicken_device_id: string | null
          egg_device_id: string | null
          end_time: string | null
          id: string
          planned_wake_time: string
          score: number | null
          score_details: Json | null
          start_time: string
          status: string
          user_id: string
        }
        Insert: {
          actual_wake_time?: string | null
          chicken_device_id?: string | null
          egg_device_id?: string | null
          end_time?: string | null
          id?: string
          planned_wake_time: string
          score?: number | null
          score_details?: Json | null
          start_time: string
          status?: string
          user_id: string
        }
        Update: {
          actual_wake_time?: string | null
          chicken_device_id?: string | null
          egg_device_id?: string | null
          end_time?: string | null
          id?: string
          planned_wake_time?: string
          score?: number | null
          score_details?: Json | null
          start_time?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sleep_sessions_chicken_device_id_fkey"
            columns: ["chicken_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sleep_sessions_egg_device_id_fkey"
            columns: ["egg_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sleep_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      next_alarm_at: {
        Args: { p_from?: string; p_user_id: string }
        Returns: {
          alarm_id: string
          ring_at: string
        }[]
      }
      register_device: {
        Args: {
          p_firmware_version?: string
          p_mac_address: string
          p_type: string
        }
        Returns: {
          device_id: string
          device_token: string
        }[]
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

