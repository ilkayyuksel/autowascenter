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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      blocked_periods: {
        Row: {
          created_at: string
          end_date: string
          end_time: string | null
          id: string
          reason: string | null
          start_date: string
          start_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          end_time?: string | null
          id?: string
          reason?: string | null
          start_date: string
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          end_time?: string | null
          id?: string
          reason?: string | null
          start_date?: string
          start_time?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      booking_services: {
        Row: {
          booking_id: string
          created_at: string
          duration_minutes: number
          id: string
          price: number
          service_id: string | null
          service_title: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          duration_minutes?: number
          id?: string
          price?: number
          service_id?: string | null
          service_title: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          price?: number
          service_id?: string | null
          service_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_services_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          cancel_token: string
          cancelled_at: string | null
          company_name: string | null
          created_at: string
          customer_email: string
          customer_name: string
          customer_phone: string
          end_time: string | null
          id: string
          location_address: string | null
          location_distance_km: number | null
          location_fee: number
          location_in_sint_niklaas: boolean | null
          notes: string | null
          on_location: boolean
          preferred_date: string
          preferred_time: string
          service_id: string | null
          service_title: string | null
          status: Database["public"]["Enums"]["booking_status"]
          total_duration_minutes: number
          total_price: number
          updated_at: string
          vat_number: string | null
          vehicle_brand: string | null
          vehicle_info: string | null
          vehicle_model: string | null
          vehicle_type_id: string | null
        }
        Insert: {
          cancel_token?: string
          cancelled_at?: string | null
          company_name?: string | null
          created_at?: string
          customer_email: string
          customer_name: string
          customer_phone: string
          end_time?: string | null
          id?: string
          location_address?: string | null
          location_distance_km?: number | null
          location_fee?: number
          location_in_sint_niklaas?: boolean | null
          notes?: string | null
          on_location?: boolean
          preferred_date: string
          preferred_time: string
          service_id?: string | null
          service_title?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_duration_minutes?: number
          total_price?: number
          updated_at?: string
          vat_number?: string | null
          vehicle_brand?: string | null
          vehicle_info?: string | null
          vehicle_model?: string | null
          vehicle_type_id?: string | null
        }
        Update: {
          cancel_token?: string
          cancelled_at?: string | null
          company_name?: string | null
          created_at?: string
          customer_email?: string
          customer_name?: string
          customer_phone?: string
          end_time?: string | null
          id?: string
          location_address?: string | null
          location_distance_km?: number | null
          location_fee?: number
          location_in_sint_niklaas?: boolean | null
          notes?: string | null
          on_location?: boolean
          preferred_date?: string
          preferred_time?: string
          service_id?: string | null
          service_title?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          total_duration_minutes?: number
          total_price?: number
          updated_at?: string
          vat_number?: string | null
          vehicle_brand?: string | null
          vehicle_info?: string | null
          vehicle_model?: string | null
          vehicle_type_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_items: {
        Row: {
          before_image_url: string | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string
          sort_order: number
          title: string | null
          updated_at: string
        }
        Insert: {
          before_image_url?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url: string
          sort_order?: number
          title?: string | null
          updated_at?: string
        }
        Update: {
          before_image_url?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string
          sort_order?: number
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          approved: boolean
          content: string
          created_at: string
          customer_name: string
          id: string
          rating: number
          updated_at: string
        }
        Insert: {
          approved?: boolean
          content: string
          created_at?: string
          customer_name: string
          id?: string
          rating: number
          updated_at?: string
        }
        Update: {
          approved?: boolean
          content?: string
          created_at?: string
          customer_name?: string
          id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          badge: string | null
          bookable: boolean
          category: string | null
          created_at: string
          description: string | null
          duration_minutes: number | null
          icon: string | null
          id: string
          image_url: string | null
          price: number | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          badge?: string | null
          bookable?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          icon?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          badge?: string | null
          bookable?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          icon?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          base_address: string
          base_city: string
          closing_hour: string
          created_at: string
          id: string
          km_fee: number
          notification_email: string | null
          opening_hour: string
          slot_interval_minutes: number
          updated_at: string
        }
        Insert: {
          base_address?: string
          base_city?: string
          closing_hour?: string
          created_at?: string
          id?: string
          km_fee?: number
          notification_email?: string | null
          opening_hour?: string
          slot_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          base_address?: string
          base_city?: string
          closing_hour?: string
          created_at?: string
          id?: string
          km_fee?: number
          notification_email?: string | null
          opening_hour?: string
          slot_interval_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_type_services: {
        Row: {
          available: boolean
          created_at: string
          duration_minutes: number
          id: string
          price: number
          service_id: string
          updated_at: string
          vehicle_type_id: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          duration_minutes?: number
          id?: string
          price?: number
          service_id: string
          updated_at?: string
          vehicle_type_id: string
        }
        Update: {
          available?: boolean
          created_at?: string
          duration_minutes?: number
          id?: string
          price?: number
          service_id?: string
          updated_at?: string
          vehicle_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_services_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          icon: string | null
          id: string
          image_url: string | null
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      booking_status: "nieuw" | "bevestigd" | "voltooid" | "geannuleerd"
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
    Enums: {
      app_role: ["admin", "user"],
      booking_status: ["nieuw", "bevestigd", "voltooid", "geannuleerd"],
    },
  },
} as const
